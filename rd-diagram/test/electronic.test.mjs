import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { validateEngineeringProfile } from '../renderers/shared/engineering-profiles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/architecture/render-architecture.mjs');
const example = path.join(skillRoot, 'examples/robot-mainboard.architecture.json');

function readExample() {
  return JSON.parse(fs.readFileSync(example, 'utf8'));
}

test('electronic: schema accepts electronic component types and signal fields', () => {
  validateSchema('architecture', readExample());
});

test('electronic: schema rejects an unknown signal kind', () => {
  const bad = readExample();
  bad.connections[0].signal = 'plasma';
  assert.throws(() => validateSchema('architecture', bad), /signal/);
});

test('electronic: profile gate rejects a missing signal', () => {
  const bad = readExample();
  delete bad.connections[0].signal;
  assert.throws(
    () => validateEngineeringProfile('architecture', bad),
    /electronic-signal-missing|must declare a signal kind/,
  );
});

test('electronic: profile gate rejects a generic component type', () => {
  const bad = readExample();
  bad.components[0].type = 'backend';
  assert.throws(
    () => validateEngineeringProfile('architecture', bad),
    /electronic-component-type|generic type/,
  );
});

test('electronic: rendered HTML carries signal line classes', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-electronic-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync(process.execPath, [renderer, example, path.join(dir, 'mb.html')], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const html = fs.readFileSync(path.join(dir, 'mb.html'), 'utf8');
  for (const cls of ['sig-power', 'sig-digital', 'sig-analog', 'sig-bus', 'sig-rf', 'sig-ground', 'c-mcu', 'c-sensor', 'c-rf']) {
    assert.ok(html.includes(cls), `${cls} must appear in the rendered board`);
  }
});
