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

function validateRecommendationQuery() {
  return (req, res, next) => {
    const defaultLimit = parseInt(process.env.RECOMMENDATIONS_DEFAULT_LIMIT || '20', 10);
    const maxLimit = parseInt(process.env.RECOMMENDATIONS_MAX_LIMIT || '50', 10);
    const limitRaw = req.query.limit;
    const limit = limitRaw == null ? defaultLimit : parseInt(limitRaw, 10);

    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
      logger.warn('VALIDATION_FAILURE', { param: 'limit', value: limitRaw, path: req.path });
      return res.status(400).json({ error: 'Bad Request', message: `limit must be an integer between 1 and ${maxLimit}` });
    }

    const allowedArms = ['control', 'personalized'];
    const experimentArm = req.query.experimentArm;
    if (experimentArm && !allowedArms.includes(experimentArm)) {
      logger.warn('VALIDATION_FAILURE', { param: 'experimentArm', value: experimentArm, path: req.path });
      return res.status(400).json({ error: 'Bad Request', message: 'experimentArm must be one of: control, personalized' });
    }

    req.query.limit = limit;
    if (!experimentArm) delete req.query.experimentArm;

    const hasQueryOverride = Object.prototype.hasOwnProperty.call(req.query, 'userId');
    const hasBodyOverride = req.body && Object.prototype.hasOwnProperty.call(req.body, 'userId');
    req.recommendationTampering = Boolean(hasQueryOverride || hasBodyOverride);
    if (hasQueryOverride) delete req.query.userId;
    if (hasBodyOverride) delete req.body.userId;

    next();
  };
}

module.exports = { validateObjectId, validatePagination, validateRecommendationQuery };
