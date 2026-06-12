// @fitness:duplicate
'use strict';

// GOVERNANCE: floor is a human-managed ratchet. See test/fitness/baselines.json. Never raise floor programmatically.

const { execSync } = require('child_process');
const { expect } = require('chai');
const fs = require('fs');
const path = require('path');

const BASELINES_PATH = path.resolve(__dirname, 'baselines.json');
const SRC_PATH = path.resolve(__dirname, '..', '..', 'src');

function readBaselines() {
  if (!fs.existsSync(BASELINES_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeBaselines(data) {
  fs.writeFileSync(BASELINES_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function measureDuplication() {
  let stdout;
  try {
    stdout = execSync(`pmat analyze duplicates --path "${SRC_PATH}" --format json`, {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    const isNotFound =
      /not found|No such file|ENOENT|command not found/i.test(
        (err.message || '') + stderr
      );
    if (isNotFound) {
      throw new Error(
        'pmat CLI not found or failed. Install with: cargo install pmat (or npx pmat). ' +
          'Original error: ' + (stderr || err.message)
      );
    }
    throw new Error(
      'pmat analyze duplicates failed. ' +
        'Original error: ' + (stderr || err.message)
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (_) {
    throw new Error(
      'pmat output is not valid JSON. Output: ' + stdout.slice(0, 500)
    );
  }

  const pct = parsed.duplication_percentage;
  if (typeof pct !== 'number') {
    throw new Error(
      'Could not extract duplication_percentage from pmat JSON output. ' +
        'Got: ' + JSON.stringify(parsed).slice(0, 500)
    );
  }

  return pct;
}

describe('Fitness: Duplicate Code', () => {
  it('duplication percentage must not exceed baseline floor', () => {
    const measuredPct = measureDuplication();

    const baselines = readBaselines();

    if (!baselines.duplicate || typeof baselines.duplicate.floor !== 'number') {
      // /* INIT-ONLY */ First run — initialize floor from current measurement
      const floor = measuredPct;
      const target = parseFloat((Math.max(0, floor * 0.8)).toFixed(2));
      baselines.duplicate = {
        _comment:
          'floor is governance-managed. Raise it only via a reviewed PR with explicit justification. The fitness test will fail if measured > floor.',
        floor,
        target,
        measured: measuredPct,
      };
      writeBaselines(baselines);

      // Defensive: verify floor was not mutated during write
      const verification = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf8'));
      expect(verification.duplicate.floor).to.equal(
        floor,
        'floor must not be mutated during initialisation write'
      );

      console.log(
        `[fitness:duplicate] INIT: measured: ${measuredPct}%, floor initialized to: ${floor}%, target: ${target}%`
      );
      // First run always passes (floor == measured)
      return;
    }

    const floor = baselines.duplicate.floor;
    const originalFloor = floor;

    // Write current measurement back — only 'measured' is ever updated by this test
    baselines.duplicate.measured = measuredPct;
    writeBaselines(baselines);

    // Defensive: verify floor was not accidentally mutated during the write
    const verification = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf8'));
    expect(verification.duplicate.floor).to.equal(
      originalFloor,
      'floor must never change during a test run — governance ratchet violated'
    );

    const target = baselines.duplicate.target;
    console.log(
      `[fitness:duplicate] measured: ${measuredPct}%, floor: ${floor}%, target: ${target}%`
    );

    expect(measuredPct).to.be.at.most(
      floor,
      `Duplication fitness gate FAILED: measured ${measuredPct}% > floor ${floor}%. ` +
        'Reduce duplicated code in src/ to pass. ' +
        'Do NOT raise floor in test/fitness/baselines.json.'
    );
  });
});
