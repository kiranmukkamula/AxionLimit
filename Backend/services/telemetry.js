const { getRedisClient } = require('../config/db');

const logAnalytics = async (identifier, endpoint, allowed) => {
  const redis = getRedisClient();

  if (!redis || redis.status !== 'ready') return;

  try {
    const pipeline = redis.pipeline();

    pipeline.incr('telemetry:total_requests');

    if (allowed) {
      pipeline.incr('telemetry:allowed_requests');
    } else {
      pipeline.incr('telemetry:blocked_requests');
    }

    const activeIdentifier = identifier || 'anonymous';
    const activeEndpoint = endpoint || '/unknown';

    pipeline.zincrby('telemetry:top_users', 1, activeIdentifier);
    pipeline.zincrby('telemetry:top_endpoints', 1, activeEndpoint);

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

