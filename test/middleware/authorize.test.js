'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');

describe('Authorize Middleware', () => {
  let userToken;

  before(async () => {
    await User.deleteMany({});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'authztest@example.com', password: 'UserPass1!Strong' });
    userToken = res.body.accessToken;
  });

  it('should reject non-admin trying to create movie', async () => {
    const res = await request(app)
      .post('/api/movies')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ title: 'Unauthorized Movie', year: 2020 });
    expect(res.status).to.equal(403);
  });
});
