/**
 * AIS BluePrinter - icon resolution (MS Icons and built-in logos).
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
  const githubMark = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
  const actionMark = 'M10.984 13.836a.5.5 0 0 1-.353-.146l-.745-.743a.5.5 0 1 1 .706-.708l.392.391 1.181-1.18a.5.5 0 0 1 .708.707l-1.535 1.533a.504.504 0 0 1-.354.146zm9.353-.147l1.534-1.532a.5.5 0 0 0-.707-.707l-1.181 1.18-.392-.391a.5.5 0 1 0-.706.708l.746.743a.497.497 0 0 0 .706-.001zM4.527 7.452l2.557-1.585A1 1 0 0 0 7.09 4.17L4.533 2.56A1 1 0 0 0 3 3.406v3.196a1.001 1.001 0 0 0 1.527.85zm2.03-2.436L4 6.602V3.406l2.557 1.61zM24 12.5c0 1.93-1.57 3.5-3.5 3.5a3.503 3.503 0 0 1-3.46-3h-2.08a3.503 3.503 0 0 1-3.46 3 3.502 3.502 0 0 1-3.46-3h-.558c-.972 0-1.85-.399-2.482-1.042V17c0 1.654 1.346 3 3 3h.04c.244-1.693 1.7-3 3.46-3 1.93 0 3.5 1.57 3.5 3.5S13.43 24 11.5 24a3.502 3.502 0 0 1-3.46-3H8c-2.206 0-4-1.794-4-4V9.899A5.008 5.008 0 0 1 0 5c0-2.757 2.243-5 5-5s5 2.243 5 5a5.005 5.005 0 0 1-4.952 4.998A2.482 2.482 0 0 0 7.482 12h.558c.244-1.693 1.7-3 3.46-3a3.502 3.502 0 0 1 3.46 3h2.08a3.503 3.503 0 0 1 3.46-3c1.93 0 3.5 1.57 3.5 3.5zm-15 8c0 1.378 1.122 2.5 2.5 2.5s2.5-1.122 2.5-2.5-1.122-2.5-2.5-2.5S9 19.122 9 20.5zM5 9c2.206 0 4-1.794 4-4S7.206 1 5 1 1 2.794 1 5s1.794 4 4 4zm9 3.5c0-1.378-1.122-2.5-2.5-2.5S9 11.122 9 12.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5zm9 0c0-1.378-1.122-2.5-2.5-2.5S18 11.122 18 12.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5zm-13 8a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0zm2 0a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0zm12 0c0 1.93-1.57 3.5-3.5 3.5a3.503 3.503 0 0 1-3.46-3.002c-.007.001-.013.005-.021.005l-.506.017h-.017a.5.5 0 0 1-.016-.999l.506-.017c.018-.002.035.006.052.007A3.503 3.503 0 0 1 20.5 17c1.93 0 3.5 1.57 3.5 3.5zm-1 0c0-1.378-1.122-2.5-2.5-2.5S18 19.122 18 20.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5z';
  const customIconSvgs = {
    'azure-devops': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><defs><linearGradient id="a" x1="9" y1="16.97" x2="9" y2="1.03" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0078d4"/><stop offset=".16" stop-color="#1380da"/><stop offset=".53" stop-color="#3c91e5"/><stop offset=".82" stop-color="#559cec"/><stop offset="1" stop-color="#5ea0ef"/></linearGradient></defs><path d="M17 4v9.74l-4 3.28-6.2-2.26V17l-3.51-4.59 10.23.8V4.44zm-3.41.49L7.85 1v2.29L2.58 4.84 1 6.87v4.61l2.26 1V6.57z" fill="url(#a)"/></svg>',
    github: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path d="' + githubMark + '" fill="#24292f"/></svg>',
    'github-enterprise': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path d="' + githubMark + '" fill="#24292f"/></svg>',
    'github-actions': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="' + actionMark + '" fill="#2088ff"/></svg>',
    'azure-devops-project': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4zM8 8h8v8H8z" fill="none" stroke="#0078d4" stroke-width="2"/></svg>',
    'azure-devops-pipeline': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 5h5v5H5zM14 14h5v5h-5zM5 14h5v5H5zM10 7.5h3a2 2 0 0 1 2 2V14M10 16.5h4" fill="none" stroke="#0078d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    'azure-devops-repository': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 4h12v16H6zM9 4v5l3-2 3 2V4M9 13h6M9 16h6" fill="none" stroke="#0078d4" stroke-width="2" stroke-linejoin="round"/></svg>',
    'azure-devops-boards': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#0078d4" stroke-width="2"/><path d="M3 9h18M9 9v11m6-11v11" fill="none" stroke="#0078d4" stroke-width="2"/></svg>',
    'azure-devops-artifacts': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5" fill="none" stroke="#0078d4" stroke-width="2" stroke-linejoin="round"/></svg>',
    'github-organization': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 20V9l9-6 9 6v11h-6v-7H9v7zM2 9l10-7 10 7" fill="none" stroke="#24292f" stroke-width="2" stroke-linejoin="round"/></svg>',
    'github-repository': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 4h12v16H6zM9 4v5l3-2 3 2V4M9 13h6M9 16h6" fill="none" stroke="#24292f" stroke-width="2" stroke-linejoin="round"/></svg>',
    'github-package': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5" fill="none" stroke="#24292f" stroke-width="2" stroke-linejoin="round"/></svg>'
  };
  Object.keys(customIconSvgs).forEach((type) => {
    const uri = 'data:image/svg+xml;base64,' + Util.toBase64(customIconSvgs[type]);
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
