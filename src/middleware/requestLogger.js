'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const requestId = uuidv4();
  req.requestId = requestId;
  const start = Date.now();

  res.on('finish', () => {
    logger.info('HTTP_REQUEST', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime: Date.now() - start,
      userId: req.user ? req.user.userId : undefined,
      ip: req.ip
    });
  });
  next();
}

module.exports = { requestLogger };
