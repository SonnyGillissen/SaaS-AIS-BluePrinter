# Exports

Use the **Export** menu in the toolbar. Exports are created in your browser and downloaded
directly; nothing is sent to a server.

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
