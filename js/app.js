/**
 * AIS BluePrinter - application bootstrap.
 *
 * Creates the store, mounts the UI modules, implements the user actions (add, move,
 * connect, copy/paste, import/export, ...), keyboard shortcuts and autosave.
 *
 * @module app
 */
(function (root) {
  'use strict';

  const AISBP = root.AISBP;
  const { Model, Catalog, Layout, Storage, Store, Util } = AISBP;
  const { toast, confirm } = AISBP.Dom;
  const doc = root.document;

  // ---------------------------------------------------------------------------
  // Configuration and preferences
  // ---------------------------------------------------------------------------

  const config = Object.assign({ storage: { mode: 'local' }, defaults: {} }, root.AISBP_CONFIG || {});
  const storage = Storage.create(config);

  function newProject(sample) {
    return Model.createProject({ name: sample ? 'Sample integration landing zone' : 'New integration blueprint', settings: Model.sanitizeSettings(config.defaults || {}), sample });
  }

  const store = Store.createStore(newProject(false));

  /** Shared application context passed to the UI modules. */
  const app = {
    store,
    config,
    storage,
    dragType: null,
    clipboard: null,
    refreshAll() {
      palette.render();
      syncToolbar();
      canvas.render();
      explorer.render();
      properties.render();
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const label = (type) => (Catalog.get(type) || { label: type }).label;

  function snap(v) {
    const d = store.project.settings.diagram;
    const gs = d.gridSize || 10;
    return d.snapToGrid !== false ? Math.round(v / gs) * gs : Math.round(v);
  }

  /** Explain where a type may be placed. */
  function placementHint(type) {
    const def = Catalog.get(type);
    const parents = def.parents.filter((p) => p !== Catalog.ROOT).map(label);
    return def.label + ' must be placed inside ' + (parents.length ? 'a ' + parents.join(' or a ') : 'the canvas') + '.';
  }

  /**
   * Find the parent chain needed to place a type when no suitable container exists yet,
   * e.g. Logic App -> [subscription, resource-group]. Returns null when impossible.
   */
  function missingChain(type, depth) {
    if (Catalog.canContain(null, type)) return [];
    if ((depth || 0) > 5) return null;
    const def = Catalog.get(type);
    for (let i = 0; i < def.parents.length; i++) {
      const parentType = def.parents[i];
      if (parentType === Catalog.ROOT || parentType === 'management-group') continue;
      const chain = missingChain(parentType, (depth || 0) + 1);
      if (chain) return chain.concat([parentType]);
    }
    return null;
  }

  /** Make sure a node is visible on screen and select it. */
  function focusNode(id) {
    store.select([id]);
    root.requestAnimationFrame(() => {
      const r = store.derived().geometry.rects[id];
      const svg = doc.getElementById('canvas-svg').getBoundingClientRect();
      const vp = doc.getElementById('viewport').getCTM();
      if (!r || !vp) return;
      const sx = r.x * vp.a + vp.e;
      const sy = r.y * vp.d + vp.f;
      if (sx < 0 || sy < 0 || sx > svg.width - 60 || sy > svg.height - 60) canvas.centerOn(id);
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const actions = {
    /** Add a type at a canvas point (drop from the palette). */
    addAt(type, pt) {
      const g = store.derived().geometry;
      const parentId = Layout.dropTarget(store.project, g, pt, type);
      if (parentId === undefined) return toast(placementHint(type), 'error');
      const size = Layout.defaultSize(type);
      const node = store.change('add', (p) => Model.addNode(p, type, parentId, { x: snap(pt.x - size.w / 2), y: snap(pt.y - 30) }));
      if (node) store.select([node.id]);
    },

    /** Add a type inside a specific parent (null = top level) at a free spot. */
    addInto(type, parentId) {
      if (!Model.canContain(store.project, parentId || null, type)) return toast(placementHint(type), 'error');
      const spot = Layout.findFreeSpot(store.project, parentId || null, type, store.derived().geometry);
      const node = store.change('add', (p) => Model.addNode(p, type, parentId || null, { x: snap(spot.x), y: snap(spot.y) }));
      if (node) focusNode(node.id);
    },

    /**
     * Palette click: add to the selected container (or one of its ancestors), otherwise to
     * the first container that accepts the type, otherwise create the missing hierarchy.
     */
    addAuto(type) {
      const project = store.project;
      const sel = store.selectedNodes();
      const candidates = [];
      if (sel.length === 1) {
        candidates.push(sel[0]);
        Model.ancestors(project, sel[0]).forEach((a) => candidates.push(a.id));
      }
      let parentId = candidates.find((id) => Model.canContain(project, id, type));
      if (parentId === undefined && !Model.canContain(project, null, type)) {
        const any = Object.keys(project.nodes).map((k) => project.nodes[k]).sort((a, b) => a.seq - b.seq).find((n) => Model.canContain(project, n.id, type));
        if (any) parentId = any.id;
      }
      if (parentId !== undefined || Model.canContain(project, null, type)) return actions.addInto(type, parentId || null);
      const chain = missingChain(type);
      if (!chain) return toast(placementHint(type), 'error');
      // Create the missing containers (e.g. subscription > resource group) in one undo step.
      const node = store.change('add with hierarchy', (p) => {
        let parent = null;
        const spot = Layout.findFreeSpot(p, null, chain[0] || type);
        let x = snap(spot.x);
        let y = snap(spot.y);
        chain.forEach((t) => {
          parent = Model.addNode(p, t, parent ? parent.id : null, { x, y });
          x += Layout.PAD;
          y += Layout.HEADER + Layout.PAD;
        });
        return Model.addNode(p, type, parent ? parent.id : null, { x, y });
      });
      if (node) {
        toast('Created ' + chain.map((t) => 'a ' + label(t).toLowerCase()).join(' and ') + ' to hold the ' + label(type) + '.', 'info');
        focusNode(node.id);
      }
    },

    /** Move objects to another parent (explorer drag-and-drop or the parent field). */
    reparent(ids, targetId) {
      const target = targetId || null;
      let failed = 0;
      store.change('move', (p) => {
        ids.forEach((id) => {
          const node = p.nodes[id];
          if (!node || (node.parentId || null) === target) return;
          if (!Model.reparent(p, id, target)) {
            failed++;
            return;
          }
          // Place the object inside its new container.
          const g = Layout.compute(p, null, { detached: new Set([id]) });
          const spot = Layout.findFreeSpot(p, target, node.type, g);
          Model.moveNodes(p, [id], snap(spot.x) - node.x, snap(spot.y) - node.y);
        });
      });
      if (failed) toast(failed + ' object(s) cannot be placed there.', 'error');
    },

    /** Connect two objects. */
    connect(from, to) {
      const existing = Object.keys(store.project.connections).map((k) => store.project.connections[k]).find((c) => c.from === from && c.to === to);
      if (existing) {
        store.select([], [existing.id]);
        return toast('These objects are already connected.', 'info');
      }
      const conn = store.change('connect', (p) => Model.addConnection(p, from, to, { kind: 'flow' }));
      if (conn) store.select([], [conn.id]);
    },

    remove() {
      const nodes = store.selectedNodes();
      const conns = store.selectedConns();
      if (!nodes.length && !conns.length) return;
      store.change('delete', (p) => {
        Model.removeConnections(p, conns);
        Model.removeNodes(p, nodes);
      });
      store.clearSelection();
    },

    /** Build a clipboard payload of the selection. */
    clipboardPayload() {
      if (!store.selection.nodes.size && !store.selection.conns.size) return null;
      return Model.extract(store.project, store.selectedNodes(), store.selectedConns());
    },

    copy(silent) {
      const payload = actions.clipboardPayload();
      if (!payload) return null;
      app.clipboard = payload;
      const text = JSON.stringify(payload);
      if (!silent && root.navigator.clipboard && root.navigator.clipboard.writeText) root.navigator.clipboard.writeText(text).catch(() => {});
      if (!silent) toast('Copied ' + payload.nodes.length + ' object(s).');
      return text;
    },

    cut() {
      const text = actions.copy(true);
      if (text) actions.remove();
      return text;
    },

    /** Paste a payload (defaults to the internal clipboard). */
    paste(payload) {
      const data = payload || app.clipboard;
      if (!data) return toast('The clipboard is empty.');
      const single = store.singleNode();
      const target = single && Catalog.get(single.type) && (Catalog.get(single.type).container || Model.children(store.project, single.id).length) ? single.id : null;
      const result = store.change('paste', (p) => Model.paste(p, data, target, { dx: 30, dy: 30 }));
      if (!result) return;
      if (result.nodeIds.length) {
        // Select only the pasted roots so they can be moved immediately.
        const roots = Model.topLevelOnly(store.project, result.nodeIds);
        store.select(roots, result.connectionIds);
        // Next paste is offset again.
        app.clipboard = Model.extract(store.project, roots, []);
      }
      if (result.skipped) toast(result.skipped + ' object(s) could not be pasted here.', 'error');
    },

    async pasteFromSystem() {
      try {
        if (root.navigator.clipboard && root.navigator.clipboard.readText) {
          const text = await root.navigator.clipboard.readText();
          if (handlePastedText(text)) return;
        }
      } catch (e) {
        /* permission denied: fall back to the internal clipboard */
      }
      actions.paste();
    },

    duplicate() {
      const payload = actions.clipboardPayload();
      if (!payload) return;
      const result = store.change('duplicate', (p) => Model.paste(p, payload, null, { dx: 30, dy: 30 }));
      if (result && result.nodeIds.length) store.select(Model.topLevelOnly(store.project, result.nodeIds), result.connectionIds);
    },

    nudge(dx, dy) {
      const ids = store.selectedNodes();
      if (!ids.length) return;
      store.change('nudge', (p) => { Model.moveNodes(p, ids, dx, dy); }, { merge: 'nudge' });
    },

    tidy(rootId) {
      store.change('tidy', (p) => { Layout.autoLayout(p, rootId); });
      if (!rootId) root.requestAnimationFrame(() => canvas.fit());
    },

    loadSample() {
      store.change('sample', (p) => { Model.addSample(p); });
      root.requestAnimationFrame(() => canvas.fit());
    },

    async newProject(sample) {
      await flushSave();
      openProject(newProject(sample));
      toast(sample ? 'Sample blueprint created.' : 'New blueprint created.');
    },

    async open(id) {
      await flushSave();
      try {
        openProject(await storage.load(id));
      } catch (e) {
        toast('Could not open the blueprint: ' + e.message, 'error');
      }
    },

    async deleteProject(id) {
      try {
        await storage.remove(id);
        if (id === store.project.meta.id) openProject(newProject(false), true);
      } catch (e) {
        toast(e.message, 'error');
      }
    },

    async importFile(file) {
      if (!file) return;
      try {
        const result = await AISBP.Embedded.fromFile(file);
        const project = result.project;
        const existing = await storage.list();
        if (existing.some((e) => e.id === project.meta.id)) {
          const replace = await confirm('Blueprint already exists', 'A blueprint with the same id ("' + project.meta.name + '") is already saved. Replace it? Choose Cancel to import it as a copy.', 'Replace');
          if (!replace) {
            project.meta.id = Util.uid('p');
            project.meta.name += ' (copy)';
          }
        }
        await flushSave();
        openProject(project);
        save();
        toast('Imported "' + project.meta.name + '".' + (result.warnings.length ? ' ' + result.warnings.length + ' warning(s), see the console.' : ''), result.warnings.length ? 'info' : 'success');
        if (result.warnings.length && root.console) root.console.warn('Import warnings:\n' + result.warnings.join('\n'));
      } catch (e) {
        toast('Import failed: ' + e.message, 'error');
      }
    },

    async exportAs(format) {
      try {
        await AISBP.Exporter.run(format, store.snapshot());
      } catch (e) {
        toast('Export failed: ' + e.message, 'error');
      }
    },

    clearLocalData() {
      const keys = [];
      for (let i = 0; i < root.localStorage.length; i++) {
        const k = root.localStorage.key(i);
        if (k && k.indexOf(Storage.PREFIX) === 0) keys.push(k);
      }
      keys.forEach((k) => root.localStorage.removeItem(k));
      openProject(newProject(false), true);
      toast('All local data was deleted.', 'success');
    }
  };
  app.actions = actions;

  // ---------------------------------------------------------------------------
  // Persistence (autosave)
  // ---------------------------------------------------------------------------

  const saveState = doc.getElementById('save-state');
  let saving = null;

  async function save() {
    const project = store.project;
    saveState.textContent = 'Saving\u2026';
    try {
      saving = storage.save(project);
      await saving;
      Storage.setLastProjectId(project.meta.id);
      if (project === store.project) store.markSaved();
      saveState.textContent = 'Saved';
      saveState.title = 'Saved ' + new Date().toLocaleTimeString() + (storage.kind === 'local' ? ' in this browser' : ' to the server');
    } catch (e) {
      saveState.textContent = 'Not saved';
      saveState.title = e.message;
      toast(e.message, 'error');
    } finally {
      saving = null;
    }
  }

  const autosave = Util.debounce(save, 600);

  async function flushSave() {
    if (store.dirty) await save();
    else if (saving) await saving;
  }

  function openProject(project, skipSave) {
    store.load(project);
    if (!skipSave) Storage.setLastProjectId(project.meta.id);
    app.refreshAll();
    root.requestAnimationFrame(() => canvas.fit());
  }

  // ---------------------------------------------------------------------------
  // Chrome: toolbar
  // ---------------------------------------------------------------------------

  const styleSelect = doc.getElementById('style-select');
  const detailSelect = doc.getElementById('detail-select');
  const projectName = doc.getElementById('project-name');

  Object.keys(AISBP.Render.STYLES).forEach((k) => styleSelect.appendChild(AISBP.Dom.h('option', { value: k, text: AISBP.Render.STYLES[k].label })));
  Layout.DETAIL_LEVELS.forEach((d) => detailSelect.appendChild(AISBP.Dom.h('option', { value: d.id, text: d.label })));
  styleSelect.addEventListener('change', () => store.change('style', (p) => { p.settings.diagram.style = styleSelect.value; }));
  detailSelect.addEventListener('change', () => store.change('detail', (p) => { p.settings.diagram.detailLevel = detailSelect.value; }));
  // Light / dark mode (AISBP.Theme is loaded in <head>). The choice is cached in this browser and,
  // in server mode, also stored in the database.
  const themeSelect = doc.getElementById('theme-select');
  if (AISBP.Theme) {
    themeSelect.value = AISBP.Theme.get();
    themeSelect.addEventListener('change', async () => {
      const mode = AISBP.Theme.set(themeSelect.value);
      try {
        await storage.savePrefs({ theme: mode });
      } catch (e) {
        toast('Could not save the theme: ' + e.message, 'error');
      }
    });
  }
  projectName.addEventListener('input', () => store.change('rename', (p) => { p.meta.name = projectName.value; }, { merge: 'meta:name' }));

  function syncToolbar() {
    const d = store.project.settings.diagram;
    styleSelect.value = d.style;
    detailSelect.value = d.detailLevel;
    if (doc.activeElement !== projectName) projectName.value = store.project.meta.name;
    doc.querySelector('[data-action="undo"]').disabled = !store.canUndo();
    doc.querySelector('[data-action="redo"]').disabled = !store.canRedo();
    const hasSel = store.selection.nodes.size + store.selection.conns.size > 0;
    doc.querySelector('[data-action="copy"]').disabled = !store.selection.nodes.size;
    doc.querySelector('[data-action="delete"]').disabled = !hasSel;
    doc.title = store.project.meta.name + ' \u2014 AIS BluePrinter';
  }

  const exportMenuBtn = doc.querySelector('[data-action="export-menu"]');
  const exportMenu = exportMenuBtn.nextElementSibling;
  function toggleExportMenu(open) {
    exportMenu.hidden = !open;
    exportMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  const commands = {
    new: () => actions.newProject(false),
    projects: () => AISBP.Dialogs.openProjects(app),
    import: () => doc.getElementById('file-input').click(),
    'export-menu': () => toggleExportMenu(exportMenu.hidden),
    'export-json': () => actions.exportAs('json'),
    'export-png': () => actions.exportAs('png'),
    'export-pdf': () => actions.exportAs('pdf'),
    'export-svg': () => actions.exportAs('svg'),
    'export-drawio': () => actions.exportAs('drawio'),
    'export-archimate': () => actions.exportAs('archimate'),
    undo: () => store.undo(),
    redo: () => store.redo(),
    copy: () => actions.copy(),
    paste: () => actions.pasteFromSystem(),
    delete: () => actions.remove(),
    'zoom-in': () => canvas.zoomIn(),
    'zoom-out': () => canvas.zoomOut(),
    'zoom-reset': () => canvas.zoomReset(),
    fit: () => canvas.fit(),
    tidy: () => actions.tidy(),
    options: () => AISBP.Dialogs.openOptions(app),
    help: () => AISBP.Dialogs.openHelp(app),
    sample: () => actions.loadSample()
  };

  doc.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !commands[btn.getAttribute('data-action')]) {
      if (!e.target.closest('.menu')) toggleExportMenu(false);
      return;
    }
    const action = btn.getAttribute('data-action');
    if (action !== 'export-menu') toggleExportMenu(false);
    commands[action]();
  });

  doc.getElementById('file-input').addEventListener('change', (e) => {
    actions.importFile(e.target.files[0]);
    e.target.value = '';
  });

  // Sidebar tabs (palette / explorer)
  const tabButtons = [doc.getElementById('tab-palette'), doc.getElementById('tab-explorer')];
  tabButtons.forEach((btn) => btn.addEventListener('click', () => {
    tabButtons.forEach((b) => {
      const active = b === btn;
      b.setAttribute('aria-selected', active ? 'true' : 'false');
      doc.getElementById(b.getAttribute('aria-controls')).hidden = !active;
    });
  }));

  // ---------------------------------------------------------------------------
  // Keyboard and clipboard
  // ---------------------------------------------------------------------------

  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && el.type !== 'checkbox' && el.type !== 'button';
  const dialogOpen = () => !!doc.querySelector('dialog[open]');

  doc.addEventListener('keydown', (e) => {
    if (isEditable(e.target) || dialogOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    let handled = true;
    if (key === 'Delete' || key === 'Backspace') actions.remove();
    else if (mod && (key === 'z' || key === 'Z') && !e.shiftKey) store.undo();
    else if (mod && (key === 'y' || ((key === 'z' || key === 'Z') && e.shiftKey))) store.redo();
    else if (mod && (key === 'd' || key === 'D')) actions.duplicate();
    else if (mod && (key === 'a' || key === 'A')) store.selectAll();
    else if (mod && (key === 's' || key === 'S')) save();
    else if (key === 'Escape') store.clearSelection();
    else if (key.indexOf('Arrow') === 0 && !mod) {
      const step = e.shiftKey ? 10 * (store.project.settings.diagram.gridSize || 10) : store.project.settings.diagram.gridSize || 10;
      actions.nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0);
    } else if (!mod && (key === '+' || key === '=')) canvas.zoomIn();
    else if (!mod && key === '-') canvas.zoomOut();
    else if (!mod && key === '0') canvas.zoomReset();
    else if (!mod && (key === 'f' || key === 'F')) canvas.fit();
    else handled = false;
    if (handled) e.preventDefault();
  });

  /** Handle text from the system clipboard: a clipboard payload or a configuration package. */
  function handlePastedText(text) {
    if (!text || text.charAt(0) !== '{') return false;
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return false;
    }
    if (data && data.format === Model.FORMAT + '/clipboard') {
      actions.paste(data);
      return true;
    }
    if (data && data.format === Model.FORMAT) {
      actions.importFile(new Blob([text], { type: 'application/json' }));
      return true;
    }
    return false;
  }

  doc.addEventListener('copy', (e) => {
    if (isEditable(doc.activeElement) || dialogOpen()) return;
    const text = actions.copy(true);
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    toast('Copied ' + app.clipboard.nodes.length + ' object(s).');
  });

  doc.addEventListener('cut', (e) => {
    if (isEditable(doc.activeElement) || dialogOpen()) return;
    const text = actions.cut();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });

  doc.addEventListener('paste', (e) => {
    if (isEditable(doc.activeElement) || dialogOpen()) return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!handlePastedText(text)) actions.paste();
  });

  // ---------------------------------------------------------------------------
  // Mount and start
  // ---------------------------------------------------------------------------

  const palette = AISBP.Palette.mount(doc.getElementById('panel-palette'), app);
  const explorer = AISBP.Explorer.mount(doc.getElementById('panel-explorer'), app);
  const properties = AISBP.Properties.mount(doc.getElementById('panel-properties'), app);
  const canvas = AISBP.Canvas.mount(app);
  app.canvas = canvas;

  // Re-render the canvas when the light/dark theme changes (manually or via the system setting).
  if (AISBP.Theme) AISBP.Theme.onChange(() => canvas.queueRender());

  store.subscribe((reason) => {
    if (reason === 'live') {
      canvas.queueRender();
      return;
    }
    canvas.queueRender();
    explorer.render();
    properties.render();
    syncToolbar();
    if (reason === 'change' || reason === 'history') {
      saveState.textContent = 'Unsaved changes';
      autosave();
    }
  });

  root.addEventListener('beforeunload', () => {
    // localStorage writes are synchronous, so the last changes are saved before closing.
    if (store.dirty) storage.save(store.project);
  });

  if (storage.kind === 'server') {
    const note = doc.getElementById('storage-note');
    note.textContent = '\u{1F5C4} Stored in the database server';
    note.classList.add('server');
  }


  // Start with a new, blank blueprint (the "New" screen). Saved blueprints stay available via
  // Open, and the sample can be loaded from the empty canvas or the Open dialog. A blank blueprint
  // is only stored once something is changed.
  (async function start() {
    openProject(store.project, true);
    if (storage.kind === 'server') {
      try {
        await storage.list();
        const prefs = await storage.loadPrefs();
        if (prefs.theme && AISBP.Theme && prefs.theme !== AISBP.Theme.get()) themeSelect.value = AISBP.Theme.set(prefs.theme);
      } catch (e) {
        toast('Could not reach the database server: ' + e.message, 'error');
      }
    }
  })();

  AISBP.app = app;
})(typeof globalThis !== 'undefined' ? globalThis : this);
