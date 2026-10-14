#!/usr/bin/env node
// Roivy release gate: the distribution package must carry no upstream identity
// outside its legal attribution files. Exit 0 = clean; exit 1 = tokens found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Full-file whitelists (verbatim legal text).
const FILE_WHITELIST = new Set(['LICENSE']);
// Provenance tokens may appear only in these files.
const PROVENANCE_WHITELIST = new Set(['THIRD_PARTY_NOTICES.md']);

const TEXT_EXT = new Set(['.mjs', '.js', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml', '.svg']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'test']);

const BANNED_EVERYWHERE = [
  { re: /archify/i, label: 'upstream project name' },
  { re: /architecture-diagram-generator/i, label: 'upstream predecessor project name' },
  { re: /github\.com\/tt-a1i/i, label: 'upstream GitHub URL' },
];
const BANNED_OUTSIDE_PROVENANCE = BANNED_EVERYWHERE.concat([
  { re: /tt-a1i/i, label: 'upstream author id' },
  { re: /cocoon\s*-?\s*ai/i, label: 'upstream predecessor id' },
]);

const hits = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (!TEXT_EXT.has(path.extname(entry.name))) continue;
    const abs = path.join(dir, entry.name);
    const parts = path.relative(target, abs).split(path.sep);
    const base = parts[parts.length - 1];
    if (FILE_WHITELIST.has(base)) continue;
    if (base === 'release-scan.mjs') continue; // the scanner itself carries the banned patterns
    const rules = PROVENANCE_WHITELIST.has(base) ? BANNED_EVERYWHERE : BANNED_OUTSIDE_PROVENANCE;
    const text = fs.readFileSync(abs, 'utf8');
    for (const { re, label } of rules) {
      const m = text.match(re);
      if (m) hits.push(`${parts.join('/')} [${label}]: ${JSON.stringify(m[0])}`);
    }
  }
})(target);

if (hits.length) {
  console.error('rd-release-scan FAILED — upstream identity found outside whitelists:');
  for (const hit of hits) console.error('  ' + hit);
  process.exit(1);
}
console.log('rd-release-scan OK — no upstream identity outside LICENSE/THIRD_PARTY_NOTICES attribution');
