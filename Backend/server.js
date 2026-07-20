/**
 * ============================================================================
 * STEP 1: MODULE IMPORTS AND CONFIGURATION
 * ============================================================================
 * Here we load all required core libraries and configuration files.
 */

// Import Express: The fast, unopinionated, minimalist web framework for Node.js to manage HTTP requests.
const express = require('express');

// Import CORS (Cross-Origin Resource Sharing): Middleware to enable browser requests from other origins/domains.
const cors = require('cors');

// Import Path: Built-in Node.js module to manage and resolve filesystem paths utility securely across operating systems.
const path = require('path');

// Load environment variables from the `.env` file into `process.env` immediately at startup.
require('dotenv').config();

// Import database setup helper: Establishes connections to MongoDB (Mongoose) and Redis (ioredis).
const { connectDB } = require('./config/db');

// Import Passport configuration: Configures Google OAuth 2.0 strategies and hooks.
const passport = require('./config/passport');

/**
 * ============================================================================
 * STEP 2: ROUTE MODULE IMPORTS
 * ============================================================================
 * Import the route handlers that group our logical controller endpoints.
 */

// Auth routes: Manages OAuth authentication paths, token generation, and profile retrieval.
const authRoutes = require('./routes/auth');

// API Key management routes: Handles creation, retrieval, and revocation of API keys.
const apiKeyRoutes = require('./routes/apiKeys');

// Rate limiting evaluator & analytics: Processes `/check-limit` requests and telemetry queries.
const rateLimitRoutes = require('./routes/rateLimit');

/**
 * ============================================================================
 * STEP 3: INITIALIZE EXPRESS AND DATABASE CONNECTIONS
 * ============================================================================
 */

// Initialize our Express application instance.
const app = express();

// Determine the port: uses environment variables (e.g. for hosting platforms) or falls back to port 5000.
const PORT = process.env.PORT || 5000;

// Execute database connections asynchronously. This starts connection attempts for MongoDB and Redis.
connectDB();

/**
 * ============================================================================
 * STEP 4: GLOBAL MIDDLEWARES SETUP
 * ============================================================================
 */

// Enable CORS for all incoming requests, allowing external applications to query our rate limiting endpoints.
app.use(cors());

// Parse incoming requests with JSON payloads (essential for parsing raw JSON bodies in request objects).
app.use(express.json());

// Parse URL-encoded request bodies (useful when handling standard HTML form submissions).
app.use(express.urlencoded({ extended: true }));

/**
 * ============================================================================
 * STEP 5: INITIALIZE PASSPORT.JS
 * ============================================================================
 */

// Initialise passport authentication middleware for stateless OAuth workflows.
app.use(passport.initialize());

/**
 * ============================================================================
 * STEP 6: STATIC FILES AND COMPONENT ROUTING
 * ============================================================================
 */

// Serve any static client-side files (HTML, CSS, JS, Assets) located within the 'public' directory.
app.use(express.static(path.join(__dirname, 'public')));

// Mount Auth routes under the '/auth' namespace prefix (e.g., '/auth/google', '/auth/me').
app.use('/auth', authRoutes);

// Mount API Key administration endpoints under '/api/keys' (e.g., GET '/api/keys', POST '/api/keys').
app.use('/api/keys', apiKeyRoutes);

// Mount core rate limiting and telemetry routes under the general '/api' prefix.
app.use('/api', rateLimitRoutes);

/**
 * ============================================================================
 * STEP 7: FALLBACK / SINGLE PAGE APP (SPA) ROUTING
 * ============================================================================
 */

// Wildcard fallback: Redirect all unhandled GET paths back to the client-side SPA application entrypoint.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * ============================================================================
 * STEP 8: GLOBAL ERROR HANDLING MIDDLEWARE
 * ============================================================================
 * Express error-handling middleware is defined with 4 arguments: (err, req, res, next).
 * It catches any uncaught exceptions thrown inside async controllers or middleware.
 */
app.use((err, req, res, next) => {
  // Log the detailed error stack trace to the console.
  console.error('💥 Uncaught server error:', err);

  // Return a generic HTTP 500 Internal Server Error status code along with the message.
  res.status(500).json({
    error: 'Internal server error.',
    message: err.message
  });
});

/**
 * ============================================================================
 * STEP 9: BIND SERVER PORT AND LISTEN
 * ============================================================================
 */

// Bind the Express application to the configured network port.
const server = app.listen(PORT, () => {
  console.log(`🚀 AxionLimit rate limiter server running on port ${PORT}`);
});

// Export the running server instance for programmatic execution (e.g., our automated integration testing suites).
module.exports = server;
