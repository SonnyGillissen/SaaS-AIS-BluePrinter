# Exports

Use the **Export** menu in the toolbar. Exports are created in your browser and downloaded
directly; nothing is sent to a server.

Selecting a diagram format opens **Export options** before downloading. Choose whether to
embed the complete blueprint, then confirm **Export**, or cancel without creating a file.
Configuration package (JSON) exports download directly and always contain the full blueprint.

| Format | File | Use it for |
|---|---|---|
| **Configuration package** | `*.aisbp.json` | Backups, sharing, version control, re-importing (see [Configuration package](Configuration-Package.md)) |
| **Bicep infrastructure** | `*.bicep` + `*.bicepparam` | Parameterized deployment definitions for the supported Azure resource subset |
| **ARM infrastructure** | `*.json` + `*.parameters.json` | Parameterized ARM deployment definitions; also importable |
| **PNG** | `*.png` | Documents, wikis, slides (rendered at 2× resolution) |
| **PDF** | `*.pdf` | Printing and sharing. Page size: *fit to diagram*, A4, A3 or Letter (*Options › Diagram*). |
| **SVG** | `*.svg` | Lossless vector image for web pages and further editing |
| **draw.io** | `*.drawio` | Further editing in [draw.io / diagrams.net](https://app.diagrams.net/) (web, desktop, VS Code extension) |
| **ArchiMate** | `*.archimate.xml` | Enterprise architecture tools: Archi, BiZZdesign, Sparx EA, MEGA, … |

Diagram exports use the current display style, detail level and attribute selection, except draw.io and
ArchiMate, which always include *all* attributes as data. Selection handles and validation
markers are left out.

## Infrastructure export and import

**Bicep infrastructure** and **ARM infrastructure** export deployment definitions, not pictures.
These actions are grouped at the bottom of the Export menu, below a divider.
The download dialog lists limitations and offers **Download all as ZIP**, containing every
deployment template, parameter file, scope manifest and instructions file for the selected
format and all resource groups. Extract the ZIP before deploying. ZIPs are created locally
in your browser without uploading files. Individual file download buttons remain available.
Download the template and its parameter file into the same directory. Review every note:
unsupported resources and settings are not silently converted into deployment instructions.
Warnings identify resources by their resolved diagram names rather than internal identifiers.

### Export coverage

| Resources | Pinned API | First-release boundaries |
|---|---|---|
| Service Bus namespace, queue, topic, topic subscription | `2021-11-01` | Basic/Standard/Premium tier checks; no authorization rules, filters or private endpoints |
| Storage account | `2023-05-01` | Standard StorageV2 only; no data-plane content or child services |
| Virtual network, subnet, network security group | `2023-11-01` | Address spaces/prefixes and selected settings; free-text NSG rules and subnet security associations need manual configuration |
| Log Analytics workspace | `2022-10-01` | PerGB2018 only; no capacity reservation or diagnostic settings |

Other catalog resources are reported as unsupported. Properties are mapped explicitly,
not copied blindly from the diagram. Missing mandatory configuration produces a required
parameter without a supplied value rather than an invented deployment value.
Subnets are declared inline in their VNet, not deployed as competing standalone updates.
When targeting an existing VNet, include all its subnets in the blueprint and inspect what-if:
an omitted existing subnet can otherwise be removed or cause the deployment to fail.

Exports are divided by resource group. Select the matching **existing** subscription and
resource group when deploying; tenants, management groups, subscriptions and resource groups
are organizational context, not newly provisioned resources. Resources without an appropriate
resource-group scope are reported rather than moved into an arbitrary group.
The separate `.deployment-scopes.json` file records the diagram's suggested target groups;
it is informational, not an ARM template. Download the `.instructions.txt` file as well.

Resource names, locations, SKUs, tags and mapped configuration values are parameters.
Edit the parameter file instead of editing generated resource definitions. Required values
that cannot be derived must be supplied before deployment. Resource types and API versions
are deliberately pinned schema identifiers, not user-configurable resource settings.
Secrets are not extracted from arbitrary diagram attributes or custom properties.
Do not put credentials in names, tags or other non-secret settings.

Only explicit parent/child resource relationships generate deployment dependencies.
Diagram arrows and network attachment drawings do **not** grant permissions, create private
endpoints, configure networking or imply deployment order. Review networking, identity,
diagnostics, authorization and application content separately.

The implementation follows resource-specific schemas and uses conservative security settings;
it is not a Microsoft certification or a guarantee of compliance with every organization's
policies. Validate generated Bicep with `az bicep build`, then use Azure deployment
validation and what-if with the intended scope and parameters before deployment.
Some service tiers, regions and settings require additional Azure-side validation.
See Microsoft's [Bicep best practices](https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices)
and [resource reference](https://learn.microsoft.com/azure/templates/).

### Import

Use **Import** to select an ARM template JSON. To supply parameter values, select the template
and its deployment `.parameters.json` file **together** in the file picker (in either order).
Native blueprint and embedded-diagram imports continue to work as before.

ARM import is a visualization of a supported subset, not an ARM expression interpreter or
a deployment engine. Parameter defaults and supplied values are used when supported;
unresolved expressions and unsupported constructs are reported. Inspect the import notes and
resource custom properties before using an imported diagram to generate infrastructure.

Direct Bicep parsing is intentionally not supported. Compile Bicep to ARM JSON with the
official Bicep CLI (`az bicep build --file main.bicep`), then import the resulting template.
An ARM deployment parameters JSON file is required for parameter overrides; `.bicepparam`
source files are not parsed by the browser. Compilation must be done locally; files are
not uploaded to a compiler service.

Terraform export/import is deferred. Arbitrary modules, loops, expressions, linked templates,
deployment scripts and provider-specific features are not promised to round-trip.
Infrastructure files contain no embedded blueprint or layout metadata. Keep a
`.aisbp.json` backup to preserve exact layout, connections and editor settings.

## Background options

The export popup offers **Style default**, **Custom color**, and, where supported,
**Transparent** backgrounds:

| Format | Custom color | Transparent |
|---|---|---|
| SVG, PNG, draw.io | Yes | Yes |
| PDF | Yes, including page margins | No; the diagram is encoded as an opaque JPEG |
| ArchiMate, JSON | Not applicable | Not applicable |

Background overrides apply only to the downloaded file, not to the saved blueprint or its
embedded configuration. They change the canvas/page background, not resource/container fills
or text colors. Transparent SVG/PNG exports omit the background grid.

**Tags** appear as coloured chips in PNG, PDF and SVG. In draw.io they become shape data
(`tag_<name>` properties) and native draw.io tags (`Name:Value`, spaces replaced by `_`), so you
can filter on them with *Edit › Edit Tags*/*Find*. In ArchiMate they are element properties
named `Tag: <name>`.

## Embedded blueprints

By default, SVG, PNG, PDF, draw.io and ArchiMate exports include the **complete configuration
package**, not just the visible diagram. Use **Import** or drop the exported file on the canvas
to recreate the blueprint, including its hierarchy, connections, positions, tags, naming rules
and display settings. JSON exports already contain the complete package.

The package is stored as inert SVG metadata, PNG text metadata, a PDF JSON attachment, or an
XML comment in draw.io and ArchiMate. The files still open normally in image viewers and their
respective diagram tools. This is similar to draw.io's embedded-diagram workflow, but the
embedded source is AIS BluePrinter JSON, not draw.io's `mxfile` format.

**Sharing warning:** the embedded package contains hidden containers and attributes as well as
visible data. To omit it, uncheck **Embed complete blueprint** in the export popup. Set
`exports.embedDiagram` to `false` in [`js/config.js`](Configuration.md#embedded-blueprints)
to make unchecked the default; users can enable it for individual files. JSON exports are always complete
packages; draw.io and ArchiMate still contain their normal native shape/element data.

Only exports carrying an AIS BluePrinter package can be restored this way. Ordinary images,
third-party draw.io/ArchiMate files and older flat exports cannot be reconstructed. Editing,
optimising or converting a file in another application may remove its embedded data; native
edits do not update the embedded blueprint. Keep a `.aisbp.json` backup for long-term storage.

## Icons in exports

For PNG, PDF, SVG and draw.io, AIS BluePrinter fetches the icons from MS Icons (or your
[icon mirror](Configuration.md#icons)) and embeds them, so the files are self-contained. If an
icon can't be fetched (offline, blocked network), PNG and PDF use a neutral placeholder with the
type abbreviation, while SVG and draw.io link to the icon URL instead. The export still succeeds
either way.

## draw.io

- Azure tenants, management groups, subscriptions, resource groups and parent resources become **draw.io
  containers**: moving a container moves its contents.
- Resources become image shapes with the MS Icons icon.
- All attributes, including the attached VNets/subnets (`network`), are attached as **shape data**
  (*Edit › Edit Data* in draw.io).
- Connections become labelled orthogonal edges. Bidirectional connections get arrow heads at both
  ends.

Open the file via *File › Open from › Device* in draw.io.

## ArchiMate

The export uses the **ArchiMate Model Exchange File Format** (The Open Group) and validates
against the official ArchiMate 3.1 XSD schemas.

- Every object becomes an ArchiMate element. Examples: management group / subscription / resource
  group = *Grouping*, Logic App (Standard) / Function App / API Management = *Application
  Component*, Service Bus namespace = *System Software*, queue / topic = *Technology Interface*,
  storage account = *Technology Service*, VNet / subnet = *Communication Network*, users =
  *Business Actor*.
- Attributes become **properties**.
- The Azure hierarchy becomes **Aggregation** (from groupings) and **Composition**
  relationships.
- Connections become relationships based on their type:

  | Connection type | ArchiMate relationship |
  |---|---|
  | Data flow | Flow |
  | Trigger / event | Triggering |
  | Dependency (uses) | Serving |
  | Data access | Access (only towards passive elements, otherwise Association) |
  | Network path, Association | Association |

- Bidirectional connections get a *Direction: Bidirectional* property, because ArchiMate
  relationships are always directed.
- Links from a resource to its VNets/subnets become **Association** relationships ("attached to
  network") and a *Network* property.
- One **view** is included, with the same layout as the blueprint.

To import into **Archi**, use *File › Import › Open Exchange XML Model…*.
