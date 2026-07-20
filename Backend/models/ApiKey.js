// Import Mongoose module: used to model key configurations inside MongoDB.
const mongoose = require('mongoose');

// Define the API Key configuration schema.
const ApiKeySchema = new mongoose.Schema({
  // key: The raw generated random API Key string (prefixed with 'ax_').
  // Marked unique and indexed to optimize lookup speed.
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // userId: Links this API Key config to a specific User document.
  // ref: 'User' tells Mongoose which collection is referenced.
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // name: Custom display label (e.g. 'Staging Payment Gateway') to identify key usage.
  name: {
    type: String,
    required: true,
    default: 'Default API Key'
  },
  // isActive: Toggle flag to enable or instantly block/revoke access permissions.
  isActive: {
    type: Boolean,
    default: true
  },
  // rateLimit: Nested schema object containing the window metrics.
  rateLimit: {
    // limit: Request frequency limit inside the sliding window (defaults to 100 requests).
    limit: {
      type: Number,
      default: 100
    },
    // windowMs: The sliding window size in milliseconds (defaults to 60000ms/1 minute).
    windowMs: {
      type: Number,
      default: 60000
    }
  },
  // createdAt: Document registration timestamp.
  // expires: '60d' configures MongoDB's automatic TTL index.
  // MongoDB automatically deletes this key document after 60 days.
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '60d'
  }
});

// Compile and export the Schema as Mongoose Model 'ApiKey'.
module.exports = mongoose.model('ApiKey', ApiKeySchema);
