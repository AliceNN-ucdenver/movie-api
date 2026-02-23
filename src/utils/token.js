'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function getPrivateKey() {
  const key = process.env.JWT_RSA_PRIVATE_KEY;
  if (!key) throw new Error('JWT_RSA_PRIVATE_KEY not configured');
  return key.replace(/\\n/g, '\n');
}

function getPublicKey() {
  const key = process.env.JWT_RSA_PUBLIC_KEY;
  if (!key) throw new Error('JWT_RSA_PUBLIC_KEY not configured');
  return key.replace(/\\n/g, '\n');
}

function generateAccessToken(user) {
  const privateKey = getPrivateKey();
  return jwt.sign(
    { userId: user._id || user.id, email: user.email, role: user.role },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: process.env.JWT_EXPIRATION || '15m',
      issuer: 'movie-api',
      audience: 'imdb-lite'
    }
  );
}

function generateRefreshToken() {
  return crypto.randomBytes(64).toString('hex');
}

function verifyAccessToken(token) {
  const publicKey = getPublicKey();
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'movie-api',
    audience: 'imdb-lite'
  });
}

module.exports = { generateAccessToken, generateRefreshToken, verifyAccessToken };
