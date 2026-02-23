'use strict';

const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');
const { stripNoSqlOperators, stripHtml } = require('../../src/utils/sanitize');

describe('NoSQL Injection Prevention', () => {
  describe('stripNoSqlOperators', () => {
    it('should strip $ keys from objects', () => {
      const input = { '$where': '1==1', name: 'test' };
      const result = stripNoSqlOperators(input);
      expect(result).to.not.have.property('$where');
      expect(result.name).to.equal('test');
    });

    it('should handle nested objects', () => {
      const input = { user: { '$gt': '', name: 'alice' } };
      const result = stripNoSqlOperators(input);
      expect(result.user).to.not.have.property('$gt');
      expect(result.user.name).to.equal('alice');
    });

    it('should handle arrays', () => {
      const input = [{ '$ne': null }, { name: 'test' }];
      const result = stripNoSqlOperators(input);
      expect(result[0]).to.not.have.property('$ne');
      expect(result[1].name).to.equal('test');
    });
  });

  describe('stripHtml', () => {
    it('should remove HTML tags', () => {
      const result = stripHtml('<script>alert("xss")</script>Hello');
      expect(result).to.equal('Hello');
    });

    it('should return non-string values unchanged', () => {
      expect(stripHtml(42)).to.equal(42);
      expect(stripHtml(null)).to.equal(null);
    });
  });

  describe('API injection prevention', () => {
    it('should reject NoSQL operator in login attempt', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: { '$gt': '' }, password: { '$gt': '' } });
      // Should not succeed - the operators should be stripped or rejected
      expect(res.status).to.not.equal(200);
    });
  });
});
