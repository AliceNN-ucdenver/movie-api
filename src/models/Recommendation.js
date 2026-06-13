'use strict';

const mongoose = require('mongoose');
const { stripHtml } = require('../utils/sanitize');

const recommendationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  personalizationStatus: { type: String, enum: ['personalized', 'cold_start'], required: true },
  modelVersion: { type: String, required: true, default: 'item-cf-v1' },
  generatedAt: { type: Date, required: true, default: Date.now },
  recommendations: [{
    movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
    score: { type: Number, required: true, min: 0 },
    rationale: [{
      type: { type: String, enum: ['genre_affinity', 'rating_similarity', 'catalog_overlap', 'cold_start_popularity'], required: true },
      value: { type: String, required: true, maxlength: 120 }
    }]
  }],
  telemetry: {
    lastServedAt: { type: Date },
    cacheHits: { type: Number, default: 0 },
    cacheMisses: { type: Number, default: 0 }
  }
}, { minimize: true, strict: true });

recommendationSchema.pre('save', function () {
  this.recommendations = (this.recommendations || []).map((item) => ({
    ...item,
    rationale: (item.rationale || []).map((entry) => ({
      ...entry,
      value: stripHtml(entry.value || '').slice(0, 120)
    }))
  }));
});

recommendationSchema.index({ userId: 1 }, { unique: true });
recommendationSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('Recommendation', recommendationSchema);
