const express = require('express');
const rateLimiter = require('../services/rateLimiter');
const telemetry = require('../services/telemetry');
const { verifyApiKey, verifyJWT } = require('../middleware/auth');

const router = express.Router();

router.all('/check-limit', verifyApiKey, async (req, res) => {
  try {
    const { key, limit, windowMs, name } = req.apiKeyMetadata;
    const endpoint = req.query.endpoint || req.body.endpoint || '/api/default';

    const limiterResult = await rateLimiter.isAllowed(key, limit, windowMs);

    telemetry.logAnalytics(name, endpoint, limiterResult.allowed);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', limiterResult.remaining);
    res.setHeader('X-RateLimit-Reset', limiterResult.retryAfter);

    if (limiterResult.allowed) {
      return res.status(200).json({
        allowed: true,
        remaining: limiterResult.remaining,
        retryAfter: 0
      });
    } else {
      return res.status(429).json({
        allowed: false,
        remaining: 0,
        retryAfter: limiterResult.retryAfter
      });
    }
  } catch (err) {
    console.error('❌ Error checking rate limit:', err);
    return res.status(200).json({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
      warning: 'Server error, failing open.'
    });
  }
});

router.get('/analytics/stats', verifyJWT, async (req, res) => {
  try {
    const stats = await telemetry.getStats();
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
    await telemetry.resetStats();
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

