const jwt = require('jsonwebtoken');
const ApiKey = require('../models/ApiKey');
const { getRedisClient } = require('../config/db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_axionlimit_key_12345!';

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token is missing.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT Verification Error:', err.message);
    return res.status(401).json({ error: 'Access token is invalid or expired.' });
  }
};

const verifyApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body.apiKey;

  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing.' });
  }

  const redis = getRedisClient();
  const cacheKey = `apikey:${apiKey}`;

  if (redis && redis.status === 'ready') {
    try {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        req.apiKeyMetadata = JSON.parse(cachedData);
        return next();
      }
    } catch (err) {
      console.error('⚠️ Redis cache read error in API key auth, falling back to DB:', err);
    }
  }

  try {
    const keyDoc = await ApiKey.findOne({ key: apiKey, isActive: true });

    if (!keyDoc) {
      return res.status(401).json({ error: 'Invalid or inactive API key.' });
    }

    const metadata = {
      key: keyDoc.key,
      userId: keyDoc.userId.toString(),
      name: keyDoc.name,
      limit: keyDoc.rateLimit.limit,
      windowMs: keyDoc.rateLimit.windowMs
    };

    if (redis && redis.status === 'ready') {
      try {
        await redis.set(cacheKey, JSON.stringify(metadata), 'EX', 3600);
      } catch (cacheErr) {
        console.error('⚠️ Failed to write API key cache to Redis:', cacheErr);
      }
    }

    req.apiKeyMetadata = metadata;
    next();
  } catch (err) {
    console.error('❌ Database error in API key auth:', err);
    return res.status(500).json({ error: 'Internal server error validating API key.' });
  }
};

module.exports = {
  verifyJWT,
  verifyApiKey
};

