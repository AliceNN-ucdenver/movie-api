'use strict';

const mongoose = require('mongoose');
const Recommendation = require('../models/Recommendation');
const Review = require('../models/Review');
const Movie = require('../models/Movie');
const { stripHtml } = require('../utils/sanitize');
const { loadRecommendationsConfig } = require('../config/recommendations');

function normalizeRationale(rationale) {
  return (rationale || []).map((entry) => ({
    type: entry.type,
    value: stripHtml(entry.value || '').slice(0, 120)
  }));
}

async function buildColdStartRecommendations(limit, config) {
  const cutoff = new Date(Date.now() - (config.fallbackGenreWindowDays * 24 * 60 * 60 * 1000));
  const popular = await Review.aggregate([
    { $match: { createdAt: { $gte: cutoff } } },
    { $group: { _id: '$movieId', averageRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    { $sort: { count: -1, averageRating: -1 } },
    { $limit: limit }
  ]);

  if (popular.length === 0) {
    const recent = await Movie.find({}, { _id: 1 }).sort({ year: -1 }).limit(limit).lean();
    return recent.map((movie) => ({
      movieId: movie._id,
      score: 0.5,
      rationale: [{ type: 'cold_start_popularity', value: 'Recently released catalog title' }]
    }));
  }

  return popular.map((item) => ({
    movieId: item._id,
    score: Number(((item.averageRating || 0) / 10).toFixed(3)),
    rationale: [{ type: 'cold_start_popularity', value: 'Top-rated this week' }]
  }));
}

async function buildPersonalizedRecommendations(userId, limit, config) {
  const userReviews = await Review.find({ userId }, { movieId: 1, rating: 1 }).sort({ createdAt: -1 }).limit(200).lean();
  if (userReviews.length < config.minRatings) return null;

  const reviewedMovieIds = userReviews.map((review) => review.movieId);
  const reviewedMovies = await Movie.find({ _id: { $in: reviewedMovieIds } }, { genre: 1 }).lean();

  const genreWeights = new Map();
  for (const movie of reviewedMovies) {
    for (const genre of (movie.genre || [])) {
      genreWeights.set(genre, (genreWeights.get(genre) || 0) + 1);
    }
  }

  const rankedGenres = [...genreWeights.entries()].sort((a, b) => b[1] - a[1]).map((entry) => entry[0]);
  if (rankedGenres.length === 0) return null;

  const candidates = await Movie.find({
    _id: { $nin: reviewedMovieIds },
    genre: { $in: rankedGenres.slice(0, 4) }
  }, { _id: 1, genre: 1 }).limit(limit * 3).lean();

  const scored = candidates.map((movie) => {
    const overlap = (movie.genre || []).filter((genre) => rankedGenres.includes(genre));
    const score = overlap.reduce((acc, genre) => acc + (genreWeights.get(genre) || 0), 0) / Math.max(userReviews.length, 1);
    return {
      movieId: movie._id,
      score: Number(Math.max(score, 0.05).toFixed(3)),
      rationale: [{ type: 'genre_affinity', value: `${overlap[0] || rankedGenres[0]} affinity from your ratings` }]
    };
  }).sort((a, b) => b.score - a.score).slice(0, limit);

  return scored.length > 0 ? scored : null;
}

async function refreshRecommendationsForUser(userId, options = {}) {
  const config = loadRecommendationsConfig();
  const limit = Math.min(options.limit || config.defaultLimit, config.maxLimit);
  const normalizedUserId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const modelVersion = config.modelVersion;

  let personalizationStatus = 'personalized';
  let recommendations = await buildPersonalizedRecommendations(normalizedUserId, limit, config);
  if (!recommendations) {
    personalizationStatus = 'cold_start';
    recommendations = await buildColdStartRecommendations(limit, config);
  }

  const normalizedRecommendations = recommendations.map((item) => ({
    movieId: item.movieId,
    score: item.score,
    rationale: normalizeRationale(item.rationale)
  }));

  const generatedAt = new Date();
  const update = {
    userId: normalizedUserId,
    personalizationStatus,
    modelVersion,
    generatedAt,
    recommendations: normalizedRecommendations,
    telemetry: {
      lastServedAt: null,
      cacheHits: 0,
      cacheMisses: 0
    }
  };

  await Recommendation.findOneAndUpdate(
    { userId: normalizedUserId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    userId: String(normalizedUserId),
    personalizationStatus,
    modelVersion,
    generatedAt,
    recommendations: normalizedRecommendations
  };
}

async function refreshRecommendationBatch(batchSize) {
  const users = await Review.aggregate([
    { $group: { _id: '$userId' } },
    { $limit: batchSize }
  ]);

  for (const user of users) {
    await refreshRecommendationsForUser(String(user._id));
  }
  return users.length;
}

module.exports = { refreshRecommendationsForUser, refreshRecommendationBatch };
