'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

function onLimitReached(req) {
  logger.warn('RATE_LIMIT_EXCEEDED', { ip: req.ip, path: req.path });
}

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded' },
  handler: (req, res, _next, options) => {
    onLimitReached(req);
    res.status(429).set('Retry-After', Math.ceil(options.windowMs / 1000)).json(options.message);
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Too many auth attempts' },
  handler: (req, res, _next, options) => {
    onLimitReached(req);
    res.status(429).set('Retry-After', Math.ceil(options.windowMs / 1000)).json(options.message);
  }
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests', message: 'Rate limit exceeded' },
  handler: (req, res, _next, options) => {
    onLimitReached(req);
    res.status(429).set('Retry-After', Math.ceil(options.windowMs / 1000)).json(options.message);
  }
});

module.exports = { globalLimiter, authLimiter, writeLimiter };
