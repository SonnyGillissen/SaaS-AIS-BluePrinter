'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');

const { Model, Tags, Layout, Render, DrawIo, ArchiMate, Naming, Package } = AISBP;

test('tags are sanitized: trimmed, limited, case-insensitively unique, at most 50', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ key: 'k' + i, value: 'v' }));
  assert.equal(Tags.sanitize(many).length, 50);
  assert.deepEqual(Tags.sanitize([{ key: ' Managed by ', value: ' customer ' }, { key: 'managed BY', value: 'x' }, { key: '', value: 'y' }, null]),
    [{ key: 'Managed by', value: 'customer' }]);
  assert.equal(Tags.sanitize([{ key: 'a'.repeat(600), value: 'b'.repeat(300) }])[0].key.length, 512);
  assert.equal(Tags.sanitize([{ key: 'a', value: 'b'.repeat(300) }])[0].value.length, 256);
});

test('tag validation reports Azure limit violations', () => {
  assert.deepEqual(Tags.validate({ tags: [{ key: 'Managed by', value: 'customer' }] }), []);
  assert.equal(Tags.validate({ tags: [{ key: 'a/b', value: '' }] }).length, 1);
  assert.equal(Tags.validate({ tags: [{ key: 'Env', value: '' }, { key: 'env', value: '' }] }).length, 1);
  const { project, rg } = smallProject(AISBP, []);
  Model.updateNode(project, rg.id, { tags: [{ key: 'cost%center', value: '1' }] });
  assert.ok(Naming.validateProject(project)[rg.id].some((p) => /not allowed/.test(p)));
});

test('every object (incl. hierarchy) can be tagged and tags survive paste and package round-trip', () => {
  const { project, sub, rg, nodes } = smallProject(AISBP, ['key-vault']);
  const mg = Model.addNode(project, 'management-group', null, { tags: [{ key: 'Managed by', value: 'customer' }] });
  assert.deepEqual(mg.tags, [{ key: 'Managed by', value: 'customer' }]);
  Model.updateNode(project, nodes[0].id, { tags: [{ key: 'Owner', value: 'team-a' }] });
  const res = Model.paste(project, Model.extract(project, [nodes[0].id]), rg.id);
  assert.deepEqual(project.nodes[res.nodeIds[0]].tags, [{ key: 'Owner', value: 'team-a' }]);
  project.settings.tags.definitions = [{ key: 'Owner', values: ['team-a', 'team-b'], color: '#123456', show: true }];
  const back = Package.fromJson(Package.toJson(project)).project;
  assert.deepEqual(back.nodes[nodes[0].id].tags, [{ key: 'Owner', value: 'team-a' }]);
  assert.deepEqual(back.settings.tags.definitions, [{ key: 'Owner', values: ['team-a', 'team-b'], color: '#123456', show: true }]);
  assert.ok(back.nodes[sub.id].tags);
});

test('legacy "key=value per line" tag attributes are migrated on import', () => {
  const { project, nodes } = smallProject(AISBP, ['key-vault']);
  const raw = JSON.parse(JSON.stringify(project));
  raw.nodes[nodes[0].id].attributes.tags = 'env=prod\nManaged by: customer\n\nowner';
  delete raw.nodes[nodes[0].id].tags;
  const n = Model.normalize(raw).project.nodes[nodes[0].id];
  assert.deepEqual(n.tags, [{ key: 'env', value: 'prod' }, { key: 'Managed by', value: 'customer' }, { key: 'owner', value: '' }]);
  assert.equal(n.attributes.tags, undefined);
});

test('Tag Manager bulk operations apply by scope, rename and remove', () => {
  const { project, sub, rg, nodes } = smallProject(AISBP, ['key-vault', 'external-system']);
  assert.equal(Tags.scopeOf('subscription'), 'hierarchy');
  assert.equal(Tags.scopeOf('resource-group'), 'resource-group');
  assert.equal(Tags.scopeOf('key-vault'), 'resource');
  assert.equal(Tags.scopeOf('external-system'), 'other');
  assert.equal(Tags.apply(project, { key: 'Managed by', value: 'customer', scopes: ['hierarchy', 'resource-group', 'resource'] }), 3);
  assert.equal(project.nodes[nodes[1].id].tags.length, 0);
  // Existing values are only replaced with overwrite.
  assert.equal(Tags.apply(project, { key: 'managed by', value: 'provider', scopes: ['resource'] }), 0);
  assert.equal(Tags.apply(project, { key: 'managed by', value: 'provider', scopes: ['resource'], overwrite: true }), 1);
  assert.deepEqual(project.nodes[nodes[0].id].tags, [{ key: 'Managed by', value: 'provider' }]);
  assert.equal(Tags.usage(project)['managed by'].count, 3);
  assert.equal(Tags.rename(project, 'Managed by', 'ManagedBy'), 3);
  assert.equal(project.nodes[sub.id].tags[0].key, 'ManagedBy');
  assert.equal(Tags.remove(project, 'managedby'), 3);
  assert.equal(project.nodes[rg.id].tags.length, 0);
});

test('tags are drawn as wrapped chips with a "+N" overflow and can be hidden', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['key-vault']);
  const before = Layout.compute(project).rects;
  const tags = Array.from({ length: 12 }, (_, i) => ({ key: 'Tag' + i, value: 'value ' + i }));
  Model.updateNode(project, nodes[0].id, { tags });
  Model.updateNode(project, rg.id, { tags: [{ key: 'Managed by', value: 'customer' }] });
  const g = Layout.compute(project);
  const leaf = g.rects[nodes[0].id];
  assert.ok(leaf.h > before[nodes[0].id].h, 'leaf grows');
  assert.ok(g.rects[rg.id].headerH > before[rg.id].headerH, 'container header grows');
  assert.equal(leaf.tags.rows.length, Tags.CHIP.maxRows);
  const chips = leaf.tags.rows.flat();
  assert.ok(chips[chips.length - 1].more && /^\+\d+$/.test(chips[chips.length - 1].text));
  assert.equal(chips.length - 1 + Number(chips[chips.length - 1].text.slice(1)), 12);
  leaf.tags.rows.forEach((row) => assert.ok(row.reduce((n, c) => n + c.w, 0) + Tags.CHIP.gap * (row.length - 1) <= 170 - 16));
  const svg = Render.renderDocument(project, {}).svg;
  assert.ok(svg.includes('Managed by: customer'));
  assert.ok(svg.includes('class="tags"'));
  project.settings.diagram.showTags = false;
  assert.equal(Layout.compute(project).rects[nodes[0].id].h, before[nodes[0].id].h);
  project.settings.diagram.showTags = true;
  project.settings.tags.definitions = [{ key: 'Managed by', values: [], color: '', show: false }];
  assert.equal(Layout.compute(project).rects[rg.id].tags.height, 0);
});

test('tags are exported to draw.io and ArchiMate (escaped)', () => {
  const { project, nodes } = smallProject(AISBP, ['key-vault']);
  Model.updateNode(project, nodes[0].id, { tags: [{ key: 'Managed by', value: 'cust<omer>' }, { key: 'Managed_by', value: 'dup' }] });
  const xml = DrawIo.toDrawio(project, {});
  assert.ok(xml.includes('tag_Managed_by="cust&lt;omer&gt;"'));
  assert.equal((xml.match(/tag_Managed_by=/g) || []).length, 1);
  assert.ok(xml.includes('tags="Managed_by:cust&lt;omer&gt; Managed_by:dup"'));
  const am = ArchiMate.toArchiMate(project);
  assert.ok(am.includes('Tag: Managed by'));
  assert.ok(am.includes('cust&lt;omer&gt;'));
});
