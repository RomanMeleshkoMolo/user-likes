const express = require('express');
const router = express.Router();

const { authRequired } = require('../middlewares/auth');
const {
  getIncomingLikes,
  getOutgoingLikes,
  getMatches,
  likeUser,
  acceptLike,
  rejectLike,
  getLikesCount,
} = require('../controllers/likesController');

// GET /likes/incoming - Получить входящие лайки
router.get('/likes/incoming', authRequired, getIncomingLikes);

// GET /likes/outgoing - Получить исходящие лайки
router.get('/likes/outgoing', authRequired, getOutgoingLikes);

// GET /likes/matches - Получить матчи
router.get('/likes/matches', authRequired, getMatches);

// GET /likes/count - Получить количество входящих лайков
router.get('/likes/count', authRequired, getLikesCount);

// POST /likes/:userId - Поставить лайк пользователю
router.post('/likes/:userId', authRequired, likeUser);

// POST /likes/:likeId/accept - Принять лайк
router.post('/likes/:likeId/accept', authRequired, acceptLike);

// POST /likes/:likeId/reject - Отклонить лайк
router.post('/likes/:likeId/reject', authRequired, rejectLike);

module.exports = router;
