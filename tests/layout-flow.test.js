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
