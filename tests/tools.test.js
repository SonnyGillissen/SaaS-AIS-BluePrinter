'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP } = require('./helpers');
const Mirror = require('../tools/mirror-icons.js');

test('every catalog icon is a safe MS Icons library path', () => {
  const paths = Mirror.iconPaths();
  const used = new Set(AISBP.Catalog.all().map((t) => t.icon));
  assert.equal(paths.length, used.size, 'no icon path was rejected by the safety filter');
  paths.forEach((p) => assert.match(p, /^[a-z-]+\/[\w.+()-]+\.svg$/i));
});

test('icon URLs point at msicons.com by default and honour a custom base URL', () => {
  const p = AISBP.Model.createProject();
  assert.ok(AISBP.Icons.url(p, 'function-app').startsWith('https://msicons.com/icons/'));
  p.settings.icons.baseUrl = 'icons/msicons/';
  assert.ok(AISBP.Icons.url(p, 'function-app').startsWith('icons/msicons/'));
});

test('the mirror only accepts plain SVG documents', () => {
  assert.equal(Mirror.isPlainSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), true);
  assert.equal(Mirror.isPlainSvg('<svg><script>alert(1)</script></svg>'), false);
  assert.equal(Mirror.isPlainSvg('<svg onload="x()"></svg>'), false);
  assert.equal(Mirror.isPlainSvg('<html></html>'), false);
});
