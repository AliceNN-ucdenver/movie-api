// @fitness:complexity
'use strict';

const { expect } = require('chai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINES_PATH = path.join(__dirname, 'baselines.json');
const PACKAGE_ROOT = path.resolve(__dirname, '../..');

function runComplexityScan() {
  const srcRoot = fs.existsSync(path.resolve(__dirname, '../../src')) ? 'src/' : '.';
  const command = `npx eslint ${srcRoot} --env es2021,node --rule '{"complexity":["error",1]}' --format json --no-eslintrc --ignore-pattern 'test/' --ignore-pattern 'node_modules/'`;
  let stdout = '';

  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      cwd: PACKAGE_ROOT
    });
  } catch (error) {
    stdout = error && error.stdout ? String(error.stdout) : '';
    if (!stdout) {
      throw new Error(`[fitness] ESLint execution failed: ${error.message}`);
    }
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`[fitness] ESLint execution failed: ${error.message}`);
  }

  if (!Array.isArray(report)) {
    throw new Error('[fitness] ESLint execution failed: unexpected JSON output');
  }

  const scores = [];
  report.forEach(fileReport => {
    const messages = Array.isArray(fileReport.messages) ? fileReport.messages : [];
    const fatalMessage = messages.find(message => message && message.fatal);
    if (fatalMessage) {
      throw new Error(`[fitness] ESLint execution failed: ${fatalMessage.message}`);
    }

    messages
      .filter(message => message && message.ruleId === 'complexity')
      .forEach(message => {
        const match = String(message.message || '').match(/complexity of (\d+)/i);
        if (!match) {
          throw new Error('[fitness] ESLint execution failed: unable to parse complexity output');
        }

        const score = Number(match[1]);
        if (!Number.isFinite(score)) {
          throw new Error('[fitness] ESLint execution failed: complexity output contained a non-numeric value');
        }
        scores.push(score);
      });
  });

  return scores.length ? Math.max(...scores) : 0;
}

describe('Fitness: Complexity', () => {
  it('should not exceed the ratcheted complexity floor', () => {
    const measured = runComplexityScan();
    expect(Number.isInteger(measured) && measured >= 0).to.equal(
      true,
      '[fitness] complexity scan did not produce a finite integer measured value'
    );
    // eslint-disable-next-line no-console
    console.log('[fitness] complexity measured:', measured);

    let baselines = {};
    if (fs.existsSync(BASELINES_PATH)) {
      baselines = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf-8'));
    }

    if (!baselines.complexity) {
      // ratchet starts at today's value — no worse
      baselines.complexity = { floor: measured, target: measured, measured };
      fs.writeFileSync(BASELINES_PATH, `${JSON.stringify(baselines, null, 2)}\n`, 'utf-8');
      return;
    }

    const floor = Number(baselines.complexity.floor);
    if (!Number.isFinite(floor)) {
      throw new Error('[fitness] baselines.json contains a non-numeric complexity.floor');
    }

    expect(measured).to.be.at.most(
      floor,
      `[fitness] Max cyclomatic complexity ${measured} exceeds floor ${floor}. Refactor complex functions in src/ — do not raise floor in baselines.json.`
    );
  });
});
