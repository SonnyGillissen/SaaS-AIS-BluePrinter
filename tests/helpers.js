/**
 * Test helper: loads the browser modules in Node (they register on globalThis.AISBP) in the
 * same order as index.html and returns the namespace.
 */
'use strict';

const path = require('node:path');

const MODULES = [
  'core/util', 'core/catalog', 'core/tags', 'core/annotations', 'core/model', 'core/naming', 'core/layout', 'core/azure', 'core/store', 'core/storage',
  'render/svg', 'render/icons', 'export/package', 'export/embedded', 'export/drawio', 'export/archimate', 'export/raster', 'export/infrastructure',
  'azure/arm', 'azure/auth'
];
MODULES.forEach((m) => require(path.join(__dirname, '..', 'js', m + '.js')));

/** Minimal in-memory implementation of the Web Storage API. */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

/** Build a small project: subscription > resource group > given resource types. */
function smallProject(AISBP, types) {
  const { Model } = AISBP;
  const p = Model.createProject({ name: 'Test' });
  const sub = Model.addNode(p, 'subscription', null, {});
  const rg = Model.addNode(p, 'resource-group', sub.id, {});
  const nodes = (types || []).map((t) => Model.addNode(p, t, rg.id, {}));
  return { project: p, sub, rg, nodes };
}

module.exports = { AISBP: globalThis.AISBP, MemoryStorage, smallProject };
