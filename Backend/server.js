const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { connectDB, mongoose, getRedisClient } = require('./config/db');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const apiKeyRoutes = require('./routes/apiKeys');
const rateLimitRoutes = require('./routes/rateLimit');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust reverse proxy (AWS Application Load Balancer) for accurate client IP detection
app.set('trust proxy', 1);

connectDB();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (curl/Postman), listed origins, or same-origin requests
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive fallback for testing
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Health Check Endpoint (used by AWS ALB Target Group)
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

// Server Info Endpoint (used to demonstrate ALB load balancing between EC2-1 and EC2-2)
app.get('/server-info', (req, res) => {
  res.json({
    server: process.env.EC2_SERVER_NAME || 'EC2-Local',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});


//3 mini routers initilzation
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
    console.log('HTTP server closed. Terminating active database connections...');
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('MongoDB connection closed.');
      }
      const redisClient = getRedisClient();
      if (redisClient && redisClient.status === 'ready') {
        await redisClient.quit();
        console.log('Redis connection closed.');
      }
      console.log('✅ Graceful shutdown completed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });

  // Force exit after 10-second safety timeout
  setTimeout(() => {
    console.error('⚠️ Forcefully terminating process after 10s shutdown timeout.');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = server;
