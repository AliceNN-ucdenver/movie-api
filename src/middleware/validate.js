'use strict';

const logger = require('../utils/logger');

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

function validateObjectId(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    if (!OBJECT_ID_REGEX.test(value)) {
      logger.warn('VALIDATION_FAILURE', { param: paramName, value, path: req.path });
      return res.status(400).json({ error: 'Bad Request', message: `Invalid ${paramName} format` });
    }
    next();
  };
}

function validatePagination(allowedSortFields = []) {
  return (req, _res, next) => {
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    if (isNaN(page) || page < 1) page = 1;
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;

    req.query.page = page;
    req.query.limit = limit;

    if (req.query.sort && allowedSortFields.length > 0) {
      const sortField = req.query.sort.replace(/^-/, '');
      if (!allowedSortFields.includes(sortField)) {
        req.query.sort = allowedSortFields[0];
      }
    }
    next();
  };
}

module.exports = { validateObjectId, validatePagination };
