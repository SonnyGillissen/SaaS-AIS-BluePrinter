'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP } = require('./helpers');
const { Model, Layout } = AISBP;

function separated(a, b) {
  return a.x + a.w <= b.x || b.x + b.w <= a.x ||
    a.y + a.h <= b.y || b.y + b.h <= a.y;
}

test('tidy places sample producers before the Azure hierarchy and consumers after it', () => {
  for (const detailLevel of ['high', 'selected', 'detailed']) {
    const project = Model.createProject({ sample: true });
    project.settings.diagram.detailLevel = detailLevel;
    Layout.autoLayout(project);
    const geometry = Layout.compute(project);
    const rect = (type) => geometry.rects[Object.values(project.nodes).find((n) => n.type === type).id];
    assert.ok(rect('users').x + rect('users').w < rect('management-group').x);
    assert.ok(rect('management-group').x + rect('management-group').w < rect('on-premises-system').x);
    Object.values(project.nodes).forEach((node) => {
      const siblings = Model.children(project, node.parentId);
      siblings.forEach((sibling) => {
        if (node.id !== sibling.id) assert.ok(separated(geometry.rects[node.id], geometry.rects[sibling.id]));
      });
    });
    const positions = Object.values(project.nodes).map(({ id, x, y }) => ({ id, x, y }));
    Layout.autoLayout(project);
    assert.deepEqual(Object.values(project.nodes).map(({ id, x, y }) => ({ id, x, y })), positions);
  }
});

test('tidy flow ordering collapses nested endpoints and does not modify manual routes', () => {
  const project = Model.createProject();
  const target = Model.addNode(project, 'on-premises-system', null, {});
  const sub = Model.addNode(project, 'subscription', null, {});
  const rg = Model.addNode(project, 'resource-group', sub.id, {});
  const processing = Model.addNode(project, 'logic-app-standard', rg.id, {});
  const workflow = Model.addNode(project, 'logic-app-workflow', processing.id, {});
  const source = Model.addNode(project, 'users', null, {});
  const connection = Model.addConnection(project, workflow.id, target.id, {
    kind: 'flow', waypoints: [{ x: -80, y: 100 }],
    sourceAnchor: { side: 'right', offset: 0.25 }
  });
  Model.addConnection(project, source.id, workflow.id, { kind: 'flow' });
  const before = JSON.stringify(project.connections);
  Layout.autoLayout(project);
  assert.ok(source.x < sub.x && sub.x < target.x);
  assert.equal(JSON.stringify(project.connections), before);
  assert.ok(connection.waypoints.length);
});

test('tidy handles cycles, isolated nodes and subtree-only scope deterministically', () => {
  const project = Model.createProject();
  const outside = Model.addNode(project, 'users', null, { x: -200, y: -300 });
  const sub = Model.addNode(project, 'subscription', null, { x: 300, y: 400 });
  const rg = Model.addNode(project, 'resource-group', sub.id, {});
  const first = Model.addNode(project, 'nsg', rg.id, {});
  const second = Model.addNode(project, 'nsg', rg.id, {});
  Model.addConnection(project, first.id, second.id, { kind: 'flow' });
  Model.addConnection(project, second.id, first.id, { kind: 'flow' });
  Layout.autoLayout(project, sub.id);
  assert.deepEqual([outside.x, outside.y, sub.x, sub.y], [-200, -300, 300, 400]);
  const geometry = Layout.compute(project);
  assert.ok(separated(geometry.rects[first.id], geometry.rects[second.id]));
  const positions = JSON.stringify(project.nodes);
  Layout.autoLayout(project, sub.id);
  assert.equal(JSON.stringify(project.nodes), positions);
});

test('sample main flow is aligned, label-sized and clear of dependency-only resources', () => {
  for (const detailLevel of ['high', 'selected', 'detailed']) {
    const project = Model.createProject({ sample: true });
    project.settings.diagram.detailLevel = detailLevel;
    Layout.autoLayout(project);
    const geometry = Layout.compute(project);
    const node = (type) => Object.values(project.nodes).find((n) => n.type === type);
    const rect = (type) => geometry.rects[node(type).id];
    const baseline = rect('logic-app-workflow').y + rect('logic-app-workflow').h / 2;
    for (const type of ['users', 'api-management', 'service-bus-queue', 'on-premises-system']) {
      const r = rect(type);
      assert.ok(Math.abs(r.y + r.h / 2 - baseline) < 0.001, type + ' follows the main flow lane');
    }
    const dependency = rect('key-vault');
    assert.ok(dependency.y > rect('logic-app-standard').y + rect('logic-app-standard').h);
    assert.ok(Math.abs(dependency.x + dependency.w / 2 -
      rect('logic-app-standard').x - rect('logic-app-standard').w / 2) < 0.001);
    for (const connection of Object.values(project.connections).filter((c) => c.kind !== 'dependency')) {
      const path = AISBP.Render.connectionPath(project, connection, geometry);
      assert.equal(path.vertices.length, 2, connection.label + ' needs no detour or duplicate vertices');
      assert.equal(path.vertices[0].y, path.vertices[1].y);
      assert.ok(Math.abs(path.vertices[1].x - path.vertices[0].x) >= path.labelWidth + 20);
      assert.ok(path.labelBounds.x >= path.start.x && path.labelBounds.x + path.labelWidth <= path.end.x);
      for (const obstacle of Object.values(geometry.rects).filter((r) => !r.hidden && !r.container)) {
        assert.ok(separated(path.labelBounds, obstacle), connection.label + ' stays clear of resource tiles');
      }
    }
  }
});

test('dependency lanes handle multiple resources without moving manual routing points', () => {
  const project = Model.createProject({ sample: true });
  const logic = Object.values(project.nodes).find((n) => n.type === 'logic-app-standard');
  const vault = Object.values(project.nodes).find((n) => n.type === 'key-vault');
  const monitoring = Model.addNode(project, 'log-analytics', vault.parentId, {});
  const connection = Model.addConnection(project, logic.id, monitoring.id, {
    kind: 'dependency', waypoints: [{ x: 200, y: 800 }],
    sourceAnchor: { side: 'bottom', offset: 0.7 }, targetAnchor: { side: 'top', offset: 0.5 }
  });
  const original = JSON.stringify(connection);
  Layout.autoLayout(project);
  const g = Layout.compute(project);
  assert.ok(separated(g.rects[vault.id], g.rects[monitoring.id]));
  assert.ok(g.rects[vault.id].y > g.rects[logic.id].y + g.rects[logic.id].h);
  assert.ok(g.rects[monitoring.id].y > g.rects[logic.id].y + g.rects[logic.id].h);
  assert.equal(JSON.stringify(connection), original);
  const positions = JSON.stringify(project.nodes);
  Layout.autoLayout(project);
  assert.equal(JSON.stringify(project.nodes), positions);
});

test('label-spaced row wrapping preserves manual routes inside wrapped containers', () => {
  const project = Model.createProject();
  const sub = Model.addNode(project, 'subscription', null, {});
  const rg = Model.addNode(project, 'resource-group', sub.id, {});
  const containers = [];
  for (let i = 0; i < 6; i++) {
    const namespace = Model.addNode(project, 'service-bus-namespace', rg.id, {});
    const first = Model.addNode(project, 'service-bus-queue', namespace.id, {});
    const second = Model.addNode(project, 'service-bus-queue', namespace.id, {});
    Model.addConnection(project, first.id, second.id, {
      kind: 'flow', waypoints: [{ x: 200, y: 800 }],
      sourceAnchor: { side: 'right', offset: 0.4 }, targetAnchor: { side: 'left', offset: 0.6 }
    });
    if (containers.length) Model.addConnection(project, containers[containers.length - 1].id, namespace.id, {
      kind: 'flow', label: 'Process the next batch of incoming events'
    });
    containers.push(namespace);
  }
  const routes = JSON.stringify(project.connections);
  Layout.autoLayout(project);
  assert.ok(containers[containers.length - 1].y > containers[0].y);
  assert.equal(JSON.stringify(project.connections), routes);
  const positions = JSON.stringify(project.nodes);
  Layout.autoLayout(project);
  assert.equal(JSON.stringify(project.connections), routes);
  assert.equal(JSON.stringify(project.nodes), positions);
});
