// Import jsonwebtoken: Library to sign and verify stateless JWT session tokens.
const jwt = require('jsonwebtoken');

// Import the ApiKey Mongoose Model: Used as a fallback database source for validating API keys.
const ApiKey = require('../models/ApiKey');

// Import the database connection getter: Used to interact with the Redis cache client.
const { getRedisClient } = require('../config/db');

// Load environment configuration settings.
require('dotenv').config();

// Determine the secret key used to decrypt/verify JWT signatures securely.
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_axionlimit_key_12345!';

/**
 * Middleware: verifyJWT
 * Validates the caller's JSON Web Token passed inside request headers.
 * Protects control plane routes (like getting stats, deleting keys, etc.).
 */
const verifyJWT = (req, res, next) => {
  // Retrieve the Authorization header from the incoming request.
  const authHeader = req.headers['authorization'];
  
  // Extract token: Expects 'Bearer <token>'. Split by whitespace and grab index 1.
  const token = authHeader && authHeader.split(' ')[1];

  // If no token is provided in headers, exit early returning a 401 Unauthorized status.
  if (!token) {
    return res.status(401).json({ error: 'Access token is missing.' });
  }

  try {
    // Verify token validity against our secret key. This throws an error if token is expired/modified.
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach the decrypted user payload (e.g. userId, email) directly to the request object.
    req.user = decoded;
    
    // Proceed to the next middleware or final route controller handler.
    next();
  } catch (err) {
    // Log verification failures.
    console.error('JWT Verification Error:', err.message);
    
    // Return a 401 response letting the client know their session has expired or is invalid.
    return res.status(401).json({ error: 'Access token is invalid or expired.' });
  }
};

/**
 * Middleware: verifyApiKey
 * Optimizes API checking by looking up API Key metadata configuration inside Redis before querying MongoDB.
 * Reads API key from: Header, query parameters, or body parameters.
 */
const verifyApiKey = async (req, res, next) => {
  // Check the key presence in standard x-api-key header, query parameter, or JSON request body.
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || req.body.apiKey;

  // If the key is completely missing, return 401 Unauthorized immediately.
  if (!apiKey) {
    return res.status(401).json({ error: 'API key is missing.' });
  }

  // Get the active Redis connection instance.
  const redis = getRedisClient();
  
  // Build a distinct string key namespace pattern for caching this key's metadata.
  const cacheKey = `apikey:${apiKey}`;

  // ==========================================
  // STEP 1: REDIS CACHE LOOKUP
  // ==========================================
  if (redis && redis.status === 'ready') {
    try {
      // Query Redis cache for the key's metadata.
      const cachedData = await redis.get(cacheKey);
      
      // If cache hit is successful:
      if (cachedData) {
        // Parse the cached JSON configuration string.
        const metadata = JSON.parse(cachedData);
        
        // Attach metadata details (userId, request limits) to the request object.
        req.apiKeyMetadata = metadata;
        
        // Proceed instantly without querying MongoDB, eliminating database overhead.
        return next();
      }
    } catch (err) {
      // Log connection or reading errors, but do not fail; fallback to MongoDB cleanly.
      console.error('⚠️ Redis cache read error in API key auth, falling back to DB:', err);
    }
  }

  // ==========================================
  // STEP 2: CACHE MISS - MONGO DATABASE LOOKUP
  // ==========================================
  try {
    // Query MongoDB for the active API key configuration.
    const keyDoc = await ApiKey.findOne({ key: apiKey, isActive: true });
    
    // If key document doesn't exist, return a 401 Unauthorized response.
    if (!keyDoc) {
      return res.status(401).json({ error: 'Invalid or inactive API key.' });
    }

    // Map database properties into a structured metadata object.
    const metadata = {
      key: keyDoc.key,
      userId: keyDoc.userId.toString(),
      name: keyDoc.name,
      limit: keyDoc.rateLimit.limit,
      windowMs: keyDoc.rateLimit.windowMs
    };

    // ==========================================
    // STEP 3: WRITE BACK TO REDIS CACHE
    // ==========================================
    if (redis && redis.status === 'ready') {
      try {
        // Cache the metadata string inside Redis. 'EX', 3600 sets an absolute expiration of 1 hour (3600 seconds).
        await redis.set(cacheKey, JSON.stringify(metadata), 'EX', 3600);
      } catch (cacheErr) {
        // Log caching failures, but let request pass as metadata is already fetched.
        console.error('⚠️ Failed to write API key cache to Redis:', cacheErr);
      }
    }

    // Attach metadata configurations to the request.
    req.apiKeyMetadata = metadata;
    
    // Proceed to rate limiter controller.
    next();
  } catch (err) {
    // Log unexpected MongoDB connection/lookup failures.
    console.error('❌ Database error in API key auth:', err);
    
    // Return a 500 server error response.
    return res.status(500).json({ error: 'Internal server error validating API key.' });
  }
};

// Export both middlewares.
module.exports = {
  verifyJWT,
  verifyApiKey
};
