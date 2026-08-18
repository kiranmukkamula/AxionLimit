const { getRedisClient } = require('../config/db');

// Redis records #4–#8: shared dashboard telemetry.
// - telemetry:total_requests     (counter)
// - telemetry:allowed_requests   (counter)
// - telemetry:blocked_requests   (counter)
// - telemetry:top_users          (sorted set: API-key name → request count)
// - telemetry:top_endpoints      (sorted set: endpoint → request count)

const getTelemetryKeys = () => {
  return {
    total: 'telemetry:total_requests',
    allowed: 'telemetry:allowed_requests',
    blocked: 'telemetry:blocked_requests',
    topUsers: 'telemetry:top_users',
    topEndpoints: 'telemetry:top_endpoints'
  };
};

const logAnalytics = async (identifier, endpoint, allowed) => {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') return;

  const keys = getTelemetryKeys();

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

    await pipeline.exec();
  } catch (err) {
    console.error('❌ Telemetry pipeline processing error:', err);
  }
};

const getStats = async () => {
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

  try {
    const [total, allowed, blocked] = await redis.mget(
      'telemetry:total_requests',
      'telemetry:allowed_requests',
      'telemetry:blocked_requests'
    );

    const topUsersRaw = await redis.zrevrange('telemetry:top_users', 0, 9, 'WITHSCORES');
    const topEndpointsRaw = await redis.zrevrange('telemetry:top_endpoints', 0, 9, 'WITHSCORES');

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

const resetStats = async () => {
  const redis = getRedisClient();
  if (!redis || redis.status !== 'ready') return;

  try {
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

module.exports = {
  logAnalytics,
  getStats,
  resetStats
};
