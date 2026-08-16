const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { connectDB } = require('./config/db');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const apiKeyRoutes = require('./routes/apiKeys');
const rateLimitRoutes = require('./routes/rateLimit');

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());


app.use(express.static(path.join(__dirname, 'public')));
app.use('/auth', authRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api', rateLimitRoutes);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('💥 Uncaught server error:', err);
  res.status(500).json({
    error: 'Internal server error.',
    message: err.message
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 AxionLimit rate limiter server running on port ${PORT}`);
});

module.exports = server;