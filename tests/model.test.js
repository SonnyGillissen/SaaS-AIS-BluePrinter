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

test('resources can be attached to virtual networks and subnets', () => {
  const p = Model.createProject();
  const sub = Model.addNode(p, 'subscription', null, {});
  const rg = Model.addNode(p, 'resource-group', sub.id, {});
  const vnet = Model.addNode(p, 'virtual-network', rg.id, {});
  const snet = Model.addNode(p, 'subnet', vnet.id, {});
  const kv = Model.addNode(p, 'key-vault', rg.id, {});
  assert.ok(AISBP.Catalog.supportsNetwork('function-app'));
  assert.ok(AISBP.Catalog.supportsNetwork('private-endpoint'));
  assert.ok(!AISBP.Catalog.supportsNetwork('service-bus-queue'));
  assert.deepEqual(Model.networkTargets(p).map((n) => n.id), [vnet.id, snet.id]);

  Model.updateNode(p, kv.id, { network: [snet.id] });
  const attrs = AISBP.Layout.visibleAttributes(p, p.nodes[kv.id]);
  assert.ok(attrs.some((a) => a.key === 'network' && a.value.indexOf(' / ') > 0), 'network line shows vnet / subnet');

  // Invalid links are dropped on import; links survive a round trip.
  const raw = JSON.parse(JSON.stringify(p));
  raw.nodes[kv.id].network.push(rg.id, 'missing');
  const { project, warnings } = Model.normalize(raw);
  assert.deepEqual(project.nodes[kv.id].network, [snet.id]);
  assert.ok(warnings.length === 1);

  // Pasting keeps links to existing networks; deleting the subnet removes the link.
  const res = Model.paste(p, Model.extract(p, [kv.id]), rg.id);
  assert.deepEqual(p.nodes[res.nodeIds[0]].network, [snet.id]);
  Model.removeNodes(p, [vnet.id]);
  assert.deepEqual(p.nodes[kv.id].network, []);
  assert.deepEqual(p.nodes[res.nodeIds[0]].network, []);
});

test('connections support a bidirectional direction', () => {
  const p = Model.createProject({ sample: true });
  const c = p.connections[Object.keys(p.connections)[0]];
  assert.equal(c.direction, 'forward');
  Model.updateConnection(p, c.id, { direction: 'bidirectional' });
  assert.equal(c.direction, 'bidirectional');
  Model.updateConnection(p, c.id, { direction: 'sideways' });
  assert.equal(c.direction, 'forward');
  Model.updateConnection(p, c.id, { direction: 'bidirectional' });
  assert.equal(Model.normalize(JSON.parse(JSON.stringify(p))).project.connections[c.id].direction, 'bidirectional');
  assert.match(AISBP.Render.renderDocument(p, {}).svg, /marker-start="url\(#[^"]*arrow/);
  const drawio = AISBP.DrawIo.toDrawio(p, {});
  assert.match(drawio, /direction="bidirectional"/);
  assert.match(drawio, /startArrow=block/);
  assert.match(AISBP.ArchiMate.toArchiMate(p), /Bidirectional/);
});

test('containers honour a manual size, never shrink below their content and Tidy up resets it', () => {
  const { Layout } = AISBP;
  const p = Model.createProject();
  const sub = Model.addNode(p, 'subscription', null, { x: 0, y: 0 });
  const rg = Model.addNode(p, 'resource-group', sub.id, { x: 30, y: 60 });
  Model.addNode(p, 'function-app', rg.id, { x: 60, y: 120 });
  const auto = Layout.compute(p, null).rects[rg.id];

  rg.w = 600; rg.h = 500;
  const big = Layout.compute(p, null).rects[rg.id];
  assert.ok(big.w >= 600 && big.h >= 500 - (rg.y - big.y));

  rg.w = 10; rg.h = 10;
  const small = Layout.compute(p, null).rects[rg.id];
  assert.ok(small.w >= auto.w && small.h >= auto.h);

  const frozen = Layout.compute(p, null, { frozen: { [rg.id]: { x: big.x, y: big.y, w: big.w, h: big.h } } }).rects[rg.id];
  assert.ok(frozen.w >= big.w && frozen.h >= big.h);

  rg.w = 600; rg.h = 500;
  Layout.autoLayout(p, null);
  assert.equal(Layout.hasManualSize(rg), false);
});

test('normalize keeps valid container sizes and drops invalid ones', () => {
  const p = Model.createProject();
  const sub = Model.addNode(p, 'subscription', null, { x: 0, y: 0, w: 800, h: 400 });
  const rg = Model.addNode(p, 'resource-group', sub.id, { x: 30, y: 60 });
  const raw = JSON.parse(JSON.stringify(p));
  raw.nodes[rg.id].w = 'huge'; raw.nodes[rg.id].h = -5;
  const { project } = Model.normalize(raw);
  assert.equal(project.nodes[sub.id].w, 800);
  assert.equal(project.nodes[sub.id].h, 400);
  assert.equal(project.nodes[rg.id].w, undefined);
  assert.equal(project.nodes[rg.id].h, undefined);
});
