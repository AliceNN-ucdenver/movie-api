'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');

describe('Security Headers', () => {
  it('should include X-Content-Type-Options header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).to.equal('nosniff');
  });

  it('should include X-Frame-Options header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).to.equal('DENY');
  });

  it('should not expose X-Powered-By header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).to.be.undefined;
  });

  it('should include Strict-Transport-Security header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['strict-transport-security']).to.include('max-age=');
  });

  it('should return 200 on health check', async () => {
    const res = await request(app).get('/health');
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('ok');
  });
});
