import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const demoDir = path.join(repoRoot, '.rd', 'demo');

async function withPage(file, fn) {
  const { desktopBrowser } = await import('./helpers/desktop-browser.mjs');
  const browser = desktopBrowser(process.env.RD_CHROME);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    await send('Page.enable');
    await send('Page.navigate', { url: pathToFileURL(file).href + '?cb=' + Date.now() });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (state.result?.value === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const probe = await send('Runtime.evaluate', {
        expression: 'typeof Roivy !== "undefined" && typeof Roivy.editOverlay',
        returnByValue: true,
      });
      if (probe.result?.value === 'object') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description || 'page error');
      return result.result?.value;
    };
    return await fn({ evaluate });
  } finally {
    await browser.close();
  }
}

test('file-as-database: artifacts embed rd-source-data with source and empty history', () => {
  const html = fs.readFileSync(path.join(demoDir, '00-roster.html'), 'utf8');
  const m = html.match(/<script id="rd-source-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'rd-source-data present');
  const payload = JSON.parse(m[1]);
  assert.equal(payload.schema, 'rd-source/1');
  assert.equal(payload.diagram_type || payload.source?.diagram_type, 'roster');
  assert.ok(Array.isArray(payload.history) && payload.history.length === 0, 'fresh artifact starts with empty history');
});

test('file-as-database: edit then save captures history + folds overrides into source', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const result = await evaluate(`(() => {
      document.querySelector('#rd-edit-bar [data-act=mode]').click();
      const group = document.querySelector('[data-node-id="fangqi"]');
      const rect = group.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type, px, py) => group.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, button: 0, isPrimary: true }));
      fire('pointerdown', x, y);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 50, clientY: y + 30, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 50, clientY: y + 30, pointerId: 1 }));
      const saved = Roivy.editOverlay.buildSavedHtml();
      return {
        historyLen: saved.payload.history.length,
        label: saved.payload.history[0]?.label || '',
        movedId: Object.keys(saved.payload.source.layout_overrides || {})[0],
        movedDx: (saved.payload.source.layout_overrides || {}).fangqi?.dx,
        svgCarried: saved.html.includes('data-node-id="fangqi"'),
        doctypeFirst: saved.html.startsWith('<!DOCTYPE html>'),
        runtimePanelStripped: !saved.html.includes('id="rd-detail-panel"'),
        hoverAttrStripped: !/\sdata-rd-hover="1"/.test(saved.html),
        historyBtnPresent: saved.html.includes('data-act="history"'),
      };
    })()`);
    assert.ok(result.historyLen >= 1, 'pre-save snapshot entered history');
    assert.match(result.label, /初始版本|微调|上一版本/);
    assert.equal(result.movedId, 'fangqi');
    assert.ok(Math.abs(result.movedDx - 48) <= 8, `snap dx ≈ 48 (got ${result.movedDx})`);
    assert.ok(result.svgCarried && result.doctypeFirst, 'serialized doc carries svg + doctype');
    assert.ok(result.runtimePanelStripped && result.hoverAttrStripped, 'runtime chrome stripped');
    assert.ok(result.historyBtnPresent, 'history button persisted');
  });
});

test('file-as-database: history panel lists snapshots and restore rolls the svg back', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const result = await evaluate(`(() => {
      const before = document.querySelector('[data-node-id="fangqi"]').outerHTML.length;
      // drag + save payload (capture history entry with the pre-drag state)
      document.querySelector('#rd-edit-bar [data-act=mode]').click();
      const group = document.querySelector('[data-node-id="fangqi"]');
      const rect = group.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type, px, py) => group.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, button: 0, isPrimary: true }));
      fire('pointerdown', x, y);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 64, clientY: y + 40, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 64, clientY: y + 40, pointerId: 1 }));
      Roivy.editOverlay.buildSavedHtml();
      // open panel and restore entry 0
      Roivy.editOverlay.showHistory();
      const items = document.querySelectorAll('#rd-history-list .rd-history-item');
      const count = items.length;
      if (!count) return { error: 'no history items' };
      items[count - 1].click();
      const restored = document.querySelector('[data-node-id="fangqi"]');
      return { count, dirty: document.getElementById('rd-edit-bar').getAttribute('data-dirty'),
        transformGone: !restored.getAttribute('transform'), sizeChanged: Math.abs(restored.outerHTML.length - before) < 40 };
    })()`);
    assert.ok(!result.error, result.error || 'ok');
    assert.ok(result.count >= 1, 'history panel lists entries');
    assert.equal(result.dirty, '1', 'restore marks the file dirty (needs one save)');
    assert.ok(result.transformGone, 'node transform rolled back');
  });
});
