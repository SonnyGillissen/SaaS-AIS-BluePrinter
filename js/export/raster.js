/**
 * AIS BluePrinter - raster (PNG) and PDF export.
 *
 * No third-party libraries: the SVG produced by the renderer is drawn onto an HTML canvas
 * (PNG), and the PDF is written by a tiny PDF 1.4 writer that embeds the diagram as a JPEG
 * image (DCTDecode). Icons must be embedded in the SVG beforehand (see AISBP.Icons.inlineAll)
 * because browsers do not allow exporting canvases that contain cross-origin images.
 *
 * @module AISBP.Raster
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Embedded = AISBP.Embedded || (typeof require === 'function' ? require('./embedded.js') : null);
  const Render = AISBP.Render || (typeof require === 'function' ? require('../render/svg.js') : null);

  /** PDF page sizes in points (1/72 inch), portrait orientation. */
  const PAGE_SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55], Letter: [612, 792] };

  /** Encode a (unicode) string as a PDF hex string in UTF-16BE with BOM. */
  function pdfText(s) {
    let hex = 'FEFF';
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
    return '<' + hex + '>';
  }

  /** PDF date string (D:YYYYMMDDHHmmSSZ). */
  function pdfDate(d) {
    const iso = (d || new Date()).toISOString();
    return 'D:' + iso.slice(0, 19).replace(/[-:T]/g, '') + 'Z';
  }

  /**
   * Build a single-page PDF that shows a JPEG image.
   * @param {Uint8Array} jpeg JPEG file bytes
   * @param {number} imgW image width in pixels
   * @param {number} imgH image height in pixels
   * @param {object} [opts] { pageSize: 'fit'|'A4'|'A3'|'Letter', logicalWidth, logicalHeight, title, author }
   * @returns {Uint8Array} PDF file bytes
   */
  function buildPdf(jpeg, imgW, imgH, opts) {
    const o = opts || {};
    const bg = Render.background(o.background, '#ffffff', false);
    const config = o.project && Embedded.enabled(o) ? Embedded.payload(o.project) : null;
    const lw = o.logicalWidth || imgW;
    const lh = o.logicalHeight || imgH;
    let pageW;
    let pageH;
    let drawW;
    let drawH;
    let offX = 0;
    let offY = 0;
    if (PAGE_SIZES[o.pageSize]) {
      const landscape = lw >= lh;
      const size = PAGE_SIZES[o.pageSize];
      pageW = landscape ? size[1] : size[0];
      pageH = landscape ? size[0] : size[1];
      const margin = 28;
      const scale = Math.min((pageW - margin * 2) / lw, (pageH - margin * 2) / lh);
      drawW = lw * scale;
      drawH = lh * scale;
      offX = (pageW - drawW) / 2;
      offY = (pageH - drawH) / 2;
    } else {
      // "fit": 96 dpi CSS pixels -> 72 dpi PDF points
      pageW = drawW = lw * 0.75;
      pageH = drawH = lh * 0.75;
    }
    const f = (n) => (Math.round(n * 100) / 100).toString();
    const rgb = [1, 3, 5].map((i) => (parseInt(bg.slice(i, i + 2), 16) / 255).toFixed(6)).join(' ');
    const content = 'q ' + rgb + ' rg 0 0 ' + f(pageW) + ' ' + f(pageH) + ' re f Q\n' +
      'q ' + f(drawW) + ' 0 0 ' + f(drawH) + ' ' + f(offX) + ' ' + f(offY) + ' cm /Im0 Do Q';

    const enc = new TextEncoder();
    const chunks = [];
    let length = 0;
    const offsets = [];
    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const obj = (n, body) => {
      offsets[n] = length;
      push(n + ' 0 obj\n');
      body.forEach(push);
      push('\nendobj\n');
    };

    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
    obj(1, ['<< /Type /Catalog /Pages 2 0 R' + (config ? ' /Names << /EmbeddedFiles << /Names [(blueprint.aisbp.json) 8 0 R] >> >>' : '') + ' >>']);
    obj(2, ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']);
    obj(3, ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(pageW) + ' ' + f(pageH) + '] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>']);
    obj(4, ['<< /Type /XObject /Subtype /Image /Width ' + imgW + ' /Height ' + imgH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n', jpeg, '\nendstream']);
    obj(5, ['<< /Length ' + enc.encode(content).length + ' >>\nstream\n' + content + '\nendstream']);
    obj(6, ['<< /Title ' + pdfText(o.title || 'AIS BluePrinter diagram') + ' /Author ' + pdfText(o.author || '') + ' /Creator ' + pdfText('AIS BluePrinter') + ' /Producer ' + pdfText('AIS BluePrinter') + ' /CreationDate (' + pdfDate() + ') >>']);
    if (config) {
      obj(7, ['<< /Type /EmbeddedFile /Subtype /application#2Fjson /AISBPConfig true /AISBPCRC (' + Embedded.checksum(config) + ') /Length ' + config.length + ' >>\nstream\n', config, '\nendstream']);
      obj(8, ['<< /Type /Filespec /F (blueprint.aisbp.json) /UF ' + pdfText('blueprint.aisbp.json') + ' /Desc ' + pdfText('Complete AIS BluePrinter configuration') + ' /EF << /F 7 0 R >> >>']);
    }
    const count = config ? 9 : 7;
    const xrefOffset = length;
    let xref = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
    for (let i = 1; i < count; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(xref + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    const out = new Uint8Array(length);
    let pos = 0;
    chunks.forEach((c) => { out.set(c, pos); pos += c.length; });
    return out;
  }

  /** Pick a render scale that keeps the canvas within browser limits. */
  function safeScale(width, height, preferred) {
    const maxSide = 16000;
    const maxArea = 120e6;
    return Math.max(0.1, Math.min(preferred || 2, maxSide / width, maxSide / height, Math.sqrt(maxArea / (width * height))));
  }

  /**
   * Draw an SVG document on a canvas.
   * @returns {Promise<HTMLCanvasElement>}
   */
  function svgToCanvas(svg, width, height, scale, background) {
    return new Promise((resolve, reject) => {
      const bg = Render.background(background, '#ffffff');
      const s = safeScale(width, height, scale);
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(width * s);
          canvas.height = Math.round(height * s);
          const ctx = canvas.getContext('2d');
          if (bg !== 'transparent') {
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas);
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The diagram could not be rendered as an image.'));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed.'))), type, quality);
    });
  }

  /** Render an SVG document to a PNG blob. */
  async function toPng(svg, width, height, background, opts) {
    const canvas = await svgToCanvas(svg, width, height, 2, background);
    const blob = await canvasToBlob(canvas, 'image/png');
    if (!opts || !opts.project || !Embedded.enabled(opts)) return blob;
    return new Blob([Embedded.toPng(new Uint8Array(await blob.arrayBuffer()), opts.project, opts)], { type: 'image/png' });
  }

  /** Render an SVG document to a PDF blob. */
  async function toPdf(svg, width, height, opts) {
    const o = opts || {};
    const background = Render.background(o.background, '#ffffff', false);
    const canvas = await svgToCanvas(svg, width, height, 2, background);
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
    const pdf = buildPdf(jpeg, canvas.width, canvas.height, { pageSize: o.pageSize, logicalWidth: width, logicalHeight: height, title: o.title, author: o.author, background, project: o.project, embedDiagram: o.embedDiagram });
    return new Blob([pdf], { type: 'application/pdf' });
  }

  AISBP.Raster = { PAGE_SIZES, pdfText, buildPdf, safeScale, svgToCanvas, toPng, toPdf };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Raster;
})(typeof globalThis !== 'undefined' ? globalThis : this);
