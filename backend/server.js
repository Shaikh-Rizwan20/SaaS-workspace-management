const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const pool = require('./config/db');
const { verifyTokenAndTenant, requireRole } = require('./middleware/auth');
const { sendEmail } = require('./utils/mailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: 'http://localhost:5173', credentials: true }
});

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: 'http://localhost:5173', credentials: true }));

// Socket.io Connection & Tenant Room Management
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join_tenant', (tenantId) => {
        socket.join(`tenant_${tenantId}`);
        console.log(`Socket ${socket.id} joined tenant room: tenant_${tenantId}`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

app.set('io', io);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer Disk Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|pdf|txt|docx|zip|xlsx|csv/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        if (extname) return cb(null, true);
        cb(new Error('Only images, PDFs, and documents are allowed!'));
    }
});

// --- Auth Routes ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query(`
            SELECT u.*, r.name as role_name 
            FROM users u 
            LEFT JOIN roles r ON u.role_id = r.id 
            WHERE u.email = ?
        `, [email]);

        if (rows.length === 0) return res.status(400).json({ error: 'Invalid email or password.' });

        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(400).json({ error: 'Invalid email or password.' });

        const token = jwt.sign(
            { id: user.id, tenant_id: user.tenant_id, role: user.role_name },
            process.env.JWT_SECRET || 'supersecretkey',
            { expiresIn: '1d' }
        );

        res.cookie('token', token, { httpOnly: true, secure: false }).json({
            message: 'Logged in successfully',
            user: { id: user.id, name: user.name, email: user.email, role: user.role_name, tenant_id: user.tenant_id }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Workspace Routes ---
app.get('/api/workspaces', verifyTokenAndTenant, async (req, res) => {
    try {
        const [workspaces] = await pool.query(
            'SELECT * FROM workspaces WHERE tenant_id = ? ORDER BY created_at DESC',
            [req.user.tenant_id]
        );
        res.json(workspaces);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/workspaces', verifyTokenAndTenant, async (req, res) => {
    try {
        const { title, description } = req.body;

        const [tenantRows] = await pool.query(
            'SELECT subscription_plan FROM tenants WHERE id = ?',
            [req.user.tenant_id]
        );
        const plan = tenantRows[0]?.subscription_plan || 'Free';

        if (plan === 'Free') {
            const [countRows] = await pool.query(
                'SELECT COUNT(*) as total FROM workspaces WHERE tenant_id = ?',
                [req.user.tenant_id]
            );
            if (countRows[0].total >= 3) {
                return res.status(403).json({ 
                    error: 'Free plan limit reached! Upgrade to Pro to create unlimited workspaces.' 
                });
            }
        }

        const [result] = await pool.query(
            'INSERT INTO workspaces (tenant_id, title, description, created_by) VALUES (?, ?, ?, ?)',
            [req.user.tenant_id, title, description, req.user.id]
        );
        
        const newWorkspace = { id: result.insertId, tenant_id: req.user.tenant_id, title, description, created_by: req.user.id };
        
        req.app.get('io').to(`tenant_${req.user.tenant_id}`).emit('workspace_created', newWorkspace);

        res.status(201).json(newWorkspace);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/workspaces/:id', verifyTokenAndTenant, requireRole(['Admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query(
            'DELETE FROM workspaces WHERE id = ? AND tenant_id = ?',
            [id, req.user.tenant_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Workspace not found or unauthorized.' });
        }

        req.app.get('io').to(`tenant_${req.user.tenant_id}`).emit('workspace_deleted', { id: Number(id) });

        res.json({ message: 'Workspace deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Asset Routes ---
app.get('/api/workspaces/:workspaceId/assets', verifyTokenAndTenant, async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const [assets] = await pool.query(
            'SELECT * FROM assets WHERE tenant_id = ? AND workspace_id = ? ORDER BY created_at DESC',
            [req.user.tenant_id, workspaceId]
        );
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/workspaces/:workspaceId/assets', verifyTokenAndTenant, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        const { workspaceId } = req.params;
        const [wsCheck] = await pool.query(
            'SELECT id FROM workspaces WHERE id = ? AND tenant_id = ?',
            [workspaceId, req.user.tenant_id]
        );
        if (wsCheck.length === 0) return res.status(404).json({ error: 'Workspace not found.' });

        const fileUrl = `/uploads/${req.file.filename}`;
        const [result] = await pool.query(
            'INSERT INTO assets (tenant_id, workspace_id, file_name, file_path, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
            [req.user.tenant_id, workspaceId, req.file.originalname, fileUrl, req.file.size, req.user.id]
        );

        const newAsset = {
            id: result.insertId,
            workspace_id: Number(workspaceId),
            file_name: req.file.originalname,
            file_path: fileUrl,
            file_size: req.file.size
        };

        req.app.get('io').to(`tenant_${req.user.tenant_id}`).emit('asset_uploaded', newAsset);

        res.status(201).json(newAsset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Audit Log & Usage Routes ---
app.get('/api/audit-logs', verifyTokenAndTenant, requireRole(['Admin']), async (req, res) => {
    try {
        const [logs] = await pool.query(
            'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.tenant_id]
        );
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tenant/usage', verifyTokenAndTenant, async (req, res) => {
    try {
        const [tenantRows] = await pool.query(
            'SELECT name, subdomain, subscription_plan FROM tenants WHERE id = ?',
            [req.user.tenant_id]
        );
        const [countRows] = await pool.query(
            'SELECT COUNT(*) as workspace_count FROM workspaces WHERE tenant_id = ?',
            [req.user.tenant_id]
        );
        const [assetCountRows] = await pool.query(
            'SELECT COUNT(*) as asset_count, SUM(file_size) as total_size FROM assets WHERE tenant_id = ?',
            [req.user.tenant_id]
        );

        res.json({
            tenant: tenantRows[0],
            workspaces_used: countRows[0].workspace_count,
            workspace_limit: tenantRows[0].subscription_plan === 'Free' ? 3 : 'Unlimited',
            assets_count: assetCountRows[0].asset_count,
            total_storage_bytes: assetCountRows[0].total_size || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Stripe Billing & Checkout Routes ---
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/api/billing/create-checkout-session', verifyTokenAndTenant, requireRole(['Admin']), async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'SaaS Workspace Pro Plan',
                            description: 'Unlimited workspaces and advanced asset management.',
                        },
                        unit_amount: 2900,
                        recurring: { interval: 'month' },
                    },
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL}/?upgrade=success`,
            cancel_url: `${process.env.FRONTEND_URL}/?upgrade=canceled`,
            metadata: {
                tenant_id: req.user.tenant_id
            }
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('STRIPE ERROR:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/billing/webhook', async (req, res) => {
    const event = req.body;

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const tenantId = session.metadata.tenant_id;

        if (tenantId) {
            await pool.query(
                "UPDATE tenants SET subscription_plan = 'Pro' WHERE id = ?",
                [tenantId]
            );
            console.log(`Tenant ${tenantId} successfully upgraded to Pro via Stripe webhook!`);
        }
    }

    res.json({ received: true });
});

// --- Mock Billing Upgrade Route ---
app.post('/api/billing/mock-upgrade', verifyTokenAndTenant, requireRole(['Admin']), async (req, res) => {
    try {
        await pool.query(
            "UPDATE tenants SET subscription_plan = 'Pro' WHERE id = ?",
            [req.user.tenant_id]
        );
        console.log(`Tenant ${req.user.tenant_id} successfully upgraded to Pro via Mock Billing!`);
        res.json({ success: true, message: 'Upgraded to Pro successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Tenant Member Invitation Route ---
app.post('/api/tenant/invite', verifyTokenAndTenant, requireRole(['Admin']), async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email address is required.' });

        const [tenantRows] = await pool.query('SELECT name FROM tenants WHERE id = ?', [req.user.tenant_id]);
        const tenantName = tenantRows[0]?.name || 'Our Organization';

        const inviteLink = `${process.env.FRONTEND_URL}/login?invite=${req.user.tenant_id}`;

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #2563eb;">You've been invited!</h2>
                <p>Hello,</p>
                <p>You have been invited to join <strong>${tenantName}</strong> on SaaS Workspace Manager.</p>
                <p style="margin: 20px 0;">
                    <a href="${inviteLink}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Accept Invitation</a>
                </p>
                <p>If you did not request this, you can safely ignore this email.</p>
            </div>
        `;

        await sendEmail(email, `Invitation to join ${tenantName}`, htmlBody);

        res.json({ message: `Invitation email successfully dispatched to ${email}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
const crypto = require('crypto');

// 1. Request Password Reset Link
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length === 0) {
            // For security, don't reveal if email exists or not
            return res.json({ message: 'If that email exists, a reset link has been sent.' });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

        // Save token to database
        await pool.query(
            'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
            [resetToken, expiresAt, user.id]
        );

        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

        const htmlBody = `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                <h2 style="color: #2563eb;">Password Reset Request</h2>
                <p>Hello ${user.name},</p>
                <p>You requested a password reset for your SaaS Workspace Manager account.</p>
                <p style="margin: 20px 0;">
                    <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                </p>
                <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
            </div>
        `;

        await sendEmail(user.email, 'Password Reset - SaaS Workspace Manager', htmlBody);

        res.json({ message: 'If that email exists, a reset link has been sent.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Complete Password Reset
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        const [users] = await pool.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired password reset token.' });
        }

        const user = users[0];
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password and clear reset token fields
        await pool.query(
            'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        res.json({ message: 'Password successfully reset! You can now log in with your new password.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// --- Analytics Endpoint ---
app.get('/api/analytics/summary', verifyTokenAndTenant, async (req, res) => {
    try {
        // Get workspace counts grouped by creation date for analytics chart
        const [growthRows] = await pool.query(`
            SELECT DATE(created_at) as date, COUNT(*) as count 
            FROM workspaces 
            WHERE tenant_id = ? 
            GROUP BY DATE(created_at) 
            ORDER BY date ASC 
            LIMIT 7
        `, [req.user.tenant_id]);

        res.json({
            growthData: growthRows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));