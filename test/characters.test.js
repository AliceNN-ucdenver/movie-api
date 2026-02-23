'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../src/app');
const Character = require('../src/models/Character');
const Movie = require('../src/models/Movie');
const Actor = require('../src/models/Actor');
const User = require('../src/models/User');

describe('Characters Routes', () => {
  let adminToken;
  let movieId, actorId;

  before(async () => {
    await User.deleteMany({});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'chartest@example.com', password: 'AdminPass1!Strong' });
    await User.findByIdAndUpdate(res.body.user.id, { role: 'admin' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'chartest@example.com', password: 'AdminPass1!Strong' });
    adminToken = loginRes.body.accessToken;
  });

  beforeEach(async () => {
    await Character.deleteMany({});
    await Movie.deleteMany({});
    await Actor.deleteMany({});
    const movie = await Movie.create({ title: 'Char Movie', year: 2020 });
    const actor = await Actor.create({ name: 'Char Actor', birthYear: 1990 });
    movieId = movie._id;
    actorId = actor._id;
  });

  describe('GET /api/characters', () => {
    it('should return paginated characters', async () => {
      const res = await request(app).get('/api/characters');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('POST /api/characters', () => {
    it('should create character when admin', async () => {
      const res = await request(app)
        .post('/api/characters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Hero', movieId, actorId });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Hero');
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/characters')
        .send({ name: 'Hero', movieId, actorId });
      expect(res.status).to.equal(401);
    });

    it('should reject invalid movieId reference', async () => {
      const res = await request(app)
        .post('/api/characters')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Hero', movieId: '000000000000000000000001', actorId });
      expect(res.status).to.equal(400);
    });
  });

  describe('GET /api/characters/:id', () => {
    it('should return character by id', async () => {
      const char = await Character.create({ name: 'Villain', movieId, actorId });
      const res = await request(app).get(`/api/characters/${char._id}`);
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Villain');
    });
  });

  describe('DELETE /api/characters/:id', () => {
    it('should delete character when admin', async () => {
      const char = await Character.create({ name: 'Side', movieId, actorId });
      const res = await request(app)
        .delete(`/api/characters/${char._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).to.equal(200);
    });
  });
});
