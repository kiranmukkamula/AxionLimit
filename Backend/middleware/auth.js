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
  const suppliedApiKey = req.headers['x-api-key'];
  const suppliedKeyId = req.headers['x-api-key-id'];

  if (!suppliedApiKey && !suppliedKeyId) {
    return res.status(401).json({ error: 'API key or Key ID is missing.' });
  }

  const redisClient = getRedisClient();

  // If Key ID was provided
  if (suppliedKeyId) {
    // Attempt JWT extraction if authorization header is present
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    let userIdFromJwt = null;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userIdFromJwt = decoded.userId;
        req.user = decoded;
      } catch (err) {
        // Token invalid, proceed without req.user filtering
      }
    }

    const apiKeyMetadataCacheKey = `apikey:id:${suppliedKeyId}`;
    if (redisClient && redisClient.status === 'ready') {
      try {
        const cached = await redisClient.get(apiKeyMetadataCacheKey);
        if (cached) {
          const metadata = JSON.parse(cached);
          if (metadata.isActive && !isExpired(metadata.expiresAt)) {
            req.apiKeyMetadata = metadata;
            return next();
          }
          await redisClient.del(apiKeyMetadataCacheKey);
        }
      } catch (cacheErr) {
        console.error('⚠️ Redis cache read error for key ID:', cacheErr);
      }
    }

    try {
      const query = { _id: suppliedKeyId, isActive: true };
      if (userIdFromJwt) query.userId = userIdFromJwt;
      const apiKeyDocument = await ApiKey.findOne(query);

      if (!apiKeyDocument || isExpired(apiKeyDocument.expiresAt)) {
        return res.status(401).json({ error: 'Invalid, inactive, or unauthorized API key.' });
      }

      const apiKeyMetadata = {
        keyHash: apiKeyDocument.keyHash || apiKeyDocument._id.toString(),
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
          console.error('⚠️ Failed to write API key ID cache to Redis:', cacheErr);
        }
      }

      req.apiKeyMetadata = apiKeyMetadata;
      return next();
    } catch (err) {
      console.error('❌ Database error in API key ID auth:', err);
      return res.status(500).json({ error: 'Internal server error validating API key.' });
    }
  }

  // Raw API Key provided
  const keyHash = hashApiKey(suppliedApiKey);
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
