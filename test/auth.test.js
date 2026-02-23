'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');

describe('Auth Routes', () => {
  beforeEach(async () => {
    await User.deleteMany({});
  });

  const validPassword = 'Password1!ValidTest';
  const validEmail = 'test@example.com';

  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: validEmail, password: validPassword });
      expect(res.status).to.equal(201);
      expect(res.body).to.have.property('accessToken');
      expect(res.body).to.have.property('refreshToken');
      expect(res.body.user.email).to.equal(validEmail);
      expect(res.body.user).to.not.have.property('passwordHash');
    });

    it('should reject invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'notanemail', password: validPassword });
      expect(res.status).to.equal(400);
    });

    it('should reject weak password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: validEmail, password: 'weak' });
      expect(res.status).to.equal(400);
    });

    it('should reject duplicate email', async () => {
      await request(app).post('/api/auth/register').send({ email: validEmail, password: validPassword });
      const res = await request(app).post('/api/auth/register').send({ email: validEmail, password: validPassword });
      expect(res.status).to.equal(409);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/register').send({ email: validEmail, password: validPassword });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: validEmail, password: validPassword });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('accessToken');
      expect(res.body).to.have.property('refreshToken');
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: validEmail, password: 'WrongPassword1!' });
      expect(res.status).to.equal(401);
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: validPassword });
      expect(res.status).to.equal(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let refreshToken;

    beforeEach(async () => {
      const res = await request(app).post('/api/auth/register').send({ email: validEmail, password: validPassword });
      refreshToken = res.body.refreshToken;
    });

    it('should issue new tokens', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken });
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('accessToken');
      expect(res.body).to.have.property('refreshToken');
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalidtoken' });
      expect(res.status).to.equal(401);
    });

    it('should reject missing refresh token', async () => {
      const res = await request(app).post('/api/auth/refresh').send({});
      expect(res.status).to.equal(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      const regRes = await request(app).post('/api/auth/register').send({ email: validEmail, password: validPassword });
      const res = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: regRes.body.refreshToken });
      expect(res.status).to.equal(200);
      expect(res.body.message).to.equal('Logged out successfully');
    });

    it('should succeed even without refresh token', async () => {
      const res = await request(app).post('/api/auth/logout').send({});
      expect(res.status).to.equal(200);
    });
  });
});
