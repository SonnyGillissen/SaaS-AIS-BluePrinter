/**
 * AIS BluePrinter - properties panel.
 *
 * Shows and edits the selected object(s):
 *  - naming (naming convention with per-object overrides, or a custom name) with live
 *    validation against the Azure naming rules,
 *  - placement in the hierarchy and quick "add child" actions (click-together building),
 *  - all attributes, each with an "eye" toggle that controls whether it is shown on the
 *    diagram (in the "Selected attributes" detail level),
 *  - custom attributes,
 *  - tags (with suggestions from the Tag Manager definitions),
 *  - connection properties.
 * Without a selection it shows the project properties and a validation summary.
 *
 * @module AISBP.Properties
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { h, clear, icon, field, select } = AISBP.Dom;
  const Model = AISBP.Model;
  const Catalog = AISBP.Catalog;
  const Naming = AISBP.Naming;
  const Layout = AISBP.Layout;
  const Tags = AISBP.Tags;

  function mount(el, app) {
    const store = app.store;

    /** Apply a node patch as an undoable change (consecutive typing is merged). */
    const patchNode = (id, patch, mergeKey) => store.change('edit', (p) => { Model.updateNode(p, id, patch); }, { merge: mergeKey });
    const patchConn = (id, patch, mergeKey) => store.change('edit', (p) => { Model.updateConnection(p, id, patch); }, { merge: mergeKey });

    function textInput(id, value, onInput, attrs) {
      const input = h('input', Object.assign({ type: 'text', id, value: value || '', spellcheck: 'false', autocomplete: 'off' }, attrs || {}));
      input.addEventListener('input', () => onInput(input.value));
      input.addEventListener('change', () => store.endMerge());
      return input;
    }

    function textArea(id, value, onInput) {
      const ta = h('textarea', { id, value: value || '', spellcheck: 'false' });
      ta.addEventListener('input', () => onInput(ta.value));
      ta.addEventListener('change', () => store.endMerge());
      return ta;
    }

    /** Eye toggle that controls display of an attribute on the diagram. */
    function eye(node, key) {
      const shown = Layout.isAttributeShown(store.project, node, key);
      const explicit = node.display && typeof node.display[key] === 'boolean';
      return h('button', {
        type: 'button',
        class: 'eye' + (explicit ? '' : ' inherited'),
        'aria-pressed': shown ? 'true' : 'false',
        'aria-label': (shown ? 'Shown' : 'Hidden') + ' on diagram',
        title: (shown ? 'Shown on the diagram' : 'Hidden on the diagram') + (explicit ? ' (set for this object)' : ' (default for this type)') + '\nClick to toggle. Applies to the "Selected attributes" detail level.',
        text: shown ? '\u{1F441}' : '\u2014',
        onclick: () => {
          const display = {};
          display[key] = !shown;
          store.change('display', (p) => { Model.updateNode(p, node.id, { display }); });
        }
      });
    }

    function attributeControl(node, attr) {
      const id = 'prop-attr-' + attr.key;
      const value = node.attributes[attr.key];
      const set = (v) => {
        const attributes = {};
        attributes[attr.key] = v;
        patchNode(node.id, { attributes }, node.id + ':attr:' + attr.key);
      };
      switch (attr.type) {
        case 'bool': {
          const cb = h('input', { type: 'checkbox', id, checked: !!value, onchange: () => set(cb.checked) });
          return field(attr.label, cb, { check: true, eye: eye(node, attr.key) });
        }
        case 'select': {
          const opts = attr.options.map((o) => {
            if (attr.key === 'location') {
              if (o === '(inherit)') {
                const inherited = node.parentId ? Model.effectiveLocation(store.project, node.parentId) : '';
                const r = Catalog.region(inherited);
                return { value: o, label: '(inherit' + (r ? ': ' + r.label : '') + ')' };
              }
              const r = Catalog.region(o);
              return { value: o, label: r ? r.label : o };
            }
            return { value: o, label: o || '\u2014' };
          });
          if (value !== undefined && value !== '' && attr.options.indexOf(value) === -1) opts.push({ value, label: String(value) });
          if (attr.options.indexOf('') === -1 && (value === undefined || value === '')) opts.unshift({ value: '', label: '\u2014' });
          const sel = select(opts, value === undefined ? '' : value, { id, onchange: () => set(sel.value) });
          return field(attr.label, sel, { eye: eye(node, attr.key) });
        }
        case 'number': {
          const input = h('input', { type: 'number', id, value: value === undefined ? '' : value });
          input.addEventListener('input', () => set(input.value === '' ? '' : Number(input.value)));
          return field(attr.label, input, { eye: eye(node, attr.key) });
        }
        case 'textarea':
          return field(attr.label, textArea(id, value, set), { eye: eye(node, attr.key) });
        default:
          return field(attr.label, textInput(id, value, set), { eye: eye(node, attr.key) });
      }
    }

    function namingSection(node, def, derived) {
      const project = store.project;
      const out = [];
      const name = derived.geometry.names[node.id] || '';
      const mode = select([{ value: 'convention', label: 'Use naming convention' }, { value: 'custom', label: 'Custom name' }], node.nameMode, {
        id: 'prop-name-mode',
        onchange: () => {
          const patch = { nameMode: mode.value };
          if (mode.value === 'custom' && !node.name) patch.name = name;
          store.change('name mode', (p) => { Model.updateNode(p, node.id, patch); });
        }
      });
      out.push(field('Naming', mode));
      if (node.nameMode === 'custom') {
        out.push(field('Name', textInput('prop-name', node.name, (v) => patchNode(node.id, { name: v }, node.id + ':name'))));
      } else {
        const pattern = Naming.patternFor(project, node);
        const tokens = Naming.tokensIn(pattern);
        out.push(field('Name / purpose {name}', textInput('prop-label', node.label, (v) => patchNode(node.id, { label: v }, node.id + ':label'), { placeholder: 'e.g. orders' }), {
          help: tokens.indexOf('name') === -1 ? 'The current pattern does not use {name}; it is used as the display label only.' : ''
        }));
        out.push(field('Pattern override (this object only)', textInput('prop-pattern', node.naming.pattern, (v) => patchNode(node.id, { naming: { pattern: v } }, node.id + ':pattern'), {
          placeholder: Naming.patternFor(project, Object.assign({}, node, { naming: { pattern: '', tokens: {} } }))
        }), { help: 'Tokens: {abbr} {name} {org} {workload} {env} {region} {instance} {parent} or any custom token.' }));
        const tokenKeys = ['workload', 'env', 'org', 'instance'].concat(tokens.filter((t) => ['abbr', 'name', 'type', 'parent', 'region', 'workload', 'env', 'org', 'instance'].indexOf(t) === -1));
        out.push(h('div', { class: 'tokens' }, tokenKeys.map((t) => {
          const inherited = Naming.tokenValue(project, Object.assign({}, node, { naming: { pattern: '', tokens: {} } }), t, 0);
          return field('{' + t + '}', textInput('prop-token-' + t, node.naming.tokens[t], (v) => {
            const tk = {};
            tk[t] = v;
            patchNode(node.id, { naming: { tokens: tk } }, node.id + ':token:' + t);
          }, { placeholder: inherited }));
        })));
      }
      out.push(h('div', { class: 'name-preview', title: 'Resolved name', text: name || '(empty)' }));
      if (def.rule) out.push(h('p', { class: 'rule', text: 'Azure rule: ' + Naming.describeRule(def.rule) }));
      const problems = derived.problems[node.id];
      if (problems) out.push(h('ul', { class: 'problems' }, problems.map((p) => h('li', { text: p }))));
      else if (def.rule) out.push(h('p', { class: 'ok-note', text: '\u2713 Name is valid' }));
      return out;
    }

    function placementSection(node, def) {
      const project = store.project;
      const derived = store.derived();
      const options = [];
      if (Catalog.canContain(null, node.type)) options.push({ value: '', label: '(top level)' });
      Object.keys(project.nodes).map((k) => project.nodes[k])
        .filter((p) => p.id === node.parentId || (Catalog.canContain(p.type, node.type) && !Model.isSelfOrDescendant(project, node.id, p.id)))
        .sort((a, b) => a.seq - b.seq)
        .forEach((p) => options.push({ value: p.id, label: '\u00a0'.repeat(Model.depth(project, p.id) * 2) + (derived.geometry.names[p.id] || p.id) + ' (' + Catalog.get(p.type).label + ')' }));
      const parentSel = select(options, node.parentId || '', { id: 'prop-parent', onchange: () => app.actions.reparent([node.id], parentSel.value || null) });
      const out = [field('Parent', parentSel)];
      const childTypes = Catalog.childTypesOf(node.type);
      if (childTypes.length) {
        const addSel = select([{ value: '', label: 'Add child\u2026' }].concat(childTypes.map((t) => ({ value: t.id, label: t.label }))), '', {
          id: 'prop-add-child',
          'aria-label': 'Add child object',
          onchange: () => {
            if (addSel.value) app.actions.addInto(addSel.value, node.id);
          }
        });
        out.push(field('Add a child object', addSel));
      }
      return out;
    }

    function customSection(node) {
      const rows = (node.custom || []).map((c, i) => {
        const update = (patch) => {
          const custom = node.custom.map((x, j) => (j === i ? Object.assign({}, x, patch) : x));
          patchNode(node.id, { custom }, node.id + ':custom:' + i);
        };
        const key = h('input', { type: 'text', id: 'prop-custom-key-' + i, value: c.key, placeholder: 'Name', 'aria-label': 'Attribute name' });
        key.addEventListener('input', () => update({ key: key.value }));
        const val = h('input', { type: 'text', id: 'prop-custom-val-' + i, value: c.value, placeholder: 'Value', 'aria-label': 'Attribute value' });
        val.addEventListener('input', () => update({ value: val.value }));
        return h('div', { class: 'custom-row' }, key, val, c.key ? eye(node, 'custom:' + c.key) : h('span'), h('button', {
          type: 'button', class: 'btn small danger', 'aria-label': 'Remove attribute', text: '\u2715',
          onclick: () => store.change('remove custom', (p) => { Model.updateNode(p, node.id, { custom: node.custom.filter((_, j) => j !== i) }); })
        }));
      });
      return [rows, h('button', { type: 'button', class: 'btn small', text: '+ Add custom attribute', onclick: () => store.change('add custom', (p) => { Model.updateNode(p, node.id, { custom: (node.custom || []).concat([{ key: '', value: '' }]) }); }) })];
    }

    /**
     * Tags of an object: name/value rows with suggestions from the Tag Manager definitions
     * and quick-add buttons for defined tags the object does not have yet.
     */
    function tagSection(node) {
      const project = store.project;
      const tags = node.tags || [];
      const defs = Tags.definitions(project);
      const usage = Tags.usage(project);
      const keys = defs.map((d) => d.key);
      Object.keys(usage).forEach((k) => { if (!keys.some((x) => x.toLowerCase() === k)) keys.push(usage[k].key); });
      const keyList = h('datalist', { id: 'prop-tag-keys' }, keys.map((k) => h('option', { value: k })));
      const rows = tags.map((t, i) => {
        const update = (patch) => {
          const next = node.tags.map((x, j) => (j === i ? Object.assign({}, x, patch) : x));
          patchNode(node.id, { tags: next }, node.id + ':tags:' + i);
        };
        const def = Tags.definition(project, t.key);
        const suggestions = (def ? def.values : []).concat(usage[t.key.toLowerCase()] ? usage[t.key.toLowerCase()].values : []).filter((v, j, a) => a.indexOf(v) === j);
        const listId = 'prop-tag-values-' + i;
        const key = h('input', { type: 'text', id: 'prop-tag-key-' + i, value: t.key, placeholder: 'Name', list: 'prop-tag-keys', maxlength: Tags.MAX_KEY, 'aria-label': 'Tag name', autocomplete: 'off' });
        key.addEventListener('input', () => update({ key: key.value }));
        key.addEventListener('change', () => store.endMerge());
        const val = h('input', { type: 'text', id: 'prop-tag-val-' + i, value: t.value, placeholder: 'Value', list: listId, maxlength: Tags.MAX_VALUE, 'aria-label': 'Tag value', autocomplete: 'off' });
        val.addEventListener('input', () => update({ value: val.value }));
        val.addEventListener('change', () => store.endMerge());
        return h('div', { class: 'custom-row tag-row' },
          h('span', { class: 'tag-dot', style: { background: Tags.colorFor(project, t.key) }, 'aria-hidden': 'true' }),
          key, val,
          h('datalist', { id: listId }, suggestions.map((v) => h('option', { value: v }))),
          h('button', {
            type: 'button', class: 'btn small danger', 'aria-label': 'Remove tag', text: '\u2715',
            onclick: () => store.change('remove tag', (p) => { Model.updateNode(p, node.id, { tags: node.tags.filter((_, j) => j !== i) }); })
          }));
      });
      const has = new Set(tags.map((t) => t.key.toLowerCase()));
      const quick = defs.filter((d) => !has.has(d.key.toLowerCase())).map((d) => h('button', {
        type: 'button', class: 'btn small', text: '+ ' + d.key, title: 'Add the tag "' + d.key + '"' + (d.values.length ? ' (' + d.values[0] + ')' : ''),
        onclick: () => store.change('add tag', (p) => { Model.updateNode(p, node.id, { tags: (node.tags || []).concat([{ key: d.key, value: d.values[0] || '' }]) }); })
      }));
      return [keyList, rows,
        h('div', { class: 'inline' },
          h('button', {
            type: 'button', class: 'btn small', text: '+ Add tag', disabled: tags.length >= Tags.MAX_TAGS,
            onclick: () => store.change('add tag', (p) => { Model.updateNode(p, node.id, { tags: (node.tags || []).concat([{ key: '', value: '' }]) }); })
          }),
          h('button', { type: 'button', class: 'btn small', text: 'Tag Manager\u2026', onclick: () => AISBP.Dialogs.openOptions(app, 'tags') })),
        quick.length ? h('div', { class: 'inline tag-quick' }, quick) : null];
    }

    /**
     * Virtual network / subnet picker for resources that can be attached to a network.
     * Lists every VNet and subnet of the blueprint (subnets indented below their VNet).
     */
    function networkSection(node, derived) {
      const project = store.project;
      const targets = Model.networkTargets(project);
      const linked = new Set(Model.networkLinks(project, node).map((n) => n.id));
      const head = h('h3', {}, h('span', { text: 'Virtual networks / subnets' }), eye(node, Layout.NETWORK_KEY));
      if (!targets.length) return [head, h('p', { class: 'subtitle', text: 'No virtual networks or subnets yet. Add a Virtual Network (with subnets) from the Networking palette to attach this resource to it.' })];
      const rows = targets.map((t) => {
        const id = 'prop-net-' + t.id;
        const cb = h('input', {
          type: 'checkbox', id, checked: linked.has(t.id),
          onchange: () => store.change('network', (p) => {
            const current = Model.networkLinks(p, p.nodes[node.id]).map((n) => n.id);
            Model.updateNode(p, node.id, { network: cb.checked ? current.concat([t.id]) : current.filter((x) => x !== t.id) });
          })
        });
        const label = (t.type === 'subnet' ? '\u00a0\u00a0\u21b3 ' : '') + (derived.geometry.names[t.id] || t.id) + ' (' + Catalog.get(t.type).label + ')';
        return field(label, cb, { check: true });
      });
      return [head, h('div', { class: 'network-list' }, rows)];
    }

    function nodeConnections(node, derived) {
      const project = store.project;
      const list = Object.keys(project.connections).map((k) => project.connections[k]).filter((c) => c.from === node.id || c.to === node.id);
      if (!list.length) return h('p', { class: 'subtitle', text: 'No connections. Drag the \u25cb handle of the object onto another object to connect them.' });
      return h('ul', { class: 'tree' }, list.map((c) => h('li', {}, h('div', {
        class: 'tree-row',
        onclick: () => store.select([], [c.id])
      }, h('span', { class: 'name', text: (c.direction === 'bidirectional' ? '\u2194 ' : c.from === node.id ? '\u2192 ' : '\u2190 ') + derived.geometry.names[c.from === node.id ? c.to : c.from] + (c.label ? ' (' + c.label + ')' : '') })))));
    }

    function renderNode(node) {
      const def = Catalog.get(node.type);
      const derived = store.derived();
      const level = store.project.settings.diagram.detailLevel;
      const out = [];
      out.push(h('h2', {}, icon(store.project, node.type, 28), h('span', { text: derived.geometry.names[node.id] || def.label })));
      out.push(h('p', { class: 'subtitle', text: def.label + (def.provider ? ' \u2022 ' + def.provider : '') }));
      out.push(h('h3', { text: 'Name' }), namingSection(node, def, derived));
      out.push(h('h3', { text: 'Placement' }), placementSection(node, def));
      out.push(h('h3', {}, h('span', { text: 'Attributes' }), h('button', {
        type: 'button', class: 'btn small', text: 'Reset display', title: 'Reset the diagram display choices of this object to the type defaults',
        onclick: () => store.change('reset display', (p) => { p.nodes[node.id].display = {}; })
      })));
      if (level !== 'selected') out.push(h('p', { class: 'note', text: 'The detail level is "' + Layout.DETAIL_LEVELS.find((d) => d.id === level).label + '". The \u{1F441} toggles apply to the "Selected attributes" level.' }));
      def.attributes.forEach((a) => out.push(attributeControl(node, a)));
      if (def.network) out.push(networkSection(node, derived));
      out.push(h('h3', { text: 'Custom attributes' }), customSection(node));
      out.push(h('h3', { text: 'Tags (' + (node.tags || []).length + ')' }), tagSection(node));
      out.push(h('h3', { text: 'Connections' }), nodeConnections(node, derived));
      out.push(h('h3', { text: 'Actions' }), h('div', { class: 'inline' },
        h('button', { type: 'button', class: 'btn', text: 'Duplicate', onclick: () => app.actions.duplicate() }),
        h('button', { type: 'button', class: 'btn', text: 'Copy', onclick: () => app.actions.copy() }),
        def.container || Model.children(store.project, node.id).length ? h('button', { type: 'button', class: 'btn', text: 'Tidy contents', onclick: () => app.actions.tidy(node.id) }) : null,
        h('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: () => app.actions.remove() })));
      return out;
    }

    function renderConnection(c) {
      const derived = store.derived();
      const both = c.direction === 'bidirectional';
      const out = [h('h2', { text: 'Connection' }), h('p', { class: 'subtitle', text: (derived.geometry.names[c.from] || '?') + (both ? ' \u2194 ' : ' \u2192 ') + (derived.geometry.names[c.to] || '?') })];
      const kind = select(Model.CONNECTION_KINDS.map((k) => ({ value: k.id, label: k.label + ' (ArchiMate: ' + k.archimate + ')' })), c.kind, { id: 'prop-conn-kind', onchange: () => patchConn(c.id, { kind: kind.value }) });
      out.push(field('Type', kind));
      const dir = select(Model.DIRECTIONS.map((d) => ({ value: d.id, label: d.label })), both ? 'bidirectional' : 'forward', { id: 'prop-conn-direction', onchange: () => patchConn(c.id, { direction: dir.value }) });
      out.push(field('Direction', dir));
      out.push(field('Label', textInput('prop-conn-label', c.label, (v) => patchConn(c.id, { label: v }, c.id + ':label'))));
      const proto = select(Model.PROTOCOLS, (c.attributes && c.attributes.protocol) || '', { id: 'prop-conn-protocol', onchange: () => patchConn(c.id, { attributes: { protocol: proto.value } }) });
      out.push(field('Protocol', proto));
      out.push(field('Description', textArea('prop-conn-desc', c.attributes && c.attributes.description, (v) => patchConn(c.id, { attributes: { description: v } }, c.id + ':desc'))));
      out.push(h('p', { class: 'subtitle', text: 'Drag the points on the selected line to adjust its route. Double-click a routing point to remove it.' }));
      out.push(h('div', { class: 'inline' },
        h('button', { type: 'button', class: 'btn', text: 'Reset route', disabled: !(c.waypoints && c.waypoints.length), onclick: () => patchConn(c.id, { waypoints: [] }) }),
        h('button', { type: 'button', class: 'btn', text: 'Reverse direction', onclick: () => store.change('reverse', (p) => { const x = p.connections[c.id]; const f = x.from; x.from = x.to; x.to = f; if (x.waypoints) x.waypoints.reverse(); }) }),
        h('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: () => app.actions.remove() })));
      return out;
    }

    /** Set a tag on all selected objects at once. */
    function multiTag() {
      const keys = Tags.definitions(store.project).map((d) => d.key);
      const key = h('input', { type: 'text', id: 'prop-multi-tag-key', placeholder: 'Tag name', list: 'prop-multi-tag-keys', maxlength: Tags.MAX_KEY, 'aria-label': 'Tag name', autocomplete: 'off' });
      const val = h('input', { type: 'text', id: 'prop-multi-tag-val', placeholder: 'Value', maxlength: Tags.MAX_VALUE, 'aria-label': 'Tag value', autocomplete: 'off' });
      return [h('h3', { text: 'Tag the selection' }),
        h('datalist', { id: 'prop-multi-tag-keys' }, keys.map((k) => h('option', { value: k }))),
        h('div', { class: 'custom-row' }, key, val, h('span'), h('button', {
          type: 'button', class: 'btn small', text: 'Apply',
          onclick: () => {
            const k = key.value.trim();
            if (!k || Tags.INVALID_KEY.test(k)) return AISBP.Dom.toast(k ? 'Tag names cannot contain < > % & \\ ? /' : 'Enter a tag name.', 'error');
            const ids = Array.from(store.selection.nodes);
            store.change('tag selection', (p) => { Tags.apply(p, { key: k, value: val.value, nodeIds: ids, overwrite: true }); });
            AISBP.Dom.toast('Tag "' + k + '" set on ' + ids.length + ' object(s).', 'success');
          }
        }))];
    }

    function renderMulti() {
      const n = store.selection.nodes.size;
      const c = store.selection.conns.size;
      return [
        h('h2', { text: (n + c) + ' objects selected' }),
        h('p', { class: 'subtitle', text: n + ' object(s), ' + c + ' connection(s)' }),
        n ? multiTag() : null,
        h('div', { class: 'inline' },
          h('button', { type: 'button', class: 'btn', text: 'Duplicate', onclick: () => app.actions.duplicate() }),
          h('button', { type: 'button', class: 'btn', text: 'Copy', onclick: () => app.actions.copy() }),
          h('button', { type: 'button', class: 'btn danger', text: 'Delete', onclick: () => app.actions.remove() }))
      ];
    }

    function renderProject() {
      const project = store.project;
      const derived = store.derived();
      const meta = project.meta;
      const setMeta = (key) => (v) => store.change('meta', (p) => { p.meta[key] = v; }, { merge: 'meta:' + key });
      const out = [h('h2', { text: 'Blueprint' }), h('p', { class: 'subtitle', text: 'Select an object to edit it. Nothing is selected.' })];
      out.push(field('Name', textInput('prop-meta-name', meta.name, setMeta('name'))));
      out.push(field('Author', textInput('prop-meta-author', meta.author, setMeta('author'))));
      out.push(field('Description', textArea('prop-meta-desc', meta.description, setMeta('description'))));
      const d = project.settings.diagram;
      const toggle = (key, label) => {
        const cb = h('input', { type: 'checkbox', id: 'prop-diagram-' + key, checked: d[key] !== false, onchange: () => store.change('diagram', (p) => { p.settings.diagram[key] = cb.checked; }) });
        return field(label, cb, { check: true });
      };
      out.push(h('h3', { text: 'Diagram' }));
      const conn = select(AISBP.Render.CONNECTORS.map((c) => ({ value: c.id, label: c.label })), d.connector, { id: 'prop-diagram-connector', onchange: () => store.change('diagram', (p) => { p.settings.diagram.connector = conn.value; }) });
      out.push(field('Connector style', conn));
      out.push(toggle('showTypeLabels', 'Show resource type labels'), toggle('showConnectionLabels', 'Show connection labels'), toggle('showTitle', 'Show title in exports'), toggle('showTags', 'Show tags'));
      const ids = Object.keys(derived.problems);
      out.push(h('h3', { text: 'Validation (' + ids.length + ')' }));
      if (!ids.length) out.push(h('p', { class: 'ok-note', text: '\u2713 All names follow the Azure naming rules and placements are valid.' }));
      else {
        out.push(h('ul', { class: 'tree' }, ids.map((id) => h('li', {}, h('div', {
          class: 'tree-row', title: derived.problems[id].join('\n'),
          onclick: () => { store.select([id]); app.canvas.centerOn(id); }
        }, h('span', { class: 'problem', text: '!' }), h('span', { class: 'name', text: (derived.geometry.names[id] || id) + ': ' + derived.problems[id][0] }))))));
      }
      const count = Object.keys(project.nodes).length;
      out.push(h('h3', { text: 'Statistics' }), h('p', { class: 'subtitle', text: count + ' object(s), ' + Object.keys(project.connections).length + ' connection(s)' }));
      return out;
    }

    function render() {
      // Preserve focus and caret position across re-renders.
      const active = root.document.activeElement;
      const focusId = active && el.contains(active) ? active.id : null;
      const caret = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      const scroll = el.scrollTop;
      clear(el);
      const node = store.singleNode();
      let content;
      if (node) content = renderNode(node);
      else if (store.selection.conns.size === 1 && !store.selection.nodes.size) content = renderConnection(store.project.connections[store.selectedConns()[0]]);
      else if (store.selection.nodes.size || store.selection.conns.size) content = renderMulti();
      else content = renderProject();
      AISBP.Dom.append(el, content);
      el.scrollTop = scroll;
      if (focusId) {
        const target = root.document.getElementById(focusId);
        if (target) {
          target.focus();
          if (caret && typeof target.setSelectionRange === 'function') {
            try { target.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text input */ }
          }
        }
      }
    }

    return { render };
  }

  AISBP.Properties = { mount };
})(typeof globalThis !== 'undefined' ? globalThis : this);
