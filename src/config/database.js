'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI environment variable not set');

  mongoose.set('strictQuery', true);

  const options = {
    autoIndex: process.env.NODE_ENV !== 'production'
  };

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { error: err.message }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  let retries = 0;
  const maxRetries = 5;
  let delay = 1000;

  while (retries < maxRetries) {
    try {
      await mongoose.connect(uri, options);
      return;
    } catch (err) {
      retries++;
      if (retries >= maxRetries) throw err;
      logger.warn(`MongoDB connection failed, retrying (${retries}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

async function connectTestDb() {
  const { MongoMemoryServer } = require('mongodb-memory-server');
  mongoose.set('strictQuery', true);
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri, { autoIndex: true });
  return mongod;
}

async function disconnect() {
  await mongoose.connection.close();
}

module.exports = { connect, connectTestDb, disconnect };
