// Deck page-effect engine.
//  - Cover: builds the eight diagram-type chips and drifting particles; every
//    other cover motion is pure CSS (grid floor, beams, orbit, shimmer).
//  - Page entry: hooks the deck's render() so every flip re-plays the native
//    viewer's ambient trace animation inside the newly active slide's iframes.
//    Chrome blocks a file:// parent from touching iframe.contentDocument
//    (opaque "null" origins), so effects travel by postMessage to the bridge
//    script the deck builder injects into each demo page; postMessage to a
//    cross-origin frame is always allowed. The roster slide also gets a
//    top-to-bottom light sweep across the page itself.
(function () {
  // === Cover: chips + particles ===
  var TYPES = [
    ['ARCH', '架构图 · DFMEA'], ['FLOW', '工作流'], ['SEQ', '时序图'], ['DATA', '数据流'],
    ['STATE', '状态机'], ['FA', '鱼骨图失效分析'], ['MIND', '思维导图'], ['TEAM', '花名册'],
  ];
  var chips = document.getElementById('cover-chips');
  if (chips) {
    TYPES.forEach(function (type, i) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.style.animationDelay = (0.65 + i * 0.09) + 's';
      var em = document.createElement('em');
      em.textContent = type[0];
      chip.appendChild(em);
      chip.appendChild(document.createTextNode(type[1]));
      chips.appendChild(chip);
    });
  }
  var stars = document.getElementById('cover-stars');
  if (stars) {
    for (var i = 0; i < 26; i++) {
      var dot = document.createElement('i');
      dot.style.left = (Math.random() * 100).toFixed(2) + '%';
      dot.style.top = (25 + Math.random() * 75).toFixed(2) + '%';
      dot.style.animationDuration = (4 + Math.random() * 5).toFixed(2) + 's';
      dot.style.animationDelay = (Math.random() * 6).toFixed(2) + 's';
      dot.style.transform = 'scale(' + (0.6 + Math.random()).toFixed(2) + ')';
      stars.appendChild(dot);
    }
  }

  // === Page effects over postMessage ===
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));

  function fire(frame) {
    try { frame.contentWindow.postMessage({ type: 'rd-deck-fx' }, '*'); } catch (e) {}
  }
  function activeSlide() { return slides[window.current | 0] || null; }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'rd-deck-ready') {
      // Match the announcing frame by window identity: share bundles load
      // pages into srcdoc iframes that carry no src to compare against.
      var frames = document.querySelectorAll('.slide iframe');
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow === event.source) {
          frames[i].setAttribute('data-rd-ready', '1');
          var active = activeSlide();
          if (active && active.contains(frames[i])) fire(frames[i]);
          break;
        }
      }
    } else if (data.type === 'rd-deck-state' && window.__deckStateSink) {
      window.__deckStateSink(data.state);
    }
  });

  // Probe API for automated verification: ask every frame of a slide to report
  // its live animation/index state through the bridge.
  window.__deckProbe = function (index) {
    return new Promise(function (resolve) {
      var slide = slides[index];
      var frames = slide ? Array.prototype.slice.call(slide.querySelectorAll('iframe')) : [];
      var states = [];
      var settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        window.__deckStateSink = null;
        resolve({ sweep: slide ? slide.classList.contains('fx-sweep') : false, frames: states });
      }
      if (!frames.length) { finish(); return; }
      window.__deckStateSink = function (state) {
        states.push(state);
        if (states.length >= frames.length) finish();
      };
      frames.forEach(function (frame) {
        try { frame.contentWindow.postMessage({ type: 'rd-deck-probe', nonce: 1 }, '*'); } catch (e) {}
      });
      setTimeout(finish, 3500);
    });
  };

  // === Hook the deck navigation: every render() re-arms the page effects ===
  var deckRender = window.render;
  if (typeof deckRender === 'function') {
    window.render = function () {
      deckRender.apply(null, arguments);
      var slide = activeSlide();
      if (!slide) return;
      // Slide 1 is the roster page: its entry adds the top-to-bottom sweep.
      var sweep = (window.current | 0) === 1;
      if (sweep) {
        slide.classList.remove('fx-sweep');
        void slide.offsetWidth;
        slide.classList.add('fx-sweep');
      }
      Array.prototype.forEach.call(slide.querySelectorAll('iframe'), function (frame) {
        if (frame.getAttribute('data-rd-ready')) fire(frame);
      });
    };
  }
})();
