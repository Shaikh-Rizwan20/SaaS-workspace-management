import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { io } from 'socket.io-client';
import API, { 
    getWorkspaces, 
    createWorkspace, 
    deleteWorkspace, 
    getWorkspaceAssets, 
    uploadAsset, 
    getAuditLogs,
    getTenantUsage,
    getTenantUsers,
    getAnalyticsSummary,
    mockUpgradeToPro,
    forgotPassword,
    resetPassword
} from './services/api';

function Dashboard() {
    const { user } = useAuth();
    const [workspaces, setWorkspaces] = useState([]);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [searchQuery, setSearchQuery] = useState(''); // Global Search State

    // Tenant Usage & Analytics State
    const [usage, setUsage] = useState(null);
    const [analytics, setAnalytics] = useState(null);
    const [teamUsers, setTeamUsers] = useState([]);

    // Asset Management State
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
    const [assets, setAssets] = useState([]);
    const [file, setFile] = useState(null);

    // Audit Log State (Admin Only)
    const [auditLogs, setAuditLogs] = useState([]);

    // Live Socket.io Connection Effect
    useEffect(() => {
        const socket = io('http://localhost:5000', { withCredentials: true });

        if (user && user.tenant_id) {
            socket.emit('join_tenant', user.tenant_id);
        }

        socket.on('workspace_created', (newWs) => {
            setWorkspaces(prev => [newWs, ...prev]);
            getTenantUsage().then(res => setUsage(res.data)).catch(console.error);
        });

        socket.on('workspace_deleted', ({ id }) => {
            setWorkspaces(prev => prev.filter(w => w.id !== id));
            setSelectedWorkspaceId(currId => currId === id ? null : currId);
            getTenantUsage().then(res => setUsage(res.data)).catch(console.error);
        });

        socket.on('asset_uploaded', (newAsset) => {
            setAssets(prev => {
                if (selectedWorkspaceId === newAsset.workspace_id) {
                    return [newAsset, ...prev];
                }
                return prev;
            });
        });

        return () => socket.disconnect();
    }, [user, selectedWorkspaceId]);

    useEffect(() => {
        getWorkspaces()
            .then(res => setWorkspaces(res.data))
            .catch(err => console.error(err));

        getTenantUsage()
            .then(res => setUsage(res.data))
            .catch(err => console.error(err));

        getAnalyticsSummary()
            .then(res => setAnalytics(res.data))
            .catch(err => console.error(err));

        if (user && user.role === 'Admin') {
            getAuditLogs()
                .then(res => setAuditLogs(res.data))
                .catch(err => console.error(err));

            getTenantUsers()
                .then(res => setTeamUsers(res.data))
                .catch(err => console.error(err));
        }
    }, [user]);

    const handleCreateWorkspace = async (e) => {
        e.preventDefault();
        try {
            await createWorkspace({ title, description });
            setTitle('');
            setDescription('');
        } catch (err) {
            const errorMsg = err.response?.data?.error || 'Failed to create workspace';
            alert(errorMsg);
        }
    };

    const handleDeleteWorkspace = async (id) => {
        if (!window.confirm("Are you sure you want to delete this workspace?")) return;
        try {
            await deleteWorkspace(id);
        } catch (err) {
            alert('Permission denied or failed to delete workspace.');
        }
    };

    const handleSelectWorkspace = async (wsId) => {
        setSelectedWorkspaceId(wsId);
        try {
            const res = await getWorkspaceAssets(wsId);
            setAssets(res.data);
        } catch (err) {
            console.error('Failed to load assets', err);
        }
    };

    const handleFileUpload = async (e) => {
        e.preventDefault();
        if (!file || !selectedWorkspaceId) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            await uploadAsset(selectedWorkspaceId, formData);
            setFile(null);
        } catch (err) {
            alert('File upload failed. Check file size/type.');
        }
    };

    const handleUpgradeToPro = async () => {
        if (!window.confirm("Simulate upgrading to the Pro Plan ($29/mo)?")) return;
        try {
            await mockUpgradeToPro();
            alert('Successfully upgraded to Pro Plan!');
            const usageRes = await getTenantUsage();
            setUsage(usageRes.data);
        } catch (err) {
            alert('Failed to upgrade plan.');
        }
    };

    // Filter workspaces based on global search query
    const filteredWorkspaces = workspaces.filter(w => 
        w.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (w.description && w.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Tenant Workspaces Dashboard</h1>
                    <p className="text-gray-600">Logged in as: <span className="font-semibold">{user?.name}</span> ({user?.role})</p>
                </div>
            </div>

            {/* Tenant Plan & Usage Meter */}
            {usage && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200 mb-6 flex justify-between items-center shadow-sm">
                    <div>
                        <h2 className="font-bold text-lg text-blue-900">Organization: {usage.tenant.name}</h2>
                        <p className="text-sm text-blue-700">
                            Subscription Tier: <span className="font-semibold uppercase">{usage.tenant.subscription_plan}</span> | 
                            Workspaces Used: <span className="font-semibold">{usage.workspaces_used} / {usage.workspace_limit}</span>
                        </p>
                    </div>

                    {usage.tenant.subscription_plan === 'Free' ? (
                        <div className="flex items-center gap-3">
                            <span className="bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full font-semibold shadow">
                                Free Tier (Max 3)
                            </span>
                            {user.role === 'Admin' && (
                                <button 
                                    onClick={handleUpgradeToPro}
                                    className="bg-indigo-600 text-white text-xs px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 shadow cursor-pointer">
                                    Upgrade to Pro ($29/mo)
                                </button>
                            )}
                        </div>
                    ) : (
                        <span className="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-full font-semibold shadow">
                            Pro Plan Active (Unlimited)
                        </span>
                    )}
                </div>
            )}

            {/* Analytics Summary Cards */}
            {analytics && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <div className="bg-white p-4 rounded shadow border text-center">
                        <p className="text-gray-500 text-xs uppercase font-semibold">Total Workspaces</p>
                        <p className="text-2xl font-bold text-blue-600">{usage?.workspaces_used || 0}</p>
                    </div>
                    <div className="bg-white p-4 rounded shadow border text-center">
                        <p className="text-gray-500 text-xs uppercase font-semibold">Uploaded Assets</p>
                        <p className="text-2xl font-bold text-green-600">{usage?.assets_count || 0}</p>
                    </div>
                    <div className="bg-white p-4 rounded shadow border text-center">
                        <p className="text-gray-500 text-xs uppercase font-semibold">Storage Used</p>
                        <p className="text-2xl font-bold text-purple-600">{((usage?.total_storage_bytes || 0) / (1024 * 1024)).toFixed(2)} MB</p>
                    </div>
                </div>
            )}
            
            {/* Create Workspace Form */}
            <form onSubmit={handleCreateWorkspace} className="bg-white p-6 shadow rounded-lg mb-8">
                <h2 className="text-xl font-semibold mb-4">Create New Workspace</h2>
                <input 
                    type="text" placeholder="Workspace Title" value={title} 
                    onChange={e => setTitle(e.target.value)} 
                    className="w-full p-2 border mb-3 rounded" required 
                />
                <textarea 
                    placeholder="Description" value={description} 
                    onChange={e => setDescription(e.target.value)} 
                    className="w-full p-2 border mb-3 rounded" 
                />
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 cursor-pointer">
                    Create Workspace
                </button>
            </form>

            <div className="grid md:grid-cols-2 gap-8">
                {/* Workspaces List with Global Search */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Workspaces (Live Sync)</h2>
                    </div>
                    <input 
                        type="text" placeholder="Search workspaces..." value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full p-2 border mb-4 rounded text-sm bg-white shadow-sm"
                    />
                    <div className="space-y-4">
                        {filteredWorkspaces.length === 0 ? (
                            <p className="text-gray-400 text-sm">No workspaces found.</p>
                        ) : (
                            filteredWorkspaces.map(w => (
                                <div 
                                    key={w.id} 
                                    className={`bg-white p-4 shadow rounded border cursor-pointer transition ${selectedWorkspaceId === w.id ? 'border-blue-500 ring-2 ring-blue-100' : ''}`}
                                    onClick={() => handleSelectWorkspace(w.id)}
                                >
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h3 className="font-bold text-lg">{w.title}</h3>
                                            <p className="text-gray-600 text-sm">{w.description}</p>
                                        </div>
                                        {user.role === 'Admin' && (
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteWorkspace(w.id); }} 
                                                className="bg-red-500 text-white px-2.5 py-1 rounded text-xs hover:bg-red-600 cursor-pointer">
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Workspace Assets Section */}
                <div>
                    <h2 className="text-xl font-semibold mb-4">Workspace Assets</h2>
                    {selectedWorkspaceId ? (
                        <div className="bg-white p-5 shadow rounded border">
                            <form onSubmit={handleFileUpload} className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-2">Upload file to active workspace</label>
                                <input 
                                    type="file" 
                                    onChange={e => setFile(e.target.files[0])} 
                                    className="w-full text-sm border p-1 rounded mb-3" 
                                    required 
                                />
                                <button type="submit" className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 cursor-pointer">
                                    Upload Asset
                                </button>
                            </form>

                            <div className="border-t pt-4">
                                <h3 className="font-medium mb-2 text-sm text-gray-700">Uploaded Files:</h3>
                                {assets.length === 0 ? (
                                    <p className="text-gray-400 text-sm">No assets uploaded yet.</p>
                                ) : (
                                    <ul className="space-y-2 text-sm">
                                        {assets.map(asset => (
                                            <li key={asset.id} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                                                <a href={`http://localhost:5000${asset.file_path}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-[200px]">
                                                    {asset.file_name}
                                                </a>
                                                <span className="text-gray-400 text-xs">{(asset.file_size / 1024).toFixed(1)} KB</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="bg-gray-50 border-dashed border-2 border-gray-300 p-8 rounded-lg text-center text-gray-500">
                            Select a workspace from the left to view and upload assets.
                        </div>
                    )}
                </div>
            </div>

            {/* Admin Team Members Roster */}
            {user.role === 'Admin' && (
                <div className="mt-8 bg-white p-6 shadow rounded-lg border">
                    <h2 className="text-xl font-semibold mb-4 text-indigo-600">Organization Team Roster</h2>
                    {teamUsers.length === 0 ? (
                        <p className="text-gray-500 text-sm">No team members found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b bg-gray-50">
                                        <th className="p-2">Name</th>
                                        <th className="p-2">Email</th>
                                        <th className="p-2">Role</th>
                                        <th className="p-2">Joined</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {teamUsers.map(member => (
                                        <tr key={member.id} className="border-b">
                                            <td className="p-2 font-medium text-gray-800">{member.name}</td>
                                            <td className="p-2 text-gray-600">{member.email}</td>
                                            <td className="p-2">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${member.role_name === 'Admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {member.role_name}
                                                </span>
                                            </td>
                                            <td className="p-2 text-gray-400 text-xs">{new Date(member.created_at).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Admin Member Invitation Section */}
            {user.role === 'Admin' && (
                <div className="mt-8 bg-white p-6 shadow rounded-lg border">
                    <h2 className="text-xl font-semibold mb-4 text-blue-600">Invite Team Member</h2>
                    <form onSubmit={async (e) => {
                        e.preventDefault();
                        const emailInput = e.target.elements.inviteEmail.value;
                        try {
                            await API.post('/tenant/invite', { email: emailInput });
                            alert(`Invitation sent to ${emailInput}! Check backend console for mock email log.`);
                            e.target.reset();
                        } catch (err) {
                            alert('Failed to send invitation email.');
                        }
                    }} className="flex gap-4">
                        <input 
                            type="email" name="inviteEmail" placeholder="colleague@company.com" 
                            className="flex-1 p-2 border rounded text-sm" required 
                        />
                        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-blue-700 cursor-pointer">
                            Send Invite
                        </button>
                    </form>
                </div>
            )}

            {/* Admin Audit Log Section */}
            {user.role === 'Admin' && (
                <div className="mt-8 bg-white p-6 shadow rounded-lg border">
                    <h2 className="text-xl font-semibold mb-4 text-red-600">Admin Audit Logs (Database Trigger Tracked)</h2>
                    {auditLogs.length === 0 ? (
                        <p className="text-gray-500 text-sm">No audit logs recorded yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b bg-gray-50">
                                        <th className="p-2">Action</th>
                                        <th className="p-2">Details</th>
                                        <th className="p-2">Timestamp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.map(log => (
                                        <tr key={log.id} className="border-b">
                                            <td className="p-2 font-medium text-red-700">{log.action}</td>
                                            <td className="p-2 text-gray-600">{log.details}</td>
                                            <td className="p-2 text-gray-400 text-xs">{new Date(log.created_at).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function LoginScreen() {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isForgotMode, setIsForgotMode] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (isForgotMode) {
                await forgotPassword(email);
                alert('Check your backend console for the mock password reset link!');
                setIsForgotMode(false);
            } else {
                await login(email, password);
            }
        } catch (err) {
            alert('Operation failed. Check your inputs.');
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-gray-100">
            <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow w-96">
                <h2 className="text-2xl font-bold mb-4">{isForgotMode ? 'Reset Password' : 'SaaS Login'}</h2>
                
                <input 
                    type="email" placeholder="Email (admin@acme.com)" value={email} 
                    onChange={e => setEmail(e.target.value)} className="w-full p-2 border mb-3 rounded" required 
                />

                {!isForgotMode && (
                    <input 
                        type="password" placeholder="Password (password123)" value={password} 
                        onChange={e => setPassword(e.target.value)} className="w-full p-2 border mb-3 rounded" required 
                    />
                )}

                <button type="submit" className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 cursor-pointer mb-3">
                    {isForgotMode ? 'Send Reset Link' : 'Sign In'}
                </button>

                <button 
                    type="button" 
                    onClick={() => setIsForgotMode(!isForgotMode)} 
                    className="w-full text-sm text-blue-600 hover:underline text-center">
                    {isForgotMode ? 'Back to Login' : 'Forgot Password?'}
                </button>
            </form>
        </div>
    );
}

function ResetPasswordScreen({ token }) {
    const [newPassword, setNewPassword] = useState('');
    const [submitted, setSubmitted] = useState(false);

    const handleReset = async (e) => {
        e.preventDefault();
        try {
            await resetPassword(token, newPassword);
            setSubmitted(true);
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to reset password. Token may have expired.');
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-gray-100">
            <div className="bg-white p-8 rounded shadow w-96 text-center">
                <h2 className="text-2xl font-bold mb-4">Set New Password</h2>
                {submitted ? (
                    <div>
                        <p className="text-emerald-600 font-semibold mb-4">Password successfully updated!</p>
                        <a href="/" className="bg-blue-600 text-white px-4 py-2 rounded inline-block">Go to Login</a>
                    </div>
                ) : (
                    <form onSubmit={handleReset}>
                        <input 
                            type="password" placeholder="Enter new password" value={newPassword} 
                            onChange={e => setNewPassword(e.target.value)} className="w-full p-2 border mb-3 rounded" required 
                        />
                        <button type="submit" className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 cursor-pointer">
                            Update Password
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}

function LoginRouter() {
    const { user } = useAuth();
    
    const queryParams = new URLSearchParams(window.location.search);
    const resetToken = queryParams.get('token');

    if (resetToken) {
        return <ResetPasswordScreen token={resetToken} />;
    }

    return user ? <Dashboard /> : <LoginScreen />;
}

export default function App() {
    return (
        <AuthProvider>
            <LoginRouter />
        </AuthProvider>
    );
}