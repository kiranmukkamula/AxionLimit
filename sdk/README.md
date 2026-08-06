# axion-limit-sdk

> Drop-in Express middleware to integrate [AxionLimit](https://github.com/kiranmukkamula/AxionLimit) rate limiting into any Node.js app — in one line of code.

---

## How It Works

1. Go to the **AxionLimit dashboard** → generate an API key with your desired rate limit rules
2. Install this package in your own Express app
3. Add one `app.use(...)` line
4. Every request to your app is now rate-limited by AxionLimit's Redis-backed sliding window engine

All rate limiting logic runs **server-side** on AxionLimit — so you never need to update this package when new features are deployed.

---

## Install

```bash
npm install axion-limit-sdk
```

---

## Usage

```js
const express = require('express');
const axionLimit = require('axion-limit-sdk');

const app = express();

// Add AxionLimit middleware globally — protects all routes
app.use(axionLimit({
  apiKey:    'ax_your_key_here',                    // from AxionLimit dashboard
  serverUrl: 'https://your-axionlimit-server.com'   // your deployed AxionLimit backend
}));

app.get('/api/data', (req, res) => {
  res.json({ data: 'Hello!' });
});

app.listen(3000);
```

---

## Apply to Specific Routes Only

```js
const rateLimiter = axionLimit({
  apiKey:    'ax_your_key_here',
  serverUrl: 'https://your-axionlimit-server.com'
});

// Only protect this one route
app.get('/api/expensive-operation', rateLimiter, (req, res) => {
  res.json({ result: '...' });
});
```

---

## Response Headers

The SDK automatically sets these headers on every response:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-RetryAfter` | Seconds to wait before retrying (when blocked) |

---

## Behavior

| Scenario | What Happens |
|----------|-------------|
| Request within quota | `next()` called — request proceeds normally |
| Request over quota | `HTTP 429` returned with `retryAfter` seconds |
| AxionLimit server unreachable | Fails open — request proceeds with a console warning |

---

## Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `apiKey` | `string` | ✅ Yes | — | API key from AxionLimit dashboard |
| `serverUrl` | `string` | No | `http://localhost:5000` | Base URL of your AxionLimit server |


---

## Dashboard

All traffic routed through the SDK is visible in real-time on the **AxionLimit dashboard**:
- Live allowed / blocked request counts
- Top API key consumers
- Top endpoints by traffic
- Block rate percentage

---

## License

MIT
