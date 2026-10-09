/**
 * AIS BluePrinter - colour theme (light / dark mode) of the application.
 *
 * Loaded in <head> (before the page is painted) so the right theme is applied without a flash.
 * The chosen mode is cached in localStorage ('aisbp.prefs' -> theme); in server mode the app
 * additionally stores it in the database (see js/app.js).
 *
 * Modes:
 *   'system' (default) - follow the operating system (prefers-color-scheme), also when it changes
 *   'light' / 'dark'   - always use that theme
 *
 * The effective theme is written to <html data-theme="light|dark">; css/app.css defines the palette.
 * Only the application chrome is themed - the diagram keeps its own display style.
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const MODES = ['system', 'light', 'dark'];
  const PREFS_KEY = 'aisbp.prefs';
  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = [];
  let mode = 'system';

  function readPrefs() {
    try {
      const p = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}');
      return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    } catch (e) {
      return {};
    }
  }

  function writeMode(value) {
    try {
      const p = readPrefs();
      p.theme = value;
      root.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch (e) {
      /* storage unavailable (private mode, quota): the theme still applies for this session */
    }
  }

  /** The theme actually shown: 'light' or 'dark'. */
  function effective() {
    if (mode === 'light' || mode === 'dark') return mode;
    return media && media.matches ? 'dark' : 'light';
  }

  function apply() {
    const doc = root.document && root.document.documentElement;
    if (doc) doc.setAttribute('data-theme', effective());
    listeners.forEach((fn) => fn(mode, effective()));
  }

  /**
   * Change the mode, apply it and cache it locally.
   * @param {string} value 'system' | 'light' | 'dark' (anything else falls back to 'system')
   */
  function set(value) {
    mode = MODES.indexOf(value) === -1 ? 'system' : value;
    writeMode(mode);
    apply();
    return mode;
  }

  function get() {
    return mode;
  }

  /** Register a callback (mode, effectiveTheme) called whenever the theme changes. */
  function onChange(fn) {
    listeners.push(fn);
  }

  if (media) {
    const onSystemChange = () => {
      if (mode === 'system') apply();
    };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  const cached = readPrefs().theme;
  mode = MODES.indexOf(cached) === -1 ? 'system' : cached;
  apply();

  AISBP.Theme = { MODES, get, set, effective, onChange };
})(typeof window !== 'undefined' ? window : globalThis);
