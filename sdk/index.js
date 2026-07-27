const axios = require('axios');

/**
 * axionLimit(options) → Express Middleware
 *
 * Connects your Express app to the AxionLimit rate limiting service.
 * Every incoming request is checked against your configured API key quota.
 * All rate limiting logic runs server-side — no SDK updates needed when
 * new features are deployed to AxionLimit.
 *
 * @param {object} options
 * @param {string} options.apiKey    - Your API key from the AxionLimit dashboard (required)
 * @param {string} options.serverUrl - Base URL of your deployed AxionLimit server
 *                                     (default: 'http://localhost:5000')
 *
 * @example
 *   const axionLimit = require('axion-limit-sdk');
 *
 *   app.use(axionLimit({
 *     apiKey:    'ax_your_key_here',
 *     serverUrl: 'https://your-axionlimit-server.com'
 *   }));
 */
function axionLimit({ apiKey, serverUrl = 'http://localhost:5000' } = {}) {

  // Validate required config at startup — fail loud so the developer knows immediately
  if (!apiKey) {
    throw new Error('[axion-limit-sdk] apiKey is required. Generate one at your AxionLimit dashboard.');
  }

  // Return the Express-compatible middleware function
  return async function axionLimitMiddleware(req, res, next) {
    try {
      // Call the AxionLimit /api/check-limit endpoint with the API key in headers
      const response = await axios.get(`${serverUrl}/api/check-limit`, {
        headers: {
          'x-api-key': apiKey
        },
        params: {
          endpoint: req.path  // Tracks which endpoint was hit (visible in dashboard)
        },
        timeout: 3000         // 3s timeout — never hang the developer's app
      });

      // Forward rate limit info as standard HTTP headers to the developer's client
      if (response.data.remaining !== undefined) {
        res.setHeader('X-RateLimit-Remaining', response.data.remaining);
      }
      if (response.data.retryAfter !== undefined) {
        res.setHeader('X-RateLimit-RetryAfter', response.data.retryAfter);
      }

      // ✅ Request is within quota — pass through to developer's route handler
      return next();

    } catch (err) {

      // 🚫 429 — Rate limit exceeded on AxionLimit server
      if (err.response?.status === 429) {
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: err.response.data?.retryAfter ?? 1
        });
      }

      // ⚠️ AxionLimit server unreachable (network error, timeout, server down)
      // FAIL OPEN: do not block the developer's users just because our service is unreachable
      console.warn('[axion-limit-sdk] Warning: Could not reach AxionLimit server. Failing open.');
      return next();
    }
  };
}

module.exports = axionLimit;
