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
const renderer = path.join(skillRoot, 'renderers/fishbone/render-fishbone.mjs');
const example = path.join(skillRoot, 'examples/production-failure.fishbone.json');

function readExample() {
  return JSON.parse(fs.readFileSync(example, 'utf8'));
}

function render(inputPath, outPath) {
  execFileSync(process.execPath, [renderer, inputPath, outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outPath, 'utf8');
}

test('fishbone: schema accepts the checked-in example', () => {
  validateSchema('fishbone', readExample());
});

test('fishbone: schema rejects a wrong diagram type', () => {
  const bad = readExample();
  bad.diagram_type = 'architecture';
  assert.throws(() => validateSchema('fishbone', bad), /diagram_type/);
});

test('fishbone: schema rejects a single category', () => {
  const bad = readExample();
  bad.categories = bad.categories.slice(0, 1);
  assert.throws(() => validateSchema('fishbone', bad), /categories/);
});

test('fishbone: schema rejects unknown cause fields', () => {
  const bad = readExample();
  bad.categories[0].causes[0].severity = 9;
  assert.throws(() => validateSchema('fishbone', bad), /additional propert/);
});

test('fishbone: rendering is deterministic (golden)', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fishbone-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = render(example, path.join(dir, 'a.html'));
  const second = render(example, path.join(dir, 'b.html'));
  assert.equal(first, second, 'two renders of the same input must be byte-identical');
});

test('fishbone: verified causes and data attributes are present', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fishbone-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const html = render(example, path.join(dir, 'c.html'));
  assert.match(html, /data-node-id="problem"/, 'problem head is a searchable node');
  assert.match(html, /data-node-id="man"/, 'category is a searchable node');
  assert.match(html, /rd-fish-cause-text-verified/, 'verified causes are highlighted');
  assert.match(html, /data-reader-fit="authored-height"/, 'reader fit is declared');
  assert.match(html, /rd-fish-spine/, 'spine is rendered');
});

test('fishbone: schema-max density (7 causes x 2 categories) renders cleanly', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-fishbone-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dense = readExample();
  dense.categories = dense.categories.slice(0, 2).map((category, index) => ({
    ...category,
    causes: Array.from({ length: 7 }, (_, causeIndex) => ({
      text: `cause-${index}-${causeIndex}`,
      verified: causeIndex === 0,
    })),
  }));
  const input = path.join(dir, 'dense.json');
  fs.writeFileSync(input, JSON.stringify(dense));
  const html = render(input, path.join(dir, 'dense.html'));
  assert.match(html, /rd-fish-spine/, 'dense but valid layout still renders');
});
