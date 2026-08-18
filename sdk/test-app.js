const express = require('express');
const axionLimit = require('./index');

const app = express();

const API_KEY = 'ax_311cc80e38d05ed1049ee3121f145910';

app.use(axionLimit({
  apiKey: API_KEY,
  serverUrl: 'http://localhost:5000'
}));

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

