import axios from 'axios';

const api = axios.create({
  baseURL: '/',
});

// Attach JWT token from localStorage to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('axion_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Auth
export const devLogin = () => api.post('/auth/dev-login');
export const getProfile = () => api.get('/auth/me');

// API Keys
export const getApiKeys = () => api.get('/api/keys');
export const createApiKey = (data) => api.post('/api/keys', data);
export const deleteApiKey = (id) => api.delete(`/api/keys/${id}`);

// Analytics
export const getStats = () => api.get('/api/analytics/stats');
export const resetStats = () => api.post('/api/analytics/reset');

// Rate Limit Check
export const checkRateLimit = (apiKey, endpoint) =>
  api.post('/api/check-limit', { endpoint }, {
    headers: { 'x-api-key': apiKey },
  });

export default api;
