// Import Express to implement API endpoints and routing.
const express = require('express');

// Import the sliding window rate limiter service (implements Redis Lua script).
const rateLimiter = require('../services/rateLimiter');

// Import telemetry pipeline module: logs metrics and analytics asynchronously in Redis.
const telemetry = require('../services/telemetry');

// Import middlewares: verifyApiKey checks request token; verifyJWT protects telemetry stats.
const { verifyApiKey, verifyJWT } = require('../middleware/auth');

// Create a router instance to map rate-limiting and analytics paths.
const router = express.Router();

// ============================================================================
// ENDPOINT 1: ALL /api/check-limit (EVALUATE CLIENT INCOMING REQUEST)
// ============================================================================
// router.all accepts GET, POST, PUT, DELETE, etc., allowing checks on any HTTP method.
// Protected by verifyApiKey: ensures caller possesses a valid API key config attached to req.apiKeyMetadata.
router.all('/check-limit', verifyApiKey, async (req, res) => {
  try {
    // Extract key, limits, and label name populated by verifyApiKey middleware.
    const { key, limit, windowMs, name } = req.apiKeyMetadata;
    
    // Read the query/body endpoint parameters to log which resource path is accessed.
    const endpoint = req.query.endpoint || req.body.endpoint || '/api/default';

    // 1. Evaluate client request using the atomic sliding window log Lua script helper.
    const limiterResult = await rateLimiter.isAllowed(key, limit, windowMs);

    // 2. Log request statistics (allowed vs blocked) asynchronously in the background.
    // This executes fire-and-forget style without blocking the network return headers.
    telemetry.logAnalytics(name, endpoint, limiterResult.allowed);

    // 3. Set standard HTTP Rate Limiting response headers to guide client behavior.
    res.setHeader('X-RateLimit-Limit', limit); // Maximum requests allowed per window.
    res.setHeader('X-RateLimit-Remaining', limiterResult.remaining); // Remaining quota.
    res.setHeader('X-RateLimit-Reset', limiterResult.retryAfter); // Retry delay in seconds.

    // 4. Return standard rate limiter responses based on check result.
    if (limiterResult.allowed) {
      // Under limit: Return HTTP 200 OK.
      return res.status(200).json({
        allowed: true,
        remaining: limiterResult.remaining,
        retryAfter: 0
      });
    } else {
      // Over limit: Return HTTP 429 Too Many Requests.
      return res.status(429).json({
        allowed: false,
        remaining: 0,
        retryAfter: limiterResult.retryAfter
      });
    }
  } catch (err) {
    // FAIL-OPEN ERROR FALLBACK: If middleware crashes or throws, log it and allow request through.
    console.error('❌ Error checking rate limit:', err);
    return res.status(200).json({
      allowed: true,
      remaining: 1,
      retryAfter: 0,
      warning: 'Server error, failing open.'
    });
  }
});

// ============================================================================
// ENDPOINT 2: GET /api/analytics/stats (FETCH TELEMETRY STATS)
// ============================================================================
// Protected by verifyJWT: Ensures only authenticated dashboard admins can retrieve metric logs.
router.get('/analytics/stats', verifyJWT, async (req, res) => {
  try {
    // Retrieve metrics totals and sorted set rankings from Redis.
    const stats = await telemetry.getStats();
    
    // Return statistics response.
    return res.status(200).json({
      success: true,
      stats
    });
  } catch (err) {
    console.error('❌ Failed to retrieve telemetry stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve telemetry stats.' });
  }
});

// ============================================================================
// ENDPOINT 3: POST /api/analytics/reset (WIPE TELEMETRY STATS)
// ============================================================================
// Protected by verifyJWT: Restricts metric clearing to authenticated admins.
router.post('/analytics/reset', verifyJWT, async (req, res) => {
  try {
    // Call telemetry module to delete metrics keys from Redis cache database.
    await telemetry.resetStats();
    
    // Return status 200.
    return res.status(200).json({
      success: true,
      message: 'Telemetry counters and rankings reset successfully.'
    });
  } catch (err) {
    console.error('❌ Failed to reset telemetry stats:', err);
    return res.status(500).json({ error: 'Failed to reset telemetry.' });
  }
});

// Export the rate limit routes.
module.exports = router;
