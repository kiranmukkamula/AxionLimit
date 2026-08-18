const express = require('express');
const rateLimiter = require('../services/rateLimiter');
const telemetry = require('../services/telemetry');
const { verifyApiKey, verifyJWT } = require('../middleware/auth');

const router = express.Router();

router.all('/check-limit', verifyApiKey, async (request, response) => {
  try {
    const { key: apiKeyIdentifier, userId, limit: requestLimit, windowMs: windowDurationMs, name: apiKeyName } = request.apiKeyMetadata;
    const requestedEndpoint = request.query.endpoint || request.body.endpoint || '/api/default';

    const rateLimitResult = await rateLimiter.isAllowed(apiKeyIdentifier, requestLimit, windowDurationMs);

    telemetry.logAnalytics(userId, apiKeyName, requestedEndpoint, rateLimitResult.allowed);

    response.setHeader('X-RateLimit-Limit', requestLimit);
    response.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining);
    response.setHeader('X-RateLimit-Reset', rateLimitResult.retryAfter);

    if (rateLimitResult.allowed) {
      return response.status(200).json({
        allowed: true,
        remaining: rateLimitResult.remaining,
        retryAfter: 0
      });
    } else {
      return response.status(429).json({
        allowed: false,
        remaining: 0,
        retryAfter: rateLimitResult.retryAfter
      });
    }
  } catch (rateLimitRequestError) {
    console.error('❌ Error checking rate limit:', rateLimitRequestError);
    return response.status(200).json({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
      warning: 'Server error, failing open.'
    });
  }
});

router.get('/analytics/stats', verifyJWT, async (req, res) => {
  try {
    const stats = await telemetry.getStats(req.user.userId);
    return res.status(200).json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('❌ Failed to retrieve telemetry stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve telemetry stats.' });
  }
});

router.post('/analytics/reset', verifyJWT, async (req, res) => {
  try {
    await telemetry.resetStats(req.user.userId);
    return res.status(200).json({
      success: true,
      message: 'Telemetry counters and rankings reset successfully.'
    });
  } catch (err) {
    console.error('❌ Failed to reset telemetry stats:', err);
    return res.status(500).json({ error: 'Failed to reset telemetry.' });
  }
});

module.exports = router;
