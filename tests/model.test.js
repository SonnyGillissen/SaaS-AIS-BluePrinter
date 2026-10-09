'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');

const { Model } = AISBP;

test('the sample project is valid and round-trips through normalize', () => {
  const p = Model.createProject({ sample: true });
  assert.ok(Object.keys(p.nodes).length > 5);
  const { project, warnings } = Model.normalize(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(warnings, []);
  assert.deepEqual(Object.keys(project.nodes).sort(), Object.keys(p.nodes).sort());
  assert.deepEqual(Object.keys(project.connections).sort(), Object.keys(p.connections).sort());
});

test('containment rules are enforced (management group > subscription > resource group > resource)', () => {
  const p = Model.createProject();
  assert.throws(() => Model.addNode(p, 'function-app', null, {}), /cannot be placed/);
  const mg = Model.addNode(p, 'management-group', null, {});
  const sub = Model.addNode(p, 'subscription', mg.id, {});
  assert.throws(() => Model.addNode(p, 'function-app', sub.id, {}), /cannot be placed/);
  const rg = Model.addNode(p, 'resource-group', sub.id, {});
  const ns = Model.addNode(p, 'service-bus-namespace', rg.id, {});
  Model.addNode(p, 'service-bus-queue', ns.id, {});
  assert.throws(() => Model.addNode(p, 'service-bus-queue', rg.id, {}), /cannot be placed/);
});

test('reparent prevents cycles and invalid parents', () => {
  const { project, sub, rg, nodes } = smallProject(AISBP, ['function-app']);
  assert.equal(Model.reparent(project, sub.id, rg.id), false, 'no cycles');
  assert.equal(Model.reparent(project, nodes[0].id, sub.id), false, 'function app must live in a resource group');
  const rg2 = Model.addNode(project, 'resource-group', sub.id, {});
  assert.equal(Model.reparent(project, nodes[0].id, rg2.id), true);
  assert.equal(project.nodes[nodes[0].id].parentId, rg2.id);
});

test('removeNodes removes descendants and their connections', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app', 'key-vault']);
  Model.addConnection(project, nodes[0].id, nodes[1].id, { kind: 'access' });
  const removed = Model.removeNodes(project, [rg.id]);
  assert.equal(removed.length, 3);
  assert.equal(Object.keys(project.connections).length, 0);
});

test('copy/paste duplicates a subtree with new ids and remapped connections', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app', 'key-vault']);
  Model.addConnection(project, nodes[0].id, nodes[1].id, { kind: 'access', label: 'secrets' });
  const clip = JSON.parse(JSON.stringify(Model.extract(project, [rg.id], [])));
  const result = Model.paste(project, clip, rg.id, { dx: 20, dy: 20 });
  assert.equal(result.nodeIds.length, 3);
  assert.equal(result.connectionIds.length, 1);
  const pastedRg = project.nodes[result.nodeIds[0]];
  assert.equal(pastedRg.type, 'resource-group');
  assert.equal(pastedRg.parentId, rg.parentId, 'resource group pasted next to the original (RG cannot contain RG)');
  const conn = project.connections[result.connectionIds[0]];
  assert.ok(result.nodeIds.includes(conn.from) && result.nodeIds.includes(conn.to));
  assert.equal(conn.label, 'secrets');
});

test('sanitizeClipboard rejects foreign or malicious payloads', () => {
  assert.equal(Model.sanitizeClipboard(null), null);
  assert.equal(Model.sanitizeClipboard('text'), null);
  assert.equal(Model.sanitizeClipboard({ format: 'other' }), null);
  const evil = JSON.parse('{"format":"ais-blueprinter/clipboard","version":1,"roots":["__proto__"],"nodes":[{"id":"__proto__","type":"subscription"},{"id":"ok1","type":"no-such-type"}],"connections":[]}');
  const project = Model.createProject();
  const result = Model.paste(project, evil, null);
  assert.equal(result.nodeIds.length, 0);
  assert.equal(Object.prototype.polluted, undefined);
});

test('normalize repairs broken input instead of failing', () => {
  const input = {
    format: 'ais-blueprinter',
    version: 1,
    meta: { name: '<b>x</b>' },
    nodes: {
      a: { id: 'a', type: 'subscription', parentId: null },
      b: { id: 'b', type: 'function-app', parentId: 'a' },
      c: { id: 'c', type: 'unknown-type', parentId: null },
      'bad id': { id: 'bad id', type: 'subscription' }
    },
    connections: { x: { id: 'x', from: 'a', to: 'missing' } }
  };
  const { project, warnings } = Model.normalize(input);
  assert.ok(project.nodes.a);
  assert.ok(!project.nodes.c && !project.nodes['bad id']);
  assert.equal(Object.keys(project.connections).length, 0);
  assert.ok(warnings.length > 0);
  assert.equal(project.meta.name, '<b>x</b>', 'text is kept verbatim; escaping happens when rendering');
});

test('normalize rejects non-project input', () => {
  assert.throws(() => Model.normalize(null));
  assert.throws(() => Model.normalize({ format: 'something-else' }));
});
