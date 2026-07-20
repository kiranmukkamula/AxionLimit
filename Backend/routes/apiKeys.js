// Import Express module for API routing setup.
const express = require('express');

// Import Node's built-in Crypto library to generate secure, unguessable random strings for API keys.
const crypto = require('crypto');

// Import ApiKey MongoDB model to manage key records.
const ApiKey = require('../models/ApiKey');

// Import verifyJWT middleware to protect endpoints from unauthenticated callers.
const { verifyJWT } = require('../middleware/auth');

// Import Redis connection getter from our database settings module.
const { getRedisClient } = require('../config/db');

// Instantiate a router instance.
const router = express.Router();

// Apply the verifyJWT validation middleware globally to all API Key management endpoints below.
router.use(verifyJWT);

// ============================================================================
// ENDPOINT 1: GET /api/keys (LIST ALL KEYS)
// ============================================================================
router.get('/', async (req, res) => {
  try {
    // Find all database keys belonging to the authenticated User ID, sorting newest first.
    const keys = await ApiKey.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    
    // Return key array with status 200.
    return res.status(200).json({ success: true, keys });
  } catch (err) {
    // Log unexpected exceptions.
    console.error('❌ Failed to retrieve API keys:', err);
    return res.status(500).json({ error: 'Failed to retrieve API keys.' });
  }
});

// ============================================================================
// ENDPOINT 2: POST /api/keys (GENERATE API KEY WITH DAILY LIMITS)
// ============================================================================
router.post('/', async (req, res) => {
  // Read authenticated user's ID.
  const userId = req.user.userId;
  
  // Extract key name and custom rate limit settings from request body.
  const { name, limit, windowMs } = req.body;
  
  // Format current date to YYYY-MM-DD to isolate quotas by day (UTC format).
  const today = new Date().toISOString().slice(0, 10);
  
  // Define Redis key namespace pattern for this user's daily creation limit counter.
  const quotaKey = `apikey_limit:${userId}:${today}`;
  
  // Get active Redis client.
  const redis = getRedisClient();

  // Boolean flags to track rate limit checks.
  let quotaExceeded = false;
  let currentQuotaCount = 0;

  // ----------------------------------------
  // STEP 1: PERFORM DAILY QUOTA CHECK
  // ----------------------------------------
  if (redis && redis.status === 'ready') {
    try {
      // Atomically increment the user's daily key counter.
      currentQuotaCount = await redis.incr(quotaKey);
      
      // If this is the first key generated today, set absolute expiration to 24 hours (86400s).
      if (currentQuotaCount === 1) {
        await redis.expire(quotaKey, 86400);
      }
      
      // If counter exceeds 3, set flag to true.
      if (currentQuotaCount > 3) {
        quotaExceeded = true;
      }
    } catch (err) {
      // Redis fallback: If Redis fails, log incident and query MongoDB directly.
      console.error('⚠️ Redis error checking key quota, falling back to DB:', err);
      
      // Define timestamps representing the start and end of the current day.
      const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
      const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
      
      // Query MongoDB to count how many keys this user generated today.
      const dbCount = await ApiKey.countDocuments({
        userId,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      });
      if (dbCount >= 3) quotaExceeded = true;
    }
  } else {
    // Redis offline fallback: Query MongoDB.
    console.warn('⚠️ Redis offline. Checking daily quota in MongoDB.');
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
    const dbCount = await ApiKey.countDocuments({
      userId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });
    if (dbCount >= 3) quotaExceeded = true;
  }

  // If daily quota is exceeded, reject the creation request.
  if (quotaExceeded) {
    // Refund: decrement the Redis key to maintain accurate quota levels.
    if (redis && redis.status === 'ready' && currentQuotaCount > 3) {
      try {
        await redis.decr(quotaKey);
      } catch (e) {
        // Ignore errors during refund operations.
      }
    }
    return res.status(429).json({
      error: 'Daily API key generation quota (max 3 keys/day) has been exceeded.'
    });
  }

  // ----------------------------------------
  // STEP 2: CREATE CRYPTOGRAPHICALLY SECURE KEY
  // ----------------------------------------
  try {
    // Generate a secure 24-byte random string, format as hex, prefix with 'ax_'.
    const rawKey = 'ax_' + crypto.randomBytes(24).toString('hex');

    // Instantiate Mongoose document.
    const newKey = new ApiKey({
      key: rawKey,
      userId: userId,
      // Default label to date string if not specified.
      name: name || `API Key ${new Date().toLocaleDateString()}`,
      rateLimit: {
        limit: limit ? parseInt(limit, 10) : 100, // Default 100 requests.
        windowMs: windowMs ? parseInt(windowMs, 10) : 60000 // Default 1 minute sliding window.
      }
    });

    // Save key document to MongoDB.
    await newKey.save();

    // Return the newly created key configuration to the client dashboard.
    return res.status(201).json({
      success: true,
      message: 'API Key generated successfully.',
      key: newKey
    });
  } catch (err) {
    console.error('❌ Error creating API key:', err);
    
    // Quota Refund: If database write fails, refund the user's daily token counter.
    if (redis && redis.status === 'ready') {
      try {
        await redis.decr(quotaKey);
      } catch (e) {}
    }
    return res.status(500).json({ error: 'Failed to generate API Key.' });
  }
});

// ============================================================================
// ENDPOINT 3: DELETE /api/keys/:id (REVOKE KEY & EVICT CACHE)
// ============================================================================
router.delete('/:id', async (req, res) => {
  try {
    const keyId = req.params.id;
    const userId = req.user.userId;

    // Search and delete matching ApiKey document in MongoDB.
    const keyDoc = await ApiKey.findOneAndDelete({ _id: keyId, userId });
    
    // If document is not found, return a 404 response.
    if (!keyDoc) {
      return res.status(404).json({ error: 'API key not found or unauthorized.' });
    }

    // ----------------------------------------
    // STEP 4: IMMEDIATE CACHE EVICTION
    // ----------------------------------------
    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const cacheKey = `apikey:${keyDoc.key}`;
      try {
        // Evict/delete metadata from Redis cache instantly to invalidate it globally.
        await redis.del(cacheKey);
      } catch (cacheErr) {
        console.error('⚠️ Failed to delete API key from Redis cache:', cacheErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'API key revoked and deleted successfully.'
    });
  } catch (err) {
    console.error('❌ Error deleting API key:', err);
    return res.status(500).json({ error: 'Failed to revoke API key.' });
  }
});

// Export key router.
module.exports = router;
