'use strict';

const logger = require('./logger');
const { stripHtml } = require('./sanitize');

function emitRecommendationServed(payload) {
  const eventName = process.env.METRIC_RECOMMENDATION_SERVED || 'recommendation_served_total';
  const telemetry = {
    event: eventName,
    subject: payload.subject,
    modelVersion: payload.modelVersion,
    personalizationStatus: payload.personalizationStatus,
    source: payload.source,
    experimentArm: payload.experimentArm,
    itemCount: payload.itemCount,
    cacheAgeSeconds: payload.cacheAgeSeconds,
    tamperingAttempt: payload.tamperingAttempt === true
  };

  if (Array.isArray(payload.rationale)) {
    telemetry.rationale = payload.rationale.map((entry) => ({
      type: entry.type,
      value: stripHtml(entry.value || '').slice(0, 120)
    }));
  }

  logger.info('RECOMMENDATION_SERVED', telemetry);
}

module.exports = { emitRecommendationServed };
