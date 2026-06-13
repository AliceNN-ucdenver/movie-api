'use strict';

const { expect } = require('chai');

const Recommendation = require('../src/models/Recommendation');
const refreshService = require('../src/services/recommendationRefreshService');
const telemetry = require('../src/utils/recommendationTelemetry');
const { validateRecommendationQuery } = require('../src/middleware/validate');
const { getRecommendationsForUser } = require('../src/services/recommendationService');

describe('Recommendation contracts', () => {
  const originals = {};

  before(() => {
    originals.findOne = Recommendation.findOne;
    originals.updateOne = Recommendation.updateOne;
    originals.refreshRecommendationsForUser = refreshService.refreshRecommendationsForUser;
    originals.emitRecommendationServed = telemetry.emitRecommendationServed;
  });

  afterEach(() => {
    Recommendation.findOne = originals.findOne;
    Recommendation.updateOne = originals.updateOne;
    refreshService.refreshRecommendationsForUser = originals.refreshRecommendationsForUser;
    telemetry.emitRecommendationServed = originals.emitRecommendationServed;
    delete process.env.RECOMMENDATIONS_ENABLED;
    delete process.env.RECOMMENDATIONS_MAX_LIMIT;
    delete process.env.RECOMMENDATIONS_DEFAULT_LIMIT;
    delete process.env.RECOMMENDATIONS_CACHE_TTL_SECONDS;
  });

  it('validates recommendation query and strips userId overrides', () => {
    process.env.RECOMMENDATIONS_MAX_LIMIT = '50';
    process.env.RECOMMENDATIONS_DEFAULT_LIMIT = '20';

    const req = { query: { limit: '10', experimentArm: 'control', userId: 'query-user' }, body: { userId: 'body-user' }, path: '/recommendations' };
    const res = { status: () => ({ json: () => {} }) };
    let called = false;

    validateRecommendationQuery()(req, res, () => { called = true; });

    expect(called).to.equal(true);
    expect(req.query.limit).to.equal(10);
    expect(req.query).to.not.have.property('userId');
    expect(req.body).to.not.have.property('userId');
    expect(req.recommendationTampering).to.equal(true);
  });

  it('returns cached recommendation response shape', async () => {
    let telemetryCalled = false;
    telemetry.emitRecommendationServed = () => { telemetryCalled = true; };
    Recommendation.findOne = () => ({
      lean: async () => ({
        userId: '665f31a2e3e0a0f6c2bb1123',
        personalizationStatus: 'cold_start',
        modelVersion: 'item-cf-v1',
        generatedAt: new Date(),
        recommendations: [{ movieId: '665f31a2e3e0a0f6c2bb9981', score: 0.81, rationale: [{ type: 'cold_start_popularity', value: 'Top-rated this week' }] }]
      })
    });
    Recommendation.updateOne = async () => {};
    refreshService.refreshRecommendationsForUser = async () => { throw new Error('should not be called'); };

    const response = await getRecommendationsForUser({ userId: '665f31a2e3e0a0f6c2bb1123', limit: 5, experimentArm: 'control' });

    expect(response.subject).to.equal('665f31a2e3e0a0f6c2bb1123');
    expect(response.source).to.equal('cache');
    expect(response.personalizationStatus).to.equal('cold_start');
    expect(response.data[0]).to.have.keys(['movieId', 'score', 'personalizationStatus', 'rationale']);
    expect(telemetryCalled).to.equal(true);
  });

  it('returns 503 dependency error when cache missing and refresh fails', async () => {
    process.env.RECOMMENDATIONS_CACHE_TTL_SECONDS = '21600';
    Recommendation.findOne = () => ({ lean: async () => null });
    Recommendation.updateOne = async () => {};
    refreshService.refreshRecommendationsForUser = async () => { throw new Error('db down'); };
    telemetry.emitRecommendationServed = () => {};

    let caught;
    try {
      await getRecommendationsForUser({ userId: '665f31a2e3e0a0f6c2bb1123', limit: 5 });
    } catch (err) {
      caught = err;
    }

    expect(caught).to.be.instanceOf(Error);
    expect(caught.statusCode).to.equal(503);
    expect(caught.retryAfter).to.equal(60);
  });
});
