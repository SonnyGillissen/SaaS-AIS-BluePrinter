/**
 * AIS BluePrinter - SVG diagram renderer.
 *
 * Produces SVG markup (as a string) for a project. The same renderer is used for the
 * interactive canvas and for the exports (SVG/PNG/PDF), which guarantees that what you see
 * is what you export. All user supplied text is escaped.
 *
 * @module AISBP.Render
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('../core/util.js') : null);
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('../core/catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('../core/model.js') : null);
  const Tags = AISBP.Tags || (typeof require === 'function' ? require('../core/tags.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('../core/layout.js') : null);

  const esc = Util.escapeXml;
  const FONT = "'Segoe UI', 'Segoe UI Web', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif";

  /**
   * Display styles. Each style defines the colors of the canvas, tiles, containers per
   * hierarchy level and connections.
   */
  const STYLES = {
    classic: {
      label: 'Azure (classic)', font: FONT, background: '#ffffff', grid: '#eef1f5', text: '#1b1b1b', subtext: '#5d6670',
      leafFill: '#ffffff', leafStroke: '#d5dbe3', radius: 8, shadow: true,
      containers: {
        'management-group': { fill: '#f7f2fc', stroke: '#8661c5', dash: '7 4' },
        subscription: { fill: '#fffaeb', stroke: '#d79a2b', dash: '' },
        'resource-group': { fill: '#f0f7fe', stroke: '#0078d4', dash: '5 3' },
        default: { fill: '#f8fafc', stroke: '#9aa7b8', dash: '' }
      },
      edge: '#0063b1', edgeText: '#0b3d6b', edgeLabelBg: '#ffffff', selection: '#ff8c00', error: '#d13438'
    },
    blueprint: {
      label: 'Blueprint', font: "Consolas, 'Cascadia Mono', 'Courier New', monospace", background: '#0d3b66', grid: '#1a4c7c', text: '#ffffff', subtext: '#cfe3ff',
      leafFill: 'rgba(255,255,255,0.05)', leafStroke: '#a9cdf5', radius: 2, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#e9f2ff', dash: '8 4' },
        subscription: { fill: 'none', stroke: '#ffd166', dash: '' },
        'resource-group': { fill: 'rgba(255,255,255,0.03)', stroke: '#a9cdf5', dash: '4 3' },
        default: { fill: 'rgba(255,255,255,0.04)', stroke: '#cfe3ff', dash: '2 2' }
      },
      edge: '#ffd166', edgeText: '#ffffff', edgeLabelBg: '#0d3b66', selection: '#ff7b54', error: '#ff6b6b'
    },
    minimal: {
      label: 'Minimal', font: FONT, background: '#ffffff', grid: '', text: '#222222', subtext: '#6b6b6b',
      leafFill: 'none', leafStroke: 'none', radius: 0, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#b5b5b5', dash: '6 4' },
        subscription: { fill: 'none', stroke: '#9a9a9a', dash: '' },
        'resource-group': { fill: 'none', stroke: '#c7c7c7', dash: '3 3' },
        default: { fill: 'none', stroke: '#d6d6d6', dash: '' }
      },
      edge: '#555555', edgeText: '#333333', edgeLabelBg: '#ffffff', selection: '#0078d4', error: '#c50f1f'
    },
    dark: {
      label: 'Dark', font: FONT, background: '#1b1c20', grid: '#26282e', text: '#f3f3f3', subtext: '#a9b0bb',
      leafFill: '#25272d', leafStroke: '#3b3f4a', radius: 8, shadow: false,
      containers: {
        'management-group': { fill: '#211d2b', stroke: '#a78bfa', dash: '7 4' },
        subscription: { fill: '#2a2518', stroke: '#e8b14b', dash: '' },
        'resource-group': { fill: '#18232f', stroke: '#4fa3ff', dash: '5 3' },
        default: { fill: '#20232a', stroke: '#6b7685', dash: '' }
      },
      edge: '#4fa3ff', edgeText: '#e6f0ff', edgeLabelBg: '#1b1c20', selection: '#ffb347', error: '#ff6b6b'
    },
    sketch: {
      label: 'Whiteboard', font: "'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive", background: '#fffef8', grid: '', text: '#2b2b2b', subtext: '#575757',
      leafFill: '#ffffff', leafStroke: '#2b2b2b', radius: 14, shadow: false,
      containers: {
        'management-group': { fill: 'none', stroke: '#6b4fbb', dash: '10 6' },
        subscription: { fill: '#fff6d5', stroke: '#2b2b2b', dash: '' },
        'resource-group': { fill: '#eaf4ff', stroke: '#2b2b2b', dash: '9 5' },
        default: { fill: '#ffffff', stroke: '#2b2b2b', dash: '' }
      },
      edge: '#2b2b2b', edgeText: '#2b2b2b', edgeLabelBg: '#fffef8', selection: '#e3008c', error: '#c50f1f'
    }
  };

  const CONNECTORS = [
    { id: 'orthogonal', label: 'Orthogonal' },
    { id: 'straight', label: 'Straight' },
    { id: 'curved', label: 'Curved' }
  ];

  function style(id) {
    return STYLES[id] || STYLES.classic;
  }

  /** Styles that are already dark and need no adaptation for the dark application theme. */
  const DARK_STYLES = ['blueprint', 'dark'];
  const editorCache = {};

  /**
   * Style used on the editor canvas. In the dark application theme, light display styles are shown
   * with the colours of the 'Dark' style, keeping their own font, corner radius, dash patterns and
   * transparent ('none') fills, so the character of the style stays recognizable.
   * Exports always use the chosen display style itself (see renderDocument).
   * @param {string} id display style id
   * @param {string} [theme] effective application theme: 'light' | 'dark'
   */
  function editorStyle(id, theme) {
    const st = style(id);
    if (theme !== 'dark' || DARK_STYLES.indexOf(id) !== -1) return st;
    const key = STYLES[id] ? id : 'classic';
    if (editorCache[key]) return editorCache[key];
    const d = STYLES.dark;
    const containers = {};
    Object.keys(st.containers).forEach((type) => {
      const own = st.containers[type];
      const dark = d.containers[type] || d.containers.default;
      containers[type] = { fill: own.fill === 'none' ? 'none' : dark.fill, stroke: dark.stroke, dash: own.dash };
    });
    editorCache[key] = Object.assign({}, st, {
      background: d.background,
      grid: st.grid ? d.grid : '',
      text: d.text,
      subtext: d.subtext,
      leafFill: st.leafFill === 'none' ? 'none' : d.leafFill,
      leafStroke: st.leafStroke === 'none' ? 'none' : d.leafStroke,
      shadow: false,
      containers,
      edge: d.edge,
      edgeText: d.edgeText,
      edgeLabelBg: d.edgeLabelBg,
      error: d.error
    });
    return editorCache[key];
  }

  function center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  /** Point on the border of `r` on the line from its center towards `target`. */
  function borderPoint(r, target) {
    const c = center(r);
    const dx = target.x - c.x;
    const dy = target.y - c.y;
    if (!dx && !dy) return c;
    const sx = dx ? r.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? r.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  function anchorPoint(r, anchor) {
    const horizontal = anchor.side === 'top' || anchor.side === 'bottom';
    return {
      x: horizontal ? r.x + r.w * anchor.offset : r.x + (anchor.side === 'right' ? r.w : 0),
      y: horizontal ? r.y + (anchor.side === 'bottom' ? r.h : 0) : r.y + r.h * anchor.offset
    };
  }

  /** Project onto the nearest edge of this node, never onto another node. */
  function nearestAnchor(r, point) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return ['top', 'right', 'bottom', 'left'].map((side) => {
      const offset = side === 'top' || side === 'bottom' ? clamp((point.x - r.x) / r.w) : clamp((point.y - r.y) / r.h);
      const anchor = { side, offset };
      const p = anchorPoint(r, anchor);
      return { anchor, distance: Math.hypot(point.x - p.x, point.y - p.y) };
    }).reduce((a, b) => a.distance <= b.distance ? a : b).anchor;
  }

  /** Compute a connection path, its label, editing handles and attachment positions. */
  function connectorPath(a, b, kind, waypoints, sourceAnchor, targetAnchor, routing) {
    const source = Model.cleanAnchor(sourceAnchor);
    const target = Model.cleanAnchor(targetAnchor);
    let path;
    if ((source || target) && kind === 'orthogonal') {
      const vertices = source && target ? null : baseConnectorPath(a, b, kind, waypoints).vertices;
      path = orthogonalRoute(a, b, Model.cleanWaypoints(waypoints),
        source || nearestAnchor(a, vertices[0]), target || nearestAnchor(b, vertices[vertices.length - 1]));
    } else {
      const pointRect = (r, anchor) => anchor ? Object.assign(anchorPoint(r, anchor), { w: 0, h: 0 }) : r;
      path = baseConnectorPath(pointRect(a, source), pointRect(b, target), kind, waypoints, !!(source || target));
    }
    if (routing && kind === 'orthogonal') {
      if (!Model.cleanWaypoints(waypoints).length) path = automaticRoute(a, b, source, target, routing, path);
      path.label = routeLabel(path.vertices, routing.labelWidth || 0, routing.labelObstacles || routing.obstacles || []) || path.label;
    }
    const numbers = path.d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
    path.start = path.vertices ? path.vertices[0] : { x: numbers[0], y: numbers[1] };
    path.end = path.vertices ? path.vertices[path.vertices.length - 1] : { x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] };
    return path;
  }

  function crossesRect(p, q, r) {
    return p.x === q.x ?
      p.x > r.x && p.x < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h :
      p.y > r.y && p.y < r.y + r.h && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w;
  }

  function compactRoute(vertices) {
    const result = [];
    vertices.forEach((p) => {
      const last = result[result.length - 1];
      if (last && last.x === p.x && last.y === p.y) return;
      const prev = result[result.length - 2];
      if (prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y)) &&
          (last.x - prev.x) * (p.x - last.x) + (last.y - prev.y) * (p.y - last.y) >= 0) result.pop();
      result.push({ x: p.x, y: p.y });
    });
    return result;
  }

  /** A bounded visibility grid, searched once for all allowed endpoint sides. */
  function automaticRoute(a, b, source, target, routing, fallback) {
    const contains = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
    const blocks = (routing.obstacles || []).map((r) => ({ x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 }));
    const labelFits = (vertices) => !routing.labelWidth || !!routeLabel(vertices, routing.labelWidth, routing.labelObstacles || routing.obstacles || []);
    // A container-to-descendant connection must be allowed to traverse its own body.
    if (!a.container || !contains(a, center(b))) blocks.push(a);
    if (!b.container || !contains(b, center(a))) blocks.push(b);
    const clear = (p, q) => !blocks.some((r) => crossesRect(p, q, r));
    if (fallback.vertices.slice(1).every((p, i) => clear(fallback.vertices[i], p)) && labelFits(fallback.vertices)) return fallback;
    const sides = ['top', 'right', 'bottom', 'left'];
    const ports = (r, anchor) => (anchor ? [anchor] : sides.map((side) => ({ side, offset: 0.5 }))).map((port) => {
      const point = anchorPoint(r, port);
      const dx = port.side === 'right' ? 1 : port.side === 'left' ? -1 : 0;
      const dy = port.side === 'bottom' ? 1 : port.side === 'top' ? -1 : 0;
      let length = 24;
      blocks.forEach((block) => {
        if (dx && point.y > block.y && point.y < block.y + block.h) {
          const gap = dx > 0 ? block.x - point.x : point.x - block.x - block.w;
          if (gap >= 0) length = Math.min(length, gap / 2);
        }
        if (dy && point.x > block.x && point.x < block.x + block.w) {
          const gap = dy > 0 ? block.y - point.y : point.y - block.y - block.h;
          if (gap >= 0) length = Math.min(length, gap / 2);
        }
      });
      const stub = { x: point.x + dx * length, y: point.y + dy * length };
      return { point, stub, length, direction: dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3 };
    }).filter((port) => clear(port.point, port.stub) && !blocks.some((r) => contains(r, port.stub)));
    const starts = ports(a, source);
    const ends = ports(b, target);
    if (!starts.length || !ends.length) return fallback;
    const all = starts.concat(ends).map((p) => p.stub);
    const coordinates = (axis, size) => {
      const values = all.map((p) => p[axis]);
      blocks.forEach((r) => values.push(r[axis], r[axis] + r[size]));
      values.push(Math.min(...values) - 24, Math.max(...values) + 24);
      return Array.from(new Set(values)).sort((x, y) => x - y);
    };
    const xs = coordinates('x', 'w');
    const ys = coordinates('y', 'h');
    const width = xs.length;
    const count = width * ys.length;
    const xIndex = new Map(xs.map((x, i) => [x, i]));
    const yIndex = new Map(ys.map((y, i) => [y, i]));
    const index = (p) => yIndex.get(p.y) * width + xIndex.get(p.x);
    let vertices;
    if (count <= 90000) {
      const horizontal = new Uint8Array(count);
      const vertical = new Uint8Array(count);
      blocks.forEach((r) => {
        const left = xIndex.get(r.x), right = xIndex.get(r.x + r.w);
        const top = yIndex.get(r.y), bottom = yIndex.get(r.y + r.h);
        for (let y = top + 1; y < bottom; y++) for (let x = left; x < right; x++) horizontal[y * width + x] = 1;
        for (let y = top; y < bottom; y++) for (let x = left + 1; x < right; x++) vertical[y * width + x] = 1;
      });
      const distances = new Float64Array(count * 4).fill(Infinity);
      const previous = new Int32Array(count * 4).fill(-1);
      const origin = new Int8Array(count * 4).fill(-1);
      const heap = [];
      const push = (id, cost) => {
        let i = heap.length;
        heap.push({ id, cost });
        while (i) {
          const parent = (i - 1) >> 1;
          if (heap[parent].cost <= cost) break;
          heap[i] = heap[parent];
          i = parent;
        }
        heap[i] = { id, cost };
      };
      const pop = () => {
        const first = heap[0], last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
            if (heap[child].cost >= last.cost) break;
            heap[i] = heap[child];
            i = child;
          }
          heap[i] = last;
        }
        return first;
      };
      starts.forEach((p, i) => {
        const id = index(p.stub) * 4 + p.direction;
        if (p.length < distances[id]) {
          distances[id] = p.length;
          origin[id] = i;
          push(id, p.length);
        }
      });
      const goals = new Map();
      ends.forEach((p, i) => {
        const id = index(p.stub);
        if (!goals.has(id)) goals.set(id, []);
        goals.get(id).push(i);
      });
      let best = Infinity, finish = -1, endPort, geometricBest = Infinity, geometricRoute;
      const trace = (id, port) => {
        const result = [port.point];
        const startPort = starts[origin[id]];
        for (; id !== -1; id = previous[id]) {
          const cell = id >> 2;
          result.push({ x: xs[cell % width], y: ys[Math.floor(cell / width)] });
        }
        result.push(startPort.point);
        return compactRoute(result.reverse());
      };
      while (heap.length) {
        const current = pop();
        if (current.cost !== distances[current.id]) continue;
        if (current.cost > best) break;
        const cell = current.id >> 2, direction = current.id % 4;
        const x = cell % width, y = Math.floor(cell / width);
        (goals.get(cell) || []).forEach((i) => {
          const incoming = (ends[i].direction + 2) % 4;
          if (ends[i].length && direction === ends[i].direction) return;
          const cost = current.cost + ends[i].length + (direction === incoming ? 0 : 20);
          const route = trace(current.id, ends[i]);
          if (cost < geometricBest) { geometricBest = cost; geometricRoute = route; }
          if (cost < best && labelFits(route)) { best = cost; finish = current.id; endPort = ends[i]; }
        });
        const visit = (next, nextDirection, length, blocked) => {
          if (blocked || nextDirection === (direction + 2) % 4) return;
          const id = next * 4 + nextDirection;
          const cost = current.cost + length + (direction === nextDirection ? 0 : 20);
          if (cost >= distances[id]) return;
          distances[id] = cost;
          previous[id] = current.id;
          origin[id] = origin[current.id];
          push(id, cost);
        };
        if (x) visit(cell - 1, 2, xs[x] - xs[x - 1], horizontal[cell - 1]);
        if (x + 1 < width) visit(cell + 1, 0, xs[x + 1] - xs[x], horizontal[cell]);
        if (y) visit(cell - width, 3, ys[y] - ys[y - 1], vertical[cell - width]);
        if (y + 1 < ys.length) visit(cell + width, 1, ys[y + 1] - ys[y], vertical[cell]);
      }
      if (finish !== -1) {
        vertices = trace(finish, endPort);
      } else vertices = geometricRoute;
    } else {
      // Large diagrams use bounded channel candidates rather than allocating an unbounded grid.
      let best = Infinity;
      starts.forEach((s) => ends.forEach((t) => {
        const consider = (middle) => {
          const route = compactRoute([s.point, s.stub].concat(middle, [t.stub, t.point]));
          if (!route.slice(1).every((p, i) => clear(route[i], p)) || !labelFits(route)) return;
          if (route.slice(2).some((p, i) => (route[i + 1].x - route[i].x) * (p.x - route[i + 1].x) +
              (route[i + 1].y - route[i].y) * (p.y - route[i + 1].y) < 0)) return;
          const cost = route.slice(1).reduce((sum, p, i) => sum + Math.abs(p.x - route[i].x) + Math.abs(p.y - route[i].y) + 20, 0);
          if (cost < best) { best = cost; vertices = route; }
        };
        xs.forEach((x) => consider([{ x, y: s.stub.y }, { x, y: t.stub.y }]));
        ys.forEach((y) => consider([{ x: s.stub.x, y }, { x: t.stub.x, y }]));
      }));
    }
    if (!vertices) return fallback;
    vertices = compactRoute(vertices);
    return {
      d: vertices.map((p, i) => !i ? 'M' + p.x + ' ' + p.y : p.x === vertices[i - 1].x ? 'V' + p.y : 'H' + p.x).join(' '),
      vertices,
      label: fallback.label
    };
  }

  /** Subtract blocked label intervals on each real segment, then prefer the route's middle. */
  function routeLabel(vertices, width, obstacles) {
    const lengths = vertices.slice(1).map((p, i) => Math.abs(p.x - vertices[i].x) + Math.abs(p.y - vertices[i].y));
    const total = lengths.reduce((sum, n) => sum + n, 0);
    let traversed = 0, best, bestScore = Infinity;
    vertices.slice(1).forEach((q, i) => {
      const p = vertices[i], length = lengths[i];
      if (!length) return;
      const horizontal = p.y === q.y;
      const axis = horizontal ? 'x' : 'y';
      const fixed = horizontal ? 'y' : 'x';
      const low = Math.min(p[axis], q[axis]), high = Math.max(p[axis], q[axis]);
      const half = horizontal ? width / 2 : 9;
      const crossHalf = horizontal ? 9 : width / 2;
      let intervals = [[low, high]];
      obstacles.forEach((r) => {
        const size = horizontal ? r.h : r.w;
        if (p[fixed] + crossHalf <= r[fixed] || p[fixed] - crossHalf >= r[fixed] + size) return;
        const start = r[axis] - half - 2;
        const end = r[axis] + (horizontal ? r.w : r.h) + half + 2;
        intervals = intervals.flatMap(([a, b]) => end <= a || start >= b ? [[a, b]] :
          (start > a ? [[a, start]] : []).concat(end < b ? [[end, b]] : []));
      });
      const ideal = p[axis] + Math.sign(q[axis] - p[axis]) * (total / 2 - traversed);
      // Prefer a label fitting within one straight segment over one straddling an elbow.
      intervals.forEach(([a, b]) => {
        const insetA = Math.max(a, low + half), insetB = Math.min(b, high - half);
        const fits = insetA <= insetB;
        const position = Math.max(fits ? insetA : a, Math.min(fits ? insetB : b, ideal));
        const score = Math.abs(traversed + Math.abs(position - p[axis]) - total / 2) + (fits ? 0 : total + 1);
        if (score < bestScore) {
          bestScore = score;
          best = horizontal ? { x: position, y: p.y } : { x: p.x, y: position };
        }
      });
      traversed += length;
    });
    return best || null;
  }

  /** Shared scene-aware route used by the editor, bounds and all diagram exports. */
  function connectionPath(project, c, geometry) {
    const a = endRect(geometry, c.from), b = endRect(geometry, c.to);
    if (!a || !b) return null;
    const obstacles = [], labelObstacles = [];
    Object.keys(geometry.rects).forEach((id) => {
      const r = geometry.rects[id];
      if (r.hidden || !r.w || !r.h) return;
      const block = { x: r.x, y: r.y, w: r.w, h: r.container ? Math.min(r.h, r.headerH || Layout.HEADER) : r.h };
      labelObstacles.push(block);
      if (id !== c.from && id !== c.to) obstacles.push(block);
    });
    const labelText = Layout.truncate([c.label, c.attributes && c.attributes.protocol && c.attributes.protocol !== c.label ? c.attributes.protocol : ''].filter(Boolean).join(' \u00b7 '), 40);
    const labelWidth = labelText && project.settings.diagram.showConnectionLabels !== false ? labelText.length * 5.8 + 10 : 0;
    const path = connectorPath(a, b, project.settings.diagram.connector || 'orthogonal', c.waypoints, c.sourceAnchor, c.targetAnchor,
      { obstacles, labelObstacles, labelWidth });
    path.labelText = labelText;
    path.labelWidth = labelWidth;
    if (labelWidth) path.labelBounds = { x: path.label.x - labelWidth / 2, y: path.label.y - 9, w: labelWidth, h: 16 };
    return path;
  }

  function baseConnectorPath(a, b, kind, waypoints, precise) {
    const points = Model.cleanWaypoints(waypoints);
    if (points.length && kind === 'orthogonal') return orthogonalRoute(a, b, points);
    if (points.length) {
      const rects = [a].concat(points.map((pt) => ({ x: pt.x, y: pt.y, w: 0, h: 0 })), [b]);
      const legs = rects.slice(1).map((r, i) => baseConnectorPath(rects[i], r, kind, undefined, precise));
      return {
        d: legs.map((leg, i) => i ? leg.d.replace(/^M[^A-Za-z]+/, '') : leg.d).join(' '),
        label: legs[Math.floor(legs.length / 2)].label,
        handles: points.map((pt, index) => ({ x: pt.x, y: pt.y, index, insert: false }))
          .concat(points.length < 100 ? legs.map((leg, index) => ({ x: leg.label.x, y: leg.label.y, index, insert: true })) : [])
      };
    }
    const ca = center(a);
    const cb = center(b);
    if (kind === 'orthogonal') {
      const dx = cb.x - ca.x;
      const dy = cb.y - ca.y;
      const horizontal = Math.abs(dx) * (a.h + b.h) >= Math.abs(dy) * (a.w + b.w);
      if (horizontal) {
        const x1 = dx >= 0 ? a.x + a.w : a.x;
        const x2 = dx >= 0 ? b.x : b.x + b.w;
        const mx = Math.round((x1 + x2) / 2);
        return { d: 'M' + x1 + ' ' + ca.y + ' H' + mx + ' V' + cb.y + ' H' + x2, label: { x: mx, y: (ca.y + cb.y) / 2 },
          vertices: [{ x: x1, y: ca.y }, { x: mx, y: ca.y }, { x: mx, y: cb.y }, { x: x2, y: cb.y }] };
      }
      const y1 = dy >= 0 ? a.y + a.h : a.y;
      const y2 = dy >= 0 ? b.y : b.y + b.h;
      const my = Math.round((y1 + y2) / 2);
      return { d: 'M' + ca.x + ' ' + y1 + ' V' + my + ' H' + cb.x + ' V' + y2, label: { x: (ca.x + cb.x) / 2, y: my },
        vertices: [{ x: ca.x, y: y1 }, { x: ca.x, y: my }, { x: cb.x, y: my }, { x: cb.x, y: y2 }] };
    }
    const p1 = borderPoint(a, cb);
    const p2 = borderPoint(b, ca);
    const r1 = (n) => precise ? n : Math.round(n * 10) / 10;
    if (kind === 'curved') {
      const mx = (p1.x + p2.x) / 2;
      return {
        d: 'M' + r1(p1.x) + ' ' + r1(p1.y) + ' C' + r1(mx) + ' ' + r1(p1.y) + ' ' + r1(mx) + ' ' + r1(p2.y) + ' ' + r1(p2.x) + ' ' + r1(p2.y),
        label: { x: mx, y: (p1.y + p2.y) / 2 }
      };
    }
    return { d: 'M' + r1(p1.x) + ' ' + r1(p1.y) + ' L' + r1(p2.x) + ' ' + r1(p2.y), label: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  }

  /** Route waypoint turns together; independently routed legs can double back at their joins. */
  function orthogonalRoute(a, b, points, source, target) {
    const rect = (pt) => ({ x: pt.x, y: pt.y, w: 0, h: 0 });
    const direction = (p, q) => q.x > p.x ? 'right' : q.x < p.x ? 'left' : q.y > p.y ? 'down' : 'up';
    const opposite = { right: 'left', left: 'right', up: 'down', down: 'up' };
    const turnCost = (incoming, outgoing) => !incoming || !outgoing || incoming === outgoing ? 0 : opposite[incoming] === outgoing ? 10000 : 1;
    const compact = (vertices) => vertices.filter((p, i) => !i || p.x !== vertices[i - 1].x || p.y !== vertices[i - 1].y);
    const endpointOptions = (vertices, source) => {
      const leg = compact(vertices);
      if (leg.length < 2) return [leg];
      const start = leg[0];
      const end = leg[leg.length - 1];
      const horizontal = source ? start.y === leg[1].y : end.y === leg[leg.length - 2].y;
      const elbow = source === horizontal ? { x: end.x, y: start.y } : { x: start.x, y: end.y };
      const direct = compact([start, elbow, end]);
      const originalDir = source ? direction(start, leg[1]) : direction(leg[leg.length - 2], end);
      const directDir = direct.length < 2 ? null : source ? direction(start, direct[1]) : direction(direct[direct.length - 2], end);
      return directDir === originalDir ? [direct, leg] : [leg];
    };
    const legOptions = (p, q) => {
      const mx = (p.x + q.x) / 2;
      const my = (p.y + q.y) / 2;
      const options = [
        [p, { x: q.x, y: p.y }, q],
        [p, { x: p.x, y: q.y }, q],
        [p, { x: mx, y: p.y }, { x: mx, y: q.y }, q],
        [p, { x: p.x, y: my }, { x: q.x, y: my }, q]
      ];
      if (source || target) {
        const xs = [Math.min(p.x, q.x, a.x, b.x) - 24, Math.max(p.x, q.x, a.x + a.w, b.x + b.w) + 24];
        const ys = [Math.min(p.y, q.y, a.y, b.y) - 24, Math.max(p.y, q.y, a.y + a.h, b.y + b.h) + 24];
        xs.forEach((x) => options.push([p, { x, y: p.y }, { x, y: q.y }, q]));
        ys.forEach((y) => options.push([p, { x: p.x, y }, { x: q.x, y }, q]));
        xs.forEach((x) => ys.forEach((y) => {
          options.push([p, { x, y: p.y }, { x, y }, { x: q.x, y }, q]);
          options.push([p, { x: p.x, y }, { x, y }, { x, y: q.y }, q]);
        }));
      }
      return options;
    };
    const crossesInterior = (p, q, r) => p.x === q.x ?
      p.x > r.x && p.x < r.x + r.w && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.h :
      p.y > r.y && p.y < r.y + r.h && Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.w;
    let candidates;
    if (source || target) {
      const start = anchorPoint(a, source);
      const end = anchorPoint(b, target);
      const stub = (p, anchor, other) => {
        const horizontal = anchor.side === 'left' || anchor.side === 'right';
        const positive = anchor.side === 'right' || anchor.side === 'bottom';
        const axis = horizontal ? 'x' : 'y';
        const crossAxis = horizontal ? 'y' : 'x';
        const size = horizontal ? 'w' : 'h';
        const crossSize = horizontal ? 'h' : 'w';
        let length = 24;
        if (p[crossAxis] >= other[crossAxis] && p[crossAxis] <= other[crossAxis] + other[crossSize] &&
            (positive ? other[axis] + other[size] >= p[axis] : other[axis] <= p[axis])) {
          const gap = positive ? other[axis] - p[axis] : p[axis] - other[axis] - other[size];
          // Share narrow gaps so opposing stubs cannot overlap, including touching nodes.
          length = Math.min(length, Math.max(0, gap / 2));
        }
        return {
          x: p.x + (horizontal ? (positive ? length : -length) : 0),
          y: p.y + (!horizontal ? (positive ? length : -length) : 0)
        };
      };
      const first = stub(start, source, b);
      const last = stub(end, target, a);
      const stops = [first].concat(points, [last]);
      candidates = stops.slice(1).map((q, i) => legOptions(stops[i], q).map((leg) =>
        (i === 0 ? [start] : []).concat(leg, i === stops.length - 2 ? [end] : [])));
    } else {
      candidates = [endpointOptions(baseConnectorPath(a, rect(points[0]), 'orthogonal').vertices, true)];
      points.slice(1).forEach((q, i) => candidates.push(legOptions(points[i], q)));
      candidates.push(endpointOptions(baseConnectorPath(rect(points[points.length - 1]), b, 'orthogonal').vertices, false));
    }
    let states = [{ cost: 0, end: null, legs: [] }];
    candidates.forEach((options) => {
      const next = new Map();
      options.forEach((vertices) => {
        const leg = compact(vertices);
        const dirs = leg.slice(1).map((p, i) => direction(leg[i], p));
        // Penalize rather than discard crossings: explicit waypoints may lie inside nodes.
        const crossingCost = source || target ? leg.slice(1).reduce((sum, p, i) =>
          sum + [a, b].filter((r) => crossesInterior(leg[i], p, r)).length * 1000, 0) : 0;
        const internalCost = crossingCost + dirs.slice(1).reduce((sum, d, i) => sum + turnCost(dirs[i], d), 0);
        states.forEach((state) => {
          const end = dirs.length ? dirs[dirs.length - 1] : state.end;
          const cost = state.cost + internalCost + turnCost(state.end, dirs[0]);
          const best = next.get(end);
          if (!best || cost < best.cost) next.set(end, { cost, end, legs: state.legs.concat([leg]) });
        });
      });
      states = Array.from(next.values());
    });
    const best = states.reduce((p, q) => p.cost <= q.cost ? p : q);
    const vertices = compact(best.legs.flat());
    // Arc-length midpoints keep labels and insertion handles on the actual path.
    const midpoint = (leg) => {
      const lengths = leg.slice(1).map((p, i) => Math.abs(p.x - leg[i].x) + Math.abs(p.y - leg[i].y));
      let remaining = lengths.reduce((sum, n) => sum + n, 0) / 2;
      for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i] && lengths[i]) {
          const t = remaining / lengths[i];
          return { x: leg[i].x + (leg[i + 1].x - leg[i].x) * t, y: leg[i].y + (leg[i + 1].y - leg[i].y) * t };
        }
        remaining -= lengths[i];
      }
      return leg[0];
    };
    return {
      d: vertices.map((p, i) => !i ? 'M' + p.x + ' ' + p.y : p.x === vertices[i - 1].x ? 'V' + p.y : 'H' + p.x).join(' '),
      label: midpoint(vertices),
      vertices,
      handles: points.map((p, index) => ({ x: p.x, y: p.y, index, insert: false }))
        .concat(points.length < 100 ? best.legs.map((leg, index) => Object.assign({}, midpoint(leg), { index, insert: true })) : [])
    };
  }

  /** <defs> with arrow markers, shadow filter and grid pattern. */
  function defs(st, prefix) {
    const p = prefix || '';
    return (
      '<defs>' +
      '<marker id="' + p + 'arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + st.edge + '"/></marker>' +
      '<marker id="' + p + 'arrow-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="' + st.edge + '" stroke-width="1.5"/></marker>' +
      '<marker id="' + p + 'dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6"><circle cx="5" cy="5" r="4" fill="' + st.edge + '"/></marker>' +
      '<marker id="' + p + 'arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + st.selection + '"/></marker>' +
      (st.shadow ? '<filter id="' + p + 'shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#1b2a3a" flood-opacity="0.18"/></filter>' : '') +
      (st.grid ? '<pattern id="' + p + 'grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0 L0 0 0 20" fill="none" stroke="' + st.grid + '" stroke-width="1"/></pattern>' : '') +
      '</defs>'
    );
  }

  /** Placeholder icon used when an icon is not available (e.g. offline export). */
  function placeholderIcon(x, y, size, typeId, st) {
    const def = Catalog.get(typeId);
    const abbr = (def ? def.abbr : '?').slice(0, 5).toUpperCase();
    return (
      '<rect x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="' + size / 6 + '" fill="#0078d4"/>' +
      '<text x="' + (x + size / 2) + '" y="' + (y + size / 2 + size / 9) + '" text-anchor="middle" font-size="' + Math.max(7, size / 4.2) + '" font-weight="700" fill="#ffffff" font-family="' + esc(st.font) + '">' + esc(abbr) + '</text>'
    );
  }

  function icon(x, y, size, typeId, st, iconHref) {
    const href = iconHref ? iconHref(typeId) : null;
    if (!href) return placeholderIcon(x, y, size, typeId, st);
    return '<image x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" href="' + esc(href) + '" preserveAspectRatio="xMidYMid meet"/>';
  }

  function tooltip(project, r) {
    const def = Catalog.get(r.type);
    const lines = [r.name, def ? def.label + (def.provider ? ' (' + def.provider + ')' : '') : r.type];
    r.attrs.forEach((a) => lines.push(a.label + ': ' + a.value));
    const node = project.nodes[r.id];
    if (node && node.tags && node.tags.length) {
      lines.push('Tags:');
      node.tags.forEach((t) => lines.push('  ' + t.key + (t.value ? ': ' + t.value : '')));
    }
    return '<title>' + esc(lines.join('\n')) + '</title>';
  }

  /**
   * Draw tag chips (see Tags.chipRows) starting at (x, y). Rows are centred in `width` when
   * `center` is set, otherwise left-aligned.
   */
  function tagChips(tags, x, y, width, center) {
    const C = Tags.CHIP;
    let s = '<g class="tags">';
    tags.rows.forEach((row, i) => {
      const rowW = row.reduce((n, c) => n + c.w, 0) + C.gap * (row.length - 1);
      let cx = center ? x + (width - rowW) / 2 : x;
      const cy = y + i * (C.h + C.gap);
      row.forEach((c) => {
        s += '<g class="tag"><title>' + esc(c.title) + '</title><rect x="' + cx + '" y="' + cy + '" width="' + c.w + '" height="' + C.h + '" rx="' + C.h / 2 + '" fill="' + esc(c.color) + '"/>' +
          '<text x="' + (cx + c.w / 2) + '" y="' + (cy + C.h / 2 + 3.3) + '" text-anchor="middle" font-size="9.5" font-weight="600" fill="#ffffff">' + esc(c.text) + '</text></g>';
        cx += c.w + C.gap;
      });
    });
    return s + '</g>';
  }

  function renderContainer(project, r, st, o) {
    const node = project.nodes[r.id];
    const pal = st.containers[node.type] || st.containers.default;
    const selected = o.selection && o.selection.nodes.has(r.id);
    const isDrop = o.dropTargetId === r.id;
    const problems = o.problems && o.problems[r.id];
    let s = '<g class="node container" data-node-id="' + esc(r.id) + '">' + tooltip(project, r);
    s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="' + st.radius + '" fill="' + pal.fill + '" stroke="' + (isDrop ? st.selection : pal.stroke) + '" stroke-width="' + (isDrop ? 3 : 1.5) + '"' + (pal.dash && !isDrop ? ' stroke-dasharray="' + pal.dash + '"' : '') + '/>';
    s += icon(r.x + 10, r.y + 9, 26, node.type, st, o.iconHref);
    s += '<text x="' + (r.x + 44) + '" y="' + (r.y + 22) + '" font-size="13" font-weight="600" fill="' + st.text + '">' + esc(r.nameLines[0]) + '</text>';
    if (r.typeLabel) s += '<text x="' + (r.x + 44) + '" y="' + (r.y + 36) + '" font-size="10.5" fill="' + st.subtext + '">' + esc(r.typeLabel) + '</text>';
    const maxChars = Math.max(12, Math.floor((r.w - 30) / 6));
    r.attrs.forEach((a, i) => {
      s += '<text x="' + (r.x + 12) + '" y="' + (r.y + Layout.HEADER + 8 + i * Layout.LINE) + '" font-size="10.5" fill="' + st.subtext + '">' + esc(Layout.truncate(a.label + ': ' + a.value, maxChars)) + '</text>';
    });
    if (r.tags && r.tags.height) s += tagChips(r.tags, r.x + 12, r.y + Layout.HEADER + (r.attrs.length ? r.attrs.length * Layout.LINE + 4 : 0), r.w - 24, false);
    if (problems && !o.forExport) s += problemBadge(r.x + r.w - 12, r.y + 12, st, problems);
    if (selected && !o.forExport) {
      s += '<rect class="selection" x="' + (r.x - 3) + '" y="' + (r.y - 3) + '" width="' + (r.w + 6) + '" height="' + (r.h + 6) + '" rx="' + (st.radius + 2) + '" fill="none" stroke="' + st.selection + '" stroke-width="2"/>';
    }
    return s + '</g>';
  }

  function problemBadge(cx, cy, st, problems) {
    return '<g class="problem"><title>' + esc(problems.join('\n')) + '</title><circle cx="' + cx + '" cy="' + cy + '" r="8" fill="' + st.error + '"/><text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">!</text></g>';
  }

  function renderLeaf(project, r, st, o) {
    if (r.annotation) return renderAnnotation(project, r, st, o);
    const node = project.nodes[r.id];
    const selected = o.selection && o.selection.nodes.has(r.id);
    const problems = o.problems && o.problems[r.id];
    const cx = r.x + r.w / 2;
    // An object without children (e.g. an empty virtual network) can still be a drop target.
    const isDrop = o.dropTargetId === r.id;
    let s = '<g class="node leaf" data-node-id="' + esc(r.id) + '">' + tooltip(project, r);
    s += '<rect x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="' + st.radius + '" fill="' + (st.leafFill === 'none' && !o.forExport ? 'rgba(255,255,255,0.001)' : st.leafFill) + '" stroke="' + (isDrop ? st.selection : st.leafStroke) + '" stroke-width="' + (isDrop ? 3 : 1) + '"' + (st.shadow ? ' filter="url(#' + (o.idPrefix || '') + 'shadow)"' : '') + '/>';
    s += icon(cx - Layout.ICON / 2, r.y + 10, Layout.ICON, node.type, st, o.iconHref);
    let y = r.y + 10 + Layout.ICON + 8;
    r.nameLines.forEach((line) => {
      y += Layout.NAME_LINE;
      s += '<text x="' + cx + '" y="' + (y - 3) + '" text-anchor="middle" font-size="12" font-weight="600" fill="' + st.text + '">' + esc(line) + '</text>';
    });
    if (r.typeLabel) {
      y += Layout.LINE;
      s += '<text x="' + cx + '" y="' + (y - 2) + '" text-anchor="middle" font-size="10" fill="' + st.subtext + '">' + esc(Layout.truncate(r.typeLabel, 30)) + '</text>';
    }
    if (r.attrs.length) y += 4;
    r.attrs.forEach((a) => {
      y += Layout.LINE;
      s += '<text x="' + cx + '" y="' + (y - 2) + '" text-anchor="middle" font-size="10" fill="' + st.subtext + '">' + esc(Layout.truncate(a.label + ': ' + a.value, 30)) + '</text>';
    });
    if (r.tags && r.tags.height) s += tagChips(r.tags, r.x + 8, y + 6, r.w - 16, true);
    if (problems && !o.forExport) s += problemBadge(r.x + r.w - 10, r.y + 10, st, problems);
    if (selected && !o.forExport) {
      s += '<rect class="selection" x="' + (r.x - 3) + '" y="' + (r.y - 3) + '" width="' + (r.w + 6) + '" height="' + (r.h + 6) + '" rx="' + (st.radius + 2) + '" fill="none" stroke="' + st.selection + '" stroke-width="2"/>';
    }
    return s + '</g>';
  }

  function renderAnnotation(project, r, st, o) {
    const m = r.annotation;
    const a = m.a;
    const p = a.padding;
    const palette = st.containers.default;
    const stroke = st.leafStroke === 'none' ? st.subtext : st.leafStroke;
    const fill = st.leafFill === 'none' ? st.background : st.leafFill;
    const radius = a.theme === 'pill' ? Math.min(r.w, r.h) / 2 : a.theme === 'plain' ? 0 : 8;
    const shape = (x, y, w, h, color, border, rx) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 0) + '" fill="' + esc(color) + '" stroke="' + esc(border || 'none') + '"/>';
    let s = '<g class="node annotation ' + a.theme + '" data-node-id="' + esc(r.id) + '"><title>' + esc(project.nodes[r.id].name || r.name) + '</title>';
    s += shape(r.x, r.y, r.w, r.h, a.theme === 'plain' ? (o.forExport ? 'none' : 'transparent') : fill, a.theme === 'card' || a.theme === 'pill' ? stroke : 'none', radius);
    if (a.theme === 'callout') s += shape(r.x, r.y, 4, r.h, st.edge, 'none');
    if (m.layout) s += AISBP.Annotations.svgText(m.layout, r.x + p, r.y + p, r.w - 2 * p, a, st.text);
    else {
      const top = r.y + (a.caption ? m.caption.h + 2 * p : 0);
      if (a.caption) s += AISBP.Annotations.svgText(m.caption, r.x + p, r.y + p, r.w - 2 * p, a, st.text, true);
      let y = top;
      m.layouts.forEach((row, ri) => {
        let x = r.x;
        row.forEach((layout, ci) => {
          const header = (a.headerRow && ri === 0) || (a.firstColumnHeader && ci === 0);
          if (header) s += shape(x, y, m.widths[ci], m.heights[ri], palette.fill === 'none' ? fill : palette.fill, 'none');
          else if (a.striped && ri % 2 === (a.headerRow ? 0 : 1)) s += '<g opacity="0.06">' + shape(x, y, m.widths[ci], m.heights[ri], st.text, 'none') + '</g>';
          s += AISBP.Annotations.svgText(layout, x + p, y + p, Math.max(10, m.widths[ci] - 2 * p), a, st.text, header);
          if (a.grid === 'all') s += shape(x, y, m.widths[ci], m.heights[ri], 'none', stroke);
          x += m.widths[ci];
        });
        y += m.heights[ri];
        if (a.grid === 'rows' && ri < m.layouts.length - 1) s += '<path d="M' + r.x + ' ' + y + ' h' + r.w + '" stroke="' + esc(stroke) + '"/>';
      });
      if (a.grid === 'outer' || a.grid === 'rows') s += shape(r.x, top, r.w, y - top, 'none', stroke);
    }
    if (o.selection && o.selection.nodes.has(r.id) && !o.forExport) s += shape(r.x - 3, r.y - 3, r.w + 6, r.h + 6, 'none', st.selection, radius);
    return s + '</g>';
  }

  /** Resolve the rect used for a connection end (hidden containers have no rect of their own). */
  function endRect(geometry, id) {
    const r = geometry.rects[id];
    return r && !r.hidden && r.w ? r : null;
  }

  function renderConnection(project, c, geometry, st, o) {
    const a = endRect(geometry, c.from);
    const b = endRect(geometry, c.to);
    if (!a || !b) return '';
    const kind = Model.CONNECTION_KINDS.find((k) => k.id === c.kind) || Model.CONNECTION_KINDS[0];
    const path = connectionPath(project, c, geometry);
    const selected = o.selection && o.selection.conns.has(c.id);
    const color = selected ? st.selection : st.edge;
    const p = o.idPrefix || '';
    // Bidirectional connections get an arrow head at both ends (markers use orient="auto-start-reverse").
    const both = c.direction === 'bidirectional';
    const noArrow = !both && (c.kind === 'network' || c.kind === 'association');
    const arrow = ' url(#' + p + (selected ? 'arrow-sel' : c.kind === 'dependency' ? 'arrow-open' : 'arrow') + ')"';
    const markerEnd = noArrow ? '' : ' marker-end="' + arrow.trim();
    const markerStart = both ? ' marker-start="' + arrow.trim() : c.kind === 'trigger' ? ' marker-start="url(#' + p + 'dot)"' : '';
    let s = '<g class="connection" data-conn-id="' + esc(c.id) + '">';
    const title = [kind.label, both ? 'bidirectional' : '', c.label, c.attributes && c.attributes.protocol].filter(Boolean).join(' \u2022 ');
    s += '<title>' + esc(title) + '</title>';
    if (!o.forExport) s += '<path d="' + path.d + '" fill="none" stroke="transparent" stroke-width="12" class="hit"/>';
    s += '<path d="' + path.d + '" fill="none" stroke="' + color + '" stroke-width="' + (selected ? 2.5 : 1.6) + '"' + (kind.dashed ? ' stroke-dasharray="6 4"' : '') + markerEnd + markerStart + '/>';
    if (path.labelWidth) {
      const t = path.labelText;
      const w = path.labelWidth;
      s += '<rect x="' + (path.label.x - w / 2) + '" y="' + (path.label.y - 9) + '" width="' + w + '" height="16" rx="3" fill="' + st.edgeLabelBg + '" opacity="0.92"/>';
      s += '<text x="' + path.label.x + '" y="' + (path.label.y + 3) + '" text-anchor="middle" font-size="10" fill="' + st.edgeText + '">' + esc(t) + '</text>';
    }
    return s + '</g>';
  }

  /**
   * Render the diagram content (no <svg> wrapper).
   * @param {object} project
   * @param {object} [opts] { geometry, selection:{nodes:Set,conns:Set}, problems, iconHref(typeId),
   *                          forExport, dropTargetId, idPrefix, style (resolved style object,
   *                          overrides the project's display style; see editorStyle) }
   */
  function renderContent(project, opts) {
    const o = opts || {};
    const st = o.style || style(project.settings.diagram.style);
    const g = o.geometry || Layout.compute(project);
    const rects = Object.keys(g.rects).map((k) => g.rects[k]).filter((r) => !r.hidden && r.w);
    const containers = rects.filter((r) => r.container).sort((a, b) => a.depth - b.depth || project.nodes[a.id].seq - project.nodes[b.id].seq);
    const leaves = rects.filter((r) => !r.container).sort((a, b) => project.nodes[a.id].seq - project.nodes[b.id].seq);
    let s = '<g font-family="' + esc(st.font) + '">';
    containers.forEach((r) => { s += renderContainer(project, r, st, o); });
    Object.keys(project.connections).forEach((cid) => { s += renderConnection(project, project.connections[cid], g, st, o); });
    leaves.forEach((r) => { s += renderLeaf(project, r, st, o); });
    return s + '</g>';
  }

  /**
   * Render a complete, standalone SVG document (used by the exports).
   * @param {object} project
   * @param {object} [opts] { iconHref, margin, includeTitle }
   * @returns {{svg: string, width: number, height: number}}
   */
  function background(value, fallback, allowTransparent) {
    if (value === undefined) return fallback;
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
    if (value === 'transparent' && allowTransparent !== false) return value;
    throw new Error('Background must be #RRGGBB' + (allowTransparent === false ? '; transparency is not supported for PDF.' : ' or transparent.'));
  }

  function renderDocument(project, opts) {
    const o = Object.assign({ margin: 40 }, opts || {});
    const st = style(project.settings.diagram.style);
    const bg = background(o.background, st.background);
    const g = Layout.compute(project);
    const b = g.bounds;
    const showTitle = project.settings.diagram.showTitle !== false;
    const titleH = showTitle ? 54 : 0;
    const footerH = 24;
    const x0 = b.x - o.margin;
    const y0 = b.y - o.margin - titleH;
    const width = Math.ceil(b.w + o.margin * 2);
    const height = Math.ceil(b.h + o.margin * 2 + titleH + footerH);
    let s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + width + '" height="' + height + '" viewBox="' + x0 + ' ' + y0 + ' ' + width + ' ' + height + '">';
    s += defs(st, '');
    if (bg !== 'transparent') {
      s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + width + '" height="' + height + '" fill="' + bg + '"/>';
      if (st.grid && project.settings.diagram.style === 'blueprint') s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + width + '" height="' + height + '" fill="url(#grid)"/>';
    }
    if (showTitle) {
      s += '<text x="' + (x0 + o.margin) + '" y="' + (y0 + o.margin) + '" font-family="' + esc(st.font) + '" font-size="20" font-weight="700" fill="' + st.text + '">' + esc(project.meta.name) + '</text>';
      const sub = [project.meta.description ? Layout.truncate(project.meta.description, 140) : '', 'Generated ' + new Date(project.meta.modified || Date.now()).toISOString().slice(0, 10)].filter(Boolean).join(' \u2014 ');
      s += '<text x="' + (x0 + o.margin) + '" y="' + (y0 + o.margin + 20) + '" font-family="' + esc(st.font) + '" font-size="11" fill="' + st.subtext + '">' + esc(sub) + '</text>';
    }
    s += renderContent(project, { geometry: g, iconHref: o.iconHref, forExport: true });
    s += '<text x="' + (x0 + width - 12) + '" y="' + (y0 + height - 10) + '" text-anchor="end" font-family="' + esc(st.font) + '" font-size="9" fill="' + st.subtext + '">' +
      esc('Made with AIS BluePrinter \u2022 Azure icons: MS Icons (msicons.com), \u00a9 Microsoft') + '</text>';
    s += '</svg>';
    return { svg: s, width, height };
  }

  AISBP.Render = { STYLES, CONNECTORS, style, editorStyle, center, borderPoint, anchorPoint, nearestAnchor, connectorPath, connectionPath, defs, renderContent, renderDocument, background };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Render;
})(typeof globalThis !== 'undefined' ? globalThis : this);
