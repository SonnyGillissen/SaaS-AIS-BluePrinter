/**
 * AIS BluePrinter - SVG diagram renderer.
 *
 * Produces SVG markup (as a string) for a project. The same renderer is used for the
 * interactive canvas and for the exports (SVG/PNG/PDF), which guarantees that what you see
 * is what you export. All user supplied text is escaped.
 *
 * @module AISBP.Render
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('../core/catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('../core/model.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('../core/layout.js') : null);

  const esc = Util.escapeXml;
  const FONT = "'Segoe UI', 'Segoe UI Web', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";

  /**
   * Display styles. Each style defines the colors of the canvas, tiles, containers per
   * hierarchy level and connections.
   */
  const STYLES = {
    classic: {
      label: 'Azure (classic)', font: FONT, background: '#ffffff', grid: '#eef1f5', text: '#1b1b1b', subtext: '#5d6670',
      leafFill: '#ffffff', leafStroke: '#d5dbe3', radius: 8, shadow: true,
      containers: {
        'management-group': { fill: '#f7f2fc', stroke: '#8661c5', dash: '7 4' },
        subscription: { fill: '#fffaeb', stroke: '#d79a2b', dash: '' },
        'resource-group': { fill: '#f0f7fe', stroke: '#0078d4', dash: '5 3' },
        default: { fill: '#f8fafc', stroke: '#9aa7b8', dash: '' }
      },
      edge: '#0063b1', edgeText: '#0b3d6b', edgeLabelBg: '#ffffff', selection: '#ff8c00', error: '#d13438'
    },
    blueprint: {
      label: 'Blueprint', font: "Consolas, 'Cascadia Mono', 'Courier New', monospace", background: '#0d3b66', grid: '#1a4c7c', text: '#ffffff', subtext: '#cfe3ff',
      leafFill: 'rgba(255,255,255,0.05)', leafStroke: '#a9cdf5', radius: 2, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#e9f2ff', dash: '8 4' },
        subscription: { fill: 'none', stroke: '#ffd166', dash: '' },
        'resource-group': { fill: 'rgba(255,255,255,0.03)', stroke: '#a9cdf5', dash: '4 3' },
        default: { fill: 'rgba(255,255,255,0.04)', stroke: '#cfe3ff', dash: '2 2' }
      },
      edge: '#ffd166', edgeText: '#ffffff', edgeLabelBg: '#0d3b66', selection: '#ff7b54', error: '#ff6b6b'
    },
    minimal: {
      label: 'Minimal', font: FONT, background: '#ffffff', grid: '', text: '#222222', subtext: '#6b6b6b',
      leafFill: 'none', leafStroke: 'none', radius: 0, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#b5b5b5', dash: '6 4' },
        subscription: { fill: 'none', stroke: '#9a9a9a', dash: '' },
        'resource-group': { fill: 'none', stroke: '#c7c7c7', dash: '3 3' },
        default: { fill: 'none', stroke: '#d6d6d6', dash: '' }
      },
      edge: '#555555', edgeText: '#333333', edgeLabelBg: '#ffffff', selection: '#0078d4', error: '#c50f1f'
    },
    dark: {
      label: 'Dark', font: FONT, background: '#1b1c20', grid: '#26282e', text: '#f3f3f3', subtext: '#a9b0bb',
      leafFill: '#25272d', leafStroke: '#3b3f4a', radius: 8, shadow: false,
      containers: {
        'management-group': { fill: '#211d2b', stroke: '#a78bfa', dash: '7 4' },
        subscription: { fill: '#2a2518', stroke: '#e8b14b', dash: '' },
        'resource-group': { fill: '#18232f', stroke: '#4fa3ff', dash: '5 3' },
        default: { fill: '#20232a', stroke: '#6b7685', dash: '' }
      },
      edge: '#4fa3ff', edgeText: '#e6f0ff', edgeLabelBg: '#1b1c20', selection: '#ffb347', error: '#ff6b6b'
    },
    sketch: {
      label: 'Whiteboard', font: "'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive", background: '#fffef8', grid: '', text: '#2b2b2b', subtext: '#575757',
      leafFill: '#ffffff', leafStroke: '#2b2b2b', radius: 14, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#6b4fbb', dash: '10 6' },
        subscription: { fill: '#fff6d5', stroke: '#2b2b2b', dash: '' },
        'resource-group': { fill: '#eaf4ff', stroke: '#2b2b2b', dash: '9 5' },
        default: { fill: '#ffffff', stroke: '#2b2b2b', dash: '' }
      },
      edge: '#2b2b2b', edgeText: '#2b2b2b', edgeLabelBg: '#fffef8', selection: '#e3008c', error: '#c50f1f'
    }
  };

  const CONNECTORS = [
    { id: 'orthogonal', label: 'Orthogonal' },
    { id: 'straight', label: 'Straight' },
    { id: 'curved', label: 'Curved' }
  ];

  function style(id) {
    return STYLES[id] || STYLES.classic;
  }

  function center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** Point on the border of `r` on the line from its center towards `target`. */
  function borderPoint(r, target) {
    const c = center(r);
    const dx = target.x - c.x;
    const dy = target.y - c.y;
    if (!dx && !dy) return c;
    const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  /**
   * Compute the SVG path and label position for a connection between two rects.
   * @returns {{d: string, label: {x:number,y:number}}}
   */
  function connectorPath(a, b, kind) {
    const ca = center(a);
    const cb = center(b);
    if (kind === 'orthogonal') {
      const dx = cb.x - ca.x;
      const dy = cb.y - ca.y;
      const horizontal = Math.abs(dx) * (a.h + b.h) >= Math.abs(dy) * (a.w + b.w);
      if (horizontal) {
        const x1 = dx >= 0 ? a.x + a.w : a.x;
        const x2 = dx >= 0 ? b.x : b.x + b.w;
        const mx = Math.round((x1 + x2) / 2);
        return { d: 'M' + x1 + ' ' + ca.y + ' H' + mx + ' V' + cb.y + ' H' + x2, label: { x: mx, y: (ca.y + cb.y) / 2 } };
      }
      const y1 = dy >= 0 ? a.y + a.h : a.y;
      const y2 = dy >= 0 ? b.y : b.y + b.h;
      const my = Math.round((y1 + y2) / 2);
      return { d: 'M' + ca.x + ' ' + y1 + ' V' + my + ' H' + cb.x + ' V' + y2, label: { x: (ca.x + cb.x) / 2, y: my } };
    }
    const p1 = borderPoint(a, cb);
    const p2 = borderPoint(b, ca);
    const r1 = (n) => Math.round(n * 10) / 10;
    if (kind === 'curved') {
      const mx = (p1.x + p2.x) / 2;
      return {
        d: 'M' + r1(p1.x) + ' ' + r1(p1.y) + ' C' + r1(mx) + ' ' + r1(p1.y) + ' ' + r1(mx) + ' ' + r1(p2.y) + ' ' + r1(p2.x) + ' ' + r1(p2.y),
        label: { x: mx, y: (p1.y + p2.y) / 2 }
      };
    }
    return { d: 'M' + r1(p1.x) + ' ' + r1(p1.y) + ' L' + r1(p2.x) + ' ' + r1(p2.y), label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }

  /** <defs> with arrow markers, shadow filter and grid pattern. */
  function defs(st, prefix) {
    const p = prefix || '';
    return (
      '<defs>' +
      '<marker id="' + p + 'arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + st.edge + '"/></marker>' +
      '<marker id="' + p + 'arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="' + st.edge + '" stroke-width="1.5"/></marker>' +
      '<marker id="' + p + 'dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6"><circle cx="5" cy="5" r="4" fill="' + st.edge + '"/></marker>' +
      '<marker id="' + p + 'arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + st.selection + '"/></marker>' +
      (st.shadow ? '<filter id="' + p + 'shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#1b2a3a" flood-opacity="0.18"/></filter>' : '') +
      (st.grid ? '<pattern id="' + p + 'grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" stroke="' + st.grid + '" stroke-width="1"/></pattern>' : '') +
      '</defs>'
    );
  }

  /** Placeholder icon used when an icon is not available (e.g. offline export). */
  function placeholderIcon(x, y, size, typeId, st) {
    const def = Catalog.get(typeId);
    const abbr = (def ? def.abbr : '?').slice(0, 5).toUpperCase();
    return (
      '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="' + size / 6 + '" fill="#0078d4"/>' +
      '<text x="' + (x + size / 2) + '" y="' + (y + size / 2 + size / 9) + '" text-anchor="middle" font-size="' + Math.max(7, size / 4.2) + '" font-weight="700" fill="#ffffff" font-family="' + esc(st.font) + '">' + esc(abbr) + '</text>'
    );
  }

  function icon(x, y, size, typeId, st, iconHref) {
    const href = iconHref ? iconHref(typeId) : null;
    if (!href) return placeholderIcon(x, y, size, typeId, st);
    return '<image x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" href="' + esc(href) + '" preserveAspectRatio="xMidYMid meet"/>';
  }

  function tooltip(project, r) {
    const def = Catalog.get(r.type);
    const lines = [r.name, def ? def.label + (def.provider ? ' (' + def.provider + ')' : '') : r.type];
    r.attrs.forEach((a) => lines.push(a.label + ': ' + a.value));
    return '<title>' + esc(lines.join('\n')) + '</title>';
  }

  function renderContainer(project, r, st, o) {
    const node = project.nodes[r.id];
    const pal = st.containers[node.type] || st.containers.default;
    const selected = o.selection && o.selection.nodes.has(r.id);
    const isDrop = o.dropTargetId === r.id;
    const problems = o.problems && o.problems[r.id];
    let s = '<g class="node container" data-node-id="' + esc(r.id) + '">' + tooltip(project, r);
    s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="' + st.radius + '" fill="' + pal.fill + '" stroke="' + (isDrop ? st.selection : pal.stroke) + '" stroke-width="' + (isDrop ? 3 : 1.5) + '"' + (pal.dash && !isDrop ? ' stroke-dasharray="' + pal.dash + '"' : '') + '/>';
    s += icon(r.x + 10, r.y + 9, 26, node.type, st, o.iconHref);
    s += '<text x="' + (r.x + 44) + '" y="' + (r.y + 22) + '" font-size="13" font-weight="600" fill="' + st.text + '">' + esc(r.nameLines[0]) + '</text>';
    if (r.typeLabel) s += '<text x="' + (r.x + 44) + '" y="' + (r.y + 36) + '" font-size="10.5" fill="' + st.subtext + '">' + esc(r.typeLabel) + '</text>';
    const maxChars = Math.max(12, Math.floor((r.w - 30) / 6));
    r.attrs.forEach((a, i) => {
      s += '<text x="' + (r.x + 12) + '" y="' + (r.y + Layout.HEADER + 8 + i * Layout.LINE) + '" font-size="10.5" fill="' + st.subtext + '">' + esc(Layout.truncate(a.label + ': ' + a.value, maxChars)) + '</text>';
    });
    if (problems && !o.forExport) s += problemBadge(r.x + r.w - 12, r.y + 12, st, problems);
    if (selected && !o.forExport) {
      s += '<rect class="selection" x="' + (r.x - 3) + '" y="' + (r.y - 3) + '" width="' + (r.w + 6) + '" height="' + (r.h + 6) + '" rx="' + (st.radius + 2) + '" fill="none" stroke="' + st.selection + '" stroke-width="2"/>';
    }
    return s + '</g>';
  }

  function problemBadge(cx, cy, st, problems) {
    return '<g class="problem"><title>' + esc(problems.join('\n')) + '</title><circle cx="' + cx + '" cy="' + cy + '" r="8" fill="' + st.error + '"/><text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">!</text></g>';
  }

  function renderLeaf(project, r, st, o) {
    const node = project.nodes[r.id];
    const selected = o.selection && o.selection.nodes.has(r.id);
    const problems = o.problems && o.problems[r.id];
    const cx = r.x + r.w / 2;
    let s = '<g class="node leaf" data-node-id="' + esc(r.id) + '">' + tooltip(project, r);
    s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="' + st.radius + '" fill="' + (st.leafFill === 'none' && !o.forExport ? 'rgba(255,255,255,0.001)' : st.leafFill) + '" stroke="' + st.leafStroke + '" stroke-width="1"' + (st.shadow ? ' filter="url(#' + (o.idPrefix || '') + 'shadow)"' : '') + '/>';
    s += icon(cx - Layout.ICON / 2, r.y + 10, Layout.ICON, node.type, st, o.iconHref);
    let y = r.y + 10 + Layout.ICON + 8;
    r.nameLines.forEach((line) => {
      y += Layout.NAME_LINE;
      s += '<text x="' + cx + '" y="' + (y - 3) + '" text-anchor="middle" font-size="12" font-weight="600" fill="' + st.text + '">' + esc(line) + '</text>';
    });
    if (r.typeLabel) {
      y += Layout.LINE;
      s += '<text x="' + cx + '" y="' + (y - 2) + '" text-anchor="middle" font-size="10" fill="' + st.subtext + '">' + esc(Layout.truncate(r.typeLabel, 30)) + '</text>';
    }
    if (r.attrs.length) y += 4;
    r.attrs.forEach((a) => {
      y += Layout.LINE;
      s += '<text x="' + cx + '" y="' + (y - 2) + '" text-anchor="middle" font-size="10" fill="' + st.subtext + '">' + esc(Layout.truncate(a.label + ': ' + a.value, 30)) + '</text>';
    });
    if (problems && !o.forExport) s += problemBadge(r.x + r.w - 10, r.y + 10, st, problems);
    if (selected && !o.forExport) {
      s += '<rect class="selection" x="' + (r.x - 3) + '" y="' + (r.y - 3) + '" width="' + (r.w + 6) + '" height="' + (r.h + 6) + '" rx="' + (st.radius + 2) + '" fill="none" stroke="' + st.selection + '" stroke-width="2"/>';
    }
    return s + '</g>';
  }

  /** Resolve the rect used for a connection end (hidden containers have no rect of their own). */
  function endRect(geometry, id) {
    const r = geometry.rects[id];
    return r && !r.hidden && r.w ? r : null;
  }

  function renderConnection(project, c, geometry, st, o) {
    const a = endRect(geometry, c.from);
    const b = endRect(geometry, c.to);
    if (!a || !b) return '';
    const kind = Model.CONNECTION_KINDS.find((k) => k.id === c.kind) || Model.CONNECTION_KINDS[0];
    const path = connectorPath(a, b, project.settings.diagram.connector || 'orthogonal');
    const selected = o.selection && o.selection.conns.has(c.id);
    const color = selected ? st.selection : st.edge;
    const p = o.idPrefix || '';
    const noArrow = c.kind === 'network' || c.kind === 'association';
    const markerEnd = noArrow ? '' : ' marker-end="url(#' + p + (selected ? 'arrow-sel' : c.kind === 'dependency' ? 'arrow-open' : 'arrow') + ')"';
    const markerStart = c.kind === 'trigger' ? ' marker-start="url(#' + p + 'dot)"' : '';
    let s = '<g class="connection" data-conn-id="' + esc(c.id) + '">';
    const title = [kind.label, c.label, c.attributes && c.attributes.protocol].filter(Boolean).join(' \u2022 ');
    s += '<title>' + esc(title) + '</title>';
    if (!o.forExport) s += '<path d="' + path.d + '" fill="none" stroke="transparent" stroke-width="12" class="hit"/>';
    s += '<path d="' + path.d + '" fill="none" stroke="' + color + '" stroke-width="' + (selected ? 2.5 : 1.6) + '"' + (kind.dashed ? ' stroke-dasharray="6 4"' : '') + markerEnd + markerStart + '/>';
    const labelText = [c.label, c.attributes && c.attributes.protocol && c.attributes.protocol !== c.label ? c.attributes.protocol : ''].filter(Boolean).join(' \u00b7 ');
    if (labelText && project.settings.diagram.showConnectionLabels !== false) {
      const t = Layout.truncate(labelText, 40);
      const w = t.length * 5.8 + 10;
      s += '<rect x="' + (path.label.x - w / 2) + '" y="' + (path.label.y - 9) + '" width="' + w + '" height="16" rx="3" fill="' + st.edgeLabelBg + '" opacity="0.92"/>';
      s += '<text x="' + path.label.x + '" y="' + (path.label.y + 3) + '" text-anchor="middle" font-size="10" fill="' + st.edgeText + '">' + esc(t) + '</text>';
    }
    return s + '</g>';
  }

  /**
   * Render the diagram content (no <svg> wrapper).
   * @param {object} project
   * @param {object} [opts] { geometry, selection:{nodes:Set,conns:Set}, problems, iconHref(typeId),
   *                          forExport, dropTargetId, idPrefix }
   */
  function renderContent(project, opts) {
    const o = opts || {};
    const st = style(project.settings.diagram.style);
    const g = o.geometry || Layout.compute(project);
    const rects = Object.keys(g.rects).map((k) => g.rects[k]).filter((r) => !r.hidden && r.w);
    const containers = rects.filter((r) => r.container).sort((a, b) => a.depth - b.depth || project.nodes[a.id].seq - project.nodes[b.id].seq);
    const leaves = rects.filter((r) => !r.container).sort((a, b) => project.nodes[a.id].seq - project.nodes[b.id].seq);
    let s = '<g font-family="' + esc(st.font) + '">';
    containers.forEach((r) => { s += renderContainer(project, r, st, o); });
    Object.keys(project.connections).forEach((cid) => { s += renderConnection(project, project.connections[cid], g, st, o); });
    leaves.forEach((r) => { s += renderLeaf(project, r, st, o); });
    return s + '</g>';
  }

  /**
   * Render a complete, standalone SVG document (used by the exports).
   * @param {object} project
   * @param {object} [opts] { iconHref, margin, includeTitle }
   * @returns {{svg: string, width: number, height: number}}
   */
  function renderDocument(project, opts) {
    const o = Object.assign({ margin: 40 }, opts || {});
    const st = style(project.settings.diagram.style);
    const g = Layout.compute(project);
    const b = g.bounds;
    const showTitle = project.settings.diagram.showTitle !== false;
    const titleH = showTitle ? 54 : 0;
    const footerH = 24;
    const x0 = b.x - o.margin;
    const y0 = b.y - o.margin - titleH;
    const width = Math.ceil(b.w + o.margin * 2);
    const height = Math.ceil(b.h + o.margin * 2 + titleH + footerH);
    let s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + width + '" height="' + height + '" viewBox="' + x0 + ' ' + y0 + ' ' + width + ' ' + height + '">';
    s += defs(st, '');
    s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + width + '" height="' + height + '" fill="' + st.background + '"/>';
    if (st.grid && project.settings.diagram.style === 'blueprint') s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + width + '" height="' + height + '" fill="url(#grid)"/>';
    if (showTitle) {
      s += '<text x="' + (x0 + o.margin) + '" y="' + (y0 + o.margin) + '" font-family="' + esc(st.font) + '" font-size="20" font-weight="700" fill="' + st.text + '">' + esc(project.meta.name) + '</text>';
      const sub = [project.meta.description ? Layout.truncate(project.meta.description, 140) : '', 'Generated ' + new Date(project.meta.modified || Date.now()).toISOString().slice(0, 10)].filter(Boolean).join(' \u2014 ');
      s += '<text x="' + (x0 + o.margin) + '" y="' + (y0 + o.margin + 20) + '" font-family="' + esc(st.font) + '" font-size="11" fill="' + st.subtext + '">' + esc(sub) + '</text>';
    }
    s += renderContent(project, { geometry: g, iconHref: o.iconHref, forExport: true });
    s += '<text x="' + (x0 + width - 12) + '" y="' + (y0 + height - 10) + '" text-anchor="end" font-family="' + esc(st.font) + '" font-size="9" fill="' + st.subtext + '">' +
      esc('Made with AIS BluePrinter \u2022 Icons: MS Icons (msicons.com), \u00a9 Microsoft') + '</text>';
    s += '</svg>';
    return { svg: s, width, height };
  }

  AISBP.Render = { STYLES, CONNECTORS, style, center, borderPoint, connectorPath, defs, renderContent, renderDocument };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Render;
})(typeof globalThis !== 'undefined' ? globalThis : this);
