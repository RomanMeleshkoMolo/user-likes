const jwt = require('jsonwebtoken');

/**
 * Middleware для авторизации пользователей в likes service
 */
function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    console.warn('[auth] No token provided');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Проверяем наличие userId в токене
    const userId = payload.sub || payload.userId || payload.id;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid token: missing user id' });
    }

    // Проставляем req.user
    req.user = {
      id: userId,
      _id: userId,
      scope: payload.scope,
    };

    console.log('[auth] User authenticated:', userId);
    return next();
  } catch (e) {
    console.error('[auth] Token verification failed:', e.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
}

module.exports = { authRequired };
