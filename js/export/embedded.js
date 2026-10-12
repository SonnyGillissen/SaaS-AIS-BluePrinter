/**
 * Native configuration carriers. Only AIS BluePrinter packages are imported;
 * third-party diagrams are never interpreted as projects.
 * @module AISBP.Embedded
 */
(function (root) {
  'use strict';
  const AISBP = (root.AISBP = root.AISBP || {});
  const Package = AISBP.Package || (typeof require === 'function' ? require('./package.js') : null);
  const MAX_JSON_BYTES = 20 * 1024 * 1024;
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const KEYWORD = 'AISBP_CONFIG_V1';
  const NS = 'urn:ais-blueprinter:configuration:1';
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const encoder = new TextEncoder();
  const corrupt = () => new Error('The embedded AIS BluePrinter configuration is corrupt or incomplete.');
  const missing = () => new Error('This file has no embedded AIS BluePrinter configuration. Import an original AIS BluePrinter export or a .aisbp.json file.');
  const tooLarge = () => new Error('The file or embedded configuration is too large to import.');

  function enabled(opts) {
    if (opts && typeof opts.embedDiagram === 'boolean') return opts.embedDiagram;
    return !(root.AISBP_CONFIG && root.AISBP_CONFIG.exports && root.AISBP_CONFIG.exports.embedDiagram === false);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function checksum(bytes) { return crc32(bytes).toString(16).padStart(8, '0'); }

  function payload(project) {
    const bytes = encoder.encode(Package.toJson(project));
    if (bytes.length > MAX_JSON_BYTES) throw tooLarge();
    return bytes;
  }

  function decode(bytes) {
    if (bytes.length > MAX_JSON_BYTES) throw tooLarge();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) { throw corrupt(); }
  }

  function base64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return root.btoa(binary);
  }

  function unbase64(text, crc) {
    if (text.length > Math.ceil(MAX_JSON_BYTES / 3) * 4) throw tooLarge();
    const unpadded = text.replace(/={1,2}$/, '');
    if (!text.length || text.length % 4 || /[^A-Za-z0-9+/]/.test(unpadded)) throw corrupt();
    if (text.length / 4 * 3 - (text.length - unpadded.length) > MAX_JSON_BYTES) throw tooLarge();
    let binary;
    try { binary = root.atob(text); } catch (_) { throw corrupt(); }
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    if (checksum(bytes) !== crc || base64(bytes) !== text) throw corrupt();
    return decode(bytes);
  }

  function toSvg(svg, project, opts) {
    if (!enabled(opts)) return svg;
    const bytes = payload(project);
    const metadata = '<metadata><aisbp:config xmlns:aisbp="' + NS + '" encoding="base64" crc32="' + checksum(bytes) + '">' + base64(bytes) + '</aisbp:config></metadata>';
    if (!/<svg\b[^>]*>/.test(svg)) throw new Error('Invalid SVG document.');
    return svg.replace(/<svg\b[^>]*>/, (tag) => tag + metadata);
  }

  function toXml(xml, project, opts) {
    if (!enabled(opts)) return xml;
    const bytes = payload(project);
    const comment = '<!--' + KEYWORD + ':' + checksum(bytes) + ':' + base64(bytes) + '-->';
    return xml.replace(/(<\?xml[^>]*\?>\s*)?/, (prefix) => prefix + comment + '\n');
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    parts.forEach((b) => { out.set(b, offset); offset += b.length; });
    return out;
  }

  function chunk(type, data) {
    const body = concat([encoder.encode(type), data]);
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(out.length - 4, crc32(body));
    return out;
  }

  function pngChunks(bytes) {
    if (!PNG.every((v, i) => bytes[i] === v)) throw corrupt();
    const chunks = [];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    while (pos < bytes.length) {
      if (bytes.length - pos < 12) throw corrupt();
      const size = view.getUint32(pos);
      if (size > bytes.length - pos - 12) throw corrupt();
      const end = pos + 12 + size;
      const type = String.fromCharCode.apply(null, bytes.subarray(pos + 4, pos + 8));
      if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(pos + 4, end - 4)) !== view.getUint32(end - 4)) throw corrupt();
      chunks.push({ type, start: pos, data: bytes.subarray(pos + 8, end - 4) });
      pos = end;
      if (type === 'IEND') {
        if (size || pos !== bytes.length) throw corrupt();
        break;
      }
    }
    if (!chunks.length || chunks[0].type !== 'IHDR' || chunks[0].data.length !== 13 ||
        chunks[chunks.length - 1].type !== 'IEND' || !chunks.some((c) => c.type === 'IDAT')) throw corrupt();
    return chunks;
  }

  function pngPackage(chunks) {
    let found;
    for (const c of chunks) {
      if (c.type !== 'iTXt') continue;
      const zero = c.data.indexOf(0);
      const keyword = String.fromCharCode.apply(null, c.data.subarray(0, zero < 0 ? Math.min(c.data.length, 79) : Math.min(zero, 79)));
      if (keyword !== KEYWORD) {
        if (keyword.startsWith(KEYWORD)) throw corrupt();
        continue;
      }
      if (found !== undefined || zero < 0 || c.data.length < zero + 5 ||
          c.data[zero + 1] !== 0 || c.data[zero + 2] !== 0 || c.data[zero + 3] !== 0 || c.data[zero + 4] !== 0) throw corrupt();
      found = decode(c.data.subarray(zero + 5));
    }
    return found;
  }

  function toPng(bytes, project, opts) {
    if (!enabled(opts)) return bytes;
    const chunks = pngChunks(bytes);
    if (pngPackage(chunks) !== undefined) throw new Error('The PNG already contains an AIS BluePrinter configuration.');
    const insertion = chunks[chunks.length - 1].start;
    const data = concat([encoder.encode(KEYWORD), new Uint8Array(5), payload(project)]);
    return concat([bytes.subarray(0, insertion), chunk('iTXt', data), bytes.subarray(insertion)]);
  }

  function xmlPackage(text) {
    const hasComment = text.includes('<!--' + KEYWORD);
    const hasSvg = text.includes('<aisbp:config');
    if (!hasComment && !hasSvg) throw missing();
    if (/<!DOCTYPE/i.test(text)) throw corrupt();
    if (typeof root.DOMParser === 'function') {
      const doc = new root.DOMParser().parseFromString(text, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw corrupt();
    } else validateXml(text);
    const comments = Array.from(text.matchAll(/<!--AISBP_CONFIG_V1:([0-9a-f]{8}):([A-Za-z0-9+/=]+)-->/g));
    const svg = Array.from(text.matchAll(/<aisbp:config xmlns:aisbp="urn:ais-blueprinter:configuration:1" encoding="base64" crc32="([0-9a-f]{8})">([A-Za-z0-9+/=]+)<\/aisbp:config>/g));
    const matches = comments.concat(svg);
    if (matches.length !== 1 || (hasComment && hasSvg) ||
        !/<(svg|mxfile|model)\b/.test(text) || !/<\/(svg|mxfile|model)>\s*$/.test(text)) throw corrupt();
    const marker = hasComment ? '<!--' + KEYWORD : '<aisbp:config';
    if (text.split(marker).length !== 2) throw corrupt();
    return unbase64(matches[0][2], matches[0][1]);
  }

  // Node has no DOMParser. Validate the inert XML subset emitted by our writers.
  // DTDs are deliberately unsupported; neither import path resolves entities.
  function validateXml(text) {
    const stack = [];
    let roots = 0;
    let pos = 0;
    const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
    let match;
    const validText = (value) => {
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]|&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) throw corrupt();
    };
    while ((match = token.exec(text))) {
      const between = text.slice(pos, match.index);
      if (between.includes('<') || (!stack.length && between.trim())) throw corrupt();
      validText(between);
      const tag = match[0];
      if (tag.startsWith('<!--')) {
        if (tag.slice(4, -3).includes('--')) throw corrupt();
      } else if (tag.startsWith('<![CDATA[')) {
        if (!stack.length) throw corrupt();
      } else if (!tag.startsWith('<?')) {
        const closing = tag.startsWith('</');
        const name = /^<\/?([\w:.-]+)/.exec(tag)[1];
        if (closing) {
          if (!/^<\/[\w:.-]+\s*>$/.test(tag) || stack.pop() !== name) throw corrupt();
        } else {
          if (!stack.length && ++roots !== 1) throw corrupt();
          const attrs = tag.slice(name.length + 1, tag.endsWith('/>') ? -2 : -1);
          const seen = new Set();
          let tail = attrs;
          while (tail.trim()) {
            const attr = /^\s+([\w:.-]+)\s*=\s*("[^"<]*"|'[^'<]*')/.exec(tail);
            if (!attr || seen.has(attr[1])) throw corrupt();
            validText(attr[2]);
            seen.add(attr[1]);
            tail = tail.slice(attr[0].length);
          }
          if (!tag.endsWith('/>')) stack.push(name);
        }
      }
      pos = token.lastIndex;
    }
    if (stack.length || roots !== 1 || text.slice(pos).trim()) throw corrupt();
  }

  function pdfPackage(bytes) {
    // Latin-1 preserves byte offsets; UTF-8 decoding the entire PDF would not.
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    if (!text.includes('/AISBPConfig')) throw missing();
    const matches = Array.from(text.matchAll(/<< \/Type \/EmbeddedFile \/Subtype \/application#2Fjson \/AISBPConfig true \/AISBPCRC \(([0-9a-f]{8})\) \/Length (\d+) >>\nstream\n/g));
    if (matches.length !== 1 || !/%%EOF\s*$/.test(text)) throw corrupt();
    const match = matches[0];
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length > MAX_JSON_BYTES) throw tooLarge();
    const start = match.index + match[0].length;
    if (start + length > bytes.length || text.slice(start + length, start + length + 18) !== '\nendstream\nendobj\n') throw corrupt();
    const data = bytes.subarray(start, start + length);
    if (checksum(data) !== match[1]) throw corrupt();
    return decode(data);
  }

  async function fromFile(file) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== 'function') throw new Error('Choose a file to import.');
    if (file.size > MAX_FILE_BYTES) throw tooLarge();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size || bytes.length > MAX_FILE_BYTES) throw corrupt();
    let json;
    if (PNG.subarray(0, 4).every((v, i) => bytes[i] === v)) {
      json = pngPackage(pngChunks(bytes));
      if (json === undefined) throw missing();
    } else if (String.fromCharCode.apply(null, bytes.subarray(0, 5)) === '%PDF-') {
      json = pdfPackage(bytes);
    } else {
      const text = new TextDecoder('utf-8', { fatal: true });
      let content;
      try { content = text.decode(bytes); } catch (_) { throw corrupt(); }
      const first = content.trimStart()[0];
      if (first === '{' || first === '[') {
        if (bytes.length > MAX_JSON_BYTES) throw tooLarge();
        json = content;
      } else if (first === '<') json = xmlPackage(content);
      else throw missing();
    }
    return Package.fromJson(json);
  }

  AISBP.Embedded = { MAX_JSON_BYTES, MAX_FILE_BYTES, KEYWORD, enabled, payload, checksum, toSvg, toXml, toPng, fromFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Embedded;
})(typeof globalThis !== 'undefined' ? globalThis : this);
