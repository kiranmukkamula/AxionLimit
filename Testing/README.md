# AxionLimit Testing & Traffic Simulation Harness

A lightweight test harness to simulate continuous traffic and burst attacks against the AxionLimit rate limiting service.

## Features

- **Automated Authentication**: Logs in automatically using Developer Mock Mode (`/auth/dev-login`).
- **Dynamic Key Discovery**: Automatically detects existing API keys or provisions a fresh test key.
- **Two Traffic Modes**:
  - **Constant Mode**: Streams requests continuously with a configurable interval (e.g. 250ms).
  - **Burst Mode**: Fires 20+ requests simultaneously using `Promise.all` to test concurrency and race condition protection.
- **Real-Time Visual Table**: Displays HTTP status, remaining quota, `retryAfter` timers, and verdicts for each request.
- **Zero External Dependencies**: Built with native Node.js `fetch` (requires Node 18+).

---

## How to Run

Make sure your backend server is running in another terminal:
```bash
npm start --prefix Backend
```

### 1. Run Default Constant Stream (20 requests, 250ms interval)
```bash
npm --prefix Testing start
```
or directly:
```bash
node Testing/test-rate-limit.js
```

### 2. Run Concurrent Burst Test (Simultaneous spam attack)
```bash
node Testing/test-rate-limit.js --mode burst --count 25
```

### 3. Customize Target Server or Endpoints
```bash
# Point to custom URL or AWS Application Load Balancer
node Testing/test-rate-limit.js --target http://localhost:5000 --count 30 --delay 100

# Test a specific end-user ID or endpoint
node Testing/test-rate-limit.js --user-id client_abc_123 --endpoint /api/v1/payments
```

---

## CLI Options

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--target <url>` | `http://localhost:5000` | Target server URL |
| `--mode <constant\|burst>` | `constant` | Stream continuously or fire all concurrently |
| `--count <number>` | `20` | Number of requests to send (e.g. 10000) |
| `--limit <number>` | `5000` | Rate limit threshold to enforce |
| `--window <ms>` | `60000` | Sliding window duration in milliseconds |
| `--delay <ms>` | `250` (or `0` for >100 req) | Delay between requests in constant mode |
| `--user-id <string>` | `client_usr_99` | End-user ID for per-user rate limiting |
| `--endpoint <string>` | `/api/v1/orders/checkout` | Target endpoint name |
