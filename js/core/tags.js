/**
 * AIS BluePrinter - tags.
 *
 * Azure tags (name/value pairs) on every object of the blueprint: management groups,
 * subscriptions, resource groups and resources. Tags are stored per node as an ordered list
 * `node.tags = [{ key, value }]`. The *Tag Manager* (Options > Tags) keeps project-wide tag
 * definitions in `settings.tags.definitions = [{ key, values: [..], color, show }]` that
 * provide suggestions, a colour on the diagram and a "show on diagram" switch, and it can
 * assign / rename / remove a tag on many objects at once.
 *
 * Azure limits (https://learn.microsoft.com/azure/azure-resource-manager/management/tag-resources#limitations):
 * at most 50 tags per object, tag names up to 512 characters (case-insensitive) without
 * < > % & \ ? /, and values up to 256 characters.
 *
 * Pure functions without DOM access, so they run in the browser and in Node (tests).
 *
 * @module AISBP.Tags
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('./catalog.js') : null);

  const MAX_TAGS = 50;
  const MAX_KEY = 512;
  const MAX_VALUE = 256;
  const MAX_DEFINITIONS = 200;
  const MAX_SUGGESTIONS = 50;
  const INVALID_KEY = /[<>%&\\?/]/;

  /** Colours used for tags without a defined colour (picked by a hash of the key). */
  const PALETTE = ['#0078d4', '#8661c5', '#107c10', '#d83b01', '#008575', '#c239b3', '#986f0b', '#e3008c', '#4f6bed', '#5c2e91', '#0f6cbd', '#a4262c'];

  /** Bulk-assignment scopes used by the Tag Manager. */
  const SCOPES = [
    { id: 'hierarchy', label: 'Azure tenants, management groups & subscriptions' },
    { id: 'resource-group', label: 'Resource groups' },
    { id: 'resource', label: 'Azure resources' },
    { id: 'other', label: 'External / generic objects' }
  ];

  /** Diagram chip metrics (shared by layout and renderer). */
  const CHIP = { h: 16, gap: 4, charW: 5.6, pad: 7, maxChars: 30, maxRows: 3 };

  const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max);
  const lower = (s) => String(s).toLowerCase();

  /**
   * Clean an untrusted tag list: trims, enforces the length limits, drops empty keys and
   * duplicates (tag names are case-insensitive in Azure; the first occurrence wins) and caps
   * the list at 50 entries.
   * @param {Array} list
   * @returns {{key:string,value:string}[]}
   */
  function sanitize(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((t) => {
      if (!t || typeof t !== 'object' || out.length >= MAX_TAGS) return;
      const key = str(t.key, MAX_KEY).trim();
      if (!key || seen.has(lower(key))) return;
      seen.add(lower(key));
      out.push({ key, value: str(t.value, MAX_VALUE).trim() });
    });
    return out;
  }

  /**
   * Parse the legacy "key=value per line" text (older blueprints stored tags as a text
   * attribute). "key: value" is accepted as well.
   * @param {string} text
   * @returns {{key:string,value:string}[]}
   */
  function parseText(text) {
    if (typeof text !== 'string') return [];
    return sanitize(text.split(/\r?\n/).map((line) => {
      const m = /^\s*([^=:]+?)\s*[=:]\s*(.*?)\s*$/.exec(line);
      return m ? { key: m[1], value: m[2] } : { key: line.trim(), value: '' };
    }));
  }

  /**
   * Validate the tags of one node against the Azure limits.
   * @returns {string[]} problems (empty when valid)
   */
  function validate(node) {
    const problems = [];
    const tags = (node && node.tags) || [];
    if (tags.length > MAX_TAGS) problems.push('More than ' + MAX_TAGS + ' tags (Azure limit).');
    const seen = new Set();
    tags.forEach((t) => {
      if (!t.key) return problems.push('A tag has an empty name.');
      if (INVALID_KEY.test(t.key)) problems.push('Tag "' + t.key + '" contains a character that is not allowed (< > % & \\ ? /).');
      if (t.key.length > MAX_KEY) problems.push('Tag "' + t.key.slice(0, 40) + '…" is longer than ' + MAX_KEY + ' characters.');
      if (String(t.value).length > MAX_VALUE) problems.push('The value of tag "' + t.key + '" is longer than ' + MAX_VALUE + ' characters.');
      if (seen.has(lower(t.key))) problems.push('Tag "' + t.key + '" is defined twice (tag names are case-insensitive).');
      seen.add(lower(t.key));
    });
    return problems;
  }

  /** Clean an untrusted list of tag definitions (Tag Manager). */
  function sanitizeDefinitions(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((d) => {
      if (!d || typeof d !== 'object' || out.length >= MAX_DEFINITIONS) return;
      const key = str(d.key, MAX_KEY).trim();
      if (!key || seen.has(lower(key))) return;
      seen.add(lower(key));
      const values = [];
      (Array.isArray(d.values) ? d.values : []).forEach((v) => {
        const s = str(v, MAX_VALUE).trim();
        if (s && values.indexOf(s) < 0 && values.length < MAX_SUGGESTIONS) values.push(s);
      });
      out.push({
        key,
        values,
        color: /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color.toLowerCase() : '',
        show: d.show !== false
      });
    });
    return out;
  }

  /** Bulk-assignment scope of a node type ('hierarchy' | 'resource-group' | 'resource' | 'other'). */
  function scopeOf(type) {
    const def = Catalog.get(type);
    if (!def) return 'other';
    if (type === 'resource-group') return 'resource-group';
    if (def.category === 'hierarchy') return 'hierarchy';
    return def.azure === false ? 'other' : 'resource';
  }

  const allNodes = (project) => Object.keys(project.nodes).map((k) => project.nodes[k]);
  const indexOf = (tags, key) => (tags || []).findIndex((t) => lower(t.key) === lower(key));

  /** Definitions of a project (always an array). */
  function definitions(project) {
    const t = project && project.settings && project.settings.tags;
    return t && Array.isArray(t.definitions) ? t.definitions : [];
  }

  /** The definition of a tag key (case-insensitive) or null. */
  function definition(project, key) {
    return definitions(project).find((d) => lower(d.key) === lower(key)) || null;
  }

  /** Stable colour for a tag key: the defined colour or one from the palette. */
  function colorFor(project, key) {
    const d = definition(project, key);
    if (d && d.color) return d.color;
    let h = 0;
    const s = lower(key);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  /**
   * Usage per tag key over all nodes: { lowerKey: { key, count, values: [] } }.
   */
  function usage(project) {
    const out = {};
    allNodes(project).forEach((n) => (n.tags || []).forEach((t) => {
      const k = lower(t.key);
      const u = out[k] || (out[k] = { key: t.key, count: 0, values: [] });
      u.count++;
      if (t.value && u.values.indexOf(t.value) < 0) u.values.push(t.value);
    }));
    return out;
  }

  /**
   * Set a tag on all nodes in the given scopes (mutates the project).
   * @param {object} project
   * @param {{key:string,value:string,scopes:string[],overwrite?:boolean,nodeIds?:string[]}} opts
   * @returns {number} number of nodes changed
   */
  function apply(project, opts) {
    const key = str(opts.key, MAX_KEY).trim();
    const value = str(opts.value, MAX_VALUE).trim();
    if (!key) return 0;
    const scopes = new Set(opts.scopes || []);
    const only = opts.nodeIds ? new Set(opts.nodeIds) : null;
    let changed = 0;
    allNodes(project).forEach((n) => {
      if (only ? !only.has(n.id) : !scopes.has(scopeOf(n.type))) return;
      n.tags = Array.isArray(n.tags) ? n.tags : [];
      const i = indexOf(n.tags, key);
      if (i >= 0) {
        if (!opts.overwrite || n.tags[i].value === value) return;
        n.tags[i] = { key: n.tags[i].key, value };
      } else {
        if (n.tags.length >= MAX_TAGS) return;
        n.tags.push({ key, value });
      }
      changed++;
    });
    return changed;
  }

  /** Remove a tag (case-insensitive) from every node. @returns {number} nodes changed */
  function remove(project, key) {
    let changed = 0;
    allNodes(project).forEach((n) => {
      const i = indexOf(n.tags, key);
      if (i >= 0) { n.tags.splice(i, 1); changed++; }
    });
    return changed;
  }

  /**
   * Rename a tag key on every node. When a node already has the new key, the old tag is
   * dropped (the existing value wins). @returns {number} nodes changed
   */
  function rename(project, from, to) {
    const target = str(to, MAX_KEY).trim();
    if (!target || from === target) return 0;
    let changed = 0;
    allNodes(project).forEach((n) => {
      const i = indexOf(n.tags, from);
      if (i < 0) return;
      const j = indexOf(n.tags, target);
      if (j >= 0 && j !== i) n.tags.splice(i, 1);
      else n.tags[i] = { key: target, value: n.tags[i].value };
      changed++;
    });
    return changed;
  }

  /**
   * Tags shown on the diagram for a node: hidden at the "high-level" detail level, when the
   * diagram option "Show tags" is off, or when the tag definition is set to hidden.
   * @returns {{key:string,value:string,color:string}[]}
   */
  function visible(project, node) {
    const d = project.settings.diagram;
    if (!node || !node.tags || !node.tags.length || d.showTags === false || d.detailLevel === 'high') return [];
    return node.tags
      .filter((t) => t.key && (definition(project, t.key) || { show: true }).show !== false)
      .map((t) => ({ key: t.key, value: t.value, color: colorFor(project, t.key) }));
  }

  /** Text of a chip ("Key: Value", or the key alone when there is no value). */
  function chipText(t) {
    const s = t.value ? t.key + ': ' + t.value : t.key;
    return s.length > CHIP.maxChars ? s.slice(0, CHIP.maxChars - 1) + '…' : s;
  }

  /**
   * Wrap tags into rows of chips that fit the given width. When more rows are needed than
   * `maxRows`, the last chip becomes a "+N" overflow chip.
   * @param {{key,value,color}[]} tags
   * @param {number} width available width in px
   * @param {number} [maxRows]
   * @returns {{rows: {text,color,w,title}[][], height:number}}
   */
  function chipRows(tags, width, maxRows) {
    const limit = maxRows || CHIP.maxRows;
    const chipW = (text) => Math.ceil(text.length * CHIP.charW + 2 * CHIP.pad);
    const rows = [];
    let row = [];
    let used = 0;
    let i = 0;
    for (; i < tags.length; i++) {
      const t = tags[i];
      let text = chipText(t);
      if (chipW(text) > width) text = text.slice(0, Math.max(1, Math.floor((width - 2 * CHIP.pad) / CHIP.charW) - 1)) + '…';
      const w = Math.min(width, chipW(text));
      if (row.length && used + CHIP.gap + w > width) {
        rows.push(row);
        row = [];
        used = 0;
        if (rows.length === limit) break;
      }
      row.push({ text, color: t.color, w, title: t.value ? t.key + ': ' + t.value : t.key });
      used += (row.length > 1 ? CHIP.gap : 0) + w;
    }
    if (row.length && rows.length < limit) rows.push(row);
    let rest = tags.length - rows.reduce((n, r) => n + r.length, 0);
    if (rest > 0) {
      const last = rows[rows.length - 1];
      const more = { text: '+' + rest, color: '#6b7280', w: chipW('+' + rest), title: tags.slice(tags.length - rest).map((t) => (t.value ? t.key + ': ' + t.value : t.key)).join('\n'), more: true };
      let total = last.reduce((n, c) => n + c.w, 0) + CHIP.gap * (last.length - 1);
      while (last.length > 1 && total + CHIP.gap + more.w > width) {
        const dropped = last.pop();
        total -= dropped.w + CHIP.gap;
        rest++;
        more.text = '+' + rest;
        more.title = dropped.title + '\n' + more.title;
        more.w = chipW(more.text);
      }
      last.push(more);
    }
    return { rows, height: rows.length ? rows.length * CHIP.h + (rows.length - 1) * CHIP.gap : 0 };
  }

  AISBP.Tags = {
    MAX_TAGS,
    MAX_KEY,
    MAX_VALUE,
    INVALID_KEY,
    PALETTE,
    SCOPES,
    CHIP,
    sanitize,
    parseText,
    validate,
    sanitizeDefinitions,
    scopeOf,
    definitions,
    definition,
    colorFor,
    usage,
    apply,
    remove,
    rename,
    visible,
    chipText,
    chipRows
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Tags;
})(typeof globalThis !== 'undefined' ? globalThis : this);
