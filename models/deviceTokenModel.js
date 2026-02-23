const mongoose = require('../src/db');

const deviceTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  fcmToken: {
    type: String,
    required: true,
  },
  platform: {
    type: String,
    enum: ['android', 'ios'],
    default: 'android',
  },
  deviceId: {
    type: String,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

deviceTokenSchema.index({ userId: 1, isActive: 1 });
deviceTokenSchema.index({ fcmToken: 1 }, { unique: true });

const DeviceToken = mongoose.models.DeviceToken || mongoose.model('DeviceToken', deviceTokenSchema);

module.exports = DeviceToken;
