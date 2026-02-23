'use strict';

const express = require('express');
const Movie = require('../models/Movie');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { validateObjectId, validatePagination } = require('../middleware/validate');
const { stripNoSqlOperators } = require('../utils/sanitize');

const router = express.Router();

router.get('/', validatePagination(['title', 'year', 'createdAt']), async (req, res, next) => {
  try {
    const { page, limit, sort, genre, year } = req.query;
    const filter = {};
    if (genre) filter.genre = genre;
    if (year) filter.year = parseInt(year, 10);
    const skip = (page - 1) * limit;
    const sortObj = sort ? { [sort.replace(/^-/, '')]: sort.startsWith('-') ? -1 : 1 } : { title: 1 };
    const [movies, total] = await Promise.all([
      Movie.find(filter).sort(sortObj).skip(skip).limit(limit),
      Movie.countDocuments(filter)
    ]);
    res.json({ data: movies, page, limit, total });
  } catch (err) { next(err); }
});

router.get('/search', async (req, res, next) => {
  try {
    let q = req.query.q || '';
    q = q.replace(/[${}]/g, '');
    if (!q) return res.json({ data: [] });
    const movies = await Movie.find({ $text: { $search: q } }, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(20);
    res.json({ data: movies });
  } catch (err) { next(err); }
});

router.get('/:id', validateObjectId('id'), async (req, res, next) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Not Found', message: 'Movie not found' });
    res.json(movie);
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const movie = new Movie(body);
    await movie.save();
    res.status(201).json(movie);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const movie = await Movie.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!movie) return res.status(404).json({ error: 'Not Found', message: 'Movie not found' });
    res.json(movie);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const movie = await Movie.findByIdAndDelete(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Not Found', message: 'Movie not found' });
    res.json({ message: 'Movie deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
