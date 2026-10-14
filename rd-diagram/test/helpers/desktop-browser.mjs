import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../../bin/visual-check.mjs';

// Test-only Blink settings: headless hosts may have no physical mouse.
// Disabling touch emulation would restore those host defaults and undo this.
const pointerSettings = '--blink-settings=availableHoverTypes=2,primaryHoverType=2,availablePointerTypes=4,primaryPointerType=4';

export function desktopBrowser(chrome) {
  // Plain `npm test` does not export RD_CHROME (only run-browser-tests.mjs
  // does), so fall back to the standard executable search before spawning.
  const resolved = chrome || findChrome();
  if (!resolved) throw new Error('No Chrome/Chromium executable found; set RD_CHROME.');
  return new ChromeVisualBrowser(resolved, {
    spawnImpl: (command, args, options) => spawn(command, [pointerSettings, ...args], options),
  });
}

export async function desktopPointerCheck(browser, session) {
  const version = await browser.cdp.send('Browser.getVersion');
  await browser.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => {
      // Capture the native query before controlled coarse-pointer fixtures run.
      const query = window.matchMedia.bind(window);
      const sample = () => ({
        hover: query('(hover: hover)').matches,
        fine: query('(pointer: fine)').matches,
        combined: query('(hover: hover) and (pointer: fine)').matches,
        anyHover: query('(any-hover: hover)').matches,
        anyFine: query('(any-pointer: fine)').matches,
        maxTouchPoints: navigator.maxTouchPoints,
      });
      window.__rdTestPointer = { initial: sample(), sample };
    })();
  ` }, session);
  return async function checkDesktopPointer() {
    const result = await browser.cdp.send('Runtime.evaluate', {
      expression: '({initial:__rdTestPointer.initial,current:__rdTestPointer.sample()})',
      returnByValue: true,
    }, session);
    assert.equal(result.exceptionDetails, undefined, 'Desktop pointer diagnostics did not initialize');
    const samples = result.result.value;
    for (const phase of ['initial', 'current']) {
      for (const capability of ['hover', 'fine', 'combined', 'anyHover', 'anyFine']) {
        assert.equal(samples[phase][capability], true,
          `Desktop pointer capability ${phase}.${capability}: ${JSON.stringify({
            browser: version.product, platform: process.platform, pointerSettings, samples,
          })}`);
      }
    }
  };
}
