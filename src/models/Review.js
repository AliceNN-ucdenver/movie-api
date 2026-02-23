'use strict';

const mongoose = require('mongoose');
const { stripHtml } = require('../utils/sanitize');

const reviewSchema = new mongoose.Schema({
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: {
    type: Number, required: true, min: 1, max: 10,
    validate: { validator: Number.isInteger, message: 'Rating must be an integer' }
  },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, maxlength: 10000 },
  createdAt: { type: Date, default: Date.now, immutable: true },
  updatedAt: { type: Date }
});

reviewSchema.index({ movieId: 1, userId: 1 }, { unique: true });

reviewSchema.pre('save', async function () {
  if (this.title) this.title = stripHtml(this.title);
  if (this.body) this.body = stripHtml(this.body);
  this.updatedAt = new Date();

  const Movie = mongoose.model('Movie');
  const movie = await Movie.findById(this.movieId);
  if (!movie) throw Object.assign(new Error('movieId references a non-existent Movie'), { statusCode: 400 });
});

reviewSchema.statics.getAverageRating = async function (movieId) {
  const result = await this.aggregate([
    { $match: { movieId: new mongoose.Types.ObjectId(movieId) } },
    { $group: { _id: '$movieId', averageRating: { $avg: '$rating' }, count: { $sum: 1 } } }
  ]);
  return result[0] || { averageRating: null, count: 0 };
};

reviewSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Review', reviewSchema);
