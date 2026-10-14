import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../renderers/shared/validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers/roster/render-roster.mjs');
const example = path.join(skillRoot, 'examples/project-team.roster.json');

function readExample() {
  return JSON.parse(fs.readFileSync(example, 'utf8'));
}

function render(inputPath, outPath) {
  execFileSync(process.execPath, [renderer, inputPath, outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outPath, 'utf8');
}

test('roster: schema accepts the checked-in example', () => {
  validateSchema('roster', readExample());
});

test('roster: schema rejects unknown card fields', () => {
  const bad = readExample();
  bad.persons[0].photo = 'x';
  assert.throws(() => validateSchema('roster', bad), /additional propert/);
});

test('roster: renderer rejects a person with an unknown group', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-roster-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = readExample();
  bad.persons[1].group = 'nonexistent';
  const input = path.join(dir, 'bad.json');
  fs.writeFileSync(input, JSON.stringify(bad));
  let failed = false;
  try {
    render(input, path.join(dir, 'bad.html'));
  } catch (error) {
    failed = true;
    assert.match(String(error.stderr || error.message), /layout|group/, 'unknown group diagnostic');
  }
  assert.equal(failed, true, 'unknown group must fail closed');
});

test('roster: renderer rejects self-reports', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-roster-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = readExample();
  bad.reports = [{ from: 'lin', to: 'lin' }];
  const input = path.join(dir, 'self.json');
  fs.writeFileSync(input, JSON.stringify(bad));
  let failed = false;
  try {
    render(input, path.join(dir, 'self.html'));
  } catch (error) {
    failed = true;
    assert.match(String(error.stderr || error.message), /self-report/, 'self-report diagnostic');
  }
  assert.equal(failed, true, 'self-report must fail closed');
});

test('roster: rendering is deterministic and carries org tree + elbows', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-roster-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = render(example, path.join(dir, 'a.html'));
  const second = render(example, path.join(dir, 'b.html'));
  assert.equal(first, second, 'renders must be byte-identical');
  assert.match(first, /rd-roster-person/, 'person nodes rendered');
  assert.match(first, /rd-roster-elbow/, 'org tree elbows rendered');
  assert.match(first, /data-node-id="chenfeng"/, 'persons are searchable nodes');
  assert.match(first, /data-reader-fit="authored-height"/, 'reader fit declared');
});
