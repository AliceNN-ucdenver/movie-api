'use strict';

const express = require('express');
const Actor = require('../models/Actor');
const Character = require('../models/Character');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { validateObjectId, validatePagination } = require('../middleware/validate');
const { stripNoSqlOperators } = require('../utils/sanitize');

const router = express.Router();

router.get('/', validatePagination(['name', 'birthYear']), async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const skip = (page - 1) * limit;
    const [actors, total] = await Promise.all([Actor.find().skip(skip).limit(limit), Actor.countDocuments()]);
    res.json({ data: actors, page, limit, total });
  } catch (err) { next(err); }
});

router.get('/search', async (req, res, next) => {
  try {
    let q = req.query.q || '';
    q = q.replace(/[${}]/g, '');
    if (!q) return res.json({ data: [] });
    const actors = await Actor.find({ $text: { $search: q } }, { score: { $meta: 'textScore' } }).sort({ score: { $meta: 'textScore' } }).limit(20);
    res.json({ data: actors });
  } catch (err) { next(err); }
});

router.get('/:id', validateObjectId('id'), async (req, res, next) => {
  try {
    const actor = await Actor.findById(req.params.id);
    if (!actor) return res.status(404).json({ error: 'Not Found', message: 'Actor not found' });
    const characters = await Character.find({ actorId: req.params.id }).populate('movieId');
    res.json({ ...actor.toJSON(), filmography: characters });
  } catch (err) { next(err); }
});

router.post('/', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const actor = new Actor(body);
    await actor.save();
    res.status(201).json(actor);
  } catch (err) { next(err); }
});

router.put('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const body = stripNoSqlOperators(req.body);
    const actor = await Actor.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    if (!actor) return res.status(404).json({ error: 'Not Found', message: 'Actor not found' });
    res.json(actor);
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, authorize('admin'), validateObjectId('id'), async (req, res, next) => {
  try {
    const refs = await Character.countDocuments({ actorId: req.params.id });
    if (refs > 0) return res.status(409).json({ error: 'Conflict', message: 'Actor is referenced by characters' });
    const actor = await Actor.findByIdAndDelete(req.params.id);
    if (!actor) return res.status(404).json({ error: 'Not Found', message: 'Actor not found' });
    res.json({ message: 'Actor deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
