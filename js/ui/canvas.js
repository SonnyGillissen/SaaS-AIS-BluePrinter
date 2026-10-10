/**
 * AIS BluePrinter - interactive diagram canvas.
 *
 * Renders the blueprint with AISBP.Render into an inline SVG and handles:
 *  - selection (click, Ctrl/Shift+click, Shift+drag marquee),
 *  - moving objects with drag-and-drop, including moving them into other containers,
 *  - creating connections by dragging the connection handle onto another object,
 *  - dropping palette items (HTML5 drag-and-drop) and configuration package files,
 *  - panning (drag empty space / wheel) and zooming (Ctrl+wheel, toolbar).
 *
 * @module AISBP.Canvas
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Model = AISBP.Model;
  const Layout = AISBP.Layout;
  const Render = AISBP.Render;
  const Catalog = AISBP.Catalog;
  const doc = root.document;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PREFIX = 'cv-';
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 3;

  function mount(app) {
    const store = app.store;
    const wrap = doc.getElementById('canvas');
    const svg = doc.getElementById('canvas-svg');
    const defsEl = doc.getElementById('canvas-defs');
    const bg = doc.getElementById('canvas-bg');
    const viewport = doc.getElementById('viewport');
    const content = doc.getElementById('content');
    const overlay = doc.getElementById('overlay');
    const empty = doc.getElementById('canvas-empty');
    const zoomLabel = doc.getElementById('zoom-label');

    const view = { x: 40, y: 40, k: 1 };
    const failedIcons = new Set();
    let gesture = null; // current pointer gesture
    let dropTargetId = null; // highlighted container during drags
    let lastGeometry = null;
    let renderQueued = false;

    // -------------------------------------------------------------------------
    // Coordinates and view
    // -------------------------------------------------------------------------

    function toCanvas(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
    }

    function applyView() {
      viewport.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
      if (zoomLabel) zoomLabel.textContent = Math.round(view.k * 100) + '%';
    }

    function zoomAt(k, clientX, clientY) {
      const r = svg.getBoundingClientRect();
      const cx = clientX === undefined ? r.width / 2 : clientX - r.left;
      const cy = clientY === undefined ? r.height / 2 : clientY - r.top;
      const nk = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
      view.x = cx - ((cx - view.x) / view.k) * nk;
      view.y = cy - ((cy - view.y) / view.k) * nk;
      view.k = nk;
      applyView();
    }

    function fit() {
      const g = store.derived().geometry;
      const r = svg.getBoundingClientRect();
      if (!Object.keys(g.rects).length || !r.width) {
        view.x = 40; view.y = 40; view.k = 1;
        return applyView();
      }
      const b = g.bounds;
      const k = Math.min(1.25, Math.max(MIN_ZOOM, Math.min((r.width - 80) / b.w, (r.height - 80) / b.h)));
      view.k = k;
      view.x = (r.width - b.w * k) / 2 - b.x * k;
      view.y = (r.height - b.h * k) / 2 - b.y * k;
      applyView();
    }

    function centerOn(id) {
      const rect = store.derived().geometry.rects[id];
      if (!rect) return;
      const r = svg.getBoundingClientRect();
      view.x = r.width / 2 - (rect.x + rect.w / 2) * view.k;
      view.y = r.height / 2 - (rect.y + rect.h / 2) * view.k;
      applyView();
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------

    function iconHref(typeId) {
      const u = AISBP.Icons.url(store.project, typeId);
      return u && !failedIcons.has(u) ? u : null;
    }

    function geometry() {
      if (gesture && gesture.type === 'move' && gesture.moved) return moveGeometry(gesture);
      return store.derived().geometry;
    }

    /**
     * Geometry while moving objects: the moved objects do not stretch their containers, but every
     * container keeps (at least) the boundary it had when the drag started. As long as the pointer
     * stays inside that boundary the objects remain in their container instead of being detached.
     */
    function moveGeometry(gst) {
      return Layout.compute(store.project, null, { detached: new Set(gst.ids), frozen: gst.frozen });
    }

    function render() {
      renderQueued = false;
      const project = store.project;
      // In the dark application theme the canvas uses a dark variant of light display styles.
      const theme = AISBP.Theme ? AISBP.Theme.effective() : 'light';
      const st = Render.editorStyle(project.settings.diagram.style, theme);
      const g = geometry();
      lastGeometry = g;
      // Static renderer output: all user text is escaped by AISBP.Render.
      defsEl.innerHTML = Render.defs(st, PREFIX).replace(/^<defs>|<\/defs>$/g, '');
      bg.setAttribute('fill', st.background);
      const grid = st.grid ? '<rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#' + PREFIX + 'grid)" pointer-events="none"/>' : '';
      content.innerHTML = grid + Render.renderContent(project, {
        geometry: g,
        selection: store.selection,
        problems: store.derived().problems,
        iconHref,
        dropTargetId,
        idPrefix: PREFIX,
        style: st
      });
      renderOverlay(g, st);
      empty.hidden = Object.keys(project.nodes).length > 0;
    }

    function queueRender() {
      if (renderQueued) return;
      renderQueued = true;
      root.requestAnimationFrame(render);
    }

    function svgEl(tag, attrs) {
      const el = doc.createElementNS(SVG_NS, tag);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      return el;
    }

    function renderOverlay(g, st) {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
      const single = store.singleNode();
      if (single && g.rects[single.id] && !g.rects[single.id].hidden && !(gesture && gesture.type === 'move' && gesture.moved)) {
        const r = g.rects[single.id];
        const handle = svgEl('g', { class: 'handle', 'data-handle': 'connect', 'data-node-id': single.id });
        const t = svgEl('title', {});
        t.textContent = 'Drag onto another object to create a connection';
        handle.appendChild(t);
        handle.appendChild(svgEl('circle', { cx: r.x + r.w + 12, cy: r.y + Math.min(r.h / 2, 30), r: 8, fill: '#ffffff', stroke: st.selection, 'stroke-width': 2 }));
        handle.appendChild(svgEl('path', { d: 'M' + (r.x + r.w + 8) + ' ' + (r.y + Math.min(r.h / 2, 30)) + ' h8 m-3 -3 l3 3 l-3 3', stroke: st.selection, 'stroke-width': 1.5, fill: 'none' }));
        overlay.appendChild(handle);
        if (r.container) {
          // Resize grip (bottom-right corner) for hierarchy objects and other containers.
          const grip = svgEl('g', { class: 'handle resize', 'data-handle': 'resize', 'data-node-id': single.id });
          const gt = svgEl('title', {});
          gt.textContent = 'Drag to resize (Tidy up resets the size)';
          grip.appendChild(gt);
          const sz = 12 / view.k;
          grip.appendChild(svgEl('rect', { x: r.x + r.w - sz, y: r.y + r.h - sz, width: sz, height: sz, fill: '#ffffff', stroke: st.selection, 'stroke-width': 1.5 / view.k }));
          grip.appendChild(svgEl('path', { d: 'M' + (r.x + r.w - sz * 0.7) + ' ' + (r.y + r.h - sz * 0.2) + ' L' + (r.x + r.w - sz * 0.2) + ' ' + (r.y + r.h - sz * 0.7), stroke: st.selection, 'stroke-width': 1.5 / view.k }));
          overlay.appendChild(grip);
        }
      }
      if (gesture && gesture.type === 'resize') {
        const r = g.rects[gesture.id];
        if (r) overlay.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: st.selection, 'stroke-dasharray': '4 3', 'stroke-width': 1.5 / view.k }));
      }
      if (gesture && gesture.type === 'marquee' && gesture.rect) {
        const m = gesture.rect;
        overlay.appendChild(svgEl('rect', { x: m.x, y: m.y, width: m.w, height: m.h, fill: 'rgba(10,99,201,0.08)', stroke: '#0a63c9', 'stroke-dasharray': '4 3', 'stroke-width': 1 / view.k }));
      }
      if (gesture && gesture.type === 'connect' && gesture.to) {
        const from = g.rects[gesture.from];
        if (from) {
          const target = gesture.targetId && g.rects[gesture.targetId];
          const end = target ? Render.center(target) : gesture.to;
          const a = Render.borderPoint(from, end);
          overlay.appendChild(svgEl('line', { x1: a.x, y1: a.y, x2: end.x, y2: end.y, stroke: st.selection, 'stroke-width': 2, 'stroke-dasharray': '6 4', 'marker-end': 'url(#' + PREFIX + 'arrow-sel)' }));
          if (target) overlay.appendChild(svgEl('rect', { x: target.x - 4, y: target.y - 4, width: target.w + 8, height: target.h + 8, rx: 8, fill: 'none', stroke: st.selection, 'stroke-width': 2 }));
        }
      }
    }

    // Icons that fail to load (offline, blocked) are replaced by placeholders.
    svg.addEventListener('error', (e) => {
      const t = e.target;
      if (t && t.tagName === 'image') {
        const href = t.getAttribute('href');
        if (href && !failedIcons.has(href)) {
          failedIcons.add(href);
          queueRender();
        }
      }
    }, true);

    // -------------------------------------------------------------------------
    // Pointer interaction
    // -------------------------------------------------------------------------

    const snap = (v) => {
      const d = store.project.settings.diagram;
      const gs = d.gridSize || 10;
      return d.snapToGrid !== false ? Math.round(v / gs) * gs : v;
    };

    // Safari (WebKit) starts a text selection on mousedown even with user-select: none on the
    // canvas, which selects the whole page while dragging. Pointer events still drive all gestures.
    svg.addEventListener('mousedown', (e) => e.preventDefault());
    svg.addEventListener('selectstart', (e) => e.preventDefault());
    // While a gesture runs (e.g. drawing a connection) the pointer can leave the canvas; Safari
    // then selects the text of the whole page. Block selection page-wide until the gesture ends.
    doc.addEventListener('selectstart', (e) => { if (gesture) e.preventDefault(); });

    function lockSelection(on) {
      doc.documentElement.classList.toggle('no-select', on);
      if (on) {
        const sel = root.getSelection && root.getSelection();
        if (sel && sel.rangeCount) sel.removeAllRanges();
      }
    }

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      lockSelection(true);
      wrap.focus({ preventScroll: true });
      const pt = toCanvas(e.clientX, e.clientY);
      const handleEl = e.target.closest('[data-handle]');
      const nodeEl = e.target.closest('[data-node-id]');
      const connEl = e.target.closest('[data-conn-id]');
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      svg.setPointerCapture(e.pointerId);

      if (e.button === 1) {
        gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
        svg.classList.add('panning');
      } else if (handleEl && handleEl.getAttribute('data-handle') === 'resize') {
        const id = handleEl.getAttribute('data-node-id');
        const r = store.derived().geometry.rects[id];
        gesture = { type: 'resize', id, start: pt, size: { w: r.x + r.w - store.project.nodes[id].x, h: r.y + r.h - store.project.nodes[id].y }, snapshot: null };
      } else if (handleEl) {
        gesture = { type: 'connect', from: handleEl.getAttribute('data-node-id'), to: pt, targetId: null };
      } else if (nodeEl) {
        const id = nodeEl.getAttribute('data-node-id');
        if (additive) store.select([id], [], true);
        else if (!store.selection.nodes.has(id)) store.select([id]);
        if (!store.selection.nodes.has(id)) { gesture = null; lockSelection(false); return; }
        const ids = Model.topLevelOnly(store.project, store.selectedNodes());
        const node = store.project.nodes[id];
        const exclude = new Set();
        ids.forEach((x) => { exclude.add(x); Model.descendants(store.project, x).forEach((d) => exclude.add(d.id)); });
        // Container boundaries at drag start (except for the moved objects themselves).
        const frozen = {};
        const startRects = store.derived().geometry.rects;
        Object.keys(startRects).forEach((rid) => {
          const r = startRects[rid];
          if (r.container && !r.hidden && !exclude.has(rid)) frozen[rid] = { x: r.x, y: r.y, w: r.w, h: r.h };
        });
        gesture = { type: 'move', id, ids, exclude, frozen, start: pt, origin: { x: node.x, y: node.y }, moved: false, snapshot: null };
      } else if (connEl) {
        store.select([], [connEl.getAttribute('data-conn-id')], additive);
        gesture = null;
      } else if (e.shiftKey) {
        gesture = { type: 'marquee', start: pt, rect: null, additive: e.ctrlKey || e.metaKey };
      } else {
        gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, clickClear: true };
        svg.classList.add('panning');
      }
      if (!gesture) lockSelection(false);
    });

    svg.addEventListener('pointermove', (e) => {
      if (!gesture) return;
      const pt = toCanvas(e.clientX, e.clientY);
      if (gesture.type === 'pan') {
        const dx = e.clientX - gesture.sx;
        const dy = e.clientY - gesture.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) gesture.clickClear = false;
        view.x = gesture.vx + dx;
        view.y = gesture.vy + dy;
        applyView();
      } else if (gesture.type === 'move') {
        const tdx = pt.x - gesture.start.x;
        const tdy = pt.y - gesture.start.y;
        if (!gesture.moved && Math.abs(tdx) + Math.abs(tdy) < 4 / view.k) return;
        if (!gesture.moved) {
          gesture.moved = true;
          gesture.snapshot = store.begin();
        }
        const node = store.project.nodes[gesture.id];
        const dx = snap(gesture.origin.x + tdx) - node.x;
        const dy = snap(gesture.origin.y + tdy) - node.y;
        const g = moveGeometry(gesture);
        const target = Layout.dropTarget(store.project, g, pt, node.type, gesture.exclude);
        dropTargetId = target === undefined ? null : target;
        gesture.target = target;
        if (dx || dy) store.live((p) => Model.moveNodes(p, gesture.ids, dx, dy));
        else queueRender();
      } else if (gesture.type === 'resize') {
        const w = Math.max(Layout.MIN_W, snap(gesture.size.w + pt.x - gesture.start.x));
        const h = Math.max(Layout.MIN_H, snap(gesture.size.h + pt.y - gesture.start.y));
        const node = store.project.nodes[gesture.id];
        if (node.w === w && node.h === h) return;
        if (!gesture.snapshot) gesture.snapshot = store.begin();
        store.live((p) => { p.nodes[gesture.id].w = w; p.nodes[gesture.id].h = h; });
      } else if (gesture.type === 'connect') {
        gesture.to = pt;
        const hit = Layout.hitTest(lastGeometry || store.derived().geometry, pt);
        gesture.targetId = hit && hit !== gesture.from ? hit : null;
        queueRender();
      } else if (gesture.type === 'marquee') {
        const s = gesture.start;
        gesture.rect = { x: Math.min(s.x, pt.x), y: Math.min(s.y, pt.y), w: Math.abs(pt.x - s.x), h: Math.abs(pt.y - s.y) };
        queueRender();
      }
    });

    function endGesture(e, cancelled) {
      if (!gesture) return;
      const gst = gesture;
      gesture = null;
      lockSelection(false);
      svg.classList.remove('panning');
      try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (gst.type === 'pan' && gst.clickClear && !cancelled) store.clearSelection();
      if (gst.type === 'move' && gst.moved) {
        dropTargetId = null;
        if (!cancelled) {
          const project = store.project;
          // Move into a new container when dropped on one that accepts all moved objects.
          if (gst.target !== undefined) {
            const target = gst.target;
            const movable = gst.ids.filter((id) => (project.nodes[id].parentId || null) !== target && Model.canContain(project, target, project.nodes[id].type));
            if (movable.length) store.live((p) => movable.forEach((id) => Model.reparent(p, id, target)));
          }
          store.commit(gst.snapshot);
        } else {
          store.rollback(gst.snapshot);
        }
        queueRender();
      } else if (gst.type === 'move') {
        // A plain click (no drag): make sure the selection handles are drawn.
        queueRender();
      }
      if (gst.type === 'resize') {
        if (gst.snapshot) {
          if (cancelled) store.rollback(gst.snapshot);
          else store.commit(gst.snapshot);
        }
        queueRender();
      }
      if (gst.type === 'connect' && gst.targetId && !cancelled) app.actions.connect(gst.from, gst.targetId);
      else if (gst.type === 'connect') queueRender();
      if (gst.type === 'marquee' && gst.rect && !cancelled) {
        const m = gst.rect;
        const g = store.derived().geometry;
        const ids = Object.keys(g.rects).filter((id) => {
          const r = g.rects[id];
          return !r.hidden && r.w && r.x >= m.x && r.y >= m.y && r.x + r.w <= m.x + m.w && r.y + r.h <= m.y + m.h;
        });
        const conns = Object.keys(store.project.connections).filter((cid) => {
          const c = store.project.connections[cid];
          return ids.indexOf(c.from) !== -1 && ids.indexOf(c.to) !== -1;
        });
        store.select(ids, conns, gst.additive);
      } else if (gst.type === 'marquee') queueRender();
    }

    svg.addEventListener('pointerup', (e) => endGesture(e, false));
    svg.addEventListener('pointercancel', (e) => endGesture(e, true));

    svg.addEventListener('dblclick', (e) => {
      const nodeEl = e.target.closest('[data-node-id]');
      if (!nodeEl) return;
      const input = doc.getElementById('prop-label') || doc.getElementById('prop-name');
      if (input) {
        input.focus();
        input.select();
      }
    });

    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(view.k * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      } else {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        applyView();
      }
    }, { passive: false });

    // -------------------------------------------------------------------------
    // HTML5 drag-and-drop from the palette (and configuration package files)
    // -------------------------------------------------------------------------

    function paletteType(e) {
      const types = Array.from(e.dataTransfer.types || []);
      if (types.indexOf(AISBP.Palette.DRAG_TYPE) !== -1 || app.dragType) return app.dragType || 'unknown';
      return null;
    }

    // Safari only allows a drop when both dragenter and dragover are cancelled.
    wrap.addEventListener('dragenter', (e) => {
      const files = Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
      if (paletteType(e) || files) e.preventDefault();
    });

    wrap.addEventListener('dragover', (e) => {
      const type = paletteType(e);
      const files = Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1;
      if (!type && !files) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (type && Catalog.get(type)) {
        const pt = toCanvas(e.clientX, e.clientY);
        const target = Layout.dropTarget(store.project, store.derived().geometry, pt, type);
        const next = target === undefined ? null : target;
        if (next !== dropTargetId) {
          dropTargetId = next;
          queueRender();
        }
      }
    });

    wrap.addEventListener('dragleave', (e) => {
      if (e.target === wrap || !wrap.contains(e.relatedTarget)) {
        if (dropTargetId) {
          dropTargetId = null;
          queueRender();
        }
      }
    });

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      dropTargetId = null;
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        app.actions.importFile(file);
        return;
      }
      const type = e.dataTransfer.getData(AISBP.Palette.DRAG_TYPE) || app.dragType;
      app.dragType = null;
      if (!type || !Catalog.get(type)) return queueRender();
      const pt = toCanvas(e.clientX, e.clientY);
      app.actions.addAt(type, pt);
    });

    // Keep the view stable on resize.
    root.addEventListener('resize', () => applyView());

    applyView();

    return {
      render,
      queueRender,
      fit,
      centerOn,
      zoomIn: () => zoomAt(view.k * 1.2),
      zoomOut: () => zoomAt(view.k / 1.2),
      zoomReset: () => zoomAt(1),
      /** Center of the visible area in canvas coordinates (for pasting). */
      visibleCenter() {
        const r = svg.getBoundingClientRect();
        return toCanvas(r.left + r.width / 2, r.top + r.height / 2);
      },
      isDragging: () => !!(gesture && gesture.type === 'move' && gesture.moved)
    };
  }

  AISBP.Canvas = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
