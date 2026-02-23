'use strict';

const mongoose = require('mongoose');
const { stripHtml, validateUrl } = require('../utils/sanitize');

const actorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  birthYear: {
    type: Number, min: 1850,
    validate: { validator: (v) => v == null || v <= new Date().getFullYear(), message: 'Birth year cannot be in the future' }
  },
  bio: { type: String, maxlength: 5000 },
  headshotUrl: { type: String }
});

actorSchema.index({ name: 1, birthYear: 1 }, { unique: true });
actorSchema.index({ name: 'text' });

actorSchema.pre('save', function () {
  if (this.name) this.name = stripHtml(this.name);
  if (this.bio) this.bio = stripHtml(this.bio);
  if (this.headshotUrl && !validateUrl(this.headshotUrl)) {
    throw new Error('headshotUrl must be a valid HTTPS CDN URL');
  }
});

actorSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Actor', actorSchema);
