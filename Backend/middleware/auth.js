const jwt = require('jsonwebtoken');
const ApiKey = require('../models/ApiKey');
const { getRedisClient } = require('../config/db');
const { hashApiKey, isExpired } = require('../services/apiKeySecurity');
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
  // Accept secrets only in a header so they are not placed in URLs or request bodies.
  const suppliedApiKey = req.headers['x-api-key'];

  if (!suppliedApiKey) {
    return res.status(401).json({ error: 'API key is missing.' });
  }

  const keyHash = hashApiKey(suppliedApiKey);
  const redisClient = getRedisClient();
  // Cache keys and values contain only the SHA-256 digest and non-secret metadata.
  const apiKeyMetadataCacheKey = `apikey:${keyHash}`;

  if (redisClient && redisClient.status === 'ready') {
    try {
      const cachedApiKeyMetadata = await redisClient.get(apiKeyMetadataCacheKey);
      if (cachedApiKeyMetadata) {
        const metadata = JSON.parse(cachedApiKeyMetadata);
        if (metadata.isActive && !isExpired(metadata.expiresAt)) {
          req.apiKeyMetadata = metadata;
          return next();
        }
        await redisClient.del(apiKeyMetadataCacheKey);
      }
  } catch (cacheReadError) {
    console.error('⚠️ Redis cache read error in API key auth, falling back to DB:', cacheReadError);
    }
  }

  try {
    const apiKeyDocument = await ApiKey.findOne({ keyHash, isActive: true });

    if (!apiKeyDocument || isExpired(apiKeyDocument.expiresAt)) {
      return res.status(401).json({ error: 'Invalid or inactive API key.' });
    }

    const apiKeyMetadata = {
      keyHash: apiKeyDocument.keyHash,
      userId: apiKeyDocument.userId.toString(),
      name: apiKeyDocument.name,
      limit: apiKeyDocument.rateLimit.limit,
      windowMs: apiKeyDocument.rateLimit.windowMs,
      isActive: apiKeyDocument.isActive,
      expiresAt: apiKeyDocument.expiresAt || null
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
