const Redis = require('ioredis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

async function clearCache() {
  const redis = new Redis(redisUrl);
  const clearAll = process.argv.includes('--all') || process.argv.includes('--flush');

  try {
    console.log('🔄 Connecting to Redis at:', redisUrl);

    if (clearAll) {
      await redis.flushdb();
      console.log('✅ FLUSHDB complete: Cleared all keys from Redis database.');
      return;
    }

    // Target patterns to clear
    const patterns = [
      'blacklist:*',
      'violations:*',
      'apikey:*',
      'apikey:id:*',
      'apikey_limit:*',
      'rate_limit:*'
    ];

    if (process.argv.includes('--telemetry')) {
      patterns.push('telemetry:*');
    }

    let totalDeleted = 0;
    const deletedKeys = [];

    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
        deletedKeys.push(...keys);
      }
    }

    console.log(`\n✅ Cleared ${totalDeleted} key(s) from Redis:`);
    if (deletedKeys.length > 0) {
      deletedKeys.forEach(k => console.log(`   - ${k}`));
    } else {
      console.log('   (No matching keys found to clear)');
    }

    const remainingKeys = await redis.keys('*');
    console.log(`\n📌 Remaining keys in Redis (${remainingKeys.length}):`);
    remainingKeys.forEach(k => console.log(`   - ${k}`));

  } catch (err) {
    console.error('❌ Failed to clear Redis cache:', err.message);
  } finally {
    await redis.quit();
    process.exit(0);
  }
}

clearCache();
