const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { verifyApiKey, enforceIpRules } = require('../middleware/auth');
const { generateApiKey, hashApiKey } = require('../services/apiKeySecurity');

const TEST_SECRET = 'test-jwt-secret-for-security-tests-only-123456';
process.env.JWT_SECRET = TEST_SECRET;

test('auth middleware: rejects request when neither x-api-key nor x-api-key-id is provided', async () => {
  const req = {
    headers: {},
    query: { apiKey: 'ax_query_param_key' }, // query param must be ignored
    ip: '127.0.0.1'
  };
  let statusSet = null;
  let jsonSent = null;
  const res = {
    status: (code) => {
      statusSet = code;
      return {
        json: (data) => { jsonSent = data; }
      };
    }
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  await verifyApiKey(req, res, next);

  assert.equal(nextCalled, false, 'next() must NOT be called');
  assert.equal(statusSet, 401, 'Status must be 401 Unauthorized');
  assert.match(jsonSent.error, /API key or Key ID is missing/);
});

test('auth middleware: rejects x-api-key-id when no Bearer token is supplied', async () => {
  const req = {
    headers: {
      'x-api-key-id': '60d0fe4f5311236168a109ca'
    },
    ip: '127.0.0.1'
  };
  let statusSet = null;
  let jsonSent = null;
  const res = {
    status: (code) => {
      statusSet = code;
      return {
        json: (data) => { jsonSent = data; }
      };
    }
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  await verifyApiKey(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(statusSet, 401);
  assert.match(jsonSent.error, /Key ID authentication requires a valid Bearer token/);
});

test('auth middleware: rejects x-api-key-id when invalid Bearer token is provided', async () => {
  const req = {
    headers: {
      'x-api-key-id': '60d0fe4f5311236168a109ca',
      'authorization': 'Bearer invalid-garbage-token'
    },
    ip: '127.0.0.1'
  };
  let statusSet = null;
  let jsonSent = null;
  const res = {
    status: (code) => {
      statusSet = code;
      return {
        json: (data) => { jsonSent = data; }
      };
    }
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };

  await verifyApiKey(req, res, next);

  assert.equal(nextCalled, false);
  assert.equal(statusSet, 401);
  assert.match(jsonSent.error, /Invalid or expired authorization token for Key ID/);
});

test('auth middleware: prioritizes req.ip and ignores spoofed x-user-ip / x-client-ip', async () => {
  const ApiKey = require('../models/ApiKey');
  const originalFindOne = ApiKey.findOne;
  ApiKey.findOne = async () => null; // Mock immediate null return without DB timeout

  try {
    const req = {
      headers: {
        'x-api-key': 'ax_dummy_key_to_test_ip',
        'x-user-ip': '8.8.8.8',
        'x-client-ip': '1.1.1.1'
      },
      ip: '203.0.113.195'
    };
    let statusSet = null;
    const res = {
      status: (code) => {
        statusSet = code;
        return { json: () => {} };
      }
    };
    const next = () => {};

    await verifyApiKey(req, res, next);

    assert.equal(req.clientIp, '203.0.113.195', 'clientIp must strictly equal trusted req.ip');
  } finally {
    ApiKey.findOne = originalFindOne;
  }
});

test('enforceIpRules: blocks blacklisted IP with 403 reason', () => {
  const metadata = {
    ipWhitelist: [],
    ipBlacklist: ['198.51.100.22']
  };
  const resultBlocked = enforceIpRules(metadata, '198.51.100.22');
  assert.equal(resultBlocked.allowed, false);
  assert.equal(resultBlocked.reason, 'IP_BLACK_LISTED');

  const resultAllowed = enforceIpRules(metadata, '198.51.100.23');
  assert.equal(resultAllowed.allowed, true);
});

test('enforceIpRules: blocks non-whitelisted IP when whitelist is configured', () => {
  const metadata = {
    ipWhitelist: ['203.0.113.50'],
    ipBlacklist: []
  };
  const resultBlocked = enforceIpRules(metadata, '203.0.113.51');
  assert.equal(resultBlocked.allowed, false);
  assert.equal(resultBlocked.reason, 'IP_NOT_WHITELISTED');

  const resultAllowed = enforceIpRules(metadata, '203.0.113.50');
  assert.equal(resultAllowed.allowed, true);
});
