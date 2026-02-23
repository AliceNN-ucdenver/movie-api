'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');
const { authLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{12,}$/;

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid email address' });
    }
    if (!password || !PASSWORD_REGEX.test(password)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Password must be at least 12 characters with uppercase, lowercase, digit, and special character' });
    }
    if (displayName && (typeof displayName !== 'string' || displayName.length > 50)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Display name must be at most 50 characters' });
    }
    const user = new User({ email, passwordHash: password, displayName });
    await user.save();
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    user.refreshTokenHash = refreshToken;
    await user.save();
    logger.info('AUTH_REGISTER', { userId: user.id });
    res.status(201).json({ accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName } });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email ? email.toLowerCase() : '' }).select('+passwordHash');
    // Always run a hash comparison to prevent timing attacks on user enumeration
    const dummyHash = '$2b$12$invalidhashforunknownusers000000000000000000000000000';
    let isValid = false;
    if (user) {
      isValid = await user.comparePassword(password || '');
    } else {
      await bcrypt.compare(password || '', dummyHash).catch(() => false);
    }
    if (!user || !isValid) {
      logger.warn('AUTH_LOGIN_FAILURE', { ip: req.ip });
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken();
    user.refreshTokenHash = refreshToken;
    await user.save();
    logger.info('AUTH_LOGIN_SUCCESS', { userId: user.id, ip: req.ip });
    res.json({ accessToken, refreshToken, user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName } });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Unauthorized', message: 'Refresh token required' });
    const user = await User.findOne({ refreshTokenHash: refreshToken }).select('+refreshTokenHash');
    if (!user) {
      logger.warn('AUTH_TOKEN_REUSE_DETECTED', {});
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();
    user.refreshTokenHash = newRefreshToken;
    await user.save();
    logger.info('AUTH_TOKEN_REFRESH', { userId: user.id });
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const user = await User.findOne({ refreshTokenHash: refreshToken }).select('+refreshTokenHash');
      if (user) {
        user.refreshTokenHash = undefined;
        await user.save();
        logger.info('AUTH_LOGOUT', { userId: user.id });
      }
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
