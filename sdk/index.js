const axios = require('axios');

function axionLimit({ apiKey, serverUrl = 'http://localhost:5000' } = {}) {
  if (!apiKey) {
    throw new Error('[axion-limit-sdk] apiKey is required. Generate one at your AxionLimit dashboard.');
  }

  return async function axionLimitMiddleware(req, res, next) {
    try {
      const response = await axios.get(`${serverUrl}/api/check-limit`, {
        headers: {
          'x-api-key': apiKey
        },
        params: {
          endpoint: req.path
        },
        timeout: 3000
      });

      if (response.data.remaining !== undefined) {
        res.setHeader('X-RateLimit-Remaining', response.data.remaining);
      }
      if (response.data.retryAfter !== undefined) {
        res.setHeader('X-RateLimit-RetryAfter', response.data.retryAfter);
      }

      return next();
    } catch (err) {
      if (err.response?.status === 429) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: err.response.data?.retryAfter ?? 1
        });
      }

      console.warn('[axion-limit-sdk] Warning: Could not reach AxionLimit server. Failing open.');
      return next();
    }
  };
}

module.exports = axionLimit;

