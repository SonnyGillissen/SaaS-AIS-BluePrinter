/**
 * AIS BluePrinter - naming conventions.
 *
 * Resolves resource names from naming patterns and validates them against the Azure naming
 * rules declared in the catalog.
 *
 * Pattern tokens (written as {token}):
 *   {abbr}      CAF abbreviation of the resource type (overridable per type in the options)
 *   {name}      the object's short name ("label")
 *   {workload}  {env} {org} and any custom token defined in the options
 *   {region}    abbreviation of the effective Azure region (location attribute, inherited)
 *   {instance}  zero-padded sequence number, unique within the naming scope of the type
 *   {parent}    resolved name of the parent object
 *   {type}      catalog type id
 *
 * Resolution order for a pattern: object override > per-type override (options) >
 * catalog default for the type > global pattern (resources) / child pattern (child resources).
 * Token values resolve from the object, then its ancestors (so an override on a subscription
 * or resource group is inherited), and finally the global options.
 *
 * @module AISBP.Naming
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('./catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('./model.js') : null);
  const Tags = AISBP.Tags || (typeof require === 'function' ? require('./tags.js') : null);

  const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

  /** Human readable explanation of a naming rule. */
  function describeRule(rule) {
    if (!rule) return '';
    const parts = [rule.min + '-' + rule.max + ' characters'];
    if (rule.chars) parts.push('allowed: ' + rule.chars.replace(/\\/g, '').replace('A-Za-z0-9', 'letters, digits').replace('a-z0-9', 'lowercase letters, digits'));
    if (rule.invalid) parts.push('not allowed: ' + rule.invalid.replace(/\\\\/g, '\\'));
    if (rule.lower) parts.push('lowercase only');
    if (rule.start === 'letter') parts.push('must start with a letter');
    if (rule.start === 'alnum') parts.push('must start with a letter or digit');
    if (rule.end === 'alnum') parts.push('must end with a letter or digit');
    if (rule.end === 'alnumOrUnderscore') parts.push('must end with a letter, digit or underscore');
    if (rule.end === 'notPeriod') parts.push("can't end with a period");
    if (rule.end === 'notPeriodOrSpace') parts.push("can't end with a period or space");
    if (rule.noDoubleHyphen) parts.push('no consecutive hyphens');
    const scopes = { global: 'globally unique', tenant: 'unique in the tenant', subscription: 'unique in the subscription', resourceGroup: 'unique in the resource group', parent: 'unique in the parent resource' };
    if (scopes[rule.scope]) parts.push(scopes[rule.scope]);
    return parts.join('; ');
  }

  /** The naming pattern that applies to a node. */
  function patternFor(project, node) {
    const def = Catalog.get(node.type);
    const naming = project.settings.naming;
    if (node.naming && node.naming.pattern) return node.naming.pattern;
    if (naming.typePatterns && naming.typePatterns[node.type]) return naming.typePatterns[node.type];
    if (def && def.pattern) return def.pattern;
    const isResource = def && (node.type === 'resource-group' || def.parents.indexOf('resource-group') !== -1);
    return isResource || !def ? naming.pattern : naming.childPattern || '{abbr}-{name}';
  }

  /** Abbreviation for a type, honoring overrides from the options. */
  function abbreviation(project, typeId) {
    const ov = project.settings.naming.abbreviations || {};
    if (ov[typeId] !== undefined && ov[typeId] !== '') return ov[typeId];
    const def = Catalog.get(typeId);
    return def ? def.abbr : '';
  }

  /** Abbreviation for a region id. */
  function regionAbbreviation(project, regionId) {
    if (!regionId) return '';
    const ov = project.settings.naming.regionAbbreviations || {};
    if (ov[regionId]) return ov[regionId];
    const r = Catalog.region(regionId);
    return r ? r.abbr : regionId;
  }

  /** Scope key used for uniqueness checks and instance numbering. */
  function scopeKey(project, node) {
    const def = Catalog.get(node.type);
    const scope = def && def.rule ? def.rule.scope : 'resourceGroup';
    switch (scope) {
      case 'global':
      case 'tenant':
        return scope;
      case 'subscription': {
        const sub = Model.closest(project, node.parentId, 'subscription');
        return 'sub:' + (sub ? sub.id : '-');
      }
      case 'resourceGroup': {
        const rg = Model.closest(project, node.parentId, 'resource-group');
        return 'rg:' + (rg ? rg.id : node.parentId || '-');
      }
      case 'none':
        return 'none:' + node.id;
      default:
        return 'parent:' + (node.parentId || '-');
    }
  }

  /** Auto instance number: position among nodes of the same type within the naming scope. */
  function autoInstance(project, node) {
    const key = scopeKey(project, node);
    const peers = Object.keys(project.nodes)
      .map((k) => project.nodes[k])
      .filter((n) => n.type === node.type && n.nameMode !== 'custom' && !(n.naming && n.naming.tokens && n.naming.tokens.instance) && scopeKey(project, n) === key)
      .sort((a, b) => a.seq - b.seq);
    const idx = peers.findIndex((p) => p.id === node.id);
    return idx < 0 ? 1 : idx + 1;
  }

  /** Resolve a single token value for a node. */
  function tokenValue(project, node, token, depth) {
    const own = node.naming && node.naming.tokens ? node.naming.tokens : {};
    if (own[token] !== undefined && own[token] !== '') return String(own[token]);
    switch (token) {
      case 'abbr':
        return abbreviation(project, node.type);
      case 'name':
        return node.label || '';
      case 'type':
        return node.type;
      case 'instance': {
        const pad = project.settings.naming.instancePadding || 3;
        return String(autoInstance(project, node)).padStart(pad, '0');
      }
      case 'region':
        return regionAbbreviation(project, Model.effectiveLocation(project, node.id));
      case 'parent': {
        const parent = Model.getNode(project, node.parentId);
        return parent && depth < 8 ? resolveName(project, parent, depth + 1) : '';
      }
      default: {
        const anc = Model.ancestors(project, node.id);
        for (let i = 0; i < anc.length; i++) {
          const t = anc[i].naming && anc[i].naming.tokens;
          if (t && t[token] !== undefined && t[token] !== '') return String(t[token]);
        }
        const g = project.settings.naming.tokens || {};
        return g[token] !== undefined ? String(g[token]) : '';
      }
    }
  }

  /** Remove separators left behind by empty tokens. */
  function tidy(raw) {
    return String(raw)
      .replace(/-{2,}/g, '-')
      .replace(/_{2,}/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^[-_.\s]+|[-_.\s]+$/g, '');
  }

  /**
   * Apply a pattern for a node and clean up separators left behind by empty tokens.
   * @param {object} [values] pre-resolved token values (token -> string)
   * @returns {string}
   */
  function applyPattern(project, node, pattern, depth, values) {
    return tidy(String(pattern || '').replace(TOKEN_RE, (_, token) => (values && values[token] !== undefined ? values[token] : tokenValue(project, node, token, depth || 0))));
  }

  /**
   * Adjust a generated name so it satisfies the naming rule as far as possible
   * (case, allowed characters, consecutive hyphens, start/end characters and length).
   */
  function sanitize(name, rule) {
    if (!rule) return name;
    let n = String(name);
    if (rule.lower) n = n.toLowerCase();
    if (rule.chars) n = n.replace(new RegExp('[^' + rule.chars + ']', 'g'), '');
    if (rule.invalid) n = n.split('').filter((ch) => rule.invalid.indexOf(ch) === -1).join('');
    if (rule.noDoubleHyphen) n = n.replace(/-{2,}/g, '-');
    if (rule.max && n.length > rule.max) n = n.slice(0, rule.max);
    if (rule.start === 'letter') n = n.replace(/^[^A-Za-z]+/, '');
    if (rule.start === 'alnum') n = n.replace(/^[^A-Za-z0-9]+/, '');
    if (rule.end === 'alnum') n = n.replace(/[^A-Za-z0-9]+$/, '');
    if (rule.end === 'alnumOrUnderscore') n = n.replace(/[^A-Za-z0-9_]+$/, '');
    if (rule.end === 'notPeriod') n = n.replace(/\.+$/, '');
    if (rule.end === 'notPeriodOrSpace') n = n.replace(/[.\s]+$/, '');
    return n;
  }

  /**
   * Resolve the effective name of a node.
   * @returns {string}
   */
  function resolveName(project, node, depth) {
    if (!node) return '';
    if (node.nameMode === 'custom') return node.name || '';
    const def = Catalog.get(node.type);
    const pattern = patternFor(project, node);
    const values = {};
    tokensIn(pattern).forEach((t) => { values[t] = tokenValue(project, node, t, depth || 0); });
    const enforce = project.settings.naming.enforce !== false && def && def.rule;
    let name = applyPattern(project, node, pattern, depth, values);
    if (!enforce) return name;
    name = sanitize(name, def.rule);
    // Too long? Shorten the longest free-text token instead of cutting off the end of the
    // name, so that the abbreviation, environment, region and instance stay intact.
    const fixed = ['abbr', 'env', 'region', 'instance'];
    let guard = 0;
    while (def.rule.max && sanitize(applyPattern(project, node, pattern, depth, values), Object.assign({}, def.rule, { max: 0 })).length > def.rule.max && guard++ < 500) {
      const candidates = Object.keys(values).filter((t) => fixed.indexOf(t) === -1 && values[t].length > 2);
      if (!candidates.length) break;
      candidates.sort((a, b) => values[b].length - values[a].length);
      values[candidates[0]] = values[candidates[0]].slice(0, -1);
      name = sanitize(applyPattern(project, node, pattern, depth, values), def.rule);
    }
    return name;
  }

  /**
   * Validate a name against a rule. Returns a list of human readable problems.
   * @param {string} name
   * @param {object} rule
   */
  function validateName(name, rule) {
    const problems = [];
    if (!rule) return problems;
    const n = String(name || '');
    if (n.length < rule.min) problems.push('Name is too short (minimum ' + rule.min + ' characters).');
    if (n.length > rule.max) problems.push('Name is too long (' + n.length + '/' + rule.max + ' characters).');
    if (rule.chars) {
      const bad = n.replace(new RegExp('[' + rule.chars + ']', 'g'), '');
      if (bad) problems.push('Invalid characters: "' + Array.from(new Set(bad.split(''))).join('') + '".');
    }
    if (rule.invalid) {
      const bad = n.split('').filter((ch) => rule.invalid.indexOf(ch) !== -1);
      if (bad.length) problems.push('Invalid characters: "' + Array.from(new Set(bad)).join('') + '".');
    }
    if (rule.lower && /[A-Z]/.test(n)) problems.push('Only lowercase letters are allowed.');
    if (n) {
      if (rule.start === 'letter' && !/^[A-Za-z]/.test(n)) problems.push('Must start with a letter.');
      if (rule.start === 'alnum' && !/^[A-Za-z0-9]/.test(n)) problems.push('Must start with a letter or digit.');
      if (rule.end === 'alnum' && !/[A-Za-z0-9]$/.test(n)) problems.push('Must end with a letter or digit.');
      if (rule.end === 'alnumOrUnderscore' && !/[A-Za-z0-9_]$/.test(n)) problems.push('Must end with a letter, digit or underscore.');
      if (rule.end === 'notPeriod' && /\.$/.test(n)) problems.push("Can't end with a period.");
      if (rule.end === 'notPeriodOrSpace' && /[.\s]$/.test(n)) problems.push("Can't end with a period or space.");
    }
    if (rule.noDoubleHyphen && /--/.test(n)) problems.push('Consecutive hyphens are not allowed.');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F]/.test(n)) problems.push('Control characters are not allowed.');
    return problems;
  }

  /**
   * Validate every node of the project: naming rules and uniqueness within the naming scope.
   * @returns {Object<string, string[]>} problems per node id (only nodes with problems)
   */
  function validateProject(project) {
    const result = {};
    const names = {};
    Object.keys(project.nodes).forEach((id) => {
      const node = project.nodes[id];
      const def = Catalog.get(node.type);
      const name = resolveName(project, node);
      const problems = validateName(name, def && def.rule);
      if (problems.length) result[id] = problems;
      if (def && def.rule && def.rule.scope !== 'none' && name) {
        const key = node.type + '|' + scopeKey(project, node) + '|' + name.toLowerCase();
        (names[key] = names[key] || []).push(id);
      }
      const parent = Model.getNode(project, node.parentId);
      if (!Catalog.canContain(parent ? parent.type : null, node.type)) {
        (result[id] = result[id] || []).push(def.label + ' is not allowed ' + (parent ? 'inside a ' + Catalog.get(parent.type).label : 'at the top level') + '.');
      }
      const tagProblems = Tags ? Tags.validate(node) : [];
      if (tagProblems.length) result[id] = (result[id] || []).concat(tagProblems);
    });
    Object.keys(names).forEach((key) => {
      if (names[key].length > 1) {
        names[key].forEach((id) => {
          const def = Catalog.get(project.nodes[id].type);
          (result[id] = result[id] || []).push('Duplicate name: must be ' + describeRule(def.rule).split('; ').pop() + '.');
        });
      }
    });
    return result;
  }

  /** List the tokens used in a pattern. */
  function tokensIn(pattern) {
    const out = [];
    String(pattern || '').replace(TOKEN_RE, (_, t) => { if (out.indexOf(t) === -1) out.push(t); return ''; });
    return out;
  }

  AISBP.Naming = {
    describeRule,
    patternFor,
    abbreviation,
    regionAbbreviation,
    scopeKey,
    autoInstance,
    tokenValue,
    tidy,
    applyPattern,
    sanitize,
    resolveName,
    validateName,
    validateProject,
    tokensIn
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Naming;
})(typeof globalThis !== 'undefined' ? globalThis : this);
