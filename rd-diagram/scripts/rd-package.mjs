#!/usr/bin/env node
// 打 Roivy 分发 zip：先过 release-scan 发布门，再排除 dev 依赖与测试进行打包。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version;

execFileSync(process.execPath, [path.join(pkgRoot, 'scripts/release-scan.mjs'), pkgRoot], { stdio: 'inherit' });

const dist = path.join(pkgRoot, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
// Stage outside pkgRoot: cpSync refuses to copy a directory into its own subtree.
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-pkg-'));
const stage = path.join(stageRoot, 'rd-diagram');
fs.cpSync(pkgRoot, stage, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(pkgRoot, src).split(path.sep)[0];
    return rel !== 'test' && rel !== 'node_modules' && rel !== 'dist' && !src.endsWith('.log');
  },
});
const zip = path.join(dist, `rd-diagram-${version}.zip`);
execFileSync('python', ['-m', 'zipfile', '-c', zip, 'rd-diagram'], { cwd: stageRoot, stdio: 'inherit' });
fs.rmSync(stageRoot, { recursive: true, force: true });
console.log('packaged: ' + zip);
