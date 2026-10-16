/**
 * AIS BluePrinter - icon resolution (MS Icons).
 *
 * All resource icons come from MS Icons (https://msicons.com), a community project by
 * Daniel Bradley that publishes the official Microsoft architecture icons. Icons are
 * referenced by URL (default base: https://msicons.com/icons/). The base URL can be changed
 * in the options, for example to a local mirror created with `node tools/mirror-icons.js`
 * so the tool also works fully offline.
 *
 * For raster/PDF exports icons must be embedded (a canvas refuses to export cross-origin
 * images). `inlineAll()` downloads the icons once (CORS permitting) and caches them as data
 * URIs; icons that cannot be fetched are replaced by a neutral placeholder in the export.
 *
 * @module AISBP.Icons
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('../core/catalog.js') : null);

  const DEFAULT_BASE = 'https://msicons.com/icons/';
  const ATTRIBUTION = {
    name: 'MS Icons',
    url: 'https://msicons.com/',
    author: 'Daniel Bradley',
    repository: 'https://github.com/DanielBradley1/msicons',
    notice: 'Microsoft product icons are property of Microsoft and are used under the Microsoft icon terms of use.'
  };

  /** url -> data URI (string) or null when the icon could not be fetched. */
  const cache = new Map();
  const annotationPaths = {
    'annotation-text': 'M5 5h14M12 5v14M8 19h8',
    'annotation-markdown': 'M3 6h18v12H3zM6 15V9l3 3 3-3v6M17 9v6m-2-2 2 2 2-2',
    'annotation-table': 'M3 4h18v16H3zM3 9h18M3 14h18M9 4v16M15 4v16'
  };
  const annotationIcons = {};
  Object.keys(annotationPaths).forEach((type) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#eef4fb"/><path d="' + annotationPaths[type] + '" fill="none" stroke="#0a63c9" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const uri = 'data:image/svg+xml;base64,' + Util.toBase64(svg);
    annotationIcons[type] = uri;
    cache.set(uri, uri);
  });

  /** Normalize the configured base URL (falls back to msicons.com). */
  function baseUrl(project) {
    const b = project && project.settings && project.settings.icons && project.settings.icons.baseUrl;
    const v = b && Util.isSafeImageUrl(b) && !/^data:/i.test(b) ? b : DEFAULT_BASE;
    return v.endsWith('/') ? v : v + '/';
  }

  /** Icon URL for a resource type. */
  function url(project, typeId) {
    if (Object.prototype.hasOwnProperty.call(annotationIcons, typeId)) return annotationIcons[typeId];
    const def = Catalog.get(typeId);
    if (!def || !def.icon) return null;
    return baseUrl(project) + def.icon.split('/').map(encodeURIComponent).join('/');
  }

  /** Cached data URI for a URL (undefined = not tried yet, null = failed). */
  function cached(u) {
    return cache.get(u);
  }

  /** Fetch one icon and store it as data URI. */
  async function inline(u) {
    if (cache.has(u)) return cache.get(u);
    try {
      const res = await root.fetch(u, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!/<svg[\s>]/i.test(text)) throw new Error('Not an SVG');
      const dataUri = 'data:image/svg+xml;base64,' + Util.toBase64(text);
      cache.set(u, dataUri);
      return dataUri;
    } catch (e) {
      cache.set(u, null);
      return null;
    }
  }

  /** Inline the icons of every type used in the project. Resolves with the number of failures. */
  async function inlineAll(project) {
    const types = new Set(Object.keys(project.nodes).map((k) => project.nodes[k].type));
    const urls = Array.from(types).map((t) => url(project, t)).filter(Boolean);
    const results = await Promise.all(urls.map(inline));
    return results.filter((r) => !r).length;
  }

  /**
   * Returns an icon resolver for the renderer.
   * @param {object} project
   * @param {boolean} embedded true = only return embedded data URIs (exports), false = URLs (screen)
   */
  function resolver(project, embedded) {
    return function (typeId) {
      const u = url(project, typeId);
      if (!u) return null;
      if (!embedded) return u;
      return cache.get(u) || null;
    };
  }

  AISBP.Icons = { DEFAULT_BASE, ATTRIBUTION, baseUrl, url, cached, inline, inlineAll, resolver };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Icons;
})(typeof globalThis !== 'undefined' ? globalThis : this);
