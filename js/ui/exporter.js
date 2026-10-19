/**
 * AIS BluePrinter - export actions (browser side).
 *
 * Wires the pure exporters (Package, DrawIo, ArchiMate, Render, Raster) to file downloads.
 * Icons are embedded as data URIs where possible so that exported files are self-contained;
 * when an icon cannot be fetched (offline, CORS) a placeholder tile is used for PNG/PDF and
 * the icon URL is referenced for SVG/draw.io.
 *
 * @module AISBP.Exporter
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { download, toast } = AISBP.Dom;
  const Util = AISBP.Util;

  function baseName(project) {
    return Util.safeFileName(project.meta.name, 'ais-blueprint');
  }

  /** Embedded icon when available, otherwise the URL (or null when `embeddedOnly`). */
  function iconResolver(project, embeddedOnly) {
    const embedded = AISBP.Icons.resolver(project, true);
    const remote = AISBP.Icons.resolver(project, false);
    return (typeId) => embedded(typeId) || (embeddedOnly ? null : remote(typeId));
  }

  async function prepareIcons(project) {
    const failed = await AISBP.Icons.inlineAll(project);
    if (failed) toast(failed + ' icon(s) could not be embedded (offline or blocked); placeholders/links are used instead.', 'info', 5000);
  }

  const MIME = {
    json: 'application/json',
    svg: 'image/svg+xml',
    drawio: 'application/vnd.jgraph.mxfile',
    xml: 'application/xml'
  };

  async function readImport(files) {
    const selected = Array.from(files || []);
    if (!selected.length || selected.length > 2) throw new Error('Choose one blueprint, or one ARM template and optionally its parameters JSON.');
    const parsed = await Promise.all(selected.map(async (file) => {
      if (!/\.json$/i.test(file.name) && file.type !== MIME.json) return null;
      if (file.size > AISBP.Embedded.MAX_JSON_BYTES) throw new Error('JSON file is too large.');
      return JSON.parse(await file.text());
    }));
    const templates = parsed.filter((value) => value && AISBP.Infrastructure.isTemplate(value));
    if (templates.length === 1) {
      const parameters = parsed.filter((value) => value !== templates[0]);
      if (parameters.length && (!parameters[0] || !parameters[0].parameters || parameters[0].resources)) {
        throw new Error('The second file must be an ARM deployment parameters JSON file.');
      }
      return AISBP.Infrastructure.importTemplate(templates[0], parameters[0]);
    }
    if (selected.length !== 1) throw new Error('Select exactly one ARM template with its optional parameters JSON.');
    if (parsed[0] && parsed[0].parameters && !parsed[0].format) {
      throw new Error('Select the ARM template together with its parameters file.');
    }
    return AISBP.Embedded.fromFile(selected[0]);
  }

  function infrastructureFiles(format, project, name) {
    const result = AISBP.Infrastructure.exportProject(project, format, { baseName: name });
    const { h, modal } = AISBP.Dom;
    modal({
      title: 'Export ' + (format === 'arm' ? 'ARM' : 'Bicep') + ' infrastructure',
      body: h('div', {},
        h('p', { text: 'Review the notes before downloading. Each resource group has separate deployment files. Deploy to the matching existing subscription and resource group; hierarchy containers are not provisioned.' }),
        h('p', { text: 'Download every file for the desired group into the same folder. Edit the parameter file, supply required values, and validate with Azure tooling before deployment. No diagram metadata is embedded.' }),
        h('ul', {}, result.warnings.map((note) => h('li', { text: note }))),
        result.files.length ? h('div', {}, result.files.map((file) => h('p', {}, h('button', {
          type: 'button', class: 'btn', 'data-icon': 'export', text: file.name,
          onclick: () => download(file.content, file.name, file.mime)
        })))) : h('p', { text: 'No supported resources to export.' }))
    });
  }

  /**
   * Run an export.
   * @param {string} format json | arm | bicep | svg | png | pdf | drawio | archimate
   * @param {object} project
   * @param {object} [opts] { embedDiagram: boolean, background: '#RRGGBB'|'transparent' }
   */
  async function run(format, project, opts) {
    const o = opts || {};
    const embedDiagram = AISBP.Embedded.enabled(o);
    const background = ['svg', 'png', 'pdf', 'drawio'].includes(format) ?
      AISBP.Render.background(o.background, AISBP.Render.style(project.settings.diagram.style).background, format !== 'pdf') : undefined;
    project = Util.clone(project);
    const name = baseName(project);
    switch (format) {
      case 'arm':
      case 'bicep':
        infrastructureFiles(format, project, name);
        break;
      case 'json':
        download(AISBP.Package.toJson(project), name + '.aisbp.json', MIME.json);
        break;
      case 'svg': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, false), background });
        download('<?xml version="1.0" encoding="UTF-8"?>\n' + AISBP.Embedded.toSvg(doc.svg, project, { embedDiagram }), name + '.svg', MIME.svg);
        break;
      }
      case 'png': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, true), background });
        download(await AISBP.Raster.toPng(doc.svg, doc.width, doc.height, background, { project, embedDiagram }), name + '.png');
        break;
      }
      case 'pdf': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, true), background });
        const blob = await AISBP.Raster.toPdf(doc.svg, doc.width, doc.height, {
          pageSize: project.settings.diagram.pdfPageSize,
          title: project.meta.name,
          author: project.meta.author,
          background,
          project,
          embedDiagram
        });
        download(blob, name + '.pdf');
        break;
      }
      case 'drawio': {
        await prepareIcons(project);
        download(AISBP.DrawIo.toDrawio(project, { iconHref: iconResolver(project, false), embedDiagram, background }), name + '.drawio', MIME.drawio);
        break;
      }
      case 'archimate':
        download(AISBP.ArchiMate.toArchiMate(project, { embedDiagram }), name + '.archimate.xml', MIME.xml);
        break;
      default:
        throw new Error('Unknown export format: ' + format);
    }
  }

  AISBP.Exporter = { run, iconResolver, readImport };
})(typeof globalThis !== 'undefined' ? globalThis : this);
