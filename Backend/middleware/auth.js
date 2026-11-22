const jwt = require('jsonwebtoken');
const ApiKey = require('../models/ApiKey');
const { getRedisClient } = require('../config/db');
const { hashApiKey, isExpired } = require('../services/apiKeySecurity');
require('dotenv').config();

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable must be set in production mode.');
    }
    return 'dev-insecure-jwt-secret-do-not-use-in-production';
  }
  return secret;
};

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token is missing.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    next();
  } catch (err) {
    console.error('JWT Verification Error:', err.message);
    return res.status(401).json({ error: 'Access token is invalid or expired.' });
  }
};

const enforceIpRules = (metadata, clientIp) => {
  const { ipWhitelist = [], ipBlacklist = [] } = metadata;
  if (ipBlacklist.length > 0 && ipBlacklist.includes(clientIp)) {
    return { allowed: false, reason: 'IP_BLACK_LISTED', message: `Access denied. IP ${clientIp} is blacklisted.` };
  }
  if (ipWhitelist.length > 0 && !ipWhitelist.includes(clientIp)) {
    return { allowed: false, reason: 'IP_NOT_WHITELISTED', message: `Access denied. IP ${clientIp} is not in the allowed IP whitelist.` };
  }
  return { allowed: true };
};

const verifyApiKey = async (req, res, next) => {
  const suppliedApiKey = req.headers['x-api-key'];
  const suppliedKeyId = req.headers['x-api-key-id'];

  if (!suppliedApiKey && !suppliedKeyId) {
    return res.status(401).json({ error: 'API key or Key ID is missing.' });
  }

  // Security: Prioritize trusted Express req.ip (populated via Nginx reverse proxy with trust proxy = 1)
  // Do NOT allow untrusted external headers (e.g. x-user-ip, x-client-ip) to spoof IP addresses
  const clientIp = (
    req.ip ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  ).trim();
  req.clientIp = clientIp;

  const endUserId = (
    req.headers['x-user-id'] ||
    req.headers['x-client-user-id'] ||
    req.headers['x-identifier'] ||
    req.query?.userId ||
    req.query?.user_id ||
    req.query?.identifier ||
    req.body?.userId ||
    req.body?.user_id ||
    req.body?.identifier ||
    null
  );

  const redisClient = getRedisClient();

  if (redisClient && redisClient.status === 'ready') {
    try {
      const isGlobalIpBlacklisted = await redisClient.get(`blacklist:${clientIp}`);
      const isUserIpBlacklisted = endUserId ? await redisClient.get(`blacklist:${clientIp}:${endUserId}`) : null;

      if (isGlobalIpBlacklisted || isUserIpBlacklisted) {
        return res.status(403).json({
          allowed: false,
          error: 'IP_QUARANTINED',
          message: isUserIpBlacklisted
            ? `User account '${endUserId}' on IP ${clientIp} has been quarantined due to automated burst abuse. Please try again in 1 hour.`
            : `Your IP address ${clientIp} has been quarantined due to automated burst abuse. Please try again in 1 hour.`
        });
      }
    } catch (blacklistErr) {
      console.error('Redis blacklist check error:', blacklistErr);
    }
  }

  // If x-api-key-id is provided, require a valid JWT Bearer token and verify ownership
  if (suppliedKeyId) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Key ID authentication requires a valid Bearer token.' });
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret());
      req.user = decoded;
      const apiKeyDoc = await ApiKey.findOne({ _id: suppliedKeyId, userId: decoded.userId });
      if (!apiKeyDoc) {
        return res.status(401).json({ error: 'API key not found or not owned by user.' });
      }

      if (!apiKeyDoc.isActive) {
        return res.status(403).json({ error: 'API key is inactive.' });
      }

      if (apiKeyDoc.expiresAt && isExpired(apiKeyDoc.expiresAt)) {
        return res.status(403).json({ error: 'API key has expired.' });
      }

      const metadata = {
        id: apiKeyDoc._id,
        keyHash: apiKeyDoc.keyHash,
        name: apiKeyDoc.name,
        userId: apiKeyDoc.userId,
        isActive: apiKeyDoc.isActive,
        expiresAt: apiKeyDoc.expiresAt,
        limit: apiKeyDoc.rateLimit.limit,
        windowMs: apiKeyDoc.rateLimit.windowMs,
        ipWhitelist: apiKeyDoc.ipWhitelist,
        ipBlacklist: apiKeyDoc.ipBlacklist,
      };

      const ipCheck = enforceIpRules(metadata, clientIp);
      if (!ipCheck.allowed) {
        return res.status(403).json({ allowed: false, error: ipCheck.reason, message: ipCheck.message });
      }

      req.apiKeyMetadata = metadata;
      return next();
    } catch (tokenErr) {
      return res.status(401).json({ error: 'Invalid or expired authorization token for Key ID.' });
    }
  }

  // Raw API Key authentication via x-api-key header
  const keyHash = hashApiKey(suppliedApiKey);

  if (redisClient && redisClient.status === 'ready') {
    try {
      const cached = await redisClient.get(`apikey:${keyHash}`);
      if (cached) {
        const apiKeyMetadata = JSON.parse(cached);
        if (!apiKeyMetadata.isActive) {
          return res.status(403).json({ error: 'API key is inactive.' });
        }
        if (apiKeyMetadata.expiresAt && isExpired(apiKeyMetadata.expiresAt)) {
          return res.status(403).json({ error: 'API key has expired.' });
        }
        const ipCheck = enforceIpRules(apiKeyMetadata, clientIp);
        if (!ipCheck.allowed) {
          return res.status(403).json({ allowed: false, error: ipCheck.reason, message: ipCheck.message });
        }
        req.apiKeyMetadata = apiKeyMetadata;
        return next();
      }
    } catch (redisErr) {
      console.error('Redis API key cache error:', redisErr);
    }
  }

  try {
    const apiKeyDoc = await ApiKey.findOne({ keyHash });
    if (!apiKeyDoc) {
      return res.status(401).json({ error: 'Invalid API key provided.' });
    }
    if (!apiKeyDoc.isActive) {
      return res.status(403).json({ error: 'API key is inactive.' });
    }
    if (apiKeyDoc.expiresAt && isExpired(apiKeyDoc.expiresAt)) {
      return res.status(403).json({ error: 'API key has expired.' });
    }

    const apiKeyMetadata = {
      id: apiKeyDoc._id,
      keyHash: apiKeyDoc.keyHash,
      name: apiKeyDoc.name,
      userId: apiKeyDoc.userId,
      isActive: apiKeyDoc.isActive,
      expiresAt: apiKeyDoc.expiresAt,
      limit: apiKeyDoc.rateLimit.limit,
      windowMs: apiKeyDoc.rateLimit.windowMs,
      ipWhitelist: apiKeyDoc.ipWhitelist,
      ipBlacklist: apiKeyDoc.ipBlacklist,
    };

    const ipCheck = enforceIpRules(apiKeyMetadata, clientIp);
    if (!ipCheck.allowed) {
      return res.status(403).json({ allowed: false, error: ipCheck.reason, message: ipCheck.message });
    }

    if (redisClient && redisClient.status === 'ready') {
      try {
        await redisClient.setex(`apikey:${keyHash}`, 300, JSON.stringify(apiKeyMetadata));
      } catch (cacheSetErr) {
        console.error('Failed to cache API key in Redis:', cacheSetErr);
      }
    }

    req.apiKeyMetadata = apiKeyMetadata;
    return next();
  } catch (dbErr) {
    console.error('Database API key lookup error:', dbErr);
    return res.status(500).json({ error: 'Authentication service unavailable.' });
  }
};

module.exports = {
  verifyJWT,
  verifyApiKey,
  getJwtSecret,
  enforceIpRules
};
