'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP: A } = require('./helpers');

test('tidy arrows clears stale saved bends and attachments without moving or reconnecting resources', () => {
  const project = A.Model.createProject({ sample: true });
  const connections = Object.values(project.connections);
  connections.forEach((c, i) => {
    if (i % 2 === 0) c.waypoints = [{ x: -900, y: 1500 }, { x: 2200, y: -400 }];
    if (i !== 0) c.sourceAnchor = { side: 'top', offset: 0.3 };
    if (i === 1) c.targetAnchor = { side: 'bottom', offset: 0.7 };
  });
  A.Layout.autoLayout(project);
  const nodes = JSON.stringify(project.nodes);
  const semantic = (c) => {
    const { waypoints, sourceAnchor, targetAnchor, ...rest } = c;
    return rest;
  };
  const expected = connections.map(semantic);
  assert.equal(A.Model.resetConnectionRoutes(project), connections.length);
  assert.equal(JSON.stringify(project.nodes), nodes);
  assert.deepEqual(connections.map(semantic), expected);
  connections.forEach((c) => {
    assert.deepEqual(c.waypoints, []);
    assert.equal(c.sourceAnchor, null);
    assert.equal(c.targetAnchor, null);
    const path = A.Render.connectionPath(project, c, A.Layout.compute(project));
    assert.ok(path && path.vertices.length >= 2);
    assert.ok(!path.vertices.some((p) => p.x === -900 || p.y === 1500));
  });
  assert.doesNotThrow(() => A.Render.renderDocument(project));
  assert.doesNotThrow(() => A.DrawIo.toDrawio(project));
  assert.doesNotThrow(() => A.ArchiMate.toArchiMate(project));
});

test('tidy arrows is one undoable operation and a no-op for automatic connections', () => {
  const project = A.Model.createProject({ sample: true });
  const connection = Object.values(project.connections)[0];
  A.Model.updateConnection(project, connection.id, {
    waypoints: [{ x: 50, y: 900 }],
    sourceAnchor: { side: 'right', offset: 0.25 }, targetAnchor: { side: 'left', offset: 0.75 }
  });
  const store = A.Store.createStore(project);
  const before = JSON.stringify(store.project);
  assert.equal(store.change('tidy arrows', A.Model.resetConnectionRoutes), 1);
  const after = JSON.stringify(store.project);
  assert.equal(store.past.length, 1);
  assert.equal(store.change('tidy arrows', A.Model.resetConnectionRoutes), 0);
  assert.equal(JSON.stringify(store.project), after);
  assert.equal(store.past.length, 1);
  store.undo();
  assert.equal(JSON.stringify(store.project), before);
  store.redo();
  assert.equal(JSON.stringify(store.project), after);
});

test('tidy arrows safely handles an empty blueprint', () => {
  const project = A.Model.createProject();
  const before = JSON.stringify(project);
  assert.equal(A.Model.resetConnectionRoutes(project), 0);
  assert.equal(JSON.stringify(project), before);
});
