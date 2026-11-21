import axios from 'axios';

let activeBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export const getApiBaseUrl = () => activeBaseUrl;

const api = axios.create({
  baseURL: activeBaseUrl,
});

// Attempt to load runtime configuration from /config.json (ensures frontend targets live backend when IP changes)
if (typeof window !== 'undefined') {
  fetch('/config.json?t=' + Date.now())
    .then((res) => (res.ok ? res.json() : null))
    .then((cfg) => {
      if (cfg && cfg.apiUrl) {
        activeBaseUrl = cfg.apiUrl;
        api.defaults.baseURL = activeBaseUrl;
      }
    })
    .catch(() => {
      // Fallback silently to build-time or default URL
    });
}

api.interceptors.request.use((config) => {
  if (activeBaseUrl) {
    config.baseURL = activeBaseUrl;
  }
  const token = localStorage.getItem('axion_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

export const devLogin = () => api.post('/auth/dev-login');
export const getProfile = () => api.get('/auth/me');

export const getApiKeys = () => api.get('/api/keys');
export const createApiKey = (data) => api.post('/api/keys', data);
export const updateApiKey = (id, data) => api.patch(`/api/keys/${id}`, data);
export const rotateApiKey = (id) => api.post(`/api/keys/${id}/rotate`);
export const deleteApiKey = (id) => api.delete(`/api/keys/${id}`);

export const getStats = () => api.get('/api/analytics/stats');
export const resetStats = () => api.post('/api/analytics/reset');

export const checkRateLimit = (apiKeyOrId, endpoint, isKeyId = false, userId = '', clientIp = '') => {
  const headers = isKeyId ? { 'x-api-key-id': apiKeyOrId } : { 'x-api-key': apiKeyOrId };
  if (userId) {
    headers['x-user-id'] = userId;
  }
  if (clientIp) {
    headers['x-user-ip'] = clientIp;
  }
  return api.post('/api/check-limit', { endpoint, userId }, { headers });
};

export default api;
