'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { stripHtml } = require('../utils/sanitize');

const BCRYPT_COST = 12;

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: 'Invalid email address'
    }
  },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['viewer', 'user', 'admin'], default: 'user' },
  displayName: { type: String, trim: true, maxlength: 50 },
  isActive: { type: Boolean, default: true },
  refreshTokenHash: { type: String, select: false },
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function () {
  if (this.isModified('passwordHash')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_COST);
  }
  if (this.displayName) this.displayName = stripHtml(this.displayName);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.refreshTokenHash;
    return ret;
  }
});

module.exports = mongoose.model('User', userSchema);
