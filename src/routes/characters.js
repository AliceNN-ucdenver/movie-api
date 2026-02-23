'use strict';

const express = require('express');
const Character = require('../models/Character');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { validateObjectId, validatePagination } = require('../middleware/validate');
const { stripNoSqlOperators } = require('../utils/sanitize');

const ALLOWED_POPULATE = ['movie', 'actor'];

const router = express.Router();

router.get('/', validatePagination(['name']), async (req, res, next) => {
  try {
    const { page, limit, movieId, actorId, populate } = req.query;
    const filter = {};
    if (movieId && /^[0-9a-fA-F]{24}$/.test(movieId)) filter.movieId = movieId;
    if (actorId && /^[0-9a-fA-F]{24}$/.test(actorId)) filter.actorId = actorId;
    const skip = (page - 1) * limit;
    let query = Character.find(filter).skip(skip).limit(limit);
    if (populate) {
      const fields = populate.split(',').filter(f => ALLOWED_POPULATE.includes(f));
      if (fields.includes('movie')) query = query.populate('movieId');
      if (fields.includes('actor')) query = query.populate('actorId');
    }
    const [characters, total] = await Promise.all([query, Character.countDocuments(filter)]);
    res.json({ data: characters, page, limit, total });
  } catch (err) { next(err); }
});

router.get('/:id', validateObjectId('id'), async (req, res, next) => {
  try {
    const character = await Character.findById(req.params.id);
    if (!character) return res.status(404).json({ error: 'Not Found', message: 'Character not found' });
    res.json(character);
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const character = new Character(body);
    await character.save();
    res.status(201).json(character);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const character = await Character.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!character) return res.status(404).json({ error: 'Not Found', message: 'Character not found' });
    res.json(character);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const character = await Character.findByIdAndDelete(req.params.id);
    if (!character) return res.status(404).json({ error: 'Not Found', message: 'Character not found' });
    res.json({ message: 'Character deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
