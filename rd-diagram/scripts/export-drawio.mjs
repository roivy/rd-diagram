#!/usr/bin/env node
// rd export drawio <type> <input.json> [output.drawio] [--theme light|dark] [--json]
//
// Renders the input through the existing renderer (subprocess, temp HTML —
// never a second rendering path), extracts the semantic SVG geometry, and
// emits an uncompressed, deterministic .drawio (mxGraph XML) file.
//
// Exit codes follow the CLI convention: 0 success, 1 render/geometry
// failure, 2 usage. Output files are written atomically (temp + rename on
// the same volume); a rejected geometry never leaves a partial file behind.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { exportDrawio, DRAWIO_TYPES } from '../renderers/shared/drawio/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function usage() {
  return [
    'Usage:',
    '  rd export drawio <type> <input.json> [output.drawio] [--theme light|dark] [--json]',
    '',
    `Types: ${DRAWIO_TYPES.join(', ')}`,
  ].join('\n');
}

const rawArgs = process.argv.slice(2);
const knownOptions = new Set(['--theme', '--json']);
const positional = [];
const options = { json: false, theme: 'light' };
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
  if (arg === '--theme') {
    const value = rawArgs[i + 1];
    if (value !== 'light' && value !== 'dark') fail('Unknown export theme. Expected: --theme light|dark');
    options.theme = value;
    i += 1;
  } else if (arg === '--json') {
    options.json = true;
  } else if (arg.startsWith('--')) {
    fail(`Unknown export option "${arg}"`);
  } else {
    positional.push(arg);
  }
}

const [type, inputPath, outputArg] = positional;
if (!type || !inputPath) fail(usage());
if (!DRAWIO_TYPES.includes(type)) fail(`Unsupported diagram type "${type}". Supported: ${DRAWIO_TYPES.join(', ')}`);
if (positional.length > 3) fail(usage());
if (!fs.existsSync(inputPath)) fail(`Input not found: ${inputPath}`);

let sourceTitle = 'Diagram';
try {
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (parsed?.meta?.title) sourceTitle = parsed.meta.title;
} catch {
  fail(`Input could not be read as JSON: ${inputPath}`, 1);
}

const outputBase = inputPath.replace(/\.[^.\\/]+$/, '');
const outputPath = path.resolve(outputArg || `${outputBase}.drawio`);

const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
if (!fs.existsSync(renderer)) fail(`Renderer missing for type "${type}"`, 1);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-drawio-'));
const tempHtml = path.join(tempDirectory, 'artifact.html');
try {
  const rendered = spawnSync(process.execPath, [renderer, inputPath, tempHtml], {
    encoding: 'utf8',
    env: { ...process.env, RD_DIAGNOSTIC_FORMAT: 'json' },
  });
  if (rendered.status !== 0 || !fs.existsSync(tempHtml)) {
    process.stderr.write(rendered.stderr || rendered.stdout || 'Renderer failed without output.\n');
    process.exit(rendered.status === 0 ? 1 : rendered.status);
  }
  const html = fs.readFileSync(tempHtml, 'utf8');

  let result;
  try {
    result = exportDrawio(html, { type, title: sourceTitle, theme: options.theme });
  } catch (error) {
    fail(error.message, 1);
  }

  const stagePath = `${outputPath}.rd-stage-${process.pid}`;
  fs.writeFileSync(stagePath, result.xml, 'utf8');
  fs.renameSync(stagePath, outputPath);

  if (options.json) {
    const receipt = {
      schemaVersion: 1,
      ok: true,
      command: 'export',
      format: 'drawio',
      type,
      input: inputPath,
      output: outputPath,
      theme: options.theme,
      bytes: Buffer.byteLength(result.xml, 'utf8'),
      sha256: createHash('sha256').update(result.xml, 'utf8').digest('hex'),
      stats: result.stats,
    };
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } else {
    process.stdout.write(`${outputPath}\n`);
  }
  process.exit(0);
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
