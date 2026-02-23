'use strict';

const winston = require('winston');

const { combine, timestamp, json } = winston.format;

const maskPii = winston.format((info) => {
  const str = JSON.stringify(info);
  const masked = str
    .replace(/"password":"[^"]*"/g, '"password":"[REDACTED]"')
    .replace(/"passwordHash":"[^"]*"/g, '"passwordHash":"[REDACTED]"')
    .replace(/"authorization":"[^"]*"/gi, '"authorization":"[REDACTED]"')
    .replace(/"accessToken":"[^"]*"/g, '"accessToken":"[REDACTED]"')
    .replace(/"refreshToken":"[^"]*"/g, '"refreshToken":"[REDACTED]"')
    .replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (match, user, domain) => {
      return user[0] + '***@' + domain;
    });
  return JSON.parse(masked);
})();

const transports = [];

if (process.env.NODE_ENV !== 'test') {
  transports.push(new winston.transports.Console());
}

if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/app.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    })
  );
}

if (transports.length === 0) {
  transports.push(new winston.transports.Console({ silent: true }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(maskPii, timestamp(), json()),
  transports
});

module.exports = logger;
