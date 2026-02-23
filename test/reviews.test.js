'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../src/app');
const Review = require('../src/models/Review');
const Movie = require('../src/models/Movie');
const User = require('../src/models/User');

describe('Reviews Routes', () => {
  let userToken, adminToken, adminId;
  let movieId;

  before(async () => {
    await User.deleteMany({});
    const userRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'reviewer@example.com', password: 'UserPass1!Strong' });
    userToken = userRes.body.accessToken;

    const adminRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'adminreviewer@example.com', password: 'AdminPass1!Strong' });
    adminId = adminRes.body.user.id;
    await User.findByIdAndUpdate(adminId, { role: 'admin' });
    const adminLoginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'adminreviewer@example.com', password: 'AdminPass1!Strong' });
    adminToken = adminLoginRes.body.accessToken;
  });

  beforeEach(async () => {
    await Review.deleteMany({});
    await Movie.deleteMany({});
    const movie = await Movie.create({ title: 'Review Movie', year: 2020 });
    movieId = movie._id;
  });

  describe('POST /api/reviews', () => {
    it('should create a review as user', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 8, title: 'Great film', body: 'Really enjoyed this movie.' });
      expect(res.status).to.equal(201);
      expect(res.body.rating).to.equal(8);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/reviews')
        .send({ movieId, rating: 8, title: 'Great', body: 'Good movie.' });
      expect(res.status).to.equal(401);
    });

    it('should reject duplicate review', async () => {
      await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 8, title: 'First', body: 'First review.' });
      const res = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 5, title: 'Second', body: 'Second review.' });
      expect(res.status).to.equal(409);
    });
  });

  describe('GET /api/reviews', () => {
    it('should list reviews', async () => {
      const res = await request(app).get('/api/reviews');
      expect(res.status).to.equal(200);
      expect(res.body.data).to.be.an('array');
    });
  });

  describe('PUT /api/reviews/:id', () => {
    it('should update own review', async () => {
      const createRes = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 7, title: 'Good', body: 'Pretty good film.' });
      const reviewId = createRes.body.id;
      const res = await request(app)
        .put(`/api/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ rating: 9, title: 'Great!', body: 'Changed my mind.' });
      expect(res.status).to.equal(200);
      expect(res.body.rating).to.equal(9);
    });
  });

  describe('DELETE /api/reviews/:id', () => {
    it('should delete own review', async () => {
      const createRes = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 6, title: 'OK', body: 'Not bad.' });
      const reviewId = createRes.body.id;
      const res = await request(app)
        .delete(`/api/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).to.equal(200);
    });

    it('admin can delete any review', async () => {
      const createRes = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ movieId, rating: 6, title: 'OK', body: 'Not bad.' });
      const reviewId = createRes.body.id;
      const res = await request(app)
        .delete(`/api/reviews/${reviewId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).to.equal(200);
    });
  });
});
