/**
 * AIS BluePrinter - Azure resource catalog.
 *
 * Describes every object that can be placed in a blueprint:
 *  - its position in the Azure hierarchy (`parents`), mirroring Azure Resource Manager
 *    (management groups > subscriptions > resource groups > resources > child resources),
 *  - the icon taken from the MS Icons community library (https://msicons.com),
 *  - the Cloud Adoption Framework (CAF) abbreviation used for naming conventions,
 *  - the Azure naming restrictions (length, characters, uniqueness scope),
 *  - the configurable attributes of the resource,
 *  - the ArchiMate element type used when exporting to ArchiMate.
 *
 * Naming rules are based on:
 * https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
 * Abbreviations are based on:
 * https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations
 *
 * Icons are referenced by their path inside the MS Icons library
 * (https://msicons.com/icons/<category>/<file>.svg). MS Icons is a community project by
 * Daniel Bradley that hosts the official Microsoft architecture icons. The icons remain
 * property of Microsoft and are subject to Microsoft's icon terms of use.
 *
 * @module AISBP.Catalog
 */
(function (root) {
  'use strict';

  const AISBP = (root.AISBP = root.AISBP || {});

  /** Pseudo parent type used for objects that may live at the top level of a blueprint. */
  const ROOT = '@root';

  /** Azure regions with the abbreviations used by the {region} naming token. */
  const REGIONS = [
    ['westeurope', 'West Europe', 'weu'],
    ['northeurope', 'North Europe', 'neu'],
    ['swedencentral', 'Sweden Central', 'sdc'],
    ['germanywestcentral', 'Germany West Central', 'gwc'],
    ['francecentral', 'France Central', 'frc'],
    ['switzerlandnorth', 'Switzerland North', 'szn'],
    ['norwayeast', 'Norway East', 'noe'],
    ['polandcentral', 'Poland Central', 'plc'],
    ['italynorth', 'Italy North', 'itn'],
    ['spaincentral', 'Spain Central', 'spc'],
    ['uksouth', 'UK South', 'uks'],
    ['ukwest', 'UK West', 'ukw'],
    ['eastus', 'East US', 'eus'],
    ['eastus2', 'East US 2', 'eus2'],
    ['centralus', 'Central US', 'cus'],
    ['northcentralus', 'North Central US', 'ncus'],
    ['southcentralus', 'South Central US', 'scus'],
    ['westus', 'West US', 'wus'],
    ['westus2', 'West US 2', 'wus2'],
    ['westus3', 'West US 3', 'wus3'],
    ['canadacentral', 'Canada Central', 'cnc'],
    ['canadaeast', 'Canada East', 'cne'],
    ['brazilsouth', 'Brazil South', 'brs'],
    ['australiaeast', 'Australia East', 'ae'],
    ['australiasoutheast', 'Australia Southeast', 'ase'],
    ['southeastasia', 'Southeast Asia', 'sea'],
    ['eastasia', 'East Asia', 'ea'],
    ['japaneast', 'Japan East', 'jpe'],
    ['japanwest', 'Japan West', 'jpw'],
    ['koreacentral', 'Korea Central', 'krc'],
    ['centralindia', 'Central India', 'inc'],
    ['uaenorth', 'UAE North', 'uan'],
    ['southafricanorth', 'South Africa North', 'san'],
    ['global', 'Global', 'glb']
  ].map(([id, label, abbr]) => ({ id, label, abbr }));

  /** Categories shown in the palette (in this order). */
  const CATEGORIES = [
    { id: 'hierarchy', label: 'Hierarchy' },
    { id: 'integration', label: 'Integration' },
    { id: 'messaging', label: 'Messaging & Events' },
    { id: 'compute', label: 'Compute & Hosting' },
    { id: 'data', label: 'Data & Storage' },
    { id: 'security', label: 'Security & Identity' },
    { id: 'networking', label: 'Networking' },
    { id: 'monitoring', label: 'Monitoring' },
    { id: 'ai', label: 'AI' },
    { id: 'external', label: 'External & On-premises' },
    { id: 'other', label: 'Other' },
    { id: 'annotations', label: 'Text & Tables' }
  ];

  // ---------------------------------------------------------------------------
  // Attribute helpers. Attribute definition shape:
  // { key, label, type: 'text'|'textarea'|'number'|'select'|'bool', options?, default?, show? }
  // `show` = displayed on the diagram by default (user can change this globally or per object).
  // ---------------------------------------------------------------------------
  const text = (key, label, extra) => Object.assign({ key, label, type: 'text' }, extra);
  const area = (key, label, extra) => Object.assign({ key, label, type: 'textarea' }, extra);
  const num = (key, label, extra) => Object.assign({ key, label, type: 'number' }, extra);
  const bool = (key, label, extra) => Object.assign({ key, label, type: 'bool' }, extra);
  const select = (key, label, options, extra) => Object.assign({ key, label, type: 'select', options }, extra);

  const ENABLED = ['Enabled', 'Disabled'];
  const IDENTITY = ['None', 'System assigned', 'User assigned', 'System + User assigned'];
  const TLS = ['1.2', '1.3', '1.0', '1.1'];

  /** Attributes shared by all Azure resources (prepended automatically). */
  const COMMON_RESOURCE_ATTRIBUTES = [
    select('location', 'Location', ['(inherit)'].concat(REGIONS.map((r) => r.id)), { default: '(inherit)' }),
    area('description', 'Description')
  ];

  /** Attributes for objects that are not Azure resources (external systems etc.). */
  const COMMON_GENERIC_ATTRIBUTES = [area('description', 'Description')];

  const NETWORK_ACCESS = select('publicNetworkAccess', 'Public network access', ENABLED.concat(['Selected networks']), { default: 'Enabled' });
  const MANAGED_IDENTITY = select('identity', 'Managed identity', IDENTITY, { default: 'None' });
  const PRIVATE_ENDPOINT = bool('privateEndpoint', 'Private endpoint');
  const DIAGNOSTICS = bool('diagnostics', 'Diagnostic settings');

  /** Attribute keys that imply a resource can be attached to virtual networks / subnets. */
  const NETWORK_ATTRIBUTE_KEYS = ['privateEndpoint', 'vnetIntegration', 'vnetMode'];
  /** Types a resource can be attached to (see `node.network` in AISBP.Model). */
  const NETWORK_TARGET_TYPES = ['virtual-network', 'subnet'];

  // ---------------------------------------------------------------------------
  // Naming rule presets. Rule shape:
  // { min, max, chars (regex character class body), lower?, start?, end?, noDoubleHyphen?,
  //   invalid? (explicitly forbidden characters when chars is omitted), scope, hint }
  // scope: 'global' | 'tenant' | 'subscription' | 'resourceGroup' | 'parent'
  // start: 'letter' | 'alnum' | 'letterOrDigit'; end: 'alnum' | 'alnumOrUnderscore' | 'notPeriod' | 'notPeriodOrSpace'
  // ---------------------------------------------------------------------------
  const R = {
    managementGroup: { min: 1, max: 90, chars: 'A-Za-z0-9_.()\\-', end: 'notPeriod', scope: 'tenant' },
    subscription: { min: 1, max: 64, invalid: '<>;|', scope: 'tenant' },
    resourceGroup: { min: 1, max: 90, chars: 'A-Za-z0-9_.()\\-', end: 'notPeriod', scope: 'subscription' },
    logicWorkflow: { min: 1, max: 80, chars: 'A-Za-z0-9_.()\\-', scope: 'resourceGroup' },
    automationAccount: { min: 6, max: 50, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', noDoubleHyphen: true, scope: 'resourceGroup' },
    automationRunbook: { min: 1, max: 63, chars: 'A-Za-z0-9_\\-', scope: 'parent' },
    webSite: { min: 2, max: 60, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', scope: 'global' },
    serverFarm: { min: 1, max: 60, chars: 'A-Za-z0-9\\-', scope: 'resourceGroup' },
    standardWorkflow: { min: 1, max: 43, chars: 'A-Za-z0-9_\\-', start: 'letter', scope: 'parent' },
    functionName: { min: 1, max: 128, chars: 'A-Za-z0-9_\\-', start: 'letter', scope: 'parent' },
    generic80: { min: 1, max: 80, chars: 'A-Za-z0-9_.()\\-', scope: 'resourceGroup' },
    child80: { min: 1, max: 80, chars: 'A-Za-z0-9_.()\\-', scope: 'parent' },
    apim: { min: 1, max: 50, chars: 'A-Za-z0-9\\-', start: 'letter', end: 'alnum', scope: 'global' },
    apimChild: { min: 1, max: 256, invalid: '*#&+:<>?', scope: 'parent' },
    apimBackend: { min: 1, max: 80, chars: 'A-Za-z0-9_\\-', start: 'letter', scope: 'parent' },
    apiCenter: { min: 3, max: 90, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', scope: 'resourceGroup' },
    messagingNamespace: { min: 6, max: 50, chars: 'A-Za-z0-9\\-', start: 'letter', end: 'alnum', scope: 'global' },
    sbEntity: { min: 1, max: 260, chars: 'A-Za-z0-9._\\-/', start: 'alnum', end: 'alnum', scope: 'parent' },
    sbSubscription: { min: 1, max: 50, chars: 'A-Za-z0-9._\\-', start: 'alnum', end: 'alnum', scope: 'parent' },
    eventHub: { min: 1, max: 256, chars: 'A-Za-z0-9._\\-', start: 'alnum', end: 'alnum', scope: 'parent' },
    consumerGroup: { min: 1, max: 50, chars: 'A-Za-z0-9._\\-', start: 'alnum', end: 'alnum', scope: 'parent' },
    eventGridTopic: { min: 3, max: 50, chars: 'A-Za-z0-9\\-', scope: 'resourceGroup' },
    eventGridSystemTopic: { min: 3, max: 128, chars: 'A-Za-z0-9\\-', scope: 'resourceGroup' },
    eventGridSubscription: { min: 3, max: 64, chars: 'A-Za-z0-9\\-', scope: 'parent' },
    relayChild: { min: 1, max: 260, chars: 'A-Za-z0-9._\\-', start: 'alnum', end: 'alnum', scope: 'parent' },
    storageAccount: { min: 3, max: 24, chars: 'a-z0-9', lower: true, scope: 'global' },
    storageContainer: { min: 3, max: 63, chars: 'a-z0-9\\-', lower: true, start: 'alnum', end: 'alnum', noDoubleHyphen: true, scope: 'parent' },
    storageTable: { min: 3, max: 63, chars: 'A-Za-z0-9', start: 'letter', scope: 'parent' },
    keyVault: { min: 3, max: 24, chars: 'A-Za-z0-9\\-', start: 'letter', end: 'alnum', noDoubleHyphen: true, scope: 'global' },
    appConfiguration: { min: 5, max: 50, chars: 'A-Za-z0-9_\\-', scope: 'global' },
    dataFactory: { min: 3, max: 63, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', noDoubleHyphen: true, scope: 'global' },
    appInsights: { min: 1, max: 260, invalid: '%&\\?/', end: 'notPeriodOrSpace', scope: 'resourceGroup' },
    logAnalytics: { min: 4, max: 63, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', scope: 'resourceGroup' },
    network: { min: 2, max: 64, chars: 'A-Za-z0-9_.\\-', start: 'alnum', end: 'alnumOrUnderscore', scope: 'resourceGroup' },
    network80: { min: 1, max: 80, chars: 'A-Za-z0-9_.\\-', start: 'alnum', end: 'alnumOrUnderscore', scope: 'resourceGroup' },
    subnet: { min: 1, max: 80, chars: 'A-Za-z0-9_.\\-', start: 'alnum', end: 'alnumOrUnderscore', scope: 'parent' },
    frontDoor: { min: 1, max: 260, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', scope: 'resourceGroup' },
    dnsZone: { min: 1, max: 253, chars: 'a-z0-9.\\-', lower: true, start: 'alnum', end: 'alnum', scope: 'resourceGroup' },
    cosmos: { min: 3, max: 44, chars: 'a-z0-9\\-', lower: true, start: 'alnum', end: 'alnum', scope: 'global' },
    sqlServer: { min: 1, max: 63, chars: 'a-z0-9\\-', lower: true, start: 'alnum', end: 'alnum', scope: 'global' },
    sqlDatabase: { min: 1, max: 128, invalid: '<>*%&:\\/?', end: 'notPeriodOrSpace', scope: 'parent' },
    redis: { min: 1, max: 63, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', noDoubleHyphen: true, scope: 'global' },
    managedIdentity: { min: 3, max: 128, chars: 'A-Za-z0-9_\\-', start: 'alnum', scope: 'resourceGroup' },
    containerRegistry: { min: 5, max: 50, chars: 'A-Za-z0-9', scope: 'global' },
    containerAppEnv: { min: 2, max: 60, chars: 'A-Za-z0-9\\-', start: 'letter', end: 'alnum', scope: 'resourceGroup' },
    containerApp: { min: 2, max: 32, chars: 'a-z0-9\\-', lower: true, start: 'letter', end: 'alnum', noDoubleHyphen: true, scope: 'resourceGroup' },
    cognitive: { min: 2, max: 64, chars: 'A-Za-z0-9\\-', start: 'alnum', end: 'alnum', scope: 'resourceGroup' },
    free: { min: 1, max: 256, scope: 'none' }
  };

  // ---------------------------------------------------------------------------
  // Icons (paths inside the MS Icons library, https://msicons.com/icons/...).
  // ---------------------------------------------------------------------------
  const I = {
    managementGroup: 'general/10011-icon-service-Management-Groups.svg',
    allResources: 'general/10001-icon-service-All-Resources.svg',
    subscription: 'general/10002-icon-service-Subscriptions.svg',
    resourceGroup: 'general/10007-icon-service-Resource-Groups.svg',
    logicApps: 'integration/02631-icon-service-Logic-Apps.svg',
    workflow: 'general/10852-icon-service-Workflow.svg',
    automationAccounts: 'management-governance/00039-icon-service-Automation-Accounts.svg',
    integrationAccount: 'integration/10218-icon-service-Integration-Accounts.svg',
    integrationEnvironment: 'integration/03345-icon-service-Integration-Environments.svg',
    businessProcess: 'integration/03637-icon-service-Business-Process-Tracking.svg',
    apim: 'integration/10042-icon-service-API-Management-Services.svg',
    apiCenter: 'web/03291-icon-service-API-Center.svg',
    apiConnection: 'integration/10048-icon-service-API-Connections.svg',
    customConnector: 'integration/10363-icon-service-Logic-Apps-Custom-Connector.svg',
    serviceBus: 'integration/10836-icon-service-Azure-Service-Bus.svg',
    eventGridTopic: 'integration/10206-icon-service-Event-Grid-Topics.svg',
    eventGridSystemTopic: 'integration/02073-icon-service-System-Topic.svg',
    eventGridDomain: 'integration/10215-icon-service-Event-Grid-Domains.svg',
    eventGridSubscription: 'integration/10221-icon-service-Event-Grid-Subscriptions.svg',
    eventHubs: 'analytics/00039-icon-service-Event-Hubs.svg',
    relay: 'integration/10209-icon-service-Relays.svg',
    dataFactory: 'integration/10126-icon-service-Data-Factories.svg',
    appConfiguration: 'integration/10219-icon-service-App-Configuration.svg',
    saas: 'integration/10213-icon-service-Software-as-a-Service.svg',
    functionApp: 'compute/10029-icon-service-Function-Apps.svg',
    appServicePlan: 'app-services/00046-icon-service-App-Service-Plans.svg',
    appService: 'app-services/10035-icon-service-App-Services.svg',
    containerAppsEnvironment: 'other/02989-icon-service-Container-Apps-Environments.svg',
    containerApp: 'other/02884-icon-service-Worker-Container-App.svg',
    containerRegistry: 'containers/10105-icon-service-Container-Registries.svg',
    storageAccount: 'storage/10086-icon-service-Storage-Accounts.svg',
    storageContainer: 'general/10839-icon-service-Storage-Container.svg',
    storageQueue: 'general/10840-icon-service-Storage-Queue.svg',
    storageTable: 'general/10841-icon-service-Table.svg',
    fileShare: 'storage/10400-icon-service-Azure-Fileshares.svg',
    cosmos: 'databases/10121-icon-service-Azure-Cosmos-DB.svg',
    sqlServer: 'databases/10132-icon-service-SQL-Server.svg',
    sqlDatabase: 'databases/10130-icon-service-SQL-Database.svg',
    redis: 'databases/10137-icon-service-Cache-Redis.svg',
    keyVault: 'security/10245-icon-service-Key-Vaults.svg',
    managedIdentity: 'identity/10227-icon-service-Managed-Identities.svg',
    appRegistration: 'identity/10232-icon-service-App-Registrations.svg',
    users: 'identity/10230-icon-service-Users.svg',
    groups: 'identity/10223-icon-service-Groups.svg',
    vnet: 'networking/10061-icon-service-Virtual-Networks.svg',
    subnet: 'networking/02742-icon-service-Subnet.svg',
    privateEndpoint: 'other/02579-icon-service-Private-Endpoints.svg',
    dnsZone: 'networking/10064-icon-service-DNS-Zones.svg',
    nsg: 'networking/10067-icon-service-Network-Security-Groups.svg',
    appGateway: 'networking/10076-icon-service-Application-Gateways.svg',
    frontDoor: 'networking/10073-icon-service-Front-Door-and-CDN-Profiles.svg',
    publicIp: 'networking/10069-icon-service-Public-IP-Addresses.svg',
    vnetGateway: 'networking/10063-icon-service-Virtual-Network-Gateways.svg',
    expressRouteCircuit: 'networking/10079-icon-service-ExpressRoute-Circuits.svg',
    firewall: 'networking/10084-icon-service-Firewalls.svg',
    dataGateway: 'networking/10070-icon-service-On-Premises-Data-Gateways.svg',
    appInsights: 'management-governance/00012-icon-service-Application-Insights.svg',
    logAnalytics: 'management-governance/00009-icon-service-Log-Analytics-Workspaces.svg',
    alerts: 'management-governance/00002-icon-service-Alerts.svg',
    openAi: 'ai-machine-learning/03438-icon-service-Azure-OpenAI.svg',
    code: 'general/10787-icon-service-Code.svg',
    file: 'general/10800-icon-service-File.svg',
    files: 'general/10801-icon-service-Files.svg',
    module: 'general/10855-icon-service-Module.svg',
    branch: 'general/10782-icon-service-Branch.svg',
    inputOutput: 'general/10813-icon-service-Input-Output.svg',
    serverFarm: 'general/10835-icon-service-Server-Farm.svg',
    versions: 'general/10845-icon-service-Versions.svg'
  };

  const RG = ['resource-group'];
  const ANYWHERE = [ROOT, 'azure-tenant', 'management-group', 'subscription', 'resource-group'];

  /**
   * The catalog. Order inside a category is the order shown in the palette.
   * Fields: label, category, icon, abbr, provider, parents, archimate, rule, attributes,
   * container (rendered as group even without children), pattern (default naming pattern),
   * nameMode ('convention' | 'custom'), seed (default short name for {name} token), azure (bool),
   * network (bool: can be attached to virtual networks / subnets; also derived automatically for
   * types with a private endpoint, VNet integration or VNet mode attribute).
   */
  const TYPES = {
    // ----- Hierarchy -----------------------------------------------------------
    'azure-tenant': {
      label: 'Azure Tenant', category: 'hierarchy', icon: I.groups, abbr: 'tenant',
      provider: 'Microsoft Entra ID', parents: [ROOT],
      archimate: 'Grouping', rule: R.free, azure: false, container: true, nameMode: 'custom', seed: 'Tenant',
      attributes: [text('tenantId', 'Tenant ID'), text('primaryDomain', 'Primary domain'), area('description', 'Description')]
    },
    'management-group': {
      label: 'Management Group', category: 'hierarchy', icon: I.managementGroup, abbr: 'mg',
      provider: 'Microsoft.Management/managementGroups', parents: [ROOT, 'azure-tenant', 'management-group'],
      archimate: 'Grouping', rule: R.managementGroup, container: true, pattern: '{abbr}-{name}', seed: 'platform',
      attributes: [text('displayName', 'Display name', { show: true }), area('policies', 'Policy assignments'), area('description', 'Description')]
    },
    subscription: {
      label: 'Subscription', category: 'hierarchy', icon: I.subscription, abbr: 'sub',
      provider: 'Microsoft.Subscription/aliases', parents: [ROOT, 'azure-tenant', 'management-group'],
      archimate: 'Grouping', rule: R.subscription, container: true, pattern: '{abbr}-{workload}-{env}-{instance}',
      attributes: [
        text('subscriptionId', 'Subscription ID'),
        select('offer', 'Offer', ['Enterprise Agreement', 'Microsoft Customer Agreement', 'Pay-As-You-Go', 'CSP', 'Dev/Test'], { show: false }),
        text('owner', 'Owner'),
        text('budget', 'Monthly budget'),
        area('policies', 'Policy assignments'),
        area('description', 'Description')
      ]
    },
    'resource-group': {
      label: 'Resource Group', category: 'hierarchy', icon: I.resourceGroup, abbr: 'rg',
      provider: 'Microsoft.Resources/resourceGroups', parents: ['subscription'],
      archimate: 'Grouping', rule: R.resourceGroup, container: true,
      attributes: [
        select('location', 'Location', REGIONS.map((r) => r.id), { default: 'westeurope', show: true }),
        select('lock', 'Resource lock', ['None', 'CanNotDelete', 'ReadOnly'], { default: 'None' }),
        area('description', 'Description')
      ]
    },

    // ----- Integration ---------------------------------------------------------
    'logic-app-consumption': {
      label: 'Logic App (Consumption)', category: 'integration', icon: I.logicApps, abbr: 'logic',
      provider: 'Microsoft.Logic/workflows', parents: RG, archimate: 'ApplicationProcess', rule: R.logicWorkflow,
      attributes: [
        select('state', 'State', ENABLED, { default: 'Enabled' }),
        select('trigger', 'Trigger', ['HTTP Request', 'Recurrence', 'Service Bus', 'Event Grid', 'Event Hubs', 'Blob Storage', 'SFTP', 'Other'], { show: true }),
        text('integrationAccount', 'Integration account'),
        MANAGED_IDENTITY, DIAGNOSTICS
      ]
    },
    'logic-app-standard': {
      label: 'Logic App (Standard)', category: 'integration', icon: I.logicApps, abbr: 'logic',
      provider: 'Microsoft.Web/sites (kind: workflowapp)', parents: RG, archimate: 'ApplicationComponent', rule: R.webSite,
      attributes: [
        select('sku', 'Hosting plan', ['WS1', 'WS2', 'WS3', 'App Service Environment v3', 'Hybrid'], { default: 'WS1', show: true }),
        text('appServicePlan', 'App Service plan'),
        text('storageAccount', 'Storage account'),
        bool('vnetIntegration', 'VNet integration'),
        NETWORK_ACCESS, PRIVATE_ENDPOINT, MANAGED_IDENTITY,
        select('runtime', 'Functions runtime', ['~4'], { default: '~4' }),
        DIAGNOSTICS
      ]
    },
    'logic-app-automation': {
      label: 'Logic Apps Automation', category: 'integration', icon: I.logicApps, abbr: 'logic',
      parents: RG, archimate: 'ApplicationComponent', rule: R.generic80,
      attributes: [select('sku', 'SKU', ['Automation'], { default: 'Automation', show: true })]
    },
    'logic-app-workflow': {
      label: 'Workflow (Standard)', category: 'integration', icon: I.workflow, abbr: 'wf',
      provider: 'Microsoft.Web/sites/workflows', parents: ['logic-app-standard'], archimate: 'ApplicationProcess',
      rule: R.standardWorkflow, pattern: '{name}', seed: 'workflow',
      attributes: [
        select('kind', 'Kind', ['Stateful', 'Stateless', 'Agentic'], { default: 'Stateful', show: true }),
        select('trigger', 'Trigger', ['HTTP Request', 'Recurrence', 'Service Bus', 'Event Grid', 'Event Hubs', 'Blob Storage', 'SFTP', 'Workflow call', 'Other'], { show: true }),
        area('description', 'Description')
      ]
    },
    'automation-account': {
      label: 'Automation Account', category: 'integration', icon: I.automationAccounts, abbr: 'aa',
      provider: 'Microsoft.Automation/automationAccounts', parents: RG, archimate: 'ApplicationComponent',
      rule: R.automationAccount,
      attributes: [
        select('sku', 'SKU', ['Free', 'Basic'], { default: 'Free', show: true }),
        NETWORK_ACCESS, MANAGED_IDENTITY, DIAGNOSTICS
      ]
    },
    'automation-runbook': {
      label: 'Automation Runbook', category: 'integration', icon: I.workflow, abbr: 'rb',
      provider: 'Microsoft.Automation/automationAccounts/runbooks', parents: ['automation-account'], archimate: 'ApplicationProcess',
      rule: R.automationRunbook, pattern: '{name}', seed: 'runbook',
      attributes: [
        text('runbookType', 'Runbook type', { show: true }),
        select('state', 'State', ['Published', 'Draft', 'Other'], { show: true }),
        area('description', 'Description')
      ]
    },
    'integration-account': {
      label: 'Integration Account', category: 'integration', icon: I.integrationAccount, abbr: 'ia',
      provider: 'Microsoft.Logic/integrationAccounts', parents: RG, archimate: 'ApplicationComponent', rule: R.logicWorkflow,
      attributes: [select('sku', 'SKU', ['Free', 'Basic', 'Standard', 'Premium'], { default: 'Standard', show: true })]
    },
    'integration-account-map': {
      label: 'Map', category: 'integration', icon: I.code, abbr: 'map', provider: 'Microsoft.Logic/integrationAccounts/maps',
      parents: ['integration-account'], archimate: 'Artifact', rule: R.child80, pattern: '{name}', seed: 'map',
      attributes: [select('mapType', 'Map type', ['XSLT', 'XSLT 2.0', 'XSLT 3.0', 'Liquid'], { show: true }), area('description', 'Description')]
    },
    'integration-account-schema': {
      label: 'Schema', category: 'integration', icon: I.file, abbr: 'schema', provider: 'Microsoft.Logic/integrationAccounts/schemas',
      parents: ['integration-account'], archimate: 'DataObject', rule: R.child80, pattern: '{name}', seed: 'schema',
      attributes: [select('schemaType', 'Schema type', ['XML', 'JSON', 'Flat file'], { default: 'XML' }), area('description', 'Description')]
    },
    'integration-account-partner': {
      label: 'Trading Partner', category: 'integration', icon: I.users, abbr: 'partner', provider: 'Microsoft.Logic/integrationAccounts/partners',
      parents: ['integration-account'], archimate: 'BusinessActor', rule: R.child80, pattern: '{name}', seed: 'partner',
      attributes: [text('qualifier', 'Business identity (qualifier:value)', { show: true }), area('description', 'Description')]
    },
    'integration-account-agreement': {
      label: 'B2B Agreement', category: 'integration', icon: I.versions, abbr: 'agreement', provider: 'Microsoft.Logic/integrationAccounts/agreements',
      parents: ['integration-account'], archimate: 'Contract', rule: R.child80, pattern: '{name}', seed: 'agreement',
      attributes: [select('agreementType', 'Agreement type', ['AS2', 'X12', 'EDIFACT'], { show: true }), text('hostPartner', 'Host partner'), text('guestPartner', 'Guest partner')]
    },
    'api-management': {
      label: 'API Management', category: 'integration', icon: I.apim, abbr: 'apim',
      provider: 'Microsoft.ApiManagement/service', parents: RG, archimate: 'ApplicationComponent', rule: R.apim,
      attributes: [
        select('sku', 'Tier', ['Consumption', 'Developer', 'Basic', 'Standard', 'Premium', 'Basic v2', 'Standard v2', 'Premium v2'], { default: 'Developer', show: true }),
        num('capacity', 'Units', { default: 1 }),
        select('vnetMode', 'Virtual network', ['None', 'External', 'Internal', 'VNet integration (v2)'], { default: 'None', show: true }),
        text('gatewayUrl', 'Custom domain'),
        text('publisherName', 'Publisher name'),
        text('publisherEmail', 'Publisher e-mail'),
        bool('zoneRedundant', 'Zone redundant'),
        bool('selfHostedGateway', 'Self-hosted gateway'),
        MANAGED_IDENTITY, DIAGNOSTICS
      ]
    },
    'apim-api': {
      label: 'API', category: 'integration', icon: I.inputOutput, abbr: 'api', provider: 'Microsoft.ApiManagement/service/apis',
      parents: ['api-management'], archimate: 'ApplicationInterface', rule: R.apimChild, pattern: '{name}', seed: 'api',
      attributes: [
        select('apiType', 'API type', ['REST', 'SOAP', 'GraphQL', 'WebSocket', 'gRPC', 'OData', 'MCP'], { default: 'REST', show: true }),
        text('path', 'URL suffix', { show: true }),
        text('version', 'Version'),
        text('backendUrl', 'Backend URL'),
        bool('subscriptionRequired', 'Subscription required', { default: true }),
        area('policies', 'Policies')
      ]
    },
    'apim-product': {
      label: 'Product', category: 'integration', icon: I.module, abbr: 'product', provider: 'Microsoft.ApiManagement/service/products',
      parents: ['api-management'], archimate: 'Product', rule: R.apimChild, pattern: '{name}', seed: 'product',
      attributes: [select('state', 'State', ['published', 'notPublished'], { default: 'published' }), bool('approvalRequired', 'Approval required'), bool('subscriptionRequired', 'Subscription required', { default: true })]
    },
    'apim-backend': {
      label: 'Backend', category: 'integration', icon: I.serverFarm, abbr: 'be', provider: 'Microsoft.ApiManagement/service/backends',
      parents: ['api-management'], archimate: 'ApplicationInterface', rule: R.apimBackend, pattern: '{name}', seed: 'backend',
      attributes: [text('url', 'URL', { show: true }), select('protocol', 'Protocol', ['http', 'soap']), bool('circuitBreaker', 'Circuit breaker')]
    },
    'api-center': {
      label: 'API Center', category: 'integration', icon: I.apiCenter, abbr: 'apic', provider: 'Microsoft.ApiCenter/services',
      parents: RG, archimate: 'ApplicationComponent', rule: R.apiCenter,
      attributes: [select('sku', 'Plan', ['Free', 'Standard'], { default: 'Free', show: true })]
    },
    'api-connection': {
      label: 'API Connection', category: 'integration', icon: I.apiConnection, abbr: 'con', provider: 'Microsoft.Web/connections',
      parents: RG, archimate: 'ApplicationInterface', rule: R.generic80,
      attributes: [
        text('connector', 'Connector', { show: true }),
        select('authentication', 'Authentication', ['Managed identity', 'OAuth', 'Connection string', 'Service principal', 'Basic', 'API key'], { show: true })
      ]
    },
    'custom-connector': {
      label: 'Custom Connector', category: 'integration', icon: I.customConnector, abbr: 'cc', provider: 'Microsoft.Web/customApis',
      parents: RG, archimate: 'ApplicationInterface', rule: R.generic80,
      attributes: [text('openApi', 'OpenAPI definition'), text('host', 'Host', { show: true })]
    },
    'data-factory': {
      label: 'Data Factory', category: 'integration', icon: I.dataFactory, abbr: 'adf', provider: 'Microsoft.DataFactory/factories',
      parents: RG, archimate: 'ApplicationComponent', rule: R.dataFactory, network: true,
      attributes: [
        select('integrationRuntime', 'Integration runtime', ['AutoResolve', 'Managed VNet', 'Self-hosted', 'Azure-SSIS'], { default: 'AutoResolve', show: true }),
        bool('gitIntegration', 'Git integration'), NETWORK_ACCESS, MANAGED_IDENTITY, DIAGNOSTICS
      ]
    },
    'integration-environment': {
      label: 'Integration Environment', category: 'integration', icon: I.integrationEnvironment, abbr: 'ie',
      provider: 'Microsoft.IntegrationSpaces/spaces', parents: RG, archimate: 'Grouping', rule: R.generic80,
      attributes: [text('applications', 'Applications', { show: true })]
    },
    'business-process': {
      label: 'Business Process Tracking', category: 'integration', icon: I.businessProcess, abbr: 'bp',
      provider: 'Microsoft.IntegrationSpaces/spaces/applications/businessProcesses', parents: ['integration-environment'],
      archimate: 'BusinessProcess', rule: R.child80, pattern: '{name}', seed: 'process',
      attributes: [area('stages', 'Stages'), text('dataExplorer', 'Data Explorer cluster')]
    },
    'app-configuration': {
      label: 'App Configuration', category: 'integration', icon: I.appConfiguration, abbr: 'appcs', provider: 'Microsoft.AppConfiguration/configurationStores',
      parents: RG, archimate: 'SystemSoftware', rule: R.appConfiguration,
      attributes: [select('sku', 'SKU', ['Free', 'Developer', 'Standard', 'Premium'], { default: 'Standard', show: true }), bool('purgeProtection', 'Purge protection'), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },

    // ----- Messaging & events ----------------------------------------------------
    'service-bus-namespace': {
      label: 'Service Bus Namespace', category: 'messaging', icon: I.serviceBus, abbr: 'sbns', provider: 'Microsoft.ServiceBus/namespaces',
      parents: RG, archimate: 'SystemSoftware', rule: R.messagingNamespace,
      attributes: [
        select('sku', 'Tier', ['Basic', 'Standard', 'Premium'], { default: 'Standard', show: true }),
        select('capacity', 'Messaging units (Premium)', ['1', '2', '4', '8', '16']),
        bool('zoneRedundant', 'Zone redundant'),
        bool('disableLocalAuth', 'Disable local (SAS) auth'),
        select('minimumTlsVersion', 'Minimum TLS', TLS, { default: '1.2' }),
        NETWORK_ACCESS, PRIVATE_ENDPOINT, DIAGNOSTICS
      ]
    },
    'service-bus-queue': {
      label: 'Service Bus Queue', category: 'messaging', icon: I.storageQueue, abbr: 'sbq', provider: 'Microsoft.ServiceBus/namespaces/queues',
      parents: ['service-bus-namespace'], archimate: 'TechnologyInterface', rule: R.sbEntity, pattern: '{abbr}-{name}', seed: 'orders',
      attributes: [
        select('maxSizeGB', 'Max size (GB)', ['1', '2', '3', '4', '5', '80']),
        text('lockDuration', 'Lock duration', { default: 'PT1M' }),
        num('maxDeliveryCount', 'Max delivery count', { default: 10 }),
        text('defaultMessageTimeToLive', 'Message TTL'),
        bool('requiresSession', 'Sessions', { show: true }),
        bool('duplicateDetection', 'Duplicate detection'),
        bool('deadLetteringOnExpiration', 'Dead-lettering on expiration'),
        text('forwardTo', 'Forward to')
      ]
    },
    'service-bus-topic': {
      label: 'Service Bus Topic', category: 'messaging', icon: I.branch, abbr: 'sbt', provider: 'Microsoft.ServiceBus/namespaces/topics',
      parents: ['service-bus-namespace'], archimate: 'TechnologyInterface', rule: R.sbEntity, pattern: '{abbr}-{name}', seed: 'events',
      attributes: [select('maxSizeGB', 'Max size (GB)', ['1', '2', '3', '4', '5', '80']), bool('supportOrdering', 'Support ordering'), bool('duplicateDetection', 'Duplicate detection'), text('defaultMessageTimeToLive', 'Message TTL')]
    },
    'service-bus-subscription': {
      label: 'Topic Subscription', category: 'messaging', icon: I.eventGridSubscription, abbr: 'sbts', provider: 'Microsoft.ServiceBus/namespaces/topics/subscriptions',
      parents: ['service-bus-topic'], archimate: 'TechnologyInterface', rule: R.sbSubscription, pattern: '{abbr}-{name}', seed: 'consumer',
      attributes: [area('filter', 'Filter (SQL / correlation)', { show: true }), num('maxDeliveryCount', 'Max delivery count', { default: 10 }), bool('requiresSession', 'Sessions'), text('forwardTo', 'Forward to')]
    },
    'event-grid-topic': {
      label: 'Event Grid Topic', category: 'messaging', icon: I.eventGridTopic, abbr: 'evgt', provider: 'Microsoft.EventGrid/topics',
      parents: RG, archimate: 'TechnologyService', rule: R.eventGridTopic,
      attributes: [select('inputSchema', 'Input schema', ['CloudEventSchemaV1_0', 'EventGridSchema', 'CustomEventSchema'], { default: 'CloudEventSchemaV1_0', show: true }), bool('disableLocalAuth', 'Disable local auth'), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },
    'event-grid-system-topic': {
      label: 'Event Grid System Topic', category: 'messaging', icon: I.eventGridSystemTopic, abbr: 'egst', provider: 'Microsoft.EventGrid/systemTopics',
      parents: RG, archimate: 'TechnologyService', rule: R.eventGridSystemTopic,
      attributes: [
        select('topicType', 'Source type', ['Storage Accounts', 'Service Bus', 'Event Hubs', 'Key Vault', 'App Configuration', 'API Management', 'Resource Groups', 'Azure Subscriptions', 'Container Registry', 'Other'], { show: true }),
        text('source', 'Source resource')
      ]
    },
    'event-grid-domain': {
      label: 'Event Grid Domain', category: 'messaging', icon: I.eventGridDomain, abbr: 'evgd', provider: 'Microsoft.EventGrid/domains',
      parents: RG, archimate: 'TechnologyService', rule: R.eventGridTopic,
      attributes: [select('inputSchema', 'Input schema', ['CloudEventSchemaV1_0', 'EventGridSchema', 'CustomEventSchema'], { default: 'CloudEventSchemaV1_0', show: true }), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },
    'event-grid-domain-topic': {
      label: 'Domain Topic', category: 'messaging', icon: I.eventGridTopic, abbr: 'evgdt', provider: 'Microsoft.EventGrid/domains/topics',
      parents: ['event-grid-domain'], archimate: 'TechnologyInterface', rule: R.eventGridSubscription, pattern: '{name}', seed: 'tenant',
      attributes: [area('description', 'Description')]
    },
    'event-grid-subscription': {
      label: 'Event Subscription', category: 'messaging', icon: I.eventGridSubscription, abbr: 'evgs', provider: 'Microsoft.EventGrid/eventSubscriptions',
      parents: ['event-grid-topic', 'event-grid-system-topic', 'event-grid-domain', 'event-grid-domain-topic'], archimate: 'TechnologyInterface',
      rule: R.eventGridSubscription, pattern: '{abbr}-{name}', seed: 'handler',
      attributes: [
        select('endpointType', 'Endpoint type', ['Webhook', 'Azure Function', 'Service Bus Queue', 'Service Bus Topic', 'Event Hubs', 'Storage Queue', 'Hybrid Connection', 'Logic App'], { show: true }),
        text('endpoint', 'Endpoint'),
        area('filters', 'Filters (event types / subject)'),
        select('deliverySchema', 'Delivery schema', ['CloudEventSchemaV1_0', 'EventGridSchema', 'CustomInputSchema']),
        num('maxDeliveryAttempts', 'Max delivery attempts', { default: 30 }),
        bool('deadLetter', 'Dead-letter destination')
      ]
    },
    'event-hubs-namespace': {
      label: 'Event Hubs Namespace', category: 'messaging', icon: I.eventHubs, abbr: 'evhns', provider: 'Microsoft.EventHub/namespaces',
      parents: RG, archimate: 'SystemSoftware', rule: R.messagingNamespace,
      attributes: [
        select('sku', 'Tier', ['Basic', 'Standard', 'Premium', 'Dedicated'], { default: 'Standard', show: true }),
        num('capacity', 'Throughput/processing units', { default: 1 }),
        bool('autoInflate', 'Auto-inflate'), bool('kafkaEnabled', 'Kafka endpoint', { default: true }), bool('zoneRedundant', 'Zone redundant'),
        NETWORK_ACCESS, PRIVATE_ENDPOINT, DIAGNOSTICS
      ]
    },
    'event-hub': {
      label: 'Event Hub', category: 'messaging', icon: I.eventHubs, abbr: 'evh', provider: 'Microsoft.EventHub/namespaces/eventhubs',
      parents: ['event-hubs-namespace'], archimate: 'TechnologyInterface', rule: R.eventHub, pattern: '{abbr}-{name}', seed: 'telemetry',
      attributes: [num('partitionCount', 'Partitions', { default: 2, show: true }), num('retentionDays', 'Retention (days)', { default: 1 }), bool('capture', 'Capture')]
    },
    'event-hub-consumer-group': {
      label: 'Consumer Group', category: 'messaging', icon: I.groups, abbr: 'cg', provider: 'Microsoft.EventHub/namespaces/eventhubs/consumergroups',
      parents: ['event-hub'], archimate: 'TechnologyInterface', rule: R.consumerGroup, pattern: '{name}', seed: 'reader',
      attributes: [area('description', 'Description')]
    },
    'relay-namespace': {
      label: 'Relay Namespace', category: 'messaging', icon: I.relay, abbr: 'rly', provider: 'Microsoft.Relay/namespaces',
      parents: RG, archimate: 'SystemSoftware', rule: R.messagingNamespace,
      attributes: [select('sku', 'Tier', ['Standard'], { default: 'Standard' }), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },
    'relay-hybrid-connection': {
      label: 'Hybrid Connection', category: 'messaging', icon: I.relay, abbr: 'hc', provider: 'Microsoft.Relay/namespaces/hybridConnections',
      parents: ['relay-namespace'], archimate: 'CommunicationNetwork', rule: R.relayChild, pattern: '{abbr}-{name}', seed: 'onprem',
      attributes: [text('endpoint', 'Endpoint host:port', { show: true }), bool('requiresClientAuthorization', 'Requires client authorization', { default: true })]
    },

    // ----- Compute & hosting -----------------------------------------------------
    'function-app': {
      label: 'Function App', category: 'compute', icon: I.functionApp, abbr: 'func', provider: 'Microsoft.Web/sites (kind: functionapp)',
      parents: RG, archimate: 'ApplicationComponent', rule: R.webSite,
      attributes: [
        select('plan', 'Hosting plan', ['Flex Consumption', 'Consumption', 'Premium (EP1)', 'Premium (EP2)', 'Premium (EP3)', 'Dedicated (App Service plan)', 'Container Apps'], { default: 'Flex Consumption', show: true }),
        select('runtime', 'Runtime stack', ['.NET (isolated)', 'Node.js', 'Python', 'Java', 'PowerShell', 'Custom handler'], { default: '.NET (isolated)', show: true }),
        text('runtimeVersion', 'Runtime version'),
        select('os', 'Operating system', ['Linux', 'Windows'], { default: 'Linux' }),
        text('storageAccount', 'Storage account'),
        bool('vnetIntegration', 'VNet integration'), NETWORK_ACCESS, PRIVATE_ENDPOINT, MANAGED_IDENTITY, DIAGNOSTICS
      ]
    },
    function: {
      label: 'Function', category: 'compute', icon: I.code, abbr: 'fn', provider: 'Microsoft.Web/sites/functions',
      parents: ['function-app'], archimate: 'ApplicationFunction', rule: R.functionName, pattern: '{name}', seed: 'ProcessOrder',
      attributes: [
        select('trigger', 'Trigger', ['HTTP', 'Timer', 'Service Bus', 'Event Grid', 'Event Hubs', 'Blob', 'Queue', 'Cosmos DB', 'Durable orchestration', 'Durable activity'], { show: true }),
        select('authLevel', 'Authorization level', ['function', 'anonymous', 'admin']),
        area('bindings', 'Bindings')
      ]
    },
    'app-service-plan': {
      label: 'App Service Plan', category: 'compute', icon: I.appServicePlan, abbr: 'asp', provider: 'Microsoft.Web/serverfarms',
      parents: RG, archimate: 'Node', rule: R.serverFarm,
      attributes: [
        select('sku', 'SKU', ['F1', 'B1', 'S1', 'P0v3', 'P1v3', 'P2v3', 'P3v3', 'P1mv3', 'WS1', 'WS2', 'WS3', 'EP1', 'EP2', 'EP3', 'I1v2', 'I2v2'], { default: 'P1v3', show: true }),
        select('os', 'Operating system', ['Linux', 'Windows'], { default: 'Linux' }), num('instances', 'Instances', { default: 1 }), bool('zoneRedundant', 'Zone redundant')
      ]
    },
    'app-service': {
      label: 'App Service (Web App)', category: 'compute', icon: I.appService, abbr: 'app', provider: 'Microsoft.Web/sites',
      parents: RG, archimate: 'ApplicationComponent', rule: R.webSite,
      attributes: [text('runtime', 'Runtime stack', { show: true }), text('appServicePlan', 'App Service plan'), bool('vnetIntegration', 'VNet integration'), NETWORK_ACCESS, PRIVATE_ENDPOINT, MANAGED_IDENTITY]
    },
    'container-apps-environment': {
      label: 'Container Apps Environment', category: 'compute', icon: I.containerAppsEnvironment, abbr: 'cae', provider: 'Microsoft.App/managedEnvironments',
      parents: RG, archimate: 'Node', rule: R.containerAppEnv, network: true,
      attributes: [select('plan', 'Plan', ['Consumption', 'Workload profiles'], { default: 'Workload profiles', show: true }), bool('internal', 'Internal only'), text('subnet', 'Infrastructure subnet'), bool('zoneRedundant', 'Zone redundant')]
    },
    'container-app': {
      label: 'Container App', category: 'compute', icon: I.containerApp, abbr: 'ca', provider: 'Microsoft.App/containerApps',
      parents: RG, archimate: 'ApplicationComponent', rule: R.containerApp,
      attributes: [
        text('environment', 'Environment'), text('image', 'Image', { show: true }),
        select('ingress', 'Ingress', ['External', 'Internal', 'Disabled'], { default: 'Internal' }),
        num('minReplicas', 'Min replicas', { default: 0 }), num('maxReplicas', 'Max replicas', { default: 10 }), MANAGED_IDENTITY
      ]
    },
    'container-registry': {
      label: 'Container Registry', category: 'compute', icon: I.containerRegistry, abbr: 'cr', provider: 'Microsoft.ContainerRegistry/registries',
      parents: RG, archimate: 'TechnologyService', rule: R.containerRegistry,
      attributes: [select('sku', 'SKU', ['Basic', 'Standard', 'Premium'], { default: 'Standard', show: true }), bool('adminUser', 'Admin user'), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },

    // ----- Data & storage --------------------------------------------------------
    'storage-account': {
      label: 'Storage Account', category: 'data', icon: I.storageAccount, abbr: 'st', provider: 'Microsoft.Storage/storageAccounts',
      parents: RG, archimate: 'TechnologyService', rule: R.storageAccount,
      attributes: [
        select('kind', 'Kind', ['StorageV2', 'BlockBlobStorage', 'FileStorage'], { default: 'StorageV2' }),
        select('performance', 'Performance', ['Standard', 'Premium'], { default: 'Standard' }),
        select('replication', 'Redundancy', ['LRS', 'ZRS', 'GRS', 'GZRS', 'RA-GRS', 'RA-GZRS'], { default: 'ZRS', show: true }),
        select('accessTier', 'Access tier', ['Hot', 'Cool', 'Cold']),
        bool('hierarchicalNamespace', 'Hierarchical namespace (Data Lake)'), bool('sftp', 'SFTP enabled'),
        bool('allowSharedKeyAccess', 'Allow shared key access'),
        select('minimumTlsVersion', 'Minimum TLS', TLS, { default: '1.2' }),
        NETWORK_ACCESS, PRIVATE_ENDPOINT, DIAGNOSTICS
      ]
    },
    'storage-container': {
      label: 'Blob Container', category: 'data', icon: I.storageContainer, abbr: 'blob', provider: 'Microsoft.Storage/storageAccounts/blobServices/containers',
      parents: ['storage-account'], archimate: 'DataObject', rule: R.storageContainer, pattern: '{name}', seed: 'inbound',
      attributes: [select('publicAccess', 'Public access', ['None', 'Blob', 'Container'], { default: 'None' }), bool('immutable', 'Immutability policy')]
    },
    'storage-queue': {
      label: 'Storage Queue', category: 'data', icon: I.storageQueue, abbr: 'stq', provider: 'Microsoft.Storage/storageAccounts/queueServices/queues',
      parents: ['storage-account'], archimate: 'TechnologyInterface', rule: R.storageContainer, pattern: '{name}', seed: 'jobs',
      attributes: [area('description', 'Description')]
    },
    'storage-table': {
      label: 'Storage Table', category: 'data', icon: I.storageTable, abbr: 'stt', provider: 'Microsoft.Storage/storageAccounts/tableServices/tables',
      parents: ['storage-account'], archimate: 'DataObject', rule: R.storageTable, pattern: '{name}', seed: 'state',
      attributes: [area('description', 'Description')]
    },
    'storage-file-share': {
      label: 'File Share', category: 'data', icon: I.fileShare, abbr: 'share', provider: 'Microsoft.Storage/storageAccounts/fileServices/shares',
      parents: ['storage-account'], archimate: 'DataObject', rule: R.storageContainer, pattern: '{name}', seed: 'exchange',
      attributes: [num('quotaGiB', 'Quota (GiB)', { show: true }), select('protocol', 'Protocol', ['SMB', 'NFS'], { default: 'SMB' })]
    },
    'cosmos-db': {
      label: 'Cosmos DB Account', category: 'data', icon: I.cosmos, abbr: 'cosmos', provider: 'Microsoft.DocumentDB/databaseAccounts',
      parents: RG, archimate: 'SystemSoftware', rule: R.cosmos,
      attributes: [
        select('api', 'API', ['NoSQL', 'MongoDB', 'Cassandra', 'Gremlin', 'Table', 'PostgreSQL'], { default: 'NoSQL', show: true }),
        select('capacityMode', 'Capacity mode', ['Serverless', 'Provisioned throughput', 'Autoscale']),
        select('consistency', 'Default consistency', ['Session', 'Strong', 'Bounded staleness', 'Consistent prefix', 'Eventual'], { default: 'Session' }),
        bool('multiRegionWrites', 'Multi-region writes'), NETWORK_ACCESS, PRIVATE_ENDPOINT
      ]
    },
    'sql-server': {
      label: 'SQL Server (logical)', category: 'data', icon: I.sqlServer, abbr: 'sql', provider: 'Microsoft.Sql/servers',
      parents: RG, archimate: 'SystemSoftware', rule: R.sqlServer,
      attributes: [bool('entraOnlyAuth', 'Microsoft Entra-only authentication', { default: true }), text('entraAdmin', 'Entra admin'), select('minimalTlsVersion', 'Minimum TLS', TLS, { default: '1.2' }), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },
    'sql-database': {
      label: 'SQL Database', category: 'data', icon: I.sqlDatabase, abbr: 'sqldb', provider: 'Microsoft.Sql/servers/databases',
      parents: ['sql-server'], archimate: 'Artifact', rule: R.sqlDatabase, pattern: '{abbr}-{name}', seed: 'integration',
      attributes: [
        select('sku', 'Service tier', ['Basic', 'Standard S0', 'Standard S1', 'General Purpose', 'General Purpose Serverless', 'Business Critical', 'Hyperscale'], { default: 'General Purpose Serverless', show: true }),
        text('maxSize', 'Max size'), select('backupRedundancy', 'Backup redundancy', ['Geo', 'Zone', 'Local']), bool('zoneRedundant', 'Zone redundant')
      ]
    },
    redis: {
      label: 'Azure Cache for Redis', category: 'data', icon: I.redis, abbr: 'redis', provider: 'Microsoft.Cache/redis',
      parents: RG, archimate: 'SystemSoftware', rule: R.redis,
      attributes: [select('sku', 'SKU', ['Basic C0', 'Standard C1', 'Premium P1', 'Enterprise E10'], { show: true }), NETWORK_ACCESS, PRIVATE_ENDPOINT]
    },

    // ----- Security & identity ---------------------------------------------------
    'key-vault': {
      label: 'Key Vault', category: 'security', icon: I.keyVault, abbr: 'kv', provider: 'Microsoft.KeyVault/vaults',
      parents: RG, archimate: 'SystemSoftware', rule: R.keyVault,
      attributes: [
        select('sku', 'SKU', ['Standard', 'Premium'], { default: 'Standard', show: true }),
        bool('rbacAuthorization', 'Azure RBAC authorization', { default: true }),
        num('softDeleteRetentionDays', 'Soft-delete retention (days)', { default: 90 }),
        bool('purgeProtection', 'Purge protection', { default: true }),
        NETWORK_ACCESS, PRIVATE_ENDPOINT, DIAGNOSTICS
      ]
    },
    'managed-identity': {
      label: 'User-assigned Managed Identity', category: 'security', icon: I.managedIdentity, abbr: 'id', provider: 'Microsoft.ManagedIdentity/userAssignedIdentities',
      parents: RG, archimate: 'ApplicationComponent', rule: R.managedIdentity,
      attributes: [area('roleAssignments', 'Role assignments', { show: true }), area('federatedCredentials', 'Federated credentials')]
    },
    'app-registration': {
      label: 'App Registration', category: 'security', icon: I.appRegistration, abbr: 'appreg', provider: 'Microsoft Entra ID (Graph)',
      parents: ANYWHERE, archimate: 'ApplicationComponent', rule: R.free, azure: false, pattern: '{abbr}-{workload}-{env}',
      attributes: [text('clientId', 'Application (client) ID'), area('appRoles', 'App roles / scopes', { show: true }), area('description', 'Description')]
    },

    // ----- Networking --------------------------------------------------------------
    'virtual-network': {
      label: 'Virtual Network', category: 'networking', icon: I.vnet, abbr: 'vnet', provider: 'Microsoft.Network/virtualNetworks',
      parents: RG, archimate: 'CommunicationNetwork', rule: R.network,
      attributes: [text('addressSpace', 'Address space', { default: '10.0.0.0/16', show: true }), text('dnsServers', 'DNS servers'), bool('ddosProtection', 'DDoS protection'), text('peerings', 'Peerings')]
    },
    subnet: {
      label: 'Subnet', category: 'networking', icon: I.subnet, abbr: 'snet', provider: 'Microsoft.Network/virtualNetworks/subnets',
      parents: ['virtual-network'], archimate: 'CommunicationNetwork', rule: R.subnet, pattern: '{abbr}-{name}', seed: 'integration',
      attributes: [
        text('addressPrefix', 'Address prefix', { default: '10.0.1.0/24', show: true }),
        select('delegation', 'Delegation', ['None', 'Microsoft.Web/serverFarms', 'Microsoft.App/environments', 'Microsoft.ContainerInstance/containerGroups', 'Microsoft.Sql/managedInstances', 'Microsoft.ApiManagement/service'], { default: 'None', show: true }),
        text('nsg', 'Network security group'), text('routeTable', 'Route table'), text('serviceEndpoints', 'Service endpoints')
      ]
    },
    'private-endpoint': {
      label: 'Private Endpoint', category: 'networking', icon: I.privateEndpoint, abbr: 'pep', provider: 'Microsoft.Network/privateEndpoints',
      parents: RG, archimate: 'TechnologyInterface', rule: R.network, network: true,
      attributes: [text('target', 'Target resource', { show: true }), select('groupId', 'Sub-resource', ['blob', 'queue', 'table', 'file', 'dfs', 'namespace', 'sites', 'vault', 'Gateway', 'sqlServer', 'Sql', 'configurationStores', 'topic', 'domain', 'registry'], { show: true }), text('subnet', 'Subnet'), text('privateDnsZone', 'Private DNS zone')]
    },
    'private-dns-zone': {
      label: 'Private DNS Zone', category: 'networking', icon: I.dnsZone, abbr: 'pdnsz', provider: 'Microsoft.Network/privateDnsZones',
      parents: RG, archimate: 'TechnologyService', rule: R.dnsZone, nameMode: 'custom', seed: 'privatelink.servicebus.windows.net', network: true,
      attributes: [area('vnetLinks', 'Virtual network links', { show: true })]
    },
    nsg: {
      label: 'Network Security Group', category: 'networking', icon: I.nsg, abbr: 'nsg', provider: 'Microsoft.Network/networkSecurityGroups',
      parents: RG, archimate: 'TechnologyService', rule: R.network80, network: true,
      attributes: [area('rules', 'Security rules')]
    },
    'application-gateway': {
      label: 'Application Gateway', category: 'networking', icon: I.appGateway, abbr: 'agw', provider: 'Microsoft.Network/applicationGateways',
      parents: RG, archimate: 'TechnologyService', rule: R.network80, network: true,
      attributes: [select('sku', 'SKU', ['Standard_v2', 'WAF_v2', 'Basic'], { default: 'WAF_v2', show: true }), num('capacity', 'Capacity / autoscale max', { default: 2 }), text('listeners', 'Listeners'), bool('zoneRedundant', 'Zone redundant')]
    },
    'front-door': {
      label: 'Front Door', category: 'networking', icon: I.frontDoor, abbr: 'afd', provider: 'Microsoft.Cdn/profiles',
      parents: RG, archimate: 'TechnologyService', rule: R.frontDoor,
      attributes: [select('sku', 'Tier', ['Standard', 'Premium'], { default: 'Premium', show: true }), bool('waf', 'WAF policy'), text('endpoints', 'Endpoints'), bool('privateLinkOrigins', 'Private Link origins')]
    },
    'public-ip': {
      label: 'Public IP Address', category: 'networking', icon: I.publicIp, abbr: 'pip', provider: 'Microsoft.Network/publicIPAddresses',
      parents: RG, archimate: 'TechnologyInterface', rule: R.network80,
      attributes: [select('sku', 'SKU', ['Standard', 'Basic'], { default: 'Standard' }), select('allocation', 'Allocation', ['Static', 'Dynamic'], { default: 'Static' }), text('dnsLabel', 'DNS label', { show: true })]
    },
    'virtual-network-gateway': {
      label: 'Virtual Network Gateway', category: 'networking', icon: I.vnetGateway, abbr: 'vgw', provider: 'Microsoft.Network/virtualNetworkGateways',
      parents: RG, archimate: 'TechnologyService', rule: R.network80, network: true,
      attributes: [select('gatewayType', 'Gateway type', ['VPN', 'ExpressRoute'], { default: 'VPN', show: true }), text('sku', 'SKU', { default: 'VpnGw1AZ' }), bool('activeActive', 'Active-active')]
    },
    'expressroute-circuit': {
      label: 'ExpressRoute Circuit', category: 'networking', icon: I.expressRouteCircuit, abbr: 'erc', provider: 'Microsoft.Network/expressRouteCircuits',
      parents: RG, archimate: 'TechnologyService', rule: R.network80, network: true,
      attributes: [
        select('tier', 'Tier', ['Standard', 'Premium', 'Local'], { show: true }),
        select('billingModel', 'Billing model', ['MeteredData', 'UnlimitedData'], { show: true }),
        num('bandwidth', 'Bandwidth (Mbps)'), text('peeringLocation', 'Peering location'), text('serviceProvider', 'Service provider')
      ]
    },
    firewall: {
      label: 'Azure Firewall', category: 'networking', icon: I.firewall, abbr: 'afw', provider: 'Microsoft.Network/azureFirewalls',
      parents: RG, archimate: 'TechnologyService', rule: R.network, network: true,
      attributes: [select('tier', 'Tier', ['Basic', 'Standard', 'Premium'], { default: 'Standard', show: true }), text('policy', 'Firewall policy')]
    },
    'data-gateway': {
      label: 'On-premises Data Gateway', category: 'networking', icon: I.dataGateway, abbr: 'odgw', provider: 'Microsoft.Web/connectionGateways',
      parents: RG, archimate: 'Node', rule: R.generic80,
      attributes: [text('gatewayInstallation', 'Gateway installation / cluster', { show: true })]
    },

    // ----- Monitoring -------------------------------------------------------------
    'application-insights': {
      label: 'Application Insights', category: 'monitoring', icon: I.appInsights, abbr: 'appi', provider: 'Microsoft.Insights/components',
      parents: RG, archimate: 'SystemSoftware', rule: R.appInsights,
      attributes: [text('workspace', 'Log Analytics workspace', { show: true }), num('samplingPercentage', 'Sampling %', { default: 100 }), bool('disableLocalAuth', 'Disable local auth')]
    },
    'log-analytics': {
      label: 'Log Analytics Workspace', category: 'monitoring', icon: I.logAnalytics, abbr: 'log', provider: 'Microsoft.OperationalInsights/workspaces',
      parents: RG, archimate: 'SystemSoftware', rule: R.logAnalytics,
      attributes: [select('sku', 'Pricing tier', ['PerGB2018', 'CapacityReservation'], { default: 'PerGB2018' }), num('retentionDays', 'Retention (days)', { default: 30, show: true })]
    },
    'alert-rule': {
      label: 'Alert Rule', category: 'monitoring', icon: I.alerts, abbr: 'alert', provider: 'Microsoft.Insights/metricAlerts | scheduledQueryRules',
      parents: RG, archimate: 'ApplicationEvent', rule: R.generic80,
      attributes: [select('severity', 'Severity', ['0 - Critical', '1 - Error', '2 - Warning', '3 - Informational', '4 - Verbose'], { show: true }), area('condition', 'Condition'), text('actionGroup', 'Action group')]
    },

    // ----- AI -----------------------------------------------------------------------
    'azure-openai': {
      label: 'Azure OpenAI / AI Foundry', category: 'ai', icon: I.openAi, abbr: 'oai', provider: 'Microsoft.CognitiveServices/accounts',
      parents: RG, archimate: 'ApplicationComponent', rule: R.cognitive,
      attributes: [area('deployments', 'Model deployments', { show: true }), select('sku', 'SKU', ['S0'], { default: 'S0' }), NETWORK_ACCESS, PRIVATE_ENDPOINT, MANAGED_IDENTITY]
    },

    // ----- External & on-premises ------------------------------------------------
    'external-system': {
      label: 'External System / SaaS', category: 'external', icon: I.saas, abbr: 'ext', provider: 'External',
      parents: ANYWHERE, archimate: 'ApplicationComponent', rule: R.free, azure: false, nameMode: 'custom', seed: 'External system',
      attributes: [text('vendor', 'Vendor / product', { show: true }), select('protocol', 'Protocol', ['HTTPS/REST', 'SOAP', 'SFTP', 'AS2', 'AMQP', 'Kafka', 'Database', 'File share', 'Other'], { show: true }), text('owner', 'Owner'), text('url', 'URL')]
    },
    'on-premises-system': {
      label: 'On-premises System', category: 'external', icon: I.serverFarm, abbr: 'onprem', provider: 'On-premises',
      parents: ANYWHERE, archimate: 'Node', rule: R.free, azure: false, nameMode: 'custom', seed: 'ERP system',
      attributes: [text('product', 'Product', { show: true }), select('connectivity', 'Connectivity', ['Data gateway', 'Hybrid connection', 'VPN', 'ExpressRoute', 'Internet', 'Self-hosted gateway'], { show: true }), text('site', 'Site / datacenter')]
    },
    'users': {
      label: 'Users / Clients', category: 'external', icon: I.users, abbr: 'users', provider: 'Actor',
      parents: ANYWHERE, archimate: 'BusinessActor', rule: R.free, azure: false, nameMode: 'custom', seed: 'Users',
      attributes: [text('channel', 'Channel', { show: true }), area('description', 'Description')]
    },

    'annotation-text': {
      label: 'Text', category: 'annotations', abbr: 'text', icon: null, parents: [ROOT], annotation: true,
      archimate: 'Artifact', rule: R.free, azure: false, nameMode: 'custom', seed: 'Text', attributes: []
    },
    'annotation-markdown': {
      label: 'Markdown', category: 'annotations', abbr: 'markdown', icon: null, parents: [ROOT], annotation: true,
      archimate: 'Artifact', rule: R.free, azure: false, nameMode: 'custom', seed: 'Markdown', attributes: []
    },
    'annotation-table': {
      label: 'Table', category: 'annotations', abbr: 'table', icon: null, parents: [ROOT], annotation: true,
      archimate: 'Artifact', rule: R.free, azure: false, nameMode: 'custom', seed: 'Table', attributes: []
    },

    // ----- Other ----------------------------------------------------------------------
    // Any Azure resource without a dedicated type, e.g. when loading an existing environment.
    'azure-resource': {
      label: 'Other Azure Resource', category: 'other', icon: I.allResources, abbr: 'res', provider: 'Any resource type',
      parents: RG, archimate: 'TechnologyService', rule: R.free, nameMode: 'custom', seed: 'resource',
      attributes: [text('resourceType', 'Resource type', { show: true }), text('kind', 'Kind'), text('sku', 'SKU')]
    }
  };

  // Finalize entries: ids, defaults and common attributes.
  Object.keys(TYPES).forEach((id) => {
    const t = TYPES[id];
    t.id = id;
    if (t.azure === undefined) t.azure = true;
    t.container = !!t.container;
    t.network = !!t.network || (t.attributes || []).some((a) => NETWORK_ATTRIBUTE_KEYS.indexOf(a.key) !== -1);
    const common = t.annotation ? [] : t.azure && id !== 'resource-group' && t.category !== 'hierarchy' ? COMMON_RESOURCE_ATTRIBUTES : t.azure ? [] : COMMON_GENERIC_ATTRIBUTES;
    const own = t.attributes || [];
    const seen = new Set(own.map((a) => a.key));
    // Common attributes come first, but an own attribute with the same key wins.
    t.attributes = common.filter((a) => !seen.has(a.key)).concat(own);
  });

  /** @returns {object|undefined} the type definition. */
  function get(typeId) {
    return Object.prototype.hasOwnProperty.call(TYPES, typeId) ? TYPES[typeId] : undefined;
  }

  /** @returns {object[]} all type definitions. */
  function all() {
    return Object.keys(TYPES).map((k) => TYPES[k]);
  }

  /** @returns {object[]} type definitions for a palette category. */
  function byCategory(categoryId) {
    return all().filter((t) => t.category === categoryId);
  }

  /**
   * Whether an object of `childType` may be placed inside an object of `parentType`.
   * @param {string|null} parentType parent type id, or null for the blueprint root.
   * @param {string} childType
   */
  function canContain(parentType, childType) {
    const child = get(childType);
    if (!child) return false;
    const parent = get(parentType);
    if (parent && parent.annotation) return false;
    if (child.annotation) return !parentType || !!(parent && (parent.container || all().some((t) => !t.annotation && t.parents.includes(parentType))));
    return child.parents.indexOf(parentType || ROOT) !== -1;
  }

  /** Types that may be placed directly inside a given parent type (null = root). */
  function childTypesOf(parentType) {
    return all().filter((t) => canContain(parentType, t.id));
  }

  /** Attribute definition lookup. */
  function attribute(typeId, key) {
    const t = get(typeId);
    return t ? t.attributes.find((a) => a.key === key) : undefined;
  }

  /** Whether objects of a type can be attached to virtual networks / subnets. */
  function supportsNetwork(typeId) {
    const t = get(typeId);
    return !!(t && t.network);
  }

  /** Region lookup by id. */
  function region(id) {
    return REGIONS.find((r) => r.id === id);
  }

  AISBP.Catalog = {
    ROOT,
    REGIONS,
    CATEGORIES,
    TYPES,
    get,
    all,
    byCategory,
    canContain,
    childTypesOf,
    attribute,
    region,
    supportsNetwork,
    NETWORK_TARGET_TYPES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Catalog;
})(typeof globalThis !== 'undefined' ? globalThis : this);
