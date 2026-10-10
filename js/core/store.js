/**
 * AIS BluePrinter - application state store.
 *
 * Holds the current project, the selection and the undo/redo history. Every change to the
 * project goes through `store.change(label, fn)`, which records a snapshot for undo, marks
 * the project dirty and notifies subscribers (UI panels, canvas, autosave).
 *
 * The store has no DOM dependencies and is unit tested in Node.
 *
 * @module AISBP.Store
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('./util.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('./layout.js') : null);
  const Naming = AISBP.Naming || (typeof require === 'function' ? require('./naming.js') : null);

  const MAX_HISTORY = 100;
  /** Edits with the same merge key within this time window form a single undo step. */
  const MERGE_WINDOW_MS = 1200;

  /**
   * Create a store.
   * @param {object} project initial project
   */
  function createStore(project) {
    const listeners = new Set();
    const store = {
      project,
      selection: { nodes: new Set(), conns: new Set() },
      past: [],
      future: [],
      dirty: false,
      version: 0
    };
    let lastMerge = { key: null, time: 0 };
    let cache = { version: -1 };

    /** Notify subscribers. `reason`: 'change' | 'selection' | 'load' | 'history' */
    function emit(reason) {
      listeners.forEach((fn) => {
        try {
          fn(reason, store);
        } catch (e) {
          if (root.console) root.console.error(e);
        }
      });
    }

    /** Subscribe to changes. Returns an unsubscribe function. */
    store.subscribe = function (fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    };

    /** Geometry, names and validation problems of the current project (cached per version). */
    store.derived = function () {
      if (cache.version !== store.version) {
        const names = Layout.resolveNames(store.project);
        cache = { version: store.version, geometry: Layout.compute(store.project, names), problems: Naming.validateProject(store.project) };
      }
      return cache;
    };

    /**
     * Apply a change to the project.
     * @param {string} label description (for debugging / future history UI)
     * @param {function(object):*} fn mutation; return `false` to cancel recording
     * @param {object} [opts] { merge: key } merges consecutive edits with the same key into one undo step
     * @returns {*} the return value of fn
     */
    store.change = function (label, fn, opts) {
      const before = JSON.stringify(store.project);
      const result = fn(store.project);
      const after = JSON.stringify(store.project);
      if (result === false || before === after) return result;
      const t = Date.now();
      const mergeKey = opts && opts.merge;
      const merge = mergeKey && lastMerge.key === mergeKey && t - lastMerge.time < MERGE_WINDOW_MS && store.past.length;
      if (!merge) {
        store.past.push(before);
        if (store.past.length > MAX_HISTORY) store.past.shift();
      }
      lastMerge = { key: mergeKey || null, time: t };
      store.future = [];
      store.dirty = true;
      store.version++;
      pruneSelection();
      emit('change');
      return result;
    };

    /**
     * Interactive gestures (dragging): `begin()` takes a snapshot, `live(fn)` mutates the
     * project and redraws without recording history, `commit(snapshot)` records one undo step.
     */
    store.begin = () => JSON.stringify(store.project);

    store.live = function (fn) {
      fn(store.project);
      store.version++;
      emit('live');
    };

    store.commit = function (snapshot) {
      if (snapshot === JSON.stringify(store.project)) return false;
      store.past.push(snapshot);
      if (store.past.length > MAX_HISTORY) store.past.shift();
      store.future = [];
      store.dirty = true;
      store.version++;
      store.endMerge();
      pruneSelection();
      emit('change');
      return true;
    };

    /** Abort a gesture: restore the snapshot taken by `begin()` without recording history. */
    store.rollback = function (snapshot) {
      store.project = JSON.parse(snapshot);
      store.version++;
      pruneSelection();
      emit('history');
    };

    /** Break the merge chain (e.g. when a text field loses focus). */
    store.endMerge = function () {
      lastMerge = { key: null, time: 0 };
    };

    function restore(snapshot) {
      store.project = JSON.parse(snapshot);
      store.dirty = true;
      store.version++;
      pruneSelection();
      emit('history');
    }

    store.canUndo = () => store.past.length > 0;
    store.canRedo = () => store.future.length > 0;

    store.undo = function () {
      if (!store.past.length) return false;
      store.future.push(JSON.stringify(store.project));
      restore(store.past.pop());
      store.endMerge();
      return true;
    };

    store.redo = function () {
      if (!store.future.length) return false;
      store.past.push(JSON.stringify(store.project));
      restore(store.future.pop());
      store.endMerge();
      return true;
    };

    /** Replace the project (open / import / new). Clears history and selection. */
    store.load = function (p) {
      store.project = p;
      store.past = [];
      store.future = [];
      store.dirty = false;
      store.version++;
      store.selection = { nodes: new Set(), conns: new Set() };
      store.endMerge();
      emit('load');
    };

    store.markSaved = function () {
      store.dirty = false;
    };

    // -------------------------------------------------------------------------
    // Selection
    // -------------------------------------------------------------------------

    function pruneSelection() {
      store.selection.nodes.forEach((id) => { if (!store.project.nodes[id]) store.selection.nodes.delete(id); });
      store.selection.conns.forEach((id) => { if (!store.project.connections[id]) store.selection.conns.delete(id); });
    }

    /**
     * Set the selection.
     * @param {string[]} nodeIds
     * @param {string[]} [connIds]
     * @param {boolean} [additive] toggle the given ids in the existing selection
     */
    store.select = function (nodeIds, connIds, additive) {
      if (!additive) store.selection = { nodes: new Set(), conns: new Set() };
      (nodeIds || []).forEach((id) => {
        if (!store.project.nodes[id]) return;
        if (additive && store.selection.nodes.has(id)) store.selection.nodes.delete(id);
        else store.selection.nodes.add(id);
      });
      (connIds || []).forEach((id) => {
        if (!store.project.connections[id]) return;
        if (additive && store.selection.conns.has(id)) store.selection.conns.delete(id);
        else store.selection.conns.add(id);
      });
      emit('selection');
    };

    store.selectAll = function () {
      store.select(Object.keys(store.project.nodes), Object.keys(store.project.connections));
    };

    store.clearSelection = function () {
      if (!store.selection.nodes.size && !store.selection.conns.size) return;
      store.select([], []);
    };

    store.selectedNodes = () => Array.from(store.selection.nodes);
    store.selectedConns = () => Array.from(store.selection.conns);

    /** The single selected node (or undefined when 0 or several are selected). */
    store.singleNode = function () {
      if (store.selection.nodes.size !== 1 || store.selection.conns.size) return undefined;
      return store.project.nodes[store.selectedNodes()[0]];
    };

    /** A snapshot copy of the current project (for exports). */
    store.snapshot = () => Util.clone(store.project);

    return store;
  }

  AISBP.Store = { createStore, MAX_HISTORY, MERGE_WINDOW_MS };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);
