/**
 * AIS BluePrinter - project model.
 *
 * Pure functions that create, query and mutate a *project* (the blueprint). A project is a
 * plain JSON object, which makes persisting (localStorage / database) and exporting it as a
 * configuration package trivial:
 *
 * {
 *   format: 'ais-blueprinter', version: 1,
 *   meta:      { id, name, description, author, created, modified, seq },
 *   settings:  { naming: {...}, diagram: {...}, icons: {...}, tags: { definitions: [...] } },
 *   nodes:     { [id]: Node },        // Azure tenants, management groups, subscriptions, resource groups, resources
 *   connections: { [id]: Connection } // arrows between nodes (data flow, triggers, dependencies, ...)
 * }
 *
 * Node: { id, type, parentId|null, seq, label, nameMode: 'convention'|'custom', name,
 *         naming: { pattern?, tokens: {} }, attributes: {}, custom: [{key,value}], tags: [{key,value}],
 *         display: { [attributeKey]: boolean }, network: [id], x, y, w?, h? }
 * Connection: { id, from, to, kind, direction: 'forward'|'bidirectional', label, attributes: {},
 *               waypoints: [{x,y}], sourceAnchor?, targetAnchor? }
 * Anchor: { side: 'top'|'right'|'bottom'|'left', offset: 0..1 }; null means automatic.
 *
 * `network` lists the ids of the virtual networks / subnets a resource is attached to (only for
 * types where `Catalog.supportsNetwork` is true).
 *
 * Nodes store absolute canvas coordinates (x/y of their top-left corner). Containers grow
 * automatically to wrap their children (see AISBP.Layout). Containers that were resized by hand
 * also store a minimum size (w/h); "Tidy up" removes it again.
 *
 * @module AISBP.Model
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('./util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('./catalog.js') : null);
  const Tags = AISBP.Tags || (typeof require === 'function' ? require('./tags.js') : null);
  const Annotations = AISBP.Annotations || (typeof require === 'function' ? require('./annotations.js') : null);

  const FORMAT = 'ais-blueprinter';
  const VERSION = 1;

  /** Connection kinds and their ArchiMate relationship mapping. */
  const CONNECTION_KINDS = [
    { id: 'flow', label: 'Data flow', archimate: 'Flow', dashed: false },
    { id: 'trigger', label: 'Trigger / event', archimate: 'Triggering', dashed: false },
    { id: 'dependency', label: 'Dependency (uses)', archimate: 'Serving', dashed: true },
    { id: 'access', label: 'Data access', archimate: 'Access', dashed: true },
    { id: 'network', label: 'Network path', archimate: 'Association', dashed: true },
    { id: 'association', label: 'Association', archimate: 'Association', dashed: true }
  ];

  /** Connection directions. `forward` points from source to target. */
  const DIRECTIONS = [
    { id: 'forward', label: 'One-way (source \u2192 target)' },
    { id: 'bidirectional', label: 'Bidirectional (source \u2194 target)' }
  ];

  const cleanDirection = (d) => (DIRECTIONS.some((x) => x.id === d) ? d : 'forward');

  const PROTOCOLS = ['', 'HTTPS', 'HTTP', 'AMQP', 'Kafka', 'MQTT', 'SFTP', 'FTP', 'AS2', 'SOAP', 'gRPC', 'WebSocket', 'SQL/TDS', 'SMB', 'Private Link', 'VNet', 'Event Grid', 'Other'];

  /** Default settings for a new project. `AISBP_CONFIG.defaults` (js/config.js) may override them. */
  function defaultSettings() {
    return {
      naming: {
        pattern: '{abbr}-{workload}-{env}-{region}-{instance}',
        childPattern: '{abbr}-{name}',
        tokens: { org: 'contoso', workload: 'integration', env: 'dev' },
        instancePadding: 3,
        typePatterns: {},
        abbreviations: {},
        regionAbbreviations: {},
        enforce: true
      },
      diagram: {
        style: 'classic',
        detailLevel: 'selected',
        connector: 'orthogonal',
        showTypeLabels: true,
        showConnectionLabels: true,
        showTitle: true,
        showTags: true,
        hiddenContainers: [],
        typeDisplay: {},
        snapToGrid: true,
        gridSize: 10,
        pdfPageSize: 'fit'
      },
      icons: { baseUrl: 'https://msicons.com/icons/' },
      tags: { definitions: [] }
    };
  }

  /** Recursively merge plain objects (arrays and primitives replace). Unsafe keys are skipped. */
  function deepMerge(target, source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return target;
    Object.keys(source).forEach((key) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      const sv = source[key];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        deepMerge(target[key], sv);
      } else {
        target[key] = Util.clone(sv);
      }
    });
    return target;
  }

  /**
   * Create an empty project.
   * @param {object} [opts] { name, settings (partial overrides), sample (bool) }
   */
  function createProject(opts) {
    const o = opts || {};
    const ts = Util.now();
    const project = {
      format: FORMAT,
      version: VERSION,
      meta: { id: Util.uid('p'), name: o.name || 'New integration blueprint', description: '', author: '', created: ts, modified: ts, seq: 0 },
      settings: deepMerge(defaultSettings(), o.settings || {}),
      nodes: {},
      connections: {}
    };
    if (o.sample) addSample(project);
    return project;
  }

  /** Adds a small sample landing zone so first-time users see how things work. */
  function addSample(project) {
    const mg = addNode(project, 'management-group', null, { x: 40, y: 80, label: 'integration' });
    const sub = addNode(project, 'subscription', mg.id, { x: 70, y: 140 });
    const rg = addNode(project, 'resource-group', sub.id, { x: 100, y: 200 });
    const users = addNode(project, 'users', null, { x: 40, y: -60, name: 'Partner applications' });
    const apim = addNode(project, 'api-management', rg.id, { x: 130, y: 260, naming: { tokens: { workload: 'gateway' } } });
    const sb = addNode(project, 'service-bus-namespace', rg.id, { x: 360, y: 260 });
    const q = addNode(project, 'service-bus-queue', sb.id, { x: 390, y: 320, label: 'orders' });
    const la = addNode(project, 'logic-app-standard', rg.id, { x: 640, y: 260, naming: { tokens: { workload: 'orders' } } });
    const wf = addNode(project, 'logic-app-workflow', la.id, { x: 670, y: 320, label: 'ProcessOrder' });
    const erp = addNode(project, 'on-premises-system', null, { x: 1000, y: -60, name: 'ERP system' });
    const kv = addNode(project, 'key-vault', rg.id, { x: 130, y: 470 });
    addConnection(project, users.id, apim.id, { kind: 'flow', label: 'HTTPS', attributes: { protocol: 'HTTPS' } });
    addConnection(project, apim.id, q.id, { kind: 'flow', label: 'send order', attributes: { protocol: 'AMQP' } });
    addConnection(project, q.id, wf.id, { kind: 'trigger', label: 'trigger' });
    addConnection(project, wf.id, erp.id, { kind: 'flow', label: 'via data gateway' });
    addConnection(project, la.id, kv.id, { kind: 'dependency', label: 'secrets' });
    return project;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** @returns {object|undefined} */
  function getNode(project, id) {
    return id && Object.prototype.hasOwnProperty.call(project.nodes, id) ? project.nodes[id] : undefined;
  }

  /** Children of a node (or root nodes when id is null), sorted by creation order. */
  function children(project, id) {
    const pid = id || null;
    return Object.keys(project.nodes)
      .map((k) => project.nodes[k])
      .filter((n) => (n.parentId || null) === pid)
      .sort((a, b) => a.seq - b.seq);
  }

  /** All descendants (depth-first). */
  function descendants(project, id) {
    const out = [];
    const walk = (pid) => children(project, pid).forEach((c) => { out.push(c); walk(c.id); });
    walk(id);
    return out;
  }

  /** Ancestors from parent up to the root. */
  function ancestors(project, id) {
    const out = [];
    let cur = getNode(project, id);
    const guard = new Set();
    while (cur && cur.parentId && !guard.has(cur.parentId)) {
      guard.add(cur.parentId);
      cur = getNode(project, cur.parentId);
      if (cur) out.push(cur);
    }
    return out;
  }

  /** Nesting depth (root nodes = 0). */
  function depth(project, id) {
    return ancestors(project, id).length;
  }

  /** Nearest ancestor (or self) of a given type. */
  function closest(project, id, type) {
    const n = getNode(project, id);
    if (!n) return undefined;
    if (n.type === type) return n;
    return ancestors(project, id).find((a) => a.type === type);
  }

  /** Whether `candidate` is `id` itself or one of its descendants. */
  function isSelfOrDescendant(project, id, candidate) {
    if (id === candidate) return true;
    return ancestors(project, candidate).some((a) => a.id === id);
  }

  /** Whether `childType` may be placed inside node `parentId` (null = root). */
  function canContain(project, parentId, childType) {
    if (!parentId) return Catalog.canContain(null, childType);
    const parent = getNode(project, parentId);
    if (parent && Catalog.get(childType) && Catalog.get(childType).annotation && !Catalog.get(parent.type).annotation) {
      return Catalog.canContain(parent.type, childType) || children(project, parentId).length > 0;
    }
    return !!parent && Catalog.canContain(parent.type, childType);
  }

  /**
   * Effective location of a node: own `location` attribute, otherwise inherited from the
   * nearest ancestor that has one.
   */
  function effectiveLocation(project, id) {
    const chain = [getNode(project, id)].concat(ancestors(project, id));
    for (let i = 0; i < chain.length; i++) {
      const loc = chain[i] && chain[i].attributes && chain[i].attributes.location;
      if (loc && loc !== '(inherit)') return loc;
    }
    return '';
  }

  /** Tenant defaults for applicable attributes, resolved from the containing Azure Tenant. */
  function inheritedTenantAttributes(project, id) {
    const node = getNode(project, id);
    const def = node && Catalog.get(node.type);
    const tenant = node && ancestors(project, id).find((a) => a.type === 'azure-tenant');
    const out = {};
    if (!def || !tenant) return out;
    def.attributes.forEach((attr) => {
      if (!attr.tenantSource) return;
      const value = (tenant.attributes || {})[attr.tenantSource];
      if (typeof value === 'string' && value.trim() && value !== '(inherit)') out[attr.key] = value;
    });
    return out;
  }

  /** Resolve tenant defaults without materializing them in the saved node attributes. */
  function effectiveAttributes(project, id) {
    const node = getNode(project, id);
    const out = Object.assign({}, node && node.attributes);
    const inherited = inheritedTenantAttributes(project, id);
    Object.keys(inherited).forEach((key) => {
      const own = out[key];
      if (own === undefined || own === null || (typeof own === 'string' && (!own.trim() || own === '(inherit)'))) out[key] = inherited[key];
    });
    return out;
  }

  /** Valid manual container size (see node.w / node.h). */
  const validSize = (v) => Number.isFinite(v) && v > 0 && v <= 100000;

  /** Whether node `id` exists and is a virtual network or subnet. */
  function isNetworkTarget(project, id) {
    const n = getNode(project, id);
    return !!n && Catalog.NETWORK_TARGET_TYPES.indexOf(n.type) !== -1;
  }

  /** All virtual networks and subnets of a project, in tree order (subnets follow their VNet). */
  function networkTargets(project) {
    const out = [];
    const walk = (pid) => children(project, pid).forEach((c) => {
      if (Catalog.NETWORK_TARGET_TYPES.indexOf(c.type) !== -1) out.push(c);
      walk(c.id);
    });
    walk(null);
    return out;
  }

  /** The virtual network / subnet nodes a node is attached to. */
  function networkLinks(project, node) {
    return (node && Array.isArray(node.network) ? node.network : []).map((id) => getNode(project, id)).filter((n) => n && Catalog.NETWORK_TARGET_TYPES.indexOf(n.type) !== -1);
  }

  // ---------------------------------------------------------------------------
  // Mutations (all operate in place and return the affected objects)
  // ---------------------------------------------------------------------------

  function touch(project) {
    project.meta.modified = Util.now();
  }

  function nextSeq(project) {
    project.meta.seq = (project.meta.seq || 0) + 1;
    return project.meta.seq;
  }

  /** Default attribute values for a type. */
  function defaultAttributes(typeId) {
    const t = Catalog.get(typeId);
    const attrs = {};
    (t ? t.attributes : []).forEach((a) => {
      if (a.default !== undefined) attrs[a.key] = a.default;
    });
    return attrs;
  }

  /**
   * Add a node.
   * @param {object} project
   * @param {string} type catalog type id
   * @param {string|null} parentId
   * @param {object} [props] initial properties (x, y, label, name, nameMode, naming, attributes, ...)
   * @throws when the type is unknown or the parent does not accept the type.
   */
  function addNode(project, type, parentId, props) {
    const def = Catalog.get(type);
    if (!def) throw new Error('Unknown resource type: ' + type);
    if (!canContain(project, parentId || null, type)) {
      const parent = getNode(project, parentId);
      throw new Error(def.label + ' cannot be placed ' + (parent ? 'inside a ' + Catalog.get(parent.type).label : 'at the top level'));
    }
    const p = props || {};
    const siblingsOfType = children(project, parentId).filter((c) => c.type === type).length;
    const nameMode = p.nameMode || def.nameMode || 'convention';
    const node = {
      id: p.id && Util.isValidId(p.id) && !project.nodes[p.id] ? p.id : Util.uid('n'),
      type,
      parentId: parentId || null,
      seq: nextSeq(project),
      label: p.label !== undefined ? String(p.label) : def.seed ? def.seed + (siblingsOfType && nameMode === 'convention' ? siblingsOfType + 1 : '') : '',
      nameMode,
      name: p.name !== undefined ? String(p.name) : nameMode === 'custom' ? def.seed || def.label : '',
      naming: { pattern: '', tokens: {} },
      attributes: defaultAttributes(type),
      custom: [],
      tags: [],
      display: {},
      network: [],
      x: Number.isFinite(p.x) ? p.x : 0,
      y: Number.isFinite(p.y) ? p.y : 0
    };
    if (p.naming) {
      node.naming.pattern = p.naming.pattern || '';
      node.naming.tokens = Object.assign({}, p.naming.tokens || {});
    }
    if (p.attributes) Object.assign(node.attributes, p.attributes);
    if (def.annotation) node.attributes = Annotations.normalize(type, node.attributes);
    if (Array.isArray(p.custom)) node.custom = p.custom.map((c) => ({ key: String(c.key || ''), value: String(c.value || '') }));
    if (Array.isArray(p.tags)) node.tags = Tags.sanitize(p.tags);
    if (p.display) node.display = Object.assign({}, p.display);
    if (validSize(p.w) && validSize(p.h)) { node.w = p.w; node.h = p.h; }
    if (Array.isArray(p.network)) node.network = p.network.filter((nid) => Util.isValidId(nid) && isNetworkTarget(project, nid));
    project.nodes[node.id] = node;
    touch(project);
    return node;
  }

  /** Update properties of a node (shallow merge for nested objects naming/attributes/display). */
  function updateNode(project, id, patch) {
    const node = getNode(project, id);
    if (!node) return undefined;
    Object.keys(patch || {}).forEach((key) => {
      if (key === 'id' || key === 'type' || key === 'parentId' || key === 'seq') return;
      if (key === 'naming') {
        node.naming = { pattern: patch.naming.pattern !== undefined ? patch.naming.pattern : node.naming.pattern, tokens: Object.assign({}, node.naming.tokens, patch.naming.tokens || {}) };
        Object.keys(node.naming.tokens).forEach((k) => { if (node.naming.tokens[k] === '' || node.naming.tokens[k] === null) delete node.naming.tokens[k]; });
      } else if (key === 'attributes' || key === 'display') {
        node[key] = Object.assign({}, node[key], patch[key]);
      } else {
        node[key] = patch[key];
      }
    });
    if (Catalog.get(node.type).annotation) node.attributes = Annotations.normalize(node.type, node.attributes);
    touch(project);
    return node;
  }

  /** Remove nodes including their descendants and any connection touching them. */
  function removeNodes(project, ids) {
    const doomed = new Set();
    (ids || []).forEach((id) => {
      if (!getNode(project, id)) return;
      doomed.add(id);
      descendants(project, id).forEach((d) => doomed.add(d.id));
    });
    doomed.forEach((id) => delete project.nodes[id]);
    Object.keys(project.nodes).forEach((id) => {
      const n = project.nodes[id];
      if (Array.isArray(n.network) && n.network.some((nid) => doomed.has(nid))) n.network = n.network.filter((nid) => !doomed.has(nid));
    });
    Object.keys(project.connections).forEach((cid) => {
      const c = project.connections[cid];
      if (doomed.has(c.from) || doomed.has(c.to)) delete project.connections[cid];
    });
    if (doomed.size) touch(project);
    return Array.from(doomed);
  }

  /** Only keep ids that are not descendants of other ids in the list. */
  function topLevelOnly(project, ids) {
    const set = new Set(ids);
    return ids.filter((id) => !ancestors(project, id).some((a) => set.has(a.id)));
  }

  /** Move nodes (and their descendants) by a delta. */
  function moveNodes(project, ids, dx, dy) {
    const moved = new Set();
    topLevelOnly(project, ids).forEach((id) => {
      [getNode(project, id)].concat(descendants(project, id)).forEach((n) => {
        if (n && !moved.has(n.id)) {
          n.x += dx;
          n.y += dy;
          moved.add(n.id);
        }
      });
    });
    Object.keys(project.connections).forEach((id) => {
      const c = project.connections[id];
      if (moved.has(c.from) && moved.has(c.to) && c.waypoints && c.waypoints.length) {
        c.waypoints = cleanWaypoints(c.waypoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })));
      }
    });
    if (moved.size) touch(project);
    return moved.size;
  }

  /**
   * Move a node to a new parent. Validates the hierarchy and prevents cycles.
   * @returns {boolean} true when re-parented.
   */
  function reparent(project, id, newParentId) {
    const node = getNode(project, id);
    if (!node) return false;
    const target = newParentId || null;
    if ((node.parentId || null) === target) return false;
    if (target && isSelfOrDescendant(project, id, target)) return false;
    if (!canContain(project, target, node.type)) return false;
    node.parentId = target;
    touch(project);
    return true;
  }

  /** Add a connection between two nodes. */
  function addConnection(project, from, to, props) {
    if (!getNode(project, from) || !getNode(project, to) || from === to) return undefined;
    const p = props || {};
    const kind = CONNECTION_KINDS.some((k) => k.id === p.kind) ? p.kind : 'flow';
    const conn = {
      id: p.id && Util.isValidId(p.id) && !project.connections[p.id] ? p.id : Util.uid('c'),
      from,
      to,
      kind,
      direction: cleanDirection(p.direction),
      label: p.label ? String(p.label) : '',
      attributes: Object.assign({ protocol: '' }, p.attributes || {}),
      waypoints: cleanWaypoints(p.waypoints),
      sourceAnchor: cleanAnchor(p.sourceAnchor),
      targetAnchor: cleanAnchor(p.targetAnchor)
    };
    project.connections[conn.id] = conn;
    touch(project);
    return conn;
  }

  function updateConnection(project, id, patch) {
    const c = project.connections[id];
    if (!c) return undefined;
    Object.keys(patch || {}).forEach((key) => {
      if (key === 'id' || key === 'from' || key === 'to') return;
      if (key === 'direction') c.direction = cleanDirection(patch.direction);
      else if (key === 'waypoints') c.waypoints = cleanWaypoints(patch.waypoints);
      else if (key === 'sourceAnchor' || key === 'targetAnchor') c[key] = cleanAnchor(patch[key]);
      else if (key === 'attributes') c.attributes = Object.assign({}, c.attributes, patch.attributes);
      else c[key] = patch[key];
    });
    touch(project);
    return c;
  }

  /** Return all arrows to automatic routing without changing their endpoints or resources. */
  function resetConnectionRoutes(project) {
    let count = 0;
    Object.values(project.connections).forEach((c) => {
      if (!(c.waypoints && c.waypoints.length) && !c.sourceAnchor && !c.targetAnchor) return;
      c.waypoints = [];
      c.sourceAnchor = null;
      c.targetAnchor = null;
      count++;
    });
    if (count) touch(project);
    return count;
  }

  function removeConnections(project, ids) {
    let n = 0;
    (ids || []).forEach((id) => {
      if (project.connections[id]) {
        delete project.connections[id];
        n++;
      }
    });
    if (n) touch(project);
    return n;
  }

  // ---------------------------------------------------------------------------
  // Clipboard support (copy / paste / duplicate)
  // ---------------------------------------------------------------------------

  /**
   * Extract nodes (with their descendants) and the connections between them into a
   * self-contained clipboard payload.
   */
  function extract(project, nodeIds, connectionIds) {
    const roots = topLevelOnly(project, (nodeIds || []).filter((id) => getNode(project, id)));
    const included = new Set();
    const nodes = [];
    roots.forEach((id) => {
      [getNode(project, id)].concat(descendants(project, id)).forEach((n) => {
        if (!included.has(n.id)) {
          included.add(n.id);
          nodes.push(Util.clone(n));
        }
      });
    });
    const conns = Object.keys(project.connections)
      .map((k) => project.connections[k])
      .filter((c) => (included.has(c.from) && included.has(c.to)) || (connectionIds || []).indexOf(c.id) !== -1)
      .map((c) => Util.clone(c));
    return { format: FORMAT + '/clipboard', version: VERSION, roots, nodes, connections: conns };
  }

  /**
   * Paste a clipboard payload. Root nodes are placed into `targetParentId` when allowed,
   * otherwise into their original parent (when it still exists and accepts them).
   * @returns {{nodeIds: string[], connectionIds: string[], skipped: number}}
   */
  function paste(project, untrusted, targetParentId, offset) {
    const result = { nodeIds: [], connectionIds: [], skipped: 0 };
    const payload = sanitizeClipboard(untrusted);
    if (!payload) return result;
    const Naming = AISBP.Naming || (typeof require === 'function' ? require('./naming.js') : null);
    const dx = offset && Number.isFinite(offset.dx) ? offset.dx : 30;
    const dy = offset && Number.isFinite(offset.dy) ? offset.dy : 30;
    const idMap = {};
    const byId = {};
    const pendingNetwork = [];
    payload.nodes.forEach((n) => { if (n && Util.isValidId(n.id)) byId[n.id] = n; });
    const roots = (payload.roots || []).filter((id) => byId[id]);
    const insert = (src, parentId) => {
      if (!Catalog.get(src.type) || !canContain(project, parentId, src.type)) {
        result.skipped++;
        return;
      }
      const node = addNode(project, src.type, parentId, {
        x: (Number(src.x) || 0) + dx,
        y: (Number(src.y) || 0) + dy,
        label: src.label,
        name: src.name,
        nameMode: src.nameMode,
        naming: src.naming,
        attributes: src.attributes,
        custom: src.custom,
        tags: src.tags,
        display: src.display,
        w: src.w,
        h: src.h
      });
      Naming.renumberCopy(project, node);
      if (Array.isArray(src.network) && src.network.length) pendingNetwork.push([node.id, src.network]);
      idMap[src.id] = node.id;
      result.nodeIds.push(node.id);
      payload.nodes.filter((c) => c.parentId === src.id).sort((a, b) => a.seq - b.seq).forEach((c) => insert(c, node.id));
    };
    roots.forEach((rid) => {
      const src = byId[rid];
      let parent = targetParentId || null;
      if (!canContain(project, parent, src.type)) {
        // Try the parent of the target, then the original parent.
        const t = getNode(project, targetParentId);
        if (t && canContain(project, t.parentId, src.type)) parent = t.parentId;
        else if (src.parentId && getNode(project, src.parentId) && canContain(project, src.parentId, src.type)) parent = src.parentId;
        else if (canContain(project, null, src.type)) parent = null;
      }
      insert(src, parent);
    });
    // Network links: point to pasted copies when the VNet/subnet was copied too, else to existing ones.
    pendingNetwork.forEach(([id, links]) => {
      project.nodes[id].network = links.map((nid) => idMap[nid] || nid).filter((nid, i, a) => isNetworkTarget(project, nid) && a.indexOf(nid) === i);
    });
    (payload.connections || []).forEach((c) => {
      const from = idMap[c.from] || (getNode(project, c.from) ? c.from : null);
      const to = idMap[c.to] || (getNode(project, c.to) ? c.to : null);
      if (!from || !to || (!idMap[c.from] && !idMap[c.to])) return;
      const waypoints = cleanWaypoints(c.waypoints).map((pt) => ({
        x: pt.x + (idMap[c.from] && idMap[c.to] ? dx : 0),
        y: pt.y + (idMap[c.from] && idMap[c.to] ? dy : 0)
      }));
      const conn = addConnection(project, from, to, { kind: c.kind, direction: c.direction, label: c.label, attributes: c.attributes, waypoints, sourceAnchor: c.sourceAnchor, targetAnchor: c.targetAnchor });
      if (conn) result.connectionIds.push(conn.id);
    });
    return result;
  }

  /**
   * Validate an (untrusted) clipboard payload, e.g. read from the system clipboard.
   * Nodes and connections are passed through `normalize`, so the same rules apply as for
   * imported configuration packages.
   * @returns {object|null} a clean payload or null when it is not a clipboard payload
   */
  function sanitizeClipboard(payload) {
    if (!payload || typeof payload !== 'object' || payload.format !== FORMAT + '/clipboard' || !Array.isArray(payload.nodes)) return null;
    const nodes = {};
    const originalParents = {};
    const originalNetwork = {};
    payload.nodes.slice(0, 5000).forEach((n) => {
      if (n && Util.isValidId(n.id) && !Object.prototype.hasOwnProperty.call(nodes, n.id)) {
        nodes[n.id] = n;
        originalParents[n.id] = Util.isValidId(n.parentId) ? n.parentId : null;
        originalNetwork[n.id] = cleanIdList(n.network);
      }
    });
    const connections = {};
    (Array.isArray(payload.connections) ? payload.connections.slice(0, 5000) : []).forEach((c) => {
      if (c && Util.isValidId(c.id)) connections[c.id] = c;
    });
    // Connections may reference nodes outside the payload (existing objects): keep them aside.
    const outside = (Array.isArray(payload.connections) ? payload.connections : []).filter((c) => c && Util.isValidId(c.id) && Util.isValidId(c.from) && Util.isValidId(c.to) && (!nodes[c.from] || !nodes[c.to]));
    const clean = normalize({ format: FORMAT, version: VERSION, meta: {}, settings: {}, nodes, connections }).project;
    const list = Object.keys(clean.nodes).map((k) => clean.nodes[k]);
    list.forEach((n) => {
      if (!n.parentId) n.parentId = originalParents[n.id];
      // Links may point to VNets/subnets outside the payload; `paste` validates them.
      if (Catalog.supportsNetwork(n.type)) n.network = originalNetwork[n.id];
    });
    return {
      format: FORMAT + '/clipboard',
      version: VERSION,
      roots: (Array.isArray(payload.roots) ? payload.roots : []).filter((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(clean.nodes, id)),
      nodes: list,
      connections: Object.keys(clean.connections).map((k) => clean.connections[k]).concat(outside.map((c) => ({
        id: c.id, from: c.from, to: c.to,
        kind: CONNECTION_KINDS.some((k) => k.id === c.kind) ? c.kind : 'flow',
        direction: cleanDirection(c.direction),
        label: str(c.label, 200),
        attributes: cleanMap(c.attributes),
        waypoints: cleanWaypoints(c.waypoints),
        sourceAnchor: cleanAnchor(c.sourceAnchor),
        targetAnchor: cleanAnchor(c.targetAnchor)
      })))
    };
  }

  // ---------------------------------------------------------------------------
  // Validation / import (used for configuration packages and stored projects)
  // ---------------------------------------------------------------------------

  const str = (v, max) => (v === undefined || v === null ? '' : String(v)).slice(0, max || 4000);

  /** Sanitize routing coordinates before they enter SVG/XML or interactive geometry. */
  function cleanWaypoints(points) {
    if (!Array.isArray(points)) return [];
    return points.slice(0, 100).filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
      .map((pt) => ({ x: Util.clamp(pt.x, -100000, 100000), y: Util.clamp(pt.y, -100000, 100000) }));
  }

  function cleanAnchor(anchor) {
    if (!anchor || !['top', 'right', 'bottom', 'left'].includes(anchor.side) || !Number.isFinite(anchor.offset)) return null;
    return { side: anchor.side, offset: Util.clamp(anchor.offset, 0, 1) };
  }

  function reverseConnection(project, id) {
    const c = project.connections[id];
    if (!c) return;
    [c.from, c.to] = [c.to, c.from];
    [c.sourceAnchor, c.targetAnchor] = [cleanAnchor(c.targetAnchor), cleanAnchor(c.sourceAnchor)];
    c.waypoints = cleanWaypoints(c.waypoints).reverse();
    touch(project);
    return c;
  }

  /** Sanitize a list of node ids (deduplicated, at most 200). */
  function cleanIdList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((id, i) => Util.isValidId(id) && list.indexOf(id) === i).slice(0, 200);
  }

  /** Sanitize a flat object of primitive values with safe keys. */
  function cleanMap(obj, maxLen) {
    const out = {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
    Object.keys(obj).forEach((k) => {
      if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(k)) return;
      const v = obj[k];
      if (typeof v === 'boolean' || typeof v === 'number') out[k] = v;
      else if (typeof v === 'string') out[k] = v.slice(0, maxLen || 4000);
    });
    return out;
  }

  /**
   * Validate and normalize an untrusted project object (e.g. from an imported file).
   * Unknown properties are dropped, unknown types and orphaned references are removed.
   * @returns {{project: object, warnings: string[]}}
   * @throws {Error} when the input is not a project at all.
   */
  function normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('Not a valid AIS BluePrinter project.');
    if (input.format !== FORMAT) throw new Error('Unknown file format (expected "' + FORMAT + '").');
    if (typeof input.version !== 'number' || input.version > VERSION) throw new Error('Unsupported project version: ' + input.version);
    const warnings = [];
    const meta = input.meta || {};
    const project = createProject({ name: str(meta.name, 200) || 'Imported blueprint' });
    project.meta.id = Util.isValidId(meta.id) ? meta.id : project.meta.id;
    project.meta.description = str(meta.description, 4000);
    project.meta.author = str(meta.author, 200);
    project.meta.created = str(meta.created, 40) || project.meta.created;
    project.meta.modified = str(meta.modified, 40) || project.meta.modified;
    project.settings = deepMerge(defaultSettings(), sanitizeSettings(input.settings));

    const rawNodes = input.nodes && typeof input.nodes === 'object' ? input.nodes : {};
    let maxSeq = 0;
    Object.keys(rawNodes).forEach((key) => {
      const n = rawNodes[key];
      if (!n || !Util.isValidId(n.id) || n.id !== key) return warnings.push('Skipped node with invalid id.');
      if (!Catalog.get(n.type)) return warnings.push('Skipped node of unknown type "' + str(n.type, 60) + '".');
      const seq = Number.isFinite(n.seq) ? n.seq : 0;
      maxSeq = Math.max(maxSeq, seq);
      project.nodes[n.id] = {
        id: n.id,
        type: n.type,
        parentId: Util.isValidId(n.parentId) ? n.parentId : null,
        seq,
        label: str(n.label, 200),
        nameMode: n.nameMode === 'custom' ? 'custom' : 'convention',
        name: str(n.name, 260),
        naming: { pattern: str(n.naming && n.naming.pattern, 200), tokens: cleanMap(n.naming && n.naming.tokens, 100) },
        attributes: Catalog.get(n.type).annotation ? Annotations.normalize(n.type, n.attributes) : cleanMap(n.attributes),
        custom: Array.isArray(n.custom) ? n.custom.slice(0, 200).map((c) => ({ key: str(c && c.key, 100), value: str(c && c.value, 2000) })) : [],
        tags: Tags.sanitize(n.tags),
        display: cleanMap(n.display),
        network: cleanIdList(n.network),
        x: Number.isFinite(n.x) ? n.x : 0,
        y: Number.isFinite(n.y) ? n.y : 0
      };
      // Older blueprints stored tags as a "key=value per line" text attribute.
      const legacy = project.nodes[n.id].attributes.tags;
      if (legacy !== undefined) {
        if (!project.nodes[n.id].tags.length) project.nodes[n.id].tags = Tags.parseText(legacy);
        delete project.nodes[n.id].attributes.tags;
      }
      if (validSize(n.w) && validSize(n.h)) {
        project.nodes[n.id].w = n.w;
        project.nodes[n.id].h = n.h;
      }
    });
    // Fix hierarchy: drop references to missing parents, invalid placements and cycles.
    Object.keys(project.nodes).forEach((id) => {
      const n = project.nodes[id];
      if (n.parentId && !project.nodes[n.parentId]) {
        warnings.push('Node "' + id + '" referenced a missing parent and was moved to the top level.');
        n.parentId = null;
      }
    });
    Object.keys(project.nodes).forEach((id) => {
      const n = project.nodes[id];
      const seen = new Set([id]);
      let p = n.parentId;
      while (p) {
        if (seen.has(p)) {
          warnings.push('Cycle detected at "' + id + '"; moved to the top level.');
          n.parentId = null;
          break;
        }
        seen.add(p);
        p = project.nodes[p] ? project.nodes[p].parentId : null;
      }
    });
    Object.keys(project.nodes).forEach((id) => {
      const n = project.nodes[id];
      const parent = n.parentId ? project.nodes[n.parentId] : null;
      if (!Catalog.canContain(parent ? parent.type : null, n.type)) {
        warnings.push('"' + (n.name || n.label || id) + '" is not allowed inside its parent; placement kept but flagged.');
      }
    });
    project.meta.seq = Math.max(maxSeq, Number(meta.seq) || 0);
    // Network links must point to existing virtual networks / subnets on supporting types.
    Object.keys(project.nodes).forEach((id) => {
      const n = project.nodes[id];
      const valid = Catalog.supportsNetwork(n.type) ? n.network.filter((nid) => isNetworkTarget(project, nid)) : [];
      if (valid.length !== n.network.length) warnings.push('Removed invalid network links of "' + (n.name || n.label || id) + '".');
      n.network = valid;
    });

    const rawConns = input.connections && typeof input.connections === 'object' ? input.connections : {};
    Object.keys(rawConns).forEach((key) => {
      const c = rawConns[key];
      if (!c || !Util.isValidId(c.id) || c.id !== key || !project.nodes[c.from] || !project.nodes[c.to]) return warnings.push('Skipped invalid connection.');
      project.connections[c.id] = {
        id: c.id,
        from: c.from,
        to: c.to,
        kind: CONNECTION_KINDS.some((k) => k.id === c.kind) ? c.kind : 'flow',
        direction: cleanDirection(c.direction),
        label: str(c.label, 200),
        attributes: cleanMap(c.attributes),
        waypoints: cleanWaypoints(c.waypoints),
        sourceAnchor: cleanAnchor(c.sourceAnchor),
        targetAnchor: cleanAnchor(c.targetAnchor)
      };
    });
    return { project, warnings };
  }

  /** Whitelist-based settings sanitizer. */
  function sanitizeSettings(s) {
    const out = {};
    if (!s || typeof s !== 'object') return out;
    if (s.naming && typeof s.naming === 'object') {
      out.naming = {
        pattern: str(s.naming.pattern, 200) || undefined,
        childPattern: str(s.naming.childPattern, 200) || undefined,
        tokens: cleanMap(s.naming.tokens, 100),
        instancePadding: Number.isFinite(s.naming.instancePadding) ? Util.clamp(s.naming.instancePadding, 1, 6) : undefined,
        typePatterns: cleanMap(s.naming.typePatterns, 200),
        abbreviations: cleanMap(s.naming.abbreviations, 30),
        regionAbbreviations: cleanMap(s.naming.regionAbbreviations, 20),
        enforce: s.naming.enforce !== false
      };
      Object.keys(out.naming).forEach((k) => out.naming[k] === undefined && delete out.naming[k]);
    }
    if (s.diagram && typeof s.diagram === 'object') {
      const d = s.diagram;
      out.diagram = cleanMap(d, 40);
      delete out.diagram.typeDisplay;
      out.diagram.hiddenContainers = Array.isArray(d.hiddenContainers) ? d.hiddenContainers.filter((t) => typeof t === 'string' && Catalog.get(t)) : [];
      out.diagram.typeDisplay = {};
      if (d.typeDisplay && typeof d.typeDisplay === 'object') {
        Object.keys(d.typeDisplay).forEach((t) => { if (Catalog.get(t)) out.diagram.typeDisplay[t] = cleanMap(d.typeDisplay[t]); });
      }
    }
    if (s.icons && typeof s.icons === 'object' && Util.isSafeImageUrl(s.icons.baseUrl) && !/^data:/i.test(s.icons.baseUrl)) {
      out.icons = { baseUrl: str(s.icons.baseUrl, 500) };
    }
    if (s.tags && typeof s.tags === 'object') out.tags = { definitions: Tags.sanitizeDefinitions(s.tags.definitions) };
    return out;
  }

  AISBP.Model = {
    inheritedTenantAttributes,
    effectiveAttributes,
    FORMAT,
    VERSION,
    CONNECTION_KINDS,
    DIRECTIONS,
    PROTOCOLS,
    cleanWaypoints,
    cleanAnchor,
    reverseConnection,
    defaultSettings,
    deepMerge,
    createProject,
    addSample,
    getNode,
    children,
    descendants,
    ancestors,
    depth,
    closest,
    isSelfOrDescendant,
    canContain,
    effectiveLocation,
    isNetworkTarget,
    networkTargets,
    networkLinks,
    addNode,
    updateNode,
    removeNodes,
    topLevelOnly,
    moveNodes,
    reparent,
    addConnection,
    updateConnection,
    resetConnectionRoutes,
    removeConnections,
    extract,
    paste,
    sanitizeClipboard,
    normalize,
    sanitizeSettings
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Model;
})(typeof globalThis !== 'undefined' ? globalThis : this);
