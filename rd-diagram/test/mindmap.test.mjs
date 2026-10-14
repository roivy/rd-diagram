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
const renderer = path.join(skillRoot, 'renderers/mindmap/render-mindmap.mjs');
const example = path.join(skillRoot, 'examples/product-planning.mindmap.json');

function readExample() {
  return JSON.parse(fs.readFileSync(example, 'utf8'));
}

function render(inputPath, outPath) {
  execFileSync(process.execPath, [renderer, inputPath, outPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  return fs.readFileSync(outPath, 'utf8');
}

test('mindmap: schema accepts the checked-in example', () => {
  validateSchema('mindmap', readExample());
});

test('mindmap: schema rejects a single branch', () => {
  const bad = readExample();
  bad.branches = bad.branches.slice(0, 1);
  assert.throws(() => validateSchema('mindmap', bad), /branches/);
});

test('mindmap: schema rejects over-long labels', () => {
  const bad = readExample();
  bad.branches[0].text = '一'.repeat(41);
  assert.throws(() => validateSchema('mindmap', bad), /more than 40 characters/);
});

test('mindmap: rendering is deterministic (golden)', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-mindmap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const first = render(example, path.join(dir, 'a.html'));
  const second = render(example, path.join(dir, 'b.html'));
  assert.equal(first, second, 'two renders of the same input must be byte-identical');
});

test('mindmap: root, branches, links and reader fit are present', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-mindmap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const html = render(example, path.join(dir, 'c.html'));
  assert.match(html, /data-node-id="root"/, 'root is a searchable node');
  assert.match(html, /rd-mind-branch-box/, 'branch boxes are rendered');
  assert.match(html, /rd-mind-link/, 'connectors are rendered');
  assert.match(html, /data-reader-fit="authored-height"/, 'reader fit is declared');
  const branchCount = (html.match(/rd-mind-branch-box/g) || []).length;
  assert.ok(branchCount >= 6, `expected at least 6 branch boxes, found ${branchCount}`);
});

test('mindmap: deeply nested valid input renders without layout diagnostics', { timeout: 60000 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-mindmap-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const deep = readExample();
  deep.branches = [
    { text: '一级 A', children: [{ text: '二级 A1', children: [{ text: '三级 A1a' }, { text: '三级 A1b' }] }] },
    { text: '一级 B', children: [{ text: '二级 B1' }, { text: '二级 B2' }] },
  ];
  const input = path.join(dir, 'deep.json');
  fs.writeFileSync(input, JSON.stringify(deep));
  const html = render(input, path.join(dir, 'deep.html'));
  assert.match(html, /rd-mind-spine|rd-mind-root/, 'deep valid tree renders');
});
