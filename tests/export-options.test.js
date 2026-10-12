'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AISBP } = require('./helpers');
const { Model, Render, DrawIo, Raster, Embedded, Package } = AISBP;

test('explicit embedding choices override deployment defaults for all carriers', async () => {
  const previous = globalThis.AISBP_CONFIG;
  const project = Model.createProject({ sample: true });
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  try {
    for (const defaultValue of [true, false]) {
      globalThis.AISBP_CONFIG = { exports: { embedDiagram: defaultValue } };
      assert.equal(Embedded.enabled(), defaultValue);
      assert.equal(Embedded.enabled({ embedDiagram: undefined }), defaultValue);
      for (const embedDiagram of [true, false]) {
        assert.equal(Embedded.enabled({ embedDiagram }), embedDiagram);
        const opts = { embedDiagram };
        const carriers = [
          Embedded.toSvg(Render.renderDocument(project).svg, project, opts),
          DrawIo.toDrawio(project, opts), AISBP.ArchiMate.toArchiMate(project, opts),
          Embedded.toPng(png, project, opts),
          Raster.buildPdf(new Uint8Array([255, 216, 255, 217]), 1, 1, { project, ...opts })
        ];
        for (const carrier of carriers) {
          const parsed = Embedded.fromFile(new Blob([carrier]));
          if (embedDiagram) assert.deepEqual(await parsed, Package.fromJson(Package.toJson(project)));
          else await assert.rejects(parsed, /no embedded/);
        }
      }
    }
  } finally { globalThis.AISBP_CONFIG = previous; }
});

test('SVG and draw.io background overrides are safe and do not change project or style', () => {
  const project = Model.createProject();
  project.settings.diagram.style = 'blueprint';
  const before = JSON.stringify(project);
  const styleBefore = JSON.stringify(Render.STYLES);
  const opts = Object.freeze({ background: '#123AbF', embedDiagram: false });
  assert.match(Render.renderDocument(project, opts).svg, /fill="#123AbF"/);
  assert.match(DrawIo.toDrawio(project, opts), /background="#123AbF"/);
  assert.match(Render.renderDocument(project).svg, /fill="#0d3b66"/);
  const transparent = Render.renderDocument(project, { background: 'transparent' }).svg;
  assert.ok(!transparent.includes('fill="#0d3b66"'));
  assert.ok(!transparent.includes('fill="url(#grid)"'));
  assert.match(DrawIo.toDrawio(project, { background: 'transparent' }), /background="none"/);
  assert.equal(JSON.stringify(project), before);
  assert.equal(JSON.stringify(Render.STYLES), styleBefore);
  for (const background of ['', null, '#fff', '#12345678', 'red', '#ffffff" onload="evil', 'url(https://example.com)', {}]) {
    assert.throws(() => Render.renderDocument(project, { background }), /Background must/);
    assert.throws(() => DrawIo.toDrawio(project, { background }), /Background must/);
  }
});

test('PDF backgrounds paint the full MediaBox before the JPEG, without alpha', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 217]);
  for (const pageSize of ['fit', 'A4', 'A3', 'Letter']) {
    const text = Buffer.from(Raster.buildPdf(jpeg, 200, 100, { pageSize, background: '#123456' })).toString('latin1');
    const [, width, height] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    assert.ok(text.includes('q 0.070588 0.203922 0.337255 rg 0 0 ' + width + ' ' + height + ' re f Q\nq '));
    assert.ok(!text.includes('/SMask'));
  }
  for (const background of ['transparent', '#fff', 'blue']) {
    assert.throws(() => Raster.buildPdf(jpeg, 1, 1, { background }), /Background must/);
    await assert.rejects(Raster.toPdf('<svg/>', 1, 1, { background }), /Background must/);
    if (background !== 'transparent') await assert.rejects(Raster.svgToCanvas('<svg/>', 1, 1, 1, background), /Background must/);
  }
});

function loadUi(file, api) {
  const context = vm.createContext({ AISBP: api });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', file + '.js'), 'utf8'), context);
  return context.AISBP;
}

test('Exporter.run preserves defaults, validates before fetching, and snapshots API inputs', async () => {
  const downloads = [];
  let inlineCalls = 0;
  let release;
  const api = loadUi('exporter', {
    ...AISBP,
    Dom: { download: (content, name) => downloads.push({ content, name }), toast() {} },
    Icons: {
      inlineAll: async (project) => {
        inlineCalls++;
        if (release === 'wait') await new Promise((resolve) => { release = resolve; });
        project.settings.icons = { embedded: { test: 'data:image/svg+xml;base64,AA==' } };
        return 0;
      },
      resolver: () => () => null
    },
    Raster: {
      toPng: async (svg, width, height, background, opts) => ({ svg, width, height, background, opts }),
      toPdf: async (svg, width, height, opts) => ({ svg, width, height, opts })
    }
  });
  const project = Model.createProject();
  const before = JSON.stringify(project);
  for (const format of ['svg', 'png', 'pdf', 'drawio']) {
    await assert.rejects(api.Exporter.run(format, project, { background: 'red' }), /Background must/);
  }
  await assert.rejects(api.Exporter.run('pdf', project, { background: 'transparent' }), /transparency/);
  assert.equal(inlineCalls, 0);
  for (const format of ['png', 'pdf']) {
    const opts = Object.freeze({ background: '#123456', embedDiagram: false });
    await api.Exporter.run(format, project, opts);
    const { content } = downloads.pop();
    assert.match(content.svg, /fill="#123456"/);
    assert.equal(format === 'png' ? content.background : content.opts.background, '#123456');
    assert.equal(content.opts.embedDiagram, false);
  }
  await api.Exporter.run('png', project);
  assert.equal(downloads.pop().content.background, '#ffffff');
  assert.equal(JSON.stringify(project), before);
  release = 'wait';
  const opts = { background: '#123456', embedDiagram: false };
  const pending = api.Exporter.run('svg', project, opts);
  project.meta.name = 'Changed after launch';
  opts.background = '#abcdef';
  opts.embedDiagram = true;
  release();
  await pending;
  const exported = downloads.pop();
  assert.ok(!exported.content.includes('Changed after launch'));
  assert.match(exported.content, /fill="#123456"/);
  assert.ok(!exported.content.includes('aisbp:config'));
});

function dialogHarness() {
  const elements = [];
  let dialog;
  const h = (tag, attrs, ...children) => {
    const el = { tag, ...attrs, children, appendChild(child) { this.children.push(child); }, focus() { this.focused = true; } };
    elements.push(el);
    return el;
  };
  const api = loadUi('dialogs', {
    ...AISBP,
    Dom: {
      h, field: (label, control) => h('field', { label }, control),
      select: (options, value, attrs) => h('select', { options, value, ...attrs }),
      modal: (options) => { dialog = options; }, toast() {}
    }
  });
  return { api, elements, get dialog() { return dialog; } };
}

test('export popup supports only applicable formats, warns about hidden data and does not mutate', async () => {
  const project = Model.createProject();
  const before = JSON.stringify(project);
  for (const format of ['svg', 'png', 'pdf', 'drawio', 'archimate']) {
    const harness = dialogHarness();
    const pending = harness.api.Dialogs.openExportOptions(format, project);
    assert.ok(harness.elements.some((el) => el.text && el.text.includes('hidden resources')));
    const mode = harness.elements.find((el) => el.tag === 'select');
    if (format === 'archimate') assert.equal(mode, undefined);
    else {
      assert.deepEqual(Array.from(mode.options, (o) => o.value), format === 'pdf' ? ['style', 'custom'] : ['style', 'custom', 'transparent']);
      if (format === 'pdf') assert.ok(harness.elements.some((el) => el.text && el.text.includes('does not support transparency')));
    }
    harness.dialog.buttons[1].action();
    harness.dialog.onClose();
    assert.deepEqual({ ...await pending }, { embedDiagram: Embedded.enabled() });
  }
  assert.equal(JSON.stringify(project), before);
});

test('export popup cancellation and close resolve null; invalid custom color keeps dialog open', async () => {
  for (const cancel of ['button', 'close']) {
    const harness = dialogHarness();
    const pending = harness.api.Dialogs.openExportOptions('svg', Model.createProject());
    if (cancel === 'button') assert.equal(harness.dialog.buttons[0].action, undefined);
    harness.dialog.onClose();
    assert.equal(await pending, null);
  }
  const previous = globalThis.AISBP_CONFIG;
  try {
    globalThis.AISBP_CONFIG = { exports: { embedDiagram: false } };
    const harness = dialogHarness();
    const pending = harness.api.Dialogs.openExportOptions('png', Model.createProject());
    const embed = harness.elements.find((el) => el.type === 'checkbox');
    assert.equal(embed.checked, false);
    embed.checked = true;
    const mode = harness.elements.find((el) => el.tag === 'select');
    const color = harness.elements.find((el) => el.type === 'text');
    const picker = harness.elements.find((el) => el.type === 'color');
    assert.equal(picker.disabled, true);
    mode.value = 'custom';
    mode.onchange();
    assert.equal(color.disabled, false);
    assert.equal(picker.disabled, false);
    picker.value = '#abcdef';
    picker.oninput();
    assert.equal(color.value, '#abcdef');
    color.value = '#123AbF';
    color.oninput();
    assert.equal(picker.value, '#123abf');
    color.value = '#bad';
    color.oninput();
    assert.equal(picker.value, '#123abf');
    assert.equal(harness.dialog.buttons[1].action(), false);
    color.value = '#123456';
    harness.dialog.buttons[1].action();
    harness.dialog.onClose();
    assert.deepEqual({ ...await pending }, { embedDiagram: true, background: '#123456' });
  } finally { globalThis.AISBP_CONFIG = previous; }
});
