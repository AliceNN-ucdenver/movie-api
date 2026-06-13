'use strict';

const Recommendation = require('../models/Recommendation');
const { loadRecommendationsConfig } = require('../config/recommendations');
const recommendationTelemetry = require('../utils/recommendationTelemetry');
const recommendationRefreshService = require('./recommendationRefreshService');

function isCacheFresh(cacheEntry, config) {
  if (!cacheEntry || !cacheEntry.generatedAt) return false;
  const ageMs = Date.now() - new Date(cacheEntry.generatedAt).getTime();
  return ageMs <= config.cacheTtlSeconds * 1000;
}

function buildResponse(subject, source, entry, limit) {
  const data = (entry.recommendations || []).slice(0, limit).map((item) => ({
    movieId: String(item.movieId),
    score: item.score,
    personalizationStatus: entry.personalizationStatus,
    rationale: item.rationale || []
  }));

  return {
    subject,
    personalizationStatus: entry.personalizationStatus,
    source,
    modelVersion: entry.modelVersion,
    data
  };
}

function recommendationDependencyError(message) {
  const err = new Error(message);
  err.name = 'RecommendationDependencyError';
  err.statusCode = 503;
  err.retryAfter = 60;
  return err;
}

async function getRecommendationsForUser(params) {
  const config = loadRecommendationsConfig();
  if (!config.enabled) throw recommendationDependencyError('Recommendations are currently disabled');

  const subject = String(params.userId);
  const limit = Math.min(params.limit || config.defaultLimit, config.maxLimit);

  let cacheEntry = await Recommendation.findOne({ userId: subject }).lean();
  let source = 'cache';
  let selected = cacheEntry;

  if (!isCacheFresh(cacheEntry, config) || (cacheEntry?.recommendations || []).length === 0) {
    try {
      selected = await recommendationRefreshService.refreshRecommendationsForUser(subject, {
        limit,
        experimentArm: params.experimentArm
      });
      source = 'fresh';
    } catch (_err) {
      if (!isCacheFresh(cacheEntry, config)) {
        throw recommendationDependencyError('Recommendations temporarily unavailable');
      }
      source = 'cache';
      selected = cacheEntry;
    }
  }

  const response = buildResponse(subject, source, selected, limit);
  const cacheAgeSeconds = selected.generatedAt
    ? Math.max(Math.floor((Date.now() - new Date(selected.generatedAt).getTime()) / 1000), 0)
    : 0;

  recommendationTelemetry.emitRecommendationServed({
    subject,
    modelVersion: response.modelVersion,
    personalizationStatus: response.personalizationStatus,
    source: response.source,
    experimentArm: params.experimentArm,
    itemCount: response.data.length,
    cacheAgeSeconds,
    tamperingAttempt: params.tamperingAttempt,
    rationale: response.data.flatMap((item) => item.rationale || []).slice(0, 5)
  });

  const telemetryField = source === 'cache' ? 'cacheHits' : 'cacheMisses';
  await Recommendation.updateOne(
    { userId: subject },
    {
      $inc: { [`telemetry.${telemetryField}`]: 1 },
      $set: { 'telemetry.lastServedAt': new Date() }
    }
  ).catch(() => {});

  return response;
}

module.exports = { getRecommendationsForUser, isCacheFresh };
