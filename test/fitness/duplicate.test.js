'use strict';
// @fitness:duplicate

const { expect } = require('chai');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASELINES_PATH = path.join(__dirname, 'baselines.json');

function roundToTwo(value) {
  return Number(Number(value).toFixed(2));
}

describe('Fitness: Duplicate Code', () => {
  it('should not exceed the ratcheted duplication floor', () => {
    let tmpDir;

    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jscpd-'));
      console.log('[fitness] jscpd tmp output:', tmpDir);

      try {
        execSync(`npx jscpd src/ --silent --reporters json --output ${tmpDir}`, { encoding: 'utf-8' });
      } catch (error) {
        throw new Error(`[fitness] jscpd execution failed: ${error.message}`);
      }

      const reportPath = path.join(tmpDir, 'jscpd-report.json');
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const measured = roundToTwo(Number(report.statistics.total.percentage));

      expect(Number.isFinite(measured)).to.equal(
        true,
        '[fitness] jscpd report did not contain a numeric total percentage'
      );
      console.log('[fitness] duplicate measured:', measured);

      let baselines = {};
      if (fs.existsSync(BASELINES_PATH)) {
        baselines = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf-8'));
      }

      if (!baselines.duplicate) {
        baselines.duplicate = { floor: measured, target: measured, measured };
        fs.writeFileSync(BASELINES_PATH, `${JSON.stringify(baselines, null, 2)}\n`, 'utf-8');
        console.log(`[fitness] baselines.json bootstrapped with floor=${measured}`);
        return;
      }

      const hasFloor = baselines.duplicate.floor !== undefined;
      const existingFloor = Number(baselines.duplicate.floor);
      const floor = roundToTwo(existingFloor);

      if (!Number.isFinite(existingFloor)) {
        throw new Error('[fitness] baselines.json contains a non-numeric duplicate.floor');
      }

      if (hasFloor && measured > existingFloor) {
        // Intentionally do not raise the floor.
      }

      baselines.duplicate.measured = measured;
      fs.writeFileSync(BASELINES_PATH, `${JSON.stringify(baselines, null, 2)}\n`, 'utf-8');

      expect(measured).to.be.at.most(
        floor,
        `Duplication ${measured}% exceeds floor ${floor}%. Reduce cloned blocks in src/ — do not raise the floor in baselines.json.`
      );
    } finally {
      if (tmpDir) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
  });
});
