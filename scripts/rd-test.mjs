#!/usr/bin/env node
// Roivy dev 测试入口：自动解决浏览器探测（上游只认 Chrome，本机用 Edge 时注入
// RD_CHROME）。用法：node ../scripts/rd-test.mjs [任意 node --test 参数]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const skillRoot = path.join(repoRoot, 'rd-diagram');

function findEdge() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of roots) {
    for (const p of [path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                     path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')]) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

const env = { ...process.env };
if (!env.RD_CHROME) {
  const browser = findEdge();
  if (browser) {
    env.RD_CHROME = browser;
    console.log(`rd-test: using browser ${browser}`);
  } else {
    console.log('rd-test: no Chrome/Edge found; browser tests will skip');
  }
}

const result = spawnSync(process.execPath, [path.join(here, 'run-tests.mjs')], {
  cwd: skillRoot,
  stdio: 'inherit',
  env,
});
process.exitCode = result.status ?? 1;
