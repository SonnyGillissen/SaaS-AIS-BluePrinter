# Load from Azure

**Load from Azure** draws your real Azure environment as a new blueprint. You sign in with your
own Microsoft Entra app registration, pick the management groups, subscriptions and resource
groups to load, and AIS BluePrinter draws the hierarchy, the resources with their details, and
the connections between them.

Everything happens in your browser. The access token is kept in memory only, and the resources
are read directly from Azure Resource Manager with **your own permissions** (Reader is enough).
Nothing is changed in Azure, and nothing is sent to an AIS BluePrinter server.

## Requirements

- AIS BluePrinter must be served over **http(s)**, e.g. `http://localhost:8080` or your hosted
  instance. Signing in does not work when `index.html` is opened from disk (`file://`), because
  Microsoft can only redirect back to a web address.
- An app registration in Microsoft Entra ID (one-time setup, see below). No client secret is
  needed.
- Read access (e.g. the **Reader** role) on the scopes you want to load. Reading the management
  group hierarchy needs read access on the management groups; without it, subscriptions are
  shown without their management groups.

## One-time setup: app registration

1. In the Azure portal, open **Microsoft Entra ID › App registrations › New registration**.
2. Name it, e.g. *AIS BluePrinter*. Choose who can sign in (usually *Accounts in this
   organizational directory only*).
3. Under **Redirect URI**, select **Single-page application (SPA)** and enter the redirect URI
   shown in the *Load from Azure* dialog. By default it is `azure-callback.html` next to
   `index.html`, e.g. `https://blueprinter.contoso.com/azure-callback.html` or
   `http://localhost:8080/azure-callback.html`.
4. After creating it, open **API permissions › Add a permission › Azure Service Management** and
   add the delegated permission **user_impersonation**. Grant admin consent if your tenant
   requires it.
5. Copy the **Application (client) ID** from the overview page.

> The platform must be **Single-page application**. With the *Web* platform, sign-in fails with
> error `AADSTS9002326`.

Administrators can preconfigure the client id and tenant for everyone in
[`js/config.js`](Configuration.md#load-from-azure). Users can always enter their own.

## Loading an environment

1. Click **Load from Azure** in the toolbar (or **Load your Azure environment** on an empty
   canvas).
2. Enter the **Application (client) ID** and the **Tenant** (`organizations` signs you in to your
   home tenant; use a tenant ID or domain such as `contoso.onmicrosoft.com` for another tenant),
   then click **Sign in with Microsoft**. Sign in in the popup window. Both values are remembered
   in this browser.
3. The dialog shows your management groups and subscriptions as a tree. Expand a subscription to
   see its resource groups. Use the filter box to find items quickly.
4. Tick what to load:
   - a **management group** includes all management groups and subscriptions below it,
   - a **subscription** includes all of its resource groups,
   - **resource groups** can be picked individually.
5. Choose the options:
   - **Include child resources**: Logic App Standard workflows, functions, Service Bus queues,
     topics and subscriptions, event hubs and consumer groups, API Management APIs, products and
     backends, storage containers, queues, tables and file shares, Event Grid subscriptions,
     Relay hybrid connections, integration account artifacts, Azure OpenAI deployments and
     private DNS zone links. This needs extra requests and takes longer on large environments.
   - **Include other resource types**: resources without a dedicated type in the
     [resource catalog](Resource-Catalog.md) are drawn as **Other Azure Resource** (with their
     resource type). Uncheck to leave them out.
   - **Include supporting resources**: network interfaces, network watchers (and flow logs),
     private DNS zone virtual network links, deployment slots, VM extensions and smart detector
     alert rules are drawn as **Other Azure Resource**. Uncheck for a less busy diagram.
6. Click **Load into diagram**. The environment opens as a **new blueprint**; your current
   blueprint is saved first and stays available under **Open**.

You stay signed in while the browser tab is open. **Sign out** in the dialog forgets the token.

## What is drawn

| From Azure | In the blueprint |
|---|---|
| Management groups, subscriptions, resource groups | The hierarchy containers, with display name, subscription ID and location |
| Resources | The matching catalog type (e.g. Logic App Standard, Service Bus Namespace, Key Vault), with name, location, SKU/tier and other attributes, and the Azure tags |
| Child resources | Nested inside their parent (e.g. workflows inside the Logic App, queues inside the namespace) |
| Virtual networks and subnets | VNets with their subnets; VNet integration and private endpoints are attached to the subnets |
| Relations | Connections, e.g. *hosted on* (App Service plan), *private link* (private endpoint › resource), *peering*, *API connection*, *identity* (user-assigned managed identity), *logs* (Application Insights › workspace), *runs in* (Container Apps environment), *events* and *delivers* (Event Grid), *forwards* (Service Bus auto-forwarding), *backend* (API Management › app) and *monitors* (alert rules) |

Every object keeps its Azure **Resource ID** as a custom attribute, and is named with its real
name (*custom name* mode, so naming conventions do not rename it). Everything is arranged automatically; use **Tidy up**, drag objects, hide
attributes or change the [display style](Diagram-Styles.md) as with any blueprint.

Resources are read from Azure Resource Graph (with all properties) and cross-checked with the
Azure Resource Manager list of every selected resource group, so resources that Resource Graph
does not show (yet) are still drawn, without their properties.

After loading, the summary shows how many resources were drawn of how many were found. Any notes
are listed too, and are also written to the browser console. Notes cover:

- resources that were left out, per resource type, with the reason (an option was unchecked,
  their resource group was not loaded, or they are hidden system resources such as the SQL
  `master` database),
- resource or child resource lists that could not be read (usually missing permissions), and
- child lists that the resource does not offer (for example a stopped app).

## Troubleshooting

| Problem | Solution |
|---|---|
| *The sign-in window was blocked* | Allow popups for the AIS BluePrinter site and try again. |
| `AADSTS50011` (redirect URI mismatch) | Add the exact redirect URI shown in the dialog to the app registration as a **Single-page application** redirect URI. |
| `AADSTS9002326` | The redirect URI is registered under the *Web* platform; register it under **Single-page application**. |
| `AADSTS65001` (consent) | Grant consent for the **Azure Service Management › user_impersonation** permission, or ask an administrator. |
| No subscriptions | Check that you selected the right tenant and have at least Reader access. |
| Resources are missing | Check the notes in the summary after loading. Make sure **Include other resource types** and **Include supporting resources** are checked, and that you have Reader access to the resources (child resources such as workflows or queues need it on the parent). |
| Few connections or details | Azure Resource Graph was not available; resources were then read without their properties. Check the notes in the summary after loading. |

## Privacy

See [Privacy](Privacy.md#load-from-azure). In short: the sign-in goes to
`login.microsoftonline.com`, all reads go to `management.azure.com`, the token stays in the
memory of the browser tab, and the loaded blueprint is stored like any other blueprint.
