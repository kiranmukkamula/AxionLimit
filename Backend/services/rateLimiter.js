const crypto = require('crypto');
const { getRedisClient } = require('../config/db');

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]
local activeIdentifier = ARGV[5]
local activeEndpoint = ARGV[6]

local clearBefore = now - window
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local count = redis.call('ZCARD', key)

local allowed = 0
local remaining = 0
local retryAfter = 0

if count < limit then
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)
    allowed = 1
    remaining = limit - count - 1
else
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    if #oldest > 0 then
        local oldest_score = tonumber(oldest[2])
        retryAfter = math.ceil((oldest_score + window - now) / 1000)
        if retryAfter < 1 then retryAfter = 1 end
    end
end

-- Telemetry Logging in the same atomic call (0 extra network roundtrips)
redis.call('INCR', 'telemetry:total_requests')
if allowed == 1 then
    redis.call('INCR', 'telemetry:allowed_requests')
else
    redis.call('INCR', 'telemetry:blocked_requests')
end
if activeIdentifier and activeIdentifier ~= '' then
    redis.call('ZINCRBY', 'telemetry:top_users', 1, activeIdentifier)
end
if activeEndpoint and activeEndpoint ~= '' then
    redis.call('ZINCRBY', 'telemetry:top_endpoints', 1, activeEndpoint)
end

return {allowed, remaining, retryAfter}
`;

let isScriptRegistered = false;

const registerRateLimitCommand = (redis) => {
  if (!isScriptRegistered) {
    redis.defineCommand('checkRateLimit', {
      numberOfKeys: 1,
      lua: SLIDING_WINDOW_LUA
    });
    isScriptRegistered = true;
  }
};

const isAllowed = async (identifier, limit, windowMs, userId = null, activeUserLabel = null, endpoint = null) => {
  const redis = getRedisClient(); //get the instance of redis first

  if (!redis || redis.status !== 'ready') {
    console.error('⚠️ Redis client is not ready. Failing open to prevent downtime.');
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }

  try {
    registerRateLimitCommand(redis); //register the command first to call function

    const now = Date.now();
    const member = `${now}:${crypto.randomBytes(8).toString('hex')}`;
    const key = userId ? `rate_limit:${identifier}:${userId}` : `rate_limit:${identifier}`;

    const [allowedStatus, remaining, retryAfter] = await redis.checkRateLimit(
      key,
      limit,
      windowMs,
      now,
      member,
      activeUserLabel || identifier || 'anonymous',
      endpoint || '/api/default'
    );

    return {
      allowed: allowedStatus === 1,
      remaining: parseInt(remaining, 10),
      retryAfter: parseInt(retryAfter, 10)
    };
  } catch (err) {
    console.error(`❌ Redis rate limiter error for '${identifier}', failing open:`, err);
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
};

module.exports = {
  isAllowed
};

