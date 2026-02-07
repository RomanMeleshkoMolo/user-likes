const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/molo_users';

mongoose.connect(MONGO_URI)
  .then(() => console.log('[user-likes] MongoDB connected'))
  .catch((err) => console.error('[user-likes] MongoDB connection error:', err));

module.exports = mongoose;
