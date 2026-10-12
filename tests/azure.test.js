'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AISBP } = require('./helpers');

const { Azure, AzureArm, AzureAuth, Model, Catalog } = AISBP;
const { KEY } = Azure;

const SUB = '11111111-1111-1111-1111-111111111111';
const SUB2 = '22222222-2222-2222-2222-222222222222';
const RG = '/subscriptions/' + SUB + '/resourceGroups/rg-int';

const tree = () => ({
  managementGroups: [
    { name: 'root', displayName: 'Tenant Root Group', parent: null },
    { name: 'platform', displayName: 'Platform', parent: 'root' },
    { name: 'landingzones', displayName: 'Landing zones', parent: 'root' }
  ],
  subscriptions: [
    { subscriptionId: SUB, displayName: 'Integration', parent: 'landingzones' },
    { subscriptionId: SUB2, displayName: 'Connectivity', parent: 'platform' }
  ],
  resourceGroups: {}
});

const byName = (project, name) => Object.values(project.nodes).find((n) => n.name === name);
const conns = (project) => Object.values(project.connections);

test('Azure resource types map to catalog types (including kinds)', () => {
  assert.equal(Azure.mapType({ type: 'Microsoft.Logic/workflows' }), 'logic-app-consumption');
  assert.equal(Azure.mapType({ type: 'Microsoft.Automation/automationAccounts' }), 'automation-account');
  assert.equal(Azure.mapType({ type: 'Microsoft.Automation/automationAccounts/runbooks' }), 'automation-runbook');
  assert.equal(Azure.mapType({ type: 'Microsoft.Web/sites', kind: 'functionapp,linux' }), 'function-app');
  assert.equal(Azure.mapType({ type: 'Microsoft.Web/sites', kind: 'functionapp,workflowapp' }), 'logic-app-standard');
  assert.equal(Azure.mapType({ type: 'Microsoft.Web/sites', kind: 'app' }), 'app-service');
  assert.equal(Azure.mapType({ type: 'Microsoft.CognitiveServices/accounts', kind: 'OpenAI' }), 'azure-openai');
  assert.equal(Azure.mapType({ type: 'Microsoft.Contoso/widgets' }), null);
  assert.ok(Azure.isSupporting({ type: 'Microsoft.Network/networkInterfaces' }));
  assert.ok(!Azure.isSkipped({ type: 'Microsoft.Network/networkInterfaces' }));
  assert.ok(Azure.isSkipped({ type: 'Microsoft.Sql/servers/databases', name: 'sql1/master' }));
  Object.keys(Azure.TYPE_MAP).forEach((k) => assert.ok(Catalog.get(Azure.TYPE_MAP[k]), 'unknown catalog type for ' + k));
  Object.keys(Azure.CHILD_SPECS).forEach((k) => {
    assert.ok(Catalog.get(k), k);
    const walk = (specs) => specs.forEach((s) => { if (s.type) assert.ok(Catalog.get(s.type), s.type); walk(s.children || []); });
    walk(Azure.CHILD_SPECS[k]);
  });
});

test('the generic "Other Azure Resource" type exists and fits in a resource group', () => {
  const def = Catalog.get('azure-resource');
  assert.ok(def && def.rule);
  const p = Model.createProject();
  const sub = Model.addNode(p, 'subscription', null, {});
  const rg = Model.addNode(p, 'resource-group', sub.id, {});
  assert.ok(Model.addNode(p, 'azure-resource', rg.id, { nameMode: 'custom', name: 'x' }));
});

test('selection: management groups include everything below them, resource groups can be picked', () => {
  const t = tree();
  assert.deepEqual(Azure.ancestorKeys(t, KEY.rg(SUB, 'rg-int')), [KEY.sub(SUB), KEY.mg('landingzones'), KEY.mg('root')]);
  assert.ok(Azure.isCovered(t, new Set([KEY.mg('root')]), KEY.sub(SUB)));
  assert.ok(!Azure.isCovered(t, new Set([KEY.mg('platform')]), KEY.sub(SUB)));

  let sel = Azure.resolveSelection(t, [KEY.mg('landingzones')]);
  assert.deepEqual(sel.subscriptions, [SUB]);
  assert.equal(sel.resourceGroups[SUB], null);
  assert.deepEqual(sel.managementGroups, ['landingzones']);

  sel = Azure.resolveSelection(t, [KEY.rg(SUB, 'rg-int'), KEY.rg(SUB, 'rg-net')]);
  assert.deepEqual(sel.subscriptions, [SUB]);
  assert.deepEqual(sel.resourceGroups[SUB].sort(), ['rg-int', 'rg-net']);
  // The management group chain is drawn, but not the tenant root group.
  assert.deepEqual(sel.managementGroups, ['landingzones']);

  sel = Azure.resolveSelection(t, [KEY.mg('root')]);
  assert.deepEqual(sel.subscriptions.sort(), [SUB, SUB2].sort());
  assert.deepEqual(sel.managementGroups.sort(), ['landingzones', 'platform', 'root']);
  assert.deepEqual(Azure.resolveSelection(t, []).subscriptions, []);
});

function inventory() {
  const vnet = RG + '/providers/Microsoft.Network/virtualNetworks/vnet-int';
  const site = RG + '/providers/Microsoft.Web/sites/la-orders';
  const automation = RG + '/providers/Microsoft.Automation/automationAccounts/aa-int';
  const sb = RG + '/providers/Microsoft.ServiceBus/namespaces/sb-int';
  return {
    managementGroups: [{ name: 'landingzones', displayName: 'Landing zones', parent: 'root' }],
    subscriptions: [{ subscriptionId: SUB, displayName: 'Integration', parent: 'landingzones', state: 'Enabled' }],
    resourceGroups: [{ id: RG, name: 'rg-int', location: 'westeurope', subscriptionId: SUB, tags: { env: 'prd' } }],
    resources: [
      { id: vnet, name: 'vnet-int', type: 'Microsoft.Network/virtualNetworks', location: 'westeurope', properties: { addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [{ id: vnet + '/subnets/snet-apps', name: 'snet-apps', properties: { addressPrefix: '10.0.1.0/24' } }, { id: vnet + '/subnets/snet-pe', name: 'snet-pe', properties: { addressPrefix: '10.0.2.0/24' } }] } },
      { id: RG + '/providers/Microsoft.Web/serverfarms/asp-int', name: 'asp-int', type: 'Microsoft.Web/serverfarms', location: 'westeurope', sku: { name: 'WS1' } },
      { id: site, name: 'la-orders', type: 'Microsoft.Web/sites', kind: 'functionapp,workflowapp', location: 'westeurope', tags: { owner: 'team' }, properties: { serverFarmId: RG + '/providers/Microsoft.Web/serverfarms/asp-int', virtualNetworkSubnetId: vnet + '/subnets/snet-apps', defaultHostName: 'la-orders.azurewebsites.net' } },
      { id: automation, name: 'aa-int', type: 'Microsoft.Automation/automationAccounts', location: 'westeurope', sku: { name: 'Basic' }, properties: { publicNetworkAccess: 'Disabled' } },
      { id: sb, name: 'sb-int', type: 'Microsoft.ServiceBus/namespaces', location: 'westeurope', sku: { name: 'Premium' } },
      { id: RG + '/providers/Microsoft.Network/privateEndpoints/pe-sb', name: 'pe-sb', type: 'Microsoft.Network/privateEndpoints', location: 'westeurope', properties: { subnet: { id: vnet + '/subnets/snet-pe' }, privateLinkServiceConnections: [{ properties: { privateLinkServiceId: sb, groupIds: ['namespace'] } }] } },
      { id: RG + '/providers/Microsoft.Network/networkInterfaces/pe-sb.nic', name: 'pe-sb.nic', type: 'Microsoft.Network/networkInterfaces' },
      { id: RG + '/providers/Microsoft.Contoso/widgets/w1', name: 'w1', type: 'Microsoft.Contoso/widgets', location: 'westeurope' },
      // Children as read by AzureArm.loadInventory.
      { id: site + '/workflows/wf-receive', name: 'la-orders/wf-receive', type: 'Microsoft.Web/sites/workflows', _catalogType: 'logic-app-workflow', _parent: site },
      { id: automation + '/runbooks/rb-cleanup', name: 'aa-int/rb-cleanup', type: 'Microsoft.Automation/automationAccounts/runbooks', _catalogType: 'automation-runbook', _parent: automation, properties: { runbookType: 'PowerShell', state: 'Published' } },
      { id: sb + '/queues/orders', name: 'orders', type: 'Microsoft.ServiceBus/namespaces/queues', _catalogType: 'service-bus-queue', _parent: sb, properties: { forwardTo: 'archive' } },
      { id: sb + '/queues/archive', name: 'archive', type: 'Microsoft.ServiceBus/namespaces/queues', _catalogType: 'service-bus-queue', _parent: sb }
    ],
    extras: {}
  };
}

test('buildProject draws the hierarchy, resources, children, network and connections', () => {
  const { project, stats, warnings } = Azure.buildProject(inventory(), { name: 'Env' });
  assert.deepEqual(warnings, []);
  assert.equal(project.meta.name, 'Env');
  const mg = byName(project, 'landingzones');
  const sub = byName(project, 'Integration');
  const rg = byName(project, 'rg-int');
  assert.equal(mg.type, 'management-group');
  assert.equal(sub.parentId, mg.id);
  assert.equal(rg.parentId, sub.id);
  assert.deepEqual(rg.tags, [{ key: 'env', value: 'prd' }]);

  const la = byName(project, 'la-orders');
  assert.equal(la.type, 'logic-app-standard');
  assert.equal(la.parentId, rg.id);
  assert.equal(la.nameMode, 'custom');
  assert.ok(la.custom.some((c) => c.key === 'Resource ID' && /la-orders$/.test(c.value)));
  const wf = byName(project, 'wf-receive');
  assert.equal(wf.type, 'logic-app-workflow');
  assert.equal(wf.parentId, la.id);
  const aa = byName(project, 'aa-int');
  assert.equal(aa.type, 'automation-account');
  assert.equal(aa.attributes.sku, 'Basic');
  assert.equal(aa.attributes.publicNetworkAccess, 'Disabled');
  const runbook = byName(project, 'rb-cleanup');
  assert.equal(runbook.type, 'automation-runbook');
  assert.equal(runbook.parentId, aa.id);
  assert.equal(runbook.attributes.runbookType, 'PowerShell');
  assert.equal(runbook.attributes.state, 'Published');

  const vnet = byName(project, 'vnet-int');
  const snetApps = byName(project, 'snet-apps');
  assert.equal(snetApps.type, 'subnet');
  assert.equal(snetApps.parentId, vnet.id);
  // VNet integration of the Logic App.
  const asp = byName(project, 'asp-int');
  const all = conns(project);
  const linked = (a, b) => all.some((c) => (c.from === a.id && c.to === b.id) || (c.from === b.id && c.to === a.id));
  assert.ok(la.network.indexOf(snetApps.id) !== -1 || linked(la, snetApps), 'logic app attached to subnet');
  assert.ok(linked(la, asp), 'hosted on plan');
  const pe = byName(project, 'pe-sb');
  const sb = byName(project, 'sb-int');
  assert.ok(linked(pe, sb), 'private endpoint to namespace');
  assert.ok(linked(byName(project, 'orders'), byName(project, 'archive')), 'forwardTo');

  // Supporting resources (NICs) and unknown types are drawn as generic resources: nothing is lost.
  assert.equal(byName(project, 'pe-sb.nic').type, 'azure-resource');
  const w = byName(project, 'w1');
  assert.equal(w.type, 'azure-resource');
  assert.equal(stats.generic, 2);
  assert.equal(stats.resources, 12);
  assert.equal(stats.drawn, 12);
  assert.deepEqual(stats.skipped, {});
  assert.equal(stats.connections, all.length);

  // Everything is laid out and valid.
  Object.values(project.nodes).forEach((n) => assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), n.name));
  assert.deepEqual(Model.normalize(JSON.parse(JSON.stringify(project))).warnings, []);
});

test('buildProject can leave out resource types without a dedicated catalog type', () => {
  const { project, stats, warnings } = Azure.buildProject(inventory(), { includeOther: false, includeSupporting: false });
  assert.equal(byName(project, 'w1'), undefined);
  assert.equal(byName(project, 'pe-sb.nic'), undefined);
  assert.equal(stats.generic, 0);
  assert.equal(stats.drawn, stats.resources - 2);
  assert.equal(stats.skipped['other|microsoft.contoso/widgets'], 1);
  assert.equal(stats.skipped['supporting|microsoft.network/networkinterfaces'], 1);
  // Every left-out type is explained.
  assert.ok(warnings.some((w) => /Left out 1 .*microsoft\.contoso\/widgets/.test(w)));
  assert.ok(warnings.some((w) => /Left out 1 .*microsoft\.network\/networkinterfaces.*supporting/.test(w)));
  // The options are independent: supporting resources are drawn while other types are left out.
  const only = Azure.buildProject(inventory(), { includeOther: false });
  assert.equal(byName(only.project, 'pe-sb.nic').type, 'azure-resource');
  assert.equal(byName(only.project, 'w1'), undefined);
});

test('buildProject draws supporting resources and reports hidden or orphaned ones', () => {
  const inv = inventory();
  const sql = RG + '/providers/Microsoft.Sql/servers/sql1';
  inv.resources.push(
    { id: sql, name: 'sql1', type: 'Microsoft.Sql/servers' },
    { id: sql + '/databases/master', name: 'sql1/master', type: 'Microsoft.Sql/servers/databases', _parent: sql },
    { id: RG + '/providers/Microsoft.Network/networkWatchers/nw', name: 'nw', type: 'Microsoft.Network/networkWatchers' },
    { id: RG + '/providers/Microsoft.Web/sites/la-orders/slots/staging', name: 'la-orders/staging', type: 'Microsoft.Web/sites/slots' },
    { id: '/subscriptions/' + SUB + '/resourceGroups/rg-gone/providers/Microsoft.Logic/workflows/x', name: 'x', type: 'Microsoft.Logic/workflows' }
  );
  const { project, stats, warnings } = Azure.buildProject(inv, {});
  assert.equal(byName(project, 'nw').type, 'azure-resource');
  assert.equal(byName(project, 'staging').parentId, byName(project, 'rg-int').id);
  assert.equal(byName(project, 'master'), undefined);
  assert.equal(stats.skipped['hidden|microsoft.sql/servers/databases'], 1);
  assert.equal(stats.skipped['noGroup|microsoft.logic/workflows'], 1);
  assert.equal(stats.drawn, stats.resources - 2);
  assert.ok(warnings.some((w) => /resource group was not loaded/.test(w)));
});

test('buildProject handles large environments', () => {
  const inv = { managementGroups: [], subscriptions: [{ subscriptionId: SUB, displayName: 'Big' }], resourceGroups: [], resources: [] };
  for (let g = 0; g < 20; g++) {
    const rg = '/subscriptions/' + SUB + '/resourceGroups/rg-' + g;
    inv.resourceGroups.push({ id: rg, name: 'rg-' + g, subscriptionId: SUB });
    for (let i = 0; i < 25; i++) inv.resources.push({ id: rg + '/providers/Microsoft.Logic/workflows/la-' + g + '-' + i, name: 'la-' + g + '-' + i, type: 'Microsoft.Logic/workflows' });
  }
  const start = Date.now();
  const { project } = Azure.buildProject(inv, {});
  assert.equal(Object.keys(project.nodes).length, 1 + 20 + 500);
  assert.ok(Date.now() - start < 20000, 'took ' + (Date.now() - start) + ' ms');
});

/** Fake fetch answering from a route table: [method, url-substring, handler(body) -> {status, json, headers}]. */
function fakeFetch(routes, log) {
  return async (url, init) => {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    log.push({ method, url, auth: init.headers.Authorization, body });
    const route = routes.find((r) => r[0] === method && url.indexOf(r[1]) !== -1);
    const res = route ? route[2](body, url) : { status: 404, json: { error: { code: 'NotFound', message: 'not found' } } };
    return {
      status: res.status || 200,
      ok: (res.status || 200) < 400,
      headers: { get: (k) => (res.headers || {})[k] || null },
      text: async () => JSON.stringify(res.json || {})
    };
  };
}

test('ARM client follows nextLink, retries throttling and only calls Resource Manager', async () => {
  const log = [];
  let throttled = false;
  const fetch = fakeFetch([
    ['GET', '/subscriptions?api-version', () => {
      if (!throttled) { throttled = true; return { status: 429, headers: { 'Retry-After': '1' } }; }
      return { json: { value: [{ subscriptionId: SUB, displayName: 'A' }], nextLink: 'https://management.azure.com/subscriptions?api-version=2022-12-01&$skiptoken=2' } };
    }],
    ['GET', '$skiptoken=2', () => ({ json: { value: [{ subscriptionId: SUB2, displayName: 'B' }] } })]
  ].reverse(), log);
  const sleeps = [];
  const client = AzureArm.createClient({ getToken: () => 'tok', fetch, sleep: async (ms) => { sleeps.push(ms); } });
  const subs = await AzureArm.listSubscriptions(client);
  assert.deepEqual(subs.map((s) => s.displayName), ['A', 'B']);
  assert.deepEqual(sleeps, [1000]);
  assert.ok(log.every((l) => l.auth === 'Bearer ' + 'tok' && l.url.indexOf('https://management.azure.com/') === 0));
  await assert.rejects(client.request('GET', 'https://evil.example.com/steal'), /outside Azure Resource Manager/);
  await assert.rejects(client.request('GET', 'https://management.azure.com.evil.example.com/x'), /outside Azure Resource Manager/);
  const noToken = AzureArm.createClient({ getToken: () => '', fetch });
  await assert.rejects(noToken.request('GET', '/subscriptions'), /Not signed in/);
  await assert.rejects(client.request('GET', '/nope'), (e) => e.status === 404 && /not found/.test(e.message));
});

test('loadTree reads management groups; without permission subscriptions are shown flat', async () => {
  const log = [];
  const routes = [
    ['POST', 'getEntities', () => ({ json: { value: [
      { name: 'root', type: 'Microsoft.Management/managementGroups', properties: { displayName: 'Root' } },
      { name: 'lz', type: 'Microsoft.Management/managementGroups', properties: { displayName: 'LZ', parent: { id: '/providers/Microsoft.Management/managementGroups/root' } } },
      { name: SUB, type: '/subscriptions', properties: { parent: { id: '/providers/Microsoft.Management/managementGroups/lz' } } }
    ] } })],
    ['GET', '/subscriptions?api-version', () => ({ json: { value: [{ subscriptionId: SUB, displayName: 'A' }] } })]
  ];
  let t = await AzureArm.loadTree(AzureArm.createClient({ getToken: () => 't', fetch: fakeFetch(routes, log) }));
  assert.ok(t.managementGroupsReadable);
  assert.equal(t.subscriptions[0].parent, 'lz');
  assert.equal(t.managementGroups.find((m) => m.name === 'lz').parent, 'root');
  t = await AzureArm.loadTree(AzureArm.createClient({ getToken: () => 't', fetch: fakeFetch(routes.slice(1), log), maxRetries: 0 }));
  assert.ok(!t.managementGroupsReadable);
  assert.equal(t.subscriptions[0].parent, null);
});

test('loadInventory reads resource groups, resources (Resource Graph) and child resources', async () => {
  const log = [];
  const site = RG + '/providers/Microsoft.Web/sites/la-orders';
  const automation = RG + '/providers/Microsoft.Automation/automationAccounts/aa-int';
  const routes = [
    ['GET', '/resourcegroups?api-version', () => ({ json: { value: [{ id: RG, name: 'rg-int', location: 'westeurope' }, { id: '/subscriptions/' + SUB + '/resourceGroups/rg-other', name: 'rg-other' }] } })],
    ['POST', 'Microsoft.ResourceGraph/resources', (body) => {
      assert.deepEqual(body.subscriptions, [SUB]);
      assert.match(body.query, /resourceGroup in~ \('rg-int'\)/);
      return { json: { data: [
        { id: site, name: 'la-orders', type: 'Microsoft.Web/sites', kind: 'functionapp,workflowapp', resourceGroup: 'rg-int', subscriptionId: SUB, properties: {} },
        { id: automation, name: 'aa-int', type: 'Microsoft.Automation/automationAccounts', resourceGroup: 'rg-int', subscriptionId: SUB, properties: {} }
      ] } };
    }],
    ['GET', site + '/workflows?', () => ({ json: { value: [{ id: site + '/workflows/wf1', name: 'la-orders/wf1', type: 'Microsoft.Web/sites/workflows' }] } })],
    ['GET', automation + '/runbooks?', () => ({ json: { value: [{ id: automation + '/runbooks/rb1', name: 'aa-int/rb1', type: 'Microsoft.Automation/automationAccounts/runbooks', properties: { runbookType: 'PowerShell' } }] } })],
    // Same resource as Resource Graph, with another id casing.
    ['GET', '/resourceGroups/rg-int/resources?', () => ({ json: { value: [
      { id: site.toLowerCase(), name: 'la-orders', type: 'Microsoft.Web/sites' },
      { id: automation.toLowerCase(), name: 'aa-int', type: 'Microsoft.Automation/automationAccounts' }
    ] } })]
  ];
  const client = AzureArm.createClient({ getToken: () => 't', fetch: fakeFetch(routes, log) });
  const t = tree();
  const selection = Azure.resolveSelection(t, [KEY.rg(SUB, 'rg-int')]);
  const progress = [];
  const inv = await AzureArm.loadInventory(client, t, selection, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(inv.resourceGroups.map((g) => g.name), ['rg-int']);
  assert.deepEqual(inv.resources.map((r) => r.name), ['la-orders', 'aa-int', 'la-orders/wf1', 'aa-int/rb1']);
  assert.equal(inv.resources[2]._catalogType, 'logic-app-workflow');
  assert.equal(inv.resources[3]._catalogType, 'automation-runbook');
  assert.deepEqual(inv.warnings, []);
  assert.ok(progress.length > 0);
  const { project } = Azure.buildProject(inv, {});
  assert.equal(byName(project, 'wf1').parentId, byName(project, 'la-orders').id);
  assert.equal(byName(project, 'rb1').parentId, byName(project, 'aa-int').id);
  assert.ok(log.some((l) => l.url.indexOf(automation + '/runbooks?api-version=2023-11-01') !== -1));
});

test('loadInventory falls back to the resources API when Resource Graph fails', async () => {
  const log = [];
  const routes = [
    ['GET', '/resourcegroups?api-version', () => ({ json: { value: [{ id: RG, name: 'rg-int' }] } })],
    ['POST', 'Microsoft.ResourceGraph/resources', () => ({ status: 403, json: { error: { code: 'AuthorizationFailed', message: 'denied' } } })],
    ['GET', '/resourceGroups/rg-int/resources?', () => ({ json: { value: [{ id: RG + '/providers/Microsoft.Logic/workflows/la1', name: 'la1', type: 'Microsoft.Logic/workflows' }] } })]
  ];
  const client = AzureArm.createClient({ getToken: () => 't', fetch: fakeFetch(routes, log) });
  const t = tree();
  const inv = await AzureArm.loadInventory(client, t, Azure.resolveSelection(t, [KEY.sub(SUB)]), {});
  assert.deepEqual(inv.resources.map((r) => r.name), ['la1']);
  assert.equal(inv.warnings.length, 1);
  assert.match(inv.warnings[0], /Resource Graph/);
});

test('loadInventory adds resources missing from Resource Graph and reports unreadable child lists', async () => {
  const log = [];
  const site = RG + '/providers/Microsoft.Web/sites/la-orders';
  const sb = RG + '/providers/Microsoft.ServiceBus/namespaces/sb-int';
  const routes = [
    ['GET', '/resourcegroups?api-version', () => ({ json: { value: [{ id: RG, name: 'rg-int' }] } })],
    ['POST', 'Microsoft.ResourceGraph/resources', () => ({ json: { data: [{ id: site, name: 'la-orders', type: 'Microsoft.Web/sites', kind: 'functionapp,workflowapp', properties: {} }] } })],
    ['GET', '/resourceGroups/rg-int/resources?', () => ({ json: {
      value: [{ id: site, name: 'la-orders', type: 'Microsoft.Web/sites' }],
      // nextLinks may carry the default port and another host casing.
      nextLink: 'https://Management.Azure.com:443/subscriptions/' + SUB + '/resourceGroups/rg-int/resources?api-version=2021-04-01&$skiptoken=p2'
    } })],
    ['GET', '$skiptoken=p2', () => ({ json: { value: [{ id: sb, name: 'sb-int', type: 'Microsoft.ServiceBus/namespaces' }] } })],
    ['GET', site + '/workflows?', () => ({ status: 403, json: { error: { code: 'AuthorizationFailed', message: 'denied' } } })]
  ].reverse();
  const client = AzureArm.createClient({ getToken: () => 't', fetch: fakeFetch(routes, log), maxRetries: 0 });
  const t = tree();
  const inv = await AzureArm.loadInventory(client, t, Azure.resolveSelection(t, [KEY.sub(SUB)]), {});
  assert.deepEqual(inv.resources.filter((r) => !r._parent).map((r) => r.name), ['la-orders', 'sb-int']);
  assert.ok(inv.warnings.some((w) => /^1 resource\(s\) were not \(yet\) in Azure Resource Graph/.test(w)));
  assert.ok(inv.warnings.some((w) => /could not be read .*la-orders\/workflows/.test(w)));
  // Queues/topics of the namespace are not offered by this fake: reported as unavailable, not silently ignored.
  assert.ok(inv.warnings.some((w) => /not available .*sb-int\/queues/.test(w)));
  assert.ok(log.some((l) => l.url.indexOf('$skiptoken=p2') !== -1));
});

test('Resource Graph string literals are escaped', () => {
  assert.equal(AzureArm.kql("rg'x"), "'rg\\'x'");
  assert.equal(AzureArm.kql('a\\b'), "'a\\\\b'");
});

test('sign-in helpers build a PKCE authorization request and parse the response', async () => {
  const url = new URL(AzureAuth.authorizeUrl({ clientId: '00000000-0000-0000-0000-0000000000aa', tenantId: 'contoso.onmicrosoft.com', redirectUri: 'https://app.example/azure-callback.html', state: 's1', nonce: 'n1', challenge: 'c1' }));
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /https:\/\/management\.azure\.com\/user_impersonation/);
  assert.throws(() => AzureAuth.authorizeUrl({ clientId: 'nope', redirectUri: 'x' }), /client\) ID/);
  assert.throws(() => AzureAuth.authorizeUrl({ clientId: '00000000-0000-0000-0000-0000000000aa', tenantId: 'a/b', redirectUri: 'x' }), /tenant/);
  // RFC 7636 appendix B test vector.
  assert.equal(await AzureAuth.codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.deepEqual(AzureAuth.parseCallback('', '#code=abc&state=s1'), { code: 'abc', state: 's1' });
  assert.equal(AzureAuth.defaultRedirectUri({ protocol: 'file:', href: 'file:///c/index.html' }), '');
  assert.equal(AzureAuth.defaultRedirectUri({ protocol: 'https:', href: 'https://x.example/app/index.html?a=1#b' }), 'https://x.example/app/azure-callback.html');
  assert.ok(AzureAuth.randomString(32).length >= 43);
});

test('sign-in waits for the callback (also when the popup looks closed), exchanges the code and can be cancelled', async () => {
  const g = globalThis;
  const saved = { open: g.open, fetch: g.fetch, addEventListener: g.addEventListener, removeEventListener: g.removeEventListener };
  const popups = [];
  g.open = () => {
    // A detached popup (Cross-Origin-Opener-Policy) reports closed: true while still signing in.
    const popup = { closed: true, location: { href: 'about:blank' }, close() {} };
    popups.push(popup);
    return popup;
  };
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  const token = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.s';
  const requests = [];
  g.fetch = async (url, init) => {
    requests.push({ url, body: new URLSearchParams(init.body) });
    return { ok: true, status: 200, json: async () => ({ access_token: 'at', expires_in: 3600, id_token: token({ name: 'Ada', preferred_username: 'ada@contoso.com', tid: 'tid-1' }) }) };
  };
  try {
    const redirectUri = 'https://app.example/azure-callback.html';
    const pending = AzureAuth.signIn({ clientId: '00000000-0000-0000-0000-0000000000aa', tenantId: 'contoso.onmicrosoft.com', redirectUri });
    while (popups[0].location.href === 'about:blank') await new Promise((r) => setTimeout(r, 10));
    const sent = new URL(popups[0].location.href);
    await new Promise((r) => setTimeout(r, 1200)); // several polls with popup.closed === true
    const channel = new BroadcastChannel(AzureAuth.CHANNEL);
    channel.postMessage({ type: AzureAuth.CHANNEL, search: '', hash: '#code=the-code&state=' + sent.searchParams.get('state') });
    channel.close();
    const session = await pending;
    assert.equal(session.accessToken, 'at');
    assert.equal(session.account.username, 'ada@contoso.com');
    assert.equal(session.tenantId, 'tid-1');
    assert.equal(requests[0].url, 'https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token');
    assert.equal(requests[0].body.get('code'), 'the-code');
    assert.equal(await AzureAuth.codeChallenge(requests[0].body.get('code_verifier')), sent.searchParams.get('code_challenge'));
    assert.equal(requests[0].body.get('client_secret'), null);

    // A response with another state is ignored; cancelling stops waiting.
    const controller = new AbortController();
    const cancelled = AzureAuth.signIn({ clientId: '00000000-0000-0000-0000-0000000000aa', redirectUri, signal: controller.signal });
    while (popups[1].location.href === 'about:blank') await new Promise((r) => setTimeout(r, 10));
    const c2 = new BroadcastChannel(AzureAuth.CHANNEL);
    c2.postMessage({ type: AzureAuth.CHANNEL, search: '', hash: '#code=x&state=forged' });
    c2.close();
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await assert.rejects(cancelled, /cancelled/);
    assert.equal(requests.length, 1);
  } finally {
    Object.assign(g, saved);
  }
});
