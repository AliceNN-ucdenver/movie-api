'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');

describe('Rate Limiting', () => {
  it('auth rate limiter exports authLimiter', () => {
    const { authLimiter, globalLimiter, writeLimiter } = require('../../src/middleware/rateLimiter');
    expect(authLimiter).to.be.a('function');
    expect(globalLimiter).to.be.a('function');
    expect(writeLimiter).to.be.a('function');
  });

  it('health endpoint returns standard headers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).to.equal(200);
    // Rate limit headers should be present after hitting global limiter
    expect(res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit']).to.exist;
  });
});
