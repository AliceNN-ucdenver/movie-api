'use strict';

const { expect } = require('chai');

describe('Rate Limiting', () => {
  it('auth rate limiter exports authLimiter', () => {
    const { authLimiter, globalLimiter, writeLimiter } = require('../../src/middleware/rateLimiter');
    expect(authLimiter).to.be.a('function');
    expect(globalLimiter).to.be.a('function');
    expect(writeLimiter).to.be.a('function');
  });
});
