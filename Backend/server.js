const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Enforce JWT_SECRET configuration in production mode
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET environment variable is missing in production mode. Exiting.');
  process.exit(1);
}

const { connectDB, mongoose, getRedisClient } = require('./config/db');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const apiKeyRoutes = require('./routes/apiKeys');
const rateLimitRoutes = require('./routes/rateLimit');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (Nginx container) for accurate client IP detection via req.ip
app.set('trust proxy', 1);

connectDB();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. server-to-server, cURL, Mobile apps) with no Origin header
    if (!origin) {
      return callback(null, true);
    }
    // Allow configured development or production frontend origins
    if (allowedOrigins.includes(origin) || allowedOrigins.some(o => origin.startsWith(o))) {
      return callback(null, true);
    }
    // Strictly block untrusted external browser origins
    return callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Health Check Endpoint (used by Docker Compose and external monitoring)
app.get('/health', (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const redisClient = getRedisClient();
  const redisStatus = redisClient && redisClient.status === 'ready' ? 'ready' : 'disconnected';

  const isHealthy = mongoStatus === 'connected' && redisStatus === 'ready';
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DOWN',
    server: process.env.EC2_SERVER_NAME || 'Local-Server',
    timestamp: new Date().toISOString(),
    services: {
      database: mongoStatus,
      redis: redisStatus
    }
  });
});

// Server Info Endpoint
app.get('/server-info', (req, res) => {
  res.json({
    server: process.env.EC2_SERVER_NAME || 'EC2-Local',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});

// Mini Routers Initialization
app.use('/auth', authRoutes);
app.use('/api/keys', apiKeyRoutes);
app.use('/api', rateLimitRoutes);

app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'AxionLimit Rate Limiting API',
    server: process.env.EC2_SERVER_NAME || 'EC2-Local',
    status: 'online'
  });
});

app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS policy')) {
    return res.status(403).json({ error: err.message });
  }
  console.error('💥 Uncaught server error:', err);
  res.status(500).json({
    error: 'Internal server error.',
    message: process.env.NODE_ENV === 'production' ? 'An internal error occurred.' : err.message
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 AxionLimit rate limiter server running on port ${PORT} [Node: ${process.env.EC2_SERVER_NAME || 'Local'}]`);
});

// Graceful Shutdown Handler
const shutdown = (signal) => {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    console.log('✔ HTTP server closed.');

    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close(false);
        console.log('✔ MongoDB connection closed.');
      }
    } catch (dbErr) {
      console.error('Error closing MongoDB connection:', dbErr);
    }

    try {
      const redisClient = getRedisClient();
      if (redisClient && redisClient.status === 'ready') {
        await redisClient.quit();
        console.log('✔ Redis connection closed.');
      }
    } catch (redisErr) {
      console.error('Error closing Redis connection:', redisErr);
    }

    console.log('AxionLimit process exiting cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ Forcefully terminating process after 10s timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
