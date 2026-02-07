const mongoose = require('../src/db');

const likeSchema = new mongoose.Schema({
  // Кто поставил лайк
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Кому поставлен лайк
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Статус лайка:
  // 'pending' - ожидает ответа
  // 'accepted' - взаимный лайк (match)
  // 'rejected' - отклонён
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
  },

  // Дата создания
  createdAt: {
    type: Date,
    default: Date.now,
  },

  // Дата обновления статуса
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Уникальный индекс - один лайк от пользователя к пользователю
likeSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });

// Индекс для быстрого поиска входящих лайков
likeSchema.index({ toUser: 1, status: 1, createdAt: -1 });

const Like = mongoose.models.Like || mongoose.model('Like', likeSchema);

module.exports = Like;
