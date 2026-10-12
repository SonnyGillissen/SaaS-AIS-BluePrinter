/**
 * AIS BluePrinter - dialogs: options, projects and help.
 *
 * The options dialog edits a working copy of the project settings (naming conventions,
 * diagram display, icons, tag definitions) and - for the Tag Manager - of the tags of all
 * objects. Nothing is applied until "Save" is pressed, and the change is a single undo step.
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
  const Tags = AISBP.Tags;

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

  function openExportOptions(format, project) {
    return new Promise((resolve) => {
      let result = null;
      const embed = h('input', { type: 'checkbox', checked: AISBP.Embedded.enabled() });
      const body = h('div', {},
        field('Embed complete blueprint', embed, { check: true }),
        h('p', { class: 'note', text: 'Warning: embedding includes the complete blueprint, including hidden resources, attributes, tags, settings and other data not visible in the diagram. Only share it with trusted recipients. Uncheck to export without this hidden data.' }));
      let mode;
      let color;
      if (['svg', 'png', 'pdf', 'drawio'].includes(format)) {
        const modes = [{ value: 'style', label: 'Style default' }, { value: 'custom', label: 'Custom solid color' }];
        if (format !== 'pdf') modes.push({ value: 'transparent', label: 'Transparent' });
        const initialColor = AISBP.Render.style(project.settings.diagram.style).background;
        const picker = h('input', { type: 'color', value: initialColor, oninput: () => { color.value = picker.value; } });
        color = h('input', {
          type: 'text', value: initialColor, placeholder: '#RRGGBB', pattern: '#[0-9a-fA-F]{6}', maxlength: 7, spellcheck: 'false',
          oninput: () => { if (/^#[0-9a-fA-F]{6}$/.test(color.value)) picker.value = color.value.toLowerCase(); }
        });
        const colorField = h('div', {}, h('div', { class: 'grid-2' }, field('Choose background color', picker), field('Background color (#RRGGBB)', color)));
        colorField.hidden = true;
        color.disabled = picker.disabled = true;
        mode = select(modes, 'style', { onchange: () => {
          colorField.hidden = mode.value !== 'custom';
          color.disabled = picker.disabled = mode.value !== 'custom';
        } });
        body.appendChild(field('Background', mode));
        body.appendChild(colorField);
        if (format === 'pdf') body.appendChild(h('p', { class: 'note', text: 'PDF uses an opaque JPEG image and does not support transparency. The selected background also fills the page margins.' }));
      }
      modal({
        title: 'Export ' + (format === 'archimate' ? 'ArchiMate' : format === 'drawio' ? 'draw.io' : format.toUpperCase()),
        small: true,
        body,
        buttons: [
          { label: 'Cancel' },
          { label: 'Export', primary: true, action: () => {
            const opts = { embedDiagram: embed.checked };
            if (mode && mode.value !== 'style') {
              try {
                opts.background = AISBP.Render.background(mode.value === 'transparent' ? 'transparent' : color.value, undefined, format !== 'pdf');
              } catch (e) {
                toast(e.message, 'error');
                color.focus();
                return false;
              }
            }
            result = opts;
          } }
        ],
        onClose: () => resolve(result)
      });
    });
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
      { id: 'tags', label: 'Tag Manager' },
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
      const ruleText = Naming.describeRule(d.rule);
      const rule = h('button', {
        type: 'button', class: 'btn small naming-rule', text: d.rule.min + '\u2013' + d.rule.max + ' chars \u24d8',
        title: ruleText, 'aria-label': 'Azure naming rule for ' + d.label, 'aria-haspopup': 'dialog',
        onclick: () => modal({
          title: d.label + ' \u2014 Azure naming rule', small: true,
          body: h('ul', { class: 'naming-rule-details' }, ruleText.split('; ').map((part) => h('li', { text: part })))
        })
      });
      return h('tr', {}, h('td', { class: 'icon' }, icon(project, d.id, 20)), h('td', { title: d.provider || '' , text: d.label }), h('td', {}, abbr), h('td', {}, pattern), h('td', {}, rule));
    });
    const regionRows = Catalog.REGIONS.map((r) => h('tr', {}, h('td', { text: r.label }), h('td', {}, textInput(n.regionAbbreviations[r.id], (v) => { if (v) n.regionAbbreviations[r.id] = v; else delete n.regionAbbreviations[r.id]; updateExample(); }, { placeholder: r.abbr, 'aria-label': r.label + ' abbreviation' }))));
    AISBP.Dom.append(t.panels.types, [
      h('p', { class: 'note', text: 'Override the abbreviation and naming pattern per resource type. Empty fields use the default shown in grey (Cloud Adoption Framework abbreviations). Individual objects can still override the pattern in the properties panel.' }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data naming-types' },
        h('colgroup', {}, h('col', { class: 'type-icon' }), h('col', { class: 'type-label' }), h('col', { class: 'type-abbr' }), h('col'), h('col', { class: 'type-rule' })),
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

    // ---- Tag Manager
    // Bulk tag changes are made on a working copy of the objects and applied on Save.
    s.tags = s.tags && Array.isArray(s.tags.definitions) ? s.tags : { definitions: [] };
    const work = { nodes: Util.clone(project.nodes), settings: s };
    const defs = s.tags.definitions;
    // Tags used on objects but not defined yet are listed (and saved) as definitions.
    const used = Tags.usage(work);
    Object.keys(used).forEach((k) => { if (!Tags.definition(work, k)) defs.push({ key: used[k].key, values: used[k].values.slice(0, 50), color: '', show: true }); });
    const tagTable = h('tbody');
    const keyList = h('datalist', { id: 'opt-tag-keys' });
    const valueList = h('datalist', { id: 'opt-tag-values' });
    const bulkKey = h('input', { type: 'text', id: 'opt-tag-bulk-key', list: 'opt-tag-keys', placeholder: 'e.g. Managed by', 'aria-label': 'Tag name', autocomplete: 'off' });
    const bulkValue = h('input', { type: 'text', id: 'opt-tag-bulk-value', list: 'opt-tag-values', placeholder: 'e.g. customer', 'aria-label': 'Tag value', autocomplete: 'off' });
    const fillValues = () => {
      const def = Tags.definition(work, bulkKey.value.trim());
      clear(valueList);
      (def ? def.values : []).forEach((v) => valueList.appendChild(h('option', { value: v })));
    };
    bulkKey.addEventListener('input', fillValues);
    const renderTags = () => {
      const usage = Tags.usage(work);
      clear(tagTable);
      clear(keyList);
      defs.forEach((def, i) => {
        keyList.appendChild(h('option', { value: def.key }));
        const u = usage[def.key.toLowerCase()];
        const keyInput = textInput(def.key, () => {}, { 'aria-label': 'Tag name', maxlength: Tags.MAX_KEY });
        keyInput.addEventListener('change', () => {
          const next = keyInput.value.trim();
          if (!next || Tags.INVALID_KEY.test(next) || defs.some((x, j) => j !== i && x.key.toLowerCase() === next.toLowerCase())) {
            toast(!next ? 'A tag needs a name.' : Tags.INVALID_KEY.test(next) ? 'Tag names cannot contain < > % & \\ ? /' : 'Tag "' + next + '" already exists.', 'error');
            keyInput.value = def.key;
            return;
          }
          const n = Tags.rename(work, def.key, next);
          def.key = next;
          if (n) toast('Renamed the tag on ' + n + ' object(s).', 'success');
          renderTags();
        });
        const values = textInput(def.values.join(', '), (v) => { def.values = v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50); }, { 'aria-label': def.key + ' suggested values', placeholder: 'customer, provider' });
        const color = h('input', { type: 'color', value: Tags.colorFor(work, def.key), 'aria-label': def.key + ' colour', title: 'Colour on the diagram' });
        color.addEventListener('input', () => { def.color = color.value; });
        tagTable.appendChild(h('tr', {},
          h('td', {}, keyInput),
          h('td', {}, values),
          h('td', {}, color),
          h('td', {}, checkbox(def.show !== false, (v) => { def.show = v; })),
          h('td', { class: 'num', text: String(u ? u.count : 0) }),
          h('td', { class: 'actions' },
            h('button', {
              type: 'button', class: 'btn small', text: 'Remove from objects', disabled: !u, title: 'Remove this tag from all objects',
              onclick: () => { const n = Tags.remove(work, def.key); toast('Removed "' + def.key + '" from ' + n + ' object(s).', 'success'); renderTags(); }
            }),
            h('button', {
              type: 'button', class: 'btn small danger', text: '\u2715', 'aria-label': 'Delete tag definition', title: 'Delete the definition (and the tag from all objects)',
              onclick: () => { Tags.remove(work, def.key); defs.splice(i, 1); renderTags(); }
            }))));
      });
      if (!defs.length) tagTable.appendChild(h('tr', {}, h('td', { colspan: 6, class: 'subtitle', text: 'No tags yet. Add one below.' })));
      fillValues();
    };
    const newTag = h('input', { type: 'text', id: 'opt-tag-new', placeholder: 'new tag, e.g. Managed by', 'aria-label': 'New tag name', maxlength: Tags.MAX_KEY });
    const addTag = () => {
      const k = newTag.value.trim();
      if (!k) return;
      if (Tags.INVALID_KEY.test(k)) return toast('Tag names cannot contain < > % & \\ ? /', 'error');
      if (Tags.definition(work, k)) return toast('Tag "' + k + '" already exists.', 'error');
      if (defs.length >= 200) return toast('At most 200 tag definitions.', 'error');
      defs.push({ key: k, values: [], color: '', show: true });
      newTag.value = '';
      renderTags();
    };
    newTag.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    const scopes = new Set(['hierarchy', 'resource-group', 'resource']);
    const overwrite = checkbox(true, () => {});
    const scopeChips = h('div', { class: 'chips' }, Tags.SCOPES.map((x) => h('label', { class: 'chip' }, checkbox(scopes.has(x.id), (v) => { if (v) scopes.add(x.id); else scopes.delete(x.id); }), x.label)));
    renderTags();
    AISBP.Dom.append(t.panels.tags, [
      h('p', { class: 'note', text: 'Define the tags of your environment (for example "Managed by", "Cost center", "Environment") with suggested values and a colour, and assign them to management groups, subscriptions, resource groups and resources in one go. Individual objects can be tagged in the properties panel. Azure allows at most 50 tags per object; names (max. 512 characters, case-insensitive) cannot contain < > % & \\ ? / and values are limited to 256 characters. Note that Azure itself does not support tags on management groups; they are documentation-only there.' }),
      field('Show tags on the diagram', checkbox(d.showTags !== false, (v) => { d.showTags = v; }), { check: true, help: 'Tags are drawn as coloured chips below the attributes (not at the "High-level" detail level).' }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'data tag-table' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Tag name' }), h('th', { text: 'Suggested values (comma-separated)' }), h('th', { text: 'Colour' }), h('th', { text: 'Show' }), h('th', { text: 'Used by' }), h('th', {}))),
        tagTable)),
      h('div', { class: 'inline' }, newTag, h('button', { type: 'button', class: 'btn small', text: '+ Add tag', onclick: addTag })),
      h('h4', { text: 'Assign a tag to many objects' }),
      h('div', { class: 'grid-2' }, field('Tag name', bulkKey), field('Value', bulkValue)),
      scopeChips,
      field('Overwrite existing values', overwrite, { check: true }),
      h('button', {
        type: 'button', class: 'btn', id: 'opt-tag-apply', text: 'Apply to objects',
        onclick: () => {
          const k = bulkKey.value.trim();
          if (!k) return toast('Enter a tag name.', 'error');
          if (Tags.INVALID_KEY.test(k)) return toast('Tag names cannot contain < > % & \\ ? /', 'error');
          if (!scopes.size) return toast('Select at least one kind of object.', 'error');
          const n = Tags.apply(work, { key: k, value: bulkValue.value, scopes: Array.from(scopes), overwrite: overwrite.checked });
          const v = bulkValue.value.trim();
          const def = Tags.definition(work, k);
          if (!def) defs.push({ key: k, values: v ? [v] : [], color: '', show: true });
          else if (v && def.values.indexOf(v) < 0 && def.values.length < 50) def.values.push(v);
          toast('Tag "' + k + '" set on ' + n + ' object(s). Press Save to keep the changes.', 'success');
          renderTags();
        }
      }),
      keyList, valueList
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
            app.store.change('options', (p) => {
              p.settings = clean;
              Object.keys(work.nodes).forEach((id) => { if (p.nodes[id]) p.nodes[id].tags = Tags.sanitize(work.nodes[id].tags); });
            });
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

  AISBP.Dialogs = { openOptions, openProjects, openHelp, openExportOptions };
})(typeof globalThis !== 'undefined' ? globalThis : this);
