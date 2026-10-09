/**
 * AIS BluePrinter - core utilities.
 *
 * Every script in this project is a classic (non-module) script that registers
 * itself on the global `AISBP` namespace. This keeps the application runnable
 * straight from the file system (file://), where browsers block ES modules,
 * while still allowing the pure modules to be loaded in Node.js for unit tests.
 *
 * @module AISBP.Util
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});

  /** Identifiers are restricted to a safe character set (also blocks "__proto__"). */
  const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

  /**
   * Generate a short, URL/XML-safe unique identifier.
   * @param {string} [prefix='n'] Leading characters (must start with a letter).
   * @returns {string}
   */
  function uid(prefix) {
    const p = prefix || 'n';
    let rnd = '';
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(8);
      root.crypto.getRandomValues(bytes);
      rnd = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } else {
      rnd = Math.random().toString(16).slice(2, 18).padEnd(16, '0');
    }
    return p + rnd;
  }

  /** @param {unknown} id @returns {boolean} true when the id is a safe identifier. */
  function isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  /**
   * Escape text for safe inclusion in XML/HTML/SVG markup (text and attributes).
   * @param {unknown} value
   * @returns {string}
   */
  function escapeXml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      // Strip control characters that are illegal in XML 1.0.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  /** Deep clone of JSON-compatible data. */
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  /**
   * Debounce a function call.
   * @param {Function} fn
   * @param {number} wait milliseconds
   */
  function debounce(fn, wait) {
    let timer = null;
    const debounced = function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(ctx, args), wait);
    };
    debounced.flush = function () {
      clearTimeout(timer);
      fn();
    };
    return debounced;
  }

  /** Clamp a number between min and max. */
  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /** Convert a UTF-8 string to base64 (works in browsers and Node.js). */
  function toBase64(text) {
    if (typeof root.Buffer !== 'undefined') {
      return root.Buffer.from(String(text), 'utf8').toString('base64');
    }
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return root.btoa(binary);
  }

  /**
   * Returns true for URLs that are safe to use as an image source:
   * http(s), protocol-relative, relative paths and raster/SVG data URIs.
   * @param {string} url
   */
  function isSafeImageUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    const u = url.trim();
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(u)) return true;
    if (/^https?:\/\//i.test(u)) return true;
    // Relative URL: must not contain a scheme (blocks javascript:, vbscript:, etc.).
    return !/^[a-z][a-z0-9+.-]*:/i.test(u);
  }

  /** Make a string safe to use as a file name. */
  function safeFileName(name, fallback) {
    const cleaned = String(name || '')
      .replace(/[^A-Za-z0-9 _.-]+/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return cleaned || fallback || 'ais-blueprint';
  }

  /** ISO timestamp helper (kept in one place so tests can stub it). */
  function now() {
    return new Date().toISOString();
  }

  AISBP.Util = {
    ID_PATTERN,
    uid,
    isValidId,
    escapeXml,
    clone,
    debounce,
    clamp,
    toBase64,
    isSafeImageUrl,
    safeFileName,
    now
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Util;
})(typeof globalThis !== 'undefined' ? globalThis : this);
