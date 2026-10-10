'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, MemoryStorage } = require('./helpers');

const { Storage, Model } = AISBP;

test('LocalAdapter saves, lists, loads and removes projects in localStorage', async () => {
  const mem = new MemoryStorage();
  const adapter = Storage.LocalAdapter(mem);
  const p = Model.createProject({ name: 'Local', sample: true });
  await adapter.save(p);
  const list = await adapter.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Local');
  const loaded = await adapter.load(p.meta.id);
  assert.equal(Object.keys(loaded.nodes).length, Object.keys(p.nodes).length);
  assert.ok(mem.getItem('aisbp.project.' + p.meta.id));
  await adapter.remove(p.meta.id);
  assert.equal((await adapter.list()).length, 0);
  assert.equal(mem.getItem('aisbp.project.' + p.meta.id), null);
});

test('LocalAdapter ignores corrupt data', async () => {
  const mem = new MemoryStorage();
  mem.setItem('aisbp.index', '{not json');
  const adapter = Storage.LocalAdapter(mem);
  assert.deepEqual(await adapter.list(), []);
});

test('create() defaults to browser-only storage', () => {
  assert.equal(Storage.create({}).kind, 'local');
  assert.equal(Storage.create({ storage: { mode: 'server', apiUrl: 'server/php/api.php' } }).kind, 'server');
});

test('theme preference is sanitized and stored per adapter', async () => {
  assert.deepEqual(Storage.sanitizePrefs({ theme: 'dark', other: 1 }), { theme: 'dark' });
  assert.deepEqual(Storage.sanitizePrefs({ theme: 'neon' }), {});
  assert.deepEqual(Storage.sanitizePrefs(null), {});

  const mem = new MemoryStorage();
  const local = Storage.LocalAdapter(mem);
  await local.savePrefs({ theme: 'light' });
  assert.deepEqual(await local.loadPrefs(), { theme: 'light' });
  await local.savePrefs({ theme: 'bogus' });
  assert.equal((await local.loadPrefs()).theme, 'light');

  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, prefs: { theme: 'dark', x: 'y' } }) };
  };
  try {
    const api = Storage.ApiAdapter('api.php');
    assert.deepEqual(await api.loadPrefs(), { theme: 'dark' });
    await api.savePrefs({ theme: 'system', x: 1 });
    assert.match(calls[1].url, /action=save-prefs/);
    assert.equal(calls[1].init.method, 'POST');
    assert.equal(calls[1].init.body, '{"theme":"system"}');
  } finally {
    globalThis.fetch = saved;
  }
});
