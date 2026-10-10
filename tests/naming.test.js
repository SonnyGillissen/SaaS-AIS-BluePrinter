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

test('every catalog type has a naming rule or is explicitly free-form', () => {
  Catalog.all().forEach((t) => {
    assert.ok(t.rule, t.id + ' has a rule');
    assert.ok(t.rule.max >= t.rule.min, t.id + ' has a sane length range');
  });
});
