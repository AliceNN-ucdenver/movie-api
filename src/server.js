'use strict';

require('dotenv').config();
const app = require('./app');
const { connect } = require('./config/database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 8080;

async function start() {
  await connect();
  const server = app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
  });

  function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      logger.info('Server closed');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch(err => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
