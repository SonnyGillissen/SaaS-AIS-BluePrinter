# Exports

Use the **Export** menu in the toolbar. Exports are created in your browser and downloaded
directly; nothing is sent to a server.

Selecting a diagram format opens **Export options** before downloading. Choose whether to
embed the complete blueprint, then confirm **Export**, or cancel without creating a file.
Configuration package (JSON) exports download directly and always contain the full blueprint.

| Format | File | Use it for |
|---|---|---|
| **Configuration package** | `*.aisbp.json` | Backups, sharing, version control, re-importing (see [Configuration package](Configuration-Package.md)) |
| **PNG** | `*.png` | Documents, wikis, slides (rendered at 2× resolution) |
| **PDF** | `*.pdf` | Printing and sharing. Page size: *fit to diagram*, A4, A3 or Letter (*Options › Diagram*). |
| **SVG** | `*.svg` | Lossless vector image for web pages and further editing |
| **draw.io** | `*.drawio` | Further editing in [draw.io / diagrams.net](https://app.diagrams.net/) (web, desktop, VS Code extension) |
| **ArchiMate** | `*.archimate.xml` | Enterprise architecture tools: Archi, BiZZdesign, Sparx EA, MEGA, … |

Exports use the current display style, detail level and attribute selection, except draw.io and
ArchiMate, which always include *all* attributes as data. Selection handles and validation
markers are left out.

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

- Management groups, subscriptions, resource groups and parent resources become **draw.io
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
