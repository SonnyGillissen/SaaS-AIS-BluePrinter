'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { AISBP, smallProject } = require('./helpers');
const { Embedded, Package, DrawIo, ArchiMate, Raster, Render, Model } = AISBP;

// An actual 1x1 PNG, including compressed pixel data and valid chunk checksums.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
const JPEG = new Uint8Array([255, 216, 255, 217]);
const blob = (content) => new Blob([content]);

function fixture() {
  const { project, rg, nodes } = smallProject(AISBP, ['function-app', 'key-vault', 'virtual-network']);
  project.meta.name = '配置 🌍 <script> & "quoted" -- endstream';
  project.meta.description = 'Résumé 日本語\nAnother line';
  Model.updateNode(project, nodes[0].id, {
    label: '函数 😀', x: 321, y: -12, w: 222, h: 99,
    custom: [{ key: '秘密', value: '</metadata><!--AISBP_CONFIG_V1:攻撃' }],
    tags: [{ key: 'team', value: '开发' }], network: [nodes[2].id]
  });
  project.nodes[nodes[0].id].display = { runtime: false };
  project.nodes[nodes[0].id].attributes.runtime = 'node';
  project.settings.diagram.hiddenContainers = ['resource-group'];
  project.settings.diagram.layout = 'manual';
  project.settings.tags.definitions = [{ key: 'team', values: ['开发'], color: '#123456' }];
  Model.addConnection(project, nodes[0].id, nodes[1].id, { label: 'Secret 🗝️', kind: 'dependency' });
  assert.ok(rg);
  return project;
}

function formats(project, opts) {
  return {
    json: Package.toJson(project),
    svg: Embedded.toSvg(Render.renderDocument(project, {}).svg, project, opts),
    drawio: DrawIo.toDrawio(project, opts),
    archimate: ArchiMate.toArchiMate(project, opts),
    png: Embedded.toPng(PNG, project, opts),
    pdf: Raster.buildPdf(JPEG, 200, 100, { project, ...opts })
  };
}

test('all native export carriers roundtrip complete Unicode configuration from real file bytes', async () => {
  const p = fixture();
  const expected = Package.fromJson(Package.toJson(p));
  for (const [format, bytes] of Object.entries(formats(p))) {
    // Signatures, not file extensions or MIME types, determine the carrier.
    const file = blob(bytes);
    const actual = await Embedded.fromFile(file);
    assert.deepEqual(actual, expected, format);
    assert.deepEqual(actual.project.nodes, expected.project.nodes, format + ' hidden nodes and attributes');
    assert.deepEqual(actual.project.settings, expected.project.settings, format + ' settings');
  }
});

test('SVG uses inert namespaced metadata and XML comments leave schemas unchanged', () => {
  const p = fixture();
  const svg = formats(p).svg;
  assert.match(svg, /<metadata><aisbp:config xmlns:aisbp="urn:ais-blueprinter:configuration:1" encoding="base64"/);
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('<!--AISBP_CONFIG_V1:攻撃'));
  for (const xml of [DrawIo.toDrawio(p), ArchiMate.toArchiMate(p)]) {
    assert.match(xml, /^<\?xml[^>]*\?>\s*<!--AISBP_CONFIG_V1:[0-9a-f]{8}:[A-Za-z0-9+/=]+-->/);
  }
});

test('PNG metadata is uncompressed iTXt immediately before IEND, with byte-correct CRC', () => {
  const p = fixture();
  const bytes = Embedded.toPng(PNG, p);
  const view = new DataView(bytes.buffer);
  let pos = 8;
  const types = [];
  while (pos < bytes.length) {
    const length = view.getUint32(pos);
    const type = Buffer.from(bytes.subarray(pos + 4, pos + 8)).toString('ascii');
    types.push(type);
    assert.equal(view.getUint32(pos + length + 8), parseInt(Embedded.checksum(bytes.subarray(pos + 4, pos + length + 8)), 16));
    if (type === 'iTXt') {
      const data = bytes.subarray(pos + 8, pos + 8 + length);
      assert.equal(Buffer.from(data.subarray(0, Embedded.KEYWORD.length)).toString(), Embedded.KEYWORD);
      assert.deepEqual(data.subarray(Embedded.KEYWORD.length, Embedded.KEYWORD.length + 5), new Uint8Array(5));
      assert.deepEqual(JSON.parse(Buffer.from(data.subarray(Embedded.KEYWORD.length + 5)).toString()).nodes, p.nodes);
    }
    pos += length + 12;
  }
  assert.deepEqual(types.slice(-2), ['iTXt', 'IEND']);
});

test('PDF attachment names, stream byte lengths, and every xref offset remain valid with Unicode JSON', () => {
  const bytes = Raster.buildPdf(JPEG, 200, 100, { project: fixture(), title: '配置😀' });
  const text = Buffer.from(bytes).toString('latin1');
  assert.match(text, /\/Names << \/EmbeddedFiles << \/Names \[\(blueprint\.aisbp\.json\) 8 0 R\]/);
  assert.match(text, /\/Type \/Filespec[\s\S]*?\/EF << \/F 7 0 R/);
  const start = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(start, start + 4), 'xref');
  const entries = text.slice(start).split('\n').filter((line) => /^\d{10} 00000 n/.test(line));
  assert.equal(entries.length, 8);
  entries.forEach((entry, i) => assert.ok(text.slice(Number(entry.slice(0, 10))).startsWith((i + 1) + ' 0 obj\n')));
  const stream = /\/AISBPConfig true \/AISBPCRC \([0-9a-f]{8}\) \/Length (\d+) >>\nstream\n/.exec(text);
  const offset = stream.index + stream[0].length;
  assert.equal(text.slice(offset + Number(stream[1]), offset + Number(stream[1]) + 10), '\nendstream');
  assert.ok(Number(stream[1]) > new TextDecoder().decode(bytes.subarray(offset, offset + Number(stream[1]))).length);
});

test('global opt-out and explicit opt-out remove every carrier without changing JSON', async () => {
  const p = fixture();
  for (const mode of ['explicit', 'global']) {
    const previous = globalThis.AISBP_CONFIG;
    try {
      if (mode === 'global') globalThis.AISBP_CONFIG = { exports: { embedDiagram: false } };
      const output = formats(p, mode === 'explicit' ? { embedDiagram: false } : {});
      assert.deepEqual((await Embedded.fromFile(blob(output.json))).project.nodes, Package.fromJson(output.json).project.nodes);
      for (const [format, bytes] of Object.entries(output)) {
        if (format !== 'json') await assert.rejects(Embedded.fromFile(blob(bytes)), /no embedded AIS BluePrinter configuration/, format);
      }
      assert.deepEqual(output.png, PNG);
    } finally { globalThis.AISBP_CONFIG = previous; }
  }
});

test('missing, malformed, truncated, duplicated and tampered native carriers fail clearly', async () => {
  const p = fixture();
  const output = formats(p);
  await assert.rejects(Embedded.fromFile(blob('unrelated content')), /no embedded/);
  await assert.rejects(Embedded.fromFile(blob('{oops')), /not valid JSON/);
  for (const format of ['svg', 'drawio', 'archimate']) {
    const xml = output[format];
    await assert.rejects(Embedded.fromFile(blob(xml.replace(/[A-Za-z0-9+/=]{30}(?=<!--|<\/aisbp:config>|-->)/, '!!!'))), /corrupt/);
    await assert.rejects(Embedded.fromFile(blob(xml.slice(0, -20))), /corrupt/);
    await assert.rejects(Embedded.fromFile(blob(xml.replace(/<\?xml[^>]*\?>/, '').repeat(2))), /corrupt/);
    await assert.rejects(Embedded.fromFile(blob(xml.replace(/<\/(svg|mxfile|model)>/, '</wrong>'))), /corrupt/);
  }
  const png = output.png.slice();
  png[png.length - 20] ^= 1;
  await assert.rejects(Embedded.fromFile(blob(png)), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(output.png.slice(0, -1))), /corrupt/);
  const hugeChunk = output.png.slice();
  new DataView(hugeChunk.buffer).setUint32(8, 0xffffffff);
  await assert.rejects(Embedded.fromFile(blob(hugeChunk)), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(PNG.slice(0, 4))), /corrupt/);
  const invalidText = output.png.slice();
  const keywordOffset = Buffer.from(invalidText).indexOf(Embedded.KEYWORD);
  const chunkOffset = keywordOffset - 8;
  const chunkSize = new DataView(invalidText.buffer).getUint32(chunkOffset);
  invalidText[keywordOffset + Embedded.KEYWORD.length + 1] = 1; // Compression is unsupported for native iTXt.
  new DataView(invalidText.buffer).setUint32(chunkOffset + 8 + chunkSize,
    parseInt(Embedded.checksum(invalidText.subarray(chunkOffset + 4, chunkOffset + 8 + chunkSize)), 16));
  await assert.rejects(Embedded.fromFile(blob(invalidText)), /corrupt/);
  const duplicatePng = Buffer.concat([output.png.subarray(0, output.png.length - 12),
    output.png.subarray(chunkOffset, chunkOffset + chunkSize + 12), output.png.subarray(output.png.length - 12)]);
  await assert.rejects(Embedded.fromFile(blob(duplicatePng)), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(output.svg.replace('<svg', '<!DOCTYPE svg><svg'))), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(output.svg.replace('<svg', '<svg invalid="&missing;"'))), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(output.pdf.slice(0, -50))), /corrupt/);
  const pdf = Buffer.from(output.pdf).toString('latin1');
  await assert.rejects(Embedded.fromFile(blob(Buffer.from(pdf.replace(/\/AISBPCRC \([0-9a-f]{8}\)/, '/AISBPCRC (00000000)'), 'latin1'))), /corrupt/);
  await assert.rejects(Embedded.fromFile(blob(Buffer.from(pdf.replace(/(\/AISBPConfig true[\s\S]*?\/Length )\d+/, '$1999999999'), 'latin1'))), /too large/);
  await assert.rejects(Embedded.fromFile(blob(Buffer.from(pdf.replace(/\nstream\n{\n/, '\nstream\n[\n'), 'latin1'))), /corrupt/);
});

test('file and decoded JSON limits are enforced before allocation/decode', async () => {
  let read = false;
  await assert.rejects(Embedded.fromFile({ size: Embedded.MAX_FILE_BYTES + 1, arrayBuffer() { read = true; } }), /too large/);
  assert.equal(read, false);
  await assert.rejects(Embedded.fromFile(null), /Choose a file/);
  await assert.rejects(Embedded.fromFile({ size: 1, async arrayBuffer() { return new ArrayBuffer(2); } }), /corrupt/);
  const oversized = 'A'.repeat(Math.ceil(Embedded.MAX_JSON_BYTES / 3) * 4 + 4);
  await assert.rejects(Embedded.fromFile(blob('<svg><!--AISBP_CONFIG_V1:00000000:' + oversized + '--></svg>')), /too large/);
  const invalid = '<svg><!--AISBP_CONFIG_V1:00000000:A===--></svg>';
  await assert.rejects(Embedded.fromFile(blob(invalid)), /corrupt/);
});

test('standalone Node IIFE require fallback loads embedding dependencies', () => {
  const result = execFileSync(process.execPath, ['-e', `
    const E = require('./js/export/embedded.js');
    const D = require('./js/export/drawio.js');
    const A = require('./js/export/archimate.js');
    const R = require('./js/export/raster.js');
    const p = globalThis.AISBP.Model.createProject();
    Promise.all([D.toDrawio(p), A.toArchiMate(p), R.buildPdf(new Uint8Array([255,216,255,217]),1,1,{project:p})].map(x => E.fromFile(new Blob([x]))))
      .then(x => { if(x.length !== 3) process.exit(1); console.log('ok'); })
      .catch(e => { console.error(e); process.exit(1); });
  `], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.trim(), 'ok');
});

test('browser IIFEs work without require, modules, or network access', async () => {
  const context = vm.createContext({ TextEncoder, TextDecoder, Blob, btoa, atob, console });
  const modules = ['core/util', 'core/catalog', 'core/tags', 'core/model', 'core/naming', 'core/layout',
    'render/svg', 'export/package', 'export/embedded', 'export/drawio', 'export/archimate', 'export/raster'];
  for (const module of modules) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', module + '.js'), 'utf8'), context);
  }
  const api = context.AISBP;
  const p = api.Model.createProject({ sample: true, name: '日本語 🏡' });
  for (const content of [api.Embedded.toSvg(api.Render.renderDocument(p, {}).svg, p),
    api.DrawIo.toDrawio(p), api.ArchiMate.toArchiMate(p), api.Embedded.toPng(PNG, p),
    api.Raster.buildPdf(JPEG, 20, 10, { project: p })]) {
    const parsed = await api.Embedded.fromFile(blob(content));
    assert.equal(parsed.project.meta.name, p.meta.name);
    assert.equal(Object.keys(parsed.project.nodes).length, Object.keys(p.nodes).length);
  }
});

test('browser export actions pass the complete package and honor the root opt-out for every format', async () => {
  const downloads = [];
  const saved = { Dom: AISBP.Dom, Icons: AISBP.Icons, Raster: AISBP.Raster, config: globalThis.AISBP_CONFIG };
  try {
    AISBP.Dom = { download: (content, name) => downloads.push({ content, name }), toast() {} };
    AISBP.Icons = { inlineAll: async () => 0, resolver: () => () => null };
    AISBP.Raster = {
      toPng: async (_svg, _w, _h, _bg, opts) => blob(Embedded.toPng(PNG, opts.project, opts)),
      toPdf: async (_svg, _w, _h, opts) => blob(Raster.buildPdf(JPEG, 20, 10, opts))
    };
    require('../js/ui/exporter.js');
    const p = fixture();
    for (const disabled of [false, true]) {
      globalThis.AISBP_CONFIG = { exports: { embedDiagram: !disabled } };
      for (const format of ['json', 'svg', 'png', 'pdf', 'drawio', 'archimate']) {
        await AISBP.Exporter.run(format, p);
        const { content, name } = downloads.pop();
        assert.ok(name.includes('aisbp.json') || format !== 'json');
        const file = content instanceof Blob ? content : blob(content);
        if (disabled && format !== 'json') await assert.rejects(Embedded.fromFile(file), /no embedded/);
        else assert.deepEqual((await Embedded.fromFile(file)).project.nodes, Package.fromJson(Package.toJson(p)).project.nodes);
      }
    }
  } finally {
    AISBP.Dom = saved.Dom;
    AISBP.Icons = saved.Icons;
    AISBP.Raster = saved.Raster;
    globalThis.AISBP_CONFIG = saved.config;
  }
});
