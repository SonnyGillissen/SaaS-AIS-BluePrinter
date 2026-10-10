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

  /**
   * Run an export.
   * @param {string} format json | svg | png | pdf | drawio | archimate
   * @param {object} project
   */
  async function run(format, project) {
    const name = baseName(project);
    switch (format) {
      case 'json':
        download(AISBP.Package.toJson(project), name + '.aisbp.json', MIME.json);
        break;
      case 'svg': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, false) });
        download('<?xml version="1.0" encoding="UTF-8"?>\n' + doc.svg, name + '.svg', MIME.svg);
        break;
      }
      case 'png': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, true) });
        const st = AISBP.Render.style(project.settings.diagram.style);
        download(await AISBP.Raster.toPng(doc.svg, doc.width, doc.height, st.background), name + '.png');
        break;
      }
      case 'pdf': {
        await prepareIcons(project);
        const doc = AISBP.Render.renderDocument(project, { iconHref: iconResolver(project, true) });
        const st = AISBP.Render.style(project.settings.diagram.style);
        const blob = await AISBP.Raster.toPdf(doc.svg, doc.width, doc.height, {
          pageSize: project.settings.diagram.pdfPageSize,
          title: project.meta.name,
          author: project.meta.author,
          background: st.background
        });
        download(blob, name + '.pdf');
        break;
      }
      case 'drawio': {
        await prepareIcons(project);
        download(AISBP.DrawIo.toDrawio(project, { iconHref: iconResolver(project, false) }), name + '.drawio', MIME.drawio);
        break;
      }
      case 'archimate':
        download(AISBP.ArchiMate.toArchiMate(project), name + '.archimate.xml', MIME.xml);
        break;
      default:
        throw new Error('Unknown export format: ' + format);
    }
  }

  AISBP.Exporter = { run, iconResolver };
})(typeof globalThis !== 'undefined' ? globalThis : this);
