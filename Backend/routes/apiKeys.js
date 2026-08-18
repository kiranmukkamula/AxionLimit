const express = require('express');
const crypto = require('crypto');
const ApiKey = require('../models/ApiKey');
const { verifyJWT } = require('../middleware/auth');
const { getRedisClient } = require('../config/db');

const router = express.Router();

router.use(verifyJWT);

router.get('/', async (req, res) => {
  try {
    const keys = await ApiKey.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, keys });
  } catch (err) {
    console.error('❌ Failed to retrieve API keys:', err);
    return res.status(500).json({ error: 'Failed to retrieve API keys.' });
  }
});

router.post('/', async (req, res) => {
  const authenticatedUserId = req.user.userId;
  const { name: apiKeyName, limit: requestedLimit, windowMs: requestedWindowMs } = req.body;
  const currentUtcDate = new Date().toISOString().slice(0, 10);
  // Redis record #2: per-user, per-day API-key creation counter.
  // Example key: `apikey_limit:developer-id:2026-08-17`
  // It limits a developer to three newly generated API keys per day.
  const dailyApiKeyCreationQuotaKey = `apikey_limit:${authenticatedUserId}:${currentUtcDate}`;
  const redisClient = getRedisClient();

  let quotaExceeded = false;
  let currentQuotaCount = 0;

  if (redisClient && redisClient.status === 'ready') {
    try {
      currentQuotaCount = await redisClient.incr(dailyApiKeyCreationQuotaKey);
      if (currentQuotaCount === 1) {
        const now = new Date();
        const endOfDay = new Date(now).setUTCHours(23, 59, 59, 999);
        const ttlSeconds = Math.max(1, Math.ceil((endOfDay - now) / 1000));
        await redisClient.expire(dailyApiKeyCreationQuotaKey, ttlSeconds);
      }
      if (currentQuotaCount > 3) {
        quotaExceeded = true;
      }
    } catch (err) {
      console.error('⚠️ Redis error checking key quota, falling back to DB:', err);
      const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
      const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
      const dbCount = await ApiKey.countDocuments({
        userId: authenticatedUserId,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      });
      if (dbCount >= 3) quotaExceeded = true;
    }
  }
  else {
    console.warn('⚠️ Redis offline. Checking daily quota in MongoDB.');
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
    const dbCount = await ApiKey.countDocuments({
      userId: authenticatedUserId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });
    if (dbCount >= 3) quotaExceeded = true;
  }

  if (quotaExceeded) {
    if (redisClient && redisClient.status === 'ready' && currentQuotaCount > 3) {
      try {
        await redisClient.decr(dailyApiKeyCreationQuotaKey);
      } catch (e) { }
    }
    return res.status(429).json({
      error: 'Daily API key generation quota (max 3 keys/day) has been exceeded.'
    });
  }

  try {
    const generatedApiKeyValue = 'ax_' + crypto.randomBytes(24).toString('hex');
    const apiKeyDocumentToCreate = new ApiKey({
      key: generatedApiKeyValue,
      userId: authenticatedUserId,
      name: apiKeyName || `API Key ${new Date().toLocaleDateString()}`,
      rateLimit: {
        limit: requestedLimit ? parseInt(requestedLimit, 10) : 100,
        windowMs: requestedWindowMs ? parseInt(requestedWindowMs, 10) : 60000
      }
    });

    await apiKeyDocumentToCreate.save();

    return res.status(201).json({
      success: true,
      message: 'API Key generated successfully.',
      key: apiKeyDocumentToCreate
    });
  } catch (err) {
    console.error('❌ Error creating API key:', err);
    if (redisClient && redisClient.status === 'ready') {
      try {
        await redisClient.decr(dailyApiKeyCreationQuotaKey);
      } catch (e) { }
    }
    return res.status(500).json({ error: 'Failed to generate API Key.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const keyId = req.params.id;
    const userId = req.user.userId;

    const keyDoc = await ApiKey.findOneAndDelete({ _id: keyId, userId });

    if (!keyDoc) {
      return res.status(404).json({ error: 'API key not found or unauthorized.' });
    }

    const redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      // Redis record #1 again: remove this key's metadata cache after revocation.
      const cacheKey = `apikey:${keyDoc.key}`;
      try {
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

module.exports = router;
