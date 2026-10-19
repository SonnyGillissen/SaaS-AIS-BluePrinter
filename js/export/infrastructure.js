(function (root) {
  'use strict';
  const A = root.AISBP = root.AISBP || {};
  const SCHEMA = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#';
  const PARAM_SCHEMA = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#';
  // Deliberately pinned stable APIs, not the inventory API-version table.
  const TYPES = {
    'logic-app-consumption': ['Microsoft.Logic/workflows', '2019-05-01'],
    'logic-app-standard': ['Microsoft.Web/sites', '2023-12-01'],
    'api-management': ['Microsoft.ApiManagement/service', '2024-05-01'],
    'service-bus-namespace': ['Microsoft.ServiceBus/namespaces', '2021-11-01'],
    'service-bus-queue': ['Microsoft.ServiceBus/namespaces/queues', '2021-11-01', 'service-bus-namespace'],
    'service-bus-topic': ['Microsoft.ServiceBus/namespaces/topics', '2021-11-01', 'service-bus-namespace'],
    'service-bus-subscription': ['Microsoft.ServiceBus/namespaces/topics/subscriptions', '2021-11-01', 'service-bus-topic'],
    'storage-account': ['Microsoft.Storage/storageAccounts', '2023-05-01'],
    'virtual-network': ['Microsoft.Network/virtualNetworks', '2023-11-01'],
    subnet: ['Microsoft.Network/virtualNetworks/subnets', '2023-11-01', 'virtual-network'],
    nsg: ['Microsoft.Network/networkSecurityGroups', '2023-11-01'],
    'log-analytics': ['Microsoft.OperationalInsights/workspaces', '2022-10-01']
  };
  const API_REFERENCES = Object.entries(TYPES).map(([type, spec]) => {
    const parts = spec[0].toLowerCase().split('/');
    return type + ': ' + spec[1] + ' — https://learn.microsoft.com/en-us/azure/templates/' + parts[0] + '/' + spec[1] + '/' + parts.slice(1).join('/');
  }).join('\n');
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const present = (v) => v !== undefined && v !== null && v !== '';
  const json = (v) => JSON.stringify(v, null, 2) + '\n';
  const sensitive = /password|secret|credential|connection.?string|account.?key|access.?key|sas.?token|authorization|client.?secret/i;
  const credentialValue = /(?:AccountKey|SharedAccessKey|SharedAccessSignature|Password|ClientSecret)\s*=|(?:^|\s)Bearer\s+\S+|[?&]sig=[^&\s]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|^(?:gh[pousr]_|github_pat_)[a-zA-Z0-9_]+$|^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/i;
  function ipVersion(value) {
    if (typeof value !== 'string') return 0;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value.split('.').every((x) => Number(x) <= 255)) return 4;
    const halves = value.split('::');
    const groups = halves.flatMap((x) => x ? x.split(':') : []);
    if (halves.length <= 2 && groups.every((x) => /^[0-9a-f]{1,4}$/i.test(x)) && (halves.length === 2 ? groups.length < 8 : groups.length === 8)) return 6;
    return 0;
  }
  function cidr(value) {
    const parts = value.split('/');
    const version = ipVersion(parts[0]);
    return parts.length === 2 && version && /^\d{1,3}$/.test(parts[1]) && Number(parts[1]) <= (version === 4 ? 32 : 128);
  }
  const literal = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => '\\u{' + c.charCodeAt(0).toString(16) + '}').replace(/\$\{/g, '\\${') + "'";
  function bicep(v, indent) {
    indent = indent || '';
    if (typeof v === 'string') return literal(v);
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    const next = indent + '  ';
    if (Array.isArray(v)) return v.length ? '[\n' + v.map((x) => next + bicep(x, next)).join('\n') + '\n' + indent + ']' : '[]';
    const keys = Object.keys(v);
    return keys.length ? '{\n' + keys.map((k) => next + (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : literal(k)) + ': ' + bicep(v[k], next)).join('\n') + '\n' + indent + '}' : '{}';
  }
  function exportProject(project, format, options) {
    if (format !== 'arm' && format !== 'bicep') throw new Error('Infrastructure format must be arm or bicep.');
    if (!project || !object(project.nodes)) throw new Error('A project is required.');
    const warnings = [];
    const files = [];
    const base = String(options && options.baseName || 'infrastructure').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'infrastructure';
    const nodes = Object.values(project.nodes).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const ids = new Map(), symbols = new Set();
    nodes.forEach((n) => {
      let hash = 2166136261;
      for (const c of String(n.id)) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
      const baseSymbol = 'r' + String(hash).padStart(10, '0');
      let symbol = baseSymbol, collision = 0;
      while (symbols.has(symbol)) symbol = baseSymbol + 'c' + (++collision);
      symbols.add(symbol); ids.set(n.id, symbol);
    });
    const nameOf = (n) => A.Naming ? A.Naming.resolveName(project, n) : n.name;
    const warn = (n, text) => {
      const name = [nameOf(n), n.label].find((value) =>
        typeof value === 'string' && value.trim() && !credentialValue.test(value));
      const fallback = A.Catalog.get(n.type);
      warnings.push((name || (fallback && fallback.label) || 'Unnamed resource') + ': ' + text);
    };
    const ancestor = (n, type) => {
      const seen = new Set();
      while (n && !seen.has(n.id)) {
        if (n.type === type) return n;
        seen.add(n.id);
        n = project.nodes[n.parentId];
      }
      return null;
    };
    const groups = nodes.filter((n) => n.type === 'resource-group');
    const scope = [];
    if (Object.keys(project.connections || {}).length) warnings.push('Diagram connections are not deployment dependencies, permissions, role assignments or network rules; all are ignored.');
    nodes.forEach((n) => {
      if (TYPES[n.type] && !ancestor(n, 'resource-group')) warn(n, 'Skipped: resource has no resource-group scope.');
      else if (n.type === 'logic-app-workflow') warn(n, 'Standard workflow application content must be deployed separately to its Logic App Standard host (workflow.json and connections/runtime configuration); it is not an independently deployable ARM child resource.');
      else if (!TYPES[n.type] && !['azure-tenant', 'management-group', 'subscription', 'resource-group'].includes(n.type)) warn(n, 'Skipped: unsupported resource or diagram-only object.');
    });
    groups.forEach((rg, gi) => {
      const stem = base + '-rg' + String(gi + 1).padStart(3, '0');
      const parameters = {};
      const values = {};
      const resources = [];
      const emitted = new Map();
      const records = [];
      const param = (n, key, type, value) => {
        const id = ids.get(n.id) + '_' + key;
        parameters[id] = { type };
        if (value !== undefined) values[id] = { value };
        else warn(n, 'Required parameter ' + id + ' has no value; supply it before deployment.');
        return { arm: "[parameters('" + id + "')]", bicep: id };
      };
      const tagsOf = (n) => {
        const out = {};
        (Array.isArray(n.tags) ? n.tags : []).forEach((t) => {
          if (t && typeof t.key === 'string' && !sensitive.test(t.key) && typeof t.value === 'string' && !credentialValue.test(t.value)) {
            Object.defineProperty(out, t.key, { value: t.value, enumerable: true, configurable: true });
          } else warn(n, 'A sensitive or invalid tag was omitted.');
        });
        return out;
      };
      const chosen = nodes.filter((n) => TYPES[n.type] && ancestor(n, 'resource-group') === rg);
      const visiting = new Set();
      const emit = (n) => {
        if (emitted.has(n.id)) return emitted.get(n.id);
        if (visiting.has(n.id)) { warn(n, 'Skipped: cyclic resource hierarchy.'); return null; }
        visiting.add(n.id);
        const spec = TYPES[n.type], attrs = n.attributes || {};
        const parent = project.nodes[n.parentId];
        let parentResult;
        if (spec[2]) {
          if (!parent || parent.type !== spec[2] || !(parentResult = emit(parent))) {
            warn(n, 'Skipped: required deployable parent ' + spec[2] + ' is missing.');
            emitted.set(n.id, null);
            return null;
          }
        } else if (n.parentId !== rg.id) {
          warn(n, 'Skipped: top-level resource is not directly inside its resource group.');
          emitted.set(n.id, null);
          return null;
        }
        if (n.type === 'service-bus-topic' && parent && (parent.attributes || {}).sku === 'Basic') {
          warn(n, 'Skipped: Basic Service Bus does not support topics.');
          emitted.set(n.id, null);
          return null;
        }
        if (n.type === 'nsg' && present(attrs.rules)) {
          warn(n, 'Skipped: free-text NSG rules cannot be deployed safely. Structured security-rule export is unsupported.');
          emitted.set(n.id, null);
          return null;
        }
        if (n.type === 'storage-account' && ((present(attrs.kind) && attrs.kind !== 'StorageV2') || (present(attrs.performance) && attrs.performance !== 'Standard'))) {
          warn(n, 'Skipped: first release supports only Standard StorageV2 storage accounts.');
          emitted.set(n.id, null);
          return null;
        }
        const used = new Set(['location', 'description']);
        const properties = {};
        const propertyParameters = [];
        const propertyParam = (key, type, value) => {
          const ref = param(n, key, type, value);
          propertyParameters.push({ key, ref });
        };
        let validProperties = true;
        const use = (key) => { used.add(key); return attrs[key]; };
        const str = (key, target) => {
          const v = use(key);
          if (present(v)) {
            if (typeof v === 'string' && !v.startsWith('[') && !credentialValue.test(v)) properties[target || key] = v;
            else { validProperties = false; warn(n, key + ' is invalid, sensitive or an unresolved expression; correct the properties parameter.'); }
          }
        };
        const bool = (key, target, fallback) => {
          const v = use(key);
          if (!present(v)) {
            if (fallback !== undefined) { properties[target || key] = fallback; warn(n, key + ' was not specified; secure baseline ' + fallback + ' is used.'); }
          } else if (v === true || v === false || v === 'true' || v === 'false') properties[target || key] = v === true || v === 'true';
          else { validProperties = false; warn(n, key + ' is not a boolean; correct the properties parameter.'); }
        };
        const integer = (key, target, min, max) => {
          const v = use(key);
          if (!present(v)) return;
          if (/^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v)) && Number(v) >= min && Number(v) <= max) properties[target || key] = Number(v);
          else { warn(n, key + ' is invalid; configuration requires manual correction.'); validProperties = false; }
        };
        const list = (key) => {
          const v = use(key);
          return typeof v === 'string' ? v.split(/[,;\s]+/).filter(Boolean) : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : [];
        };
        const network = () => {
          const v = use('publicNetworkAccess');
          properties.publicNetworkAccess = v === 'Enabled' || v === 'Disabled' ? v : 'Disabled';
          if (v !== 'Disabled') warn(n, v === 'Enabled' ? 'Public network access is enabled; review exposure.' : 'Network ACLs are unsupported; public access defaults to Disabled, not Selected networks.');
        };
        const tls = (storage) => {
          const v = use('minimumTlsVersion');
          if (v !== '1.2') warn(n, 'Only TLS 1.2 is supported here; secure TLS 1.2 baseline replaces the missing or incompatible setting.');
          properties.minimumTlsVersion = storage ? 'TLS1_2' : '1.2';
        };
        let sku, kind;
        if (n.type === 'logic-app-consumption') {
          const state = use('state');
          if (state === 'Enabled' || state === 'Disabled') properties.state = state;
          else if (present(state)) { validProperties = false; warn(n, 'Invalid workflow state; correct the properties parameter.'); }
          propertyParam('definition', 'secureObject');
          warn(n, 'Supply the complete workflow definition in the required secure definition parameter; trigger labels are not executable definitions. Configure API connections, workflow parameters and integration accounts separately.');
        } else if (n.type === 'logic-app-standard') {
          kind = 'functionapp,workflowapp';
          const plan = use('appServicePlan');
          const planId = typeof plan === 'string' && /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourceGroups\/[^/]+\/providers\/Microsoft\.Web\/serverfarms\/[^/]+$/i.test(plan) && !credentialValue.test(plan) ? plan : undefined;
          propertyParam('serverFarmId', 'string', planId);
          propertyParam('siteConfig', 'secureObject');
          properties.httpsOnly = true;
          network();
          used.add('sku'); used.add('runtime'); used.add('storageAccount');
          warn(n, 'Supply an existing Workflow Standard App Service plan resource ID and secure siteConfig with appSettings for the workflow runtime and storage. Plan/storage resources, credentials and workflow application content are not synthesized. Configure TLS 1.2 or newer in siteConfig.');
          if (present(attrs.vnetIntegration) && attrs.vnetIntegration !== false && attrs.vnetIntegration !== 'false') {
            validProperties = false; warn(n, 'VNet integration requires explicit subnet configuration in the properties parameter.');
          }
        } else if (n.type === 'api-management') {
          const tier = use('sku'), capacity = use('capacity');
          const tiers = ['Consumption', 'Developer', 'Basic', 'Standard', 'Premium', 'Basic v2', 'Standard v2', 'Premium v2'];
          if (tiers.includes(tier)) {
            if (tier === 'Consumption') {
              sku = { name: tier, capacity: 0 };
              if (present(capacity) && Number(capacity) !== 0) warn(n, 'Consumption API Management requires capacity 0; the diagram unit count is not applicable.');
            }
            else if (/^\d+$/.test(String(capacity)) && Number.isSafeInteger(Number(capacity)) && Number(capacity) >= 1 && (tier !== 'Developer' || Number(capacity) === 1)) sku = { name: tier.replace(' v2', 'V2'), capacity: Number(capacity) };
          }
          ['publisherName', 'publisherEmail'].forEach((key) => {
            const v = use(key);
            const valid = typeof v === 'string' && v.trim() && !v.startsWith('[') && !credentialValue.test(v) && (key !== 'publisherEmail' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
            propertyParam(key, 'string', valid ? v : undefined);
          });
          const mode = use('vnetMode');
          if (!present(mode) || mode === 'None') properties.virtualNetworkType = 'None';
          else { validProperties = false; warn(n, 'API Management networking requires explicit configuration in the properties parameter; no public fallback is supplied.'); }
          warn(n, 'API Management exports the service only; APIs, policies, products, custom domains, zones and gateways require separate configuration. Validate tier capacity and regional availability before deployment.');
        } else if (n.type === 'service-bus-namespace') {
          const tier = use('sku'), capacity = use('capacity');
          if (['Basic', 'Standard', 'Premium'].includes(tier)) {
            sku = { name: tier, tier };
            if (tier === 'Premium') {
              if ([1, 2, 4, 8, 16].includes(Number(capacity))) sku.capacity = Number(capacity);
              else { sku = undefined; warn(n, 'Premium requires an explicit supported messaging-unit capacity.'); }
            } else if (present(capacity)) warn(n, 'Capacity is ignored for non-Premium Service Bus.');
          }
          bool('disableLocalAuth', null, true); bool('zoneRedundant');
          if (properties.disableLocalAuth === false) warn(n, 'Local SAS authentication remains enabled.');
          if (properties.zoneRedundant && tier !== 'Premium') {
            validProperties = false; warn(n, 'Zone redundancy requires Premium; correct the properties parameter.');
          }
          tls(false); network();
        } else if (n.type.startsWith('service-bus-')) {
          const isTopic = n.type === 'service-bus-topic';
          if (n.type !== 'service-bus-subscription') {
            const size = use('maxSizeGB');
            if (present(size)) {
              if ([1, 2, 3, 4, 5, 80].includes(Number(size))) properties.maxSizeInMegabytes = Number(size) * 1024;
              else { validProperties = false; warn(n, 'Invalid Service Bus maxSizeGB.'); }
            }
            bool('duplicateDetection', 'requiresDuplicateDetection');
            str('defaultMessageTimeToLive');
          }
          if (isTopic) bool('supportOrdering');
          else {
            integer('maxDeliveryCount', null, 1, 2147483647);
            bool('requiresSession'); str('forwardTo');
            if (n.type === 'service-bus-queue') { str('lockDuration'); bool('deadLetteringOnExpiration', 'deadLetteringOnMessageExpiration'); }
          }
          const ns = ancestor(n, 'service-bus-namespace');
          if (properties.maxSizeInMegabytes === 81920 && (!ns || (ns.attributes || {}).sku !== 'Premium')) {
            validProperties = false; warn(n, '80 GB Service Bus entities require Premium in this exporter; partitioning is unsupported.');
          }
          if (properties.lockDuration) {
            const duration = /^PT(?:(\d+)M)?(?:(\d+)S)?$/.exec(properties.lockDuration);
            const seconds = duration && (Number(duration[1] || 0) * 60 + Number(duration[2] || 0));
            if (!duration || seconds < 5 || seconds > 300) { validProperties = false; warn(n, 'Unsupported Service Bus lock duration; use an ISO 8601 duration from five seconds to five minutes.'); }
          }
          if (ns && (ns.attributes || {}).sku === 'Basic' && (properties.requiresSession || properties.requiresDuplicateDetection)) {
            validProperties = false; warn(n, 'Basic Service Bus does not support sessions or duplicate detection.');
          }
          if (properties.forwardTo) warn(n, 'Forwarding target is a name only; its existence/order is not inferred from diagram edges.');
        } else if (n.type === 'storage-account') {
          kind = use('kind');
          const performance = use('performance'), replication = use('replication');
          if (performance === 'Standard' && ['LRS', 'ZRS', 'GRS', 'GZRS', 'RA-GRS', 'RA-GZRS'].includes(replication)) sku = { name: performance + '_' + replication.replace(/-/g, '') };
          str('accessTier'); bool('hierarchicalNamespace', 'isHnsEnabled'); bool('sftp', 'isSftpEnabled');
          if (properties.accessTier && !['Hot', 'Cool', 'Cold'].includes(properties.accessTier)) { validProperties = false; warn(n, 'Invalid storage access tier.'); }
          bool('allowSharedKeyAccess', null, false);
          properties.supportsHttpsTrafficOnly = true; properties.allowBlobPublicAccess = false;
          warn(n, 'Secure baseline enforces HTTPS and disables anonymous blob access; review application compatibility.');
          if (properties.allowSharedKeyAccess) warn(n, 'Shared-key authentication remains enabled.');
          if (properties.isSftpEnabled && !properties.isHnsEnabled) { validProperties = false; warn(n, 'SFTP requires hierarchical namespace.'); }
          tls(true); network();
        } else if (n.type === 'virtual-network') {
          const prefixes = list('addressSpace');
          if (prefixes.length && prefixes.every(cidr)) properties.addressSpace = { addressPrefixes: prefixes };
          else { validProperties = false; warn(n, 'Valid IPv4/IPv6 VNet address space is required; no CIDR was invented.'); }
          const dns = list('dnsServers');
          if (dns.length && dns.every(ipVersion)) properties.dhcpOptions = { dnsServers: dns };
          else if (present(attrs.dnsServers)) { validProperties = false; warn(n, 'Invalid custom DNS server list.'); }
          warn(n, 'The VNet address space and declared subnets are authoritative. Review what-if: unmanaged existing subnets/peerings must not be removed inadvertently. Only declared subnets are retained; the diagram must inventory every existing subnet before updating an existing VNet.');
        } else if (n.type === 'subnet') {
          const prefixes = list('addressPrefix');
          if (!prefixes.length || !prefixes.every(cidr)) { validProperties = false; warn(n, 'Valid IPv4/IPv6 subnet address prefix is required; no CIDR was invented.'); }
          else if (prefixes.length === 1) properties.addressPrefix = prefixes[0];
          else properties.addressPrefixes = prefixes;
          const delegation = use('delegation');
          if (present(delegation) && delegation !== 'None') {
            if (['Microsoft.Web/serverFarms', 'Microsoft.App/environments', 'Microsoft.ContainerInstance/containerGroups', 'Microsoft.Sql/managedInstances', 'Microsoft.ApiManagement/service'].includes(delegation)) properties.delegations = [{ name: 'delegation', properties: { serviceName: delegation } }];
            else { validProperties = false; warn(n, 'Unsupported subnet delegation.'); }
          }
          if (present(attrs.nsg) || present(attrs.routeTable)) {
            validProperties = false; warn(n, 'Subnet NSG/route-table associations are unsupported; supply the full properties parameter explicitly rather than silently losing security associations.');
          }
        } else if (n.type === 'nsg') {
          used.add('rules'); properties.securityRules = [];
          warn(n, 'Only an NSG with no custom rules is exported. Azure default NSG rules still apply; this is not deny-all.');
        } else if (n.type === 'log-analytics') {
          const tier = use('sku');
          if (tier === 'PerGB2018') properties.sku = { name: tier };
          else { validProperties = false; warn(n, 'Only PerGB2018 workspace SKU is supported; capacity reservation requires explicit configuration.'); }
          integer('retentionDays', 'retentionInDays', 30, 730);
        }
        Object.keys(attrs).forEach((key) => {
          if (!used.has(key) && present(attrs[key]) && attrs[key] !== false && attrs[key] !== 'false' && attrs[key] !== 'None') warn(n, 'An unsupported setting was ignored (' + (sensitive.test(key) ? 'sensitive attribute' : key) + '). Private endpoints, identity, diagnostics, ACLs and advanced settings are not synthesized.');
        });
        if ((n.network || []).length) warn(n, 'Network links are diagram-only; private endpoints, subnet associations and ACLs are not generated.');
        if ((n.custom || []).length) warn(n, 'Custom properties are not exported, including preserved ARM expressions; review before deployment.');
        const symbol = ids.get(n.id);
        const rawName = nameOf(n);
        const rule = A.Catalog.get(n.type).rule;
        const nameProblems = A.Naming.validateName(rawName, rule);
        if (nameProblems.length) warn(n, 'Resource name fails catalog naming restrictions: ' + nameProblems.map((p) => p.startsWith('Invalid characters:') ? 'Invalid characters.' : p).join(' ') + ' Supply a valid name parameter; Azure availability/reserved-name checks are still required.');
        const pn = param(n, 'name', 'string', !nameProblems.length && typeof rawName === 'string' && rawName.trim() && !rawName.startsWith('[') && !credentialValue.test(rawName) ? rawName : undefined);
        const props = param(n, 'properties', 'object', validProperties ? properties : undefined);
        const res = { type: spec[0], apiVersion: spec[1], name: pn.arm };
        const lines = [];
        let armNames = [pn.arm.slice(1, -1)];
        if (parentResult) {
          armNames = parentResult.armNames.concat(armNames);
          res.name = '[concat(' + armNames.join(", '/', ") + ')]';
          res.dependsOn = ["[resourceId('" + TYPES[parent.type][0] + "', " + parentResult.armNames.join(', ') + ')]'];
          lines.push('  parent: ' + parentResult.symbol);
        }
        lines.push('  name: ' + pn.bicep);
        if (!spec[2]) {
          const loc = A.Model.effectiveLocation(project, n.id);
          const pl = param(n, 'location', 'string', typeof loc === 'string' && loc && !loc.startsWith('[') && !credentialValue.test(loc) ? loc : undefined);
          const pt = param(n, 'tags', 'object', tagsOf(n));
          res.location = pl.arm; res.tags = pt.arm;
          lines.push('  location: ' + pl.bicep, '  tags: ' + pt.bicep);
        } else if ((n.tags || []).length) warn(n, 'Child-resource tags are unsupported and were ignored.');
        if (n.type === 'service-bus-namespace' || n.type === 'storage-account' || n.type === 'api-management') {
          const ps = param(n, 'sku', 'object', sku);
          res.sku = ps.arm; lines.push('  sku: ' + ps.bicep);
        }
        if (n.type === 'storage-account' || n.type === 'logic-app-standard') {
          const pk = param(n, 'kind', 'string', kind || undefined);
          res.kind = pk.arm; lines.push('  kind: ' + pk.bicep);
        }
        res.properties = props.arm; lines.push('  properties: ' + props.bicep);
        if (propertyParameters.length) {
          res.properties = '[union(' + props.arm.slice(1, -1) + ', createObject(' + propertyParameters.map(({ key, ref }) => "'" + key + "', " + ref.arm.slice(1, -1)).join(', ') + '))]';
          lines[lines.length - 1] = '  properties: union(' + props.bicep + ', {\n' + propertyParameters.map(({ key, ref }) => '    ' + key + ': ' + ref.bicep).join('\n') + '\n  })';
        }
        const result = { symbol, armNames, n, res, lines, pn, props, spec };
        records.push(result);
        emitted.set(n.id, result);
        visiting.delete(n.id);
        return result;
      };
      chosen.forEach(emit);
      // Inline subnet PUTs avoid parent VNet updates deleting the declared subnets,
      // and avoid concurrent standalone subnet PUTs racing on the same VNet.
      records.filter((r) => r.n.type === 'virtual-network').forEach((vnet) => {
        const subnets = records.filter((r) => r.n.type === 'subnet' && r.n.parentId === vnet.n.id);
        const armSubnets = subnets.map((s) => "createObject('name', " + s.pn.arm.slice(1, -1) + ", 'properties', " + s.props.arm.slice(1, -1) + ')');
        const array = armSubnets.length ? 'createArray(' + armSubnets.join(', ') + ')' : "json('[]')";
        vnet.res.properties = '[union(' + vnet.props.arm.slice(1, -1) + ", createObject('subnets', " + array + '))]';
        vnet.lines[vnet.lines.length - 1] = '  properties: union(' + vnet.props.bicep + ', {\n    subnets: [\n' + subnets.map((s) => '      {\n        name: ' + s.pn.bicep + '\n        properties: ' + s.props.bicep + '\n      }').join('\n') + '\n    ]\n  })';
      });
      const standalone = records.filter((r) => r.n.type !== 'subnet');
      standalone.forEach((r) => resources.push(r.res));
      if (!resources.length) warn(rg, 'Empty deployment: no supported deployable resources remain in this resource group. The empty files are scope placeholders only; do not deploy them.');
      const bResources = standalone.map((r) => 'resource ' + r.symbol + ' ' + literal(r.spec[0] + '@' + r.spec[1]) + ' = {\n' + r.lines.join('\n') + '\n}');
      const deploymentName = stem + (format === 'arm' ? '.json' : '.bicep');
      if (format === 'arm') files.push({ name: deploymentName, content: json({ $schema: SCHEMA, contentVersion: '1.0.0.0', parameters, resources }), mime: 'application/json' });
      else {
        const declarations = Object.entries(parameters).map(([k, v]) => v.type === 'secureObject' ? '@secure()\nparam ' + k + ' object' : 'param ' + k + ' ' + v.type);
        files.push({ name: deploymentName, content: "targetScope = 'resourceGroup'\n\n" + declarations.join('\n') + '\n\n' + bResources.join('\n\n') + '\n', mime: 'text/plain' });
        files.push({ name: stem + '.bicepparam', content: 'using ' + literal('./' + deploymentName) + '\n\n' + Object.entries(values).map(([k, v]) => 'param ' + k + ' = ' + bicep(v.value)).join('\n\n') + '\n', mime: 'text/plain' });
      }
      // Parameter files do not evaluate expressions. Unlike template literals, their [
      // must NOT be doubled (also matches the Bicep parameter compiler's output).
      files.push({ name: stem + '.parameters.json', content: json({ $schema: PARAM_SCHEMA, contentVersion: '1.0.0.0', parameters: values }), mime: 'application/json' });
      const sub = ancestor(rg, 'subscription');
      const scopeName = (n) => {
        if (!n) return null;
        const value = nameOf(n);
        if (typeof value === 'string' && !credentialValue.test(value)) return value;
        warn(n, 'Sensitive or invalid suggested scope name omitted.');
        return null;
      };
      const rawSubscriptionId = sub && sub.attributes && sub.attributes.subscriptionId;
      const subscriptionId = typeof rawSubscriptionId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawSubscriptionId) ? rawSubscriptionId : null;
      scope.push({ template: deploymentName, parameters: stem + '.parameters.json', resourceGroup: scopeName(rg), subscription: scopeName(sub), subscriptionId, resourceCount: resources.length });
      if (!subscriptionId) warn(rg, 'Scope subscription ID is unknown or invalid; set Subscription ID on the subscription container or select the actual target using --subscription <subscription-id>. A display name is not a subscription ID.');
      if (!sub) warn(rg, 'No subscription boundary; select the target subscription explicitly.');
      if (Object.keys(rg.attributes || {}).some((k) => !['location', 'description', 'lock'].includes(k)) || present((rg.attributes || {}).lock) && rg.attributes.lock !== 'None' || (rg.tags || []).length) warn(rg, 'Resource-group settings/tags/locks are not deployed; groups must already exist.');
    });
    if (!groups.length) warnings.push('No resource groups were found; no deployment templates were generated.');
    files.push({ name: base + '.deployment-scopes.json', content: json({ format: 'aisbp-deployment-scopes', version: 1, deployments: scope }), mime: 'application/json' });
    files.push({ name: base + '.instructions.txt', content: 'Review all warnings and parameter values before deployment. This is a limited first-release export, not a full-fidelity blueprint backup.\nEach template is an independent resource-group-scoped deployment. Resource groups and subscriptions are NOT created. The separate deployment-scopes.json records suggested diagram boundaries, not executable ARM metadata. Select the correct existing subscription and resource group for EACH file; edit parameter values for the target environment. Deployment scope is selected by the deployment command, not by a resource-name parameter.\nARM: az deployment group create --subscription <subscription-id> --resource-group <existing-rg> --template-file <template.json> --parameters @<template.parameters.json>\nBicep: az deployment group create --subscription <subscription-id> --resource-group <existing-rg> --template-file <template.bicep> --parameters @<template.parameters.json>\nAlternatively use --parameters <template.bicepparam> with a recent Azure CLI/Bicep version. JSON parameters and .bicepparam are alternatives, not inputs to combine.\nAll template parameters are required. Missing values are intentionally absent from parameter files: supply them yourself; no placeholder credentials or invented required settings are provided. Use incremental mode and review Azure what-if before deployment. Do not use complete mode. Region, SKU availability, naming, CIDRs, policies and application compatibility need Azure validation. Parent ordering is emitted, but no permissions, role assignments or security links are inferred. Private endpoints, identities, diagnostic settings and advanced networking are unsupported.\n', mime: 'text/plain' });
    const instructions = files.find((file) => file.name === base + '.instructions.txt');
    instructions.content += '\nPinned API coverage and canonical Microsoft Learn references\nThese intentional first-release API pins are not a claim of Microsoft certification, exhaustive resource coverage, or complete standards compliance. Local compilation/tests do not replace Azure what-if, tenant-policy checks or deployment validation. Review these version-specific references manually when network access is available.\n' + API_REFERENCES + '\nCoverage limits: Standard StorageV2 only; NSGs without custom rules only; PerGB2018 workspaces only. VNet subnets are inline. Service Bus support covers namespaces, queues, topics and subscriptions, not subscription rules or authorization rules. Private endpoints, identities, diagnostics, advanced networking, direct Bicep import and Terraform are not supported.\nARM expressions: https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/template-expressions\nARM parameter files: https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/parameter-files\nBicep child resources: https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/child-resource-name-type\n';
    instructions.content += '\nExport warnings\n' + (warnings.length ? warnings.map((warning) => '- ' + warning).join('\n') : 'No export warnings.') + '\n';
    instructions.content += '\nIntegration services: Consumption Logic Apps require a complete secure definition parameter. Standard Logic Apps require an existing compatible plan resource ID and secure siteConfig containing runtime/storage appSettings; workflow files and connections must be deployed separately. API Management exports the service only and requires publisher details. Supply secure parameters through a protected deployment process; do not commit credentials in parameter files. Subscription-ID warnings describe deployment scope, not failed template generation.\n';
    return { files, warnings };
  }

  function isTemplate(value) {
    return object(value) && (Array.isArray(value.resources) || object(value.resources)) && typeof value.$schema === 'string' && /\/deploymentTemplate\.json#?$/i.test(value.$schema);
  }

  function importTemplate(template, supplied) {
    if (!isTemplate(template)) throw new Error('Expected an ARM deployment template object.');
    const warnings = [];
    const warningSet = new Set();
    const warn = (text) => { if (!warningSet.has(text)) { warningSet.add(text); warnings.push(text); } };
    const defs = object(template.parameters) ? template.parameters : {};
    const overrides = object(supplied) && object(supplied.parameters) ? supplied.parameters : object(supplied) ? supplied : {};
    const vars = object(template.variables) ? template.variables : {};
    const resolving = new Set();
    const unresolved = new Map();
    let operations = 0;
    const failure = () => { throw new Error('Unresolved expression'); };
    const resolveRef = (kind, name, depth) => {
      const key = kind + ':' + name;
      if (typeof name !== 'string' || resolving.has(key) || depth > 50 || sensitive.test(name)) return failure();
      resolving.add(key);
      try {
        if (kind === 'variables') {
          if (!own(vars, name)) return failure();
          return resolve(vars[name], depth + 1, true);
        }
        if (!own(defs, name) || /^secure/i.test(defs[name].type || '')) return failure();
        if (own(overrides, name)) {
          const entry = overrides[name];
          if (!object(entry) || !own(entry, 'value')) return failure();
          // Deployment parameter values are literals, never executable template expressions.
          return entry.value;
        }
        if (own(defs[name], 'defaultValue')) return resolve(defs[name].defaultValue, depth + 1, true);
        warn('Required parameter ' + name + ' has no value; references are preserved unresolved.');
        return failure();
      } finally { resolving.delete(key); }
    };
    function expression(text, depth) {
      let pos = 0;
      const ws = () => { while (/\s/.test(text[pos] || '') && pos < text.length) pos++; };
      const parse = () => {
        if (++operations > 100000 || depth > 50) return failure();
        ws();
        let value;
        if (text[pos] === "'") {
          pos++; value = ''; let closed = false;
          while (pos < text.length) {
            if (text[pos] === "'") {
              pos++;
              if (text[pos] === "'") { value += "'"; pos++; }
              else { closed = true; break; }
            } else value += text[pos++];
          }
          if (!closed) return failure();
        } else {
          const number = /^-?\d+(?:\.\d+)?/.exec(text.slice(pos));
          if (number) { value = Number(number[0]); pos += number[0].length; }
          else {
            const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(pos));
            if (!match) return failure();
            const fn = match[0].toLowerCase(); pos += match[0].length; ws();
            if (text[pos++] !== '(') return failure();
            const args = []; ws();
            if (text[pos] !== ')') {
              do { args.push(parse()); ws(); if (text[pos] !== ',') break; pos++; } while (true);
            }
            if (text[pos++] !== ')') return failure();
            if ((fn === 'parameters' || fn === 'variables') && args.length === 1) value = resolveRef(fn, args[0], depth + 1);
            else if (fn === 'concat' && args.length && args.every((x) => typeof x === 'string')) value = args.join('');
            else if (fn === 'createobject' && args.length % 2 === 0 && args.every((x, i) => i % 2 || typeof x === 'string')) {
              value = Object.fromEntries(args.reduce((pairs, x, i) => i % 2 ? pairs : pairs.concat([[x, args[i + 1]]]), []));
            } else if (fn === 'createarray') value = args;
            else if (fn === 'json' && args.length === 1 && args[0] === '[]') value = [];
            else if (fn === 'union' && args.length >= 2 && args.every(object)) {
              const merge = (left, right, level) => {
                if (level > 50) return failure();
                return Object.fromEntries(Array.from(new Set(Object.keys(left).concat(Object.keys(right))), (k) => [
                  k, !own(right, k) ? left[k] : object(left[k]) && object(right[k]) ? merge(left[k], right[k], level + 1) : right[k]
                ]));
              };
              value = args.reduce((out, x) => merge(out, x, 0), {});
            }
            else if (fn === 'format' && typeof args[0] === 'string' && !/[{}]/.test(args[0].replace(/\{\d+\}/g, ''))) {
              value = args[0].replace(/\{(\d+)\}/g, (_, i) => {
                if (!own(args, Number(i) + 1) || !['string', 'number', 'boolean'].includes(typeof args[Number(i) + 1])) return failure();
                return String(args[Number(i) + 1]);
              });
            } else if (fn === 'tolower' && args.length === 1 && typeof args[0] === 'string') value = args[0].toLowerCase();
            else if (fn === 'toupper' && args.length === 1 && typeof args[0] === 'string') value = args[0].toUpperCase();
            else if (fn === 'true' && !args.length) value = true;
            else if (fn === 'false' && !args.length) value = false;
            else return failure();
          }
        }
        ws();
        while (text[pos] === '.' || text[pos] === '[') {
          let key;
          if (text[pos++] === '.') {
            const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(pos));
            if (!m) return failure();
            key = m[0]; pos += key.length;
          } else { key = parse(); ws(); if (text[pos++] !== ']') return failure(); }
          if ((!object(value) && !Array.isArray(value)) || !own(value, key)) return failure();
          value = value[key]; ws();
        }
        return value;
      };
      const result = parse(); ws();
      if (pos !== text.length) return failure();
      return result;
    }
    function resolve(v, depth, strict, path) {
      depth = depth || 0; path = path || '';
      if (depth > 60 || ++operations > 100000) {
        if (strict) return failure();
        warn('Template resolution limit reached; some values remain unresolved.');
        return v;
      }
      if (typeof v === 'string') {
        if (v.startsWith('[[')) return v.slice(1);
        if (v.startsWith('[') && v.endsWith(']')) {
          try { return expression(v.slice(1, -1), depth + 1); }
          catch (_) {
            if (strict) return failure();
            unresolved.set(path, v);
            warn('Unsupported, missing, secure or cyclic ARM expression preserved without execution.');
          }
        }
        return v;
      }
      if (Array.isArray(v)) return v.map((x, i) => resolve(x, depth + 1, strict, path + '/' + i));
      if (object(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x, depth + 1, strict, path + '/' + k)]));
      return v;
    }
    const project = A.Model.createProject({ name: 'Imported ARM template' });
    const subscription = A.Model.addNode(project, 'subscription', null, { nameMode: 'custom', name: 'Deployment subscription', label: 'Deployment subscription' });
    const rg = A.Model.addNode(project, 'resource-group', subscription.id, { nameMode: 'custom', name: 'Imported resource group', label: 'Imported resource group' });
    rg.attributes = {};
    warn('Deployment subscription/resource-group scope is not encoded in a resource-group template; select the actual existing boundaries before export.');
    const flat = [];
    function flatten(resources, parent, level, alreadyResolved) {
      if (level > 50) { warn('Nested-resource depth limit reached.'); return; }
      if (!Array.isArray(resources)) { warn('Symbolic-name/object resource collections are unsupported and were skipped.'); return; }
      resources.forEach((raw, i) => {
        if (!object(raw)) { warn('Invalid resource entry skipped.'); return; }
        if (raw.scope || raw.subscriptionId || raw.resourceGroup) {
          warn('Explicit resource-level/cross-subscription scope is unsupported; resource was skipped rather than moved into a different resource group.');
          return;
        }
        if (own(raw, 'copy')) { warn('Resource copy loops are unsupported and were skipped.'); return; }
        if (own(raw, 'condition') && raw.condition !== true) { warn('Conditional resources are unsupported and were skipped.'); return; }
        const type = typeof raw.type === 'string' ? (parent && !raw.type.includes('.') ? parent.type + '/' + raw.type : raw.type) : '';
        if (type.toLowerCase() === 'microsoft.resources/deployments') {
          warn(raw.properties && raw.properties.templateLink ? 'Linked deployments are unsupported and were skipped; no remote content is fetched.' : 'Nested deployments are unsupported and were skipped; deployment scopes and parameter evaluation are not guessed.');
          return;
        }
        const path = (parent ? parent.path : '') + '/resources/' + i;
        const before = new Set(unresolved.keys());
        const r = alreadyResolved ? raw : resolve(Object.fromEntries(Object.entries(raw).filter(([k]) => !['resources', 'dependsOn', 'outputs', 'metadata'].includes(k))), 0, false, path);
        const expressions = Array.from(unresolved).filter(([k]) => !before.has(k));
        let name = typeof r.name === 'string' ? r.name : '';
        if (parent && !name.startsWith(parent.name + '/')) name = parent.name + '/' + name;
        const item = { raw: r, type, name, path, parent, expressions };
        flat.push(item);
        if (raw.resources) flatten(raw.resources, item, level + 1, alreadyResolved);
        if (type.toLowerCase() === 'microsoft.network/virtualnetworks' && r.properties && Array.isArray(r.properties.subnets)) {
          flatten(r.properties.subnets.map((s) => Object.assign({}, s, { type: 'subnets' })), item, level + 1, true);
        }
      });
    }
    flatten(template.resources, null, 0);
    const imported = new Map();
    const typeMap = new Map(Object.entries(TYPES).map(([k, v]) => [v[0].toLowerCase(), k]));
    flat.sort((a, b) => a.type.split('/').length - b.type.split('/').length);
    flat.forEach((item) => {
      const type = typeMap.get(item.type.toLowerCase());
      if (!type) { warn('Unsupported ARM resource type skipped: ' + item.type); return; }
      const spec = TYPES[type];
      if (type === 'logic-app-standard' && !(typeof item.raw.kind === 'string' && item.raw.kind.toLowerCase().split(',').map((k) => k.trim()).includes('workflowapp'))) {
        warn('Unsupported Microsoft.Web/sites kind skipped; only Logic App Standard workflowapp hosts are supported.');
        return;
      }
      let parent = rg;
      if (spec[2]) {
        const parentType = TYPES[spec[2]][0].toLowerCase();
        const parentName = item.parent ? item.parent.name : item.name.slice(0, item.name.lastIndexOf('/'));
        parent = imported.get(parentType + '|' + parentName.toLowerCase());
        if (!parent) { warn('Child resource skipped because its supported parent is missing: ' + item.type); return; }
      }
      const key = item.type.toLowerCase() + '|' + item.name.toLowerCase();
      if (imported.has(key)) { warn('Duplicate resource declaration skipped: ' + item.type); return; }
      const leafName = spec[2] && item.name.includes('/') && !item.name.startsWith('[') ? item.name.slice(item.name.lastIndexOf('/') + 1) : item.name;
      const node = A.Model.addNode(project, type, parent.id, { nameMode: 'custom', name: leafName, label: leafName });
      const r = item.raw;
      // Replace model defaults: importing must not invent settings absent in the template.
      node.attributes = {};
      const attrs = A.Azure.attributesFor(type, r);
      Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') node.attributes[k] = v; });
      if (type === 'storage-account' && r.sku && typeof r.sku.name === 'string' && /^(Standard|Premium)_/.test(r.sku.name)) node.attributes.performance = r.sku.name.split('_')[0];
      if (type === 'service-bus-namespace' && r.sku && !r.sku.tier && ['Basic', 'Standard', 'Premium'].includes(r.sku.name)) node.attributes.sku = r.sku.name;
      if (typeof r.location === 'string') node.attributes.location = r.location;
      if (object(r.tags)) node.tags = Object.entries(r.tags).filter(([k, v]) => !sensitive.test(k) && typeof v === 'string' && !credentialValue.test(v)).map(([k, value]) => ({ key: k, value }));
      if (object(r.tags) && node.tags.length !== Object.keys(r.tags).length) warn('Sensitive or non-string tags were omitted.');
      item.expressions.forEach(([path, value]) => node.custom.push({ key: 'ARM unresolved ' + path, value }));
      if (r.identity) warn('Managed identity imported only as unsupported configuration; no identity or permissions are synthesized.');
      if (Object.keys(r).some((k) => !['type', 'apiVersion', 'name', 'location', 'tags', 'kind', 'sku', 'properties', 'condition'].includes(k))) warn('Some resource-level settings are unsupported; import is not lossless.');
      if (object(r.properties) && Object.keys(r.properties).length) warn('Only catalog-mapped properties are imported. Review private endpoints, identity, diagnostics, rules, ACLs, encryption and other advanced settings; import is not lossless.');
      imported.set(key, node);
    });
    if (template.outputs) warn('Template outputs are not imported or executed.');
    if (template.functions) warn('User-defined ARM functions are unsupported and are not executed.');
    if (template.languageVersion) warn('Advanced ARM language features are not fully supported.');
    A.Layout.autoLayout(project);
    return { project, warnings };
  }
  A.Infrastructure = { exportProject, importTemplate, isTemplate };
})(typeof globalThis !== 'undefined' ? globalThis : window);
