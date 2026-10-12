'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');
const { Model, Layout, Render, Package, DrawIo, ArchiMate, Store } = AISBP;

function routedProject() {
  const data = smallProject(AISBP, ['function-app', 'key-vault']);
  data.connection = Model.addConnection(data.project, data.nodes[0].id, data.nodes[1].id, {
    waypoints: [{ x: -200, y: 900 }, { x: 400, y: 900 }],
    direction: 'bidirectional'
  });
  return data;
}

test('routing points are sanitized and preserved by package and clipboard imports', () => {
  const { project, connection, nodes } = routedProject();
  assert.deepEqual(Package.fromJson(Package.toJson(project)).project.connections[connection.id].waypoints, connection.waypoints);
  const payload = Model.extract(project, nodes.map((n) => n.id));
  const pasted = Model.paste(project, payload, null, { dx: 30, dy: 40 });
  assert.deepEqual(project.connections[pasted.connectionIds[0]].waypoints, [{ x: -170, y: 940 }, { x: 430, y: 940 }]);
  const partial = Model.extract(project, [nodes[0].id], [connection.id]);
  const external = Model.paste(project, partial, null, { dx: 80, dy: 90 });
  assert.deepEqual(project.connections[external.connectionIds[0]].waypoints, connection.waypoints);
  const dirty = [null, {}, { x: '10', y: 20 }, { x: Infinity, y: 20 }, { x: 10, y: NaN }, { x: 1e9, y: -1e9, extra: 'ignored' }];
  Model.updateConnection(project, connection.id, { waypoints: dirty });
  assert.deepEqual(connection.waypoints, [{ x: 100000, y: -100000 }]);
  connection.waypoints = dirty;
  assert.deepEqual(Model.normalize(project).project.connections[connection.id].waypoints, [{ x: 100000, y: -100000 }]);
  assert.equal(Model.cleanWaypoints(Array.from({ length: 150 }, () => ({ x: 0, y: 0 }))).length, 100);
  delete connection.waypoints;
  assert.deepEqual(Model.normalize(project).project.connections[connection.id].waypoints, []);
});

test('manual routes pass through their points for all connector styles without changing automatic paths', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 400, y: 200, w: 100, h: 100 };
  const points = [{ x: 150, y: 300 }, { x: 350, y: 300 }];
  for (const style of ['straight', 'orthogonal', 'curved']) {
    assert.deepEqual(Render.connectorPath(a, b, style, []), Render.connectorPath(a, b, style));
    const route = Render.connectorPath(a, b, style, points);
    assert.equal((route.d.match(/M/g) || []).length, 1);
    if (style === 'orthogonal') assert.ok(route.d.includes('H150') && route.d.includes('H350') && route.d.includes('V300'));
    else assert.ok(route.d.includes('150 300') && route.d.includes('350 300'));
    assert.ok(!/NaN|Infinity/.test(route.d));
    assert.equal(route.handles.filter((h) => !h.insert).length, 2);
    assert.equal(route.handles.filter((h) => h.insert).length, 3);
    assert.match(route.d, style === 'straight' ? /L/ : style === 'curved' ? /C/ : /H.*V/);
  }
});

test('routing bounds and diagram exports include edited points, without editor handles', () => {
  const { project, connection } = routedProject();
  const g = Layout.compute(project);
  assert.ok(g.bounds.x <= -200 && g.bounds.y + g.bounds.h >= 900);
  const route = Render.connectorPath(g.rects[connection.from], g.rects[connection.to], 'orthogonal', connection.waypoints);
  const document = Render.renderDocument(project);
  assert.ok(document.svg.includes('d="' + route.d + '"'));
  assert.ok(document.svg.includes('marker-start=') && document.svg.includes('marker-end='));
  assert.ok(!document.svg.includes('data-handle='));
  const drawio = DrawIo.toDrawio(project, { embedDiagram: false });
  assert.ok(drawio.includes('<Array as="points"><mxPoint x="' + (-200 - g.bounds.x + 40) + '" y="' + (900 - g.bounds.y + 40) + '"/>'));
  const archimate = ArchiMate.toArchiMate(project, { embedDiagram: false });
  assert.ok(archimate.includes('<bendpoint x="' + Math.round(-200 + 20 - g.bounds.x) + '" y="' + Math.round(900 + 20 - g.bounds.y) + '"/>'));
});

test('routing drags, cancellation, reset and node movement use normal history semantics', () => {
  const { project, connection, nodes, rg } = routedProject();
  const originalPoints = structuredClone(connection.waypoints);
  const store = Store.createStore(project);
  const before = store.begin();
  store.live((p) => Model.updateConnection(p, connection.id, { waypoints: [{ x: 10, y: 20 }] }));
  store.live((p) => Model.updateConnection(p, connection.id, { waypoints: [{ x: 30, y: 40 }] }));
  store.commit(before);
  assert.equal(store.past.length, 1);
  store.undo();
  assert.deepEqual(store.project.connections[connection.id].waypoints, originalPoints);
  store.redo();
  const cancel = store.begin();
  store.live((p) => Model.updateConnection(p, connection.id, { waypoints: [{ x: 50, y: 60 }] }));
  store.rollback(cancel);
  assert.deepEqual(store.project.connections[connection.id].waypoints, [{ x: 30, y: 40 }]);
  Model.moveNodes(store.project, [nodes[0].id], 10, 20);
  assert.deepEqual(store.project.connections[connection.id].waypoints, [{ x: 30, y: 40 }]);
  Model.moveNodes(store.project, [rg.id], 10, 20);
  assert.deepEqual(store.project.connections[connection.id].waypoints, [{ x: 40, y: 60 }]);
  store.change('reset route', (p) => Model.updateConnection(p, connection.id, { waypoints: [] }));
  assert.deepEqual(store.project.connections[connection.id].waypoints, []);
  store.undo();
  assert.deepEqual(store.project.connections[connection.id].waypoints, [{ x: 40, y: 60 }]);
});
