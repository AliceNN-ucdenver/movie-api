'use strict';

const logger = require('../utils/logger');
const { loadRecommendationsConfig } = require('../config/recommendations');
const { refreshRecommendationBatch } = require('../services/recommendationRefreshService');

function createRecommendationRefreshJob() {
  const config = loadRecommendationsConfig();
  let timer = null;
  let status = 'idle';

  async function tick() {
    status = 'running';
    try {
      const refreshedCount = await refreshRecommendationBatch(config.refreshBatchSize);
      status = 'up';
      logger.info('RECOMMENDATION_REFRESH_COMPLETED', { refreshedCount });
    } catch (error) {
      status = 'degraded';
      logger.warn('RECOMMENDATION_REFRESH_FAILED', { error: error.message });
    }
  }

  function start() {
    if (timer || !config.enabled) return;
    status = 'up';
    timer = setInterval(() => {
      void tick();
    }, config.refreshIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    status = 'stopped';
  }

  function getStatus() {
    return status;
  }

  return { start, stop, getStatus };
}

module.exports = { createRecommendationRefreshJob };
