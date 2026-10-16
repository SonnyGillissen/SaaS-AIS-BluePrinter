'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP } = require('./helpers');
const Mirror = require('../tools/mirror-icons.js');

test('every catalog icon is a safe MS Icons library path', () => {
  const paths = Mirror.iconPaths();
  const used = new Set(AISBP.Catalog.all().map((t) => t.icon).filter(Boolean));
  assert.equal(paths.length, used.size, 'no icon path was rejected by the safety filter');
  paths.forEach((p) => assert.match(p, /^[a-z-]+\/[\w.+()-]+\.svg$/i));
});

test('icon URLs point at msicons.com by default and honour a custom base URL', () => {
  const p = AISBP.Model.createProject();
  assert.ok(AISBP.Icons.url(p, 'function-app').startsWith('https://msicons.com/icons/'));
  p.settings.icons.baseUrl = 'icons/msicons/';
  assert.ok(AISBP.Icons.url(p, 'function-app').startsWith('icons/msicons/'));
});

test('annotation icons are distinct, offline, and available in embedded exports', async () => {
  const p = AISBP.Model.createProject();
  p.settings.icons.baseUrl = 'https://example.invalid/icons/';
  const types = ['annotation-text', 'annotation-markdown', 'annotation-table'];
  const urls = types.map((type) => {
    AISBP.Model.addNode(p, type, null, {});
    const url = AISBP.Icons.url(p, type);
    assert.match(url, /^data:image\/svg\+xml;base64,/);
    assert.equal(AISBP.Icons.resolver(p, true)(type), url);
    assert.equal(AISBP.Icons.resolver(p, false)(type), url);
    assert.ok(Mirror.isPlainSvg(Buffer.from(url.split(',')[1], 'base64').toString()));
    return url;
  });
  assert.equal(new Set(urls).size, types.length);
  assert.equal(await AISBP.Icons.inlineAll(p), 0);
});

test('DevOps provider logos and feature icons are distinct, offline SVGs', async () => {
  const p = AISBP.Model.createProject();
  const types = ['azure-devops', 'github', 'github-enterprise', 'github-actions', 'azure-devops-pipeline'];
  const ado = AISBP.Model.addNode(p, 'azure-devops', null);
  const adoProject = AISBP.Model.addNode(p, 'azure-devops-project', ado.id);
  AISBP.Model.addNode(p, 'azure-devops-pipeline', adoProject.id);
  const github = AISBP.Model.addNode(p, 'github', null);
  const organization = AISBP.Model.addNode(p, 'github-organization', github.id);
  const repository = AISBP.Model.addNode(p, 'github-repository', organization.id);
  AISBP.Model.addNode(p, 'github-actions', repository.id);
  AISBP.Model.addNode(p, 'github-enterprise', null);
  const urls = types.map((type) => {
    const url = AISBP.Icons.url(p, type);
    assert.match(url, /^data:image\/svg\+xml;base64,/);
    assert.equal(AISBP.Icons.resolver(p, true)(type), url);
    assert.equal(AISBP.Icons.resolver(p, false)(type), url);
    assert.ok(Mirror.isPlainSvg(Buffer.from(url.split(',')[1], 'base64').toString()));
    return url;
  });
  assert.equal(urls[1], urls[2]);
  assert.equal(new Set(urls).size, types.length - 1);
  assert.equal(await AISBP.Icons.inlineAll(p), 0);
});

test('the mirror only accepts plain SVG documents', () => {
  assert.equal(Mirror.isPlainSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), true);
  assert.equal(Mirror.isPlainSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.equal(Mirror.isPlainSvg('<svg onload="x()"></svg>'), false);
  assert.equal(Mirror.isPlainSvg('<html></html>'), false);
});
