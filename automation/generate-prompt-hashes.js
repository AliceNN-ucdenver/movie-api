#!/usr/bin/env node

/**
 * Generate SHA-256 Hashes for Prompt Pack Files
 *
 * Usage: node generate-prompt-hashes.js
 * Output: prompt-hashes.json
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PROMPTPACK_DIR = path.join(__dirname, '..', 'prompts', 'owasp');
const OUTPUT_FILE = path.join(__dirname, 'prompt-hashes.json');

function generateHash(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

function main() {
  const manifest = {
    _metadata: {
      generator: 'generate-prompt-hashes.js',
      algorithm: 'SHA-256'
    },
    owasp: {}
  };

  if (!fs.existsSync(PROMPTPACK_DIR)) {
    console.log('No prompts/owasp directory found — creating empty manifest.');
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n');
    return;
  }

  const files = fs.readdirSync(PROMPTPACK_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log('Generating prompt hash manifest...');

  for (const file of files) {
    const filePath = path.join(PROMPTPACK_DIR, file);
    const hash = generateHash(filePath);
    manifest.owasp[file] = hash;
    console.log(`  ${file} -> ${hash.substring(0, 20)}...`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote ${files.length} hashes to ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

if (require.main === module) {
  main();
}

module.exports = { generateHash };
