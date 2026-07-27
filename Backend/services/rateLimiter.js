// Import the built-in Node.js crypto library for secure random string generation.
const crypto = require('crypto');

// Import the Redis database client getter function from our consolidated database config file.
const { getRedisClient } = require('../config/db');

/**
 * ============================================================================
 * REDIS LUA SCRIPT: ATOMIC SLIDING WINDOW RATE LIMITER
 * ============================================================================
 * A sliding window log counts request timestamps within a moving window.
 * Using a Lua script ensures the entire check runs atomically in Redis. 
 * This prevents race conditions where simultaneous requests slip through.
 */
const SLIDING_WINDOW_LUA = `
-- KEYS[1]: The Redis key namespace pattern identifying this client (e.g. rate_limit:ax_key_abc).
local key = KEYS[1]

-- ARGV[1]: The maximum request quota allowed within the window (e.g. 100 requests).
local limit = tonumber(ARGV[1])

-- ARGV[2]: The length of the sliding window interval in milliseconds (e.g. 60000ms).
local window = tonumber(ARGV[2])

-- ARGV[3]: The current epoch timestamp in milliseconds (Date.now()).
local now = tonumber(ARGV[3])

-- ARGV[4]: A unique string member containing the current timestamp and a random hash suffix.
local member = ARGV[4]

-- Step 1: Calculate the boundary score where the window starts.
-- Any request logged before this timestamp is expired and outside the current sliding window.
local clearBefore = now - window

-- Step 2: Prune old request records from the Sorted Set (ZSET) that are older than clearBefore.
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)

-- Step 3: Count the remaining valid request timestamps logged in the ZSET using ZCARD.
local count = redis.call('ZCARD', key)

-- Step 4: Evaluate rate limits.
if count < limit then
    -- Under limit: Log the current request timestamp by adding it to the ZSET.
    -- ZADD syntax: ZADD key score member. Here score = now, member = unique log entry string.
    redis.call('ZADD', key, now, member)
    
    -- Renew expiration TTL on the entire key to match the sliding window duration.
    -- This cleans up inactive keys from Redis memory automatically.
    redis.call('PEXPIRE', key, window)
    
    -- Return array format: { allowed (1=true), remaining requests count, retryAfter (0 seconds) }
    return {1, limit - count - 1, 0}
else
    -- Over limit: Read the oldest logged request in the ZSET to calculate how long to wait.
    -- ZRANGE key start stop WITHSCORES returns the oldest entry (index 0) and its score (timestamp).
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfter = 0
    
    if #oldest > 0 then
        -- Extract the score/timestamp of the oldest request.
        local oldest_score = tonumber(oldest[2])
        
        -- Calculate wait time in seconds: ceiled to the next integer.
        -- formula: (oldest_request_timestamp + window_duration - current_time) / 1000
        retryAfter = math.ceil((oldest_score + window - now) / 1000)
        
        -- Guarantee at least 1 second wait time.
        if retryAfter < 1 then retryAfter = 1 end
    end
    
    -- Return array format: { allowed (0=false), remaining requests (0), retryAfter wait time in seconds }
    return {0, 0, retryAfter}
end
`;

// Boolean flag to track if the custom Redis Lua script command has been registered in the client instance.
let isScriptRegistered = false;

/**
 * registerRateLimitCommand:
 * Registers the raw Lua script in Redis as a custom command named 'checkRateLimit'.
 * This optimizes speed by saving the script in Redis memory and running it via EVALSHA (SHA1 hashes).
 */
const registerRateLimitCommand = (redis) => {
  if (!isScriptRegistered) {
    redis.defineCommand('checkRateLimit', {
      numberOfKeys: 1, // Specifies KEYS[1] array size.
      lua: SLIDING_WINDOW_LUA // The Lua script content.
    });
    isScriptRegistered = true; // Mark as registered.
  }
};

/**
 * isAllowed:
 * Core helper that checks rate limits for an identifier.
 * Incorporates a Fail-Open design to protect server availability if Redis crashes.
 */
const isAllowed = async (identifier, limit, windowMs) => {
  // Retrieve the active Redis connection client.
  const redis = getRedisClient();

  // FAIL-OPEN: If Redis is offline or not ready, log the error but ALLOW the client request through.
  if (!redis || redis.status !== 'ready') {
    console.error('⚠️ Redis client is not ready. Failing open to prevent downtime.');
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }

  try {
    // Dynamically register the custom Lua script command on the active Redis client.
    registerRateLimitCommand(redis);

    // Get current Unix epoch timestamp in milliseconds.
    const now = Date.now();

    // Generate a unique member using a timestamp and secure random 8-byte hexadecimal suffix.
    // This guarantees that multiple requests fired in the same millisecond do not collide or overwrite in the Redis sorted set (ZSET).
    const member = `${now}:${crypto.randomBytes(8).toString('hex')}`;

    // Define the Redis key path for this rate limit log.
    const key = `rate_limit:${identifier}`;

    // Execute the custom atomic command we registered on the Redis client.
    const [allowedStatus, remaining, retryAfter] = await redis.checkRateLimit(key, limit, windowMs, now, member);

    // Format the response.
    return {
      allowed: allowedStatus === 1,
      remaining: parseInt(remaining, 10),
      retryAfter: parseInt(retryAfter, 10)
    };
  } catch (err) {
    // FAIL-OPEN FALLBACK: If command fails due to Redis timeout, syntax, or network errors, log and allow the request.
    console.error(`❌ Redis rate limiter error for '${identifier}', failing open:`, err);
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
};

// Export the primary rate limiter function.
module.exports = {
  isAllowed
};
