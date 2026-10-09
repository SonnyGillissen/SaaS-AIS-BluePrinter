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

test('sanitizeBranding only accepts safe logo and link URLs', () => {
  const ok = Storage.sanitizeBranding({ footerText: 'Contoso', footerLogo: 'assets/logo.svg', footerLink: 'https://contoso.com' });
  assert.deepEqual(ok, { footerText: 'Contoso', footerLogo: 'assets/logo.svg', footerLink: 'https://contoso.com' });
  const bad = Storage.sanitizeBranding({ footerText: 'X', footerLogo: 'javascript:alert(1)', footerLink: 'javascript:alert(1)' });
  assert.equal(bad.footerLogo, '');
  assert.equal(bad.footerLink, '');
  assert.equal(Storage.sanitizeBranding(null).footerText, 'Sonny Gillissen');
});
