// Import Express: Web application framework for routing.
const express = require('express');

// Import Passport: Used to coordinate Google OAuth 2.0 requests.
const passport = require('passport');

// Import jsonwebtoken: Decrypts and signs JWT tokens returned to client application.
const jwt = require('jsonwebtoken');

// Import User MongoDB Model: Handles user queries and registration.
const User = require('../models/User');

// Import the verifyJWT middleware: Protects authenticated routes (like profile fetches).
const { verifyJWT } = require('../middleware/auth');

// Require the passport configuration file to execute Google Strategy setup blocks.
require('../config/passport'); 

// Create a new router instance to map auth-related REST endpoints.
const router = express.Router();

// Define JWT signature secret key.
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_axionlimit_key_12345!';

// Define client redirection URL.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5000';

/**
 * generateToken:
 * Generates a signed, secure stateless JWT payload for an authenticated user.
 * Payload maps the MongoDB user unique ID, email address, and display name.
 * Expires: Sets expiration threshold to 7 days ('7d').
 */
const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// ============================================================================
// ENDPOINT 1: GET /auth/google (OAUTH INITIALIZATION)
// ============================================================================
// Initiates the Google OAuth authorization flow. Requests profile details and email scope.
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// ============================================================================
// ENDPOINT 2: GET /auth/google/callback (OAUTH CALLBACK)
// ============================================================================
// Google redirects the client here after credentials check.
// If it fails, redirects back with query error parameter. Session is disabled because we use JWTs.
router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=oauth_failed', session: false }),
  (req, res) => {
    try {
      // Create a signed JWT token using Google Profile user properties.
      const token = generateToken(req.user);
      
      // Redirect browser back to the frontend page, passing the JWT inside a URL hash query prefix.
      res.redirect(`${FRONTEND_URL}/#token=${token}`);
    } catch (err) {
      // Log exceptions and redirect client back to UI landing with server error parameters.
      console.error('Callback token generation error:', err);
      res.redirect('/?error=server_error');
    }
  }
);

// ============================================================================
// ENDPOINT 3: POST /auth/dev-login (MOCK LOGIN WORKFLOW)
// ============================================================================
// Lets developers log in instantly for local development without configuring GCP secrets.
router.post('/dev-login', async (req, res) => {
  try {
    // Hardcoded unique Google ID value to isolate Developer mode testers inside MongoDB.
    const devGoogleId = 'mock_dev_google_id_99999';
    
    // Check if mock user is already registered in DB.
    let user = await User.findOne({ googleId: devGoogleId });
    
    // If mock user is not found, seed standard profile data.
    if (!user) {
      user = new User({
        googleId: devGoogleId,
        email: 'dev.tester@axionlimit.local',
        name: 'Developer Mode Tester',
        avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=Developer'
      });
      // Save user to MongoDB.
      await user.save();
    }

    // Generate valid session JWT token.
    const token = generateToken(user);
    
    // Return token and profile configurations.
    return res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar
      }
    });
  } catch (err) {
    // Catch database errors and report.
    console.error('❌ Developer login error:', err);
    return res.status(500).json({ error: 'Failed to authenticate developer.' });
  }
});

// ============================================================================
// ENDPOINT 4: GET /auth/me (PROFILE INGESTION)
// ============================================================================
// Retrieves user profile from DB using verifyJWT to validate req.user details.
router.get('/me', verifyJWT, async (req, res) => {
  try {
    // Find User by mapping the decrypted userId stored inside JWT.
    const user = await User.findById(req.user.userId);
    
    // If user deleted or missing in DB, return 404 response.
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    
    // Return user properties to the client dashboard.
    return res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar
    });
  } catch (err) {
    // Log unexpected errors.
    console.error('❌ Profile route error:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

// Export the routes router.
module.exports = router;
