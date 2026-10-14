import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const child = path.join(skillRoot, 'scripts', 'delivery-update-child.mjs');

// (Roivy fork) The update channel is permanently offline in production: the
// delivery child must never perform network access, and with no cached
// candidate it must resolve to a silent/no-update outcome.

test('rd-update-offline: delivery child performs no network access and reports no update', { timeout: 30000 }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-offline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fetchCalls = path.join(root, 'fetch-calls');
  const preload = path.join(root, 'tripwire-fetch.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = () => {
  fs.appendFileSync(${JSON.stringify(fetchCalls)}, 'x');
  throw new Error('network access must never happen in the offline fork');
};
`);
  // The child expects an hrtime.bigint()-based deadline in nanoseconds.
  const deadlineNs = process.hrtime.bigint() + 10_000_000_000n;
  const result = spawnSync(process.execPath, [child, deadlineNs.toString()], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      RD_UPDATE_CACHE_DIRECTORY: path.join(root, 'cache'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'silent', `expected silent, got ${JSON.stringify(payload)}`);
  const networkCalls = fs.existsSync(fetchCalls) ? fs.readFileSync(fetchCalls, 'utf8') : '';
  assert.equal(networkCalls, '', 'network access must never happen');
});
