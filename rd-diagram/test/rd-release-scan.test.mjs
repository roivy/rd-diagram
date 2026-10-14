import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scanner = path.resolve(__dirname, '../scripts/release-scan.mjs');

function makePkg(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-scan-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function scan(dir) {
  return execFileSync(process.execPath, [scanner, dir], { stdio: 'pipe', encoding: 'utf8' });
}

function scanFails(dir) {
  try {
    execFileSync(process.execPath, [scanner, dir], { stdio: 'pipe' });
    return false;
  } catch {
    return true;
  }
}

test('rd-release-scan: clean package passes', () => {
  const dir = makePkg({
    'SKILL.md': '# Roivy Diagram\nmade by Roivy',
    'bin/rd.mjs': 'export {} // rd cli',
    'renderers/shared/i18n.mjs': 'export const brand = "Roivy";',
    'examples/web-app-rendered.html': '<title>Roivy</title>',
  });
  assert.doesNotThrow(() => scan(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rd-release-scan: LICENSE is whitelisted verbatim', () => {
  const dir = makePkg({
    LICENSE: 'MIT License\n\nCopyright (c) 2026 tt-a1i (Archify)\nCopyright (c) 2025 Cocoon AI\n...',
    'bin/rd.mjs': 'export {}',
  });
  assert.doesNotThrow(() => scan(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rd-release-scan: provenance tokens allowed only inside THIRD_PARTY_NOTICES', () => {
  const dir = makePkg({
    'THIRD_PARTY_NOTICES.md': '# Third-party notices\nsoftware copyrighted by tt-a1i, derived from Cocoon AI.\nSee LICENSE.',
    'bin/rd.mjs': 'export {}',
  });
  assert.doesNotThrow(() => scan(dir));
  fs.rmSync(dir, { recursive: true, force: true });

  const leaking = makePkg({
    'docs/credits.md': 'thanks to tt-a1i',
    'bin/rd.mjs': 'export {}',
  });
  assert.equal(scanFails(leaking), true, 'tt-a1i outside notices must fail');
  fs.rmSync(leaking, { recursive: true, force: true });
});

test('rd-release-scan: upstream project name fails in any casing or spacing', () => {
  for (const content of [
    'based on archify v3',
    'See ARCHIFY docs',
    'port of Archify',
    'fork of a r c h i f y? no: ARCHIFY',
  ]) {
    const dir = makePkg({ 'notes.md': content, 'bin/rd.mjs': 'export {}' });
    assert.equal(scanFails(dir), true, `must fail for: ${content}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rd-release-scan: upstream GitHub URL fails', () => {
  const dir = makePkg({
    'readme.txt': 'source: https://GitHub.com/tt-a1i/Archify',
  });
  assert.equal(scanFails(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rd-release-scan: cocoon upstream project name fails outside notices', () => {
  const dir = makePkg({
    'docs/history.md': 'originally from architecture-diagram-generator',
  });
  assert.equal(scanFails(dir), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
