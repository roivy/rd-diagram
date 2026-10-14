import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

// Renders an example with the real renderer, then drives the edit overlay in
// a real browser over CDP: mode toggle, synthetic drag, tidy snapping,
// Ctrl+wheel zoom, double-click fit.
async function withPage(file, fn) {
  const { desktopBrowser } = await import('./helpers/desktop-browser.mjs');
  const browser = desktopBrowser(process.env.RD_CHROME);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: pathToFileURL(file).href });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (state.result?.value === 'complete') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const probe = await send('Runtime.evaluate', { expression: 'typeof Roivy !== "undefined" && typeof Roivy.editOverlay', returnByValue: true });
      if (probe.result?.value === 'object') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description || 'page error');
      return result.result?.value;
    };
    return await fn({ send, evaluate });
  } finally {
    await browser.close();
  }
}

test('rd-edit-overlay: drag, tidy, zoom and fit work in a real browser', { timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-edit-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const artifact = path.join(dir, 'edit.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/robot-dfmea.architecture.json'),
    artifact,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  await withPage(artifact, async ({ evaluate }) => {
    assert.equal(await evaluate('!!document.getElementById("rd-edit-bar")'), true, 'toolbar exists');
    assert.equal(await evaluate('typeof Roivy.editOverlay === "object"'), true, 'overlay API exists');

    // Enter edit mode.
    document_click: {
      evaluate('document.querySelector("#rd-edit-bar [data-act=mode]").click()');
    }
    assert.equal(await evaluate('document.documentElement.getAttribute("data-rd-edit-mode")'), 'on', 'edit mode on');

    // Synthetic drag on the first node group: pointerdown -> moves -> up.
    const dragged = await evaluate(`(() => {
      const group = document.querySelector('.diagram-container svg [data-node-id]');
      const rect = group.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type, px, py) => group.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, button: 0, isPrimary: true,
      }));
      fire('pointerdown', x, y);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 41, clientY: y + 29, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 41, clientY: y + 29, pointerId: 1 }));
      return { dx: parseFloat(group.getAttribute('data-rd-edit-dx')), dy: parseFloat(group.getAttribute('data-rd-edit-dy')) };
    })()`);
    assert.equal(typeof dragged.dx, 'number', 'drag wrote dx');
    assert.ok(dragged.dx % 8 === 0 && dragged.dx >= 24 && dragged.dy % 8 === 0 && dragged.dy >= 16, `drag distance recorded with snap: ${JSON.stringify(dragged)}`);

    // Tidy snaps to the 16px grid.
    const snapped = await evaluate(`(() => {
      Roivy.editOverlay.tidy();
      const group = document.querySelector('.diagram-container svg [data-node-id]');
      return { dx: parseFloat(group.getAttribute('data-rd-edit-dx')), dy: parseFloat(group.getAttribute('data-rd-edit-dy')) };
    })()`);
    assert.equal(snapped.dx % 16, 0, 'dx snapped to 16px grid');
    assert.equal(snapped.dy % 16, 0, 'dy snapped to 16px grid');

    // Ctrl+wheel zoom changes the container transform; double-click fits.
    const zoomed = await evaluate(`(() => {
      const container = document.querySelector('.diagram-container');
      container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 400, clientY: 300, deltaY: -120 }));
      return container.style.transform;
    })()`);
    assert.match(zoomed, /scale\(/, 'ctrl+wheel applied a zoom transform');
    const fit = await evaluate(`Roivy.editOverlay.fitZoom(); document.querySelector('.diagram-container').style.transform`);
    assert.match(fit, /scale\(1\)/, 'fit resets the zoom');

    // Overrides round-trip.
    const overrides = await evaluate('JSON.stringify(Roivy.editOverlay.overrides())');
    const parsed = JSON.parse(overrides);
    assert.ok(Object.keys(parsed).length >= 1, 'overrides recorded');
    assert.ok(Object.values(parsed).some((entry) => typeof entry.dx === 'number'), 'override carries geometry');
  });
});
