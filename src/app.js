'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimiter');
const { stripNoSqlOperators } = require('./utils/sanitize');
const routes = require('./routes/index');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: corsOrigin.split(','),
  credentials: true,
  maxAge: 600
}));

app.use(express.json({ limit: '100kb' }));

app.use((req, _res, next) => {
  if (req.body) req.body = stripNoSqlOperators(req.body);
  if (req.query) req.query = stripNoSqlOperators(req.query);
  next();
});

app.use(requestLogger);
app.use(globalLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', routes);

app.use(errorHandler);

module.exports = app;
