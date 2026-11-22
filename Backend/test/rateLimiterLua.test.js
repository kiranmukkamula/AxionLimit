const test = require('node:test');
const assert = require('node:assert/strict');
const { SLIDING_WINDOW_LUA, isAllowed } = require('../services/rateLimiter');

test('rateLimiter Lua script: contains atomic 90-day TTL (7776000s) on all 5 telemetry keys', () => {
  assert.ok(SLIDING_WINDOW_LUA.includes('telemetryTTL = 7776000'));
  assert.ok(SLIDING_WINDOW_LUA.includes("redis.call('EXPIRE', tTotal, telemetryTTL)"));
  assert.ok(SLIDING_WINDOW_LUA.includes("redis.call('EXPIRE', tAllowed, telemetryTTL)"));
  assert.ok(SLIDING_WINDOW_LUA.includes("redis.call('EXPIRE', tBlocked, telemetryTTL)"));
  assert.ok(SLIDING_WINDOW_LUA.includes("redis.call('EXPIRE', tTopUsers, telemetryTTL)"));
  assert.ok(SLIDING_WINDOW_LUA.includes("redis.call('EXPIRE', tTopEndpoints, telemetryTTL)"));
});

test('rateLimiter Lua script: bounds sorted sets to top 100 members via ZREMRANGEBYRANK', () => {
  assert.ok(
    SLIDING_WINDOW_LUA.includes("redis.call('ZREMRANGEBYRANK', tTopUsers, 0, -101)"),
    'tTopUsers must prune ranks 0 to -101 to retain exactly top 100 entries'
  );
  assert.ok(
    SLIDING_WINDOW_LUA.includes("redis.call('ZREMRANGEBYRANK', tTopEndpoints, 0, -101)"),
    'tTopEndpoints must prune ranks 0 to -101 to retain exactly top 100 entries'
  );
});

test('rateLimiter: fails open gracefully with allowed: true when Redis is unavailable', async () => {
  // When Redis is not ready/connected, rate limiter must fail open to prevent downtime
  const result = await isAllowed('test-key-offline', 10, 60000);
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, 1);
  assert.equal(result.retryAfter, 0);
});
