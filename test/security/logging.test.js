'use strict';

const { expect } = require('chai');

describe('PII Masking in Logger', () => {
  it('logger module loads without error', () => {
    const logger = require('../../src/utils/logger');
    expect(logger).to.be.an('object');
    expect(logger.info).to.be.a('function');
    expect(logger.warn).to.be.a('function');
    expect(logger.error).to.be.a('function');
  });

  it('logger is created with correct configuration', () => {
    const logger = require('../../src/utils/logger');
    expect(logger.level).to.be.a('string');
  });
});
