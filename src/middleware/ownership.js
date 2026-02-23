'use strict';

const Review = require('../models/Review');

async function checkReviewOwnership(req, res, next) {
  try {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
    if (String(review.userId) !== String(req.user.userId)) {
      return res.status(404).json({ error: 'Not Found', message: 'Review not found' });
    }
    req.review = review;
    next();
  } catch (_err) {
    next(_err);
  }
}

module.exports = { checkReviewOwnership };
