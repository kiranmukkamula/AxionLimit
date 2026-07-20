// Import Mongoose: The object modeling tool (ODM) to interact structure-safely with MongoDB.
const mongoose = require('mongoose');

// Import ioredis: A robust, full-featured Redis client supporting clusters, pipelines, and Lua scripting.
const Redis = require('ioredis');

// Load env configuration variables if not already initialized in server entry point.
require('dotenv').config();

// Define fallback URIs in case environment configurations are missing.
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/axionlimit';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Declare a module-scoped variable to hold the active Redis connection instance.
let redisClient = null;

/**
 * ConnectDB connects to MongoDB and Redis sequentially.
 * It registers lifecycle events to report connection states clearly.
 */
const connectDB = async () => {
  // ==========================================
  // PART 1: MONGODB CONFIGURATION & CONNECTION
  // ==========================================
  try {
    // Event listener triggered when Mongoose establishes a successful database connection.
    mongoose.connection.on('connected', () => {
      console.log('✅ MongoDB connected successfully.');
    });

    // Event listener triggered if MongoDB encounters an connection or operational error.
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    // Event listener triggered if MongoDB gets disconnected (e.g. server restart or network drop).
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ MongoDB disconnected.');
    });

    // Await the asynchronous database connection using the parsed URI configuration.
    await mongoose.connect(mongoUri);
  } catch (err) {
    // If the initial connection fails, log it and terminate the process to prevent running in an unstable state.
    console.error('❌ MongoDB initial connection failed:', err);
    process.exit(1);
  }

  // ==========================================
  // PART 2: REDIS CONFIGURATION & CONNECTION
  // ==========================================
  try {
    // Instantiate the Redis client using ioredis, passing target connection URL and options.
    redisClient = new Redis(redisUrl, {
      // Must set maxRetriesPerRequest to null if using BullMQ or similar structures; also avoids throwing unhandled errors immediately on retry thresholds.
      maxRetriesPerRequest: null,
      
      // Define a custom retry strategy: exponential backoff that limits max wait time to 2000 milliseconds (2 seconds).
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });

    // Event listener triggered once the Redis socket connection is established.
    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully.');
    });

    // Event listener triggered if the Redis socket encounters connection errors.
    redisClient.on('error', (err) => {
      console.error('❌ Redis connection error:', err);
    });

    // Event listener triggered when the connection is closed.
    redisClient.on('close', () => {
      console.warn('⚠️ Redis connection closed.');
    });

    // Event listener triggered when ioredis starts attempting to reconnect to the server.
    redisClient.on('reconnecting', (time) => {
      console.log(`🔄 Redis reconnecting: attempt in ${time}ms...`);
    });

  } catch (err) {
    // Log failures without process exit; AxionLimit has a fail-open rate limiting strategy to survive Redis failures.
    console.error('❌ Redis initial connection failed:', err);
  }
};

// Export connections, methods, and configurations.
module.exports = {
  // Method to establish the connections.
  connectDB,
  
  // Getter function to retrieve the active Redis client safely.
  getRedisClient: () => redisClient,
  
  // Setter function allowing test harnesses to mock or inject custom Redis configurations.
  setRedisClient: (client) => { redisClient = client; },
  
  // Expose Mongoose instance directly.
  mongoose
};
