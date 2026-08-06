const mongoose = require('mongoose');

const ApiKeySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    default: 'Default API Key'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  rateLimit: {
    limit: {
      type: Number,
      default: 100
    },
    windowMs: {
      type: Number,
      default: 60000
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ApiKey', ApiKeySchema);

