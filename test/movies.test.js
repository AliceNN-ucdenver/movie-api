'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../src/app');
const Movie = require('../src/models/Movie');
const User = require('../src/models/User');

describe('Movies Routes', () => {
  let adminToken;

  const movieData = { title: 'Test Movie', year: 2020, genre: ['Action'], director: 'Test Director' };

  before(async () => {
    await User.deleteMany({});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'admin@example.com', password: 'AdminPass1!Strong' });
    // Manually set role to admin
    await User.findByIdAndUpdate(res.body.user.id, { role: 'admin' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'AdminPass1!Strong' });
    adminToken = loginRes.body.accessToken;
  });

  beforeEach(async () => {
    await Movie.deleteMany({});
  });

  describe('GET /api/movies', () => {
    it('should return paginated movies', async () => {
      await Movie.create(movieData);
      const res = await request(app).get('/api/movies');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('data');
      expect(res.body.data).to.be.an('array');
      expect(res.body).to.have.property('total');
    });

    it('should filter by genre', async () => {
      await Movie.create(movieData);
      const res = await request(app).get('/api/movies?genre=Action');
      expect(res.status).to.equal(200);
      expect(res.body.data.length).to.be.greaterThan(0);
    });
  });

  describe('GET /api/movies/:id', () => {
    it('should return a movie by id', async () => {
      const movie = await Movie.create(movieData);
      const res = await request(app).get(`/api/movies/${movie._id}`);
      expect(res.status).to.equal(200);
      expect(res.body.title).to.equal('Test Movie');
    });

    it('should return 404 for non-existent movie', async () => {
      const res = await request(app).get('/api/movies/000000000000000000000001');
      expect(res.status).to.equal(404);
    });

    it('should return 400 for invalid id', async () => {
      const res = await request(app).get('/api/movies/invalid-id');
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/movies', () => {
    it('should create a movie when admin', async () => {
      const res = await request(app)
        .post('/api/movies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(movieData);
      expect(res.status).to.equal(201);
      expect(res.body.title).to.equal('Test Movie');
    });

    it('should reject without auth', async () => {
      const res = await request(app).post('/api/movies').send(movieData);
      expect(res.status).to.equal(401);
    });
  });

  describe('PUT /api/movies/:id', () => {
    it('should update a movie when admin', async () => {
      const movie = await Movie.create(movieData);
      const res = await request(app)
        .put(`/api/movies/${movie._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Updated Movie', year: 2021 });
      expect(res.status).to.equal(200);
      expect(res.body.title).to.equal('Updated Movie');
    });
  });

  describe('DELETE /api/movies/:id', () => {
    it('should delete a movie when admin', async () => {
      const movie = await Movie.create(movieData);
      const res = await request(app)
        .delete(`/api/movies/${movie._id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).to.equal(200);
    });
  });
});
