targetScope = 'resourceGroup'

param r0010_name string
param r0010_properties object
param r0010_location string
param r0010_tags object
param r0001_name string
param r0001_properties object
param r0002_name string
param r0002_properties object
param r0002_location string
param r0002_tags object
param r0002_sku object
param r0002_kind string
param r0003_name string
param r0003_properties object
param r0003_location string
param r0003_tags object
param r0003_sku object
param r0005_name string
param r0005_properties object
param r0005_location string
param r0005_tags object
param r0006_name string
param r0006_properties object
param r0007_name string
param r0007_properties object
param r0007_location string
param r0007_tags object
param r0008_name string
param r0008_properties object
param r0011_name string
param r0011_properties object
param r0012_name string
param r0012_properties object

resource r0010 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: r0010_name
  location: r0010_location
  tags: r0010_tags
  properties: union(r0010_properties, {
    subnets: [
      {
        name: r0001_name
        properties: r0001_properties
      }
      {
        name: r0006_name
        properties: r0006_properties
      }
    ]
  })
}

resource r0002 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: r0002_name
  location: r0002_location
  tags: r0002_tags
  sku: r0002_sku
  kind: r0002_kind
  properties: r0002_properties
}

resource r0003 'Microsoft.ServiceBus/namespaces@2021-11-01' = {
  name: r0003_name
  location: r0003_location
  tags: r0003_tags
  sku: r0003_sku
  properties: r0003_properties
}

resource r0005 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: r0005_name
  location: r0005_location
  tags: r0005_tags
  properties: r0005_properties
}

resource r0007 'Microsoft.Network/networkSecurityGroups@2023-11-01' = {
  name: r0007_name
  location: r0007_location
  tags: r0007_tags
  properties: r0007_properties
}

resource r0008 'Microsoft.ServiceBus/namespaces/queues@2021-11-01' = {
  parent: r0003
  name: r0008_name
  properties: r0008_properties
}

resource r0011 'Microsoft.ServiceBus/namespaces/topics@2021-11-01' = {
  parent: r0003
  name: r0011_name
  properties: r0011_properties
}

resource r0012 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2021-11-01' = {
  parent: r0011
  name: r0012_name
  properties: r0012_properties
}
