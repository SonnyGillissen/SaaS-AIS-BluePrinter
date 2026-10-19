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
  assert.ok(drawio.includes('<mxPoint x="' + (-200 - g.bounds.x + 40) + '" y="' + (900 - g.bounds.y + 40) + '"/>'));
  const archimate = ArchiMate.toArchiMate(project, { embedDiagram: false });
  assert.ok(archimate.includes('<bendpoint x="' + Math.round(-200 + 20 - g.bounds.x) + '" y="' + Math.round(900 + 20 - g.bounds.y) + '"/>'));
});

function assertOrthogonalRoute(route, points) {
  const vertices = route.vertices;
  const onSegment = (p, a, b) => (a.x === b.x && p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y)) ||
    (a.y === b.y && p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x));
  for (let i = 1; i < vertices.length; i++) {
    const p = vertices[i - 1];
    const q = vertices[i];
    assert.ok(p.x === q.x || p.y === q.y, 'Every segment is axis aligned');
    assert.ok(p.x !== q.x || p.y !== q.y, 'No zero-length segment');
    if (i < 2) continue;
    const prev = vertices[i - 2];
    const incoming = { x: p.x - prev.x, y: p.y - prev.y };
    const outgoing = { x: q.x - p.x, y: q.y - p.y };
    assert.ok(incoming.x * outgoing.x + incoming.y * outgoing.y >= 0, 'No retraced spur at waypoint or bend');
  }
  const onPath = (p) => vertices.slice(1).some((q, i) => onSegment(p, vertices[i], q));
  for (const point of points) assert.ok(onPath(point), 'Route visits every waypoint');
  for (const handle of route.handles) assert.ok(onPath(handle), 'Routing handle lies on path');
  assert.ok(onPath(route.label), 'Label lies on path');
  assert.ok(!/NaN|Infinity/.test(route.d));
}

test('orthogonal waypoint turns do not create the overlapping spur shown in the reported diagram', () => {
  const a = { x: 29, y: 77, w: 367, h: 216 };
  const b = { x: 223, y: 768, w: 367, h: 216 };
  const points = [{ x: 1216, y: 380 }, { x: 806, y: 487 }];
  assertOrthogonalRoute(Render.connectorPath(a, b, 'orthogonal', points), points);
  // Check all quadrants, not just left-to-right connections.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const mirrorRect = (r) => ({ x: sx < 0 ? -r.x - r.w : r.x, y: sy < 0 ? -r.y - r.h : r.y, w: r.w, h: r.h });
    const mirrored = points.map((p) => ({ x: sx * p.x, y: sy * p.y }));
    assertOrthogonalRoute(Render.connectorPath(mirrorRect(a), mirrorRect(b), 'orthogonal', mirrored), mirrored);
  }
});

test('orthogonal routing handles aligned, repeated and single points without artificial midpoint detours', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 500, y: 300, w: 100, h: 100 };
  for (const points of [
    [{ x: 300, y: 50 }, { x: 300, y: 200 }],
    [{ x: 300, y: 200 }, { x: 400, y: 200 }],
    [{ x: 300, y: 200 }, { x: 300, y: 200 }],
    [{ x: 300, y: 200 }],
    [{ x: 50, y: -100 }],
    [{ x: 300, y: 50 }, { x: 300, y: 200 }, { x: 250, y: 250 }]
  ]) assertOrthogonalRoute(Render.connectorPath(a, b, 'orthogonal', points), points);
  const points = [{ x: 300, y: 50 }, { x: 300, y: 200 }];
  const route = Render.connectorPath(a, b, 'orthogonal', points);
  const handle = route.handles.find((p) => p.insert && p.index === 1);
  assert.deepEqual({ x: handle.x, y: handle.y }, { x: 300, y: 125 });
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

test('anchors sanitize consistently and survive packages, clipboard, paste and embedded exports', async () => {
  const { project, connection, nodes } = routedProject();
  const sourceAnchor = { side: 'right', offset: 0.2 };
  const targetAnchor = { side: 'top', offset: 0.75 };
  Model.updateConnection(project, connection.id, { sourceAnchor, targetAnchor });
  const assertAnchors = (c) => {
    assert.deepEqual(c.sourceAnchor, sourceAnchor);
    assert.deepEqual(c.targetAnchor, targetAnchor);
  };
  assertAnchors(Package.fromJson(Package.toJson(project)).project.connections[connection.id]);
  const payload = Model.sanitizeClipboard(Model.extract(project, nodes.map((n) => n.id)));
  const copies = Model.paste(project, payload, null, { dx: 30, dy: 40 });
  assertAnchors(project.connections[copies.connectionIds[0]]);
  const partial = Model.sanitizeClipboard(Model.extract(project, [nodes[0].id], [connection.id]));
  assertAnchors(partial.connections[0]);
  const partialCopies = Model.paste(project, partial, null, { dx: 50, dy: 60 });
  assertAnchors(project.connections[partialCopies.connectionIds[0]]);
  for (const xml of [DrawIo.toDrawio(project), ArchiMate.toArchiMate(project)]) {
    assertAnchors((await AISBP.Embedded.fromFile(new Blob([xml]))).project.connections[connection.id]);
  }
  const xml = DrawIo.toDrawio(project, { embedDiagram: false });
  assert.ok(xml.includes('exitX=1;exitY=0.2;exitDx=0;exitDy=0;exitPerimeter=0;'));
  assert.ok(xml.includes('entryX=0.75;entryY=0;entryDx=0;entryDy=0;entryPerimeter=0;'));
  for (const value of [null, {}, { side: 'center', offset: 0.5 }, { side: 'top', offset: '0.5' }, { side: 'left', offset: Infinity }, { side: 'right', offset: NaN }]) {
    assert.equal(Model.cleanAnchor(value), null);
    Model.updateConnection(project, connection.id, { sourceAnchor: value });
    assert.equal(connection.sourceAnchor, null);
    connection.sourceAnchor = value;
    assert.equal(Model.normalize(project).project.connections[connection.id].sourceAnchor, null);
  }
  assert.deepEqual(Model.cleanAnchor({ side: 'left', offset: -2, extra: 'ignored' }), { side: 'left', offset: 0 });
  assert.deepEqual(Model.cleanAnchor({ side: 'bottom', offset: 2 }), { side: 'bottom', offset: 1 });
  const added = Model.addConnection(project, nodes[0].id, nodes[1].id, { sourceAnchor: { side: 'top', offset: 9 } });
  assert.deepEqual(added.sourceAnchor, { side: 'top', offset: 1 });
  delete added.sourceAnchor;
  assert.equal(Model.normalize(project).project.connections[added.id].sourceAnchor, null);
});

test('anchored endpoints are stable through waypoint edits, node moves, resize, reverse and separate resets', () => {
  const { project, connection, nodes, rg } = routedProject();
  const store = Store.createStore(project);
  const sourceAnchor = { side: 'left', offset: 0.25 };
  const targetAnchor = { side: 'bottom', offset: 0.75 };
  Model.updateConnection(project, connection.id, { sourceAnchor, targetAnchor });
  const route = (style) => {
    const g = Layout.compute(store.project);
    const c = store.project.connections[connection.id];
    return Render.connectorPath(g.rects[c.from], g.rects[c.to], style, c.waypoints, c.sourceAnchor, c.targetAnchor);
  };
  for (const style of ['orthogonal', 'straight', 'curved']) {
    const before = route(style);
    Model.updateConnection(store.project, connection.id, { waypoints: [{ x: 700, y: -200 }] });
    const after = route(style);
    assert.deepEqual(after.start, before.start);
    assert.deepEqual(after.end, before.end);
    const svg = Render.renderDocument(store.project, { embedDiagram: false }).svg;
    assert.ok(!svg.includes('data-handle='));
  }
  const beforeMove = route('orthogonal');
  Model.moveNodes(store.project, [nodes[1].id], 100, 50);
  const afterMove = route('orthogonal');
  assert.deepEqual(afterMove.start, beforeMove.start);
  assert.deepEqual(afterMove.end, { x: beforeMove.end.x + 100, y: beforeMove.end.y + 50 });
  const containerConn = Model.addConnection(store.project, rg.id, nodes[1].id, { sourceAnchor: { side: 'bottom', offset: 0.25 }, targetAnchor });
  const previous = Layout.compute(store.project).rects[rg.id];
  store.project.nodes[rg.id].w = previous.w + 200;
  store.project.nodes[rg.id].h = previous.h + 100;
  const g = Layout.compute(store.project);
  const resized = Render.connectorPath(g.rects[rg.id], g.rects[nodes[1].id], 'orthogonal', [], containerConn.sourceAnchor, targetAnchor);
  assert.deepEqual(resized.start, Render.anchorPoint(g.rects[rg.id], containerConn.sourceAnchor));
  assert.ok(g.rects[rg.id].w > previous.w && g.rects[rg.id].h > previous.h);
  Model.updateConnection(store.project, connection.id, { waypoints: [{ x: 100, y: 200 }, { x: 300, y: 400 }] });
  const c = store.project.connections[connection.id];
  const points = structuredClone(c.waypoints);
  store.change('reverse', (p) => Model.reverseConnection(p, c.id));
  assert.deepEqual(c.sourceAnchor, targetAnchor);
  assert.deepEqual(c.targetAnchor, sourceAnchor);
  assert.deepEqual(c.waypoints, points.slice().reverse());
  store.undo();
  assert.deepEqual(store.project.connections[c.id].sourceAnchor, sourceAnchor);
  store.change('reset route', (p) => Model.updateConnection(p, c.id, { waypoints: [] }));
  assert.deepEqual(store.project.connections[c.id].targetAnchor, targetAnchor);
  store.undo();
  store.change('reset anchors', (p) => Model.updateConnection(p, c.id, { sourceAnchor: null, targetAnchor: null }));
  assert.deepEqual(store.project.connections[c.id].waypoints, points);
  assert.equal(store.project.connections[c.id].targetAnchor, null);
  store.undo();
  assert.deepEqual(store.project.connections[c.id].targetAnchor, targetAnchor);
});

test('anchored orthogonal routes preserve both edge normals without backtracking in every side combination', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 400, y: 200, w: 100, h: 100 };
  const normal = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
  for (const source of Object.keys(normal)) for (const target of Object.keys(normal)) {
    const sourceAnchor = { side: source, offset: 0.3 };
    const targetAnchor = { side: target, offset: 0.7 };
    for (const points of [[], [{ x: 50, y: 50 }], [{ x: 600, y: -100 }, { x: -100, y: 500 }], [{ x: 300, y: 50 }, { x: 300, y: 50 }]]) {
      const route = Render.connectorPath(a, b, 'orthogonal', points, sourceAnchor, targetAnchor);
      assertOrthogonalRoute(route, points);
      assert.deepEqual(route.start, Render.anchorPoint(a, sourceAnchor));
      assert.deepEqual(route.end, Render.anchorPoint(b, targetAnchor));
      const first = route.vertices[1];
      const last = route.vertices[route.vertices.length - 2];
      assert.ok((first.x - route.start.x) * normal[source].x + (first.y - route.start.y) * normal[source].y > 0);
      assert.ok((last.x - route.end.x) * normal[target].x + (last.y - route.end.y) * normal[target].y > 0);
    }
  }
  assert.deepEqual(Render.nearestAnchor(a, { x: 25, y: -100 }), { side: 'top', offset: 0.25 });
  assert.deepEqual(Render.nearestAnchor(a, { x: 500, y: 20 }), { side: 'right', offset: 0.2 });
  const sourceAnchor = { side: 'top', offset: 0.234567 };
  const targetAnchor = { side: 'left', offset: 0.789123 };
  for (const style of ['straight', 'curved', 'orthogonal']) {
    const route = Render.connectorPath(a, b, style, [{ x: 300, y: 50 }], sourceAnchor, targetAnchor);
    assert.deepEqual(route.start, Render.anchorPoint(a, sourceAnchor));
    assert.deepEqual(route.end, Render.anchorPoint(b, targetAnchor));
  }
});

test('outward-facing anchored routes detour outside endpoint interiors, including mirrored and vertical routes', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 400, y: 0, w: 100, h: 100 };
  for (const vertical of [false, true]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const transform = (r) => {
      const mirrored = { x: sx < 0 ? -r.x - r.w : r.x, y: sy < 0 ? -r.y - r.h : r.y, w: r.w, h: r.h };
      return vertical ? { x: mirrored.y, y: mirrored.x, w: mirrored.h, h: mirrored.w } : mirrored;
    };
    const sourceSide = sx < 0 ? (vertical ? 'bottom' : 'right') : (vertical ? 'top' : 'left');
    const targetSide = sx < 0 ? (vertical ? 'top' : 'left') : (vertical ? 'bottom' : 'right');
    const source = { side: sourceSide, offset: sy < 0 ? 0.7 : 0.3 };
    const target = { side: targetSide, offset: sy < 0 ? 0.3 : 0.7 };
    const rects = [transform(a), transform(b)];
    const route = Render.connectorPath(rects[0], rects[1], 'orthogonal', [], source, target);
    assertOrthogonalRoute(route, []);
    assert.deepEqual(route.start, Render.anchorPoint(rects[0], source));
    assert.deepEqual(route.end, Render.anchorPoint(rects[1], target));
    const first = route.vertices[1];
    const last = route.vertices[route.vertices.length - 2];
    const axis = vertical ? 'y' : 'x';
    assert.ok((first[axis] - route.start[axis]) * -sx > 0, 'Source leaves along its outward normal');
    assert.ok((last[axis] - route.end[axis]) * sx > 0, 'Target approaches along its inward normal');
    for (let i = 1; i < route.vertices.length; i++) {
      const p = route.vertices[i - 1];
      const q = route.vertices[i];
      for (const r of rects) {
        const crosses = p.x === q.x ?
          p.x > r.x && p.x < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h :
          p.y > r.y && p.y < r.y + r.h && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w;
        assert.ok(!crosses, 'No segment crosses an endpoint interior');
      }
    }
  }
});

test('close facing anchors share directional clearance without crossing endpoint interiors', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  for (const gap of [0, 1, 20, 47, 48]) {
    const b = { x: 100 + gap, y: 0, w: 100, h: 100 };
    for (const vertical of [false, true]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const transform = (r) => {
        const mirrored = { x: sx < 0 ? -r.x - r.w : r.x, y: sy < 0 ? -r.y - r.h : r.y, w: r.w, h: r.h };
        return vertical ? { x: mirrored.y, y: mirrored.x, w: mirrored.h, h: mirrored.w } : mirrored;
      };
      const sourceSide = sx < 0 ? (vertical ? 'top' : 'left') : (vertical ? 'bottom' : 'right');
      const targetSide = sx < 0 ? (vertical ? 'bottom' : 'right') : (vertical ? 'top' : 'left');
      const rects = [transform(a), transform(b)];
      for (const offsets of [[0.5, 0.5], [0.3, 0.7], [0, 1]]) {
        const source = { side: sourceSide, offset: sy < 0 ? 1 - offsets[0] : offsets[0] };
        const target = { side: targetSide, offset: sy < 0 ? 1 - offsets[1] : offsets[1] };
        const route = Render.connectorPath(rects[0], rects[1], 'orthogonal', [], source, target);
        assert.deepEqual(route.start, Render.anchorPoint(rects[0], source));
        assert.deepEqual(route.end, Render.anchorPoint(rects[1], target));
        if (gap === 0 && offsets[0] === offsets[1]) {
          assert.deepEqual(route.vertices, [route.start]);
          assert.deepEqual(route.label, route.start);
          assert.ok(route.handles.every((h) => h.x === route.start.x && h.y === route.start.y));
          assert.ok(!/NaN|Infinity/.test(route.d));
        } else {
          assertOrthogonalRoute(route, []);
        }
        const axis = vertical ? 'y' : 'x';
        if (gap > 0) {
          const first = route.vertices[1];
          const last = route.vertices[route.vertices.length - 2];
          assert.equal((first[axis] - route.start[axis]) * sx, gap / 2);
          assert.equal((last[axis] - route.end[axis]) * -sx, gap / 2);
        }
        for (let i = 1; i < route.vertices.length; i++) {
          const p = route.vertices[i - 1];
          const q = route.vertices[i];
          for (const r of rects) {
            const crosses = p.x === q.x ?
              p.x > r.x && p.x < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h :
              p.y > r.y && p.y < r.y + r.h && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w;
            assert.ok(!crosses, 'No segment crosses a close or touching endpoint interior');
          }
        }
      }
    }
  }
});

test('anchored routes retain explicit waypoints inside both endpoint nodes', () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  const b = { x: 400, y: 0, w: 100, h: 100 };
  const points = [{ x: 50, y: 50 }, { x: 450, y: 50 }];
  const route = Render.connectorPath(a, b, 'orthogonal', points,
    { side: 'left', offset: 0.3 }, { side: 'right', offset: 0.7 });
  assertOrthogonalRoute(route, points);
  assert.deepEqual(route.handles.filter((h) => !h.insert).map(({ x, y }) => ({ x, y })), points);
});

test('anchored detours are included in fit and export bounds', () => {
  const project = Model.createProject();
  const a = Model.addNode(project, 'external-system', null, { x: 0, y: 0 });
  const b = Model.addNode(project, 'external-system', null, { x: 400, y: 200 });
  const c = Model.addConnection(project, a.id, b.id, {
    sourceAnchor: { side: 'top', offset: 0.5 }, targetAnchor: { side: 'bottom', offset: 0.5 },
    waypoints: [{ x: -500, y: -500 }]
  });
  const g = Layout.compute(project);
  const route = Render.connectorPath(g.rects[a.id], g.rects[b.id], 'orthogonal', c.waypoints, c.sourceAnchor, c.targetAnchor);
  for (const p of route.vertices) {
    assert.ok(p.x >= g.bounds.x && p.x <= g.bounds.x + g.bounds.w);
    assert.ok(p.y >= g.bounds.y && p.y <= g.bounds.y + g.bounds.h);
  }
  assert.ok(Render.renderDocument(project, { margin: 0, embedDiagram: false }).svg.includes('d="' + route.d + '"'));
});

function assertAvoids(route, obstacles) {
  for (let i = 1; i < route.vertices.length; i++) {
    const p = route.vertices[i - 1], q = route.vertices[i];
    for (const r of obstacles) {
      const crosses = p.x === q.x ?
        p.x > r.x && p.x < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h :
        p.y > r.y && p.y < r.y + r.h && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w;
      assert.ok(!crosses, 'Route avoids obstacle interior: ' + JSON.stringify(r));
    }
  }
}

function assertLabelClear(route, obstacles) {
  const label = route.labelBounds;
  assert.ok(label);
  for (const r of obstacles) {
    assert.ok(label.x + label.w <= r.x || label.x >= r.x + r.w ||
      label.y + label.h <= r.y || label.y >= r.y + r.h, 'Label is not underneath a resource or header');
  }
}

function routingScene(rectangles) {
  const project = Model.createProject();
  const rects = {};
  rectangles.forEach((r, i) => { rects[String(i)] = Object.assign({ id: String(i) }, r); });
  const connection = { from: '0', to: '1', label: '', attributes: {}, waypoints: [] };
  return { project, connection, geometry: { rects } };
}

test('tidied sample avoids Logic App headers, the queue and obscured send-order labels', () => {
  const project = Model.createProject({ sample: true });
  Layout.autoLayout(project);
  const before = JSON.stringify(project);
  const geometry = Layout.compute(project);
  for (const c of Object.values(project.connections)) {
    const path = Render.connectionPath(project, c, geometry);
    const blocks = Object.values(geometry.rects).filter((r) => !r.hidden && r.w).map((r) =>
      Object.assign({}, r, { h: r.container ? r.headerH : r.h }));
    assertAvoids(path, blocks.filter((r) => r.id !== c.from && r.id !== c.to));
    assertLabelClear(path, blocks);
    assertOrthogonalRoute(Object.assign({ handles: [] }, path), []);
    assert.deepEqual(Render.connectionPath(project, c, geometry), path, 'Routing is deterministic');
    assert.ok(Render.renderDocument(project, { embedDiagram: false }).svg.includes('d="' + path.d + '"'));
    if (c.label === 'send order') {
      assert.equal(path.labelText, 'send order \u00b7 AMQP');
      assert.equal(path.labelWidth, path.labelText.length * 5.8 + 10);
    }
  }
  assert.equal(JSON.stringify(project), before, 'Automatic routes never become user waypoints or anchors');
});

test('automatic attachment selection can change sides instead of crossing endpoint interiors', () => {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const mirror = (r) => ({ x: sx < 0 ? -r.x - r.w : r.x, y: sy < 0 ? -r.y - r.h : r.y, w: r.w, h: r.h });
    const rectangles = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 10, w: 100, h: 100 }].map(mirror);
    const { project, connection, geometry } = routingScene(rectangles);
    const path = Render.connectionPath(project, connection, geometry);
    assertAvoids(path, rectangles);
    assertOrthogonalRoute(Object.assign({ handles: [] }, path), []);
    assert.notEqual(path.d, Render.connectorPath(rectangles[0], rectangles[1], 'orthogonal').d);
  }
});

test('visibility routing avoids unrelated leaves and headers while allowing container bodies', () => {
  const { project, connection, geometry } = routingScene([
    { x: 0, y: 100, w: 100, h: 100 },
    { x: 700, y: 100, w: 100, h: 100 },
    { x: 180, y: 60, w: 120, h: 180 },
    { x: 380, y: 0, w: 120, h: 180 },
    { x: 580, y: 100, w: 80, h: 100 },
    { x: -40, y: -100, w: 900, h: 500, container: true, headerH: 70 },
    { x: -50, y: -110, w: 920, h: 520, hidden: true }
  ]);
  const blocks = Object.values(geometry.rects).filter((r) => !r.hidden).map((r) =>
    Object.assign({}, r, { h: r.container ? r.headerH : r.h }));
  const path = Render.connectionPath(project, connection, geometry);
  assertAvoids(path, blocks);
  assertOrthogonalRoute(Object.assign({ handles: [] }, path), []);
  assert.ok(path.vertices.every((p) => p.y > -30 && p.y < 400), 'Container body remains traversable');
  geometry.rects['1'].hidden = true;
  assert.equal(Render.connectionPath(project, connection, geometry), null);
});

test('obstacle detours retain fixed anchors and outward normals for every side pair', () => {
  const { project, connection, geometry } = routingScene([
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 500, y: 0, w: 100, h: 100 },
    { x: 200, y: -80, w: 200, h: 260 }
  ]);
  for (const source of ['top', 'right', 'bottom', 'left']) for (const target of ['top', 'right', 'bottom', 'left']) {
    connection.sourceAnchor = { side: source, offset: 0.3 };
    connection.targetAnchor = { side: target, offset: 0.7 };
    const path = Render.connectionPath(project, connection, geometry);
    assert.deepEqual(path.start, Render.anchorPoint(geometry.rects['0'], connection.sourceAnchor));
    assert.deepEqual(path.end, Render.anchorPoint(geometry.rects['1'], connection.targetAnchor));
    assertAvoids(path, Object.values(geometry.rects));
    assertOrthogonalRoute(Object.assign({ handles: [] }, path), []);
    const normal = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
    const first = path.vertices[1], last = path.vertices[path.vertices.length - 2];
    assert.ok((first.x - path.start.x) * normal[source][0] + (first.y - path.start.y) * normal[source][1] > 0);
    assert.ok((last.x - path.end.x) * normal[target][0] + (last.y - path.end.y) * normal[target][1] > 0);
  }
});

test('scene routing keeps explicit waypoint geometry and editing handles unchanged', () => {
  const { project, connection, geometry } = routingScene([
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 500, y: 0, w: 100, h: 100 },
    { x: 200, y: 100, w: 200, h: 200 }
  ]);
  connection.waypoints = Object.freeze([Object.freeze({ x: 300, y: 200 }), Object.freeze({ x: 450, y: 200 })]);
  connection.sourceAnchor = { side: 'bottom', offset: 0.3 };
  connection.label = 'Manual';
  const expected = Render.connectorPath(geometry.rects['0'], geometry.rects['1'], 'orthogonal',
    connection.waypoints, connection.sourceAnchor, connection.targetAnchor);
  const actual = Render.connectionPath(project, connection, geometry);
  assert.equal(actual.d, expected.d);
  assert.deepEqual(actual.handles, expected.handles);
  assertOrthogonalRoute(actual, connection.waypoints);
});

test('SVG, draw.io and ArchiMate serialize the same automatic route vertices', () => {
  const project = Model.createProject();
  const a = Model.addNode(project, 'external-system', null, { x: 0, y: 0 });
  const b = Model.addNode(project, 'external-system', null, { x: 700, y: 0 });
  Model.addNode(project, 'external-system', null, { x: 350, y: 0 });
  const c = Model.addConnection(project, a.id, b.id, { label: 'Request', attributes: { protocol: 'HTTPS' } });
  const geometry = Layout.compute(project);
  const path = Render.connectionPath(project, c, geometry);
  const drawio = DrawIo.toDrawio(project, { embedDiagram: false });
  const archimate = ArchiMate.toArchiMate(project, { embedDiagram: false });
  assert.ok(Render.renderDocument(project, { embedDiagram: false }).svg.includes('d="' + path.d + '"'));
  for (const point of path.vertices.slice(1, -1)) {
    assert.ok(drawio.includes('<mxPoint x="' + (point.x - geometry.bounds.x + 40) + '" y="' + (point.y - geometry.bounds.y + 40) + '"/>'));
  }
  for (const point of path.vertices) {
    assert.ok(archimate.includes('<bendpoint x="' + Math.round(point.x + 20 - geometry.bounds.x) + '" y="' + Math.round(point.y + 20 - geometry.bounds.y) + '"/>'));
  }
  assert.ok(drawio.includes('source="n-' + a.id + '-route" target="n-' + b.id + '-route"'));
  assert.ok(drawio.includes('edgeStyle=none;rounded=0;'));
});

test('large visibility grids fall back to deterministic obstacle-free channels', () => {
  const rectangles = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 2400, y: 0, w: 100, h: 100 }];
  for (let i = 0; i < 180; i++) {
    rectangles.push({ x: 200 + i * 9.1, y: -100 + (i % 20) * 37.3 + i * 0.01, w: 55 + i * 0.001, h: 60 + i * 0.002 });
  }
  const { project, connection, geometry } = routingScene(rectangles);
  connection.label = 'Large scene';
  const path = Render.connectionPath(project, connection, geometry);
  assertOrthogonalRoute(Object.assign({ handles: [] }, path), []);
  assertAvoids(path, rectangles);
  assertLabelClear(path, rectangles);
  assert.deepEqual(Render.connectionPath(project, connection, geometry), path);
});

test('draw.io resource groups move visible icons and attached routes together', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app', 'key-vault']);
  nodes[0].nameMode = 'custom';
  nodes[0].name = 'Grouped function';
  nodes[0].custom = [{ key: 'Owner', value: 'Integration team' }];
  const c = Model.addConnection(project, nodes[0].id, nodes[1].id, { label: 'Read secret' });
  const geometry = Layout.compute(project);
  const xml = DrawIo.toDrawio(project, { embedDiagram: false });
  for (const node of nodes) {
    const id = 'n-' + node.id;
    const group = xml.match(new RegExp('<object label="" id="' + id + '-route"[^>]*><mxCell style="group;"[^>]*>[\\s\\S]*?</mxCell></object>'));
    const icon = xml.match(new RegExp('<object label="[^"]*" id="' + id + '"[^>]*><mxCell[^>]*>[\\s\\S]*?</mxCell></object>'));
    assert.ok(group, 'Full-tile edge endpoint is a resource group');
    assert.ok(group[0].includes('parent="n-' + rg.id + '"'), 'Group retains the Azure parent');
    assert.ok(icon, 'Resource still has its labeled icon');
    assert.ok(icon[0].includes('parent="' + id + '-route"'), 'Icon is a child of the edge endpoint, not an independent sibling');
    assert.ok(icon[0].includes('movable=0;resizable=0;'), 'Icon cannot be moved independently of its resource group');
    assert.ok(icon[0].includes('<mxGeometry x="' + (geometry.rects[node.id].w / 2 - Layout.ICON / 2) + '" y="10"'), 'Icon uses group-relative coordinates');
  }
  assert.equal((xml.match(/custom_Owner="Integration team"/g) || []).length, 1, 'Metadata belongs to the resource group, without duplicate tag or custom attributes');
  assert.ok(xml.includes('Grouped function'));
  assert.ok(xml.includes('id="e-' + c.id + '"'));
  assert.ok(xml.includes('source="n-' + nodes[0].id + '-route" target="n-' + nodes[1].id + '-route"'));
});
