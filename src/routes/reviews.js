'use strict';

const express = require('express');
const Review = require('../models/Review');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { checkReviewOwnership } = require('../middleware/ownership');
const { validateObjectId, validatePagination } = require('../middleware/validate');
const { stripNoSqlOperators } = require('../utils/sanitize');

const router = express.Router();

router.get('/', validatePagination(['createdAt', 'rating']), async (req, res, next) => {
  try {
    const { page, limit, movieId } = req.query;
    const filter = {};
    if (movieId && /^[0-9a-fA-F]{24}$/.test(movieId)) filter.movieId = movieId;
    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([Review.find(filter).skip(skip).limit(limit), Review.countDocuments(filter)]);
    res.json({ data: reviews, page, limit, total });
  } catch (err) { next(err); }
});

router.get('/:id', validateObjectId('id'), async (req, res, next) => {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
    res.json(review);
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('user', 'admin'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const review = new Review({ ...body, userId: req.user.userId });
    await review.save();
    res.status(201).json(review);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('user', 'admin'), validateObjectId('id'), checkReviewOwnership, async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    delete body.userId;
    delete body.movieId;
    Object.assign(req.review, body);
    await req.review.save();
    res.json(req.review);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, validateObjectId('id'), async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const review = await Review.findByIdAndDelete(req.params.id);
      if (!review) return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
      return res.json({ message: 'Review deleted' });
    }
    // Non-admin users can only delete their own reviews
    if (!['user', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', message: 'Insufficient permissions' });
    }
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
    if (String(review.userId) !== String(req.user.userId)) {
      return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
    }
    await review.deleteOne();
    res.json({ message: 'Review deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
