const jwt = require('jsonwebtoken');

const verifyTokenAndTenant = (req, res, next) => {
    const token = req.cookies.token || req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretkey');
        req.user = decoded; // Contains id, tenant_id, role
        next();
    } catch (ex) {
        res.status(400).json({ error: 'Invalid token.' });
    }
};

const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
        }
        next();
    };
};

module.exports = { verifyTokenAndTenant, requireRole };