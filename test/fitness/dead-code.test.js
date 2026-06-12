// @fitness:dead-code
/* eslint-disable no-console */
'use strict';

const { expect } = require('chai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINES_PATH = path.join(__dirname, 'baselines.json');
const PACKAGE_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.resolve(__dirname, '../../src');

function isWithinScope(targetPath, scopeRoot) {
  if (!targetPath) return false;

  const resolvedTarget = path.resolve(PACKAGE_ROOT, targetPath);
  const normalizedScope = `${scopeRoot}${path.sep}`;

  return resolvedTarget === scopeRoot || resolvedTarget.startsWith(normalizedScope);
}

function countUnusedEntries(report, scopeRoot) {
  const issues = Array.isArray(report.issues) ? report.issues : [report];

  return issues.reduce((count, issue) => {
    const unusedFiles = Array.isArray(issue.files)
      ? issue.files.filter(entry => isWithinScope(entry.name, scopeRoot)).length
      : 0;
    const unusedExports = Array.isArray(issue.exports) && isWithinScope(issue.file, scopeRoot)
      ? issue.exports.length
      : 0;

    return count + unusedFiles + unusedExports;
  }, 0);
}

describe('Fitness: Dead Code', () => {
  it('should not exceed the ratcheted dead-code floor', () => {
    const scopeRoot = fs.existsSync(SRC_ROOT) ? SRC_ROOT : PACKAGE_ROOT;
    let stdout = '';

    try {
      // Keep this fitness gate local-only so PR feedback stays fast and deterministic.
      stdout = execSync('npx knip --reporter json', {
        cwd: PACKAGE_ROOT,
        encoding: 'utf-8'
      });
    } catch (error) {
      stdout = error && error.stdout ? String(error.stdout) : '';
    }

    let report;
    try {
      report = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`[fitness] knip output was not valid JSON: ${error.message}`);
    }

    const measured = countUnusedEntries(report, scopeRoot);

    expect(Number.isInteger(measured)).to.equal(
      true,
      '[fitness] knip report did not contain a countable dead-code result'
    );
    console.log(`[fitness] dead-code measured: ${measured}`);

    let baselines = {};
    if (fs.existsSync(BASELINES_PATH)) {
      baselines = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf-8'));
    }

    if (!baselines['dead-code']) {
      baselines['dead-code'] = { floor: measured, target: measured, measured };
      fs.writeFileSync(BASELINES_PATH, `${JSON.stringify(baselines, null, 2)}\n`, 'utf-8');
      console.log(`[fitness] baselines.json bootstrapped with floor=${measured}`);
      return;
    }

    const floor = Number(baselines['dead-code'].floor);
    if (!Number.isFinite(floor)) {
      throw new Error('[fitness] baselines.json contains a non-numeric dead-code.floor');
    }

    expect(measured).to.be.at.most(
      floor,
      `Dead-code count ${measured} exceeds floor ${floor}. Remove unused exports in src/ — do not raise the floor in baselines.json.`
    );
  });
});
