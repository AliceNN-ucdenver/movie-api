'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../src/app');
const Actor = require('../src/models/Actor');
const User = require('../src/models/User');

describe('Actors Routes', () => {
  let adminToken;

  const actorData = { name: 'John Doe', birthYear: 1980 };

  before(async () => {
    await User.deleteMany({});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'actortest@example.com', password: 'AdminPass1!Strong' });
    await User.findByIdAndUpdate(res.body.user.id, { role: 'admin' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'actortest@example.com', password: 'AdminPass1!Strong' });
    adminToken = loginRes.body.accessToken;
  });

  beforeEach(async () => {
    await Actor.deleteMany({});
  });

  describe('GET /api/actors', () => {
    it('should return paginated actors', async () => {
      await Actor.create(actorData);
      const res = await request(app).get('/api/actors');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('GET /api/actors/:id', () => {
    it('should return actor by id', async () => {
      const actor = await Actor.create(actorData);
      const res = await request(app).get(`/api/actors/${actor._id}`);
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('John Doe');
    });

    it('should return 404 for missing actor', async () => {
      const res = await request(app).get('/api/actors/000000000000000000000001');
      expect(res.status).to.equal(404);
    });
  });

  describe('POST /api/actors', () => {
    it('should create actor when admin', async () => {
      const res = await request(app)
        .post('/api/actors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(actorData);
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('John Doe');
    });

    it('should reject without auth', async () => {
      const res = await request(app).post('/api/actors').send(actorData);
      expect(res.status).to.equal(401);
    });
  });

  describe('PUT /api/actors/:id', () => {
    it('should update actor when admin', async () => {
      const actor = await Actor.create(actorData);
      const res = await request(app)
        .put(`/api/actors/${actor._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Jane Doe', birthYear: 1985 });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Jane Doe');
    });
  });

  describe('DELETE /api/actors/:id', () => {
    it('should delete actor when admin', async () => {
      const actor = await Actor.create(actorData);
      const res = await request(app)
        .delete(`/api/actors/${actor._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).to.equal(200);
    });
  });
});
