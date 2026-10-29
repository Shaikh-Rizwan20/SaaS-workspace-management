import axios from 'axios';

const API = axios.create({
    baseURL: 'http://localhost:5000/api',
    withCredentials: true
});

export const loginUser = (credentials) => API.post('/auth/login', credentials);
export const getWorkspaces = () => API.get('/workspaces');
export const createWorkspace = (data) => API.post('/workspaces', data);
export const getWorkspaceAssets = (workspaceId) => API.get(`/workspaces/${workspaceId}/assets`);
export const uploadAsset = (workspaceId, formData) => API.post(`/workspaces/${workspaceId}/assets`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
});
export const deleteWorkspace = (id) => API.delete(`/workspaces/${id}`);
export const getAuditLogs = () => API.get('/audit-logs');
export const getTenantUsage = () => API.get('/tenant/usage');
export const getTenantUsers = () => API.get('/tenant/users');
export const getAnalyticsSummary = () => API.get('/analytics/summary');
export const createCheckoutSession = () => API.post('/billing/create-checkout-session');
export const mockUpgradeToPro = () => API.post('/billing/mock-upgrade');
export const forgotPassword = (email) => API.post('/auth/forgot-password', { email });
export const resetPassword = (token, newPassword) => API.post('/auth/reset-password', { token, newPassword });

export default API;