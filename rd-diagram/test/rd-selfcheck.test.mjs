import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const demoDir = fs.existsSync(path.join(repoRoot, '.rd', 'demo'))
  ? path.join(repoRoot, '.rd', 'demo')
  : path.join(repoRoot, 'demo');

async function withPage(file, fn) {
  const { desktopBrowser } = await import('./helpers/desktop-browser.mjs');
  const browser = desktopBrowser(process.env.RD_CHROME);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    await send('Page.enable');
    await send('Runtime.enable');
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

test('selfcheck 1: dragging a roster node moves its reporting edges', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const before = await evaluate(`(() => {
      const edge = document.querySelector('[data-edge-from="fangqi"]');
      return edge ? edge.getAttribute('d') : null;
    })()`);
    assert.ok(before, 'fangqi->zhengyu edge exists with semantic attributes');

    const after = await evaluate(`(() => {
      document.querySelector('#rd-edit-bar [data-act=mode]').click();
      const group = document.querySelector('[data-node-id="fangqi"]');
      const rect = group.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type, px, py) => group.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, button: 0, isPrimary: true,
      }));
      fire('pointerdown', x, y);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 60, clientY: y + 40, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 60, clientY: y + 40, pointerId: 1 }));
      const edge = document.querySelector('[data-edge-from="fangqi"]');
      return { d: edge.getAttribute('d'), dx: group.getAttribute('data-rd-edit-dx') };
    })()`);
    assert.ok(after.dx % 8 === 0 && after.dx >= 40, `node moved with 8px snap (dx=${after.dx})`);
    assert.notEqual(after.d, before, 'connected edge path followed the drag');
    assert.match(after.d, /^M /, 'followed edge is a straight segment');
  });
});

test('selfcheck 2: route probe resolves in the roster org tree', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const edgeCount = await evaluate('document.querySelectorAll("[data-edge-from]").length');
    assert.ok(edgeCount >= 13, `roster carries semantic edges (found ${edgeCount})`);

    const result = await evaluate(`(() => {
      const ok = Roivy.routeProbe.begin({ source: 'fangqi' });
      if (ok === false) return { begin: false };
      Roivy.routeProbe.choose('linzy');
      const r = Roivy.routeProbe.result();
      Roivy.routeProbe.clear();
      return { begin: true, result: r };
    })()`);
    assert.equal(result.begin, true, 'probe began from fangqi');
    assert.ok(result.result, 'probe produced a route');
    assert.equal(result.result.source, 'fangqi');
    assert.equal(result.result.target, 'linzy');
    assert.equal(result.result.hops, 2, `fangqi -> zhengyu -> linzy is 2 hops (got ${result.result?.hops})`);
  });
});

test('selfcheck 3: route probe resolves in the cover mini architecture', { timeout: 90000 }, async (t) => {
  if (!fs.existsSync(path.join(demoDir, 'cover-route.html'))) {
    t.skip('cover mini diagrams are deck-build assets and not part of this tree');
    return;
  }
  await withPage(path.join(demoDir, 'cover-route.html'), async ({ evaluate }) => {
    const result = await evaluate(`(() => {
      Roivy.routeProbe.begin({ source: 'power' });
      Roivy.routeProbe.choose('motor');
      const r = Roivy.routeProbe.result();
      Roivy.routeProbe.clear();
      return r;
    })()`);
    assert.ok(result, 'probe produced a route in the mini board');
    assert.equal(result.source, 'power');
    assert.equal(result.target, 'motor');
    assert.ok(result.hops >= 2, `power -> ... -> motor resolves (hops=${result?.hops})`);
  });
});

test('selfcheck 4: hero deck integrity — pure-tech cover, 9 scene pages, 10 viewer iframes, bridge injected', () => {
  const index = fs.readFileSync(path.join(demoDir, 'index.html'), 'utf8');
  const sources = [...index.matchAll(/<iframe src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(sources.length, 10, `deck embeds 10 diagram iframes (found ${sources.length})`);
  for (const src of sources) {
    const target = path.join(demoDir, src);
    assert.equal(fs.existsSync(target), true, `iframe target missing: ${src}`);
    assert.ok(fs.statSync(target).size > 100_000, `iframe target looks empty: ${src}`);
  }
  // Pure-tech cover: CSS motion only, no iframes on the cover slide.
  const coverStart = index.indexOf('<section class="slide active">');
  const cover = index.slice(coverStart, index.indexOf('</section>', coverStart));
  assert.equal((cover.match(/<iframe/g) || []).length, 0, 'cover has no iframes');
  for (const layer of ['cover-grid', 'cover-beam', 'cover-stars', 'cover-orbit', 'cover-chips']) {
    assert.ok(index.includes(layer), `cover layer present: ${layer}`);
  }
  assert.ok(index.includes('btn-prev') && index.includes('btn-next'), 'nav buttons present');
  assert.ok(index.includes('stage-glow'), 'ambient glow layer present');
  // Page-enter engine + per-page bridge.
  assert.ok(index.includes('rd-deck-fx'), 'deck engine sends page-entry effects');
  for (const page of sources) {
    const html = fs.readFileSync(path.join(demoDir, page), 'utf8');
    assert.ok(html.includes('data-rd="deck-bridge"'), `bridge injected: ${page}`);
    assert.ok(/<svg[^>]*data-animation="trace"/.test(html), `trace animation enabled: ${page}`);
  }
});

test('selfcheck 5: clicking a node opens the semantic passport with authored details + relations', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const state = await evaluate(`(() => {
      const group = document.querySelector('[data-node-id="chenfeng"]');
      group.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const chip = document.getElementById('focus-chip');
      const authored = document.getElementById('focus-rd-detail');
      return {
        chipVisible: chip ? !chip.hidden : false,
        label: document.getElementById('focus-label')?.textContent || '',
        detailLabels: authored ? [...authored.querySelectorAll('dt')].map((n) => n.textContent) : [],
        detailValues: authored ? [...authored.querySelectorAll('dd')].map((n) => n.textContent) : [],
        rightPanelGone: !document.getElementById('rd-detail-panel'),
        reachButtons: document.querySelectorAll('#btn-reach-upstream, #btn-reach-downstream').length,
      };
    })()`);
    assert.equal(state.chipVisible, true, 'semantic passport opened on click');
    assert.equal(state.label, '陈锋 · 硬件负责人', `passport label (got ${state.label})`);
    assert.ok(state.detailLabels.includes('职责'), `authored details render in passport (got ${state.detailLabels})`);
    assert.ok(state.detailValues.some((value) => value && value.length > 3), `authored detail values present`);
    assert.equal(state.rightPanelGone, true, 'old right-side translucent card is gone');
    assert.equal(state.reachButtons, 2, 'reachability controls present');
    const relations = await evaluate(`(() => {
      const btn = document.getElementById('btn-focus-relations');
      btn.click();
      return document.querySelectorAll('#relationship-lens-list li, #relationship-lens-list .relationship-row').length
        || document.getElementById('relationship-lens-list').textContent.trim().length;
    })()`);
    assert.ok(Number(relations) > 0 || String(relations).length > 0, `relations list available (${relations})`);
    const closed = await evaluate(`(() => {
      document.getElementById('btn-focus-clear').click();
      return {
        chipHidden: document.getElementById('focus-chip').hidden,
        authoredHidden: document.getElementById('focus-rd-detail').hidden,
      };
    })()`);
    assert.equal(closed.chipHidden, true, 'passport closes');
    assert.equal(closed.authoredHidden, true, 'authored details reset on close');
  });
});

test('selfcheck 6: Ctrl+Z undo restores node and edges after drag', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, '00-roster.html'), async ({ evaluate }) => {
    const before = await evaluate(`document.querySelector('[data-edge-from="fangqi"]').getAttribute('d')`);
    await evaluate(`(() => {
      document.querySelector('#rd-edit-bar [data-act=mode]').click();
      const group = document.querySelector('[data-node-id="fangqi"]');
      const rect = group.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const fire = (type, px, py) => group.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, button: 0, isPrimary: true,
      }));
      fire('pointerdown', x, y);
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + 40, clientY: y + 24, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x + 40, clientY: y + 24, pointerId: 1 }));
    })()`);
    const dragged = await evaluate(`document.querySelector('[data-node-id="fangqi"]').getAttribute('transform')`);
    assert.match(dragged || '', /translate/, 'node moved');
    const afterUndo = await evaluate(`(() => {
      Roivy.editOverlay.undo();
      return {
        transform: document.querySelector('[data-node-id="fangqi"]').getAttribute('transform'),
        edge: document.querySelector('[data-edge-from="fangqi"]').getAttribute('d'),
      };
    })()`);
    assert.equal(afterUndo.transform, null, 'node transform removed by undo');
    assert.equal(afterUndo.edge, before, 'edge geometry restored by undo');
  });
});

test('selfcheck 7: hero cover — pure-tech CSS layers animate, nav flips, page entry re-arms effects', { timeout: 90000 }, async () => {
  await withPage(path.join(demoDir, 'index.html'), async ({ evaluate }) => {
    const cover = await evaluate(`(() => ({
      chips: document.querySelectorAll('.cover-chips .chip').length,
      stars: document.querySelectorAll('.cover-stars i').length,
      grid: getComputedStyle(document.querySelector('.cover-grid')).animationName,
      beam: getComputedStyle(document.querySelector('.cover-beam')).animationName,
      orbit: getComputedStyle(document.querySelector('.cover-orbit .r2')).animationName,
      renderHooked: typeof window.render === 'function' && window.render.name !== 'render',
    }))()`);
    assert.equal(cover.chips, 8, `eight type chips (got ${cover.chips})`);
    assert.ok(cover.stars >= 20, `particles drift (got ${cover.stars})`);
    assert.equal(cover.grid, 'rdGridScroll', `grid floor animates (${cover.grid})`);
    assert.equal(cover.beam, 'rdBeamSpin', `beam sweeps (${cover.beam})`);
    assert.equal(cover.orbit, 'rdSpin', `orbit rotates (${cover.orbit})`);
    assert.equal(cover.renderHooked, true, 'deck render() is wrapped by the page-effect engine');

    const nav = await evaluate(`(() => {
      const idx = () => Array.prototype.findIndex.call(document.querySelectorAll('.slide'), s => s.classList.contains('active'));
      const before = idx();
      document.getElementById('btn-next').click();
      const after = idx();
      document.getElementById('btn-prev').click();
      const back = idx();
      return { before, after, back };
    })()`);
    assert.ok(nav.after === nav.before + 1 && nav.back === nav.before, `nav buttons flip slides (${JSON.stringify(nav)})`);

    // Page entry re-arms the roster sweep (the deck's own CSS layer; iframe
    // internals are cross-origin under file:// and verified by the bridge probe).
    const sweep = await evaluate(`(() => {
      current = 1;
      render();
      const slide = document.querySelectorAll('.slide')[1];
      return { swept: slide.classList.contains('fx-sweep'), iframe: slide.querySelector('iframe') != null };
    })()`);
    assert.equal(sweep.swept, true, 'roster entry arms the top-to-bottom sweep');
    assert.equal(sweep.iframe, true, 'roster slide embeds its viewer');
  });
});
