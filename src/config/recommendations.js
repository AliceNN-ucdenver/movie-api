'use strict';

function toInt(env, name, fallback, min = 1) {
  const raw = env[name];
  const parsed = raw == null ? fallback : parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return parsed;
}

function parseRefreshIntervalMs(cronValue) {
  const match = /^\\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/.exec(cronValue || '');
  if (!match) return 15 * 60 * 1000;
  const minutes = parseInt(match[1], 10);
  return Math.max(minutes, 1) * 60 * 1000;
}

function loadRecommendationsConfig(env = process.env) {
  return {
    enabled: (env.RECOMMENDATIONS_ENABLED || 'true') === 'true',
    defaultLimit: toInt(env, 'RECOMMENDATIONS_DEFAULT_LIMIT', 20),
    maxLimit: toInt(env, 'RECOMMENDATIONS_MAX_LIMIT', 50),
    minRatings: toInt(env, 'RECOMMENDATIONS_MIN_RATINGS', 3),
    modelVersion: env.RECOMMENDATIONS_MODEL_VERSION || 'item-cf-v1',
    cacheTtlSeconds: toInt(env, 'RECOMMENDATIONS_CACHE_TTL_SECONDS', 21600),
    refreshCron: env.RECOMMENDATIONS_REFRESH_CRON || '*/15 * * * *',
    refreshBatchSize: toInt(env, 'RECOMMENDATIONS_REFRESH_BATCH_SIZE', 200),
    fallbackGenreWindowDays: toInt(env, 'RECOMMENDATIONS_FALLBACK_GENRE_WINDOW_DAYS', 30),
    dependencyTimeoutMs: toInt(env, 'RECOMMENDATIONS_DEPENDENCY_TIMEOUT_MS', 150),
    refreshIntervalMs: parseRefreshIntervalMs(env.RECOMMENDATIONS_REFRESH_CRON || '*/15 * * * *')
  };
}

module.exports = { loadRecommendationsConfig, parseRefreshIntervalMs };
