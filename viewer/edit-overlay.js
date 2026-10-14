
    Roivy.editOverlay = (function () {
      // (Roivy fork) Interaction overlay — additive only.
      //  - Node detail lives in the semantic passport (focus chip): authored
      //    details (data-rd-detail) render inside it; the old right-side
      //    translucent card was removed as a duplicate of that surface.
      //  - Edit mode: drag nodes with orthogonal edge re-routing, double-click
      //    to edit label text, grid snap, hover highlight, Ctrl+Z undo.
      //  - Camera: Ctrl+wheel zoom at pointer, double-click blank to fit.
      // Canonical export stays clean: export-cleanup strips data-rd-edit state.
      var zoom = { scale: 1, x: 0, y: 0 };
      var dirty = false;
      var bar = document.getElementById('rd-edit-bar');
      var container = document.querySelector('.diagram-container');
      var modeOn = false;
      var undoStack = [];
      var historyPanel = null;

      // ---- file-as-database state ----
      // baseline = the state this file was last saved in. History entries are
      // captured FROM the baseline (the version a new save replaces), never
      // from the live DOM, so restores roll back to true prior versions.
      var baseline = null;
      function initBaseline() {
        var payload = readSourcePayload();
        baseline = { svg: currentSvgText(), source: payload ? payload.source : null };
      }
      function readSourcePayload() {
        var el = document.getElementById('rd-source-data');
        if (!el) return null;
        try { return JSON.parse(el.textContent); } catch (error) { return null; }
      }
      function writeSourcePayload(payload) {
        var el = document.getElementById('rd-source-data');
        if (!el) return;
        el.textContent = JSON.stringify(payload)
          .replaceAll('<', '\u003c').replaceAll('>', '\u003e');
      }
      function currentSvgText() {
        var s = svg();
        return s ? s.outerHTML : '';
      }
      function serializeCleanDocument() {
        var clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll('#rd-detail-panel, #rd-history-panel').forEach(function (n) { n.remove(); });
        clone.querySelectorAll('[data-rd-hover]').forEach(function (n) { n.removeAttribute('data-rd-hover'); });
        var barClone = clone.querySelector('#rd-edit-bar');
        if (barClone) barClone.removeAttribute('data-dirty');
        var cont = clone.querySelector('.diagram-container');
        if (cont) { cont.style.transform = ''; cont.style.transformOrigin = ''; }
        return '<!DOCTYPE html>\n' + clone.outerHTML;
      }

      function svg() { return container ? container.querySelector('svg') : null; }
      function nodeGroups() {
        var s = svg();
        return s ? Array.from(s.querySelectorAll('[data-node-id]')) : [];
      }
      function semanticEdges() {
        var s = svg();
        return s ? Array.from(s.querySelectorAll('[data-edge-from][data-edge-to]')) : [];
      }
      function nodeLabelOf(id) {
        var node = nodeGroups().find(function (group) { return group.getAttribute('data-node-id') === id; });
        if (!node) return id;
        return (node.getAttribute('data-node-label') || id).split(' · ')[0];
      }
      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, function (ch) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
      }

      // ---------- camera ----------
      function applyZoom() {
        if (!container) return;
        container.style.transformOrigin = '0 0';
        container.style.transform = 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + zoom.scale + ')';
      }
      function fitZoom() { zoom = { scale: 1, x: 0, y: 0 }; applyZoom(); }
      function wheelZoom(event) {
        if (!event.ctrlKey) return;
        event.preventDefault();
        var rect = container.getBoundingClientRect();
        var px = event.clientX - rect.left;
        var py = event.clientY - rect.top;
        var factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        var next = Math.min(5, Math.max(0.3, zoom.scale * factor));
        var k = next / zoom.scale;
        zoom.x = px - (px - zoom.x) * k;
        zoom.y = py - (py - zoom.y) * k;
        zoom.scale = next;
        applyZoom();
      }

      // ---------- node detail ----------
      // The semantic passport (focus chip) is the single detail surface:
      // clicking a node goes through the viewer's own focus wiring, which now
      // renders the authored data-rd-detail dictionary inside the passport.

      // ---------- undo ----------
      function pushUndo(record) { undoStack.push(record); if (undoStack.length > 100) undoStack.shift(); }
      function undo() {
        var record = undoStack.pop();
        if (!record) { flash('没有可撤销的操作'); return; }
        record.forEach(function (entry) {
          var group = nodeGroups().find(function (node) { return node.getAttribute('data-node-id') === entry.id; });
          if (group && entry.dx != null) {
            if (entry.dx === 0 && entry.dy === 0) {
              group.removeAttribute('transform');
              group.removeAttribute('data-rd-edit-dx');
              group.removeAttribute('data-rd-edit-dy');
            } else {
              group.setAttribute('data-rd-edit-dx', entry.dx);
              group.setAttribute('data-rd-edit-dy', entry.dy);
              group.setAttribute('transform', 'translate(' + entry.dx + ' ' + entry.dy + ')');
            }
            followEdges(entry.id, entry.dx, entry.dy);
          }
          if (entry.text != null && entry.element) entry.element.textContent = entry.text;
          Object.keys(entry.edges || {}).forEach(function (key) {
            var edge = document.querySelector('[data-edge-id="' + key + '"], [data-edge-key="' + key + '"]');
            if (edge) edge.setAttribute('d', entry.edges[key]);
          });
        });
        flash('已撤销');
      }

      // ---------- edit mode ----------
      function setMode(on) {
        modeOn = on;
        document.documentElement.setAttribute('data-rd-edit-mode', on ? 'on' : 'off');
        if (bar) bar.setAttribute('data-mode', on ? 'on' : 'off');
      }
      function markDirty() { dirty = true; if (bar) bar.setAttribute('data-dirty', '1'); }

      function endpointsOf(d) {
        var numbers = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(parseFloat);
        if (numbers.length < 4) return null;
        return { sx: numbers[0], sy: numbers[1], ex: numbers[numbers.length - 2], ey: numbers[numbers.length - 1] };
      }

      function edgeRecords(id) {
        return semanticEdges().map(function (edge) {
          if (edge.getAttribute('data-edge-from') !== id && edge.getAttribute('data-edge-to') !== id) return null;
          var wrapper = edge.closest('[data-graph-role="automatic-crossover"]');
          var twins = wrapper ? Array.from(wrapper.children).filter(function (child) { return child !== edge; }) : [];
          var key = edge.getAttribute('data-edge-id') || edge.getAttribute('data-edge-key');
          return { edge: edge, key: key, twins: twins, original: edge.getAttribute('d') || '' };
        }).filter(Boolean);
      }

      function orthogonalPath(sx, sy, ex, ey) {
        var midX = sx + (ex - sx) / 2;
        if (Math.abs(ex - sx) < 8) return 'M ' + sx + ' ' + sy + ' L ' + ex + ' ' + ey;
        return 'M ' + sx + ' ' + sy + ' L ' + midX + ' ' + sy + ' L ' + midX + ' ' + ey + ' L ' + ex + ' ' + ey;
      }

      function followEdges(id, dx, dy) {
        edgeRecords(id).forEach(function (record) {
          var ends = endpointsOf(record.original);
          if (!ends) return;
          var fromIsDragged = record.edge.getAttribute('data-edge-from') === id;
          var sx = ends.sx + (fromIsDragged ? dx : 0);
          var sy = ends.sy + (fromIsDragged ? dy : 0);
          var ex = ends.ex + (fromIsDragged ? 0 : dx);
          var ey = ends.ey + (fromIsDragged ? 0 : dy);
          var routed = orthogonalPath(sx, sy, ex, ey);
          record.edge.setAttribute('d', routed);
          record.twins.forEach(function (twin) {
            if (twin.getAttribute && twin.getAttribute('d')) twin.setAttribute('d', routed);
          });
        });
      }

      var downInfo = null;
      function bindNodeInteractions() {
        if (!container) return;
        var dragging = null;
        var origin = null;
        var start = null;
        var moved = false;

        container.addEventListener('pointerdown', function (event) {
          if (event.button !== 0) return;
          var group = event.target.closest('svg [data-node-id]');
          downInfo = { group: group, x: event.clientX, y: event.clientY };
          moved = false;
          if (!modeOn || !group) return;
          event.preventDefault();
          event.stopPropagation();
          dragging = group;
          var base = group.getAttribute('data-rd-edit-dx');
          origin = {
            dx: base ? parseFloat(base) || 0 : 0,
            dy: base ? parseFloat(group.getAttribute('data-rd-edit-dy')) || 0 : 0,
            // Capture pristine edge geometry at drag START — by drag end the
            // edges have been re-routed and no longer hold the undo target.
            edges: edgeRecords(group.getAttribute('data-node-id')).reduce(function (map, entry) {
              map[entry.key] = entry.original;
              return map;
            }, {}),
          };
          start = { x: event.clientX, y: event.clientY };
          group.setAttribute('data-rd-edit', '1');
        });

        window.addEventListener('pointermove', function (event) {
          if (downInfo && (Math.abs(event.clientX - downInfo.x) + Math.abs(event.clientY - downInfo.y)) > 4) moved = true;
          if (dragging) {
            event.preventDefault();
            // Smooth during drag — grid snap only on release, not mid-drag.
            var dx = origin.dx + (event.clientX - start.x) / zoom.scale;
            var dy = origin.dy + (event.clientY - start.y) / zoom.scale;
            dragging.setAttribute('data-rd-edit-dx', dx);
            dragging.setAttribute('data-rd-edit-dy', dy);
            dragging.setAttribute('transform', 'translate(' + dx + ' ' + dy + ')');
            followEdges(dragging.getAttribute('data-node-id'), dx, dy);
          }
        });

        window.addEventListener('pointerup', function () {
          if (dragging) {
            // Snap to 8px grid on release for tidy alignment
            var rawDx = parseFloat(dragging.getAttribute('data-rd-edit-dx') || '0') || 0;
            var rawDy = parseFloat(dragging.getAttribute('data-rd-edit-dy') || '0') || 0;
            if (rawDx !== 0 || rawDy !== 0) {
              var sx = Math.round(rawDx / 8) * 8;
              var sy = Math.round(rawDy / 8) * 8;
              dragging.setAttribute('data-rd-edit-dx', sx);
              dragging.setAttribute('data-rd-edit-dy', sy);
              dragging.setAttribute('transform', 'translate(' + sx + ' ' + sy + ')');
              followEdges(dragging.getAttribute('data-node-id'), sx, sy);
            }
            markDirty();
            var id = dragging.getAttribute('data-node-id');
            var record = [{ id: id, dx: origin.dx, dy: origin.dy, edges: origin.edges }];
            pushUndo(record);
          }
          // A plain click (no drag) leaves detail handling to the viewer's
          // own focus wiring — the semantic passport is the detail surface.
          dragging = null;
          downInfo = null;
        });

        container.addEventListener('dblclick', function (event) {
          if (!modeOn) return;
          var group = event.target.closest('svg [data-node-id]');
          if (!group) return;
          event.preventDefault();
          event.stopPropagation();
          var label = group.querySelector('[data-node-label]');
          if (!label) return;
          var next = window.prompt('编辑文字（' + (group.getAttribute('data-node-id') || '') + '）', label.textContent);
          if (next == null || next === label.textContent) return;
          pushUndo([{ id: group.getAttribute('data-node-id'), text: label.textContent, element: label }]);
          label.textContent = next;
          group.setAttribute('data-rd-edit-text', next);
          group.setAttribute('data-rd-edit', '1');
          markDirty();
        });

        container.addEventListener('pointerover', function (event) {
          if (!modeOn) return;
          var group = event.target.closest('svg [data-node-id]');
          if (group) group.setAttribute('data-rd-hover', '1');
        });
        container.addEventListener('pointerout', function (event) {
          var group = event.target.closest('svg [data-node-id]');
          if (group) group.removeAttribute('data-rd-hover');
        });
      }

      function tidy() {
        var GRID = 16;
        var moved = 0;
        nodeGroups().forEach(function (group) {
          var dx = parseFloat(group.getAttribute('data-rd-edit-dx') || '0');
          var dy = parseFloat(group.getAttribute('data-rd-edit-dy') || '0');
          if (!dx && !dy) return;
          var sx = Math.round(dx / GRID) * GRID;
          var sy = Math.round(dy / GRID) * GRID;
          if (sx !== dx || sy !== dy) moved += 1;
          group.setAttribute('data-rd-edit-dx', sx);
          group.setAttribute('data-rd-edit-dy', sy);
          group.setAttribute('transform', 'translate(' + sx + ' ' + sy + ')');
          followEdges(group.getAttribute('data-node-id'), sx, sy);
        });
        if (moved) markDirty();
        flash('已对齐 ' + moved + ' 个节点到 16px 网格');
      }

      function overrides() {
        var out = {};
        nodeGroups().forEach(function (group) {
          var id = group.getAttribute('data-node-id');
          var dx = parseFloat(group.getAttribute('data-rd-edit-dx') || '0') || 0;
          var dy = parseFloat(group.getAttribute('data-rd-edit-dy') || '0') || 0;
          var text = group.getAttribute('data-rd-edit-text');
          if (dx || dy || text) out[id] = { dx: dx, dy: dy, ...(text != null ? { text: text } : {}) };
        });
        return out;
      }

      function flash(message) {
        if (!bar) return;
        var note = document.getElementById('rd-edit-note');
        if (!note) return;
        note.textContent = message;
        note.setAttribute('data-show', '1');
        window.setTimeout(function () { note.removeAttribute('data-show'); }, 2200);
      }

      function snapshotLabel() {
        var moved = 0, edited = 0;
        nodeGroups().forEach(function (group) {
          if (parseFloat(group.getAttribute('data-rd-edit-dx') || '0') || parseFloat(group.getAttribute('data-rd-edit-dy') || '0')) moved += 1;
          if (group.getAttribute('data-rd-edit-text')) edited += 1;
        });
        return '微调：' + moved + ' 节点移动' + (edited ? '，' + edited + ' 处文字' : '');
      }

      function buildSavedHtml() {
        var payload = readSourcePayload();
        if (!payload) return null;
        payload.history = Array.isArray(payload.history) ? payload.history : [];
        payload.history.push({
          ts: new Date().toISOString(),
          label: baseline && baseline.source && baseline.source.layout_overrides
            ? '上一版本（含 ' + Object.keys(baseline.source.layout_overrides).length + ' 处微调）'
            : '初始版本',
          svg: baseline ? baseline.svg : currentSvgText(),
          source: baseline ? baseline.source : payload.source,
        });
        if (payload.history.length > 15) payload.history = payload.history.slice(-15);
        payload.source = payload.source || {};
        payload.source.layout_overrides = overrides();
        payload.savedAt = new Date().toISOString();
        writeSourcePayload(payload);
        return { html: serializeCleanDocument(), payload: payload };
      }

      var fileHandle = null;
      async function writeBack(html) {
        if (window.showSaveFilePicker) {
          try {
            if (!fileHandle) {
              var name = decodeURIComponent((location.pathname.split('/').pop() || 'diagram.html'));
              fileHandle = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }],
              });
            }
            var writable = await fileHandle.createWritable();
            await writable.write(html);
            await writable.close();
            return { mode: 'file' };
          } catch (error) {
            if (error && error.name === 'AbortError') return { mode: 'cancel' };
          }
        }
        var blob = new Blob([html], { type: 'text/html' });
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = decodeURIComponent((location.pathname.split('/').pop() || 'diagram.html'));
        link.click();
        window.setTimeout(function () { URL.revokeObjectURL(link.href); }, 4000);
        return { mode: 'download' };
      }

      async function save() {
        var saved = buildSavedHtml();
        if (!saved) { flash('此文件未内嵌源数据，无法直改保存'); return; }
        var result = await writeBack(saved.html);
        if (result.mode === 'cancel') return;
        dirty = false;
        if (bar) bar.removeAttribute('data-dirty');
        if (result.mode === 'file') baseline = { svg: currentSvgText(), source: saved.payload.source };
        flash(result.mode === 'file' ? '已直接写回本文件（历史共 ' + saved.payload.history.length + ' 条）'
          : '浏览器不支持直写，已下载同名文件——覆盖原文件即完成保存');
      }

      function ensureHistoryPanel() {
        if (historyPanel) return historyPanel;
        historyPanel = document.createElement('div');
        historyPanel.id = 'rd-history-panel';
        historyPanel.innerHTML = '<button type="button" class="rd-h-close" title="关闭">✕</button>' +
          '<h3>🕘 更改历史</h3><div class="rd-hint">每次保存前的状态都嵌在本文件里。点击任意一条回退到该状态，回退后点一次保存落盘。</div>' +
          '<div id="rd-history-list"></div>';
        document.body.appendChild(historyPanel);
        historyPanel.querySelector('.rd-h-close').addEventListener('click', function () { historyPanel.removeAttribute('data-open'); });
        return historyPanel;
      }
      function showHistory() {
        var el = ensureHistoryPanel();
        var payload = readSourcePayload();
        var list = el.querySelector('#rd-history-list');
        list.innerHTML = '';
        var entries = (payload && Array.isArray(payload.history)) ? payload.history.slice().reverse() : [];
        if (!entries.length) list.innerHTML = '<div class="rd-hint">还没有保存历史——做点修改并保存一次。</div>';
        entries.forEach(function (entry, reversedIndex) {
          var index = payload.history.length - 1 - reversedIndex;
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'rd-history-item';
          var time = String(entry.ts || '').replace('T', ' ').slice(5, 16);
          btn.innerHTML = '<span class="rd-h-time">#' + (index + 1) + ' · ' + escapeHtml(time) + '</span>' +
            '<span class="rd-h-label">' + escapeHtml(entry.label || '快照') + '</span>';
          btn.addEventListener('click', function () { restoreEntry(index); });
          list.appendChild(btn);
        });
        el.setAttribute('data-open', '1');
      }
      function restoreEntry(index) {
        var payload = readSourcePayload();
        if (!payload || !payload.history || !payload.history[index]) return;
        var entry = payload.history[index];
        var s = svg();
        if (s && entry.svg) s.outerHTML = entry.svg;
        payload.source = entry.source;
        writeSourcePayload(payload);
        dirty = true;
        if (bar) bar.setAttribute('data-dirty', '1');
        if (historyPanel) historyPanel.removeAttribute('data-open');
        flash('已回退到 #' + (index + 1) + ' —— 点「保存」落盘');
      }

      function bindBarAndKeys() {
        if (bar) {
          bar.querySelector('[data-act="mode"]').addEventListener('click', function () { setMode(!modeOn); });
          bar.querySelector('[data-act="tidy"]').addEventListener('click', tidy);
          bar.querySelector('[data-act="reset"]').addEventListener('click', function () {
            if (window.confirm('丢弃全部手动调整并还原初始布局？')) window.location.reload();
          });
          bar.querySelector('[data-act="save"]').addEventListener('click', save);
          bar.querySelector('[data-act="history"]').addEventListener('click', showHistory);
          bar.querySelector('[data-act="fit"]').addEventListener('click', fitZoom);
        }
        window.addEventListener('keydown', function (event) {
          if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
            if (!modeOn) return;
            event.preventDefault();
            undo();
          } else if (event.key === 'Escape') {
            if (modeOn) setMode(false);
          }
        });
        if (container) {
          container.addEventListener('wheel', wheelZoom, { passive: false });
          container.addEventListener('dblclick', function (event) {
            if (event.target.closest('[data-node-id]')) return;
            fitZoom();
          });
        }
      }

      function boot() {
        bindBarAndKeys();
        bindNodeInteractions();
        initBaseline();
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
      else boot();

      window.addEventListener('beforeunload', function (event) {
        if (dirty) { event.preventDefault(); event.returnValue = ''; }
      });

      return { setMode: setMode, tidy: tidy, save: save, fitZoom: fitZoom, overrides: overrides, undo: undo, buildSavedHtml: buildSavedHtml, showHistory: showHistory, readSourcePayload: readSourcePayload };
    })();
