const mongoose = require('../src/db');

// Модель пользователя для populate
const userSchema = new mongoose.Schema({
  name: { type: String },
  age: { type: Number },
  userPhoto: { type: Array, default: [] },
  userLocation: { type: String },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null },
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;