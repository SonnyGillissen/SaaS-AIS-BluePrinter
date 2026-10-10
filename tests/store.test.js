'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP } = require('./helpers');

const { Store, Model } = AISBP;

test('change / undo / redo', () => {
  const store = Store.createStore(Model.createProject({ name: 'A' }));
  store.change('rename', (p) => { p.meta.name = 'B'; });
  assert.equal(store.project.meta.name, 'B');
  assert.ok(store.canUndo());
  store.undo();
  assert.equal(store.project.meta.name, 'A');
  store.redo();
  assert.equal(store.project.meta.name, 'B');
});

test('consecutive edits with the same merge key form one undo step', () => {
  const store = Store.createStore(Model.createProject({ name: 'A' }));
  'Hello'.split('').forEach((ch, i) => store.change('type', (p) => { p.meta.name = 'Hello'.slice(0, i + 1); }, { merge: 'name' }));
  assert.equal(store.project.meta.name, 'Hello');
  store.undo();
  assert.equal(store.project.meta.name, 'A');
});

test('gestures (begin / live / commit / rollback) record a single step', () => {
  const store = Store.createStore(Model.createProject({ name: 'A' }));
  const events = [];
  store.subscribe((type) => events.push(type));
  const snap = store.begin();
  store.live((p) => { p.meta.name = 'B'; });
  store.live((p) => { p.meta.name = 'C'; });
  store.commit(snap);
  assert.ok(events.includes('live'));
  store.undo();
  assert.equal(store.project.meta.name, 'A');
  const snap2 = store.begin();
  store.live((p) => { p.meta.name = 'Z'; });
  store.rollback(snap2);
  assert.equal(store.project.meta.name, 'A');
});

test('load clears history and selection', () => {
  const store = Store.createStore(Model.createProject());
  store.change('x', (p) => { p.meta.name = 'x'; });
  store.load(Model.createProject({ name: 'Other' }));
  assert.equal(store.canUndo(), false);
  assert.equal(store.project.meta.name, 'Other');
});
