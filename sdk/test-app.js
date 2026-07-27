/**
 * test-app.js — Simulates a developer's own Express app using axion-limit-sdk
 *
 * HOW TO USE:
 *  1. Start your AxionLimit backend:   cd ../Backend && npm run dev
 *  2. Go to dashboard → create an API key (e.g. 5 requests per 10 seconds)
 *  3. Paste the key into API_KEY below
 *  4. Run this file:                   node test-app.js
 *  5. Hit http://localhost:4000/api/weather repeatedly — watch it get blocked
 *  6. Open your AxionLimit dashboard  — see live traffic appear in real-time
 */

const express = require('express');
const axionLimit = require('./index'); // uses the local SDK (same as npm package after publishing)

const app = express();

// ─── PASTE YOUR KEY FROM THE AXIONLIMIT DASHBOARD HERE ───
const API_KEY = 'ax_paste_your_key_here';
// ─────────────────────────────────────────────────────────

// Apply AxionLimit middleware globally — every route below is now rate-limited
app.use(axionLimit({
  apiKey:    API_KEY,
  serverUrl: 'http://localhost:5000'  // your AxionLimit backend
}));

// Simulated developer routes
app.get('/api/weather', (req, res) => {
  res.json({ city: 'Hyderabad', temp: '32°C', status: '✅ Request allowed' });
});

app.get('/api/news', (req, res) => {
  res.json({ headline: 'Breaking news...', status: '✅ Request allowed' });
});

app.get('/api/stock', (req, res) => {
  res.json({ ticker: 'AAPL', price: '$189.30', status: '✅ Request allowed' });
});

app.listen(4000, () => {
  console.log('\n🚀 Developer test app running on http://localhost:4000');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Try these endpoints:');
  console.log('  GET http://localhost:4000/api/weather');
  console.log('  GET http://localhost:4000/api/news');
  console.log('  GET http://localhost:4000/api/stock');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Hit them fast to trigger rate limiting!');
  console.log('Then check your AxionLimit dashboard for live traffic 📊\n');
});
