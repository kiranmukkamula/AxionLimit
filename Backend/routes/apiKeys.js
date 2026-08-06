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
  const userId = req.user.userId;
  const { name, limit, windowMs } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  const quotaKey = `apikey_limit:${userId}:${today}`;
  const redis = getRedisClient();

  let quotaExceeded = false;
  let currentQuotaCount = 0;

  if (redis && redis.status === 'ready') {
    try {
      currentQuotaCount = await redis.incr(quotaKey);
      if (currentQuotaCount === 1) {
        await redis.expire(quotaKey, 86400);
      }
      if (currentQuotaCount > 3) {
        quotaExceeded = true;
      }
    } catch (err) {
      console.error('⚠️ Redis error checking key quota, falling back to DB:', err);
      const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
      const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
      const dbCount = await ApiKey.countDocuments({
        userId,
        createdAt: { $gte: startOfDay, $lte: endOfDay }
      });
      if (dbCount >= 3) quotaExceeded = true;
    }
  } else {
    console.warn('⚠️ Redis offline. Checking daily quota in MongoDB.');
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0));
    const endOfDay = new Date(new Date().setHours(23, 59, 59, 999));
    const dbCount = await ApiKey.countDocuments({
      userId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });
    if (dbCount >= 3) quotaExceeded = true;
  }

  if (quotaExceeded) {
    if (redis && redis.status === 'ready' && currentQuotaCount > 3) {
      try {
        await redis.decr(quotaKey);
      } catch (e) {}
    }
    return res.status(429).json({
      error: 'Daily API key generation quota (max 3 keys/day) has been exceeded.'
    });
  }

  try {
    const rawKey = 'ax_' + crypto.randomBytes(24).toString('hex');
    const newKey = new ApiKey({
      key: rawKey,
      userId: userId,
      name: name || `API Key ${new Date().toLocaleDateString()}`,
      rateLimit: {
        limit: limit ? parseInt(limit, 10) : 100,
        windowMs: windowMs ? parseInt(windowMs, 10) : 60000
      }
    });

    await newKey.save();

    return res.status(201).json({
      success: true,
      message: 'API Key generated successfully.',
      key: newKey
    });
  } catch (err) {
    console.error('❌ Error creating API key:', err);
    if (redis && redis.status === 'ready') {
      try {
        await redis.decr(quotaKey);
      } catch (e) {}
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

