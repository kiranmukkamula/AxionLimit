// Import the database helper to retrieve the active ioredis client.
const { getRedisClient } = require('../config/db');

/**
 * logAnalytics:
 * Records rate-limiting stats asynchronously in Redis using transactional command pipelines.
 * Runs in the background (fire-and-forget) to ensure telemetry latency does not block core API checks.
 */
const logAnalytics = async (identifier, endpoint, allowed) => {
  // Get active Redis client instance.
  const redis = getRedisClient();
  
  // If Redis is offline, fail silently to prevent rate limiter responses from hanging.
  if (!redis || redis.status !== 'ready') return;

  try {
    // Initialize a Redis command pipeline.
    // Pipelines batch multiple commands together and send them in a single network round-trip.
    const pipeline = redis.pipeline();

    // 1. Increment the overall total requests counter.
    pipeline.incr('telemetry:total_requests');
    
    // Increment specific counters based on status (allowed vs blocked).
    if (allowed) {
      pipeline.incr('telemetry:allowed_requests');
    } else {
      pipeline.incr('telemetry:blocked_requests');
    }

    // 2. Increment request frequencies using Sorted Sets (ZSET).
    // If identifier or endpoint is missing, default to mock values.
    const activeIdentifier = identifier || 'anonymous';
    const activeEndpoint = endpoint || '/unknown';
    
    // ZINCRBY syntax: ZINCRBY key increment member.
    // Increments the rank/score of user API Key and the request endpoint path by 1.
    pipeline.zincrby('telemetry:top_users', 1, activeIdentifier);
    pipeline.zincrby('telemetry:top_endpoints', 1, activeEndpoint);

    // Send the batched commands to Redis and await execution.
    await pipeline.exec();
  } catch (err) {
    // Log telemetry piping failures cleanly.
    console.error('❌ Telemetry pipeline processing error:', err);
  }
};

/**
 * getStats:
 * Retrieves compiled analytics and ranking leaderboards from Redis to display on the client dashboard.
 */
const getStats = async () => {
  // Get Redis client.
  const redis = getRedisClient();
  
  // Standard empty response format used when Redis is unavailable.
  const emptyStats = {
    total: 0,
    allowed: 0,
    blocked: 0,
    topUsers: [],
    topEndpoints: []
  };

  // Safe checks: if client is down, return default template stats.
  if (!redis || redis.status !== 'ready') {
    return emptyStats;
  }

  try {
    // Query overall totals. MGET retrieves multiple string values in one round-trip.
    const [total, allowed, blocked] = await redis.mget(
      'telemetry:total_requests',
      'telemetry:allowed_requests',
      'telemetry:blocked_requests'
    );

    // Fetch the top 10 ranked users and endpoints based on request count (highest score first).
    // ZREVRANGE: ZREVRANGE key start stop [WITHSCORES].
    // Fetches items from rank 0 to 9 in descending order with score values included.
    const topUsersRaw = await redis.zrevrange('telemetry:top_users', 0, 9, 'WITHSCORES');
    const topEndpointsRaw = await redis.zrevrange('telemetry:top_endpoints', 0, 9, 'WITHSCORES');

    /**
     * parseSortedSet:
     * Helper to transform flat ZSET arrays (e.g. ['endpointA', '5', 'endpointB', '2'])
     * into structured objects: [ { name: 'endpointA', value: 5 }, { name: 'endpointB', value: 2 } ].
     */
    const parseSortedSet = (rawList) => {
      const result = [];
      // Loop with step = 2 to capture pairs of name and value.
      for (let i = 0; i < rawList.length; i += 2) {
        result.push({
          name: rawList[i],
          value: parseInt(rawList[i + 1], 10)
        });
      }
      return result;
    };

    // Construct and return dashboard stats.
    return {
      total: parseInt(total || 0, 10),
      allowed: parseInt(allowed || 0, 10),
      blocked: parseInt(blocked || 0, 10),
      topUsers: parseSortedSet(topUsersRaw),
      topEndpoints: parseSortedSet(topEndpointsRaw)
    };
  } catch (err) {
    // Log failures and return empty stats to prevent API checker crashes.
    console.error('❌ Telemetry stats fetch error:', err);
    return emptyStats;
  }
};

/**
 * resetStats:
 * Flushes/deletes telemetry metrics from Redis.
 */
const resetStats = async () => {
  const redis = getRedisClient();
  if (!redis || redis.status !== 'ready') return;

  try {
    // Delete metrics keys.
    await redis.del(
      'telemetry:total_requests',
      'telemetry:allowed_requests',
      'telemetry:blocked_requests',
      'telemetry:top_users',
      'telemetry:top_endpoints'
    );
  } catch (err) {
    console.error('❌ Error resetting telemetry stats:', err);
  }
};

// Export telemetry methods.
module.exports = {
  logAnalytics,
  getStats,
  resetStats
};
