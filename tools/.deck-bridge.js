/* Roivy deck bridge — injected into demo page copies by tools/build_hero_deck.py.
   Chrome treats a file:// parent's access to iframe.contentDocument as
   cross-origin (opaque "null" origin), so the deck cannot script its pages
   directly. Instead the deck posts messages (always allowed) and this bridge
   performs the effects inside the page's own document. Inert when the
   artifact is opened standalone. */
(function () {
  function replay() {
    var root = document.documentElement;
    root.removeAttribute('data-ambient-motion');
    root.removeAttribute('data-ambient-settle-reason');
    void document.body.offsetHeight;
    root.setAttribute('data-ambient-motion', 'running');
  }
  function ensureIndex() {
    var root = document.documentElement;
    // data-rd-force-rail survives reader-layout remeasures even inside
    // sub-desktop-width iframes (a directly-set data-reader-rail would be
    // cleared by the next measure); the direct attribute plus a scheduled
    // measure apply it immediately instead of waiting for an unrelated DOM
    // change to trigger a remeasure.
    root.setAttribute('data-rd-force-rail', 'bottom');
    root.setAttribute('data-reader-rail', 'bottom');
    var outline = document.getElementById('node-outline');
    if (outline && outline.hidden) outline.hidden = false;
    if (window.Roivy && Roivy.readerLayout && typeof Roivy.readerLayout.schedule === 'function') {
      Roivy.readerLayout.schedule();
    }
  }
  function state() {
    var edge = document.querySelector('[data-animate="edge"]');
    var node = document.querySelector('[data-animate="node"]');
    var outline = document.getElementById('node-outline');
    return {
      src: location.href,
      ambient: document.documentElement.getAttribute('data-ambient-motion'),
      rail: document.documentElement.getAttribute('data-reader-rail'),
      edgeAnim: edge ? getComputedStyle(edge).animationName : null,
      nodeAnim: node ? getComputedStyle(node).animationName : null,
      outlineVisible: outline ? (!outline.hidden && getComputedStyle(outline).display !== 'none') : false,
      groups: Array.prototype.slice.call(outline ? outline.querySelectorAll('.node-outline-heading span') : [])
        .map(function (span) { return span.textContent; }).slice(0, 10),
      outlineCount: outline ? outline.querySelectorAll('.node-outline-item').length : 0,
    };
  }
  function announce() {
    try { window.parent.postMessage({ type: 'rd-deck-ready', src: location.href }, '*'); } catch (e) {}
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'rd-deck-fx') { ensureIndex(); replay(); }
    else if (data.type === 'rd-deck-probe') {
      try { window.parent.postMessage({ type: 'rd-deck-state', state: state(), nonce: data.nonce }, '*'); } catch (e) {}
    }
  });
  if (document.readyState === 'complete') announce();
  else window.addEventListener('load', announce);
})();
