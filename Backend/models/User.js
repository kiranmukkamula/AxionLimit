// Import Mongoose module: used to interface structure-safely with MongoDB.
const mongoose = require('mongoose');

// Define the User Schema describing MongoDB document shape.
const UserSchema = new mongoose.Schema({
  // googleId: Google unique profile identifier. Set to unique to index it for fast lookup queries.
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  // email: The user's primary email. Automatically lowercase and trim whitespace.
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  // name: The display name (displayName) of the user returned from OAuth profile.
  name: {
    type: String,
    required: true
  },
  // avatar: URL path pointing to user's Google avatar profile picture.
  avatar: {
    type: String
  },
  // createdAt: Timestamp recording user creation date. Defaults to current server time.
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compile and export the Schema as a Mongoose Model named 'User'.
module.exports = mongoose.model('User', UserSchema);
