/**
 * AIS BluePrinter - uncompressed ZIP archives for generated deployment text files.
 * Uses classic ZIP headers with UTF-8 filenames; no external library or server is needed.
 */
(function (root) {
  'use strict';
  const AISBP = (root.AISBP = root.AISBP || {});

  function create(files) {
    if (!Array.isArray(files) || files.length > 65535) throw new Error('Too many ZIP entries.');
    const encoder = new TextEncoder();
    const names = new Set();
    let offset = 0;
    let directorySize = 0;
    const entries = files.map((file) => {
      if (!file || typeof file.name !== 'string' || !file.name || /[\\/\x00-\x1f]/.test(file.name) ||
          file.name === '.' || file.name === '..' || names.has(file.name) || typeof file.content !== 'string') {
        throw new Error('ZIP entries must have unique, safe filenames and text content.');
      }
      names.add(file.name);
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      if (name.length > 65535 || data.length >= 0xffffffff) throw new Error('ZIP entry is too large.');
      const entry = { name, data, offset, crc: parseInt(AISBP.Embedded.checksum(data), 16) };
      offset += 30 + name.length + data.length;
      directorySize += 46 + name.length;
      if (offset + directorySize + 22 >= 0xffffffff) throw new Error('ZIP archive is too large.');
      return entry;
    });
    const output = new Uint8Array(offset + directorySize + 22);
    const view = new DataView(output.buffer);
    let position = 0;
    entries.forEach((entry) => {
      view.setUint32(position, 0x04034b50, true);
      view.setUint16(position + 4, 20, true);
      view.setUint16(position + 6, 0x0800, true);
      view.setUint16(position + 12, 0x0021, true);
      view.setUint32(position + 14, entry.crc, true);
      view.setUint32(position + 18, entry.data.length, true);
      view.setUint32(position + 22, entry.data.length, true);
      view.setUint16(position + 26, entry.name.length, true);
      output.set(entry.name, position + 30);
      output.set(entry.data, position + 30 + entry.name.length);
      position += 30 + entry.name.length + entry.data.length;
    });
    entries.forEach((entry) => {
      view.setUint32(position, 0x02014b50, true);
      view.setUint16(position + 4, 20, true);
      view.setUint16(position + 6, 20, true);
      view.setUint16(position + 8, 0x0800, true);
      view.setUint16(position + 14, 0x0021, true);
      view.setUint32(position + 16, entry.crc, true);
      view.setUint32(position + 20, entry.data.length, true);
      view.setUint32(position + 24, entry.data.length, true);
      view.setUint16(position + 28, entry.name.length, true);
      view.setUint32(position + 42, entry.offset, true);
      output.set(entry.name, position + 46);
      position += 46 + entry.name.length;
    });
    view.setUint32(position, 0x06054b50, true);
    view.setUint16(position + 8, entries.length, true);
    view.setUint16(position + 10, entries.length, true);
    view.setUint32(position + 12, directorySize, true);
    view.setUint32(position + 16, offset, true);
    return output;
  }

  AISBP.Zip = { create };
})(typeof globalThis !== 'undefined' ? globalThis : this);
