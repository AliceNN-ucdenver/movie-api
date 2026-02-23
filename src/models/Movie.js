'use strict';

const mongoose = require('mongoose');
const { stripHtml, validateUrl } = require('../utils/sanitize');

const VALID_GENRES = ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Fantasy','Horror','Mystery','Romance','Sci-Fi','Thriller','Western'];

const castMemberSchema = new mongoose.Schema({
  actor: {
    name: { type: String, trim: true, maxlength: 100 },
    birthYear: { type: Number },
    headshotUrl: { type: String }
  },
  character: {
    name: { type: String, trim: true, maxlength: 100 },
    description: { type: String, maxlength: 2000 }
  }
}, { _id: false });

const movieSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  year: {
    type: Number, required: true, min: 1888,
    validate: { validator: (v) => v <= new Date().getFullYear() + 5, message: 'Year is too far in the future' }
  },
  genre: [{ type: String, enum: VALID_GENRES }],
  director: { type: String, trim: true, maxlength: 100 },
  plot: { type: String, maxlength: 5000 },
  posterUrl: { type: String },
  cast: [castMemberSchema]
});

movieSchema.index({ title: 1, year: 1 }, { unique: true });
movieSchema.index({ title: 'text', plot: 'text' });

movieSchema.pre('save', function () {
  const strFields = ['title', 'director', 'plot'];
  for (const f of strFields) {
    if (this[f]) this[f] = stripHtml(this[f]);
  }
  if (this.posterUrl && !validateUrl(this.posterUrl)) {
    throw new Error('posterUrl must be a valid HTTPS CDN URL');
  }
  for (const member of (this.cast || [])) {
    if (member.actor) {
      if (member.actor.name) member.actor.name = stripHtml(member.actor.name);
      if (member.actor.headshotUrl && !validateUrl(member.actor.headshotUrl)) {
        throw new Error('headshotUrl must be a valid HTTPS CDN URL');
      }
    }
    if (member.character) {
      if (member.character.name) member.character.name = stripHtml(member.character.name);
      if (member.character.description) member.character.description = stripHtml(member.character.description);
    }
  }
});

movieSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Movie', movieSchema);
