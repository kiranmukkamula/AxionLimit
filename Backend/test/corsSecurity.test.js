const test = require('node:test');
const assert = require('node:assert/strict');

// Test the CORS options logic matching server.js exact origin specification
const evaluateCorsOrigin = (origin, frontendUrl = null) => {
  return new Promise((resolve, reject) => {
    if (!origin) {
      return resolve(true); // Allow non-browser requests
    }

    const allowedOrigins = new Set([
      'http://localhost:3000',
      'http://localhost:5173'
    ]);

    if (frontendUrl) {
      allowedOrigins.add(frontendUrl.replace(/\/+$/, ''));
    }

    if (allowedOrigins.has(origin)) {
      return resolve(true);
    }

    return reject(new Error(`Origin ${origin} not allowed by CORS policy`));
  });
};

test('CORS security: allows development origins exactly', async () => {
  assert.equal(await evaluateCorsOrigin('http://localhost:3000'), true);
  assert.equal(await evaluateCorsOrigin('http://localhost:5173'), true);
});

test('CORS security: allows non-browser requests with no Origin header', async () => {
  assert.equal(await evaluateCorsOrigin(undefined), true);
  assert.equal(await evaluateCorsOrigin(''), true);
});

test('CORS security: strictly rejects unauthorized external origins', async () => {
  await assert.rejects(
    async () => evaluateCorsOrigin('http://localhost:3000.attacker.com'),
    /not allowed by CORS policy/
  );
  await assert.rejects(
    async () => evaluateCorsOrigin('http://localhost:5173.evil.org'),
    /not allowed by CORS policy/
  );
  await assert.rejects(
    async () => evaluateCorsOrigin('https://malicious-site.com'),
    /not allowed by CORS policy/
  );
});

test('CORS security: allows configured FRONTEND_URL exactly and strips trailing slash', async () => {
  const frontendUrl = 'http://13.232.100.50/';
  assert.equal(await evaluateCorsOrigin('http://13.232.100.50', frontendUrl), true);
  await assert.rejects(
    async () => evaluateCorsOrigin('http://13.232.100.50.evil.com', frontendUrl),
    /not allowed by CORS policy/
  );
});
