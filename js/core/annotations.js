/**
 * Pure annotation data, wrapping and safe SVG text helpers.
 * Annotation options use the existing node.attributes persistence path.
 */
(function (root) {
  'use strict';
  const AISBP = (root.AISBP = root.AISBP || {});
  const esc = AISBP.Util.escapeXml;
  const THEMES = ['plain', 'pill', 'card', 'callout'];
  const ALIGN = ['left', 'center', 'right'];
  const MAX_ROWS = 50;
  const MAX_COLS = 12;
  const DEFAULT_ROWS = [['Name', 'Value'], ['Item', 'Details']];
  const isAnnotation = (type) => ['annotation-text', 'annotation-markdown', 'annotation-table'].includes(type);
  const text = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const number = (v, fallback, min, max) => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : fallback;
  const choice = (v, list, fallback) => list.includes(v) ? v : fallback;

  function rows(value) {
    let data = value;
    if (typeof data === 'string') {
      try { data = JSON.parse(data.slice(0, 700000)); } catch (_) { data = DEFAULT_ROWS; }
    }
    if (!Array.isArray(data) || !data.length) data = DEFAULT_ROWS;
    data = data.slice(0, MAX_ROWS).map((r) => Array.isArray(r) ? r.slice(0, MAX_COLS).map((c) => text(c, 1000)) : ['']);
    const cols = Math.max(1, ...data.map((r) => r.length));
    return data.map((r) => Array.from({ length: cols }, (_, i) => r[i] || ''));
  }

  function normalize(type, input) {
    const a = input && typeof input === 'object' ? input : {};
    const out = {
      theme: choice(a.theme, THEMES, 'plain'),
      fontSize: number(a.fontSize, 14, 8, 48),
      padding: number(a.padding, 12, 0, 40),
      align: choice(a.align, ALIGN, 'left')
    };
    if (type !== 'annotation-table') {
      out.content = a.content === undefined ? (type === 'annotation-markdown' ? '# Heading\nAdd **Markdown** text here.' : 'Add text here.') : text(a.content, 20000);
      return out;
    }
    const data = rows(a.rows);
    let widths = a.columnWidths;
    if (typeof widths === 'string') { try { widths = JSON.parse(widths); } catch (_) { widths = []; } }
    out.rows = JSON.stringify(data);
    out.columnWidths = JSON.stringify(data[0].map((_, i) => number(Array.isArray(widths) && widths[i], 150, 50, 1000)));
    out.headerRow = typeof a.headerRow === 'boolean' ? a.headerRow : true;
    out.firstColumnHeader = a.firstColumnHeader === true;
    out.striped = a.striped === true;
    out.grid = choice(a.grid, ['all', 'rows', 'outer', 'none'], 'all');
    out.caption = text(a.caption, 1000);
    return out;
  }

  /** Return a new rectangular table; never mutate the caller's rows. */
  function tableOperation(value, operation, index, target) {
    const data = rows(value);
    const cols = data[0].length;
    const at = Math.max(0, Math.min(data.length - 1, Math.floor(Number(index) || 0)));
    const col = Math.max(0, Math.min(cols - 1, Math.floor(Number(index) || 0)));
    if (operation === 'addRow' && data.length < MAX_ROWS) data.splice(at + 1, 0, Array(cols).fill(''));
    if (operation === 'removeRow' && data.length > 1) data.splice(at, 1);
    if (operation === 'moveRow') {
      const to = Math.max(0, Math.min(data.length - 1, Math.floor(Number(target) || 0)));
      data.splice(to, 0, data.splice(at, 1)[0]);
    }
    if (operation === 'addColumn' && cols < MAX_COLS) data.forEach((r) => r.splice(col + 1, 0, ''));
    if (operation === 'removeColumn' && cols > 1) data.forEach((r) => r.splice(col, 1));
    if (operation === 'moveColumn') {
      const to = Math.max(0, Math.min(cols - 1, Math.floor(Number(target) || 0)));
      data.forEach((r) => r.splice(to, 0, r.splice(col, 1)[0]));
    }
    if (operation === 'sortAsc' || operation === 'sortDesc') {
      const header = target === true ? data.shift() : null;
      data.sort((a, b) => (operation === 'sortDesc' ? -1 : 1) * a[col].localeCompare(b[col], undefined, { numeric: true }));
      if (header) data.unshift(header);
    }
    return data;
  }

  /** Small Markdown subset: no HTML parsing or clickable URL/image output. */
  function inline(source) {
    const tokens = [];
    const re = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]*\))/g;
    let start = 0, m;
    while ((m = re.exec(source))) {
      if (m.index > start) tokens.push({ text: source.slice(start, m.index) });
      const t = m[0];
      if (t[0] === '`') tokens.push({ text: t.slice(1, -1), code: true });
      else if (t.startsWith('[')) tokens.push({ text: t.slice(1, t.indexOf(']')) });
      else {
        const n = t.startsWith('***') ? 3 : t.startsWith('**') || t.startsWith('__') ? 2 : 1;
        tokens.push({ text: t.slice(n, -n), bold: n >= 2, italic: n === 1 || n === 3 });
      }
      start = re.lastIndex;
    }
    if (start < source.length) tokens.push({ text: source.slice(start) });
    return tokens;
  }

  function blocks(content, markdown) {
    let code = false;
    return String(content).replace(/\r\n?/g, '\n').split('\n').map((source) => {
      if (markdown && /^```/.test(source)) { code = !code; return { runs: [], scale: 1, blank: true }; }
      if (!markdown) return { runs: [{ text: source }], scale: 1 };
      if (code) return { runs: [{ text: source, code: true }], scale: 1 };
      const heading = /^(#{1,6})\s+(.*)$/.exec(source);
      const list = /^\s*(?:[-+*]|\d+\.)\s+/.exec(source);
      const quote = /^>\s?/.test(source);
      if (heading) source = heading[2];
      if (list) source = '\u2022 ' + source.slice(list[0].length);
      if (quote) source = source.replace(/^>\s?/, '');
      return { runs: inline(source), scale: heading ? [1.8, 1.5, 1.3, 1.15, 1.05, 1][heading[1].length - 1] : 1, bold: !!heading, italic: quote };
    });
  }

  function advance(ch, run, size) {
    return size * (run.code ? 0.62 : /[ilI.,'!| ]/.test(ch) ? 0.32 : /[MW@#]/.test(ch) ? 0.85 : 0.57) * (run.bold ? 1.04 : 1);
  }

  /** Wrap styled characters at words, splitting long unbroken words when necessary. */
  function wrap(runs, width, size) {
    const chars = [];
    runs.forEach((run) => Array.from(run.text).forEach((ch) => chars.push({ ch, run, w: advance(ch, run, size) })));
    const out = [];
    let start = 0;
    while (start < chars.length) {
      let end = start, used = 0, space = -1;
      while (end < chars.length && (used + chars[end].w <= width || end === start)) {
        used += chars[end].w;
        if (chars[end].ch === ' ') space = end;
        end++;
      }
      if (end < chars.length && space > start) end = space + 1;
      const line = [];
      chars.slice(start, end).forEach(({ ch, run }) => {
        const last = line[line.length - 1];
        if (last && last.source === run) last.text += ch;
        else line.push(Object.assign({}, run, { text: ch, source: run }));
      });
      out.push(line);
      start = end;
    }
    return out.length ? out : [[]];
  }

  function textLayout(content, width, size, markdown) {
    const lines = [];
    let h = 0;
    blocks(content, markdown).forEach((b) => {
      const fs = size * b.scale;
      wrap(b.runs, Math.max(10, width), fs).forEach((runs) => {
        h += fs * 1.45;
        lines.push({ runs, size: fs, y: h - fs * 0.28, bold: b.bold, italic: b.italic });
      });
    });
    return { lines, h };
  }

  function measure(node) {
    const a = normalize(node.type, node.attributes);
    const p = a.padding;
    if (node.type !== 'annotation-table') {
      const w = Math.max(2 * p + a.fontSize * 2, number(node.w, 300, 60, 100000));
      const layout = textLayout(a.content, w - p * 2, a.fontSize, node.type === 'annotation-markdown');
      return { a, w, h: Math.max(number(node.h, 0, 0, 100000), layout.h + 2 * p, 30), layout };
    }
    const data = rows(a.rows);
    const minimumCellW = Math.max(50, 2 * p + a.fontSize * 2);
    let widths = JSON.parse(a.columnWidths).map((cw) => Math.max(minimumCellW, cw));
    const naturalW = widths.reduce((sum, w) => sum + w, 0);
    const w = Math.max(minimumCellW * widths.length, number(node.w, naturalW, 60, 100000));
    // Keep every column readable, including when widths differ widely.
    const remaining = w - minimumCellW * widths.length;
    const naturalExtra = naturalW - minimumCellW * widths.length;
    widths = widths.map((cw) => minimumCellW + remaining * (naturalExtra ? (cw - minimumCellW) / naturalExtra : 1 / widths.length));
    const caption = a.caption ? textLayout(a.caption, w - 2 * p, a.fontSize, false) : { lines: [], h: 0 };
    const layouts = data.map((r) => r.map((c, i) => textLayout(c, widths[i] - 2 * p, a.fontSize, false)));
    const heights = layouts.map((r) => Math.max(...r.map((l) => l.h)) + p * 2);
    return { a, w, h: Math.max(number(node.h, 0, 0, 100000), heights.reduce((s, v) => s + v, 0) + (a.caption ? caption.h + p * 2 : 0)), widths, heights, layouts, caption };
  }

  function svgText(layout, x, y, width, a, color, bold) {
    const align = a.align;
    const tx = x + (align === 'center' ? width / 2 : align === 'right' ? width : 0);
    return layout.lines.map((line) => '<text xml:space="preserve" x="' + tx + '" y="' + (y + line.y) + '" text-anchor="' + (align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start') + '" font-size="' + line.size + '" fill="' + esc(color) + '">' +
      line.runs.map((r) => '<tspan' + (r.bold || line.bold || bold ? ' font-weight="700"' : '') + (r.italic || line.italic ? ' font-style="italic"' : '') + (r.code ? ' font-family="monospace"' : '') + '>' + esc(r.text) + '</tspan>').join('') + '</text>').join('');
  }

  function plainText(node) {
    const a = normalize(node.type, node.attributes);
    return node.type === 'annotation-table' ? [a.caption, ...rows(a.rows).map((r) => r.join(' | '))].filter(Boolean).join('\n') :
      blocks(a.content, node.type === 'annotation-markdown').map((b) => b.runs.map((r) => r.text).join('')).join('\n');
  }

  AISBP.Annotations = { THEMES, ALIGN, MAX_ROWS, MAX_COLS, isAnnotation, normalize, rows, tableOperation, inline, wrap, textLayout, measure, svgText, plainText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
