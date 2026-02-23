'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');

describe('Auth Middleware', () => {
  it('should reject request without token', async () => {
    const res = await request(app).post('/api/movies');
    expect(res.status).to.equal(401);
  });

  it('should reject request with invalid token', async () => {
    const res = await request(app)
      .post('/api/movies')
      .set('Authorization', 'Bearer invalidtoken');
    expect(res.status).to.equal(401);
  });

  it('should reject request with malformed auth header', async () => {
    const res = await request(app)
      .post('/api/movies')
      .set('Authorization', 'Basic sometoken');
    expect(res.status).to.equal(401);
  });
});
