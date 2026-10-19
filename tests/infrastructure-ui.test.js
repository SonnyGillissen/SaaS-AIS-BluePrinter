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

test('ARM imports arrange sibling resources for immediate canvas use', () => {
  const result = AISBP.Infrastructure.importTemplate({
    $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',
    resources: ['first', 'second'].map((name) => ({
      type: 'Microsoft.Network/networkSecurityGroups', apiVersion: '2023-11-01',
      name, location: 'westeurope', properties: {}
    }))
  });
  const siblings = Object.values(result.project.nodes).filter((node) => node.type === 'nsg');
  assert.equal(siblings.length, 2);
  const geometry = AISBP.Layout.compute(result.project);
  const [first, second] = siblings.map((node) => geometry.rects[node.id]);
  assert.ok(first.x + first.w <= second.x || second.x + second.w <= first.x ||
    first.y + first.h <= second.y || second.y + second.h <= first.y);
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
  nodes.find((node) => node.tag === 'button' && node.attrs.text === 'test.bicep').attrs.onclick();
  assert.equal(downloads[0][1], 'test.bicep');
  nodes.find((node) => node.tag === 'button' && node.attrs.text === 'Download all as ZIP').attrs.onclick();
  assert.match(downloads[1][1], /-bicep\.zip$/);
  assert.equal(downloads[1][2], 'application/zip');
  assert.equal(new DataView(downloads[1][0].buffer).getUint32(0, true), 0x04034b50);
});
