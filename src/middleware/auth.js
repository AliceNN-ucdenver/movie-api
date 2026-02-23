'use strict';

const { verifyAccessToken } = require('../utils/token');
const logger = require('../utils/logger');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { userId: payload.userId, email: payload.email, role: payload.role };
    next();
  } catch (_err) {
    logger.warn('Authentication failed', { path: req.path });
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };
