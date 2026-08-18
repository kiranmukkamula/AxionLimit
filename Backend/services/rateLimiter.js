const crypto = require('crypto');
const { getRedisClient } = require('../config/db');

const SLIDING_WINDOW_LUA = `
local rate_limit_sorted_set_key = KEYS[1]
local request_limit = tonumber(ARGV[1])
local window_duration_ms = tonumber(ARGV[2])
local request_timestamp_ms = tonumber(ARGV[3])
local request_member_id = ARGV[4]

local oldest_allowed_timestamp_ms = request_timestamp_ms - window_duration_ms
redis.call('ZREMRANGEBYSCORE', rate_limit_sorted_set_key, 0, oldest_allowed_timestamp_ms)
local requests_in_current_window = redis.call('ZCARD', rate_limit_sorted_set_key)

if requests_in_current_window < request_limit then
    redis.call('ZADD', rate_limit_sorted_set_key, request_timestamp_ms, request_member_id)
    redis.call('PEXPIRE', rate_limit_sorted_set_key, window_duration_ms)
    return {1, request_limit - requests_in_current_window - 1, 0}
else
    local oldest_request_with_score = redis.call('ZRANGE', rate_limit_sorted_set_key, 0, 0, 'WITHSCORES')
    local retry_after_seconds = 0
    if #oldest_request_with_score > 0 then
        local oldest_request_timestamp_ms = tonumber(oldest_request_with_score[2])
        retry_after_seconds = math.ceil((oldest_request_timestamp_ms + window_duration_ms - request_timestamp_ms) / 1000)
        if retry_after_seconds < 1 then retry_after_seconds = 1 end
    end
    return {0, 0, retry_after_seconds}
end
`;

let isScriptRegistered = false;

const registerRateLimitCommand = (redisClient) => {
  if (!isScriptRegistered) {
    redisClient.defineCommand('checkRateLimit', {
      numberOfKeys: 1,
      lua: SLIDING_WINDOW_LUA
    });
    isScriptRegistered = true;
  }
};

const isAllowed = async (apiKeyIdentifier, requestLimit, windowDurationMs) => {
  const redisClient = getRedisClient();

  if (!redisClient || redisClient.status !== 'ready') {
    console.error('⚠️ Redis client is not ready. Failing open to prevent downtime.');
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }

  try {
    registerRateLimitCommand(redisClient);

    const requestTimestampMs = Date.now();
    const requestMemberId = `${requestTimestampMs}:${crypto.randomBytes(8).toString('hex')}`;
    // Redis record #3: rate-limit request log (a Redis sorted set / ZSET).
    // Example key: `rate_limit:ax_abc123`
    // Every member is one request; its score is the request timestamp. This is
    // separate from `apikey:ax_abc123`, which only caches API-key metadata.
    const rateLimitSortedSetKey = `rate_limit:${apiKeyIdentifier}`;

    const [allowedStatus, remainingRequests, retryAfterSeconds] = await redisClient.checkRateLimit(
      rateLimitSortedSetKey,
      requestLimit,
      windowDurationMs,
      requestTimestampMs,
      requestMemberId
    );

    return {
      allowed: allowedStatus === 1,
      remaining: parseInt(remainingRequests, 10),
      retryAfter: parseInt(retryAfterSeconds, 10)
    };
  } catch (rateLimitError) {
    console.error(`❌ Redis rate limiter error for '${apiKeyIdentifier}', failing open:`, rateLimitError);
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
};

module.exports = {
  isAllowed
};
