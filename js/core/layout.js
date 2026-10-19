/**
 * AIS BluePrinter - diagram geometry.
 *
 * Computes the size and position of every object on the canvas:
 *  - leaf resources are fixed-width tiles whose height depends on the attributes shown,
 *  - containers (Azure tenants, management groups, subscriptions, resource groups and resources that have
 *    child resources) automatically grow to wrap their children,
 *  - container types can be hidden (e.g. a high-level view without resource groups); their
 *    children are then drawn directly inside the next visible ancestor.
 *
 * Also contains the logic deciding which attributes are displayed (detail level), hit testing
 * for drag-and-drop, free-spot search for new objects and an automatic tidy-up layout.
 *
 * @module AISBP.Layout
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('./catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('./model.js') : null);
  const Naming = AISBP.Naming || (typeof require === 'function' ? require('./naming.js') : null);
  const Tags = AISBP.Tags || (typeof require === 'function' ? require('./tags.js') : null);

  const LEAF_W = 170;
  const ICON = 44;
  const LINE = 13;
  const NAME_LINE = 15;
  const PAD = 20;
  const HEADER = 44;
  const MIN_W = 230;
  const MIN_H = 110;
  const LEAF_CHARS = 25;
  const GAP_X = 40;
  const GAP_Y = 40;

  const DETAIL_LEVELS = [
    { id: 'high', label: 'High-level (names only)' },
    { id: 'selected', label: 'Selected attributes' },
    { id: 'detailed', label: 'Detailed (all attributes)' }
  ];

  /** Format an attribute value for display. */
  function formatValue(attr, value) {
    if (value === undefined || value === null || value === '') return '';
    if (attr && attr.type === 'bool') return value ? 'Yes' : 'No';
    if (attr && attr.key === 'location') {
      if (value === '(inherit)') return '';
      const r = Catalog.region(value);
      return r ? r.label : String(value);
    }
    return String(value).replace(/\s*\n\s*/g, ', ');
  }

  /** Display key of the virtual network / subnet links (see `node.network`). Shown by default. */
  const NETWORK_KEY = 'network';

  /** Readable list of the VNets/subnets a node is attached to ("vnet-a / snet-b, vnet-c"). */
  function networkLabel(project, node) {
    return Model.networkLinks(project, node).map((n) => {
      const own = Naming.resolveName(project, n);
      const parent = n.type === 'subnet' && n.parentId ? project.nodes[n.parentId] : null;
      return parent ? Naming.resolveName(project, parent) + ' / ' + own : own;
    }).join(', ');
  }

  /**
   * Whether an attribute is selected for display, honoring (in order): per-object choice,
   * per-type choice in the options and the catalog default.
   */
  function isAttributeShown(project, node, key) {
    if (node.display && typeof node.display[key] === 'boolean') return node.display[key];
    const td = project.settings.diagram.typeDisplay && project.settings.diagram.typeDisplay[node.type];
    if (td && typeof td[key] === 'boolean') return td[key];
    if (key.indexOf('custom:') === 0) return false;
    if (key === NETWORK_KEY) return true;
    const attr = Catalog.attribute(node.type, key);
    return !!(attr && attr.show);
  }

  /** Attribute lines ({label, value}) to render for a node given the detail level. */
  function visibleAttributes(project, node) {
    const level = project.settings.diagram.detailLevel || 'selected';
    if (level === 'high') return [];
    const def = Catalog.get(node.type);
    const out = [];
    const attributes = Model.effectiveAttributes(project, node.id);
    (def ? def.attributes : []).forEach((attr) => {
      const value = formatValue(attr, attributes[attr.key]);
      if (!value) return;
      if (level === 'detailed' || isAttributeShown(project, node, attr.key)) out.push({ key: attr.key, label: attr.label.replace(/\s*\(.*\)$/, ''), value });
    });
    const links = def && def.network ? networkLabel(project, node) : '';
    if (links && (level === 'detailed' || isAttributeShown(project, node, NETWORK_KEY))) out.push({ key: NETWORK_KEY, label: 'Network', value: links });
    (node.custom || []).forEach((c) => {
      if (!c.key || c.value === '') return;
      if (level === 'detailed' || isAttributeShown(project, node, 'custom:' + c.key)) out.push({ key: 'custom:' + c.key, label: c.key, value: String(c.value) });
    });
    return out;
  }

  /** Truncate text with an ellipsis. */
  function truncate(s, max) {
    const t = String(s || '');
    return t.length > max ? t.slice(0, Math.max(1, max - 1)) + '\u2026' : t;
  }

  /** Wrap a resource name on separators into at most `maxLines` lines. */
  function wrapName(name, maxChars, maxLines) {
    const lines = [];
    let rest = String(name || '');
    while (rest.length > maxChars && lines.length < maxLines - 1) {
      let cut = -1;
      for (let i = maxChars; i > maxChars / 2; i--) {
        if ('-_. '.indexOf(rest[i - 1]) !== -1) { cut = i; break; }
      }
      if (cut < 0) cut = maxChars;
      lines.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    lines.push(truncate(rest, maxChars));
    return lines;
  }

  /** Resolve the names of all nodes once (names are needed for sizes and rendering). */
  function resolveNames(project) {
    const names = {};
    Object.keys(project.nodes).forEach((id) => { names[id] = Naming.resolveName(project, project.nodes[id]); });
    return names;
  }

  /** Whether a node has a manual (user-resized) size. */
  function hasManualSize(node) {
    return Number.isFinite(node.w) && Number.isFinite(node.h) && node.w > 0 && node.h > 0;
  }

  /** Whether a node is drawn as a container. */
  function isContainer(project, node, childIndex) {
    const def = Catalog.get(node.type);
    if (def && def.annotation) return false;
    return !!(def && def.container) || !!(childIndex[node.id] && childIndex[node.id].length);
  }

  /**
   * Compute the geometry of every node.
   * @param {object} project
   * @param {object} [names] pre-resolved names (see resolveNames)
   * @param {object} [opts] {
   *   detached: Set<string>  nodes that do not stretch their container (used while dragging so
   *                          objects can be dragged out of a container),
   *   frozen: Object<string,{x,y,w,h}>  minimum rects for containers (used while dragging so a
   *                          container keeps its boundary and the object is not detached while
   *                          the pointer is still inside it),
   *   root: string  only measure this node and its descendants (rects of other nodes are
   *                 omitted and bounds are not meaningful; used by autoLayout for speed),
   *   childIndex: object  pre-built child index (from a previous result) when the hierarchy
   *                 and order did not change
   * }
   * Containers wrap their children and are at least MIN_W x MIN_H. A container with a manual
   * size (node.w / node.h, set by resizing it on the canvas) is at least that size, measured
   * from its own x/y; it never becomes smaller than its contents.
   * @returns {{rects: Object<string, object>, bounds: {x,y,w,h}, names: Object<string,string>}}
   * Each rect: { id, x, y, w, h, container, hidden, depth, name, nameLines, typeLabel, attrs, headerH,
   *              tags: { rows: [[{text,color,w,title}]], height } }
   * Tags are wrapped into rows of chips (at most Tags.CHIP.maxRows, then a "+N" chip): below
   * the attributes of a leaf, and in the header of a container.
   */
  function compute(project, names, opts) {
    const nm = names || resolveNames(project);
    const detached = (opts && opts.detached) || new Set();
    const frozen = (opts && opts.frozen) || {};
    const diagram = project.settings.diagram;
    const hidden = new Set(diagram.hiddenContainers || []);
    let childIndex = opts && opts.childIndex;
    if (!childIndex) {
      childIndex = {};
      Object.keys(project.nodes).forEach((id) => {
        const n = project.nodes[id];
        const key = n.parentId && project.nodes[n.parentId] ? n.parentId : '';
        (childIndex[key] = childIndex[key] || []).push(n);
      });
      Object.keys(childIndex).forEach((k) => childIndex[k].sort((a, b) => a.seq - b.seq));
    }
    const rects = {};

    const measure = (node, depth) => {
      const def = Catalog.get(node.type);
      const container = isContainer(project, node, childIndex);
      const attrs = visibleAttributes(project, node);
      const typeLabel = diagram.showTypeLabels !== false && def ? def.label : '';
      const isHidden = container && hidden.has(node.type);
      const tagList = Tags.visible(project, node);
      const r = { id: node.id, type: node.type, container, hidden: isHidden, depth, name: nm[node.id] || '', typeLabel, attrs, tags: { rows: [], height: 0 } };
      const kids = (childIndex[node.id] || []).map((c) => measure(c, isHidden ? depth : depth + 1));
      if (def && def.annotation) {
        r.annotation = AISBP.Annotations.measure(node, diagram.style);
        r.w = r.annotation.w;
        r.h = r.annotation.h;
        r.x = node.x;
        r.y = node.y;
        r.nameLines = [r.name];
        r.attrs = [];
        r.typeLabel = '';
      } else if (!container) {
        r.nameLines = wrapName(r.name, LEAF_CHARS, 2);
        r.w = LEAF_W;
        r.tags = Tags.chipRows(tagList, LEAF_W - 16);
        r.h = 10 + ICON + 8 + r.nameLines.length * NAME_LINE + (typeLabel ? LINE : 0) + (attrs.length ? 4 + attrs.length * LINE : 0) + (r.tags.height ? 6 + r.tags.height : 0) + 10;
        r.x = node.x;
        r.y = node.y;
      } else {
        const visibleKids = kids.filter((k) => k && k.w && !detached.has(k.id));
        if (tagList.length && !isHidden) r.tags = Tags.chipRows(tagList, chipWidth(node, visibleKids, frozen));
        r.headerH = HEADER + (attrs.length ? attrs.length * LINE + 4 : 0) + (r.tags.height ? r.tags.height + 6 : 0);
        let x1 = node.x;
        let y1 = node.y;
        let x2 = node.x + MIN_W;
        let y2 = node.y + Math.max(MIN_H, r.headerH + 40);
        if (isHidden) {
          if (visibleKids.length) {
            x1 = Math.min.apply(null, visibleKids.map((k) => k.x));
            y1 = Math.min.apply(null, visibleKids.map((k) => k.y));
            x2 = Math.max.apply(null, visibleKids.map((k) => k.x + k.w));
            y2 = Math.max.apply(null, visibleKids.map((k) => k.y + k.h));
          } else {
            x2 = x1; y2 = y1;
          }
        } else {
          if (hasManualSize(node)) {
            x2 = Math.max(x2, node.x + node.w);
            y2 = Math.max(y2, node.y + node.h);
          }
          visibleKids.forEach((k) => {
            x1 = Math.min(x1, k.x - PAD);
            y1 = Math.min(y1, k.y - r.headerH - PAD / 2);
            x2 = Math.max(x2, k.x + k.w + PAD);
            y2 = Math.max(y2, k.y + k.h + PAD);
          });
          const f = Object.prototype.hasOwnProperty.call(frozen, node.id) ? frozen[node.id] : null;
          if (f) {
            x1 = Math.min(x1, f.x);
            y1 = Math.min(y1, f.y);
            x2 = Math.max(x2, f.x + f.w);
            y2 = Math.max(y2, f.y + f.h);
          }
        }
        r.x = x1; r.y = y1; r.w = x2 - x1; r.h = y2 - y1;
        const maxChars = Math.max(10, Math.floor((r.w - 60) / 7));
        r.nameLines = [truncate(r.name, maxChars)];
      }
      rects[node.id] = r;
      return r;
    };

    const root = opts && opts.root ? project.nodes[opts.root] : null;
    if (root) {
      measure(root, 0);
      return { rects, bounds: boundsOf([]), names: nm, childIndex };
    }
    (childIndex[''] || []).forEach((n) => measure(n, 0));
    const boundsRects = Object.keys(rects).map((k) => rects[k]).filter((r) => !r.hidden && r.w);
    Object.keys(project.connections).forEach((id) => {
      const c = project.connections[id];
      if (!rects[c.from] || !rects[c.to] || rects[c.from].hidden || rects[c.to].hidden) return;
      Model.cleanWaypoints(c.waypoints).forEach((pt) => boundsRects.push({ x: pt.x, y: pt.y, w: 0, h: 0 }));
      // Automatic obstacle avoidance and fixed anchors may route outside the node bounds.
      if (diagram.connector === 'orthogonal' && AISBP.Render && AISBP.Render.connectionPath) {
        const path = AISBP.Render.connectionPath(project, c, { rects });
        if (path) {
          path.vertices.forEach((pt) => boundsRects.push({ x: pt.x, y: pt.y, w: 0, h: 0 }));
          if (path.labelBounds) boundsRects.push(path.labelBounds);
        }
      }
    });
    return { rects, bounds: boundsOf(boundsRects), names: nm, childIndex };
  }

  /**
   * Width available for the tag chips in a container header: the width the container gets
   * from its minimum / manual size, its children and a frozen boundary (horizontal extent
   * only, which does not depend on the header height).
   */
  function chipWidth(node, visibleKids, frozen) {
    let x1 = node.x;
    let x2 = node.x + MIN_W;
    if (hasManualSize(node)) x2 = Math.max(x2, node.x + node.w);
    visibleKids.forEach((k) => { x1 = Math.min(x1, k.x - PAD); x2 = Math.max(x2, k.x + k.w + PAD); });
    const f = Object.prototype.hasOwnProperty.call(frozen, node.id) ? frozen[node.id] : null;
    if (f) { x1 = Math.min(x1, f.x); x2 = Math.max(x2, f.x + f.w); }
    return x2 - x1 - 24;
  }

  /** Bounding box of rectangles (with a default when empty). */
  function boundsOf(list) {
    if (!list.length) return { x: 0, y: 0, w: 800, h: 600 };
    const x1 = Math.min.apply(null, list.map((r) => r.x));
    const y1 = Math.min.apply(null, list.map((r) => r.y));
    const x2 = Math.max.apply(null, list.map((r) => r.x + r.w));
    const y2 = Math.max.apply(null, list.map((r) => r.y + r.h));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /**
   * Find the deepest visible node under a point.
   * @param {object} geometry result of compute()
   * @param {{x:number,y:number}} pt canvas coordinates
   * @param {object} [opts] { exclude: Set<string>, containersOnly: boolean }
   */
  function hitTest(geometry, pt, opts) {
    const o = opts || {};
    let best = null;
    Object.keys(geometry.rects).forEach((id) => {
      const r = geometry.rects[id];
      if (r.hidden || (o.exclude && o.exclude.has(id))) return;
      if (o.containersOnly && !r.container) return;
      if (pt.x < r.x || pt.y < r.y || pt.x > r.x + r.w || pt.y > r.y + r.h) return;
      const score = (r.container ? 0 : 1000) + r.depth;
      if (!best || score > best.score) best = { id, score };
    });
    return best ? best.id : null;
  }

  /**
   * Find the deepest visible container under a point that accepts the given type.
   * Hidden containers are resolved through their children so that dropping still works when,
   * for example, resource groups are hidden.
   */
  function dropTarget(project, geometry, pt, type, exclude) {
    const candidates = Object.keys(geometry.rects)
      .map((id) => geometry.rects[id])
      // Objects without children (e.g. an empty virtual network) are not drawn as containers yet,
      // but still accept the types they can contain.
      .filter((r) => (r.container || (!r.hidden && Model.canContain(project, r.id, type))) && !(exclude && exclude.has(r.id)) && pt.x >= r.x && pt.y >= r.y && pt.x <= r.x + r.w && pt.y <= r.y + r.h && r.w > 0)
      .sort((a, b) => b.depth - a.depth || (a.hidden ? 1 : 0) - (b.hidden ? 1 : 0));
    for (let i = 0; i < candidates.length; i++) {
      if (Model.canContain(project, candidates[i].id, type)) return candidates[i].id;
    }
    return Model.canContain(project, null, type) ? null : undefined;
  }

  /** Default size used when placing a new node of a type. */
  function defaultSize(typeId) {
    const def = Catalog.get(typeId);
    if (def && def.annotation) {
      const size = AISBP.Annotations.measure({ type: typeId, attributes: {} });
      return { w: size.w, h: size.h };
    }
    return def && def.container ? { w: MIN_W, h: MIN_H } : { w: LEAF_W, h: 110 };
  }

  /**
   * Find a free spot for a new node of `typeId` inside `parentId` (null = root).
   * Scans a grid inside the parent's content area for a position that does not overlap
   * existing siblings.
   */
  function findFreeSpot(project, parentId, typeId, geometry) {
    const g = geometry || compute(project);
    const size = defaultSize(typeId);
    const siblings = Model.children(project, parentId).map((c) => g.rects[c.id]).filter(Boolean);
    let ox = 40;
    let oy = 40;
    const parent = parentId ? g.rects[parentId] : null;
    if (parent) {
      ox = parent.x + PAD;
      oy = parent.y + (parent.headerH || HEADER) + PAD / 2;
    } else if (siblings.length) {
      ox = Math.min.apply(null, siblings.map((s) => s.x));
      oy = Math.min.apply(null, siblings.map((s) => s.y));
    }
    const stepX = size.w + GAP_X;
    const stepY = 50;
    const cols = parent ? Math.max(4, Math.floor(parent.w / stepX)) : 6;
    for (let row = 0; row < 400; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ox + col * stepX;
        const y = oy + row * stepY;
        const box = { x: x - 10, y: y - 10, w: size.w + 20, h: size.h + 20 };
        const overlaps = siblings.some((s) => box.x < s.x + s.w && box.x + box.w > s.x && box.y < s.y + s.h && box.y + box.h > s.y);
        if (!overlaps) return { x, y };
      }
    }
    return { x: ox, y: oy };
  }

  /**
   * Tidy up: lay out the whole blueprint (or the subtree of `rootId`) in rows.
   * Children are positioned relative to their container; containers wrap their children.
   * Manual container sizes in scope are reset, so containers shrink back to what they need.
   */
  function autoLayout(project, rootId) {
    const names = resolveNames(project);
    // Manually resized containers go back to the size their contents need.
    const scope = rootId ? [Model.getNode(project, rootId)].concat(Model.descendants(project, rootId)) : Object.keys(project.nodes).map((k) => project.nodes[k]);
    scope.forEach((n) => { if (n) { delete n.w; delete n.h; } });
    const maxRowWidth = 1400;
    // The hierarchy does not change while arranging, so the child index is built once and only
    // the subtree of the node being placed is measured (sizes only depend on the subtree).
    const childIndex = compute(project, names).childIndex;
    const measure = (node) => compute(project, names, { root: node.id, childIndex }).rects[node.id];
    const flowOrder = (kids) => {
      const owner = new Map();
      kids.forEach((kid) => {
        owner.set(kid.id, kid.id);
        Model.descendants(project, kid.id).forEach((node) => owner.set(node.id, kid.id));
      });
      const edges = new Map(kids.map((kid) => [kid.id, new Set()]));
      const gaps = new Map();
      const participants = new Set();
      const dependencies = new Map();
      const incoming = new Map(kids.map((kid) => [kid.id, 0]));
      Object.values(project.connections).forEach((c) => {
        const from = owner.get(c.from), to = owner.get(c.to);
        if (!from || !to || from === to) return;
        const text = [c.label, c.attributes && c.attributes.protocol && c.attributes.protocol !== c.label ? c.attributes.protocol : ''].filter(Boolean).join(' \u00b7 ');
        const gap = project.settings.diagram.showConnectionLabels !== false && text ?
          Math.max(GAP_X, truncate(text, 40).length * 5.8 + 34) : GAP_X;
        const key = [from, to].sort().join(':');
        gaps.set(key, Math.max(gaps.get(key) || GAP_X, gap));
        if (c.kind === 'dependency') {
          if (!dependencies.has(to)) dependencies.set(to, from);
          return;
        }
        if (['flow', 'trigger'].includes(c.kind)) { participants.add(from); participants.add(to); }
        if (!['flow', 'trigger'].includes(c.kind) || c.direction === 'bidirectional' || edges.get(from).has(to)) return;
        edges.get(from).add(to);
        incoming.set(to, incoming.get(to) + 1);
      });
      const pending = kids.slice(), ordered = [];
      while (pending.length) {
        // Cycles keep their creation order instead of making tidy-up unstable.
        let index = pending.findIndex((kid) => incoming.get(kid.id) === 0);
        if (index < 0) index = 0;
        const kid = pending.splice(index, 1)[0];
        ordered.push(kid);
        edges.get(kid.id).forEach((id) => incoming.set(id, incoming.get(id) - 1));
      }
      const connected = Array.from(edges.values()).some((set) => set.size);
      const support = connected ? ordered.filter((kid) =>
        !participants.has(kid.id) && participants.has(dependencies.get(kid.id))) : [];
      return { kids: ordered.filter((kid) => !support.includes(kid)), support, dependencies, gaps, connected };
    };
    const lane = (node) => {
      const kids = childIndex[node.id] || [];
      const def = Catalog.get(node.type);
      // Content, rather than nested hierarchy headers, defines the visual flow baseline.
      if (kids.length && !(def && def.annotation)) {
        const lanes = flowOrder(kids).kids.map(lane);
        return (Math.min(...lanes) + Math.max(...lanes)) / 2;
      }
      const r = measure(node);
      return r.y + r.h / 2;
    };
    const shift = (node, dx, dy) => {
      // Tidy moves geometry only; saved absolute routes stay under the user's control.
      [node].concat(Model.descendants(project, node.id)).forEach((n) => { n.x += dx; n.y += dy; });
    };
    const layoutChildren = (parentId, originX, originY, headerH) => {
      const flow = flowOrder(Model.children(project, parentId));
      const kids = flow.kids;
      // Keep root-level producers, the Azure hierarchy and consumers in one flow row.
      const rowWidth = !parentId && flow.connected ? Infinity : maxRowWidth;
      let cx = originX;
      let cy = originY + headerH;
      let rowH = 0;
      let row = [];
      const alignRow = () => {
        if (!flow.connected || row.length < 2) return;
        const baseline = Math.max(...row.map(lane));
        row.forEach((kid) => shift(kid, 0, baseline - lane(kid)));
        rowH = Math.max(...row.map((kid) => {
          const r = measure(kid);
          return r.y + r.h - cy;
        }));
      };
      kids.forEach((kid, index) => {
        if (row.length) {
          const previous = kids[index - 1];
          cx += (flow.gaps.get([previous.id, kid.id].sort().join(':')) || GAP_X) - GAP_X;
        }
        const size = place(kid, cx, cy);
        if (cx > originX && cx + size.w - originX > rowWidth) {
          alignRow();
          // wrap to the next row
          shift(kid, originX - cx, rowH + GAP_Y);
          cy += rowH + GAP_Y;
          cx = originX;
          rowH = 0;
          row = [];
        }
        row.push(kid);
        cx += size.w + GAP_X;
        rowH = Math.max(rowH, size.h);
      });
      alignRow();
      if (flow.support.length) {
        const bottom = Math.max(...kids.map((kid) => { const r = measure(kid); return r.y + r.h; }));
        let right = originX - GAP_X;
        flow.support.forEach((kid) => {
          const owner = project.nodes[flow.dependencies.get(kid.id)];
          const related = measure(owner);
          const size = place(kid, originX, bottom + GAP_Y);
          const x = Math.max(originX, related.x + (related.w - size.w) / 2, right + GAP_X);
          shift(kid, x - originX, 0);
          right = x + size.w;
        });
      }
    };
    const place = (node, x, y) => {
      node.x = x;
      node.y = y;
      const r = measure(node);
      if (r && r.container) {
        layoutChildren(node.id, x + PAD, y, (r.hidden ? 0 : r.headerH) + PAD / 2);
      }
      const after = measure(node);
      return { w: after.w, h: after.h };
    };
    if (rootId) {
      const node = Model.getNode(project, rootId);
      if (node) place(node, node.x, node.y);
    } else {
      layoutChildren(null, 40, 40, 0);
    }
    return project;
  }

  AISBP.Layout = {
    LEAF_W,
    ICON,
    LINE,
    NAME_LINE,
    PAD,
    HEADER,
    MIN_W,
    MIN_H,
    hasManualSize,
    DETAIL_LEVELS,
    formatValue,
    isAttributeShown,
    networkLabel,
    NETWORK_KEY,
    visibleAttributes,
    truncate,
    wrapName,
    resolveNames,
    compute,
    boundsOf,
    hitTest,
    dropTarget,
    defaultSize,
    findFreeSpot,
    autoLayout
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Layout;
})(typeof globalThis !== 'undefined' ? globalThis : this);
