'use strict';

const logger = require('../utils/logger');

function errorHandler(err, req, res, _next) {
  const requestId = req.requestId;
  const isDev = process.env.NODE_ENV !== 'production';

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'ValidationError') { statusCode = 400; message = err.message; }
  else if (err.name === 'CastError') { statusCode = 400; message = 'Invalid ID format'; }
  else if (err.code === 11000) { statusCode = 409; message = 'Duplicate key error'; }
  else if (err.name === 'JsonWebTokenError') { statusCode = 401; message = 'Invalid or expired token'; }
  else if (err.name === 'TokenExpiredError') { statusCode = 401; message = 'Invalid or expired token'; }

  if (statusCode >= 500) {
    logger.error('SERVER_ERROR', { requestId, error: err.message, stack: err.stack });
  } else {
    logger.warn('CLIENT_ERROR', { requestId, statusCode, message });
  }

  const response = {
    error: statusCode >= 500 ? 'Internal Server Error' : message,
    message: isDev && statusCode >= 500 ? message : (statusCode >= 500 ? 'An unexpected error occurred' : message),
    requestId
  };

  if (isDev && statusCode >= 500 && err.stack) {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

module.exports = { errorHandler };
