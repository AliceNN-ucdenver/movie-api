'use strict';

function stripHtml(str) {
  if (typeof str !== 'string') return str;
  // Strip iteratively to handle nested/malformed tags
  let result = str;
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  return result;
}

function stripNoSqlOperators(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(stripNoSqlOperators);
  const cleaned = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$')) continue;
    cleaned[key] = stripNoSqlOperators(obj[key]);
  }
  return cleaned;
}

const ALLOWED_CDN_DOMAINS = [
  'image.tmdb.org',
  'upload.wikimedia.org',
  'images.unsplash.com',
  'm.media-amazon.com',
  'cdn.example.com'
];

function validateUrl(url, allowedDomains) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const domains = allowedDomains || ALLOWED_CDN_DOMAINS;
    return domains.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

module.exports = { stripHtml, stripNoSqlOperators, validateUrl, ALLOWED_CDN_DOMAINS };
