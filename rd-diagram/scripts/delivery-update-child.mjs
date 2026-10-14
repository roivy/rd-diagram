#!/usr/bin/env node

import { checkForUpdate } from './check-update.mjs';

// The parent can be busy in synchronous renderer work. Enforce its original
// deadline here, in a separate event loop, so cache work cannot continue late.
if (!/^\d{1,30}$/.test(process.argv[2] || '')) process.exit(1);
const deadlineAt = BigInt(process.argv[2]);
const remainingMs = Number(deadlineAt - process.hrtime.bigint()) / 1_000_000;
if (remainingMs <= 0) process.exit(1);
const deadlineTimer = setTimeout(() => process.kill(process.pid, 'SIGKILL'), remainingMs);
deadlineTimer.unref();

const result = await checkForUpdate({
  ...(process.env.RD_UPDATE_RELEASE_PATH
    ? { releasePath: process.env.RD_UPDATE_RELEASE_PATH } : {}),
  ...(process.env.RD_UPDATE_CACHE_DIRECTORY
    ? { cacheDirectory: process.env.RD_UPDATE_CACHE_DIRECTORY } : {}),
  // (Roivy fork) permanent offline policy: the delivery child never performs
  // network access. RD_UPDATE_TEST_NETWORK=1 restores the fetch path for the
  // slow-network regression tests that preload a controlled fetch. (null, not
  // undefined: an explicit undefined would re-arm the globalThis.fetch default.)
  ...(process.env.RD_UPDATE_TEST_NETWORK === '1' ? {} : { fetchImpl: null }),
  // Leave time to record a failed fetch, so a slow network backs off instead
  // of being killed before its result reaches the cache.
  timeoutMs: Math.max(1, Math.floor(remainingMs - 150)),
});
process.stdout.write(`${JSON.stringify(result)}\n`);
