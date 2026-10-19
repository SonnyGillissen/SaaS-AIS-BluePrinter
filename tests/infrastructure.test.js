'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { AISBP: A, smallProject } = require('./helpers');
const { Infrastructure: I, Model } = A;
const schema = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#';
const template = (resources, extra) => ({ $schema: schema, contentVersion: '1.0.0.0', resources, ...extra });
const resource = (type, name, properties, extra) => ({ type, name, apiVersion: '2023-11-01', properties: properties || {}, ...extra });
const arm = (project) => {
  const result = I.exportProject(project, 'arm');
  const file = result.files.find((f) => /-rg001\.json$/.test(f.name));
  return {
    ...result,
    template: JSON.parse(file.content),
    parameters: JSON.parse(result.files.find((f) => /-rg001\.parameters\.json$/.test(f.name)).content)
  };
};
const value = (result, ref) => result.parameters.parameters[/parameters\('([^']+)'\)/.exec(ref)[1]].value;
const nodesOf = (project, type) => Object.values(project.nodes).filter((n) => n.type === type);
function allResources() {
  const result = smallProject(A, ['service-bus-namespace', 'storage-account', 'virtual-network', 'nsg', 'log-analytics']);
  const [ns, , vnet] = result.nodes;
  Model.addNode(result.project, 'service-bus-queue', ns.id, {});
  const topic = Model.addNode(result.project, 'service-bus-topic', ns.id, {});
  Model.addNode(result.project, 'service-bus-subscription', topic.id, {});
  Model.addNode(result.project, 'subnet', vnet.id, {});
  return result;
}

test('infrastructure exports supported resources with fixed stable APIs and required parameters', () => {
  const { project } = allResources();
  const out = arm(project);
  assert.equal(out.template.resources.length, 8);
  assert.equal(out.template.$schema, schema);
  assert.equal(out.template.contentVersion, '1.0.0.0');
  assert.ok(!own(out.template, 'metadata'));
  assert.ok(!own(out.template, 'outputs'));
  assert.ok(!JSON.stringify(out.template).includes('ais-blueprinter'));
  for (const r of out.template.resources) {
    assert.match(r.apiVersion, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.name, /^\[/);
    assert.match(r.properties, /^\[(parameters|union)\(/);
    if (r.location) assert.match(r.location, /^\[parameters\(/);
    if (r.tags) assert.match(r.tags, /^\[parameters\(/);
    if (r.sku) assert.match(r.sku, /^\[parameters\(/);
    if (r.kind) assert.match(r.kind, /^\[parameters\(/);
  }
  for (const [key, def] of Object.entries(out.template.parameters)) {
    assert.match(key, /^r\d+_(name|location|tags|properties|sku|kind)$/);
    assert.ok(!own(def, 'defaultValue'));
    assert.ok(own(out.parameters.parameters, key));
  }
  assert.equal(out.parameters.$schema, 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#');
  assert.match(out.warnings.join('\n'), /Secure baseline/);
});
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

test('each RG/subscription stays separate, metadata is separate and scope is selectable at deployment time', () => {
  const { project, sub, rg } = smallProject(A, ['nsg']);
  Model.updateNode(project, sub.id, { nameMode: 'custom', name: 'Subscription A' });
  Model.updateNode(project, rg.id, { nameMode: 'custom', name: 'Group A' });
  const secondSub = Model.addNode(project, 'subscription', null, { nameMode: 'custom', name: 'Subscription B' });
  const secondRg = Model.addNode(project, 'resource-group', secondSub.id, { nameMode: 'custom', name: 'Group B' });
  Model.addNode(project, 'storage-account', secondRg.id, {});
  const out = I.exportProject(project, 'arm', { baseName: '../../unsafe name' });
  const deployments = out.files.filter((f) => /-rg\d+\.json$/.test(f.name));
  assert.equal(deployments.length, 2);
  deployments.forEach((f) => {
    const t = JSON.parse(f.content);
    assert.equal(t.resources.length, 1);
    assert.ok(!t.resources.some((r) => r.type === 'Microsoft.Resources/resourceGroups'));
    assert.ok(!/[\\/]/.test(f.name));
  });
  const metadata = JSON.parse(out.files.find((f) => f.name.endsWith('.deployment-scopes.json')).content);
  assert.deepEqual(new Set(metadata.deployments.map((d) => d.subscription)), new Set(['Subscription A', 'Subscription B']));
  assert.deepEqual(new Set(metadata.deployments.map((d) => d.resourceGroup)), new Set(['Group A', 'Group B']));
  const instructions = out.files.find((f) => f.name.endsWith('.instructions.txt')).content;
  assert.match(instructions, /--subscription <subscription-id> --resource-group <existing-rg>/);
  assert.match(instructions, /what-if/);
  assert.match(instructions, /Do not use complete mode/);
});

test('scope manifests identify known subscription IDs, reject invalid IDs and disclose empty deployments', () => {
  const { project, sub } = smallProject(A, ['function-app']);
  const subscriptionId = '12345678-1234-1234-1234-123456789abc';
  sub.attributes.subscriptionId = subscriptionId;
  let out = I.exportProject(project, 'arm');
  let metadata = JSON.parse(out.files.find((f) => f.name.endsWith('.deployment-scopes.json')).content);
  assert.equal(metadata.deployments[0].subscriptionId, subscriptionId);
  assert.equal(metadata.deployments[0].resourceCount, 0);
  assert.match(out.warnings.join('\n'), /Empty deployment.*do not deploy/);
  const instructions = out.files.find((f) => f.name.endsWith('.instructions.txt')).content;
  out.warnings.forEach((warning) => assert.ok(instructions.includes(warning)));
  sub.attributes.subscriptionId = 'AccountKey=DO_NOT_EXPORT_INVALID_ID';
  out = I.exportProject(project, 'arm');
  metadata = JSON.parse(out.files.find((f) => f.name.endsWith('.deployment-scopes.json')).content);
  assert.equal(metadata.deployments[0].subscriptionId, null);
  assert.ok(out.files.every((file) => !file.content.includes('DO_NOT_EXPORT_INVALID_ID')));
  assert.match(out.warnings.join('\n'), /Scope subscription ID is unknown or invalid/);
});

test('ARM hierarchy uses parent-only dependencies, never diagram graph connections', () => {
  const { project, nodes } = allResources();
  const [ns, storage] = nodes;
  Model.addConnection(project, storage.id, ns.id, { kind: 'dependency' });
  const out = arm(project);
  assert.match(out.warnings.join('\n'), /not deployment dependencies/);
  const parents = out.template.resources.filter((r) => r.type.split('/').length === 2);
  assert.ok(parents.every((r) => !r.dependsOn));
  const children = out.template.resources.filter((r) => r.type.split('/').length > 2);
  assert.ok(children.every((r) => r.dependsOn.length === 1));
  const subscription = children.find((r) => r.type.endsWith('/subscriptions'));
  assert.match(subscription.dependsOn[0], /Microsoft.ServiceBus\/namespaces\/topics/);
  assert.equal((subscription.name.match(/parameters\(/g) || []).length, 3);
});

test('VNet parent PUT includes all declared subnets and never emits separate subnet replacements', () => {
  const { project, nodes } = smallProject(A, ['virtual-network']);
  Model.addNode(project, 'subnet', nodes[0].id, { nameMode: 'custom', name: 'application', attributes: { addressPrefix: '10.0.1.0/24' } });
  Model.addNode(project, 'subnet', nodes[0].id, { nameMode: 'custom', name: 'backend', attributes: { addressPrefix: '10.0.2.0/24' } });
  const out = arm(project);
  assert.equal(out.template.resources.length, 1);
  const vnet = out.template.resources[0];
  assert.equal(vnet.type, 'Microsoft.Network/virtualNetworks');
  assert.match(vnet.properties, /^\[union\(/);
  assert.match(vnet.properties, /createObject\('subnets', createArray\(/);
  assert.equal((vnet.properties.match(/createObject\('name',/g) || []).length, 2);
  assert.ok(!out.template.resources.some((r) => r.type.toLowerCase().endsWith('/subnets')));
  const imported = I.importTemplate(out.template, out.parameters);
  assert.deepEqual(new Map(nodesOf(imported.project, 'subnet').map((n) => [n.name, n.attributes.addressPrefix])), new Map([
    ['application', '10.0.1.0/24'], ['backend', '10.0.2.0/24']
  ]));
  const bicep = I.exportProject(project, 'bicep');
  const source = bicep.files.find((f) => f.name.endsWith('.bicep')).content;
  assert.equal((source.match(/^resource /gm) || []).length, 1);
  assert.match(source, /properties: union\(/);
  assert.match(source, /subnets: \[/);
  assert.ok(!source.includes("'Microsoft.Network/virtualNetworks/subnets@"));
  for (const result of [out, bicep]) {
    assert.match(result.warnings.join('\n'), /what-if: unmanaged existing subnets\/peerings/);
    assert.match(result.files.find((f) => f.name.endsWith('.instructions.txt')).content, /what-if: unmanaged existing subnets\/peerings/);
  }
});

test('export-generated empty-subnet json/union/createObject expressions resolve without placeholders', () => {
  const { project } = smallProject(A, ['virtual-network']);
  const out = arm(project);
  assert.match(out.template.resources[0].properties, /createObject\('subnets', json\('\[\]'\)\)/);
  const imported = I.importTemplate(out.template, out.parameters);
  assert.equal(nodesOf(imported.project, 'virtual-network')[0].attributes.addressSpace, '10.0.0.0/16');
  assert.equal(nodesOf(imported.project, 'subnet').length, 0);
  assert.ok(!imported.warnings.some((warning) => warning.includes('expression preserved')));
  assert.match(out.warnings.join('\n'), /Only declared subnets are retained; the diagram must inventory every existing subnet/);
});

test('installed Bicep compiler output and parameters round-trip every supported resource kind', (t) => {
  const available = spawnSync('bicep', ['--version'], { encoding: 'utf8' });
  if (available.status !== 0) { t.skip('Bicep CLI is not installed; pure JavaScript export/import regressions still run.'); return; }
  const directory = path.join(__dirname, '..', '.infrastructure-test-fixtures-' + process.pid);
  fs.mkdirSync(directory);
  try {
    const { project } = allResources();
    const out = I.exportProject(project, 'bicep');
    for (const file of out.files.filter((f) => /\.bicep(param)?$/.test(f.name))) fs.writeFileSync(path.join(directory, file.name), file.content);
    function compile(command, extension) {
      const file = out.files.find((f) => f.name.endsWith(extension));
      const run = spawnSync('bicep', [command, path.join(directory, file.name), '--no-restore', '--stdout'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      assert.equal(run.status, 0, run.stderr || String(run.error));
      return JSON.parse(run.stdout);
    }
    const compiledTemplate = compile('build', '.bicep');
    const compiled = compile('build-params', '.bicepparam');
    const compiledParameters = typeof compiled.parametersJson === 'string' ? JSON.parse(compiled.parametersJson) : compiled.parametersJson || compiled;
    assert.deepEqual(compiledParameters.parameters, JSON.parse(out.files.find((f) => f.name.endsWith('.parameters.json')).content).parameters);
    const imported = I.importTemplate(compiledTemplate, compiledParameters);
    for (const type of ['service-bus-namespace', 'service-bus-queue', 'service-bus-topic', 'service-bus-subscription', 'storage-account', 'virtual-network', 'subnet', 'nsg', 'log-analytics']) {
      const expected = nodesOf(project, type).map((n) => A.Naming.resolveName(project, n));
      assert.deepEqual(nodesOf(imported.project, type).map((n) => n.name), expected, type);
    }
    assert.equal(compiledTemplate.resources.length, 8);
    assert.ok(!compiledTemplate.resources.some((r) => r.type.toLowerCase().endsWith('/subnets')));
    assert.equal(nodesOf(imported.project, 'subnet')[0].attributes.addressPrefix, '10.0.1.0/24');
    assert.ok(!imported.warnings.some((warning) => warning.includes('expression preserved')));
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('Bicep emits full child types, parent symbols and separate parameter files', () => {
  const { project } = allResources();
  const out = I.exportProject(project, 'bicep');
  const main = out.files.find((f) => f.name.endsWith('.bicep')).content;
  const params = out.files.find((f) => f.name.endsWith('.bicepparam')).content;
  assert.match(main, /targetScope = 'resourceGroup'/);
  assert.match(main, /'Microsoft.ServiceBus\/namespaces\/topics\/subscriptions@2021-11-01'/);
  assert.match(main, /parent: r\d+/);
  assert.match(main, /properties: union\(r\d+_properties, \{/);
  assert.match(main, /subnets: \[/);
  assert.ok(!main.includes("'Microsoft.Network/virtualNetworks/subnets@"));
  assert.match(main, /param r\d+_properties object/);
  assert.match(params, /using '\.\/infrastructure-rg001\.bicep'/);
  assert.match(params, /param r\d+_properties = \{/);
  assert.ok(out.files.some((f) => f.name.endsWith('.parameters.json')));
  assert.ok(!main.includes('blueprint'));
  assert.ok(!main.includes('westeurope'));
});

test('instructions disclose pinned API coverage, canonical references and validation limitations', () => {
  const { project } = allResources();
  const out = I.exportProject(project, 'arm');
  const instructions = out.files.find((f) => f.name.endsWith('.instructions.txt')).content;
  for (const path of [
    'microsoft.servicebus/2021-11-01/namespaces',
    'microsoft.servicebus/2021-11-01/namespaces/queues',
    'microsoft.servicebus/2021-11-01/namespaces/topics',
    'microsoft.servicebus/2021-11-01/namespaces/topics/subscriptions',
    'microsoft.storage/2023-05-01/storageaccounts',
    'microsoft.network/2023-11-01/virtualnetworks',
    'microsoft.network/2023-11-01/virtualnetworks/subnets',
    'microsoft.network/2023-11-01/networksecuritygroups',
    'microsoft.operationalinsights/2022-10-01/workspaces'
  ]) assert.ok(instructions.includes('https://learn.microsoft.com/en-us/azure/templates/' + path), path);
  assert.match(instructions, /not a claim of Microsoft certification/);
  assert.match(instructions, /complete standards compliance/);
  assert.match(instructions, /direct Bicep import and Terraform are not supported/);
  assert.match(instructions, /NSGs without custom rules only/);
});

test('Bicep escapes quotes, backslashes, controls and interpolation in parameter values', () => {
  const { project, nodes } = smallProject(A, ['nsg']);
  const payload = "x'\\\n\r\t\u0000\b\f\u007f${resourceGroup().name}";
  nodes[0].tags = [{ key: payload, value: payload }];
  const out = I.exportProject(project, 'bicep');
  const params = out.files.find((f) => f.name.endsWith('.bicepparam')).content;
  assert.ok(params.includes("\\${resourceGroup().name}"));
  assert.ok(params.includes("x\\'\\\\\\n\\r\\t"));
  assert.ok(params.includes('\\u{0}\\u{8}\\u{c}\\u{7f}'));
  assert.ok(!params.includes("'${resourceGroup()"));
  assert.ok(!params.includes('\r'));
});

test('ARM parameter-file values starting with [ stay literal and are never evaluated', () => {
  const { project, nodes } = smallProject(A, ['nsg']);
  nodes[0].tags = [{ key: 'literal', value: "[concat('not', 'executed')]" }];
  const out = arm(project);
  const r = out.template.resources[0];
  assert.equal(value(out, r.tags).literal, "[concat('not', 'executed')]");
  const imported = I.importTemplate(out.template, out.parameters);
  assert.equal(nodesOf(imported.project, 'nsg')[0].tags[0].value, "[concat('not', 'executed')]");
});

test('ARM template literals escape [ with [[, but parameter values retain both brackets', () => {
  const out = I.importTemplate(template([
    resource('Microsoft.Network/networkSecurityGroups', 'nsg', {}, { tags: { escaped: "[[literal]", passed: "[parameters('tag')]" } })
  ], { parameters: { tag: { type: 'string' } } }), { parameters: { tag: { value: '[[both-brackets]' } } });
  assert.deepEqual(nodesOf(out.project, 'nsg')[0].tags, [
    { key: 'escaped', value: '[literal]' },
    { key: 'passed', value: '[[both-brackets]' }
  ]);
});

test('external object parameter values are not recursively evaluated or unescaped', () => {
  const literalTags = { single: "[concat('not', 'executed')]", double: '[[both-brackets]' };
  const out = I.importTemplate(template([
    resource('Microsoft.Network/networkSecurityGroups', 'nsg', {}, { tags: "[parameters('tags')]" })
  ], { parameters: { tags: { type: 'object' } } }), { parameters: { tags: { value: literalTags } } });
  assert.deepEqual(Object.fromEntries(nodesOf(out.project, 'nsg')[0].tags.map((t) => [t.key, t.value])), literalTags);
});

test('Naming.resolveName returns a string and exports use that string directly', () => {
  const { project, nodes } = smallProject(A, ['nsg']);
  const conventionName = A.Naming.resolveName(project, nodes[0]);
  assert.equal(typeof conventionName, 'string');
  assert.ok(conventionName.length > 0);
  let out = arm(project);
  assert.equal(value(out, out.template.resources[0].name), conventionName);
  Model.updateNode(project, nodes[0].id, { nameMode: 'custom', name: 'custom-nsg' });
  assert.equal(A.Naming.resolveName(project, nodes[0]), 'custom-nsg');
  out = arm(project);
  assert.equal(value(out, out.template.resources[0].name), 'custom-nsg');
});

test('catalog naming restrictions omit invalid resource-name values and persist all warnings', () => {
  const { project, nodes } = smallProject(A, ['storage-account', 'service-bus-namespace', 'nsg']);
  for (const node of nodes) Model.updateNode(project, node.id, { nameMode: 'custom', name: 'BAD NAME?' });
  const out = arm(project);
  for (const r of out.template.resources) {
    const parameterName = /parameters\('([^']+)'\)/.exec(r.name)[1];
    assert.ok(!own(out.parameters.parameters, parameterName));
  }
  const instructions = out.files.find((f) => f.name.endsWith('.instructions.txt')).content;
  assert.equal(out.warnings.filter((warning) => warning.includes('fails catalog naming restrictions')).length, 3);
  out.warnings.forEach((warning) => assert.ok(instructions.includes(warning)));
  assert.ok(instructions.includes('BAD NAME?: Resource name fails catalog naming restrictions:'));
});

test('unsupported objects, unscoped resources, ignored settings and security features warn explicitly', () => {
  const { project, nodes } = smallProject(A, ['service-bus-namespace', 'function-app', 'private-endpoint']);
  Object.assign(nodes[0].attributes, { identity: 'System assigned', diagnostics: true, privateEndpoint: true, unknownSetting: 'ignored' });
  nodes[0].network = ['diagram-subnet'];
  const rogue = { ...nodes[0], id: 'rogue', parentId: null };
  project.nodes.rogue = rogue;
  const out = arm(project);
  assert.equal(out.template.resources.length, 1);
  const warnings = out.warnings.join('\n');
  assert.match(warnings, /unsupported resource/);
  assert.match(warnings, /no resource-group scope/);
  assert.match(warnings, /identity/);
  assert.match(warnings, /diagnostics/);
  assert.match(warnings, /privateEndpoint/);
  assert.match(warnings, /Network links are diagram-only/);
});

test('unknown credentials, custom values and sensitive tags never enter deployment files', () => {
  const { project, nodes } = smallProject(A, ['storage-account']);
  const secret = 'DO_NOT_EXPORT_THIS_VALUE';
  Object.assign(nodes[0].attributes, { password: secret, connectionString: secret, appSettings: { secret }, description: secret });
  nodes[0].custom = [{ key: 'Credential', value: secret }];
  nodes[0].tags = [{ key: 'clientSecret', value: secret }, { key: 'notes', value: 'AccountKey=' + secret }, { key: 'team', value: 'integration' }];
  const out = arm(project);
  assert.ok(out.files.every((f) => !f.content.includes(secret)));
  assert.ok(!out.warnings.join('\n').includes(secret));
  assert.match(out.warnings.join('\n'), /sensitive/);
  assert.match(out.warnings.join('\n'), /Custom properties are not exported/);
  assert.equal(value(out, out.template.resources[0].tags).team, 'integration');
});

test('export warnings identify resources by resolved names instead of internal symbols', () => {
  const { project, rg, nodes } = smallProject(A, ['service-bus-namespace', 'api-management']);
  nodes[0].nameMode = 'custom';
  nodes[0].name = 'sb-orders-production';
  nodes[1].nameMode = 'custom';
  nodes[1].name = 'apim-orders-production';
  rg.nameMode = 'custom';
  rg.name = 'rg-orders-production';
  const out = arm(project);
  assert.ok(out.warnings.some((warning) => warning.startsWith('sb-orders-production: ')));
  assert.ok(out.warnings.some((warning) => warning.startsWith('apim-orders-production: Skipped:')));
  assert.ok(out.warnings.some((warning) => warning.startsWith('rg-orders-production: ')));
  assert.ok(out.warnings.every((warning) => !/^r\d+ \(/.test(warning)));
  const instructions = out.files.find((file) => file.name.endsWith('.instructions.txt')).content;
  out.warnings.forEach((warning) => assert.ok(instructions.includes(warning)));
});

test('warning names use safe labels or resource types when names are missing or sensitive', () => {
  const { project, nodes } = smallProject(A, ['api-management']);
  const node = nodes[0];
  node.nameMode = 'custom';
  node.name = '';
  node.label = 'Orders API';
  assert.ok(arm(project).warnings.some((warning) => warning.startsWith('Orders API: Skipped:')));
  node.name = 'AccountKey=DO_NOT_INCLUDE_IN_WARNINGS';
  node.label = node.name;
  const out = arm(project);
  assert.ok(out.warnings.some((warning) => warning.startsWith('API Management: Skipped:')));
  assert.ok(out.files.every((file) => !file.content.includes('DO_NOT_INCLUDE_IN_WARNINGS')));
});

test('missing required SKU, location, names or CIDRs have no fabricated values', () => {
  const { project, rg, nodes } = smallProject(A, ['service-bus-namespace', 'virtual-network']);
  nodes[0].attributes = {};
  nodes[0].nameMode = 'custom'; nodes[0].name = '';
  nodes[1].attributes = {};
  rg.attributes = {};
  const out = arm(project);
  const ns = out.template.resources.find((r) => r.type === 'Microsoft.ServiceBus/namespaces');
  const vnet = out.template.resources.find((r) => r.type === 'Microsoft.Network/virtualNetworks');
  for (const ref of [ns.sku, ns.name, ns.location, vnet.location, vnet.properties]) {
    const key = /parameters\('([^']+)'\)/.exec(ref)[1];
    assert.ok(!own(out.parameters.parameters, key), key);
    assert.ok(own(out.template.parameters, key));
  }
  assert.match(out.warnings.join('\n'), /no value/);
  assert.match(out.warnings.join('\n'), /no CIDR was invented/);
});

test('secure baseline and explicit compatibility/security warnings are parameterized', () => {
  const { project, nodes } = smallProject(A, ['service-bus-namespace', 'storage-account']);
  const [ns, storage] = nodes;
  delete ns.attributes.disableLocalAuth;
  ns.attributes.publicNetworkAccess = 'Selected networks';
  storage.attributes.minimumTlsVersion = '1.0';
  const out = arm(project);
  const n = out.template.resources.find((r) => r.type === 'Microsoft.ServiceBus/namespaces');
  const s = out.template.resources.find((r) => r.type === 'Microsoft.Storage/storageAccounts');
  assert.equal(value(out, n.properties).disableLocalAuth, true);
  assert.equal(value(out, n.properties).publicNetworkAccess, 'Disabled');
  assert.equal(value(out, s.properties).minimumTlsVersion, 'TLS1_2');
  assert.equal(value(out, s.properties).allowSharedKeyAccess, false);
  assert.equal(value(out, s.properties).allowBlobPublicAccess, false);
  assert.equal(value(out, s.properties).supportsHttpsTrafficOnly, true);
  assert.match(out.warnings.join('\n'), /compatibility/);
});

test('incompatible Basic Service Bus topics are skipped and unsupported entity options require correction', () => {
  const { project, nodes } = smallProject(A, ['service-bus-namespace']);
  nodes[0].attributes.sku = 'Basic';
  const topic = Model.addNode(project, 'service-bus-topic', nodes[0].id, {});
  Model.addNode(project, 'service-bus-subscription', topic.id, {});
  Model.addNode(project, 'service-bus-queue', nodes[0].id, { attributes: { requiresSession: true } });
  const out = arm(project);
  assert.equal(out.template.resources.length, 2);
  const queue = out.template.resources.find((r) => r.type.endsWith('/queues'));
  assert.ok(!own(out.parameters.parameters, /parameters\('([^']+)'\)/.exec(queue.properties)[1]));
  assert.match(out.warnings.join('\n'), /Basic Service Bus/);
  assert.match(out.warnings.join('\n'), /required deployable parent/);
});

test('Premium Service Bus requires capacity and parameterizes the complete SKU', () => {
  const { project, nodes } = smallProject(A, ['service-bus-namespace']);
  nodes[0].attributes.sku = 'Premium';
  let out = arm(project);
  assert.match(out.warnings.join('\n'), /explicit supported messaging-unit capacity/);
  assert.ok(!own(out.parameters.parameters, /parameters\('([^']+)'\)/.exec(out.template.resources[0].sku)[1]));
  nodes[0].attributes.capacity = '4';
  out = arm(project);
  assert.deepEqual(value(out, out.template.resources[0].sku), { name: 'Premium', tier: 'Premium', capacity: 4 });
});

test('free-text NSG rules and non-Standard StorageV2 are skipped rather than misrepresented', () => {
  const { project, nodes } = smallProject(A, ['nsg', 'storage-account']);
  nodes[0].attributes.rules = 'Allow internet 443';
  nodes[1].attributes.kind = 'FileStorage';
  const out = arm(project);
  assert.equal(out.template.resources.length, 0);
  assert.match(out.warnings.join('\n'), /free-text NSG rules/);
  assert.match(out.warnings.join('\n'), /only Standard StorageV2/);
});

test('subnet security associations and incompatible workspace SKU require explicit configuration', () => {
  const { project, nodes } = smallProject(A, ['virtual-network', 'log-analytics']);
  Model.addNode(project, 'subnet', nodes[0].id, { attributes: { nsg: 'existing-nsg' } });
  nodes[1].attributes.sku = 'CapacityReservation';
  const out = arm(project);
  for (const r of out.template.resources.filter((r) => /workspaces/.test(r.type))) {
    assert.ok(!own(out.parameters.parameters, /parameters\('([^']+)'\)/.exec(r.properties)[1]));
  }
  const subnetProperty = Object.keys(out.template.parameters).find((k) => k.endsWith('_properties') && !own(out.parameters.parameters, k));
  assert.ok(subnetProperty);
  assert.match(out.warnings.join('\n'), /rather than silently losing security/);
  assert.match(out.warnings.join('\n'), /capacity reservation/);
});

test('invalid booleans, lock durations, DNS addresses and CIDRs cannot silently drop supported settings', () => {
  const { project, nodes } = smallProject(A, ['service-bus-namespace', 'virtual-network']);
  nodes[0].attributes.disableLocalAuth = 'not a boolean';
  Model.addNode(project, 'service-bus-queue', nodes[0].id, { attributes: { lockDuration: 'PT5M1S' } });
  nodes[1].attributes.addressSpace = '999.0.0.0/999';
  nodes[1].attributes.dnsServers = 'not-an-address';
  const out = arm(project);
  assert.ok(Object.keys(out.template.parameters).filter((k) => k.endsWith('_properties')).every((k) => !own(out.parameters.parameters, k)));
  const warnings = out.warnings.join('\n');
  assert.match(warnings, /not a boolean/);
  assert.match(warnings, /lock duration/);
  assert.match(warnings, /Valid IPv4\/IPv6/);
  assert.match(warnings, /Invalid custom DNS/);
});

test('IPv6 and dual-stack address prefixes are retained in parameterized VNet/subnet configuration', () => {
  const { project, nodes } = smallProject(A, ['virtual-network']);
  nodes[0].attributes.addressSpace = '10.0.0.0/16, fd00:db8::/48';
  Model.addNode(project, 'subnet', nodes[0].id, { attributes: { addressPrefix: '10.0.1.0/24, fd00:db8:0:1::/64' } });
  const out = arm(project);
  const imported = I.importTemplate(out.template, out.parameters);
  assert.match(nodesOf(imported.project, 'virtual-network')[0].attributes.addressSpace, /fd00:db8::\/48/);
  assert.match(nodesOf(imported.project, 'subnet')[0].attributes.addressPrefix, /fd00:db8:0:1::\/64/);
});

test('export is deterministic, does not mutate projects, and symbols do not derive from resource names', () => {
  const { project, nodes } = allResources();
  const before = JSON.stringify(project);
  const first = I.exportProject(project, 'bicep');
  assert.equal(JSON.stringify(project), before);
  assert.deepEqual(I.exportProject(project, 'bicep'), first);
  nodes[0].nameMode = 'custom'; nodes[0].name = 'renamed-resource';
  const second = I.exportProject(project, 'bicep');
  assert.equal(first.files.find((f) => f.name.endsWith('.bicep')).content, second.files.find((f) => f.name.endsWith('.bicep')).content);
  assert.notEqual(first.files.find((f) => f.name.endsWith('.bicepparam')).content, second.files.find((f) => f.name.endsWith('.bicepparam')).content);
  project.nodes.unrelated = { id: '0000', type: 'diagram-only', parentId: null };
  const third = I.exportProject(project, 'bicep');
  assert.equal(second.files.find((f) => f.name.endsWith('.bicep')).content, third.files.find((f) => f.name.endsWith('.bicep')).content);
});

test('empty project and invalid input are handled explicitly', () => {
  const out = I.exportProject(Model.createProject(), 'arm');
  assert.match(out.warnings.join('\n'), /No resource groups/);
  assert.equal(out.files.filter((f) => /-rg\d+\.json$/.test(f.name)).length, 0);
  assert.throws(() => I.exportProject({}, 'arm'), /project is required/);
  assert.throws(() => I.exportProject(Model.createProject(), 'terraform'), /arm or bicep/);
  assert.throws(() => I.importTemplate({ resources: [] }), /Expected an ARM/);
  assert.equal(I.isTemplate(template([])), true);
  assert.equal(I.isTemplate(null), false);
  assert.equal(I.isTemplate({ format: 'ais-blueprinter', nodes: {} }), false);
});

test('ARM export/import round-trips supported hierarchy, values and tags without inventing connections', () => {
  const { project, nodes } = allResources();
  nodes[0].tags = [{ key: 'team', value: 'integration' }];
  const out = arm(project);
  const imported = I.importTemplate(out.template, out.parameters);
  assert.equal(Object.keys(imported.project.connections).length, 0);
  for (const type of ['service-bus-namespace', 'service-bus-queue', 'service-bus-topic', 'service-bus-subscription', 'storage-account', 'virtual-network', 'subnet', 'nsg', 'log-analytics']) assert.equal(nodesOf(imported.project, type).length, 1, type);
  assert.equal(nodesOf(imported.project, 'storage-account')[0].attributes.performance, 'Standard');
  assert.equal(nodesOf(imported.project, 'storage-account')[0].attributes.replication, 'ZRS');
  assert.deepEqual(nodesOf(imported.project, 'service-bus-namespace')[0].tags, [{ key: 'team', value: 'integration' }]);
  const sub = nodesOf(imported.project, 'service-bus-subscription')[0];
  assert.equal(imported.project.nodes[sub.parentId].type, 'service-bus-topic');
  assert.match(imported.warnings.join('\n'), /not lossless/);
  assert.equal(nodesOf(imported.project, 'resource-group')[0].attributes.location, undefined);
});

test('ARM imports are automatically arranged without overlapping sibling resources', () => {
  const { project } = I.importTemplate(template([
    resource('Microsoft.Network/networkSecurityGroups', 'first-nsg'),
    resource('Microsoft.Network/networkSecurityGroups', 'second-nsg'),
    resource('Microsoft.Storage/storageAccounts', 'exampleaccount'),
    resource('Microsoft.ServiceBus/namespaces', 'message-bus', {}, {
      resources: [resource('queues', 'first-queue'), resource('queues', 'second-queue')]
    })
  ]));
  const nodes = Object.values(project.nodes);
  const { rects } = A.Layout.compute(project);
  assert.ok(nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.ok(new Set(nodes.map((node) => node.x + ',' + node.y)).size > 1);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].parentId !== nodes[j].parentId) continue;
      const left = rects[nodes[i].id], right = rects[nodes[j].id];
      const overlap = left.x < right.x + right.w && right.x < left.x + left.w && left.y < right.y + right.h && right.y < left.y + left.h;
      assert.equal(overlap, false, 'Sibling resources overlap: ' + nodes[i].name + ' / ' + nodes[j].name);
    }
  }
});

test('import safely resolves defaults, parameter overrides, variables, concat, format and object/index access', () => {
  const input = template([
    resource('Microsoft.ServiceBus/namespaces', "[format('{0}-{1}', variables('prefix'), parameters('config').suffix)]", {}, { sku: { name: 'Standard' }, location: "[parameters('regions')[0]]" })
  ], {
    parameters: { config: { type: 'object', defaultValue: { suffix: 'default' } }, regions: { type: 'array', defaultValue: ['westus'] } },
    variables: { prefix: "[toLower(concat('My', 'BUS'))]" }
  });
  const out = I.importTemplate(input, { parameters: { config: { value: { suffix: 'override' } } } });
  const ns = nodesOf(out.project, 'service-bus-namespace')[0];
  assert.equal(ns.name, 'mybus-override');
  assert.equal(ns.attributes.location, 'westus');
  assert.equal(ns.attributes.sku, 'Standard');
  assert.equal(ns.attributes.minimumTlsVersion, undefined);
});

test('import resolves nested and flattened Service Bus children independent of declaration ordering', () => {
  const out = I.importTemplate(template([
    resource('Microsoft.ServiceBus/namespaces/topics/subscriptions', 'bus/events/consumer', { maxDeliveryCount: 7 }),
    resource('Microsoft.ServiceBus/namespaces', 'bus', {}, {
      resources: [
        resource('queues', 'orders', { lockDuration: 'PT2M' }),
        resource('topics', 'events', { supportOrdering: true })
      ]
    })
  ]));
  const ns = nodesOf(out.project, 'service-bus-namespace')[0];
  const queue = nodesOf(out.project, 'service-bus-queue')[0];
  const topic = nodesOf(out.project, 'service-bus-topic')[0];
  const sub = nodesOf(out.project, 'service-bus-subscription')[0];
  assert.equal(queue.parentId, ns.id);
  assert.equal(topic.parentId, ns.id);
  assert.equal(sub.parentId, topic.id);
  assert.equal(queue.name, 'orders');
  assert.equal(sub.name, 'consumer');
  assert.equal(sub.attributes.maxDeliveryCount, 7);
});

test('import handles inline VNet subnets without executing parameter values a second time', () => {
  const out = I.importTemplate(template([
    resource('Microsoft.Network/virtualNetworks', 'network', {
      addressSpace: { addressPrefixes: ['10.4.0.0/16'] },
      subnets: [{ name: 'app', properties: { addressPrefix: '10.4.1.0/24' } }]
    })
  ]));
  const vnet = nodesOf(out.project, 'virtual-network')[0];
  const subnet = nodesOf(out.project, 'subnet')[0];
  assert.equal(subnet.parentId, vnet.id);
  assert.equal(subnet.attributes.addressPrefix, '10.4.1.0/24');
});

test('missing parameters, unsupported functions and cyclic variables are preserved without code execution', () => {
  globalThis.infrastructureInjection = false;
  const expressions = [
    "[parameters('missing')]",
    "[variables('cycleA')]",
    "[reference('external').location]",
    "[globalThis.infrastructureInjection=true]",
    "[resourceGroup().location]"
  ];
  const input = template(expressions.map((expr, i) => resource('Microsoft.Network/networkSecurityGroups', 'nsg' + i, {}, { location: expr })), {
    parameters: { missing: { type: 'string' } },
    variables: { cycleA: "[variables('cycleB')]", cycleB: "[variables('cycleA')]" }
  });
  const out = I.importTemplate(input);
  const imported = nodesOf(out.project, 'nsg');
  assert.equal(imported.length, expressions.length);
  imported.forEach((n, i) => {
    assert.equal(n.attributes.location, expressions[i]);
    assert.ok(n.custom.some((c) => c.value === expressions[i]));
  });
  assert.equal(globalThis.infrastructureInjection, false);
  delete globalThis.infrastructureInjection;
  assert.match(out.warnings.join('\n'), /missing.*no value/);
  assert.match(out.warnings.join('\n'), /preserved without execution/);
});

test('secure parameter overrides/defaults are never resolved into diagram values', () => {
  const secret = 'DO_NOT_RETAIN_SECURE_VALUE';
  const out = I.importTemplate(template([
    resource('Microsoft.Network/networkSecurityGroups', 'nsg', {}, { location: "[parameters('region')]" })
  ], { parameters: { region: { type: 'secureString', defaultValue: secret } } }), { parameters: { region: { value: secret } } });
  assert.ok(!JSON.stringify(out.project).includes(secret));
  assert.match(out.warnings.join('\n'), /secure/);
});

test('safe object construction and union preserve ARM recursive-merge semantics', () => {
  const out = I.importTemplate(template([
    resource('Microsoft.Network/virtualNetworks', 'network', "[union(parameters('left'), createObject('addressSpace', createObject('addressPrefixes', createArray('10.0.0.0/16'))))]")
  ], { parameters: { left: { type: 'object', defaultValue: { addressSpace: { addressPrefixes: ['10.2.0.0/16'], other: 'retained' }, dhcpOptions: { dnsServers: ['10.0.0.4'] } } } } }));
  const vnet = nodesOf(out.project, 'virtual-network')[0];
  assert.equal(vnet.attributes.addressSpace, '10.0.0.0/16');
  assert.equal(vnet.attributes.dnsServers, '10.0.0.4');
  assert.equal(vnet.custom.length, 0);
});

test('import warns and skips loops, linked/inline deployments, conditions, unsupported types and external scope', () => {
  const out = I.importTemplate(template([
    resource('Microsoft.Network/networkSecurityGroups', 'loop', {}, { copy: { name: 'n', count: 3 } }),
    resource('Microsoft.Network/networkSecurityGroups', 'conditional', {}, { condition: "[parameters('enabled')]" }),
    resource('Microsoft.Resources/deployments', 'linked', { templateLink: { uri: 'https://example.invalid/template.json' } }),
    resource('Microsoft.Resources/deployments', 'nested', { template: template([]) }),
    resource('Microsoft.Compute/virtualMachines', 'vm'),
    resource('Microsoft.Network/networkSecurityGroups', 'elsewhere', {}, { scope: '/subscriptions/other/resourceGroups/other' }),
    resource('Microsoft.ServiceBus/namespaces/queues', 'absent/orphan')
  ], { outputs: { secret: { type: 'string', value: "[listKeys('resource', 'version')]" } }, functions: [] }));
  assert.equal(Object.keys(out.project.nodes).length, 2);
  const warnings = out.warnings.join('\n');
  for (const pattern of [/copy loops/, /Conditional/, /Linked deployments/, /Nested deployments/, /Unsupported ARM resource/, /scope is unsupported/, /parent is missing/, /outputs/, /functions/]) assert.match(warnings, pattern);
});

test('prototype-shaped tags and object keys do not pollute global prototypes', () => {
  const { project, nodes } = smallProject(A, ['nsg']);
  nodes[0].tags = [{ key: '__proto__', value: 'literal' }];
  const out = arm(project);
  assert.equal(value(out, out.template.resources[0].tags).__proto__, 'literal');
  const imported = I.importTemplate(out.template, out.parameters);
  assert.deepEqual(nodesOf(imported.project, 'nsg')[0].tags, [{ key: '__proto__', value: 'literal' }]);
  assert.equal({}.polluted, undefined);
});
