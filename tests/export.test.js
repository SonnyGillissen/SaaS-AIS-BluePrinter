'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');

const { Model, Package, DrawIo, ArchiMate, Raster, Render } = AISBP;

const EVIL = '<script>alert("x")</script> & "quotes"';

function evilProject() {
  const p = Model.createProject({ name: EVIL, sample: true });
  const anyId = Object.keys(p.nodes).find((id) => p.nodes[id].type === 'function-app' || p.nodes[id].type === 'key-vault');
  Model.updateNode(p, anyId, { label: EVIL });
  return p;
}

test('configuration package round-trips', () => {
  const p = Model.createProject({ sample: true });
  const json = Package.toJson(p);
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'ais-blueprinter');
  assert.equal(parsed.package.generator, 'AIS BluePrinter');
  const { project } = Package.fromJson(json);
  assert.deepEqual(project.nodes, p.nodes);
  assert.deepEqual(project.connections, p.connections);
  assert.deepEqual(project.settings, p.settings);
});

test('tenant defaults appear in diagram and export metadata but stay inherited in native packages', () => {
  const { project: p, sub, nodes: [vault] } = smallProject(AISBP, ['key-vault']);
  const tenant = Model.addNode(p, 'azure-tenant', null, {
    attributes: { tenantId: 'inherited-tenant-id', primaryDomain: 'tenant.example' }
  });
  Model.reparent(p, sub.id, tenant.id);
  p.settings.diagram.detailLevel = 'selected';
  assert.ok(!AISBP.Layout.visibleAttributes(p, vault).some((a) => a.key === 'tenantDomain'));
  Model.updateNode(p, vault.id, { display: { tenantId: true, tenantDomain: true } });
  const attrs = AISBP.Layout.visibleAttributes(p, vault);
  assert.equal(attrs.find((a) => a.key === 'tenantId').value, 'inherited-tenant-id');
  assert.equal(attrs.find((a) => a.key === 'tenantDomain').value, 'tenant.example');
  assert.match(Render.renderDocument(p, {}).svg, /tenant\.example/);
  const drawio = DrawIo.toDrawio(p, { embedDiagram: false });
  const data = drawio.match(new RegExp('<object[^>]*id="n-' + vault.id + '-route"[^>]*>'))[0];
  assert.match(data, /tenantId="inherited-tenant-id"/);
  assert.match(data, /tenantDomain="tenant\.example"/);
  const archimate = ArchiMate.toArchiMate(p, { embedDiagram: false });
  const element = archimate.match(new RegExp('<element identifier="id-' + vault.id + '"[\\s\\S]*?</element>'))[0];
  assert.match(element, /inherited-tenant-id/);
  assert.match(element, /tenant\.example/);
  const restored = Package.fromJson(Package.toJson(p)).project;
  assert.equal(restored.nodes[vault.id].attributes.tenantId, undefined);
  assert.equal(restored.nodes[vault.id].attributes.tenantDomain, undefined);
  assert.equal(Model.effectiveAttributes(restored, vault.id).tenantDomain, 'tenant.example');
});

test('configuration package import reports invalid input', () => {
  assert.throws(() => Package.fromJson('{oops'), /not valid JSON/);
  assert.throws(() => Package.fromJson(42), /Nothing to import/);
});

test('SVG rendering escapes user text', () => {
  const { svg, width, height } = Render.renderDocument(evilProject(), {});
  assert.ok(width > 0 && height > 0);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  Render.STYLES && Object.keys(Render.STYLES).forEach((style) => {
    const p = evilProject();
    p.settings.diagram.style = style;
    assert.ok(Render.renderDocument(p, {}).svg.startsWith('<svg') || Render.renderDocument(p, {}).svg.includes('<svg'));
  });
});

test('draw.io export produces an escaped mxGraphModel with containers and edges', () => {
  const p = evilProject();
  const xml = DrawIo.toDrawio(p, {});
  assert.match(xml, /^<\?xml|^<mxfile/);
  assert.ok(xml.includes('<mxGraphModel'));
  assert.ok(!xml.includes('<script>'));
  const vertices = (xml.match(/vertex="1"/g) || []).length;
  const edges = (xml.match(/edge="1"/g) || []).length;
  assert.ok(vertices >= Object.keys(p.nodes).length);
  assert.equal(edges, Object.keys(p.connections).length);
});

test('ArchiMate export contains elements, relationships and a view', () => {
  const p = evilProject();
  const xml = ArchiMate.toArchiMate(p);
  assert.ok(xml.includes('xmlns="http://www.opengroup.org/xsd/archimate/3.0/"'));
  assert.ok(xml.includes('<elements>') && xml.includes('<relationships>') && xml.includes('<views>'));
  assert.ok(!xml.includes('<script>'));
  const elements = (xml.match(/<element /g) || []).length;
  assert.equal(elements, Object.keys(p.nodes).length);
  assert.ok(ArchiMate.relationshipType);
});

test('PDF writer produces a structurally valid single-page document', () => {
  // Minimal JPEG-like payload; the writer embeds it as-is (DCTDecode).
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const bytes = Raster.buildPdf(jpeg, 200, 100, { pageSize: 'A4', title: 'T (1)', author: 'Me' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Type \/Page\b/);
  assert.match(text, /\/Filter \/DCTDecode/);
  // Verify the xref offsets point at the objects.
  const startxref = Number(/startxref\s+(\d+)/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const entries = text.slice(startxref).split('\n').filter((l) => /^\d{10} \d{5} n/.test(l));
  entries.forEach((line, i) => {
    const offset = Number(line.slice(0, 10));
    assert.ok(text.slice(offset).startsWith(i + 1 + ' 0 obj'), 'object ' + (i + 1));
  });
  // Text is written as UTF-16BE hex strings, so no character can break out of the string.
  assert.ok(text.includes('/Title ' + Raster.pdfText('T (1)')));
  assert.equal(Raster.pdfText('T (1)'), '<FEFF00540020002800310029>');
});

test('raster scale stays within browser canvas limits', () => {
  assert.equal(Raster.safeScale(100, 100, 2), 2);
  const s = Raster.safeScale(20000, 20000, 2);
  assert.ok(20000 * s <= 16000);
});

test('export of an empty project does not throw', () => {
  const p = Model.createProject();
  assert.ok(DrawIo.toDrawio(p, {}).includes('mxGraphModel'));
  assert.ok(ArchiMate.toArchiMate(p).includes('<model'));
  assert.ok(Render.renderDocument(p, {}).svg.includes('<svg'));
  const { project } = smallProject(AISBP, ['function-app']);
  assert.ok(Package.toJson(project).length > 0);
});

test('the editor canvas uses a dark variant of light display styles in the dark theme', () => {
  const { Render } = AISBP;
  assert.equal(Render.editorStyle('classic', 'light'), Render.STYLES.classic);
  assert.equal(Render.editorStyle('blueprint', 'dark'), Render.STYLES.blueprint);
  assert.equal(Render.editorStyle('dark', 'dark'), Render.STYLES.dark);
  const classic = Render.editorStyle('classic', 'dark');
  assert.equal(classic.background, Render.STYLES.dark.background);
  assert.equal(classic.text, Render.STYLES.dark.text);
  assert.equal(classic.font, Render.STYLES.classic.font);
  const minimal = Render.editorStyle('minimal', 'dark');
  assert.equal(minimal.leafFill, 'none');
  assert.equal(minimal.containers.subscription.fill, 'none');
  assert.equal(minimal.grid, '');
  const sketch = Render.editorStyle('sketch', 'dark');
  assert.equal(sketch.containers['resource-group'].dash, Render.STYLES.sketch.containers['resource-group'].dash);
  assert.notEqual(sketch.leafStroke, Render.STYLES.sketch.leafStroke);
  // Exports keep the chosen style.
  const p = AISBP.Model.createProject({ sample: true });
  assert.match(Render.renderDocument(p, {}).svg, /fill="#ffffff"/);
});
