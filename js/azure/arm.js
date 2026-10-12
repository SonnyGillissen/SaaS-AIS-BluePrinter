/**
 * AIS BluePrinter - Azure Resource Manager client.
 *
 * Reads management groups, subscriptions, resource groups and resources with the access token
 * of the signed-in user (see AISBP.AzureAuth). Requests go straight from the browser to
 * https://management.azure.com; nothing passes through another server. Only GET requests and
 * read-only POST queries (management group entities, Azure Resource Graph) are used.
 *
 * Works in Node as well (pass `fetch`), which the unit tests use with a fake transport.
 *
 * @module AISBP.AzureArm
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Azure = AISBP.Azure || (typeof require === 'function' ? require('../core/azure.js') : null);

  const ARM = 'https://management.azure.com';
  const MAX_PAGES = 500;
  const lower = (s) => String(s === undefined || s === null ? '' : s).toLowerCase();
  const leaf = (s) => String(s || '').split('/').filter(Boolean).pop() || '';

  /** KQL string literal. */
  const kql = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  /**
   * Create a client.
   * @param {object} o { getToken(): string, fetch?, sleep?(ms), maxRetries? (default 4), baseUrl? }
   */
  function createClient(o) {
    const opts = o || {};
    const fetchFn = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const maxRetries = Number.isInteger(opts.maxRetries) ? opts.maxRetries : 4;
    const base = opts.baseUrl || ARM;
    if (!fetchFn) throw new Error('fetch is not available.');

    /** Absolute URL; the token is only ever sent to the Resource Manager endpoint. */
    function absolute(url) {
      const u = String(url || '');
      if (u.charAt(0) === '/' && u.charAt(1) !== '/') return base + u;
      if (u.indexOf(base + '/') === 0) return u;
      throw new Error('Refusing to call a URL outside Azure Resource Manager: ' + u.slice(0, 80));
    }

    async function request(method, url, body) {
      const full = absolute(url);
      for (let attempt = 0; ; attempt++) {
        const token = opts.getToken();
        if (!token) throw new Error('Not signed in to Azure, or the session expired. Please sign in again.');
        const res = await fetchFn(full, {
          method,
          headers: Object.assign({ Authorization: 'Bearer ' + token, Accept: 'application/json' }, body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : undefined
        });
        if ((res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
          const header = res.headers && res.headers.get ? Number(res.headers.get('Retry-After')) : NaN;
          const wait = Number.isFinite(header) && header > 0 ? Math.min(header, 30) : Math.min(2 ** attempt, 16);
          await sleep(wait * 1000);
          continue;
        }
        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (e) {
          data = {};
        }
        if (!res.ok) {
          const err = data && data.error ? data.error : {};
          const e = new Error((err.message || 'Azure returned HTTP ' + res.status) + (err.code ? ' (' + err.code + ')' : ''));
          e.status = res.status;
          e.code = err.code || '';
          throw e;
        }
        return data;
      }
    }

    /** GET a collection and follow nextLink paging. */
    async function list(url) {
      const items = [];
      let next = url;
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const data = await request('GET', next);
        const values = Array.isArray(data) ? data : Array.isArray(data.value) ? data.value : [];
        values.forEach((v) => items.push(v));
        next = !Array.isArray(data) && data.nextLink ? data.nextLink : null;
      }
      return items;
    }

    /** Azure Resource Graph query over subscriptions, following $skipToken paging. */
    async function graph(query, subscriptions) {
      const rows = [];
      let skipToken;
      for (let page = 0; page < MAX_PAGES; page++) {
        const options = { $top: 1000, resultFormat: 'objectArray' };
        if (skipToken) options.$skipToken = skipToken;
        const data = await request('POST', '/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01', { subscriptions, query, options });
        (Array.isArray(data.data) ? data.data : []).forEach((r) => rows.push(r));
        skipToken = data.$skipToken;
        if (!skipToken) break;
      }
      return rows;
    }

    return { request, list, graph };
  }

  /** Subscriptions the user can access. */
  async function listSubscriptions(client) {
    const subs = await client.list('/subscriptions?api-version=2022-12-01');
    return subs.map((s) => ({ subscriptionId: s.subscriptionId, displayName: s.displayName || s.subscriptionId, state: s.state, tenantId: s.tenantId, tags: s.tags, parent: null }));
  }

  /**
   * Management groups and the management group of each subscription, or null when the user
   * cannot read the management group hierarchy.
   * @returns {Promise<{managementGroups: object[], parents: Object<string, string>}|null>}
   */
  async function listManagementGroups(client) {
    const entities = [];
    try {
      let next = '/providers/Microsoft.Management/getEntities?api-version=2021-04-01';
      for (let page = 0; next && page < MAX_PAGES; page++) {
        const data = await client.request('POST', next, {});
        (Array.isArray(data.value) ? data.value : []).forEach((e) => entities.push(e));
        next = data.nextLink || null;
      }
    } catch (e) {
      return null;
    }
    const managementGroups = [];
    const parents = {};
    entities.forEach((e) => {
      const p = e && e.properties ? e.properties : {};
      const parent = p.parent && p.parent.id ? leaf(p.parent.id) : null;
      if (lower(e.type) === 'microsoft.management/managementgroups') managementGroups.push({ name: e.name, displayName: p.displayName || e.name, parent });
      else if (lower(e.type) === '/subscriptions') parents[lower(e.name)] = parent;
    });
    const names = new Set(managementGroups.map((m) => lower(m.name)));
    managementGroups.forEach((m) => { if (m.parent && !names.has(lower(m.parent))) m.parent = null; });
    Object.keys(parents).forEach((k) => { if (parents[k] && !names.has(lower(parents[k]))) parents[k] = null; });
    return { managementGroups, parents };
  }

  /**
   * The selection tree: management groups (when readable) and subscriptions with their parent.
   * @returns {Promise<{managementGroups: object[], subscriptions: object[], resourceGroups: object, managementGroupsReadable: boolean}>}
   */
  async function loadTree(client) {
    const [subscriptions, hierarchy] = await Promise.all([listSubscriptions(client), listManagementGroups(client)]);
    if (hierarchy) subscriptions.forEach((s) => { s.parent = hierarchy.parents[lower(s.subscriptionId)] || null; });
    return { managementGroups: hierarchy ? hierarchy.managementGroups : [], subscriptions, resourceGroups: {}, managementGroupsReadable: !!hierarchy };
  }

  /** Resource groups of a subscription. */
  async function listResourceGroups(client, subscriptionId) {
    const groups = await client.list('/subscriptions/' + encodeURIComponent(subscriptionId) + '/resourcegroups?api-version=2021-04-01');
    return groups.map((g) => ({ id: g.id, name: g.name, location: g.location, tags: g.tags, subscriptionId }));
  }

  /** Run async tasks with limited concurrency. */
  async function pool(items, limit, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        await fn(item);
      }
    });
    await Promise.all(workers);
  }

  /**
   * Read everything needed to draw the selected scope.
   * @param {object} client createClient() result
   * @param {object} tree loadTree() result (resource groups read so far are reused)
   * @param {object} selection AISBP.Azure.resolveSelection() result
   * @param {object} [opts] { includeChildren (default true), onProgress(text), concurrency (default 6) }
   * @returns {Promise<object>} inventory for AISBP.Azure.buildProject (with `warnings`)
   */
  async function loadInventory(client, tree, selection, opts) {
    const o = Object.assign({ includeChildren: true, concurrency: 6, onProgress: () => {} }, opts || {});
    const warnings = [];
    const subs = (tree.subscriptions || []).filter((s) => selection.subscriptions.some((id) => lower(id) === lower(s.subscriptionId)));
    const mgSet = new Set(selection.managementGroups.map(lower));
    const inventory = {
      managementGroups: (tree.managementGroups || []).filter((m) => mgSet.has(lower(m.name))),
      subscriptions: subs,
      resourceGroups: [],
      resources: [],
      extras: {},
      warnings
    };

    // Resource groups
    o.onProgress('Reading resource groups\u2026');
    const cache = tree.resourceGroups || {};
    await pool(subs, o.concurrency, async (s) => {
      let groups = cache[s.subscriptionId];
      if (!groups) {
        try {
          groups = await listResourceGroups(client, s.subscriptionId);
          cache[s.subscriptionId] = groups;
        } catch (e) {
          warnings.push('Resource groups of "' + s.displayName + '": ' + e.message);
          groups = [];
        }
      }
      const only = selection.resourceGroups[s.subscriptionId];
      const wanted = only ? new Set(only.map(lower)) : null;
      groups.filter((g) => !wanted || wanted.has(lower(g.name))).forEach((g) => inventory.resourceGroups.push(g));
    });

    // Resources, with their properties, from Azure Resource Graph.
    o.onProgress('Reading resources\u2026');
    const clauses = subs.map((s) => {
      const only = selection.resourceGroups[s.subscriptionId];
      if (!only) return { sub: s.subscriptionId, where: 'subscriptionId =~ ' + kql(s.subscriptionId) };
      return { sub: s.subscriptionId, where: '(subscriptionId =~ ' + kql(s.subscriptionId) + ' and resourceGroup in~ (' + only.map(kql).join(', ') + '))' };
    });
    try {
      for (let i = 0; i < clauses.length; i += 50) {
        const chunk = clauses.slice(i, i + 50);
        const query = 'resources | where ' + chunk.map((c) => c.where).join(' or ') +
          ' | project id, name, type, kind, location, resourceGroup, subscriptionId, tags, sku, identity, zones, properties';
        const rows = await client.graph(query, chunk.map((c) => c.sub));
        rows.forEach((r) => inventory.resources.push(r));
        o.onProgress('Reading resources\u2026 ' + inventory.resources.length);
      }
    } catch (e) {
      // Fallback without properties (fewer details and connections).
      warnings.push('Azure Resource Graph is not available (' + e.message + '); resources were loaded without their properties.');
      inventory.resources = [];
      await pool(inventory.resourceGroups, o.concurrency, async (g) => {
        try {
          const items = await client.list('/subscriptions/' + encodeURIComponent(g.subscriptionId) + '/resourceGroups/' + encodeURIComponent(g.name) + '/resources?api-version=2021-04-01');
          items.forEach((r) => inventory.resources.push(r));
        } catch (err) {
          warnings.push('Resources of "' + g.name + '": ' + err.message);
        }
      });
    }

    // Child resources (workflows, functions, queues, topics, APIs, containers, ...).
    if (o.includeChildren) {
      const jobs = [];
      inventory.resources.forEach((r) => {
        if (Azure.isSkipped(r)) return;
        Azure.childSpecs(Azure.mapType(r)).forEach((spec) => jobs.push({ parent: r, spec }));
      });
      let done = 0;
      let failed = 0;
      const run = async (job) => {
        const { parent, spec } = job;
        let items;
        try {
          items = await client.list(String(parent.id).split('/').map((s) => encodeURIComponent(s)).join('/') + spec.path + '?api-version=' + spec.api);
        } catch (e) {
          // Some services (or a stopped app) do not support a child collection; that is fine.
          if (e.status !== 404 && e.status !== 400 && e.status !== 409) failed++;
          return;
        } finally {
          done++;
          if (done % 5 === 0 || done === jobs.length) o.onProgress('Reading child resources\u2026 ' + done + '/' + jobs.length);
        }
        if (spec.attach) {
          const key = lower(parent.id);
          inventory.extras[key] = inventory.extras[key] || {};
          inventory.extras[key][spec.attach] = items;
          return;
        }
        items.forEach((item) => {
          if (!item || !item.name) return;
          // API Management lists every revision; only draw the current one.
          if (spec.type === 'apim-api' && (String(item.name).indexOf(';rev=') !== -1 || (item.properties && item.properties.isCurrent === false))) return;
          const child = Object.assign({}, item, { id: item.id || parent.id + spec.path + '/' + leaf(item.name), type: item.type || spec.type, _catalogType: spec.type, _parent: parent.id });
          inventory.resources.push(child);
          (spec.children || []).forEach((sub) => jobs.push({ parent: child, spec: sub }));
        });
      };
      // Jobs can add nested jobs, so keep draining until nothing is left.
      let start = 0;
      while (start < jobs.length) {
        const batch = jobs.slice(start);
        start = jobs.length;
        await pool(batch, o.concurrency, run);
      }
      if (failed) warnings.push(failed + ' child resource list(s) could not be read (missing permissions?).');
    }
    return inventory;
  }

  AISBP.AzureArm = { ARM, createClient, listSubscriptions, listManagementGroups, loadTree, listResourceGroups, loadInventory, kql };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.AzureArm;
})(typeof globalThis !== 'undefined' ? globalThis : this);
