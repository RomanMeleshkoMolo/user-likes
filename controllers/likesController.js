const mongoose = require('mongoose');
const Like = require('../models/likeModel');
const User = require('../models/userModel');
const { sendNewLikeNotification } = require('../services/pushNotificationService');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { emitToUser } = require('../src/socketManager');

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-1',
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

async function getPhotoUrl(key) {
  if (!key) return null;
  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'molo-user-photos',
      Key: key,
    });
    return await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  } catch {
    return null;
  }
}

// Получить userId из запроса
function getReqUserId(req) {
  return (
    req.user?._id ||
    req.user?.id ||
    req.auth?.userId ||
    req.regUserId ||
    req.userId
  );
}

/**
 * GET /likes/incoming - Получить входящие лайки (кто лайкнул текущего пользователя)
 */
async function getIncomingLikes(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Получаем входящие лайки со статусом pending
    const likes = await Like.find({
      toUser: userObjectId,
      status: 'pending',
    })
      .sort({ createdAt: -1 })
      .lean();

    // Обогащаем данными о пользователях
    const enrichedLikes = await Promise.all(
      likes.map(async (like) => {
        const fromUser = await User.findById(like.fromUser)
          .select('name age userPhoto userLocation isOnline lastSeen')
          .lean();

        const photoKey = fromUser?.userPhoto?.[0]?.key || null;
        const photoUrl = await getPhotoUrl(photoKey);

        return {
          _id: like._id,
          fromUser: fromUser ? {
            _id: fromUser._id,
            name: fromUser.name,
            age: fromUser.age,
            photo: photoUrl,
            userLocation: fromUser.userLocation,
            isOnline: fromUser.isOnline || false,
          } : null,
          createdAt: like.createdAt,
        };
      })
    );

    // Фильтруем null (если пользователь удалён)
    const validLikes = enrichedLikes.filter(l => l.fromUser !== null);

    console.log(`[likes] getIncomingLikes for user ${userId}: found ${validLikes.length}`);

    return res.json({ likes: validLikes });
  } catch (e) {
    console.error('[likes] getIncomingLikes error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /likes/outgoing - Получить исходящие лайки (кого лайкнул текущий пользователь)
 */
async function getOutgoingLikes(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const likes = await Like.find({
      fromUser: userObjectId,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Обогащаем данными о пользователях
    const enrichedLikes = await Promise.all(
      likes.map(async (like) => {
        const toUser = await User.findById(like.toUser)
          .select('name age userPhoto userLocation isOnline lastSeen')
          .lean();

        return {
          _id: like._id,
          toUser: toUser ? {
            _id: toUser._id,
            name: toUser.name,
            age: toUser.age,
            photo: toUser.userPhoto?.[0]?.key || null,
            isOnline: toUser.isOnline || false,
          } : null,
          status: like.status,
          createdAt: like.createdAt,
        };
      })
    );

    const validLikes = enrichedLikes.filter(l => l.toUser !== null);

    console.log(`[likes] getOutgoingLikes for user ${userId}: found ${validLikes.length}`);

    return res.json({ likes: validLikes });
  } catch (e) {
    console.error('[likes] getOutgoingLikes error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /likes/matches - Получить взаимные лайки (матчи)
 */
async function getMatches(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Получаем все лайки со статусом accepted где пользователь участвует
    const likes = await Like.find({
      $or: [
        { fromUser: userObjectId, status: 'accepted' },
        { toUser: userObjectId, status: 'accepted' },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();

    // Обогащаем данными о втором пользователе
    const enrichedMatches = await Promise.all(
      likes.map(async (like) => {
        // Определяем кто второй участник
        const otherUserId = like.fromUser.toString() === userId.toString()
          ? like.toUser
          : like.fromUser;

        const otherUser = await User.findById(otherUserId)
          .select('name age userPhoto userLocation isOnline lastSeen')
          .lean();

        return {
          _id: like._id,
          otherUser: otherUser ? {
            _id: otherUser._id,
            name: otherUser.name,
            age: otherUser.age,
            photo: otherUser.userPhoto?.[0]?.key || null,
            isOnline: otherUser.isOnline || false,
          } : null,
          matchedAt: like.updatedAt,
        };
      })
    );

    const validMatches = enrichedMatches.filter(m => m.otherUser !== null);

    console.log(`[likes] getMatches for user ${userId}: found ${validMatches.length}`);

    return res.json({ matches: validMatches });
  } catch (e) {
    console.error('[likes] getMatches error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /likes/:userId - Поставить лайк пользователю
 */
async function likeUser(req, res) {
  try {
    const currentUserId = getReqUserId(req);
    const { userId: targetUserId } = req.params;

    if (!currentUserId || !mongoose.Types.ObjectId.isValid(String(currentUserId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(String(targetUserId))) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    if (currentUserId.toString() === targetUserId.toString()) {
      return res.status(400).json({ message: 'Cannot like yourself' });
    }

    const currentUserObjectId = new mongoose.Types.ObjectId(currentUserId);
    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    // Проверяем, что целевой пользователь существует
    const targetUser = await User.findById(targetUserObjectId).lean();
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Загружаем данные текущего пользователя (лайкера) для уведомления
    const currentUser = await User.findById(currentUserObjectId).lean();

    // Проверяем, есть ли уже лайк
    const existingLike = await Like.findOne({
      fromUser: currentUserObjectId,
      toUser: targetUserObjectId,
    });

    if (existingLike) {
      return res.json({
        success: true,
        message: 'Already liked',
        isMatch: existingLike.status === 'accepted',
      });
    }

    // Проверяем, есть ли встречный лайк (от целевого пользователя к текущему)
    const reverseLike = await Like.findOne({
      fromUser: targetUserObjectId,
      toUser: currentUserObjectId,
      status: 'pending',
    });

    let isMatch = false;

    if (reverseLike) {
      // Есть встречный лайк - это матч!
      // Обновляем встречный лайк как accepted
      reverseLike.status = 'accepted';
      reverseLike.updatedAt = new Date();
      await reverseLike.save();

      // Создаём наш лайк тоже как accepted
      await Like.create({
        fromUser: currentUserObjectId,
        toUser: targetUserObjectId,
        status: 'accepted',
      });

      isMatch = true;
      console.log(`[likes] MATCH! Users ${currentUserId} and ${targetUserId}`);
    } else {
      // Нет встречного лайка - создаём pending
      await Like.create({
        fromUser: currentUserObjectId,
        toUser: targetUserObjectId,
        status: 'pending',
      });
    }

    console.log(`[likes] User ${currentUserId} liked user ${targetUserId}, isMatch: ${isMatch}`);

    // Отправляем push-уведомление тому, кому поставили лайк (non-blocking)
    sendNewLikeNotification(targetUserObjectId, {
      _id: currentUserObjectId,
      name: currentUser?.name || '',
      userPhoto: currentUser?.userPhoto || [],
    }).catch((err) => console.error('[likes] Push notification error:', err));

    // Отправляем real-time уведомление через Socket.IO
    emitToUser(targetUserId, 'new_like', {
      fromUser: {
        _id: String(currentUserId),
        name: currentUser?.name || '',
      },
      isMatch,
    });

    return res.status(201).json({
      success: true,
      isMatch,
      matchedUser: isMatch ? {
        _id: targetUser._id,
        name: targetUser.name,
        photo: targetUser.userPhoto?.[0]?.key || null,
      } : null,
    });
  } catch (e) {
    // Обработка дубликата
    if (e.code === 11000) {
      return res.json({ success: true, message: 'Already liked', isMatch: false });
    }
    console.error('[likes] likeUser error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /likes/:likeId/accept - Принять лайк (взаимная симпатия)
 */
async function acceptLike(req, res) {
  try {
    const userId = getReqUserId(req);
    const { likeId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!likeId || !mongoose.Types.ObjectId.isValid(String(likeId))) {
      return res.status(400).json({ message: 'Invalid like id' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Находим лайк
    const like = await Like.findById(likeId);
    if (!like) {
      return res.status(404).json({ message: 'Like not found' });
    }

    // Проверяем, что лайк адресован текущему пользователю
    if (like.toUser.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Проверяем статус
    if (like.status !== 'pending') {
      return res.json({ success: true, message: 'Already processed' });
    }

    // Обновляем статус на accepted
    like.status = 'accepted';
    like.updatedAt = new Date();
    await like.save();

    // Создаём или обновляем встречный лайк
    await Like.findOneAndUpdate(
      { fromUser: userObjectId, toUser: like.fromUser },
      {
        fromUser: userObjectId,
        toUser: like.fromUser,
        status: 'accepted',
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Получаем данные о пользователе для ответа
    const matchedUser = await User.findById(like.fromUser)
      .select('name age userPhoto')
      .lean();

    console.log(`[likes] User ${userId} accepted like from ${like.fromUser}`);

    return res.json({
      success: true,
      isMatch: true,
      matchedUser: matchedUser ? {
        _id: matchedUser._id,
        name: matchedUser.name,
        photo: matchedUser.userPhoto?.[0]?.key || null,
      } : null,
    });
  } catch (e) {
    console.error('[likes] acceptLike error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * POST /likes/:likeId/reject - Отклонить лайк
 */
async function rejectLike(req, res) {
  try {
    const userId = getReqUserId(req);
    const { likeId } = req.params;

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!likeId || !mongoose.Types.ObjectId.isValid(String(likeId))) {
      return res.status(400).json({ message: 'Invalid like id' });
    }

    // Находим лайк
    const like = await Like.findById(likeId);
    if (!like) {
      return res.status(404).json({ message: 'Like not found' });
    }

    // Проверяем, что лайк адресован текущему пользователю
    if (like.toUser.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Обновляем статус на rejected
    like.status = 'rejected';
    like.updatedAt = new Date();
    await like.save();

    console.log(`[likes] User ${userId} rejected like from ${like.fromUser}`);

    return res.json({ success: true });
  } catch (e) {
    console.error('[likes] rejectLike error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

/**
 * GET /likes/count - Получить количество входящих лайков
 */
async function getLikesCount(req, res) {
  try {
    const userId = getReqUserId(req);

    if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const count = await Like.countDocuments({
      toUser: userObjectId,
      status: 'pending',
    });

    return res.json({ count });
  } catch (e) {
    console.error('[likes] getLikesCount error:', e);
    return res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getIncomingLikes,
  getOutgoingLikes,
  getMatches,
  likeUser,
  acceptLike,
  rejectLike,
  getLikesCount,
};
