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
  const suppliedApiKey = req.headers['x-api-key'] || req.query.apiKey || req.body.apiKey;

  if (!suppliedApiKey) {
    return res.status(401).json({ error: 'API key is missing.' });
  }

  const redisClient = getRedisClient();
  // Redis record #1: API-key metadata cache (a normal Redis string).
  // Example key: `apikey:ax_abc123`
  // Value: JSON containing the key's owner, name, request limit, and window.
  // This is NOT the request timestamp data used to enforce the rate limit.
  const apiKeyMetadataCacheKey = `apikey:${suppliedApiKey}`;

  if (redisClient && redisClient.status === 'ready') {
    try {
      const cachedApiKeyMetadata = await redisClient.get(apiKeyMetadataCacheKey);
      if (cachedApiKeyMetadata) {
        req.apiKeyMetadata = JSON.parse(cachedApiKeyMetadata);
        return next();
      }
  } catch (cacheReadError) {
    console.error('⚠️ Redis cache read error in API key auth, falling back to DB:', cacheReadError);
    }
  }

  try {
    const apiKeyDocument = await ApiKey.findOne({ key: suppliedApiKey, isActive: true });

    if (!apiKeyDocument) {
      return res.status(401).json({ error: 'Invalid or inactive API key.' });
    }

    const apiKeyMetadata = {
      key: apiKeyDocument.key,
      userId: apiKeyDocument.userId.toString(),
      name: apiKeyDocument.name,
      limit: apiKeyDocument.rateLimit.limit,
      windowMs: apiKeyDocument.rateLimit.windowMs
    };

    if (redisClient && redisClient.status === 'ready') {
      try {
        await redisClient.set(apiKeyMetadataCacheKey, JSON.stringify(apiKeyMetadata), 'EX', 3600);
      } catch (cacheErr) {
        console.error('⚠️ Failed to write API key cache to Redis:', cacheErr);
      }
    }

    req.apiKeyMetadata = apiKeyMetadata;
    next();
  } catch (err) {
    console.error('❌ Database error in API key auth:', err);
    return res.status(500).json({ error: 'Internal server error validating API key.' });
  }
};

module.exports = { verifyJWT, verifyApiKey };
