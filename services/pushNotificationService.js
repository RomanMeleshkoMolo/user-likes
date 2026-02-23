const admin = require('firebase-admin');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const DeviceToken = require('../models/deviceTokenModel');

// S3 для presigned URL фото
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'eu-central-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

async function getPhotoUrl(key) {
  if (!key) return null;
  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'molo-user-photos',
      Key: key,
    });
    return await getSignedUrl(s3, cmd, { expiresIn: 3600 });
  } catch (e) {
    console.error('[FCM-likes] getPhotoUrl error:', e.message);
    return null;
  }
}

// Firebase Admin SDK
let firebaseInitialized = false;

function initializeFirebase() {
  if (firebaseInitialized) return;
  try {
    if (!process.env.FIREBASE_PROJECT_ID) {
      console.warn('[FCM-likes] Firebase credentials not configured. Push notifications disabled.');
      return;
    }

    // Если приложение уже инициализировано — переиспользуем его
    if (admin.apps.length > 0) {
      firebaseInitialized = true;
      console.log('[FCM-likes] Reusing existing Firebase app');
      return;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });

    firebaseInitialized = true;
    console.log('[FCM-likes] Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('[FCM-likes] Failed to initialize Firebase:', error.message);
    // Если ошибка duplicate-app — приложение уже есть, можно использовать
    if (error.code === 'app/duplicate-app') {
      firebaseInitialized = true;
      console.log('[FCM-likes] Using existing Firebase app after duplicate-app error');
    }
  }
}

initializeFirebase();

/**
 * Отправить push-уведомление пользователю
 */
async function sendPushToUser(userId, notification) {
  if (!firebaseInitialized) {
    console.log('[FCM-likes] Firebase not initialized, skipping');
    return { success: false, reason: 'firebase_not_initialized' };
  }

  try {
    const tokens = await DeviceToken.find({ userId, isActive: true }).lean();
    console.log(`[FCM-likes] Found ${tokens.length} tokens for user ${userId}`);

    if (tokens.length === 0) {
      return { success: false, reason: 'no_tokens' };
    }

    const fcmTokens = tokens.map((t) => t.fcmToken);

    // Базовая структура сообщения — точно как в user-sms
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'molo_messages',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: notification.title,
              body: notification.body,
            },
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast({
      tokens: fcmTokens,
      ...message,
    });

    console.log(`[FCM-likes] Sent to user ${userId}: ${response.successCount}/${fcmTokens.length} successful`);

    // Деактивируем невалидные токены
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.log(`[FCM-likes] Token failed: ${resp.error?.code}`);
          const code = resp.error?.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            failedTokens.push(fcmTokens[idx]);
          }
        }
      });

      if (failedTokens.length > 0) {
        await DeviceToken.updateMany(
          { fcmToken: { $in: failedTokens } },
          { isActive: false, updatedAt: new Date() }
        );
        console.log(`[FCM-likes] Deactivated ${failedTokens.length} invalid tokens`);
      }
    }

    return { success: true, successCount: response.successCount };
  } catch (error) {
    console.error('[FCM-likes] sendPushToUser error:', error.message);
    return { success: false, reason: 'error', error: error.message };
  }
}

/**
 * Отправить уведомление о новом лайке
 * @param {string} recipientId - ID пользователя которому поставили лайк
 * @param {object} liker - { _id, name, userPhoto[] }
 */
async function sendNewLikeNotification(recipientId, liker) {
  console.log(`[FCM-likes] Sending like notification to ${recipientId} from ${liker._id}`);

  // Получаем presigned URL фото лайкера
  let photoUrl = '';
  if (liker.userPhoto?.length > 0) {
    const raw = liker.userPhoto[0];
    const key = typeof raw === 'object' ? raw?.key : raw;
    if (key) {
      photoUrl = (await getPhotoUrl(key)) || '';
    }
  }

  const notification = {
    title: 'Новый лайк ❤️',
    body: 'Тебе кто-то поставил лайк',
    data: {
      type: 'new_like',
      likerId: String(liker._id || ''),
      likerName: String(liker.name || ''),
      likerPhoto: photoUrl,
    },
  };

  return sendPushToUser(recipientId, notification);
}

module.exports = { sendNewLikeNotification };
