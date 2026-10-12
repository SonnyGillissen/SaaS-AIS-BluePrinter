'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');

const { Naming, Model, Catalog } = AISBP;

test('convention names follow the default pattern', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app']);
  assert.equal(Naming.resolveName(project, rg), 'rg-integration-dev-weu-001');
  assert.equal(Naming.resolveName(project, nodes[0]), 'func-integration-dev-weu-001');
});

test('storage account names respect Azure limits (lowercase, alphanumeric, max 24)', () => {
  const { project, nodes } = smallProject(AISBP, ['storage-account']);
  Model.updateNode(project, nodes[0].id, { naming: { tokens: { workload: 'Very-Long Workload Name For Testing' } } });
  const name = Naming.resolveName(project, nodes[0]);
  assert.match(name, /^[a-z0-9]{3,24}$/);
  assert.ok(name.startsWith('st'), 'abbreviation is kept');
  assert.ok(name.endsWith('dev' + 'weu' + '001'), 'environment, region and instance are kept: ' + name);
  assert.deepEqual(Naming.validateName(name, Catalog.get('storage-account').rule), []);
});

test('per-object pattern override and custom names', () => {
  const { project, nodes } = smallProject(AISBP, ['key-vault', 'logic-app-standard']);
  Model.updateNode(project, nodes[0].id, { naming: { pattern: '{abbr}-{org}-{env}' } });
  assert.equal(Naming.resolveName(project, nodes[0]), 'kv-contoso-dev');
  Model.updateNode(project, nodes[1].id, { nameMode: 'custom', name: 'my-own-logic-app' });
  assert.equal(Naming.resolveName(project, nodes[1]), 'my-own-logic-app');
});

test('global token changes apply to every object', () => {
  const { project, nodes } = smallProject(AISBP, ['function-app']);
  project.settings.naming.tokens.env = 'prd';
  assert.equal(Naming.resolveName(project, nodes[0]), 'func-integration-prd-weu-001');
});

test('validateName reports rule violations', () => {
  const rule = Catalog.get('storage-account').rule;
  const problems = Naming.validateName('My_Storage', rule);
  assert.ok(problems.some((p) => /Invalid characters/.test(p)));
  assert.ok(problems.some((p) => /lowercase/.test(p)));
  assert.ok(Naming.validateName('ab', rule).some((p) => /too short/.test(p)));
  assert.ok(Naming.validateName('a'.repeat(25), rule).some((p) => /too long/.test(p)));
});

test('validateProject flags duplicate globally unique names', () => {
  const { project, nodes } = smallProject(AISBP, ['key-vault', 'key-vault']);
  nodes.forEach((n) => Model.updateNode(project, n.id, { nameMode: 'custom', name: 'kv-same-name' }));
  const problems = Naming.validateProject(project);
  assert.ok(problems[nodes[0].id] && problems[nodes[1].id]);
});

test('repeated copies continue automatic instance numbering', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app']);
  const payload = Model.extract(project, [nodes[0].id]);
  for (let i = 2; i <= 4; i++) {
    const result = Model.paste(project, payload, rg.id);
    assert.equal(Naming.resolveName(project, project.nodes[result.nodeIds[0]]), 'func-integration-dev-weu-00' + i);
  }
  assert.equal(Naming.resolveName(project, nodes[0]), 'func-integration-dev-weu-001');
  assert.deepEqual(Naming.validateProject(project), {});
});

test('copied instance overrides skip occupied names and preserve other naming settings', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['key-vault', 'key-vault']);
  Model.updateNode(project, nodes[0].id, {
    naming: { pattern: '{abbr}-{workload}-{instance}', tokens: { instance: '007', workload: 'orders' } }
  });
  Model.updateNode(project, nodes[1].id, { nameMode: 'custom', name: 'KV-ORDERS-008' });
  const payload = Model.extract(project, [nodes[0].id]);
  const original = JSON.parse(JSON.stringify(nodes[0]));
  for (const number of ['009', '010']) {
    const result = Model.paste(project, payload, rg.id);
    const copy = project.nodes[result.nodeIds[0]];
    assert.equal(Naming.resolveName(project, copy), 'kv-orders-' + number);
    assert.equal(copy.naming.pattern, original.naming.pattern);
    assert.equal(copy.naming.tokens.workload, 'orders');
  }
  assert.deepEqual(nodes[0], original);
  assert.deepEqual(payload.nodes[0], original);
});

test('child copies number labels and name-token overrides without changing the originals', () => {
  const { project, nodes } = smallProject(AISBP, ['service-bus-namespace']);
  const parent = nodes[0];
  const queue = Model.addNode(project, 'service-bus-queue', parent.id, { label: 'orders' });
  const payload = Model.extract(project, [queue.id]);
  const copies = [];
  for (const label of ['orders2', 'orders3']) {
    const result = Model.paste(project, payload, parent.id);
    const copy = project.nodes[result.nodeIds[0]];
    copies.push(copy);
    assert.equal(copy.label, label);
    assert.equal(Naming.resolveName(project, copy), 'sbq-' + label);
  }
  const numbered = project.nodes[Model.paste(project, Model.extract(project, [copies[0].id]), parent.id).nodeIds[0]];
  assert.equal(numbered.label, 'orders4');
  Model.updateNode(project, queue.id, { naming: { tokens: { name: 'priority01' } } });
  const result = Model.paste(project, Model.extract(project, [queue.id]), parent.id);
  const copy = project.nodes[result.nodeIds[0]];
  assert.equal(copy.label, 'orders');
  assert.equal(copy.naming.tokens.name, 'priority02');
  assert.equal(queue.naming.tokens.name, 'priority01');
  assert.deepEqual(Naming.validateProject(project), {});
});

test('copy numbering respects destination scopes and renumbers descendants only when needed', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['service-bus-namespace']);
  const queue = Model.addNode(project, 'service-bus-queue', nodes[0].id, { label: 'orders' });
  const other = Model.addNode(project, 'service-bus-namespace', rg.id);
  const moved = Model.paste(project, Model.extract(project, [queue.id]), other.id);
  assert.equal(Naming.resolveName(project, project.nodes[moved.nodeIds[0]]), 'sbq-orders');
  const subtree = Model.paste(project, Model.extract(project, [nodes[0].id]), rg.id);
  assert.equal(Naming.resolveName(project, project.nodes[subtree.nodeIds[0]]), 'sbns-integration-dev-weu-003');
  assert.equal(project.nodes[subtree.nodeIds[1]].label, 'orders');
  assert.deepEqual(Naming.validateProject(project), {});
});

test('copying preserves custom names and patterns without numbering tokens', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['key-vault', 'function-app']);
  Model.updateNode(project, nodes[0].id, { nameMode: 'custom', name: 'kv-fixed' });
  Model.updateNode(project, nodes[1].id, { naming: { pattern: '{abbr}-{workload}' } });
  const result = Model.paste(project, Model.extract(project, nodes.map((n) => n.id)), rg.id);
  result.nodeIds.forEach((id, i) => {
    assert.equal(Naming.resolveName(project, project.nodes[id]), Naming.resolveName(project, nodes[i]));
    assert.equal(project.nodes[id].nameMode, nodes[i].nameMode);
  });
});

test('numbered child names preserve their suffix at the Azure length limit', () => {
  const { project, nodes } = smallProject(AISBP, ['storage-account']);
  const container = Model.addNode(project, 'storage-container', nodes[0].id, { label: 'a'.repeat(63) });
  const result = Model.paste(project, Model.extract(project, [container.id]), nodes[0].id);
  const name = Naming.resolveName(project, project.nodes[result.nodeIds[0]]);
  assert.equal(name, 'a'.repeat(62) + '2');
  assert.deepEqual(Naming.validateProject(project), {});
});

test('every catalog type has a naming rule or is explicitly free-form', () => {
  Catalog.all().forEach((t) => {
    assert.ok(t.rule, t.id + ' has a rule');
    assert.ok(t.rule.max >= t.rule.min, t.id + ' has a sane length range');
  });
});
