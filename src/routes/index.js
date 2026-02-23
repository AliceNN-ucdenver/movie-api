'use strict';

const express = require('express');
const authRoutes = require('./auth');
const movieRoutes = require('./movies');
const actorRoutes = require('./actors');
const characterRoutes = require('./characters');
const reviewRoutes = require('./reviews');
const Review = require('../models/Review');
const { validateObjectId, validatePagination } = require('../middleware/validate');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/movies', movieRoutes);
router.use('/actors', actorRoutes);
router.use('/characters', characterRoutes);
router.use('/reviews', reviewRoutes);

// Nested route: GET /api/movies/:movieId/reviews
router.get('/movies/:movieId/reviews', validateObjectId('movieId'), validatePagination(['createdAt', 'rating']), async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const skip = (page - 1) * limit;
    const [reviews, total, avgData] = await Promise.all([
      Review.find({ movieId: req.params.movieId }).skip(skip).limit(limit),
      Review.countDocuments({ movieId: req.params.movieId }),
      Review.getAverageRating(req.params.movieId)
    ]);
    res.json({ data: reviews, page, limit, total, averageRating: avgData.averageRating, reviewCount: avgData.count });
  } catch (err) { next(err); }
});

module.exports = router;
