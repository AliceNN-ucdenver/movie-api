'use strict';

const crypto = require('crypto');

// Generate RSA keys synchronously BEFORE any module imports that need them
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.JWT_RSA_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.JWT_RSA_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' });
process.env.NODE_ENV = 'test';
process.env.JWT_EXPIRATION = '15m';

const { connectTestDb, disconnect } = require('../src/config/database');

let mongod;

exports.mochaHooks = {
  async beforeAll() {
    this.timeout(60000);
    mongod = await connectTestDb();
  },
  async afterAll() {
    await disconnect();
    if (mongod) await mongod.stop();
  }
};
