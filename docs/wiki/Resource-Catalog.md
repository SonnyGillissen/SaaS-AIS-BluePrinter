# Resource catalog

The resource types available in the palette, generated from [`js/core/catalog.js`](https://github.com/SonnyGillissen/SaaS-AIS-BluePrinter/blob/main/js/core/catalog.js). Icons come from [MS Icons](https://msicons.com/) (paths are relative to `https://msicons.com/icons/`). Naming rules follow the [Azure naming rules and restrictions](https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules); abbreviations follow the [Cloud Adoption Framework](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations).

## Hierarchy

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Management Group | `mg` | *(top level)*, Management Group | 1-90 characters; allowed: letters, digits_.()-; can't end with a period; unique in the tenant | Display name, Policy assignments, Description |
| Subscription | `sub` | *(top level)*, Management Group | 1-64 characters; not allowed: <>;\|; unique in the tenant | Subscription ID, Offer, Owner, Monthly budget, Policy assignments, Description |
| Resource Group | `rg` | Subscription | 1-90 characters; allowed: letters, digits_.()-; can't end with a period; unique in the subscription | Location, Resource lock, Tags (key=value per line), Description |

## Integration

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Logic App (Consumption) | `logic` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, State, Trigger, Integration account, Managed identity, Diagnostic settings |
| Logic App (Standard) | `logic` | Resource Group | 2-60 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Hosting plan, App Service plan, Storage account, VNet integration, Public network access, Private endpoint, Managed identity, Functions runtime, Diagnostic settings |
| Workflow (Standard) | `wf` | Logic App (Standard) | 1-43 characters; allowed: letters, digits_-; must start with a letter; unique in the parent resource | Location, Tags (key=value per line), Kind, Trigger, Description |
| Integration Account | `ia` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, SKU |
| Map | `map` | Integration Account | 1-80 characters; allowed: letters, digits_.()-; unique in the parent resource | Location, Tags (key=value per line), Map type, Description |
| Schema | `schema` | Integration Account | 1-80 characters; allowed: letters, digits_.()-; unique in the parent resource | Location, Tags (key=value per line), Schema type, Description |
| Trading Partner | `partner` | Integration Account | 1-80 characters; allowed: letters, digits_.()-; unique in the parent resource | Location, Tags (key=value per line), Business identity (qualifier:value), Description |
| B2B Agreement | `agreement` | Integration Account | 1-80 characters; allowed: letters, digits_.()-; unique in the parent resource | Location, Tags (key=value per line), Description, Agreement type, Host partner, Guest partner |
| API Management | `apim` | Resource Group | 1-50 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Tier, Units, Virtual network, Custom domain, Publisher name, Publisher e-mail, Zone redundant, Self-hosted gateway, Managed identity, Diagnostic settings |
| API | `api` | API Management | 1-256 characters; not allowed: *#&+:<>?; unique in the parent resource | Location, Tags (key=value per line), Description, API type, URL suffix, Version, Backend URL, Subscription required, Policies |
| Product | `product` | API Management | 1-256 characters; not allowed: *#&+:<>?; unique in the parent resource | Location, Tags (key=value per line), Description, State, Approval required, Subscription required |
| Backend | `be` | API Management | 1-80 characters; allowed: letters, digits_-; must start with a letter; unique in the parent resource | Location, Tags (key=value per line), Description, URL, Protocol, Circuit breaker |
| API Center | `apic` | Resource Group | 3-90 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Plan |
| API Connection | `con` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, Connector, Authentication |
| Custom Connector | `cc` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, OpenAPI definition, Host |
| Data Factory | `adf` | Resource Group | 3-63 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; no consecutive hyphens; globally unique | Location, Tags (key=value per line), Description, Integration runtime, Git integration, Public network access, Managed identity, Diagnostic settings |
| Integration Environment | `ie` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, Applications |
| Business Process Tracking | `bp` | Integration Environment | 1-80 characters; allowed: letters, digits_.()-; unique in the parent resource | Location, Tags (key=value per line), Description, Stages, Data Explorer cluster |
| App Configuration | `appcs` | Resource Group | 5-50 characters; allowed: letters, digits_-; globally unique | Location, Tags (key=value per line), Description, SKU, Purge protection, Public network access, Private endpoint |

## Messaging & Events

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Service Bus Namespace | `sbns` | Resource Group | 6-50 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Tier, Messaging units (Premium), Zone redundant, Disable local (SAS) auth, Minimum TLS, Public network access, Private endpoint, Diagnostic settings |
| Service Bus Queue | `sbq` | Service Bus Namespace | 1-260 characters; allowed: letters, digits._-/; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description, Max size (GB), Lock duration, Max delivery count, Message TTL, Sessions, Duplicate detection, Dead-lettering on expiration, Forward to |
| Service Bus Topic | `sbt` | Service Bus Namespace | 1-260 characters; allowed: letters, digits._-/; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description, Max size (GB), Support ordering, Duplicate detection, Message TTL |
| Topic Subscription | `sbts` | Service Bus Topic | 1-50 characters; allowed: letters, digits._-; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description, Filter (SQL / correlation), Max delivery count, Sessions, Forward to |
| Event Grid Topic | `evgt` | Resource Group | 3-50 characters; allowed: letters, digits-; unique in the resource group | Location, Tags (key=value per line), Description, Input schema, Disable local auth, Public network access, Private endpoint |
| Event Grid System Topic | `egst` | Resource Group | 3-128 characters; allowed: letters, digits-; unique in the resource group | Location, Tags (key=value per line), Description, Source type, Source resource |
| Event Grid Domain | `evgd` | Resource Group | 3-50 characters; allowed: letters, digits-; unique in the resource group | Location, Tags (key=value per line), Description, Input schema, Public network access, Private endpoint |
| Domain Topic | `evgdt` | Event Grid Domain | 3-64 characters; allowed: letters, digits-; unique in the parent resource | Location, Tags (key=value per line), Description |
| Event Subscription | `evgs` | Event Grid Topic, Event Grid System Topic, Event Grid Domain, Domain Topic | 3-64 characters; allowed: letters, digits-; unique in the parent resource | Location, Tags (key=value per line), Description, Endpoint type, Endpoint, Filters (event types / subject), Delivery schema, Max delivery attempts, Dead-letter destination |
| Event Hubs Namespace | `evhns` | Resource Group | 6-50 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Tier, Throughput/processing units, Auto-inflate, Kafka endpoint, Zone redundant, Public network access, Private endpoint, Diagnostic settings |
| Event Hub | `evh` | Event Hubs Namespace | 1-256 characters; allowed: letters, digits._-; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description, Partitions, Retention (days), Capture |
| Consumer Group | `cg` | Event Hub | 1-50 characters; allowed: letters, digits._-; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description |
| Relay Namespace | `rly` | Resource Group | 6-50 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Tier, Public network access, Private endpoint |
| Hybrid Connection | `hc` | Relay Namespace | 1-260 characters; allowed: letters, digits._-; must start with a letter or digit; must end with a letter or digit; unique in the parent resource | Location, Tags (key=value per line), Description, Endpoint host:port, Requires client authorization |

## Compute & Hosting

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Function App | `func` | Resource Group | 2-60 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Hosting plan, Runtime stack, Runtime version, Operating system, Storage account, VNet integration, Public network access, Private endpoint, Managed identity, Diagnostic settings |
| Function | `fn` | Function App | 1-128 characters; allowed: letters, digits_-; must start with a letter; unique in the parent resource | Location, Tags (key=value per line), Description, Trigger, Authorization level, Bindings |
| App Service Plan | `asp` | Resource Group | 1-60 characters; allowed: letters, digits-; unique in the resource group | Location, Tags (key=value per line), Description, SKU, Operating system, Instances, Zone redundant |
| App Service (Web App) | `app` | Resource Group | 2-60 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Runtime stack, App Service plan, VNet integration, Public network access, Private endpoint, Managed identity |
| Container Apps Environment | `cae` | Resource Group | 2-60 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Plan, Internal only, Infrastructure subnet, Zone redundant |
| Container App | `ca` | Resource Group | 2-32 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter; must end with a letter or digit; no consecutive hyphens; unique in the resource group | Location, Tags (key=value per line), Description, Environment, Image, Ingress, Min replicas, Max replicas, Managed identity |
| Container Registry | `cr` | Resource Group | 5-50 characters; allowed: letters, digits; globally unique | Location, Tags (key=value per line), Description, SKU, Admin user, Public network access, Private endpoint |

## Data & Storage

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Storage Account | `st` | Resource Group | 3-24 characters; allowed: lowercase letters, digits; lowercase only; globally unique | Location, Tags (key=value per line), Description, Kind, Performance, Redundancy, Access tier, Hierarchical namespace (Data Lake), SFTP enabled, Allow shared key access, Minimum TLS, Public network access, Private endpoint, Diagnostic settings |
| Blob Container | `blob` | Storage Account | 3-63 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter or digit; must end with a letter or digit; no consecutive hyphens; unique in the parent resource | Location, Tags (key=value per line), Description, Public access, Immutability policy |
| Storage Queue | `stq` | Storage Account | 3-63 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter or digit; must end with a letter or digit; no consecutive hyphens; unique in the parent resource | Location, Tags (key=value per line), Description |
| Storage Table | `stt` | Storage Account | 3-63 characters; allowed: letters, digits; must start with a letter; unique in the parent resource | Location, Tags (key=value per line), Description |
| File Share | `share` | Storage Account | 3-63 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter or digit; must end with a letter or digit; no consecutive hyphens; unique in the parent resource | Location, Tags (key=value per line), Description, Quota (GiB), Protocol |
| Cosmos DB Account | `cosmos` | Resource Group | 3-44 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter or digit; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, API, Capacity mode, Default consistency, Multi-region writes, Public network access, Private endpoint |
| SQL Server (logical) | `sql` | Resource Group | 1-63 characters; allowed: lowercase letters, digits-; lowercase only; must start with a letter or digit; must end with a letter or digit; globally unique | Location, Tags (key=value per line), Description, Microsoft Entra-only authentication, Entra admin, Minimum TLS, Public network access, Private endpoint |
| SQL Database | `sqldb` | SQL Server (logical) | 1-128 characters; not allowed: <>*%&:\/?; can't end with a period or space; unique in the parent resource | Location, Tags (key=value per line), Description, Service tier, Max size, Backup redundancy, Zone redundant |
| Azure Cache for Redis | `redis` | Resource Group | 1-63 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; no consecutive hyphens; globally unique | Location, Tags (key=value per line), Description, SKU, Public network access, Private endpoint |

## Security & Identity

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Key Vault | `kv` | Resource Group | 3-24 characters; allowed: letters, digits-; must start with a letter; must end with a letter or digit; no consecutive hyphens; globally unique | Location, Tags (key=value per line), Description, SKU, Azure RBAC authorization, Soft-delete retention (days), Purge protection, Public network access, Private endpoint, Diagnostic settings |
| User-assigned Managed Identity | `id` | Resource Group | 3-128 characters; allowed: letters, digits_-; must start with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Role assignments, Federated credentials |
| App Registration | `appreg` | *(top level)*, Management Group, Subscription, Resource Group | 1-256 characters | Application (client) ID, App roles / scopes, Description |

## Networking

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Virtual Network | `vnet` | Resource Group | 2-64 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, Address space, DNS servers, DDoS protection, Peerings |
| Subnet | `snet` | Virtual Network | 1-80 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the parent resource | Location, Tags (key=value per line), Description, Address prefix, Delegation, Network security group, Route table, Service endpoints |
| Private Endpoint | `pep` | Resource Group | 2-64 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, Target resource, Sub-resource, Subnet, Private DNS zone |
| Private DNS Zone | `pdnsz` | Resource Group | 1-253 characters; allowed: lowercase letters, digits.-; lowercase only; must start with a letter or digit; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Virtual network links |
| Network Security Group | `nsg` | Resource Group | 1-80 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, Security rules |
| Application Gateway | `agw` | Resource Group | 1-80 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, SKU, Capacity / autoscale max, Listeners, Zone redundant |
| Front Door | `afd` | Resource Group | 1-260 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Tier, WAF policy, Endpoints, Private Link origins |
| Public IP Address | `pip` | Resource Group | 1-80 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, SKU, Allocation, DNS label |
| Virtual Network Gateway | `vgw` | Resource Group | 1-80 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, Gateway type, SKU, Active-active |
| Azure Firewall | `afw` | Resource Group | 2-64 characters; allowed: letters, digits_.-; must start with a letter or digit; must end with a letter, digit or underscore; unique in the resource group | Location, Tags (key=value per line), Description, Tier, Firewall policy |
| On-premises Data Gateway | `odgw` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, Gateway installation / cluster |

## Monitoring

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Application Insights | `appi` | Resource Group | 1-260 characters; not allowed: %&\?/; can't end with a period or space; unique in the resource group | Location, Tags (key=value per line), Description, Log Analytics workspace, Sampling %, Disable local auth |
| Log Analytics Workspace | `log` | Resource Group | 4-63 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Pricing tier, Retention (days) |
| Alert Rule | `alert` | Resource Group | 1-80 characters; allowed: letters, digits_.()-; unique in the resource group | Location, Tags (key=value per line), Description, Severity, Condition, Action group |

## AI

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| Azure OpenAI / AI Foundry | `oai` | Resource Group | 2-64 characters; allowed: letters, digits-; must start with a letter or digit; must end with a letter or digit; unique in the resource group | Location, Tags (key=value per line), Description, Model deployments, SKU, Public network access, Private endpoint, Managed identity |

## External & On-premises

| Type | Abbr. | Allowed parents | Naming rule | Attributes |
|---|---|---|---|---|
| External System / SaaS | `ext` | *(top level)*, Management Group, Subscription, Resource Group | 1-256 characters | Description, Vendor / product, Protocol, Owner, URL |
| On-premises System | `onprem` | *(top level)*, Management Group, Subscription, Resource Group | 1-256 characters | Description, Product, Connectivity, Site / datacenter |
| Users / Clients | `users` | *(top level)*, Management Group, Subscription, Resource Group | 1-256 characters | Channel, Description |

Want another resource type? Add an entry to `TYPES` in `js/core/catalog.js` (see [Architecture](Architecture.md#adding-a-resource-type)).
