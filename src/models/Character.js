'use strict';

const mongoose = require('mongoose');
const { stripHtml } = require('../utils/sanitize');

const characterSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, maxlength: 2000 },
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Actor', required: true }
});

characterSchema.index({ movieId: 1, actorId: 1, name: 1 });

characterSchema.pre('save', async function () {
  if (this.name) this.name = stripHtml(this.name);
  if (this.description) this.description = stripHtml(this.description);

  const Movie = mongoose.model('Movie');
  const Actor = mongoose.model('Actor');

  const [movie, actor] = await Promise.all([
    Movie.findById(this.movieId),
    Actor.findById(this.actorId)
  ]);

  if (!movie) throw Object.assign(new Error('movieId references a non-existent Movie'), { statusCode: 400 });
  if (!actor) throw Object.assign(new Error('actorId references a non-existent Actor'), { statusCode: 400 });
});

characterSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Character', characterSchema);
