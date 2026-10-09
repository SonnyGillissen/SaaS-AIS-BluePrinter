# Naming conventions

AIS BluePrinter generates Azure resource names from **patterns** and **tokens**, and checks them
against the **Azure naming rules** for each resource type.

## Patterns and tokens

Set these in **Options › Naming conventions**:

| Setting | Default | Used for |
|---|---|---|
| Resource pattern | `{abbr}-{workload}-{env}-{region}-{instance}` | Resource groups and top-level resources |
| Child resource pattern | `{abbr}-{name}` | Child resources (queues, topics, workflows, APIs, containers, …) |

Built-in tokens:

| Token | Value |
|---|---|
| `{abbr}` | Abbreviation of the resource type ([Cloud Adoption Framework](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations) defaults, e.g. `func`, `sbns`, `kv`, `st`). You can change it per type. |
| `{name}` | The object's name / purpose, e.g. `orders` |
| `{org}`, `{workload}`, `{env}` | Global values (defaults `contoso`, `integration`, `dev`) |
| `{region}` | Abbreviation of the effective location (inherited from the resource group), e.g. `weu` for West Europe. You can change it per region. |
| `{instance}` | Automatic sequence number per type and naming scope, padded to *Instance number digits* (`001`) |
| `{parent}` | The resolved name of the parent object |
| `{type}` | The resource type id |
| *your own* | Add custom tokens (e.g. `{bu}` for business unit) under *Custom tokens* |

Example with the defaults: a Function App in a West Europe resource group is named
`func-integration-dev-weu-001`. A Service Bus queue named "orders" is named `sbq-orders`.

## Overrides: global › type › parent › object

The most specific value wins:

1. **Global** pattern and tokens (*Options › Naming conventions*).
2. **Per resource type** abbreviation and pattern (*Options › Per resource type*).
3. **Inherited tokens**: a token set on an ancestor applies to everything below it. For example,
   set `{env}` = `prd` on a subscription, or `{workload}` = `orders` on a resource group.
4. **Per object** (properties panel): override the pattern and any token for this object only,
   or switch **Naming** to *Custom name* and type the exact name.

## Azure naming rules

Each resource type has its Azure naming rule built in: length, allowed characters, case, how the
name must start and end, consecutive hyphens, and the uniqueness scope (global, tenant,
subscription, resource group or parent). The rules are listed in the
[Resource catalog](Resource-Catalog.md). Some examples:

| Type | Rule |
|---|---|
| Storage account | 3–24 characters, lowercase letters and digits only, globally unique |
| Key Vault | 3–24 characters, letters, digits and hyphens, starts with a letter, no `--`, globally unique |
| Service Bus namespace | 6–50 characters, starts with a letter, ends with a letter or digit, globally unique |
| Resource group | 1–90 characters, letters, digits, `_ . ( ) -`, can't end with a period |

With **Apply Azure naming rules automatically** turned on (the default), generated names are
adjusted to fit the rules:

- invalid characters are removed and names are lowercased where required;
- when a name is too long, the longest free-text token is shortened. The abbreviation,
  environment, region and instance are kept intact. For example, a storage account with workload `verylongworkloadname` becomes
  `stverylongworkldevweu001` instead of being cut off at the end.

The properties panel shows whether a name is valid, and lists any problems. Objects with
problems get a warning marker on the canvas. Names that must be unique within their scope are
checked for duplicates as well.

> The rules are based on Microsoft's
> [naming rules and restrictions for Azure resources](https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules).
> Global uniqueness (e.g. whether a storage account name is still free) can only be checked
> against your own blueprint, not against Azure.
