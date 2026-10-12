/**
 * AIS BluePrinter - DOM helpers used by the UI modules.
 *
 * `h()` builds elements without innerHTML, so user supplied text can never inject markup.
 *
 * @module AISBP.Dom
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const doc = root.document;

  const ACTION_PATHS = {
    new: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M12 12v6 M9 15h6',
    open: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2 M3 7h5l2 3h11l-3 10H3L1 7Z',
    import: 'M12 3v12 M7 10l5 5 5-5 M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    export: 'M12 15V3 M7 8l5-5 5 5 M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
    cloud: 'M7 18H6a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 0 10h-1 M12 11v10 M9 18l3 3 3-3',
    undo: 'M3 10h11a6 6 0 0 1 0 12 M7 6l-4 4 4 4',
    redo: 'M21 10H10a6 6 0 0 0 0 12 M17 6l4 4-4 4',
    copy: 'M9 9h12v12H9Z M15 5V3H3v12h2',
    paste: 'M9 3h6v4H9Z M9 5H5v16h14V5h-4',
    delete: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    'zoom-out': 'M21 21l-5-5 M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M7 11h8',
    'zoom-in': 'M21 21l-5-5 M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M7 11h8 M11 7v8',
    fit: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5',
    tidy: 'M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z',
    settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
    code: 'M8 5l-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18',
    image: 'M3 3h18v18H3Z M3 17l6-6 4 4 3-3 5 5 M15 7h.01',
    document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z M14 2v6h6 M8 13h8 M8 17h6',
    diagram: 'M9 3h6v6H9Z M3 15h6v6H3Z M15 15h6v6h-6Z M12 9v3 M6 15v-3h12v3',
    close: 'M6 6l12 12 M18 6 6 18',
    check: 'M4 12l5 5L20 6',
    save: 'M3 3h15l3 3v15H3Z M7 3v6h10V3 M7 21v-8h10v8',
    edit: 'M15 5l4 4 M4 20l4-1L21 6l-3-3L5 16l-1 4Z',
    reset: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6',
    reverse: 'M4 7h16 M16 3l4 4-4 4 M20 17H4 M8 13l-4 4 4 4',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    'eye-off': 'M3 3l18 18 M9 5a12 12 0 0 1 3 0c6 0 10 7 10 7a20 20 0 0 1-3 4 M6 6a20 20 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1 M10 10a3 3 0 0 0 4 4'
  };

  /** Decorative, local SVGs inherit the control colour in both themes. */
  function decorateAction(el) {
    const name = el.getAttribute('data-icon');
    if (!Object.prototype.hasOwnProperty.call(ACTION_PATHS, name) || el.querySelector('.action-icon')) return el;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const attrs = { class: 'action-icon', viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
    Object.keys(attrs).forEach((key) => svg.setAttribute(key, attrs[key]));
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ACTION_PATHS[name]);
    svg.appendChild(path);
    el.insertBefore(svg, el.firstChild);
    return el;
  }

  /**
   * Create an element.
   * @param {string} tag
   * @param {object} [attrs] attributes; `class`, `text`, `style` (object), `on<Event>` handlers,
   *                         boolean values toggle attributes, `value`/`checked` set properties.
   * @param {...(Node|string|Array|null)} children
   */
  function h(tag, attrs) {
    const el = doc.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach((key) => {
      const v = a[key];
      if (v === undefined || v === null || v === false) return;
      if (key === 'class') el.className = v;
      else if (key === 'text') el.textContent = v;
      else if (key === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (key.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(key.slice(2).toLowerCase(), v);
      else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'indeterminate') el[key] = v;
      else el.setAttribute(key, v === true ? '' : String(v));
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    if (a['data-icon']) decorateAction(el);
    return el;
  }

  function append(el, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) child.forEach((c) => append(el, c));
    else el.appendChild(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
  }

  /** Remove all children of an element. */
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /** Icon <img> for a resource type with a text placeholder fallback when it fails to load. */
  function icon(project, typeId, size) {
    const def = AISBP.Catalog.get(typeId);
    const ph = () => h('span', { class: 'ph', 'aria-hidden': 'true', text: (def ? def.abbr : '?').slice(0, 4).toUpperCase() });
    const url = AISBP.Icons.url(project, typeId);
    if (!url) return ph();
    const img = h('img', { src: url, alt: '', width: size || 24, height: size || 24, loading: 'lazy', draggable: 'false' });
    img.addEventListener('error', () => { if (img.parentNode) img.parentNode.replaceChild(ph(), img); }, { once: true });
    return img;
  }

  /** Show a short notification. kind: 'info' | 'success' | 'error' */
  function toast(message, kind, ms) {
    const host = doc.getElementById('toasts');
    if (!host) return;
    const el = h('div', { class: 'toast ' + (kind || 'info'), text: message });
    host.appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'error' ? 6000 : 3000));
  }

  /** Download a Blob or string as a file. */
  function download(data, filename, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    doc.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  /** Read a File as text. */
  function readText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
      reader.readAsText(file);
    });
  }

  /** Read a File as data URI. */
  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('The file could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Open a modal dialog.
   * @param {object} o { title, body: Node, buttons: [{label, icon, primary, danger, action(close) -> false keeps open}], small, onClose }
   * @returns {{dialog: HTMLDialogElement, close: function}}
   */
  function modal(o) {
    const dlg = h('dialog', { class: o.small ? 'small' : '', 'aria-label': o.title });
    const close = () => {
      if (dlg.open) dlg.close();
    };
    const foot = h('div', { class: 'dlg-foot' });
    (o.buttons || [{ label: 'Close', primary: true }]).forEach((b) => {
      foot.appendChild(h('button', {
        type: 'button',
        class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
        text: b.label,
        'data-icon': b.icon || ({ Save: 'save', Cancel: 'close', Close: 'close', OK: 'check', Delete: 'delete', Export: 'export' })[b.label],
        onclick: async () => {
          const keep = b.action ? await b.action(close) : undefined;
          if (keep !== false) close();
        }
      }));
    });
    dlg.appendChild(h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' }, h('h2', { text: o.title }), h('button', { type: 'button', class: 'btn small', 'aria-label': 'Close', 'data-icon': 'close', 'data-icon-only': true, onclick: close })),
      h('div', { class: 'dlg-body' }, o.body),
      foot));
    dlg.addEventListener('close', () => {
      if (o.onClose) o.onClose();
      dlg.remove();
    });
    doc.body.appendChild(dlg);
    dlg.showModal();
    return { dialog: dlg, close };
  }

  /** Promise-based confirmation dialog. */
  function confirm(title, message, okLabel) {
    return new Promise((resolve) => {
      let result = false;
      modal({
        title,
        small: true,
        body: h('p', { text: message }),
        buttons: [
          { label: 'Cancel' },
          { label: okLabel || 'OK', primary: true, action: () => { result = true; } }
        ],
        onClose: () => resolve(result)
      });
    });
  }

  /**
   * Build a labelled form field.
   * @param {string} label
   * @param {HTMLElement} control
   * @param {object} [o] { help, eye: HTMLElement, check: boolean }
   */
  function field(label, control, o) {
    const opts = o || {};
    const id = control.id || 'f-' + Math.random().toString(36).slice(2, 9);
    control.id = id;
    if (opts.check) {
      return h('div', { class: 'field check' }, control, h('label', { for: id, text: label }), opts.eye || null, opts.help ? h('div', { class: 'help', text: opts.help }) : null);
    }
    return h('div', { class: 'field' + (opts.eye ? ' with-eye' : '') }, h('label', { for: id, text: label }), control, opts.eye || null, opts.help ? h('div', { class: 'help', text: opts.help }) : null);
  }

  /** <select> from [{value,label}] or [string]. */
  function select(options, value, attrs) {
    const el = h('select', attrs || {});
    options.forEach((opt) => {
      const o = typeof opt === 'string' ? { value: opt, label: opt || '\u2014' } : opt;
      el.appendChild(h('option', { value: o.value, text: o.label, selected: String(o.value) === String(value) }));
    });
    el.value = value === undefined || value === null ? '' : String(value);
    return el;
  }

  doc.querySelectorAll('[data-icon]').forEach(decorateAction);
  AISBP.Dom = { h, append, clear, icon, decorateAction, toast, download, readText, readDataUrl, modal, confirm, field, select };
})(typeof globalThis !== 'undefined' ? globalThis : this);
