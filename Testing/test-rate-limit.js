#!/usr/bin/env node

/**
 * ============================================================================
 * AxionLimit Continuous Request & Rate Limiting Simulation Harness
 * ============================================================================
 * 
 * Flow:
 * 1. Authenticates via Developer Mock Login (`POST /auth/dev-login`)
 * 2. Retrieves or provisions an API Key (`/api/keys`)
 * 3. Streams continuous or concurrent burst requests to `/api/check-limit`
 * 4. Logs real-time evaluation: ALLOWED (200 OK) vs BLOCKED (429 Rate Limited)
 * 5. Prints comprehensive telemetry and sliding window metrics summary
 * ============================================================================
 */

// Colors for terminal output
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const MAGENTA = '\x1b[35m';

// Parse Command Line Arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

const TARGET_URL = (getArg('--target', process.env.TARGET_URL || 'http://localhost:5000')).replace(/\/+$/, '');
const MODE = getArg('--mode', args.includes('--burst') ? 'burst' : 'constant');
const IS_MOCK_MODE = args.includes('--mock');
const TOTAL_REQUESTS = parseInt(getArg('--count', '20'), 10);
const CUSTOM_LIMIT = parseInt(getArg('--limit', '5000'), 10);
const CUSTOM_WINDOW_MS = parseInt(getArg('--window', '60000'), 10);
const DELAY_MS = parseInt(getArg('--delay', TOTAL_REQUESTS > 100 ? '0' : '250'), 10);
const ENDPOINT_NAME = getArg('--endpoint', '/api/v1/orders/checkout');
const USER_ID = getArg('--user-id', 'client_usr_99');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`\n${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║           AxionLimit Rate Limiter - Traffic Simulation Harness        ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`${DIM}Target Server   :${RESET} ${BOLD}${IS_MOCK_MODE ? 'Local In-Memory Engine (--mock)' : TARGET_URL}${RESET}`);
  console.log(`${DIM}Execution Mode  :${RESET} ${YELLOW}${BOLD}${MODE.toUpperCase()}${RESET} ${MODE === 'burst' ? '(All sent concurrently)' : `(${DELAY_MS}ms interval)`}`);
  console.log(`${DIM}Total Requests  :${RESET} ${BOLD}${TOTAL_REQUESTS}${RESET}`);
  console.log(`${DIM}Target Endpoint :${RESET} ${CYAN}${ENDPOINT_NAME}${RESET}`);
  console.log(`${DIM}Client User ID  :${RESET} ${MAGENTA}${USER_ID}${RESET}`);
  console.log(`${CYAN}─────────────────────────────────────────────────────────────────────────${RESET}\n`);

  // --------------------------------------------------------------------------
  // STEP 1: Developer Mock Login
  // --------------------------------------------------------------------------
  console.log(`${BOLD}[Step 1/3] Authenticating via Developer Mock Mode...${RESET}`);
  let authToken = null;
  let devUser = null;

  if (IS_MOCK_MODE) {
    devUser = { name: 'Developer Mode Tester (Offline)', email: 'dev.tester@axionlimit.local' };
    authToken = 'mock_jwt_token_for_dry_run_simulation';
    console.log(`  ${GREEN}✔ Simulated Developer Mock Login:${RESET} ${BOLD}${devUser.name}${RESET}`);
    console.log(`  ${GREEN}✔ JWT Token acquired:${RESET} ${DIM}mock_token_dev_99999...${RESET}\n`);
  } else {
    try {
      const loginRes = await fetch(`${TARGET_URL}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!loginRes.ok) {
        throw new Error(`HTTP ${loginRes.status}: ${await loginRes.text()}`);
      }

      const loginData = await loginRes.json();
      authToken = loginData.token;
      devUser = loginData.user;
      console.log(`  ${GREEN}✔ Logged in as:${RESET} ${BOLD}${devUser.name}${RESET} (${devUser.email})`);
      console.log(`  ${GREEN}✔ JWT Token acquired:${RESET} ${DIM}${authToken.slice(0, 24)}...${RESET}\n`);
    } catch (err) {
      console.error(`\n${RED}${BOLD}❌ Failed to connect to server at ${TARGET_URL}${RESET}`);
      console.error(`${YELLOW}Error details:${RESET} ${err.message}`);
      console.error(`\n${YELLOW}Troubleshooting:${RESET}`);
      console.error(`  1. Make sure your backend server is running: ${BOLD}npm start --prefix Backend${RESET}`);
      console.error(`  2. Or point to a custom server using: ${BOLD}node Testing/test-rate-limit.js --target http://localhost:5000${RESET}`);
      console.error(`  3. Or run standalone mock simulation: ${BOLD}node Testing/test-rate-limit.js --mock${RESET}\n`);
      process.exit(1);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 2: Retrieve or Provision an API Key
  // --------------------------------------------------------------------------
  console.log(`${BOLD}[Step 2/3] Retrieving API Key metadata...${RESET}`);
  let activeKeyHeader = {};
  let keyInfo = null;

  if (IS_MOCK_MODE) {
    keyInfo = {
      name: 'High-Volume Simulation Key',
      limit: CUSTOM_LIMIT,
      windowMs: CUSTOM_WINDOW_MS,
      identifier: 'ax_mock_test_key_hash_123'
    };
    activeKeyHeader = { 'x-api-key': 'ax_mock_live_test_key' };
    console.log(`  ${GREEN}✔ Using API Key:${RESET} "${BOLD}${keyInfo.name}${RESET}"`);
    console.log(`  ${DIM}Rate Limit Rule :${RESET} ${CYAN}${BOLD}${keyInfo.limit} requests${RESET} per ${BOLD}${keyInfo.windowMs / 1000} seconds${RESET}\n`);
  } else {
    try {
      const listRes = await fetch(`${TARGET_URL}/api/keys`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      const listData = await listRes.json();
      const existingKeys = (listData.keys || []).filter(k => k.isActive);

      if (existingKeys.length > 0 && !args.includes('--limit')) {
        const selected = existingKeys[0];
        activeKeyHeader = { 'x-api-key-id': selected._id };
        keyInfo = {
          name: selected.name,
          limit: selected.rateLimit.limit,
          windowMs: selected.rateLimit.windowMs,
          identifier: selected.keyIdentifier || selected._id
        };
        console.log(`  ${GREEN}✔ Using existing active API Key:${RESET} "${BOLD}${keyInfo.name}${RESET}"`);
      } else {
        console.log(`  ${DIM}Provisioning a key with custom limit (${CUSTOM_LIMIT} req/${CUSTOM_WINDOW_MS / 1000}s)...${RESET}`);
        const createRes = await fetch(`${TARGET_URL}/api/keys`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: `Traffic Simulation Key (${CUSTOM_LIMIT})`,
            limit: CUSTOM_LIMIT,
            windowMs: CUSTOM_WINDOW_MS,
            environment: 'dev'
          })
        });

        const createData = await createRes.json();
        if (!createRes.ok) {
          throw new Error(createData.error || 'Failed to generate test API key');
        }

        activeKeyHeader = { 'x-api-key': createData.rawKey };
        keyInfo = {
          name: createData.key.name,
          limit: createData.key.rateLimit.limit,
          windowMs: createData.key.rateLimit.windowMs,
          identifier: createData.key.keyIdentifier
        };
        console.log(`  ${GREEN}✔ Created test API Key:${RESET} "${BOLD}${keyInfo.name}${RESET}"`);
      }

      console.log(`  ${DIM}Rate Limit Rule :${RESET} ${CYAN}${BOLD}${keyInfo.limit} requests${RESET} per ${BOLD}${keyInfo.windowMs / 1000} seconds${RESET}\n`);
    } catch (err) {
      console.error(`\n${RED}${BOLD}❌ Failed to acquire an API Key:${RESET} ${err.message}\n`);
      process.exit(1);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 3: Execute Continuous / Burst Traffic Stream
  // --------------------------------------------------------------------------
  console.log(`${BOLD}[Step 3/3] Sending ${TOTAL_REQUESTS} requests to /api/check-limit...${RESET}`);
  console.log(`${CYAN}┌───────┬────────────┬──────────────────┬───────────┬─────────────┬──────────────┐${RESET}`);
  console.log(`${CYAN}│ REQ # │ TIMESTAMP  │ STATUS           │ REMAINING │ RETRY AFTER │ RESULT       │${RESET}`);
  console.log(`${CYAN}├───────┼────────────┼──────────────────┼───────────┼─────────────┼──────────────┤${RESET}`);

  let allowedCount = 0;
  let blockedCount = 0;
  const startTime = Date.now();
  let mockZset = [];

  async function sendSingleRequest(reqNum) {
    const reqTimestamp = new Date().toISOString().split('T')[1].replace('Z', '');
    try {
      let isAllowed = false;
      let remaining = 0;
      let retryAfter = 0;

      if (IS_MOCK_MODE) {
        const now = Date.now();
        const clearBefore = now - keyInfo.windowMs;
        mockZset = mockZset.filter(item => item.score > clearBefore);
        const count = mockZset.length;

        if (count < keyInfo.limit) {
          mockZset.push({ score: now, member: `${now}:req_${reqNum}` });
          isAllowed = true;
          remaining = keyInfo.limit - count - 1;
          retryAfter = 0;
        } else {
          isAllowed = false;
          remaining = 0;
          const oldest = mockZset[0];
          retryAfter = oldest ? Math.ceil((oldest.score + keyInfo.windowMs - now) / 1000) : 1;
        }
      } else {
        const response = await fetch(`${TARGET_URL}/api/check-limit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...activeKeyHeader,
            'x-user-id': USER_ID,
            'x-endpoint': ENDPOINT_NAME,
            'x-client-ip': '198.51.100.42'
          },
          body: JSON.stringify({
            endpoint: ENDPOINT_NAME,
            userId: USER_ID
          })
        });

        const status = response.status;
        const data = await response.json();
        isAllowed = data.allowed === true && status === 200;
        remaining = data.remaining !== undefined ? data.remaining : (response.headers.get('x-ratelimit-remaining') || '0');
        retryAfter = data.retryAfter !== undefined ? data.retryAfter : (response.headers.get('x-ratelimit-reset') || '0');
      }

      if (isAllowed) {
        allowedCount++;
      } else {
        blockedCount++;
      }

      const numStr = String(reqNum).padStart(5, ' ');
      const statusBadge = isAllowed 
        ? `${GREEN}${BOLD}200 ALLOWED ${RESET}` 
        : `${RED}${BOLD}429 BLOCKED ${RESET}`;
      const remBadge = String(remaining).padStart(9, ' ');
      const retryBadge = `${String(retryAfter).padStart(9, ' ')}s`;
      const verdict = isAllowed
        ? `${GREEN}✅ PASS      ${RESET}`
        : `${RED}🚫 LIMITED   ${RESET}`;

      const isBoundary = (
        TOTAL_REQUESTS <= 50 ||
        reqNum <= 3 || 
        (reqNum >= keyInfo.limit - 2 && reqNum <= keyInfo.limit + 2) || 
        reqNum > TOTAL_REQUESTS - 2 ||
        (reqNum % 1000 === 0)
      );

      if (isBoundary) {
        console.log(`│ ${numStr} │ ${reqTimestamp} │ ${statusBadge} │ ${remBadge} │ ${retryBadge} │ ${verdict} │`);
      } else if (reqNum === 4 && keyInfo.limit > 8) {
        console.log(`│  ...  │   ...        │ ${DIM}[Streaming requests 4 to 999 under limit...]${RESET}          │         - │          -s │ ⚡ FAST STREAM│`);
      }

      return { reqNum, isAllowed, remaining, retryAfter };
    } catch (err) {
      blockedCount++;
      const numStr = String(reqNum).padStart(5, ' ');
      console.log(`│ ${numStr} │ ${reqTimestamp} │ ${RED}ERR FAILED    ${RESET} │         - │          -s │ 💥 ${err.message.slice(0, 9)} │`);
      return { reqNum, isAllowed: false, error: err.message };
    }
  }

  if (MODE === 'burst') {
    // Send all concurrent requests at the exact same instant using Promise.all
    const promises = Array.from({ length: TOTAL_REQUESTS }, (_, i) => sendSingleRequest(i + 1));
    await Promise.all(promises);
  } else {
    // Continuous sequential streaming with delay
    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      await sendSingleRequest(i);
      if (i < TOTAL_REQUESTS && DELAY_MS > 0) {
        await sleep(DELAY_MS);
      }
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`${CYAN}└───────┴────────────┴──────────────────┴───────────┴─────────────┴──────────────┘${RESET}\n`);

  // --------------------------------------------------------------------------
  // SUMMARY REPORT
  // --------------------------------------------------------------------------
  const blockPercentage = ((blockedCount / TOTAL_REQUESTS) * 100).toFixed(1);
  console.log(`${CYAN}${BOLD}╔═══════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║                         SIMULATION SUMMARY                            ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚═══════════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  ${DIM}Total Requests Executed :${RESET} ${BOLD}${TOTAL_REQUESTS}${RESET}`);
  console.log(`  ${DIM}Total Duration          :${RESET} ${BOLD}${durationSec} seconds${RESET}`);
  console.log(`  ${GREEN}✔ Requests Allowed (200):${RESET} ${GREEN}${BOLD}${allowedCount}${RESET}`);
  console.log(`  ${RED}🚫 Requests Blocked (429):${RESET} ${RED}${BOLD}${blockedCount}${RESET}`);
  console.log(`  ${YELLOW}📊 Rate-Limit Block Rate :${RESET} ${YELLOW}${BOLD}${blockPercentage}%${RESET}`);
  console.log(`${CYAN}─────────────────────────────────────────────────────────────────────────${RESET}`);

  console.log(`\n${BOLD}💡 What just happened inside Redis?${RESET}`);
  console.log(`  1. The first ${allowedCount} requests found quota available in the Sliding Window.`);
  console.log(`  2. Redis appended each allowed request timestamp into the Sorted Set:`);
  console.log(`     ${CYAN}Key: rate_limit:${keyInfo.identifier}:${USER_ID}${RESET}`);
  if (blockedCount > 0) {
    console.log(`  3. Once the limit (${keyInfo.limit}) was hit, the Lua script strictly returned ${RED}allowed = 0${RESET}.`);
    console.log(`  4. The ${blockedCount} rejected requests received accurate ${BOLD}retryAfter${RESET} countdown timers.`);
  }
  console.log(`  5. Old records outside the rolling window will automatically be pruned by ${CYAN}ZREMRANGEBYSCORE${RESET}.\n`);
}

main().catch(err => {
  console.error(`Unexpected fatal error:`, err);
  process.exit(1);
});
