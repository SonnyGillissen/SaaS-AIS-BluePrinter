/**
 * AIS BluePrinter - dialogs: options, projects and help.
 *
 * The options dialog edits a working copy of the project settings (naming conventions,
 * diagram display, icons). Nothing is applied
 * until "Save" is pressed, and the change is a single undo step.
 *
 * @module AISBP.Dialogs
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { h, clear, icon, field, select, modal, toast, confirm } = AISBP.Dom;
  const Catalog = AISBP.Catalog;
  const Model = AISBP.Model;
  const Naming = AISBP.Naming;
  const Util = AISBP.Util;

  /** Tab strip helper: returns { el, panels } where panels[id] are containers. */
  function tabs(defs) {
    const strip = h('div', { class: 'tabs', role: 'tablist' });
    const panels = {};
    const body = h('div');
    defs.forEach((d, i) => {
      const panel = h('div', { role: 'tabpanel', id: 'opt-panel-' + d.id, hidden: i !== 0 });
      panels[d.id] = panel;
      body.appendChild(panel);
      strip.appendChild(h('button', {
        type: 'button', role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false', 'aria-controls': 'opt-panel-' + d.id, text: d.label,
        onclick: (e) => {
          Array.from(strip.children).forEach((b) => b.setAttribute('aria-selected', 'false'));
          e.currentTarget.setAttribute('aria-selected', 'true');
          Object.keys(panels).forEach((k) => { panels[k].hidden = k !== d.id; });
        }
      }));
    });
    return { el: h('div', {}, strip, body), panels };
  }

  function textInput(value, onInput, attrs) {
    const input = h('input', Object.assign({ type: 'text', value: value || '', spellcheck: 'false', autocomplete: 'off' }, attrs || {}));
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  function checkbox(checked, onChange) {
    const cb = h('input', { type: 'checkbox', checked: !!checked });
    cb.addEventListener('change', () => onChange(cb.checked));
    return cb;
  }

  // ---------------------------------------------------------------------------
  // Options
  // ---------------------------------------------------------------------------

  function openOptions(app, initialTab) {
    const project = app.store.project;
    const s = Util.clone(project.settings);
    // A preview project shares the working settings so examples update live.
    const preview = Object.assign({}, project, { settings: s });

    const t = tabs([
      { id: 'naming', label: 'Naming conventions' },
      { id: 'types', label: 'Per resource type' },
      { id: 'diagram', label: 'Diagram' },
      { id: 'icons', label: 'Icons' },
      { id: 'storage', label: 'Storage & privacy' }
    ]);

    // ---- Naming
    const example = h('div', { class: 'name-preview' });
    const updateExample = () => {
      const sampleNodes = ['resource-group', 'logic-app-standard', 'service-bus-namespace', 'storage-account', 'key-vault'];
      const lines = sampleNodes.map((type) => {
        const fake = { id: 'preview-' + type, type, parentId: null, seq: 1, label: 'orders', nameMode: 'convention', name: '', naming: { pattern: '', tokens: { region: Naming.regionAbbreviation(preview, 'westeurope') } }, attributes: { location: 'westeurope' }, custom: [], display: {}, x: 0, y: 0 };
        const p = Object.assign({}, preview, { nodes: { [fake.id]: fake } });
        return Catalog.get(type).label + ': ' + Naming.resolveName(p, fake);
      });
      clear(example);
      lines.forEach((l) => example.appendChild(h('div', { text: l })));
    };
    const n = s.naming;
    const customTokens = h('div');
    const renderCustomTokens = () => {
      clear(customTokens);
      Object.keys(n.tokens).filter((k) => ['org', 'workload', 'env'].indexOf(k) === -1).forEach((k) => {
        customTokens.appendChild(h('div', { class: 'custom-row' },
          h('input', { type: 'text', value: k, disabled: true, 'aria-label': 'Token name' }),
          textInput(n.tokens[k], (v) => { n.tokens[k] = v; updateExample(); }, { 'aria-label': 'Token value' }),
          h('span'),
          h('button', { type: 'button', class: 'btn small danger', text: '\u2715', 'aria-label': 'Remove token', onclick: () => { delete n.tokens[k]; renderCustomTokens(); updateExample(); } })));
      });
      const newKey = h('input', { type: 'text', placeholder: 'new token, e.g. bu', 'aria-label': 'New token name' });
      customTokens.appendChild(h('div', { class: 'inline' }, newKey, h('button', {
        type: 'button', class: 'btn small', text: '+ Add token',
        onclick: () => {
          const k = newKey.value.trim();
          if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k)) return toast('Token names start with a letter and contain letters, digits or underscores.', 'error');
          if (['abbr', 'name', 'type', 'instance', 'region', 'parent'].indexOf(k) !== -1) return toast('"' + k + '" is a built-in token.', 'error');
          n.tokens[k] = n.tokens[k] || '';
          renderCustomTokens();
        }
      })));
    };
    renderCustomTokens();
    const padding = h('input', { type: 'number', min: 1, max: 6, value: n.instancePadding });
    padding.addEventListener('input', () => { n.instancePadding = Util.clamp(Number(padding.value) || 3, 1, 6); updateExample(); });
    AISBP.Dom.append(t.panels.naming, [
      h('p', { class: 'note', text: 'Names are generated from patterns with tokens: {abbr} (resource abbreviation), {name} (object name/purpose), {org}, {workload}, {env}, {region} (location abbreviation), {instance} (auto number), {parent} (parent name) and your own tokens. Tokens can be overridden per object and are inherited from parent objects (e.g. set {env} on a subscription). Names are automatically adjusted to the Azure naming rules of each resource type (length, allowed characters, lowercase).' }),
      h('div', { class: 'grid-2' },
        field('Resource pattern (resource groups and resources)', textInput(n.pattern, (v) => { n.pattern = v; updateExample(); }, { id: 'opt-pattern' })),
        field('Child resource pattern (queues, workflows, APIs, ...)', textInput(n.childPattern, (v) => { n.childPattern = v; updateExample(); }, { id: 'opt-child-pattern' }))),
      h('div', { class: 'grid-3' },
        field('{org}', textInput(n.tokens.org, (v) => { n.tokens.org = v; updateExample(); }, { id: 'opt-token-org' })),
        field('{workload}', textInput(n.tokens.workload, (v) => { n.tokens.workload = v; updateExample(); }, { id: 'opt-token-workload' })),
        field('{env}', textInput(n.tokens.env, (v) => { n.tokens.env = v; updateExample(); }, { id: 'opt-token-env' }))),
      h('h4', { text: 'Custom tokens' }), customTokens,
      h('div', { class: 'grid-2' },
        field('Instance number digits', padding),
        field('Apply Azure naming rules automatically', checkbox(n.enforce !== false, (v) => { n.enforce = v; updateExample(); }), { check: true, help: 'Removes invalid characters, lowercases and shortens names where Azure requires it.' })),
      h('h4', { text: 'Example (name/purpose "orders", West Europe)' }), example
    ]);
    updateExample();

    // ---- Per resource type: abbreviation, pattern, display defaults
    const typeRows = Catalog.all().filter((d) => d.rule).map((d) => {
      const abbr = textInput(n.abbreviations[d.id], (v) => { if (v) n.abbreviations[d.id] = v; else delete n.abbreviations[d.id]; updateExample(); }, { placeholder: d.abbr, 'aria-label': d.label + ' abbreviation' });
      const fakeNode = { id: 'x', type: d.id, naming: { pattern: '', tokens: {} } };
      const defaultPattern = Naming.patternFor(Object.assign({}, preview, { settings: Object.assign({}, s, { naming: Object.assign({}, n, { typePatterns: {} }) }) }), fakeNode);
      const pattern = textInput(n.typePatterns[d.id], (v) => { if (v) n.typePatterns[d.id] = v; else delete n.typePatterns[d.id]; updateExample(); }, { placeholder: defaultPattern, 'aria-label': d.label + ' pattern' });
      return h('tr', {}, h('td', { class: 'icon' }, icon(project, d.id, 20)), h('td', { title: d.provider || '' , text: d.label }), h('td', {}, abbr), h('td', {}, pattern), h('td', { class: 'rule', text: Naming.describeRule(d.rule) }));
    });
    const regionRows = Catalog.REGIONS.map((r) => h('tr', {}, h('td', { text: r.label }), h('td', {}, textInput(n.regionAbbreviations[r.id], (v) => { if (v) n.regionAbbreviations[r.id] = v; else delete n.regionAbbreviations[r.id]; updateExample(); }, { placeholder: r.abbr, 'aria-label': r.label + ' abbreviation' }))));
    AISBP.Dom.append(t.panels.types, [
      h('p', { class: 'note', text: 'Override the abbreviation and naming pattern per resource type. Empty fields use the default shown in grey (Cloud Adoption Framework abbreviations). Individual objects can still override the pattern in the properties panel.' }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}), h('th', { text: 'Resource type' }), h('th', { text: 'Abbreviation' }), h('th', { text: 'Pattern' }), h('th', { text: 'Azure naming rule' }))),
        h('tbody', {}, typeRows))),
      h('h4', { text: 'Region abbreviations ({region})' }),
      h('div', { class: 'table-scroll', style: { maxHeight: '30vh' } }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', { text: 'Region' }), h('th', { text: 'Abbreviation' }))), h('tbody', {}, regionRows)))
    ]);

    // ---- Diagram
    const d = s.diagram;
    const styleSel = select(Object.keys(AISBP.Render.STYLES).map((k) => ({ value: k, label: AISBP.Render.STYLES[k].label })), d.style, { onchange: () => { d.style = styleSel.value; } });
    const detailSel = select(AISBP.Layout.DETAIL_LEVELS.map((x) => ({ value: x.id, label: x.label })), d.detailLevel, { onchange: () => { d.detailLevel = detailSel.value; } });
    const connSel = select(AISBP.Render.CONNECTORS.map((x) => ({ value: x.id, label: x.label })), d.connector, { onchange: () => { d.connector = connSel.value; } });
    const pageSel = select([{ value: 'fit', label: 'Fit to diagram' }, { value: 'A4', label: 'A4' }, { value: 'A3', label: 'A3' }, { value: 'Letter', label: 'Letter' }], d.pdfPageSize, { onchange: () => { d.pdfPageSize = pageSel.value; } });
    const grid = h('input', { type: 'number', min: 2, max: 100, value: d.gridSize });
    grid.addEventListener('input', () => { d.gridSize = Util.clamp(Number(grid.value) || 10, 2, 100); });
    const containerTypes = Catalog.all().filter((x) => x.container);
    const hidden = new Set(d.hiddenContainers || []);
    const chips = h('div', { class: 'chips' }, containerTypes.map((x) => h('label', { class: 'chip' }, checkbox(hidden.has(x.id), (v) => {
      if (v) hidden.add(x.id); else hidden.delete(x.id);
      d.hiddenContainers = Array.from(hidden);
    }), x.label)));

    // Per type: default attribute display
    const attrBox = h('div');
    const typeSel = select([{ value: '', label: 'Select a resource type\u2026' }].concat(Catalog.all().map((x) => ({ value: x.id, label: x.label }))), '', {
      onchange: () => {
        clear(attrBox);
        const def = Catalog.get(typeSel.value);
        if (!def) return;
        d.typeDisplay = d.typeDisplay || {};
        const td = d.typeDisplay[def.id] || {};
        attrBox.appendChild(h('div', { class: 'chips' }, def.attributes.map((a) => {
          const shown = typeof td[a.key] === 'boolean' ? td[a.key] : !!a.show;
          return h('label', { class: 'chip' }, checkbox(shown, (v) => {
            d.typeDisplay[def.id] = Object.assign({}, d.typeDisplay[def.id] || {});
            d.typeDisplay[def.id][a.key] = v;
          }), a.label);
        })));
      }
    });
    AISBP.Dom.append(t.panels.diagram, [
      h('div', { class: 'grid-3' }, field('Display style', styleSel), field('Detail level', detailSel), field('Connector style', connSel)),
      h('div', { class: 'grid-3' },
        field('Show resource type labels', checkbox(d.showTypeLabels !== false, (v) => { d.showTypeLabels = v; }), { check: true }),
        field('Show connection labels', checkbox(d.showConnectionLabels !== false, (v) => { d.showConnectionLabels = v; }), { check: true }),
        field('Show title in exports', checkbox(d.showTitle !== false, (v) => { d.showTitle = v; }), { check: true })),
      h('div', { class: 'grid-3' },
        field('Snap to grid', checkbox(d.snapToGrid !== false, (v) => { d.snapToGrid = v; }), { check: true }),
        field('Grid size (px)', grid),
        field('PDF page size', pageSel)),
      h('h4', { text: 'Hide container levels (high-level views)' }),
      h('p', { class: 'subtitle', text: 'Hidden containers are not drawn; their contents are shown in the next visible level. Example: hide resource groups for a high-level overview.' }),
      chips,
      h('h4', { text: 'Attributes shown by default per resource type ("Selected attributes" level)' }),
      field('Resource type', typeSel), attrBox
    ]);

    // ---- Icons
    const baseInput = textInput(s.icons.baseUrl, (v) => { s.icons.baseUrl = v; }, { id: 'opt-icons-base' });
    AISBP.Dom.append(t.panels.icons, [
      h('p', { class: 'note' }, 'All resource icons come from ', h('a', { href: 'https://msicons.com/', target: '_blank', rel: 'noopener', text: 'MS Icons' }), ', a community project by Daniel Bradley (', h('a', { href: 'https://github.com/DanielBradley1/msicons', target: '_blank', rel: 'noopener', text: 'github.com/DanielBradley1/msicons' }), ') that hosts the official Microsoft Azure architecture icons. The icons are property of Microsoft and subject to the Microsoft icon terms.'),
      field('Icon base URL', baseInput, { help: 'Default: ' + AISBP.Icons.DEFAULT_BASE + ' \u2014 for offline/intranet use, mirror the icons with "node tools/mirror-icons.js" and set this to "icons/msicons/".' }),
      h('button', { type: 'button', class: 'btn small', text: 'Reset to msicons.com', onclick: () => { s.icons.baseUrl = AISBP.Icons.DEFAULT_BASE; baseInput.value = s.icons.baseUrl; } })
    ]);

    // ---- Storage & privacy
    const adapter = app.storage;
    AISBP.Dom.append(t.panels.storage, [
      adapter.kind === 'local'
        ? h('p', { class: 'note', text: 'AIS BluePrinter runs entirely in your browser. Your blueprints are saved automatically in this browser\'s localStorage and never leave your machine; no account, cookies, tracking or server is involved. Clearing your browser data removes them, so export a configuration package (.json) as a backup or to share a blueprint.' })
        : h('p', { class: 'note warn', text: 'This instance stores blueprints in a database on the server configured in js/config.js (' + app.config.storage.apiUrl + ').' }),
      adapter.kind === 'local' ? h('p', { text: 'Space used in this browser: ' + (adapter.usage() / 1024).toFixed(1) + ' KB (browsers typically allow about 5 MB).' }) : null,
      adapter.kind === 'local' ? h('button', {
        type: 'button', class: 'btn danger', text: 'Delete all AIS BluePrinter data from this browser',
        onclick: async () => {
          if (!(await confirm('Delete all data', 'This permanently deletes all blueprints and preferences stored by AIS BluePrinter in this browser. Continue?', 'Delete everything'))) return;
          app.actions.clearLocalData();
        }
      }) : null
    ]);

    if (initialTab && t.panels[initialTab]) {
      const btn = t.el.querySelector('[aria-controls="opt-panel-' + initialTab + '"]');
      if (btn) btn.click();
    }

    modal({
      title: 'Options',
      body: t.el,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save',
          primary: true,
          action: () => {
            const clean = Model.deepMerge(Model.defaultSettings(), Model.sanitizeSettings(s));
            if (s.icons.baseUrl && clean.icons.baseUrl !== s.icons.baseUrl) toast('The icon base URL is not valid and was not changed.', 'error');
            app.store.change('options', (p) => { p.settings = clean; });
            app.refreshAll();
            toast('Options saved.', 'success');
          }
        }
      ]
    });
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async function openProjects(app) {
    const list = h('ul', { class: 'project-list' });
    const body = h('div', {},
      h('p', { class: 'note', text: app.storage.kind === 'local' ? 'Blueprints saved in this browser (localStorage). They are saved automatically while you work.' : 'Blueprints stored in the database.' }),
      list);
    let dlg = null;
    const refresh = async () => {
      clear(list);
      let items = [];
      try {
        items = await app.storage.list();
      } catch (e) {
        list.appendChild(h('li', { text: 'Could not load the list: ' + e.message }));
        return;
      }
      if (!items.length) list.appendChild(h('li', { text: 'No saved blueprints yet.' }));
      items.forEach((it) => {
        const current = it.id === app.store.project.meta.id;
        list.appendChild(h('li', { class: current ? 'current' : '' },
          h('div', { class: 'meta' }, h('strong', { text: it.name || '(untitled)' }), h('small', { text: (current ? 'Open now \u2022 ' : '') + 'Modified ' + new Date(it.modified).toLocaleString() })),
          h('button', { type: 'button', class: 'btn small', text: 'Open', disabled: current, onclick: async () => { await app.actions.open(it.id); dlg.close(); } }),
          h('button', {
            type: 'button', class: 'btn small danger', text: 'Delete',
            onclick: async () => {
              if (!(await confirm('Delete blueprint', 'Delete "' + (it.name || 'untitled') + '"? This cannot be undone.', 'Delete'))) return;
              await app.actions.deleteProject(it.id);
              refresh();
            }
          })));
      });
    };
    dlg = modal({
      title: 'Open blueprint',
      body,
      buttons: [
        { label: 'New with sample', action: () => app.actions.newProject(true) },
        { label: 'New blank blueprint', primary: true, action: () => app.actions.newProject(false) }
      ]
    });
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Help
  // ---------------------------------------------------------------------------

  function openHelp(app) {
    const shortcuts = [
      ['Delete / Backspace', 'Delete the selection'],
      ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy, cut and paste (also between browser tabs)'],
      ['Ctrl+D', 'Duplicate the selection'],
      ['Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)', 'Undo / redo'],
      ['Ctrl+A', 'Select everything'],
      ['Arrow keys (Shift = 10\u00d7)', 'Move the selection'],
      ['Escape', 'Clear the selection'],
      ['+ / - / 0 / F', 'Zoom in, zoom out, reset zoom, fit to screen'],
      ['Shift+drag', 'Select with a rectangle'],
      ['Drag empty space / mouse wheel', 'Pan'],
      ['Ctrl+wheel', 'Zoom']
    ];
    modal({
      title: 'Help',
      body: h('div', {},
        h('h3', { text: 'Building a blueprint' }),
        h('ol', {},
          h('li', { text: 'Drag a management group, subscription or resource group from the palette onto the canvas (or click it in the palette).' }),
          h('li', { text: 'Drop resources inside a resource group, and child resources (queues, workflows, APIs, \u2026) inside their parent resource. Invalid placements are refused.' }),
          h('li', { text: 'Select an object to edit its name, attributes and diagram display in the properties panel. Use the eye buttons to choose which attributes appear on the diagram.' }),
          h('li', { text: 'Drag the round handle next to a selected object onto another object to connect them.' }),
          h('li', { text: 'Use Options for naming conventions and display styles, and Export for JSON, PNG, PDF, SVG, draw.io and ArchiMate.' })),
        h('h3', { text: 'Keyboard shortcuts' }),
        h('table', { class: 'data' }, h('tbody', {}, shortcuts.map((s) => h('tr', {}, h('td', {}, h('span', { class: 'kbd', text: s[0] })), h('td', { text: s[1] }))))),
        h('h3', { text: 'Privacy' }),
        h('p', { text: app.storage.kind === 'local' ? 'Everything runs in your browser and is stored in localStorage on this machine. Nothing is uploaded. Icons are loaded from msicons.com (or your own mirror).' : 'This instance stores blueprints in a server database.' }),
        h('h3', { text: 'Credits' }),
        h('p', {}, 'AIS BluePrinter \u2014 Community Project by ', h('strong', { text: 'Sonny Gillissen' }), '. Version ' + AISBP.Package.APP_VERSION + '.'),
        h('p', {}, 'Resource icons: ', h('a', { href: 'https://msicons.com/', target: '_blank', rel: 'noopener', text: 'MS Icons (msicons.com)' }), ', a community project by Daniel Bradley. Azure icons \u00a9 Microsoft, used according to the Microsoft architecture icon terms.'))
    });
  }

  AISBP.Dialogs = { openOptions, openProjects, openHelp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
