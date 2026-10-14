#!/usr/bin/env node
// Deck verification: drives the real deck in Chrome over CDP — flips every
// slide, then checks, per slide, that the page-enter engine actually fired:
//   - the active slide's iframes replay the ambient trace animation
//     (data-ambient-motion back to "running" with a live CSS animation),
//   - the node index rail is visible (grouped headings where authored),
//   - the roster slide carries the top-to-bottom sweep,
// and captures screenshots for human review.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../rd-diagram/bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const share = process.argv[2] === 'share';
const deckPath = path.resolve(__dirname, '..', 'demo', share ? 'index_share.html' : 'index.html');
const shotDir = path.resolve(__dirname, '..', 'demo', 'shots' + (share ? '-share' : ''));
fs.mkdirSync(shotDir, { recursive: true });

const browser = new ChromeVisualBrowser(findChrome());
const results = [];
let failures = 0;
function record(name, ok, detail) {
  results.push(`${ok ? '  ok   ' : '  FAIL '}${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

async function evaluate(sessionId, expression, awaitPromise = true) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function slideProbe(sessionId, index) {
  // Flip the slide, give the entry effects time to run, then collect every
  // iframe's live state through the deck's postMessage probe bridge.
  await evaluate(sessionId, `(function () {
    current = ${index};
    render();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 2600));
  return evaluate(sessionId, `window.__deckProbe(${index})`);
}

async function screenshot(sessionId, name) {
  const capture = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const out = path.join(shotDir, name + '.png');
  fs.writeFileSync(out, Buffer.from(capture.data, 'base64'));
  return out;
}

const sessionId = await browser.sessionPromise;
await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
}, sessionId);
const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
loaded.catch(() => {});
await browser.cdp.send('Page.navigate', { url: pathToFileURL(deckPath).href }, sessionId);
await loaded;
await new Promise((r) => setTimeout(r, share ? 4200 : 2200));

if (!share) {
  // Local browsers may serve the deck's iframes from disk cache (stale HTML
  // after a rebuild); reload each with a cache-busting query.
  await evaluate(sessionId, `(function () {
    document.querySelectorAll('.slide iframe').forEach(function (frame) {
      frame.src = frame.getAttribute('src').split('?')[0] + '?cb=' + Date.now();
    });
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
}

if (share) {
  // Share bundle specifics: encrypted payload loaded into srcdoc, no page
  // plaintext in the shell, AI/prohibition markers present.
  const shell = fs.readFileSync(deckPath, 'utf8');
  record('share: no page plaintext (Chinese content only inside payload)',
    !/指挥部|陈锋|生产失败/.test(shell));
  record('share: AI opt-out meta tags', /name="noai"/.test(shell) && /name="noimageai"/.test(shell));
  record('share: robots noarchive', /noarchive/.test(shell));
  record('share: prohibition banner', /反向工程/.test(shell) && /prohibited/.test(shell));
  const mounted = await evaluate(sessionId, `(function () {
    var f = document.querySelector('iframe[data-rd-p]');
    return { any: !!f, loaded: f ? (f.getAttribute('srcdoc') || '').length : 0, count: document.querySelectorAll('iframe[data-rd-p]').length };
  })()`);
  record('share: 10 encrypted slots mounted', mounted.count === 10, String(mounted.count));
  record('share: srcdoc decrypted and populated', mounted.loaded > 100000, String(mounted.loaded));
}

// --- Slide 0: pure-tech cover ---
const cover = await evaluate(sessionId, `(function () {
  return {
    chips: document.querySelectorAll('.chip').length,
    stars: document.querySelectorAll('.cover-stars i').length,
    iframes: document.querySelectorAll('.slide:nth-child(2) iframe, .slide.active iframe').length,
    beamAnim: getComputedStyle(document.querySelector('.cover-beam')).animationName,
    gridAnim: getComputedStyle(document.querySelector('.cover-grid')).animationName,
    orbitAnim: getComputedStyle(document.querySelector('.cover-orbit .r2')).animationName,
  };
})()`);
record('cover: 8 type chips', cover.chips === 8, JSON.stringify(cover.chips));
record('cover: particles drifting', cover.stars >= 20, String(cover.stars));
record('cover: zero iframes', cover.iframes === 0, String(cover.iframes));
record('cover: beam spinning', cover.beamAnim === 'rdBeamSpin', cover.beamAnim);
record('cover: grid scrolling', cover.gridAnim === 'rdGridScroll', cover.gridAnim);
record('cover: orbit rotating', cover.orbitAnim === 'rdSpin', cover.orbitAnim);
await screenshot(sessionId, 'slide-00-cover');

// --- Slides 1..9 ---
const expectations = [
  { name: 'roster', groups: ['指挥部', '硬件组', '软件组'], sweep: true },
  { name: 'dfmea' },
  { name: 'mainboard' },
  { name: 'fa-dual', frames: 2, groupSets: [['人', '机', '料', '法', '环', '测'], ['攻坚', '关闭']] },
  { name: 'mindmap', minGroups: 6 },
  { name: 'workflow' },
  { name: 'sequence' },
  { name: 'dataflow' },
  { name: 'lifecycle' },
];
for (let i = 0; i < expectations.length; i++) {
  const expect = expectations[i];
  const probe = await slideProbe(sessionId, i + 1);
  const label = `slide ${i + 1} (${expect.name})`;
  record(`${label}: ${expect.frames || 1} frame(s)`, probe.frames.length === (expect.frames || 1), String(probe.frames.length));
  probe.frames.forEach((frame, j) => {
    const tag = expect.frames === 2 ? (j === 0 ? 'fishbone' : '8d') : expect.name;
    const groups = Array.isArray(frame.groups) ? frame.groups : [];
    record(`${label} [${tag}] trace replayed`, frame.ambient === 'running', String(frame.ambient));
    record(`${label} [${tag}] edge flow live`, frame.edgeAnim === 'rd-edge-flow', String(frame.edgeAnim));
    record(`${label} [${tag}] node pulse live`, frame.nodeAnim === 'rd-node-pulse', String(frame.nodeAnim));
    record(`${label} [${tag}] node index visible`, frame.outlineVisible === true,
      `rail=${frame.rail} count=${frame.outlineCount}`);
    if (expect.groups) {
      const missing = expect.groups.filter((g) => !groups.includes(g));
      record(`${label} [${tag}] index grouped (${expect.groups.join('/')})`, missing.length === 0,
        groups.join(','));
    }
    if (expect.groupSets) {
      const wanted = expect.groupSets[j] || [];
      const missing = wanted.filter((g) => !groups.includes(g));
      record(`${label} [${tag}] index grouped (${wanted.join('/')})`, missing.length === 0,
        groups.join(','));
    }
    if (expect.minGroups) {
      record(`${label} [${tag}] index grouped >= ${expect.minGroups}`, groups.length >= expect.minGroups,
        groups.join(','));
    }
  });
  if (expect.sweep) record(`${label}: top-bottom sweep armed`, probe.sweep === true);
  await screenshot(sessionId, 'slide-' + String(i + 1).padStart(2, '0') + '-' + expect.name);
}

console.log(results.join('\n'));
console.log(failures === 0 ? `\nDECK VERIFIED — ${results.length} checks passed` : `\n${failures} check(s) FAILED`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
