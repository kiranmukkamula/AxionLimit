// Import Passport: The central authentication middleware library for Node.js.
const passport = require('passport');

// Import Google OAuth 2.0 Strategy class from passport-google-oauth20 package.
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// Import the Mongoose User Model: Used to search or write user profiles inside MongoDB.
const User = require('../models/User');

// Load environment configurations.
require('dotenv').config();

// Extract Google OAuth credentials from the environment configurations.
const clientID = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL = process.env.GOOGLE_CALLBACK_URL;

// Safety check: warn the developer if GCP client credentials are missing or default to dummy inputs.
if (!clientID || clientID === 'dummy-client-id') {
  console.warn('⚠️ Google OAuth Client ID is not configured. Google login will not function. Use the mock login option on the dashboard for testing.');
}

/**
 * Configure Passport to use the Google OAuth 2.0 Strategy.
 */
passport.use(
  new GoogleStrategy(
    {
      // Pass the Client ID. If not defined, fallback to a dummy template string to prevent initialization crashes.
      clientID: clientID || 'dummy-client-id.apps.googleusercontent.com',
      // Pass the Client Secret. Fallback to a dummy secret.
      clientSecret: clientSecret || 'dummy-client-secret',
      // The redirection URL that Google calls after user approves the consent screen.
      callbackURL: callbackURL || 'http://localhost:5000/auth/google/callback',
      // Enable passing the incoming HTTP request back to the callback verify function if needed.
      passReqToCallback: true
    },
    // The verify callback: Executed once the user is successfully authenticated by Google.
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        // Extract email safely from the returned Google profile structure.
        let email = 'no-email@google.com';
        if (profile.emails && profile.emails.length > 0) {
          email = profile.emails[0].value;
        }

        // 1. Search MongoDB to see if this Google User exists.
        let user = await User.findOne({ googleId: profile.id });
        
        // 2. If the user does not exist, initialize and save a new user record.
        if (!user) {
          user = new User({
            googleId: profile.id,
            email: email,
            name: profile.displayName,
            // Extract the user's Google avatar photo if available.
            avatar: profile.photos && profile.photos.length > 0 ? profile.photos[0].value : ''
          });
          // Save user record to MongoDB database.
          await user.save();
        }
        
        // Return the authenticated user object to passport.
        return done(null, user);
      } catch (err) {
        // Log errors and bubble them up to Passport.
        console.error('Error during Google Strategy authentication:', err);
        return done(err, null);
      }
    }
  )
);

/**
 * passport.serializeUser:
 * Determines which data of the user object should be stored in the session.
 * Since we are using stateless JSON Web Tokens (JWT) for authentication rather than cookies,
 * we keep the default passport stub configurations here.
 */
passport.serializeUser((user, done) => {
  done(null, user);
});

/**
 * passport.deserializeUser:
 * Retrieves user profiles based on serialized keys from requests.
 */
passport.deserializeUser((user, done) => {
  done(null, user);
});

// Export the configured passport instance.
module.exports = passport;
