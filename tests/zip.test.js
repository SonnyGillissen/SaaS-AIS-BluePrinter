'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP, smallProject } = require('./helpers');

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const start = cursor;
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(cursor, true), 0x02014b50);
    assert.equal(view.getUint16(cursor + 8, true), 0x0800);
    assert.equal(view.getUint16(cursor + 10, true), 0);
    const length = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const local = view.getUint32(cursor + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint32(local + 22, true), length);
    assert.equal(view.getUint16(local + 26, true), nameLength);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    assert.deepEqual(bytes.subarray(local + 30, local + 30 + nameLength), name);
    const data = bytes.subarray(local + 30 + nameLength, local + 30 + nameLength + length);
    assert.equal(view.getUint32(cursor + 16, true), parseInt(AISBP.Embedded.checksum(data), 16));
    assert.equal(view.getUint32(local + 14, true), view.getUint32(cursor + 16, true));
    files.push({ name: new TextDecoder().decode(name), content: new TextDecoder().decode(data) });
    cursor += 46 + nameLength;
  }
  assert.equal(cursor, end);
  assert.equal(cursor - start, view.getUint32(end + 12, true));
  return files;
}

test('ZIP preserves UTF-8 text, empty files, offsets and standard CRC-32', () => {
  const files = [
    { name: 'example.txt', content: '123456789' },
    { name: '参数.json', content: '{"value":"日本語 🌍"}\n' },
    { name: 'empty.txt', content: '' }
  ];
  const zip = AISBP.Zip.create(files);
  assert.equal(new DataView(zip.buffer).getUint32(14, true), 0xcbf43926);
  assert.deepEqual(readZip(zip), files);
  assert.deepEqual(readZip(AISBP.Zip.create([])), []);
});

test('ARM and Bicep ZIPs include every generated file across resource groups unchanged', () => {
  const { project, sub } = smallProject(AISBP, ['service-bus-namespace']);
  const rg = AISBP.Model.addNode(project, 'resource-group', sub.id, {});
  AISBP.Model.addNode(project, 'storage-account', rg.id, {});
  for (const format of ['arm', 'bicep']) {
    const result = AISBP.Infrastructure.exportProject(project, format, { baseName: 'deployment' });
    const files = readZip(AISBP.Zip.create(result.files));
    assert.deepEqual(files, result.files.map(({ name, content }) => ({ name, content })));
    assert.ok(files.some((f) => f.name.includes('rg002')));
    assert.ok(files.some((f) => f.name.endsWith('.instructions.txt')));
    assert.ok(files.some((f) => f.name.endsWith('.deployment-scopes.json')));
  }
});

test('ZIP rejects unsafe, duplicate, overlong or non-text entries', () => {
  for (const name of ['../escape', '/absolute', 'a\\b', '..', '.', '', 'nul\0.txt', 'x'.repeat(65536)]) {
    assert.throws(() => AISBP.Zip.create([{ name, content: '' }]));
  }
  assert.throws(() => AISBP.Zip.create([{ name: 'x', content: '' }, { name: 'x', content: '' }]));
  assert.throws(() => AISBP.Zip.create([{ name: 'x', content: {} }]));
  assert.throws(() => AISBP.Zip.create(new Array(65536)));
});
