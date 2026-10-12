/**
 * AIS BluePrinter - Azure environment mapping.
 *
 * Pure functions (no DOM, no network) that turn an inventory read from Azure Resource Manager
 * into a blueprint:
 *  - `resolveSelection` turns the management groups, subscriptions and resource groups ticked
 *    in the "Load from Azure" dialog into the scope to load,
 *  - `mapType` maps an ARM resource type (and kind) to a catalog type,
 *  - `CHILD_SPECS` describes the child resources (workflows, queues, APIs, ...) that are read
 *    per resource by AISBP.AzureArm,
 *  - `buildProject` creates the nodes (with attributes, tags and resource ids), the network
 *    attachments and the connections derived from resource properties, and lays them out.
 *
 * Inventory shape (see AISBP.AzureArm.loadInventory):
 * { managementGroups: [{ name, displayName, parent }], subscriptions: [{ subscriptionId, displayName, parent, state }],
 *   resourceGroups: [{ id, name, location, subscriptionId, tags }],
 *   resources: [{ id, name, type, kind, location, sku, tags, identity, properties, _catalogType?, _parent? }],
 *   extras: { [lowercase resource id]: { [key]: [items] } } }
 *
 * @module AISBP.Azure
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});
  const Catalog = AISBP.Catalog || (typeof require === 'function' ? require('./catalog.js') : null);
  const Model = AISBP.Model || (typeof require === 'function' ? require('./model.js') : null);
  const Layout = AISBP.Layout || (typeof require === 'function' ? require('./layout.js') : null);

  const lower = (s) => String(s === undefined || s === null ? '' : s).toLowerCase();
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  /** Last segment of an ARM id or a "parent/child" name. */
  const leaf = (s) => String(s || '').split('/').filter(Boolean).pop() || '';
  /** Remove the last `n` segments of an ARM id. */
  const strip = (id, n) => String(id || '').split('/').slice(0, -n).join('/');

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  /** Keys used for the checkboxes of the selection tree. */
  const KEY = {
    mg: (name) => 'mg:' + lower(name),
    sub: (id) => 'sub:' + lower(id),
    rg: (subId, name) => 'rg:' + lower(subId) + '/' + lower(name)
  };

  const indexCache = new WeakMap();
  function indexTree(tree) {
    // Cached per tree object and its management group / subscription arrays (the dialog asks
    // for every row on every render); resource groups are not part of the index.
    const cached = tree && typeof tree === 'object' ? indexCache.get(tree) : null;
    if (cached && cached.m === tree.managementGroups && cached.s === tree.subscriptions) return cached.idx;
    const idx = buildIndex(tree);
    if (tree && typeof tree === 'object') indexCache.set(tree, { m: tree.managementGroups, s: tree.subscriptions, idx });
    return idx;
  }

  function buildIndex(tree) {
    const mgs = new Map();
    arr(tree && tree.managementGroups).forEach((m) => mgs.set(lower(m.name), m));
    const subs = new Map();
    arr(tree && tree.subscriptions).forEach((s) => subs.set(lower(s.subscriptionId), s));
    return { mgs, subs };
  }

  /** Management group chain above a parent name, nearest first (cycle safe). */
  function mgChain(idx, parentName) {
    const out = [];
    const seen = new Set();
    let cur = parentName ? lower(parentName) : '';
    while (cur && idx.mgs.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = idx.mgs.get(cur).parent ? lower(idx.mgs.get(cur).parent) : '';
    }
    return out;
  }

  /**
   * Keys of all ancestors of a selection key (nearest first), e.g. a resource group's
   * subscription and that subscription's management groups.
   */
  function ancestorKeys(tree, key) {
    const idx = indexTree(tree);
    const [kind, rest] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (kind === 'rg') {
      const subId = rest.split('/')[0];
      const sub = idx.subs.get(subId);
      return [KEY.sub(subId)].concat(mgChain(idx, sub && sub.parent).map(KEY.mg));
    }
    if (kind === 'sub') {
      const sub = idx.subs.get(rest);
      return mgChain(idx, sub && sub.parent).map(KEY.mg);
    }
    const mg = idx.mgs.get(rest);
    return mgChain(idx, mg && mg.parent).map(KEY.mg);
  }

  /** Whether a key is selected implicitly because one of its ancestors is ticked. */
  function isCovered(tree, checked, key) {
    return ancestorKeys(tree, key).some((k) => checked.has(k));
  }

  /**
   * Resolve the ticked keys into the scope to load.
   * - A management group includes all management groups and subscriptions below it.
   * - A subscription includes all of its resource groups.
   * - Resource groups can be picked individually.
   * Management groups are drawn for the ticked ones and for the chain above every included
   * subscription (up to the highest ticked group, otherwise up to below the tenant root group).
   * @param {object} tree { managementGroups, subscriptions } as shown in the dialog
   * @param {Set<string>|string[]} checkedKeys keys made with KEY
   * @returns {{managementGroups: string[], subscriptions: string[], resourceGroups: Object<string, null|string[]>}}
   *          resourceGroups maps a subscription id to null (all) or the resource group names.
   */
  function resolveSelection(tree, checkedKeys) {
    const checked = new Set(checkedKeys || []);
    const idx = indexTree(tree);
    const subs = [];
    const rgs = {};
    idx.subs.forEach((sub, id) => {
      const full = checked.has(KEY.sub(id)) || mgChain(idx, sub.parent).some((m) => checked.has(KEY.mg(m)));
      if (full) {
        subs.push(sub.subscriptionId);
        rgs[sub.subscriptionId] = null;
        return;
      }
      const names = [];
      checked.forEach((k) => {
        const prefix = 'rg:' + id + '/';
        if (k.indexOf(prefix) === 0) names.push(k.slice(prefix.length));
      });
      if (names.length) {
        subs.push(sub.subscriptionId);
        rgs[sub.subscriptionId] = names;
      }
    });
    const drawn = new Set();
    // Ticked management groups and every management group below them.
    idx.mgs.forEach((mg, name) => {
      if (checked.has(KEY.mg(name)) || mgChain(idx, mg.parent).some((m) => checked.has(KEY.mg(m)))) drawn.add(name);
    });
    // The chain above each included subscription.
    subs.forEach((subId) => {
      const chain = mgChain(idx, idx.subs.get(lower(subId)).parent);
      let top = -1;
      chain.forEach((m, i) => { if (checked.has(KEY.mg(m))) top = i; });
      const keep = top >= 0 ? chain.slice(0, top + 1) : chain.filter((m) => !!idx.mgs.get(m).parent);
      keep.forEach((m) => drawn.add(m));
    });
    const managementGroups = arr(tree && tree.managementGroups).filter((m) => drawn.has(lower(m.name))).map((m) => m.name);
    return { managementGroups, subscriptions: subs, resourceGroups: rgs };
  }

  // ---------------------------------------------------------------------------
  // Resource types
  // ---------------------------------------------------------------------------

  /** ARM resource type (lowercase) -> catalog type. Special cases are handled in mapType. */
  const TYPE_MAP = {
    'microsoft.logic/workflows': 'logic-app-consumption',
    'microsoft.logic/integrationaccounts': 'integration-account',
    'microsoft.logic/integrationaccounts/maps': 'integration-account-map',
    'microsoft.logic/integrationaccounts/schemas': 'integration-account-schema',
    'microsoft.logic/integrationaccounts/partners': 'integration-account-partner',
    'microsoft.logic/integrationaccounts/agreements': 'integration-account-agreement',
    'microsoft.apimanagement/service': 'api-management',
    'microsoft.apimanagement/service/apis': 'apim-api',
    'microsoft.apimanagement/service/products': 'apim-product',
    'microsoft.apimanagement/service/backends': 'apim-backend',
    'microsoft.apicenter/services': 'api-center',
    'microsoft.web/connections': 'api-connection',
    'microsoft.web/customapis': 'custom-connector',
    'microsoft.web/sites/workflows': 'logic-app-workflow',
    'microsoft.web/sites/functions': 'function',
    'microsoft.web/serverfarms': 'app-service-plan',
    'microsoft.web/connectiongateways': 'data-gateway',
    'microsoft.datafactory/factories': 'data-factory',
    'microsoft.integrationspaces/spaces': 'integration-environment',
    'microsoft.appconfiguration/configurationstores': 'app-configuration',
    'microsoft.servicebus/namespaces': 'service-bus-namespace',
    'microsoft.servicebus/namespaces/queues': 'service-bus-queue',
    'microsoft.servicebus/namespaces/topics': 'service-bus-topic',
    'microsoft.servicebus/namespaces/topics/subscriptions': 'service-bus-subscription',
    'microsoft.eventgrid/topics': 'event-grid-topic',
    'microsoft.eventgrid/systemtopics': 'event-grid-system-topic',
    'microsoft.eventgrid/domains': 'event-grid-domain',
    'microsoft.eventgrid/domains/topics': 'event-grid-domain-topic',
    'microsoft.eventgrid/eventsubscriptions': 'event-grid-subscription',
    'microsoft.eventgrid/systemtopics/eventsubscriptions': 'event-grid-subscription',
    'microsoft.eventhub/namespaces': 'event-hubs-namespace',
    'microsoft.eventhub/namespaces/eventhubs': 'event-hub',
    'microsoft.eventhub/namespaces/eventhubs/consumergroups': 'event-hub-consumer-group',
    'microsoft.relay/namespaces': 'relay-namespace',
    'microsoft.relay/namespaces/hybridconnections': 'relay-hybrid-connection',
    'microsoft.app/managedenvironments': 'container-apps-environment',
    'microsoft.app/containerapps': 'container-app',
    'microsoft.containerregistry/registries': 'container-registry',
    'microsoft.storage/storageaccounts': 'storage-account',
    'microsoft.storage/storageaccounts/blobservices/containers': 'storage-container',
    'microsoft.storage/storageaccounts/queueservices/queues': 'storage-queue',
    'microsoft.storage/storageaccounts/tableservices/tables': 'storage-table',
    'microsoft.storage/storageaccounts/fileservices/shares': 'storage-file-share',
    'microsoft.documentdb/databaseaccounts': 'cosmos-db',
    'microsoft.sql/servers': 'sql-server',
    'microsoft.sql/servers/databases': 'sql-database',
    'microsoft.cache/redis': 'redis',
    'microsoft.keyvault/vaults': 'key-vault',
    'microsoft.managedidentity/userassignedidentities': 'managed-identity',
    'microsoft.network/virtualnetworks': 'virtual-network',
    'microsoft.network/virtualnetworks/subnets': 'subnet',
    'microsoft.network/privateendpoints': 'private-endpoint',
    'microsoft.network/privatednszones': 'private-dns-zone',
    'microsoft.network/networksecuritygroups': 'nsg',
    'microsoft.network/applicationgateways': 'application-gateway',
    'microsoft.network/publicipaddresses': 'public-ip',
    'microsoft.network/virtualnetworkgateways': 'virtual-network-gateway',
    'microsoft.network/azurefirewalls': 'firewall',
    'microsoft.insights/components': 'application-insights',
    'microsoft.operationalinsights/workspaces': 'log-analytics',
    'microsoft.insights/metricalerts': 'alert-rule',
    'microsoft.insights/scheduledqueryrules': 'alert-rule'
  };

  /**
   * Plumbing resources that are created implicitly and would only clutter the diagram
   * (network interfaces of private endpoints, network watchers, smart detector rules, ...).
   */
  const SKIPPED_TYPES = new Set([
    'microsoft.network/networkinterfaces',
    'microsoft.network/networkwatchers',
    'microsoft.network/networkwatchers/flowlogs',
    'microsoft.network/privatednszones/virtualnetworklinks',
    'microsoft.alertsmanagement/smartdetectoralertrules',
    'microsoft.compute/virtualmachines/extensions',
    'microsoft.web/sites/slots'
  ]);

  /** Whether a resource is plumbing that is never drawn. */
  function isSkipped(res) {
    const t = lower(res && res.type);
    if (SKIPPED_TYPES.has(t)) return true;
    // Every logical SQL server has a hidden system database.
    return t === 'microsoft.sql/servers/databases' && lower(leaf(res.name)) === 'master';
  }

  /**
   * Catalog type for an ARM resource, or null when there is no dedicated type.
   * @param {object} res ARM resource ({ type, kind, sku, _catalogType? })
   */
  function mapType(res) {
    if (!res) return null;
    if (res._catalogType && Catalog.get(res._catalogType)) return res._catalogType;
    const t = lower(res.type);
    const kind = lower(res.kind);
    if (t === 'microsoft.web/sites') {
      if (kind.indexOf('workflowapp') !== -1) return 'logic-app-standard';
      if (kind.indexOf('functionapp') !== -1) return 'function-app';
      return 'app-service';
    }
    if (t === 'microsoft.cognitiveservices/accounts') return kind === 'openai' || kind === 'aiservices' ? 'azure-openai' : null;
    if (t === 'microsoft.cdn/profiles') return lower(res.sku && res.sku.name).indexOf('azurefrontdoor') !== -1 ? 'front-door' : null;
    return Object.prototype.hasOwnProperty.call(TYPE_MAP, t) ? TYPE_MAP[t] : null;
  }

  /**
   * Child resources read per resource (relative ARM paths). `children` are read for every
   * item found; `attach` stores the items on the parent (AzureArm puts them in `extras`).
   */
  const CHILD_SPECS = {
    'logic-app-standard': [{ type: 'logic-app-workflow', path: '/workflows', api: '2022-03-01' }],
    'function-app': [{ type: 'function', path: '/functions', api: '2022-03-01' }],
    'integration-account': [
      { type: 'integration-account-map', path: '/maps', api: '2019-05-01' },
      { type: 'integration-account-schema', path: '/schemas', api: '2019-05-01' },
      { type: 'integration-account-partner', path: '/partners', api: '2019-05-01' },
      { type: 'integration-account-agreement', path: '/agreements', api: '2019-05-01' }
    ],
    'api-management': [
      { type: 'apim-api', path: '/apis', api: '2022-08-01' },
      { type: 'apim-product', path: '/products', api: '2022-08-01' },
      { type: 'apim-backend', path: '/backends', api: '2022-08-01' }
    ],
    'service-bus-namespace': [
      { type: 'service-bus-queue', path: '/queues', api: '2021-11-01' },
      { type: 'service-bus-topic', path: '/topics', api: '2021-11-01', children: [{ type: 'service-bus-subscription', path: '/subscriptions', api: '2021-11-01' }] }
    ],
    'event-hubs-namespace': [
      { type: 'event-hub', path: '/eventhubs', api: '2024-01-01', children: [{ type: 'event-hub-consumer-group', path: '/consumergroups', api: '2024-01-01' }] }
    ],
    'relay-namespace': [{ type: 'relay-hybrid-connection', path: '/hybridConnections', api: '2021-11-01' }],
    'event-grid-topic': [{ type: 'event-grid-subscription', path: '/providers/Microsoft.EventGrid/eventSubscriptions', api: '2022-06-15' }],
    'event-grid-system-topic': [{ type: 'event-grid-subscription', path: '/eventSubscriptions', api: '2022-06-15' }],
    'event-grid-domain': [
      { type: 'event-grid-domain-topic', path: '/topics', api: '2022-06-15', children: [{ type: 'event-grid-subscription', path: '/providers/Microsoft.EventGrid/eventSubscriptions', api: '2022-06-15' }] },
      { type: 'event-grid-subscription', path: '/providers/Microsoft.EventGrid/eventSubscriptions', api: '2022-06-15' }
    ],
    'storage-account': [
      { type: 'storage-container', path: '/blobServices/default/containers', api: '2023-01-01' },
      { type: 'storage-queue', path: '/queueServices/default/queues', api: '2023-01-01' },
      { type: 'storage-table', path: '/tableServices/default/tables', api: '2023-01-01' },
      { type: 'storage-file-share', path: '/fileServices/default/shares', api: '2023-01-01' }
    ],
    'private-dns-zone': [{ attach: 'vnetLinks', path: '/virtualNetworkLinks', api: '2020-06-01' }],
    'azure-openai': [{ attach: 'deployments', path: '/deployments', api: '2023-05-01' }]
  };

  /** Child specs for a catalog type. */
  function childSpecs(catalogType) {
    return CHILD_SPECS[catalogType] || [];
  }

  // ---------------------------------------------------------------------------
  // Attributes
  // ---------------------------------------------------------------------------

  const IDENTITY = { systemassigned: 'System assigned', userassigned: 'User assigned', 'systemassigned,userassigned': 'System + User assigned', none: 'None' };
  const identity = (r) => (r.identity && r.identity.type ? IDENTITY[lower(r.identity.type).replace(/\s+/g, '')] || String(r.identity.type) : undefined);
  const tls = (v) => (v ? String(v).replace(/^tls/i, '').replace('_', '.') : undefined);
  const bool = (v) => (typeof v === 'boolean' ? v : undefined);
  const join = (list) => arr(list).filter((x) => x !== undefined && x !== null && x !== '').join(', ') || undefined;
  const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : undefined);
  const hasPrivateEndpoint = (p) => (Array.isArray(p.privateEndpointConnections) ? p.privateEndpointConnections.length > 0 : undefined);

  const LOGIC_TRIGGERS = [['servicebus', 'Service Bus'], ['eventgrid', 'Event Grid'], ['eventhub', 'Event Hubs'], ['azureblob', 'Blob Storage'], ['sftp', 'SFTP']];
  function logicTrigger(definition) {
    const triggers = isObj(definition) && isObj(definition.triggers) ? definition.triggers : null;
    if (!triggers) return undefined;
    const first = triggers[Object.keys(triggers)[0]];
    if (!isObj(first)) return undefined;
    const type = lower(first.type);
    if (type === 'request' || type === 'httpwebhook') return 'HTTP Request';
    if (type === 'recurrence') return 'Recurrence';
    const text = lower(JSON.stringify(first));
    const hit = LOGIC_TRIGGERS.find(([needle]) => text.indexOf(needle) !== -1);
    return hit ? hit[1] : 'Other';
  }

  const FUNCTION_TRIGGERS = {
    httptrigger: 'HTTP', timertrigger: 'Timer', servicebustrigger: 'Service Bus', eventgridtrigger: 'Event Grid', eventhubtrigger: 'Event Hubs',
    blobtrigger: 'Blob', queuetrigger: 'Queue', cosmosdbtrigger: 'Cosmos DB', orchestrationtrigger: 'Durable orchestration', activitytrigger: 'Durable activity'
  };

  const REPLICATION = { lrs: 'LRS', zrs: 'ZRS', grs: 'GRS', gzrs: 'GZRS', ragrs: 'RA-GRS', ragzrs: 'RA-GZRS' };
  const APIM_SKU = { basicv2: 'Basic v2', standardv2: 'Standard v2', premiumv2: 'Premium v2' };
  const API_TYPES = { http: 'REST', soap: 'SOAP', graphql: 'GraphQL', websocket: 'WebSocket', grpc: 'gRPC', odata: 'OData', mcp: 'MCP' };
  const CONSISTENCY = { session: 'Session', strong: 'Strong', boundedstaleness: 'Bounded staleness', consistentprefix: 'Consistent prefix', eventual: 'Eventual' };
  const EG_ENDPOINTS = { webhook: 'Webhook', azurefunction: 'Azure Function', servicebusqueue: 'Service Bus Queue', servicebustopic: 'Service Bus Topic', eventhub: 'Event Hubs', storagequeue: 'Storage Queue', hybridconnection: 'Hybrid Connection' };
  const SYSTEM_TOPICS = {
    'microsoft.storage.storageaccounts': 'Storage Accounts', 'microsoft.servicebus.namespaces': 'Service Bus', 'microsoft.eventhub.namespaces': 'Event Hubs',
    'microsoft.keyvault.vaults': 'Key Vault', 'microsoft.appconfiguration.configurationstores': 'App Configuration', 'microsoft.apimanagement.service': 'API Management',
    'microsoft.resources.resourcegroups': 'Resource Groups', 'microsoft.resources.subscriptions': 'Azure Subscriptions', 'microsoft.containerregistry.registries': 'Container Registry'
  };

  function sqlTier(r) {
    const tier = lower(r.sku && r.sku.tier);
    if (tier === 'generalpurpose') return lower(r.kind).indexOf('serverless') !== -1 || /_S_/i.test(r.sku.name || '') ? 'General Purpose Serverless' : 'General Purpose';
    if (tier === 'businesscritical') return 'Business Critical';
    if (tier === 'hyperscale') return 'Hyperscale';
    if (tier === 'basic') return 'Basic';
    if (tier === 'standard') return 'Standard ' + (r.sku.name || '');
    return r.sku && (r.sku.tier || r.sku.name);
  }

  function cosmosApi(r, p) {
    const caps = arr(p.capabilities).map((c) => lower(c && c.name));
    if (lower(r.kind) === 'mongodb') return 'MongoDB';
    if (caps.indexOf('enablecassandra') !== -1) return 'Cassandra';
    if (caps.indexOf('enablegremlin') !== -1) return 'Gremlin';
    if (caps.indexOf('enabletable') !== -1) return 'Table';
    return 'NoSQL';
  }

  /** Per catalog type: attribute values read from the ARM resource (r) and its properties (p). */
  const ATTRIBUTES = {
    'logic-app-consumption': (r, p) => ({ state: p.state, trigger: logicTrigger(p.definition), integrationAccount: p.integrationAccount && leaf(p.integrationAccount.id), identity: identity(r) }),
    'logic-app-standard': (r, p) => ({ appServicePlan: leaf(p.serverFarmId), vnetIntegration: p.virtualNetworkSubnetId ? true : undefined, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p), identity: identity(r) }),
    'logic-app-workflow': (r, p) => ({ kind: cap(p.kind || r.kind), trigger: logicTrigger(p.definition) }),
    'integration-account': (r) => ({ sku: r.sku && r.sku.name }),
    'integration-account-map': (r, p) => ({ mapType: p.mapType }),
    'integration-account-schema': (r, p) => ({ schemaType: p.schemaType === 'Xml' ? 'XML' : p.schemaType }),
    'integration-account-partner': (r, p) => {
      const id = p.content && p.content.b2b && arr(p.content.b2b.businessIdentities)[0];
      return { qualifier: id ? id.qualifier + ':' + id.value : undefined };
    },
    'integration-account-agreement': (r, p) => ({ agreementType: p.agreementType ? String(p.agreementType).toUpperCase() : undefined, hostPartner: p.hostPartner, guestPartner: p.guestPartner }),
    'api-management': (r, p) => ({
      sku: r.sku && (APIM_SKU[lower(r.sku.name)] || r.sku.name), capacity: r.sku && r.sku.capacity,
      vnetMode: p.virtualNetworkType, publisherName: p.publisherName, publisherEmail: p.publisherEmail,
      zoneRedundant: arr(r.zones).length > 1 ? true : undefined, identity: identity(r)
    }),
    'apim-api': (r, p) => ({ apiType: API_TYPES[lower(p.type || 'http')] || p.type, path: p.path, version: p.apiVersion, backendUrl: p.serviceUrl, subscriptionRequired: bool(p.subscriptionRequired) }),
    'apim-product': (r, p) => ({ state: p.state, approvalRequired: bool(p.approvalRequired), subscriptionRequired: bool(p.subscriptionRequired) }),
    'apim-backend': (r, p) => ({ url: p.url, protocol: p.protocol, circuitBreaker: p.circuitBreaker ? true : undefined }),
    'api-center': (r) => ({ sku: r.sku && r.sku.name }),
    'api-connection': (r, p) => ({ connector: p.api && (p.api.displayName || p.api.name) }),
    'custom-connector': (r, p) => ({ host: p.backendService && p.backendService.serviceUrl }),
    'data-factory': (r, p) => ({ gitIntegration: p.repoConfiguration ? true : undefined, publicNetworkAccess: p.publicNetworkAccess, identity: identity(r) }),
    'app-configuration': (r, p) => ({ sku: r.sku && cap(r.sku.name), purgeProtection: bool(p.enablePurgeProtection), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'service-bus-namespace': (r, p) => ({
      sku: r.sku && r.sku.tier, capacity: r.sku && lower(r.sku.tier) === 'premium' && r.sku.capacity ? String(r.sku.capacity) : undefined,
      zoneRedundant: bool(p.zoneRedundant), disableLocalAuth: bool(p.disableLocalAuth), minimumTlsVersion: tls(p.minimumTlsVersion),
      publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p)
    }),
    'service-bus-queue': (r, p) => ({
      maxSizeGB: p.maxSizeInMegabytes ? String(Math.round(p.maxSizeInMegabytes / 1024)) : undefined, lockDuration: p.lockDuration, maxDeliveryCount: p.maxDeliveryCount,
      defaultMessageTimeToLive: p.defaultMessageTimeToLive, requiresSession: bool(p.requiresSession), duplicateDetection: bool(p.requiresDuplicateDetection),
      deadLetteringOnExpiration: bool(p.deadLetteringOnMessageExpiration), forwardTo: p.forwardTo
    }),
    'service-bus-topic': (r, p) => ({ maxSizeGB: p.maxSizeInMegabytes ? String(Math.round(p.maxSizeInMegabytes / 1024)) : undefined, supportOrdering: bool(p.supportOrdering), duplicateDetection: bool(p.requiresDuplicateDetection), defaultMessageTimeToLive: p.defaultMessageTimeToLive }),
    'service-bus-subscription': (r, p) => ({ maxDeliveryCount: p.maxDeliveryCount, requiresSession: bool(p.requiresSession), forwardTo: p.forwardTo }),
    'event-grid-topic': (r, p) => ({ inputSchema: p.inputSchema, disableLocalAuth: bool(p.disableLocalAuth), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'event-grid-system-topic': (r, p) => ({ topicType: SYSTEM_TOPICS[lower(p.topicType)] || (p.topicType ? 'Other' : undefined), source: leaf(p.source) || undefined }),
    'event-grid-domain': (r, p) => ({ inputSchema: p.inputSchema, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'event-grid-subscription': (r, p) => {
      const dest = isObj(p.destination) ? p.destination : {};
      const dp = isObj(dest.properties) ? dest.properties : {};
      const url = dp.endpointBaseUrl || dp.endpointUrl || '';
      let type = EG_ENDPOINTS[lower(dest.endpointType)] || dest.endpointType;
      if (type === 'Webhook' && /\.logic\.azure\.com/i.test(url)) type = 'Logic App';
      const filter = isObj(p.filter) ? p.filter : {};
      return {
        endpointType: type, endpoint: dp.resourceId ? leaf(dp.resourceId) + (dp.queueName ? '/' + dp.queueName : '') : url || undefined,
        filters: join(arr(filter.includedEventTypes).concat(filter.subjectBeginsWith ? ['subject begins with ' + filter.subjectBeginsWith] : [])),
        deliverySchema: p.eventDeliverySchema, maxDeliveryAttempts: p.retryPolicy && p.retryPolicy.maxDeliveryAttempts, deadLetter: p.deadLetterDestination ? true : undefined
      };
    },
    'event-hubs-namespace': (r, p) => ({
      sku: r.sku && r.sku.tier, capacity: r.sku && r.sku.capacity, autoInflate: bool(p.isAutoInflateEnabled), kafkaEnabled: bool(p.kafkaEnabled),
      zoneRedundant: bool(p.zoneRedundant), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p)
    }),
    'event-hub': (r, p) => ({ partitionCount: p.partitionCount, retentionDays: p.messageRetentionInDays, capture: p.captureDescription ? bool(p.captureDescription.enabled) : undefined }),
    'relay-namespace': (r, p) => ({ sku: r.sku && r.sku.tier, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'relay-hybrid-connection': (r, p) => ({ requiresClientAuthorization: bool(p.requiresClientAuthorization), endpoint: p.userMetadata && /^[\w.-]+:\d+$/.test(p.userMetadata) ? p.userMetadata : undefined }),
    'function-app': (r, p) => ({
      os: lower(r.kind).indexOf('linux') !== -1 ? 'Linux' : 'Windows', runtimeVersion: p.siteConfig && (p.siteConfig.linuxFxVersion || p.siteConfig.netFrameworkVersion) || undefined,
      vnetIntegration: p.virtualNetworkSubnetId ? true : undefined, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p), identity: identity(r)
    }),
    function: (r, p) => {
      const bindings = arr(p.config && p.config.bindings);
      const trigger = bindings.find((b) => b && /trigger$/i.test(b.type || ''));
      return {
        trigger: trigger ? FUNCTION_TRIGGERS[lower(trigger.type)] || trigger.type : undefined,
        authLevel: trigger && trigger.authLevel ? lower(trigger.authLevel) : undefined,
        bindings: join(bindings.map((b) => b && b.type ? (b.direction ? b.direction + ' ' : '') + b.type : ''))
      };
    },
    'app-service-plan': (r, p) => ({ sku: r.sku && r.sku.name, os: lower(r.kind).indexOf('linux') !== -1 || p.reserved ? 'Linux' : 'Windows', instances: r.sku && r.sku.capacity, zoneRedundant: bool(p.zoneRedundant) }),
    'app-service': (r, p) => ({ runtime: p.siteConfig && p.siteConfig.linuxFxVersion || undefined, appServicePlan: leaf(p.serverFarmId) || undefined, vnetIntegration: p.virtualNetworkSubnetId ? true : undefined, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p), identity: identity(r) }),
    'container-apps-environment': (r, p) => ({ plan: arr(p.workloadProfiles).length ? 'Workload profiles' : 'Consumption', internal: p.vnetConfiguration ? bool(p.vnetConfiguration.internal) : undefined, subnet: p.vnetConfiguration && leaf(p.vnetConfiguration.infrastructureSubnetId) || undefined, zoneRedundant: bool(p.zoneRedundant) }),
    'container-app': (r, p) => {
      const ingress = p.configuration && p.configuration.ingress;
      const scale = p.template && p.template.scale;
      const container = p.template && arr(p.template.containers)[0];
      return {
        environment: leaf(p.managedEnvironmentId || p.environmentId) || undefined, image: container && container.image,
        ingress: p.configuration ? (ingress ? (ingress.external ? 'External' : 'Internal') : 'Disabled') : undefined,
        minReplicas: scale && scale.minReplicas, maxReplicas: scale && scale.maxReplicas, identity: identity(r)
      };
    },
    'container-registry': (r, p) => ({ sku: r.sku && r.sku.name, adminUser: bool(p.adminUserEnabled), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'storage-account': (r, p) => {
      const parts = String((r.sku && r.sku.name) || '').split('_');
      return {
        kind: r.kind, performance: r.sku && r.sku.tier, replication: REPLICATION[lower(parts[1])], accessTier: p.accessTier,
        hierarchicalNamespace: bool(p.isHnsEnabled), sftp: bool(p.isSftpEnabled), allowSharedKeyAccess: bool(p.allowSharedKeyAccess),
        minimumTlsVersion: tls(p.minimumTlsVersion), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p)
      };
    },
    'storage-container': (r, p) => ({ publicAccess: p.publicAccess, immutable: bool(p.hasImmutabilityPolicy) }),
    'storage-file-share': (r, p) => ({ quotaGiB: p.shareQuota, protocol: p.enabledProtocols }),
    'cosmos-db': (r, p) => ({
      api: cosmosApi(r, p), capacityMode: arr(p.capabilities).some((c) => lower(c && c.name) === 'enableserverless') ? 'Serverless' : undefined,
      consistency: p.consistencyPolicy && CONSISTENCY[lower(p.consistencyPolicy.defaultConsistencyLevel)], multiRegionWrites: bool(p.enableMultipleWriteLocations),
      publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p)
    }),
    'sql-server': (r, p) => ({ entraOnlyAuth: p.administrators ? bool(p.administrators.azureADOnlyAuthentication) : undefined, entraAdmin: p.administrators && p.administrators.login, minimalTlsVersion: tls(p.minimalTlsVersion), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'sql-database': (r, p) => ({ sku: sqlTier(r), maxSize: p.maxSizeBytes ? Math.round(p.maxSizeBytes / 1073741824) + ' GB' : undefined, backupRedundancy: p.requestedBackupStorageRedundancy, zoneRedundant: bool(p.zoneRedundant) }),
    redis: (r, p) => ({ sku: p.sku ? p.sku.name + ' ' + p.sku.family + p.sku.capacity : undefined, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p) }),
    'key-vault': (r, p) => ({
      sku: p.sku && cap(p.sku.name), rbacAuthorization: bool(p.enableRbacAuthorization), softDeleteRetentionDays: p.softDeleteRetentionInDays,
      purgeProtection: bool(p.enablePurgeProtection), publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p)
    }),
    'virtual-network': (r, p) => ({
      addressSpace: join(p.addressSpace && p.addressSpace.addressPrefixes), dnsServers: join(p.dhcpOptions && p.dhcpOptions.dnsServers),
      ddosProtection: bool(p.enableDdosProtection), peerings: join(arr(p.virtualNetworkPeerings).map((x) => x && x.name))
    }),
    subnet: (r, p) => ({
      addressPrefix: p.addressPrefix || join(p.addressPrefixes), delegation: arr(p.delegations).length ? p.delegations[0].properties && p.delegations[0].properties.serviceName : 'None',
      nsg: p.networkSecurityGroup && leaf(p.networkSecurityGroup.id), routeTable: p.routeTable && leaf(p.routeTable.id),
      serviceEndpoints: join(arr(p.serviceEndpoints).map((s) => s && s.service))
    }),
    'private-endpoint': (r, p) => {
      const conn = arr(p.privateLinkServiceConnections).concat(arr(p.manualPrivateLinkServiceConnections))[0];
      const cp = conn && conn.properties ? conn.properties : {};
      return { target: leaf(cp.privateLinkServiceId) || undefined, groupId: arr(cp.groupIds)[0], subnet: p.subnet && leaf(p.subnet.id) };
    },
    nsg: (r, p) => ({ rules: arr(p.securityRules).map((x) => x && x.properties ? x.name + ': ' + x.properties.direction + ' ' + x.properties.access + ' ' + (x.properties.destinationPortRange || '*') : '').filter(Boolean).join('\n') || undefined }),
    'application-gateway': (r, p) => ({ sku: p.sku && p.sku.name, capacity: p.autoscaleConfiguration ? p.autoscaleConfiguration.maxCapacity : p.sku && p.sku.capacity, listeners: join(arr(p.httpListeners).map((x) => x && x.name)), zoneRedundant: arr(r.zones).length > 1 ? true : undefined }),
    'front-door': (r) => ({ sku: r.sku && /premium/i.test(r.sku.name) ? 'Premium' : 'Standard' }),
    'public-ip': (r, p) => ({ sku: r.sku && r.sku.name, allocation: p.publicIPAllocationMethod, dnsLabel: p.dnsSettings && p.dnsSettings.domainNameLabel }),
    'virtual-network-gateway': (r, p) => ({ gatewayType: lower(p.gatewayType) === 'vpn' ? 'VPN' : p.gatewayType, sku: p.sku && p.sku.name, activeActive: bool(p.activeActive) }),
    firewall: (r, p) => ({ tier: p.sku && p.sku.tier, policy: p.firewallPolicy && leaf(p.firewallPolicy.id) }),
    'application-insights': (r, p) => ({ workspace: leaf(p.WorkspaceResourceId || p.workspaceResourceId) || undefined, samplingPercentage: p.SamplingPercentage, disableLocalAuth: bool(p.DisableLocalAuth) }),
    'log-analytics': (r, p) => ({ sku: p.sku && p.sku.name, retentionDays: p.retentionInDays }),
    'alert-rule': (r, p) => {
      const sev = ['0 - Critical', '1 - Error', '2 - Warning', '3 - Informational', '4 - Verbose'];
      return { severity: Number.isInteger(p.severity) ? sev[p.severity] : undefined, actionGroup: join(arr(p.actions && (p.actions.actionGroups || p.actions)).map((a) => leaf(typeof a === 'string' ? a : a && (a.actionGroupId || a.actionGroup)))) };
    },
    'azure-openai': (r, p) => ({ sku: r.sku && r.sku.name, publicNetworkAccess: p.publicNetworkAccess, privateEndpoint: hasPrivateEndpoint(p), identity: identity(r) }),
    'azure-resource': (r) => ({ resourceType: r.type, kind: r.kind || undefined, sku: r.sku && (r.sku.name || r.sku.tier) || undefined })
  };

  /**
   * Attribute values of a resource for a catalog type. Values that match a select option
   * case-insensitively use the option's spelling; unknown values are kept as they are.
   */
  function attributesFor(catalogType, res) {
    const def = Catalog.get(catalogType);
    const p = isObj(res.properties) ? res.properties : {};
    const raw = Object.assign({}, ATTRIBUTES[catalogType] ? ATTRIBUTES[catalogType](res, p) : {});
    if (res.location && def && def.attributes.some((a) => a.key === 'location')) raw.location = lower(res.location).replace(/\s+/g, '');
    const out = {};
    Object.keys(raw).forEach((key) => {
      let v = raw[key];
      if (v === undefined || v === null || v === '' || typeof v === 'object') return;
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      const attr = def && def.attributes.find((a) => a.key === key);
      if (attr && attr.type === 'select' && typeof v === 'string') {
        const hit = attr.options.find((o) => lower(o) === lower(v));
        if (hit !== undefined) v = hit;
      }
      if (attr && attr.type === 'number' && typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) v = Number(v);
      out[key] = typeof v === 'string' ? v.slice(0, 4000) : v;
    });
    return out;
  }

  /** ARM tags object -> blueprint tags. */
  function tagsOf(tags) {
    if (!isObj(tags)) return [];
    return Object.keys(tags).map((key) => ({ key, value: tags[key] === null || tags[key] === undefined ? '' : String(tags[key]) }));
  }

  // ---------------------------------------------------------------------------
  // Build the blueprint
  // ---------------------------------------------------------------------------

  /** Hostname of a URL, lowercase, or ''. */
  function hostOf(url) {
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(String(url || ''));
    return m ? lower(m[1]) : '';
  }

  /**
   * Build a blueprint from an Azure inventory.
   * @param {object} inventory see the module documentation
   * @param {object} [opts] { name, settings, includeOther (default true), description }
   * @returns {{project: object, stats: {nodes: number, connections: number, generic: number, skipped: Object<string, number>}, warnings: string[]}}
   */
  function buildProject(inventory, opts) {
    const o = Object.assign({ includeOther: true }, opts || {});
    const inv = inventory || {};
    const project = Model.createProject({ name: o.name || 'Azure environment', settings: o.settings || {} });
    project.meta.description = o.description || '';
    const ids = new Map(); // lowercase ARM id -> node id
    const stats = { nodes: 0, connections: 0, generic: 0, skipped: {} };
    const add = (armId, type, parentNodeId, props) => {
      const node = Model.addNode(project, type, parentNodeId, Object.assign({ nameMode: 'custom' }, props));
      if (armId) ids.set(lower(armId), node.id);
      stats.nodes++;
      return node;
    };
    const resourceId = (id) => [{ key: 'Resource ID', value: String(id) }];

    // Management groups (parents first).
    const mgs = arr(inv.managementGroups);
    const mgNames = new Set(mgs.map((m) => lower(m.name)));
    const mgId = (name) => '/providers/microsoft.management/managementgroups/' + lower(name);
    const pending = mgs.slice();
    let guard = pending.length + 1;
    while (pending.length && guard-- > 0) {
      for (let i = 0; i < pending.length; i++) {
        const m = pending[i];
        const parent = m.parent && mgNames.has(lower(m.parent)) ? lower(m.parent) : null;
        if (parent && !ids.has(mgId(parent))) continue;
        add(mgId(m.name), 'management-group', parent ? ids.get(mgId(parent)) : null, {
          name: m.name, label: m.name, attributes: { displayName: m.displayName || m.name }, custom: resourceId('/providers/Microsoft.Management/managementGroups/' + m.name)
        });
        pending.splice(i--, 1);
      }
    }

    // Subscriptions and resource groups.
    arr(inv.subscriptions).forEach((s) => {
      const parent = s.parent && ids.get(mgId(s.parent));
      const custom = resourceId('/subscriptions/' + s.subscriptionId);
      if (s.state) custom.push({ key: 'State', value: String(s.state) });
      add('/subscriptions/' + s.subscriptionId, 'subscription', parent || null, {
        name: s.displayName || s.subscriptionId, label: s.displayName || s.subscriptionId, attributes: { subscriptionId: s.subscriptionId }, tags: tagsOf(s.tags), custom
      });
    });
    arr(inv.resourceGroups).forEach((g) => {
      const sub = ids.get(lower('/subscriptions/' + g.subscriptionId));
      if (!sub) return;
      const attributes = attributesFor('resource-group', g);
      add('/subscriptions/' + g.subscriptionId + '/resourcegroups/' + g.name, 'resource-group', sub, {
        name: g.name, label: g.name, attributes, tags: tagsOf(g.tags), custom: resourceId(g.id || '/subscriptions/' + g.subscriptionId + '/resourceGroups/' + g.name)
      });
    });

    // Resources: parents before children (shorter ids first).
    const segs = (id) => String(id || '').split('/').length;
    const resources = arr(inv.resources).filter((r) => r && r.id && r.type).slice().sort((a, b) => segs(a._parent ? a._parent + '/x/y' : a.id) - segs(b._parent ? b._parent + '/x/y' : b.id));
    const created = []; // [{ res, node, type }]
    const seen = new Set();
    const skip = (type) => { stats.skipped[type] = (stats.skipped[type] || 0) + 1; };
    const rgNodeOf = (id) => {
      const m = /^\/subscriptions\/([^/]+)\/resourcegroups\/([^/]+)/i.exec(String(id || ''));
      return m ? ids.get(lower('/subscriptions/' + m[1] + '/resourcegroups/' + m[2])) : undefined;
    };
    const placeResource = (res, forcedType, explicitParent) => {
      const key = lower(res.id);
      if (seen.has(key)) return null;
      seen.add(key);
      if (isSkipped(res)) return null;
      let type = forcedType || mapType(res);
      if (!type) {
        if (!o.includeOther) { skip(lower(res.type)); return null; }
        type = 'azure-resource';
      }
      // Parent: explicit parent, the nearest resource above in the ARM id, or the resource group.
      let parentId = explicitParent ? ids.get(lower(explicitParent)) : undefined;
      if (!parentId && !explicitParent) {
        let up = res.id;
        while (!parentId && segs(up) > 9) {
          up = strip(up, 2);
          const hit = ids.get(lower(up));
          if (hit && Model.canContain(project, hit, type)) parentId = hit;
        }
      }
      if (!parentId || !Model.canContain(project, parentId, type)) {
        const rg = rgNodeOf(res._parent || res.id);
        if (rg && Model.canContain(project, rg, type)) parentId = rg;
        else if (rg && o.includeOther) { parentId = rg; type = 'azure-resource'; } else { skip(lower(res.type)); return null; }
      }
      if (type === 'azure-resource') stats.generic++;
      const name = leaf(res.name) || leaf(res.id);
      const node = add(res.id, type, parentId, { name, label: name, attributes: attributesFor(type, res), tags: tagsOf(res.tags), custom: resourceId(res.id) });
      created.push({ res, node, type });
      return node;
    };
    resources.forEach((res) => {
      const node = placeResource(res, res._catalogType, res._parent);
      if (node && node.type === 'virtual-network') {
        arr(res.properties && res.properties.subnets).forEach((sn) => {
          if (sn && sn.name) placeResource({ id: sn.id || res.id + '/subnets/' + sn.name, name: sn.name, type: 'Microsoft.Network/virtualNetworks/subnets', properties: sn.properties }, 'subnet', res.id);
        });
      }
    });

    // Network attachments and connections derived from resource properties.
    const connKeys = new Set();
    const resolve = (armId) => {
      let id = lower(armId);
      while (id && segs(id) > 5) {
        if (ids.has(id)) return ids.get(id);
        id = strip(id, 2);
      }
      return undefined;
    };
    const connect = (from, to, kind, label, direction) => {
      if (!from || !to || from === to) return;
      const k = direction === 'bidirectional' ? [from, to].sort().join('|') + '|' + kind : from + '|' + to + '|' + kind;
      if (connKeys.has(k)) return;
      connKeys.add(k);
      if (Model.addConnection(project, from, to, { kind, label: label || '', direction })) stats.connections++;
    };
    const attach = (node, subnetArmId) => {
      const target = resolve(subnetArmId);
      if (!target || !Model.isNetworkTarget(project, target)) return;
      if (Catalog.supportsNetwork(node.type)) {
        if (node.network.indexOf(target) === -1) node.network.push(target);
      } else {
        connect(node.id, target, 'network', 'subnet');
      }
    };
    const hosts = new Map();
    created.forEach(({ res, node }) => {
      const p = isObj(res.properties) ? res.properties : {};
      if (lower(res.type) === 'microsoft.web/sites') [p.defaultHostName].concat(arr(p.hostNames)).forEach((hn) => { if (hn) hosts.set(lower(hn), node.id); });
    });
    const extras = isObj(inv.extras) ? inv.extras : {};
    created.forEach(({ res, node, type }) => {
      const p = isObj(res.properties) ? res.properties : {};
      const ex = extras[lower(res.id)] || {};
      if (p.serverFarmId) connect(node.id, resolve(p.serverFarmId), 'dependency', 'hosted on');
      if (p.virtualNetworkSubnetId) attach(node, p.virtualNetworkSubnetId);
      if (p.subnet && p.subnet.id) attach(node, p.subnet.id);
      if (p.virtualNetworkConfiguration && p.virtualNetworkConfiguration.subnetResourceId) attach(node, p.virtualNetworkConfiguration.subnetResourceId);
      if (p.vnetConfiguration && p.vnetConfiguration.infrastructureSubnetId) attach(node, p.vnetConfiguration.infrastructureSubnetId);
      arr(p.gatewayIPConfigurations).concat(arr(p.ipConfigurations)).forEach((c) => {
        const cp = c && c.properties;
        if (cp && cp.subnet && cp.subnet.id) attach(node, cp.subnet.id);
        if (cp && cp.publicIPAddress && cp.publicIPAddress.id) connect(node.id, resolve(cp.publicIPAddress.id), 'association', 'public IP');
      });
      arr(p.frontendIPConfigurations).forEach((c) => {
        const cp = c && c.properties;
        if (cp && cp.publicIPAddress && cp.publicIPAddress.id) connect(node.id, resolve(cp.publicIPAddress.id), 'association', 'public IP');
      });
      arr(p.privateLinkServiceConnections).concat(arr(p.manualPrivateLinkServiceConnections)).forEach((c) => {
        const cp = c && c.properties;
        if (cp && cp.privateLinkServiceId) connect(node.id, resolve(cp.privateLinkServiceId), 'network', 'private link' + (arr(cp.groupIds).length ? ' (' + cp.groupIds.join(', ') + ')' : ''));
      });
      arr(p.virtualNetworkPeerings).forEach((x) => {
        const remote = x && x.properties && x.properties.remoteVirtualNetwork;
        if (remote && remote.id) connect(node.id, resolve(remote.id), 'network', 'peering', 'bidirectional');
      });
      const workspace = p.WorkspaceResourceId || p.workspaceResourceId;
      if (workspace && type === 'application-insights') connect(node.id, resolve(workspace), 'dependency', 'logs');
      const env = p.managedEnvironmentId || p.environmentId;
      if (env && type === 'container-app') connect(node.id, resolve(env), 'dependency', 'runs in');
      if (p.integrationAccount && p.integrationAccount.id) connect(node.id, resolve(p.integrationAccount.id), 'dependency', 'integration account');
      const conns = p.parameters && p.parameters.$connections && p.parameters.$connections.value;
      if (isObj(conns)) Object.keys(conns).forEach((k) => { if (conns[k] && conns[k].connectionId) connect(node.id, resolve(conns[k].connectionId), 'dependency', 'API connection'); });
      if (res.identity && isObj(res.identity.userAssignedIdentities)) Object.keys(res.identity.userAssignedIdentities).forEach((k) => connect(node.id, resolve(k), 'dependency', 'identity'));
      if (type === 'event-grid-system-topic' && p.source) connect(resolve(p.source), node.id, 'flow', 'events');
      if (type === 'alert-rule') arr(p.scopes).forEach((s) => connect(node.id, resolve(s), 'association', 'monitors'));
      if (type === 'event-grid-subscription' && isObj(p.destination) && isObj(p.destination.properties)) {
        const dp = p.destination.properties;
        let target = dp.resourceId;
        if (target && dp.queueName && lower(p.destination.endpointType) === 'storagequeue') {
          target = ids.has(lower(target + '/queueServices/default/queues/' + dp.queueName)) ? target + '/queueServices/default/queues/' + dp.queueName : target;
        }
        if (target) connect(node.id, resolve(target), 'trigger', 'delivers');
        else if (hosts.has(hostOf(dp.endpointBaseUrl || dp.endpointUrl))) connect(node.id, hosts.get(hostOf(dp.endpointBaseUrl || dp.endpointUrl)), 'trigger', 'delivers');
      }
      if (type === 'service-bus-queue' || type === 'service-bus-subscription') {
        const ns = /^(.*\/namespaces\/[^/]+)\//i.exec(res.id);
        [[p.forwardTo, 'forwards'], [p.forwardDeadLetteredMessagesTo, 'dead-letters']].forEach(([to, label]) => {
          if (!to || !ns) return;
          const target = ids.get(lower(ns[1] + '/queues/' + to)) || ids.get(lower(ns[1] + '/topics/' + to));
          connect(node.id, target, 'flow', label);
        });
      }
      if (type === 'apim-backend' || type === 'apim-api') {
        const host = hostOf(type === 'apim-backend' ? p.url : p.serviceUrl);
        if (host && hosts.has(host)) connect(node.id, hosts.get(host), 'flow', 'backend');
      }
      if (type === 'private-dns-zone') {
        const links = arr(ex.vnetLinks);
        links.forEach((l) => { const vnet = l && l.properties && l.properties.virtualNetwork; if (vnet && vnet.id) attach(node, vnet.id); });
        if (links.length) node.attributes.vnetLinks = links.map((l) => leaf(l.name)).join('\n');
      }
      if (type === 'azure-openai' && arr(ex.deployments).length) {
        node.attributes.deployments = ex.deployments.map((d) => {
          const m = d && d.properties && d.properties.model;
          return leaf(d && d.name) + (m && m.name ? ' (' + m.name + (m.version ? ' ' + m.version : '') + ')' : '');
        }).join('\n');
      }
    });

    // Validate like an imported file, then arrange everything.
    const result = Model.normalize(JSON.parse(JSON.stringify(project)));
    Layout.autoLayout(result.project);
    return { project: result.project, stats, warnings: result.warnings };
  }

  AISBP.Azure = {
    KEY,
    TYPE_MAP,
    SKIPPED_TYPES,
    CHILD_SPECS,
    ancestorKeys,
    isCovered,
    resolveSelection,
    mapType,
    isSkipped,
    childSpecs,
    attributesFor,
    buildProject
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Azure;
})(typeof globalThis !== 'undefined' ? globalThis : this);
