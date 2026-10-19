using './infrastructure-rg001.bicep'

param r0010_name = 'vnet-integration-dev-weu-001'

param r0010_properties = {
  addressSpace: {
    addressPrefixes: [
      '10.0.0.0/16'
    ]
  }
}

param r0010_location = 'westeurope'

param r0010_tags = {}

param r0001_name = 'snet-integration'

param r0001_properties = {
  addressPrefix: '10.0.1.0/24'
}

param r0002_name = 'stintegrationdevweu001'

param r0002_properties = {
  allowSharedKeyAccess: false
  supportsHttpsTrafficOnly: true
  allowBlobPublicAccess: false
  minimumTlsVersion: 'TLS1_2'
  publicNetworkAccess: 'Enabled'
}

param r0002_location = 'westeurope'

param r0002_tags = {}

param r0002_sku = {
  name: 'Standard_ZRS'
}

param r0002_kind = 'StorageV2'

param r0003_name = 'sbns-integration-dev-weu-001'

param r0003_properties = {
  disableLocalAuth: true
  minimumTlsVersion: '1.2'
  publicNetworkAccess: 'Enabled'
}

param r0003_location = 'westeurope'

param r0003_tags = {}

param r0003_sku = {
  name: 'Standard'
  tier: 'Standard'
}

param r0005_name = 'log-integration-dev-weu-001'

param r0005_properties = {
  sku: {
    name: 'PerGB2018'
  }
  retentionInDays: 30
}

param r0005_location = 'westeurope'

param r0005_tags = {}

param r0006_name = 'snet-integration2'

param r0006_properties = {
  addressPrefix: '10.0.2.0/24'
}

param r0007_name = 'nsg-integration-dev-weu-001'

param r0007_properties = {
  securityRules: []
}

param r0007_location = 'westeurope'

param r0007_tags = {
  'x\'\\\n\r\t\${resourceGroup().name}': '[concat(\'literal\',\'text\')]'
  controls: '\u{0}\u{8}\u{c}\u{7f}'
}

param r0008_name = 'sbq-orders'

param r0008_properties = {
  maxDeliveryCount: 10
  lockDuration: 'PT1M'
}

param r0011_name = 'sbt-events'

param r0011_properties = {}

param r0012_name = 'sbts-consumer'

param r0012_properties = {
  maxDeliveryCount: 10
}
