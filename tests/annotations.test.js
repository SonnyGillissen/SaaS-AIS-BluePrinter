'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');
const { Annotations: A, Model, Layout, Render, Package, DrawIo, ArchiMate, Store } = AISBP;
const TYPES = ['annotation-text', 'annotation-markdown', 'annotation-table'];

test('palette orders DevOps Process between Other and Text & Tables', () => {
  const categories = AISBP.Catalog.CATEGORIES;
  assert.equal(categories[0].id, 'hierarchy');
  assert.equal(categories[categories.length - 3].id, 'other');
  assert.deepEqual(categories[categories.length - 2], { id: 'devops', label: 'DevOps Process' });
  assert.deepEqual(categories[categories.length - 1], { id: 'annotations', label: 'Text & Tables' });
});

test('DevOps components have provider dependencies and editable attributes', () => {
  const project = Model.createProject();
  const azure = Model.addNode(project, 'azure-devops', null, { attributes: { url: 'https://dev.azure.com/example' } });
  const adoProject = Model.addNode(project, 'azure-devops-project', azure.id);
  const pipeline = Model.addNode(project, 'azure-devops-pipeline', adoProject.id, { attributes: { branch: 'release' } });
  const adoRepo = Model.addNode(project, 'azure-devops-repository', adoProject.id);
  const boards = Model.addNode(project, 'azure-devops-boards', adoProject.id);
  const artifacts = Model.addNode(project, 'azure-devops-artifacts', adoProject.id);
  const github = Model.addNode(project, 'github', null);
  const organization = Model.addNode(project, 'github-organization', github.id);
  const repository = Model.addNode(project, 'github-repository', organization.id);
  const actions = Model.addNode(project, 'github-actions', repository.id, { attributes: { status: 'Disabled' } });
  const packageNode = Model.addNode(project, 'github-package', repository.id);
  const enterprise = Model.addNode(project, 'github-enterprise', null);
  const enterpriseOrg = Model.addNode(project, 'github-organization', enterprise.id);
  const enterpriseRepo = Model.addNode(project, 'github-repository', enterpriseOrg.id);

  assert.equal(project.nodes[azure.id].attributes.url, 'https://dev.azure.com/example');
  assert.equal(project.nodes[pipeline.id].attributes.branch, 'release');
  assert.equal(project.nodes[actions.id].attributes.status, 'Disabled');
  assert.equal(project.nodes[adoRepo.id].parentId, adoProject.id);
  assert.equal(project.nodes[boards.id].parentId, adoProject.id);
  assert.equal(project.nodes[artifacts.id].parentId, adoProject.id);
  assert.equal(project.nodes[packageNode.id].parentId, repository.id);
  assert.equal(project.nodes[enterpriseRepo.id].parentId, enterpriseOrg.id);

  [
    ['azure-devops', 'azure-devops-project'],
    ['azure-devops-project', 'azure-devops-pipeline'],
    ['azure-devops-project', 'azure-devops-repository'],
    ['azure-devops-project', 'azure-devops-boards'],
    ['azure-devops-project', 'azure-devops-artifacts'],
    ['github', 'github-organization'],
    ['github-enterprise', 'github-organization'],
    ['github-organization', 'github-repository'],
    ['github-repository', 'github-actions'],
    ['github-repository', 'github-package']
  ].forEach(([parent, child]) => assert.equal(AISBP.Catalog.canContain(parent, child), true));
});

test('annotation catalog placement accepts root and containers, never annotations', () => {
  const { project, sub, rg, nodes } = smallProject(AISBP, ['key-vault', 'service-bus-namespace']);
  TYPES.forEach((type) => {
    assert.ok(AISBP.Catalog.byCategory('annotations').some((t) => t.id === type));
    const root = Model.addNode(project, type, null);
    const child = Model.addNode(project, type, rg.id);
    assert.ok(Model.canContain(project, sub.id, type));
    assert.ok(Model.canContain(project, nodes[1].id, type));
    assert.equal(Model.canContain(project, nodes[0].id, type), false);
    assert.throws(() => Model.addNode(project, type, root.id), /cannot be placed/);
    assert.equal(Model.reparent(project, child.id, root.id), false);
    assert.equal(Layout.compute(project).rects[root.id].container, false);
  });
});

test('normalization bounds and whitelists annotation attributes and rectangular table data', () => {
  const a = A.normalize('annotation-markdown', { content: 'x'.repeat(25000), theme: '"><script>', align: 'bad', padding: -10, fontSize: Infinity, onclick: 'evil' });
  assert.equal(a.content.length, 20000);
  assert.equal(a.theme, 'plain');
  assert.equal(a.align, 'left');
  assert.equal(a.padding, 0);
  assert.equal(a.fontSize, 14);
  assert.equal(a.onclick, undefined);
  const data = A.rows([['a', 'b', 12], ['long'.repeat(500)]]);
  assert.deepEqual(data[0], ['a', 'b', '']);
  assert.equal(data[1].length, 3);
  assert.equal(data[1][0].length, 1000);
  assert.equal(A.rows(Array(100).fill(Array(20).fill('x'))).length, 50);
  assert.equal(A.rows(Array(100).fill(Array(20).fill('x')))[0].length, 12);
  assert.deepEqual(A.rows('{invalid'), [['Name', 'Value'], ['Item', 'Details']]);
  const table = A.normalize('annotation-table', { rows: '[["A","B"]]', columnWidths: '[1,99999]', headerRow: false, grid: 'evil' });
  assert.equal(table.grid, 'all');
  assert.equal(table.headerRow, false);
  assert.deepEqual(JSON.parse(table.columnWidths), [50, 1000]);
});

test('table operations edit structure immutably, preserve rectangular cells and sort headers', () => {
  const data = [['Name', 'Value'], ['B', '10'], ['A', '2']];
  assert.deepEqual(A.tableOperation(data, 'sortAsc', 1, true), [data[0], data[2], data[1]]);
  assert.deepEqual(A.tableOperation(data, 'sortDesc', 0, true), data);
  assert.deepEqual(A.tableOperation(data, 'moveRow', 2, 1), [data[0], data[2], data[1]]);
  assert.deepEqual(A.tableOperation(data, 'moveColumn', 0, 1)[1], ['10', 'B']);
  assert.equal(A.tableOperation(data, 'addRow', 0).length, 4);
  assert.deepEqual(A.tableOperation(data, 'addRow', 0)[1], ['', '']);
  assert.equal(A.tableOperation(data, 'removeRow', 0).length, 2);
  assert.deepEqual(A.tableOperation(data, 'addColumn', 0)[0], ['Name', '', 'Value']);
  assert.deepEqual(A.tableOperation(data, 'removeColumn', 1)[0], ['Name']);
  assert.deepEqual(A.tableOperation([['x']], 'removeRow', 0), [['x']]);
  assert.deepEqual(A.tableOperation([['x']], 'removeColumn', 0), [['x']]);
  assert.equal(data.length, 3);
  assert.deepEqual(data[1], ['B', '10']);
});

test('maximum escape-heavy tables survive normalization, import and paste without JSON truncation', () => {
  ['"\\'.repeat(500), '\u0000'.repeat(1000)].forEach((cell) => {
    const data = Array.from({ length: A.MAX_ROWS }, () => Array(A.MAX_COLS).fill(cell));
    const serialized = JSON.stringify(data);
    assert.ok(serialized.length > 700000);
    assert.ok(serialized.length < A.MAX_TABLE_JSON);
    assert.deepEqual(A.rows(serialized), data);
    const p = Model.createProject();
    const n = Model.addNode(p, 'annotation-table', null, { attributes: { rows: serialized } });
    assert.equal(n.attributes.rows, serialized);
    const imported = Package.fromJson(Package.toJson(p)).project;
    assert.equal(imported.nodes[n.id].attributes.rows, serialized);
    const pasted = Model.paste(imported, Model.extract(imported, [n.id], []), null);
    assert.equal(pasted.nodeIds.length, 1);
    assert.equal(imported.nodes[pasted.nodeIds[0]].attributes.rows, serialized);
  });
  assert.deepEqual(A.rows(' '.repeat(A.MAX_TABLE_JSON + 1)), [['Name', 'Value'], ['Item', 'Details']]);
});

test('Blueprint wrapping measures the monospace font used for text, Markdown and tables', () => {
  const content = 'ill '.repeat(15);
  const p = Model.createProject();
  const text = Model.addNode(p, 'annotation-text', null, { w: 300, attributes: { content } });
  const markdown = Model.addNode(p, 'annotation-markdown', null, { w: 300, attributes: { content } });
  const table = Model.addNode(p, 'annotation-table', null, { attributes: { rows: JSON.stringify([[content]]), columnWidths: '[300]', caption: content } });
  const proportional = Layout.compute(p).rects[text.id].annotation.layout.lines.length;
  p.settings.diagram.style = 'blueprint';
  const geometry = Layout.compute(p);
  const layouts = [geometry.rects[text.id].annotation.layout, geometry.rects[markdown.id].annotation.layout,
    geometry.rects[table.id].annotation.layouts[0][0], geometry.rects[table.id].annotation.caption];
  layouts.forEach((layout) => {
    assert.equal(layout.monospace, true);
    assert.ok(layout.lines.length > proportional);
    assert.equal(layout.lines.flatMap((line) => line.runs.map((run) => run.text)).join(''), content);
    layout.lines.forEach((line) => {
      const length = line.runs.reduce((sum, run) => sum + Array.from(run.text).length, 0);
      assert.ok(length * line.size * 0.62 <= 276);
    });
  });
  assert.ok(Render.renderDocument(p).svg.includes('<text xml:space="preserve" font-family="monospace"'));
});

test('annotations persist long content, all options, manual sizing and paste normally', () => {
  const p = Model.createProject();
  const n = Model.addNode(p, 'annotation-markdown', null, { attributes: { content: 'long text '.repeat(1700), theme: 'callout' }, w: 410, h: 200 });
  const t = Model.addNode(p, 'annotation-table', null, { attributes: { rows: JSON.stringify(Array(20).fill(['x'.repeat(1000), 'multiline\nvalue'])), headerRow: false, firstColumnHeader: true, striped: true, grid: 'rows', align: 'right', fontSize: 16, padding: 9, columnWidths: '[140,210]', caption: 'Inventory' } });
  const { project, warnings } = Package.fromJson(Package.toJson(p));
  assert.deepEqual(warnings, []);
  assert.deepEqual(project.nodes[n.id], n);
  assert.deepEqual(project.nodes[t.id], t);
  const pasted = Model.paste(project, Model.extract(project, [n.id, t.id], []), null, { dx: 50, dy: 60 });
  assert.equal(pasted.nodeIds.length, 2);
  assert.deepEqual(project.nodes[pasted.nodeIds[0]].attributes, n.attributes);
  assert.deepEqual(project.nodes[pasted.nodeIds[1]].attributes, t.attributes);
  assert.equal(project.nodes[pasted.nodeIds[0]].w, 410);
  assert.equal(project.nodes[pasted.nodeIds[0]].x, 50);
});

test('annotation edits and geometry resize are undoable without changing resource leaf sizes', () => {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app']);
  const n = Model.addNode(project, 'annotation-text', rg.id, { x: 80, y: 150, attributes: { content: 'words '.repeat(100) } });
  const store = Store.createStore(project);
  const before = store.derived().geometry.rects[n.id];
  store.change('resize annotation', (p) => Model.updateNode(p, n.id, { w: 160, h: 30 }));
  const after = store.derived().geometry.rects[n.id];
  assert.equal(after.w, 160);
  assert.ok(after.h > before.h);
  assert.ok(store.derived().geometry.rects[rg.id].h >= after.h);
  assert.equal(store.derived().geometry.rects[nodes[0].id].w, Layout.LEAF_W);
  store.undo();
  assert.equal(store.derived().geometry.rects[n.id].w, before.w);
  store.redo();
  assert.equal(store.derived().geometry.rects[n.id].w, 160);
  store.change('edit content', (p) => Model.updateNode(p, n.id, { attributes: { content: 'Updated', theme: 'card' } }));
  assert.equal(store.project.nodes[n.id].attributes.theme, 'card');
  store.undo();
  assert.equal(store.project.nodes[n.id].attributes.theme, 'plain');
});

test('Markdown renders styled SVG text only, wraps without truncation, escapes unsafe input', () => {
  const p = Model.createProject();
  const n = Model.addNode(p, 'annotation-markdown', null, { attributes: { content: '# Heading\n**bold** *italic* `code`\n- item\n1. second\n[Safe label](javascript:alert(1))\n<script onload="evil"> & text\n```js\nconst value = 1;\n```' }, w: 180 });
  const g = Layout.compute(p);
  assert.ok(g.rects[n.id].h > 100);
  const svg = Render.renderDocument(p).svg;
  assert.ok(svg.includes('font-weight="700"'));
  assert.ok(svg.includes('font-style="italic"'));
  assert.ok(svg.includes('font-family="monospace"'));
  assert.ok(svg.includes('\u2022'));
  assert.ok(svg.includes('Safe label'));
  assert.ok(svg.includes('&lt;script'));
  assert.ok(!/<(?:script|foreignObject|input|textarea|a|image)\b/i.test(svg));
  assert.ok(!svg.includes('javascript:'));
  const wrapped = A.textLayout('abcdefghijklmnopqrstuvwxyz'.repeat(5), 55, 14, false);
  assert.ok(wrapped.lines.length > 3);
  assert.equal(wrapped.lines.flatMap((l) => l.runs.map((r) => r.text)).join(''), 'abcdefghijklmnopqrstuvwxyz'.repeat(5));
});

test('annotation themes and table options produce safe content in every diagram style/export', () => {
  const p = Model.createProject();
  const evil = '<img src=x onerror=evil> & "quotes"';
  A.THEMES.forEach((theme) => Model.addNode(p, 'annotation-text', null, { attributes: { theme, content: 'Line one\nLine two ' + evil } }));
  const table = Model.addNode(p, 'annotation-table', null, { attributes: { rows: JSON.stringify([['Header A', 'Header B'], ['1', evil + '\ncontinued'], ['2', 'last']]), caption: 'Caption', striped: true, firstColumnHeader: true, align: 'center', columnWidths: '[120,200]' } });
  const m = Layout.compute(p).rects[table.id].annotation;
  assert.deepEqual(m.widths, [120, 200]);
  assert.ok(m.heights[1] > m.heights[0]);
  Object.keys(Render.STYLES).forEach((style) => {
    p.settings.diagram.style = style;
    const svg = Render.renderDocument(p).svg;
    assert.ok(svg.includes('Caption'));
    assert.ok(svg.includes('opacity="0.06"'));
    assert.ok(svg.includes('annotation plain'));
    assert.ok(svg.includes('annotation pill'));
    assert.ok(svg.includes('annotation card'));
    assert.ok(svg.includes('annotation callout'));
    assert.ok(!svg.includes('<img'));
    assert.ok(!svg.includes('<foreignObject'));
  });
  const drawio = DrawIo.toDrawio(p);
  assert.ok(drawio.includes('&lt;table'));
  assert.ok(drawio.includes('&amp;lt;img'));
  assert.ok(drawio.includes('width="320"'));
  const archimate = ArchiMate.toArchiMate(p);
  assert.ok(archimate.includes('xsi:type="Artifact"'));
  assert.ok(archimate.includes('Annotation content'));
  assert.ok(archimate.includes('continued'));
  assert.ok(!archimate.includes('<img'));
});

test('table grid choices render without altering contents; manual width has readable cells', () => {
  const p = Model.createProject();
  const n = Model.addNode(p, 'annotation-table', null, { w: 60, h: 30, attributes: { rows: '[["A","B"],["multi\\nline","value"]]', padding: 40, fontSize: 30 } });
  ['all', 'rows', 'outer', 'none'].forEach((grid) => {
    Model.updateNode(p, n.id, { attributes: { grid } });
    const r = Layout.compute(p).rects[n.id];
    assert.ok(r.w >= 280);
    assert.ok(r.h > 30);
    assert.ok(r.annotation.widths.every((w) => w >= 140));
    const runs = r.annotation.layouts[1][1].lines.flatMap((line) => line.runs);
    assert.equal(runs.map((run) => run.text).join(''), 'value');
    const svg = Render.renderDocument(p).svg;
    runs.forEach((run) => assert.ok(svg.includes('<tspan>' + AISBP.Util.escapeXml(run.text) + '</tspan>')));
  });
});
