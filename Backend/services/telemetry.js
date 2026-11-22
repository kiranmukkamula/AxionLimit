const { getRedisClient } = require('../config/db');

// Rolling retention period for telemetry keys: 90 days in seconds
const TELEMETRY_TTL_SECONDS = 90 * 86400;

// Maximum cardinality for top rankings sorted sets to prevent unbounded memory growth
const MAX_RANKINGS_ENTRIES = 100;

const getTelemetryKeys = (ownerUserId = 'global') => {
  const prefix = `telemetry:${ownerUserId || 'global'}`;
  return {
    total: `${prefix}:total_requests`,
    allowed: `${prefix}:allowed_requests`,
    blocked: `${prefix}:blocked_requests`,
    topUsers: `${prefix}:top_users`,
    topEndpoints: `${prefix}:top_endpoints`
  };
};

const logAnalytics = async (identifier, endpoint, allowed, ownerUserId = 'global') => {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') return;

  const keys = getTelemetryKeys(ownerUserId);

  try {
    const pipeline = redis.pipeline();

    pipeline.incr(keys.total);

    if (allowed) {
      pipeline.incr(keys.allowed);
    } else {
      pipeline.incr(keys.blocked);
    }

    const activeIdentifier = identifier || 'anonymous';
    const activeEndpoint = endpoint || '/unknown';

    pipeline.zincrby(keys.topUsers, 1, activeIdentifier);
    pipeline.zincrby(keys.topEndpoints, 1, activeEndpoint);

    // Bounded Retention: Retain only the top 100 members in sorted sets to prevent memory leaks from scanning/fuzzing
    pipeline.zremrangebyrank(keys.topUsers, 0, -(MAX_RANKINGS_ENTRIES + 1));
    pipeline.zremrangebyrank(keys.topEndpoints, 0, -(MAX_RANKINGS_ENTRIES + 1));

    // Rolling TTL: Set 90-day retention on all keys so abandoned accounts expire and keys become evictable under volatile-lru
    pipeline.expire(keys.total, TELEMETRY_TTL_SECONDS);
    pipeline.expire(keys.allowed, TELEMETRY_TTL_SECONDS);
    pipeline.expire(keys.blocked, TELEMETRY_TTL_SECONDS);
    pipeline.expire(keys.topUsers, TELEMETRY_TTL_SECONDS);
    pipeline.expire(keys.topEndpoints, TELEMETRY_TTL_SECONDS);

    await pipeline.exec();
  } catch (err) {
    console.error('❌ Telemetry pipeline processing error:', err);
  }
};

const getStats = async (ownerUserId = 'global') => {
  const redis = getRedisClient();

  const emptyStats = {
    total: 0,
    allowed: 0,
    blocked: 0,
    topUsers: [],
    topEndpoints: []
  };

  if (!redis || redis.status !== 'ready') {
    return emptyStats;
  }

  const keys = getTelemetryKeys(ownerUserId);

  try {
    const [total, allowed, blocked] = await redis.mget(
      keys.total,
      keys.allowed,
      keys.blocked
    );

    const topUsersRaw = await redis.zrevrange(keys.topUsers, 0, 9, 'WITHSCORES');
    const topEndpointsRaw = await redis.zrevrange(keys.topEndpoints, 0, 9, 'WITHSCORES');

    const parseSortedSet = (rawList) => {
      const result = [];
      for (let i = 0; i < rawList.length; i += 2) {
        result.push({
          name: rawList[i],
          value: parseInt(rawList[i + 1], 10)
        });
      }
      return result;
    };

    return {
      total: parseInt(total || 0, 10),
      allowed: parseInt(allowed || 0, 10),
      blocked: parseInt(blocked || 0, 10),
      topUsers: parseSortedSet(topUsersRaw),
      topEndpoints: parseSortedSet(topEndpointsRaw)
    };
  } catch (err) {
    console.error('❌ Telemetry stats fetch error:', err);
    return emptyStats;
  }
};

const resetStats = async (ownerUserId = 'global') => {
  const redis = getRedisClient();
  if (!redis || redis.status !== 'ready') return;

  const keys = getTelemetryKeys(ownerUserId);

  try {
    await redis.del(
      keys.total,
      keys.allowed,
      keys.blocked,
      keys.topUsers,
      keys.topEndpoints
    );
  } catch (err) {
    console.error('❌ Error resetting telemetry stats:', err);
  }
};

module.exports = {
  logAnalytics,
  getStats,
  resetStats
};
