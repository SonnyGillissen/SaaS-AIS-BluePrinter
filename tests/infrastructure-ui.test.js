'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AISBP } = require('./helpers');

function ui(overrides) {
  const api = {
    ...AISBP,
    Dom: { download() {}, toast() {} },
    Infrastructure: {
      isTemplate: (value) => Array.isArray(value.resources),
      importTemplate: (template, parameters) => ({ template, parameters })
    },
    ...overrides
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js/ui/exporter.js'), 'utf8'), { AISBP: api });
  return api.Exporter;
}

function jsonFile(value, name) {
  const content = JSON.stringify(value);
  return { name: name || 'template.json', size: content.length, type: 'application/json', text: async () => content };
}

test('ARM importer accepts parameter/template selection in either order', async () => {
  const exporter = ui();
  const template = { resources: [], parameters: { region: { type: 'string' } } };
  const parameters = { parameters: { region: { value: 'westeurope' } } };
  for (const files of [[jsonFile(template), jsonFile(parameters)], [jsonFile(parameters), jsonFile(template)]]) {
    const result = await exporter.readImport(files);
    assert.equal(JSON.stringify(result.template), JSON.stringify(template));
    assert.equal(JSON.stringify(result.parameters), JSON.stringify(parameters));
  }
  assert.equal((await exporter.readImport([jsonFile(template)])).parameters, undefined);
});

test('ARM file selection rejects ambiguous, oversized and unrelated companions', async () => {
  const exporter = ui();
  const template = jsonFile({ resources: [] });
  await assert.rejects(exporter.readImport([template, template]), /exactly one/);
  await assert.rejects(exporter.readImport([template, jsonFile({ hello: true })]), /second file/);
  await assert.rejects(exporter.readImport([jsonFile({ parameters: {} })]), /together/);
  await assert.rejects(exporter.readImport([template, template, template]), /Choose one/);
  await assert.rejects(exporter.readImport([{ ...template, size: AISBP.Embedded.MAX_JSON_BYTES + 1 }]), /too large/);
});

test('native blueprint imports still use the embedded package reader', async () => {
  const project = AISBP.Model.createProject();
  const file = new Blob([AISBP.Package.toJson(project)]);
  const result = await ui().readImport([file]);
  assert.equal(result.project.meta.id, project.meta.id);
});

test('infrastructure downloads require individual clicks and warnings use text nodes', async () => {
  const downloads = [];
  let dialog;
  const exporter = ui({
    Dom: {
      download: (...args) => downloads.push(args),
      toast() {},
      h: (tag, attrs, ...children) => ({ tag, attrs, children }),
      modal: (value) => { dialog = value; }
    },
    Infrastructure: {
      exportProject: () => ({
        warnings: ['<img src=x onerror=alert(1)>'],
        files: [{ name: 'test.bicep', content: 'targetScope = \'resourceGroup\'', mime: 'text/plain' }]
      })
    }
  });
  await exporter.run('bicep', AISBP.Model.createProject());
  assert.equal(downloads.length, 0);
  const nodes = [];
  function collect(value) {
    if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') {
      nodes.push(value);
      collect(value.children);
    }
  }
  collect(dialog.body);
  assert.ok(nodes.some((node) => node.attrs && node.attrs.text === '<img src=x onerror=alert(1)>'));
  nodes.find((node) => node.tag === 'button').attrs.onclick();
  assert.equal(downloads[0][1], 'test.bicep');
});
