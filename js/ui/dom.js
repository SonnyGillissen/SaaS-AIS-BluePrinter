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
   * @param {object} o { title, body: Node, buttons: [{label, primary, danger, action(close) -> false keeps open}], small, onClose }
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
        onclick: async () => {
          const keep = b.action ? await b.action(close) : undefined;
          if (keep !== false) close();
        }
      }));
    });
    dlg.appendChild(h('div', { class: 'dlg' },
      h('div', { class: 'dlg-head' }, h('h2', { text: o.title }), h('button', { type: 'button', class: 'btn small', 'aria-label': 'Close', text: '\u2715', onclick: close })),
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

  AISBP.Dom = { h, append, clear, icon, toast, download, readText, readDataUrl, modal, confirm, field, select };
})(typeof globalThis !== 'undefined' ? globalThis : this);
