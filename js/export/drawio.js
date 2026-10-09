/**
 * AIS BluePrinter - draw.io (diagrams.net) export.
 *
 * Generates an uncompressed .drawio (mxfile) document that opens in draw.io / diagrams.net
 * (web, desktop and the VS Code extension):
 *  - containers (management groups, subscriptions, resource groups, parent resources) become
 *    draw.io containers, so moving them in draw.io moves their content,
 *  - resources become image shapes using the MS Icons icon (embedded when available,
 *    otherwise referenced by URL),
 *  - every attribute is attached as draw.io shape data (Edit > Edit Data),
 *  - connections become orthogonal edges with labels.
 *
 * @module AISBP.DrawIo
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('../core/catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('../core/model.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('../core/layout.js') : null);
  const Render = AISBP.Render || (typeof require === 'function' ? require('../render/svg.js') : null);

  const esc = Util.escapeXml;
  /** HTML escape (draw.io labels with html=1 are interpreted as HTML). */
  const html = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const RESERVED = new Set(['id', 'label', 'placeholders', 'tooltip', 'link', 'tags']);

  /** Convert an icon href to a value usable inside a draw.io style (no ';' allowed). */
  function styleImage(href) {
    if (!href) return '';
    const m = /^data:image\/svg\+xml;base64,(.*)$/.exec(href);
    if (m) return 'data:image/svg+xml,' + m[1];
    return href.replace(/;/g, '%3B');
  }

  /** Build the HTML label of a node. */
  function labelOf(r) {
    let s = '<b>' + html(r.name) + '</b>';
    if (r.typeLabel) s += '<br><font style="font-size:10px" color="#5d6670">' + html(r.typeLabel) + '</font>';
    r.attrs.forEach((a) => { s += '<br><font style="font-size:10px">' + html(a.label) + ': ' + html(a.value) + '</font>'; });
    return s;
  }

  /** draw.io <object> data attributes for a node. */
  function dataAttributes(project, node) {
    const def = Catalog.get(node.type);
    let s = ' azureType="' + esc(def ? def.label : node.type) + '"';
    if (def && def.provider) s += ' resourceProvider="' + esc(def.provider) + '"';
    Object.keys(node.attributes || {}).forEach((k) => {
      if (RESERVED.has(k) || !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k)) return;
      const v = node.attributes[k];
      if (v === '' || v === undefined || v === '(inherit)') return;
      s += ' ' + k + '="' + esc(v) + '"';
    });
    const links = Layout.networkLabel(project, node);
    if (links) s += ' network="' + esc(links) + '"';
    (node.custom || []).forEach((c) => {
      const key = 'custom_' + String(c.key).replace(/[^A-Za-z0-9_.-]/g, '_');
      if (c.key && /^[A-Za-z_]/.test(key)) s += ' ' + key + '="' + esc(c.value) + '"';
    });
    return s;
  }

  /**
   * Export a project to draw.io XML.
   * @param {object} project
   * @param {object} [opts] { iconHref(typeId) -> url|dataUri|null }
   * @returns {string} .drawio XML document
   */
  function toDrawio(project, opts) {
    const o = opts || {};
    const st = Render.style(project.settings.diagram.style);
    const g = Layout.compute(project);
    const ox = g.bounds.x - 40;
    const oy = g.bounds.y - 40;
    const cells = [];
    const cellId = (id) => 'n-' + id;
    const visibleParent = (node) => {
      let p = Model.getNode(project, node.parentId);
      while (p && g.rects[p.id] && g.rects[p.id].hidden) p = Model.getNode(project, p.parentId);
      return p && g.rects[p.id] ? p : null;
    };
    // Parents first, so that draw.io can resolve parent references.
    const ordered = Object.keys(g.rects)
      .map((k) => g.rects[k])
      .filter((r) => !r.hidden && r.w)
      .sort((a, b) => a.depth - b.depth || project.nodes[a.id].seq - project.nodes[b.id].seq);

    ordered.forEach((r) => {
      const node = project.nodes[r.id];
      const parent = visibleParent(node);
      const pr = parent ? g.rects[parent.id] : { x: ox, y: oy };
      const parentCell = parent ? cellId(parent.id) : '1';
      const img = styleImage(o.iconHref ? o.iconHref(node.type) : null);
      if (r.container) {
        const pal = st.containers[node.type] || st.containers.default;
        const style = 'rounded=1;arcSize=' + Math.min(10, st.radius) + ';absoluteArcSize=1;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;' +
          'verticalAlign=top;align=left;spacingLeft=44;spacingTop=4;fontSize=12;' +
          'fillColor=' + (pal.fill === 'none' || pal.fill.indexOf('rgba') === 0 ? 'none' : pal.fill) + ';strokeColor=' + pal.stroke + ';' + (pal.dash ? 'dashed=1;dashPattern=' + pal.dash + ';' : '') + 'fontColor=' + st.text + ';';
        cells.push('<object label="' + esc(labelOf(r)) + '" id="' + cellId(r.id) + '"' + dataAttributes(project, node) + '><mxCell style="' + esc(style) + '" vertex="1" parent="' + parentCell + '">' +
          '<mxGeometry x="' + (r.x - pr.x) + '" y="' + (r.y - pr.y) + '" width="' + r.w + '" height="' + r.h + '" as="geometry"/></mxCell></object>');
        if (img) {
          cells.push('<mxCell id="' + cellId(r.id) + '-icon" value="" style="' + esc('shape=image;html=1;aspect=fixed;imageAspect=0;image=' + img + ';') + '" vertex="1" connectable="0" parent="' + cellId(r.id) + '">' +
            '<mxGeometry x="10" y="9" width="26" height="26" as="geometry"/></mxCell>');
        }
      } else {
        const style = (img ? 'shape=image;image=' + img + ';imageAspect=0;aspect=fixed;' : 'rounded=1;whiteSpace=wrap;fillColor=#0078d4;fontColor=#ffffff;') +
          'html=1;verticalLabelPosition=bottom;verticalAlign=top;labelBackgroundColor=none;fontSize=12;fontColor=' + st.text + ';';
        const ix = r.x + r.w / 2 - Layout.ICON / 2;
        const iy = r.y + 10;
        cells.push('<object label="' + esc(labelOf(r)) + '" id="' + cellId(r.id) + '"' + dataAttributes(project, node) + '><mxCell style="' + esc(style) + '" vertex="1" parent="' + parentCell + '">' +
          '<mxGeometry x="' + (ix - pr.x) + '" y="' + (iy - pr.y) + '" width="' + Layout.ICON + '" height="' + Layout.ICON + '" as="geometry"/></mxCell></object>');
      }
    });

    Object.keys(project.connections).forEach((cid) => {
      const c = project.connections[cid];
      if (!g.rects[c.from] || !g.rects[c.to] || g.rects[c.from].hidden || g.rects[c.to].hidden) return;
      const kind = Model.CONNECTION_KINDS.find((k) => k.id === c.kind) || Model.CONNECTION_KINDS[0];
      const both = c.direction === 'bidirectional';
      const noArrow = !both && (c.kind === 'network' || c.kind === 'association');
      const edgeStyle = project.settings.diagram.connector === 'straight' ? '' : project.settings.diagram.connector === 'curved' ? 'curved=1;' : 'edgeStyle=orthogonalEdgeStyle;rounded=1;';
      const style = edgeStyle + 'html=1;strokeColor=' + st.edge + ';fontColor=' + st.edgeText + ';fontSize=10;' + (kind.dashed ? 'dashed=1;' : '') +
        (noArrow ? 'endArrow=none;' : c.kind === 'dependency' ? 'endArrow=open;endFill=0;' : 'endArrow=block;endFill=1;') +
        (both ? (c.kind === 'dependency' ? 'startArrow=open;startFill=0;' : 'startArrow=block;startFill=1;') : c.kind === 'trigger' ? 'startArrow=oval;startFill=1;' : '');
      const label = [c.label, c.attributes && c.attributes.protocol && c.attributes.protocol !== c.label ? c.attributes.protocol : ''].filter(Boolean).join(' \u00b7 ');
      cells.push('<object label="' + esc(html(label)) + '" id="e-' + esc(c.id) + '" connectionType="' + esc(kind.label) + '" direction="' + (both ? 'bidirectional' : 'forward') + '"' + (c.attributes && c.attributes.protocol ? ' protocol="' + esc(c.attributes.protocol) + '"' : '') + '>' +
        '<mxCell style="' + esc(style) + '" edge="1" parent="1" source="' + cellId(c.from) + '" target="' + cellId(c.to) + '"><mxGeometry relative="1" as="geometry"/></mxCell></object>');
    });

    const w = Math.ceil(g.bounds.w + 80);
    const h = Math.ceil(g.bounds.h + 80);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<mxfile host="AIS BluePrinter" agent="AIS BluePrinter" modified="' + esc(Util.now()) + '" version="24.0.0" type="device">' +
      '<diagram id="' + esc(project.meta.id) + '" name="' + esc(project.meta.name) + '">' +
      '<mxGraphModel dx="' + w + '" dy="' + h + '" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="' + w + '" pageHeight="' + h + '" background="' + st.background + '" math="0" shadow="0">' +
      '<root><mxCell id="0"/><mxCell id="1" parent="0"/>' + cells.join('') + '</root></mxGraphModel></diagram></mxfile>\n';
  }

  AISBP.DrawIo = { toDrawio, styleImage };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.DrawIo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
