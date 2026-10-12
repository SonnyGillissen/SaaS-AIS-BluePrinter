/**
 * AIS BluePrinter - "Load from Azure" dialog.
 *
 * 1. Sign in with your own app registration (AISBP.AzureAuth, browser only).
 * 2. Tick the management groups, subscriptions and resource groups to load.
 * 3. Everything in that scope is read (AISBP.AzureArm), converted into a blueprint
 *    (AISBP.Azure.buildProject) and opened as a new blueprint.
 *
 * The access token is kept in memory for this browser tab only. The client id and tenant are
 * remembered in localStorage (key `aisbp.azure`) for convenience; they are not secrets.
 *
 * @module AISBP.AzureUi
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const { h, clear, icon, field, modal } = AISBP.Dom;
  const Azure = AISBP.Azure;
  const Arm = AISBP.AzureArm;
  const Auth = AISBP.AzureAuth;
  const KEY = Azure.KEY;
  const PREFS_KEY = 'aisbp.azure';
  const lower = (s) => String(s || '').toLowerCase();

  /** Signed-in session of this tab: { accessToken, expiresAt, account, tenantId, clientId }. */
  let session = null;
  /** Selection tree of the session (kept while the tab is open). */
  let tree = null;

  const valid = () => !!session && session.expiresAt - 60000 > Date.now();

  function readPrefs() {
    try {
      const v = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) {
      return {};
    }
  }

  function writePrefs(p) {
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function client() {
    return Arm.createClient({ getToken: () => (valid() ? session.accessToken : '') });
  }

  function open(app) {
    const cfg = Object.assign({ clientId: '', tenantId: '', redirectUri: '' }, app.config.azure || {});
    const prefs = readPrefs();
    const redirectUri = cfg.redirectUri || Auth.defaultRedirectUri();
    const checked = new Set();
    const expanded = new Set();
    let busy = false;
    let closed = false;

    const status = h('p', { class: 'azure-status', role: 'status', 'aria-live': 'polite' });
    const setStatus = (text, kind) => {
      status.textContent = text || '';
      status.className = 'azure-status' + (kind ? ' ' + kind : '');
    };

    // ---- Step 1: sign in
    const signinBox = h('div');
    const clientId = h('input', { type: 'text', value: prefs.clientId || cfg.clientId || '', placeholder: '00000000-0000-0000-0000-000000000000', spellcheck: 'false', autocomplete: 'off' });
    const tenantId = h('input', { type: 'text', value: prefs.tenantId || cfg.tenantId || 'organizations', placeholder: 'organizations, contoso.onmicrosoft.com or a tenant ID', spellcheck: 'false', autocomplete: 'off' });

    function renderSignin() {
      clear(signinBox);
      if (valid()) {
        const who = session.account.name || session.account.username || 'your account';
        signinBox.appendChild(h('div', { class: 'azure-account' },
          h('span', { text: '\u2714 Signed in as ' }), h('strong', { text: who }),
          session.account.username && session.account.name ? h('span', { class: 'muted', text: ' (' + session.account.username + ')' }) : null,
          session.tenantId ? h('span', { class: 'muted', text: ' \u2022 tenant ' + session.tenantId }) : null,
          h('button', { type: 'button', class: 'btn small', text: 'Sign out', onclick: () => { session = null; tree = null; checked.clear(); renderAll(); } })));
        return;
      }
      signinBox.appendChild(h('p', { class: 'note', text: 'Sign in with your own Microsoft Entra app registration. Everything runs in this browser: the access token stays in memory, and resources are read directly from Azure Resource Manager with your own (read) permissions. Nothing is changed in Azure.' }));
      if (!redirectUri) {
        signinBox.appendChild(h('p', { class: 'note warn', text: 'Signing in requires the app to be served over http(s), e.g. http://localhost:8080 or your hosted instance. It does not work when index.html is opened from disk (file://).' }));
      }
      signinBox.appendChild(h('div', { class: 'grid-2' },
        field('Application (client) ID', clientId, { help: 'From your app registration in Microsoft Entra ID.' }),
        field('Tenant', tenantId, { help: '"organizations" signs in to your home tenant.' })));
      const redirect = h('input', { type: 'text', value: redirectUri || '(not available on file://)', readonly: true, spellcheck: 'false' });
      signinBox.appendChild(field('Redirect URI', redirect, { help: 'Add this URI to the app registration under Authentication \u203a Single-page application, and grant the delegated Azure Service Management permission "user_impersonation".' }));
      signinBox.appendChild(h('p', {}, h('button', { type: 'button', class: 'btn primary', text: 'Sign in with Microsoft', disabled: !redirectUri, onclick: signIn })));
    }

    function signIn() {
      if (busy) return;
      const id = clientId.value.trim();
      const tenant = tenantId.value.trim() || 'organizations';
      busy = true;
      setStatus('Waiting for sign-in in the popup window\u2026');
      // signIn opens the popup synchronously, inside this click.
      Auth.signIn({ clientId: id, tenantId: tenant, redirectUri })
        .then(async (s) => {
          session = Object.assign(s, { clientId: id });
          writePrefs({ clientId: id, tenantId: tenant });
          tree = null;
          checked.clear();
          busy = false;
          renderAll();
          await loadTree();
        })
        .catch((e) => {
          busy = false;
          setStatus(e.message, 'error');
        });
    }

    // ---- Step 2: selection tree
    const treeBox = h('div', { class: 'azure-tree-wrap' });
    const filter = h('input', { type: 'search', class: 'search', placeholder: 'Filter management groups, subscriptions and resource groups\u2026', 'aria-label': 'Filter' });
    filter.addEventListener('input', () => renderTree());
    const treeList = h('ul', { class: 'tree azure-tree', role: 'tree', 'aria-label': 'Azure scope' });
    const summary = h('p', { class: 'muted azure-summary' });
    const includeChildren = h('input', { type: 'checkbox', checked: true });
    const includeOther = h('input', { type: 'checkbox', checked: true });

    async function loadTree() {
      setStatus('Reading management groups and subscriptions\u2026');
      try {
        tree = await Arm.loadTree(client());
        setStatus(tree.subscriptions.length ? '' : 'No subscriptions found for this account in this tenant.', tree.subscriptions.length ? '' : 'error');
        tree.managementGroups.filter((m) => !m.parent).forEach((m) => expanded.add(KEY.mg(m.name)));
      } catch (e) {
        setStatus('Could not read the environment: ' + e.message, 'error');
        tree = null;
      }
      renderAll();
    }

    async function loadGroups(sub) {
      if (tree.resourceGroups[sub.subscriptionId]) return;
      try {
        tree.resourceGroups[sub.subscriptionId] = await Arm.listResourceGroups(client(), sub.subscriptionId);
      } catch (e) {
        tree.resourceGroups[sub.subscriptionId] = [];
        setStatus('Resource groups of "' + sub.displayName + '": ' + e.message, 'error');
      }
    }

    /** Whether a descendant of `key` is ticked (for the indeterminate state). */
    function descendantChecked(key) {
      for (const k of checked) if (k !== key && Azure.ancestorKeys(tree, k).indexOf(key) !== -1) return true;
      return false;
    }

    function row(key, type, label, detail, kids, opts) {
      const o = opts || {};
      const covered = Azure.isCovered(tree, checked, key);
      const isChecked = covered || checked.has(key);
      const box = h('input', {
        type: 'checkbox', checked: isChecked, disabled: covered, indeterminate: !isChecked && descendantChecked(key),
        'aria-label': 'Load ' + label,
        onchange: (e) => {
          if (e.target.checked) checked.add(key);
          else checked.delete(key);
          renderTree();
        }
      });
      const hasKids = o.expandable || (kids && kids.length);
      const isOpen = expanded.has(key) || !!o.forceOpen;
      const toggle = hasKids
        ? h('button', {
          type: 'button', class: 'azure-toggle', 'aria-label': (isOpen ? 'Collapse ' : 'Expand ') + label, 'aria-expanded': isOpen ? 'true' : 'false', text: isOpen ? '\u25be' : '\u25b8',
          onclick: async () => {
            if (expanded.has(key)) expanded.delete(key);
            else {
              expanded.add(key);
              if (o.onExpand) {
                toggle.disabled = true;
                await o.onExpand();
              }
            }
            renderTree();
          }
        })
        : h('span', { class: 'azure-toggle', 'aria-hidden': 'true' });
      return h('li', { role: 'treeitem', 'aria-expanded': hasKids ? (isOpen ? 'true' : 'false') : null },
        h('label', { class: 'tree-row' }, toggle, box, icon(app.store.project, type, 16), h('span', { class: 'name', text: label }), detail ? h('small', { class: 'muted', text: detail }) : null),
        hasKids && isOpen && kids && kids.length ? h('ul', { role: 'group' }, kids) : null);
    }

    function renderTree() {
      clear(treeList);
      if (!tree) return;
      const q = lower(filter.value.trim());
      const match = (...texts) => !q || texts.some((t) => lower(t).indexOf(q) !== -1);
      const subRow = (s) => {
        const groups = tree.resourceGroups[s.subscriptionId];
        const rgRows = (groups || []).filter((g) => match(g.name, s.displayName)).map((g) => row(KEY.rg(s.subscriptionId, g.name), 'resource-group', g.name, g.location || ''));
        const ok = match(s.displayName, s.subscriptionId) || rgRows.length;
        if (!ok) return null;
        return row(KEY.sub(s.subscriptionId), 'subscription', s.displayName, s.subscriptionId + (s.state && s.state !== 'Enabled' ? ' \u2022 ' + s.state : ''), rgRows, {
          expandable: true, onExpand: () => loadGroups(s)
        });
      };
      const mgRow = (m) => {
        const kids = tree.managementGroups.filter((c) => lower(c.parent) === lower(m.name)).map(mgRow)
          .concat(tree.subscriptions.filter((s) => lower(s.parent) === lower(m.name)).map(subRow)).filter(Boolean);
        if (!match(m.displayName, m.name) && !kids.length) return null;
        return row(KEY.mg(m.name), 'management-group', m.displayName, m.displayName !== m.name ? m.name : '', kids, { forceOpen: !!q });
      };
      const top = tree.managementGroups.filter((m) => !m.parent).map(mgRow)
        .concat(tree.subscriptions.filter((s) => !s.parent).map(subRow)).filter(Boolean);
      top.forEach((li) => treeList.appendChild(li));
      if (!top.length) treeList.appendChild(h('li', { class: 'muted', text: q ? 'Nothing matches the filter.' : 'Nothing to show.' }));
      const sel = Azure.resolveSelection(tree, checked);
      const rgCount = Object.keys(sel.resourceGroups).reduce((n, k) => n + (sel.resourceGroups[k] ? sel.resourceGroups[k].length : 0), 0);
      const full = Object.keys(sel.resourceGroups).filter((k) => !sel.resourceGroups[k]).length;
      summary.textContent = sel.subscriptions.length
        ? 'Selected: ' + sel.managementGroups.length + ' management group(s), ' + full + ' complete subscription(s)' + (rgCount ? ' and ' + rgCount + ' resource group(s) in ' + (sel.subscriptions.length - full) + ' other subscription(s)' : '') + '.'
        : 'Tick what to load: a management group includes everything below it, a subscription includes all of its resource groups.';
    }

    function renderAll() {
      renderSignin();
      clear(treeBox);
      if (!valid() || !tree) return;
      if (!tree.managementGroupsReadable) treeBox.appendChild(h('p', { class: 'note warn', text: 'The management group hierarchy could not be read with your permissions; subscriptions are shown without their management groups.' }));
      treeBox.appendChild(h('div', { class: 'azure-tree-tools' }, filter,
        h('button', { type: 'button', class: 'btn small', text: 'Clear selection', onclick: () => { checked.clear(); renderTree(); } })));
      treeBox.appendChild(h('div', { class: 'azure-tree-scroll' }, treeList));
      treeBox.appendChild(summary);
      treeBox.appendChild(h('div', { class: 'grid-2' },
        field('Include child resources', includeChildren, { check: true, help: 'Workflows, functions, queues, topics, subscriptions, event hubs, APIs, blob containers, ... (one extra request per resource).' }),
        field('Include other resource types', includeOther, { check: true, help: 'Resources without a dedicated type are drawn as "Other Azure Resource".' })));
      renderTree();
    }

    async function load(close) {
      if (busy) return false;
      if (!valid()) {
        setStatus(session ? 'Your session expired. Please sign in again.' : 'Sign in first.', 'error');
        session = null;
        renderAll();
        return false;
      }
      if (!tree) return false;
      const selection = Azure.resolveSelection(tree, checked);
      if (!selection.subscriptions.length && !selection.managementGroups.length) {
        setStatus('Select at least one management group, subscription or resource group.', 'error');
        return false;
      }
      busy = true;
      try {
        const inventory = await Arm.loadInventory(client(), tree, selection, { includeChildren: includeChildren.checked, onProgress: (t) => setStatus(t) });
        setStatus('Drawing ' + inventory.resources.length + ' resources\u2026');
        await new Promise((r) => setTimeout(r, 0));
        if (closed) return undefined;
        const topGroups = inventory.managementGroups.filter((m) => !inventory.managementGroups.some((p) => lower(p.name) === lower(m.parent)));
        const names = topGroups.length === 1 ? [topGroups[0].displayName]
          : inventory.subscriptions.length === 1 ? [inventory.subscriptions[0].displayName] : [];
        const when = new Date().toLocaleString();
        const result = Azure.buildProject(inventory, {
          name: 'Azure environment' + (names.length ? ' \u2013 ' + names[0] : ''),
          description: 'Loaded from Azure on ' + when + (session.tenantId ? ' (tenant ' + session.tenantId + ')' : '') + ' by ' + (session.account.username || session.account.name || 'the signed-in user') + '.',
          settings: AISBP.Model.sanitizeSettings(app.config.defaults || {}),
          includeOther: includeOther.checked
        });
        const warnings = inventory.warnings.concat(result.warnings);
        if (closed) return undefined;
        await app.actions.openAzureProject(result.project, result.stats, warnings);
        busy = false;
        close();
        return undefined;
      } catch (e) {
        busy = false;
        setStatus('Loading failed: ' + e.message, 'error');
        return false;
      }
    }

    const body = h('div', { class: 'azure-load' }, signinBox, treeBox, status);
    modal({
      title: 'Load your Azure environment',
      body,
      buttons: [
        { label: 'Cancel', action: () => (busy ? false : undefined) },
        { label: 'Load into diagram', primary: true, action: load }
      ],
      onClose: () => { closed = true; }
    });
    renderAll();
    if (valid() && !tree) loadTree();
    else if (!valid() && session) {
      session = null;
      renderAll();
      setStatus('Your session expired. Please sign in again.');
    }
  }

  AISBP.AzureUi = { open, isSignedIn: valid };
})(typeof globalThis !== 'undefined' ? globalThis : this);
