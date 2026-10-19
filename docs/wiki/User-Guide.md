# User guide

## The screen

| Area | Purpose |
|---|---|
| **Toolbar** (top) | New / Open / Import / Export, undo and redo, copy and paste, delete, display style, detail level, zoom, *Tidy up*, Options and Help |
| **Palette** (left) | Resource types and canvas annotations, grouped by category. Use the search box to filter. |
| **Explorer** (left, second tab) | The hierarchy as a tree. Drag rows to move objects to another parent; drop palette items on a row to add a child. |
| **Canvas** (centre) | The live diagram. This *is* the architecture diagram that you export. |
| **Properties** (right) | Name, naming tokens, placement, attributes and connections of the selected object or connection. |
| **Footer** | "Community Project by Sonny Gillissen", the MS Icons credit and the storage indicator. |

## Building the hierarchy

Azure's resource hierarchy is enforced:

```
Azure Tenant (optional logical grouping)
├── Management group (optional, can be nested)
│   └── Subscription
│       └── Resource group
│           └── Resource (Logic App, Service Bus namespace, Function App, Key Vault, ...)
│               └── Child resource (workflow, queue, topic › subscription, API, container, ...)
└── Subscription (can also be directly under the tenant)
```

Management groups and subscriptions can also be placed directly at the top level. External
systems, on-premises systems and users can be placed at the top level or inside an Azure Tenant. The
[Resource catalog](Resource-Catalog.md) lists which parents each type accepts.

Set **Tenant ID** and **Primary domain** on an Azure Tenant to provide defaults for all Azure
management groups, subscriptions, resource groups and resources below it, including nested child
resources. Their **Tenant ID** and **Tenant domain** fields inherit these values when blank;
the properties panel shows the inherited defaults. Enter an explicit value to override a field,
or clear it to resume inheritance. External objects and annotations do not inherit tenant fields.
Inherited values update when the tenant changes or an object moves to another tenant; they are
not copied into each object's saved attributes. Use the eye toggles to show them on the diagram.
Draw.io and ArchiMate include the resolved values as metadata. Infrastructure exports use the
Tenant ID where required (such as Key Vault), not as an extra ARM property on unrelated resources.

Set **Subscription ID** on a Subscription to provide the same blank-to-inherit behavior for
its resource groups, resources and nested child resources. The properties panel shows the
inherited ID; explicit values override it, and clearing a value resumes inheritance. Defaults
follow the containing Subscription when its ID changes or resources move between subscriptions,
without copying IDs into saved child attributes. Eye toggles and diagram export metadata use
the resolved Subscription ID, just like the tenant fields.

There are several ways to add objects:

- **Click** a palette item. It's added to the selected object, the nearest container of the
  selection that accepts it, or the first matching container. If there is none, the missing
  subscription and resource group are created automatically.
- **Drag** a palette item onto the canvas. The container under the mouse is highlighted when it
  accepts the type.
- **Drag** a palette item onto a row in the explorer.
- Use **Add child…** in the properties panel.

Containers grow automatically to fit their contents. To make a container (management group,
subscription, resource group, …) larger, select it and drag the **resize grip** in its bottom-right
corner; it never shrinks below its contents. Drag objects to rearrange them. While you drag, every
container keeps its current boundary, so an object dropped anywhere inside its own container stays
there; dropping it on another container moves it there (if allowed). The **Tidy up** menu offers:

- **Tidy all**: arrange resources and reset saved arrow bends and fixed endpoint attachments together.
- **Tidy resources**: arrange resources and reset manually resized containers to the size they need,
  preserving saved arrow bends and attachments.
- **Tidy arrows**: reset saved arrow bends and fixed endpoint attachments without moving resources.

Each action is undoable in one step. Resource arrangement
orders sibling groups by directed data flows and triggers where possible, keeping
external producers to the left of the Azure hierarchy and consumers to the right.
Connected content is aligned on a common flow lane, with space for connection labels.
Dependency-only supporting resources are placed below their consumers to keep the main path clear.
Cycles retain a deterministic order; arranging resources does not change the hierarchy.
Loading the sample also applies this layout so resource sizes follow the current detail settings.

If an existing diagram still has awkward arrows after arranging resources, use **Tidy up › Tidy arrows**.
It clears all saved routing points and fixed endpoint
attachments so the scene-aware router can choose fresh paths. Resource positions, connection
endpoints, directions, labels and attributes are unchanged. **Undo** restores all manual routes
in one step. Choose **Tidy resources** to preserve manual routes when arranging resources.

## Text blocks and tables

Use **Text & Tables** at the bottom of the palette to add **Text**, **Markdown** or a **Table**, by clicking
or dragging it onto the canvas. Annotations can stand alone or sit inside a compatible container;
they are diagram content, not Azure resources.

**Double-click a text block** to edit it directly on the canvas. Markdown blocks provide a
formatting toolbar that inserts Markdown into the text field, plus a safe preview. You can also
edit content in **Properties** or choose **Edit on canvas** there. Outside editing mode, the
canvas displays rendered text, not an input field.
Choose **Markdown** for headings, bold, italic, code, lists and quotes;
**Text** displays literal text. Links are displayed as text; HTML and images are not rendered.
The default **Plain** theme has no visible box; **Pill**, **Card** and **Callout** provide
alternative appearances.

**Double-click a table** to open its pop-out editor, or select it and use **Edit Table** in
**Properties**. Table contents and adjustment controls are in this pop-out rather than crowded
into the side pane:

- Add, remove and reorder rows and columns.
- Sort a column ascending or descending, keeping the header row in place.
- Set a caption, header row, first-column headers and striped rows.
- Choose borders for all cells, rows and outline, outline only, or none.
- Adjust column widths, text alignment, font size, padding and theme.

Tables support up to **50 rows and 12 columns**, with up to **1,000 characters per cell**.
Column widths act as proportions when a table is manually resized.

Both editors keep changes in a draft until you choose **Save**. **Cancel**, closing the editor,
or **Escape** discards the draft. **Ctrl+Enter** (⌘+Enter on macOS) saves. Saving is a single
undoable change.

Drag the bottom-right resize handle to change an annotation's width and minimum height; height
always grows to fit the content. For text, **Reset size** in Properties restores automatic sizing.
For tables, select **Reset size on save** in the pop-out editor.
Text blocks and tables can be moved, copied, pasted and deleted like other objects, and edits
support undo/redo. Their content is saved with the blueprint and included in diagram exports.
SVG, PNG and PDF use the canvas renderer. Draw.io uses editable text/table labels with
approximate styling; ArchiMate retains annotation content and options as artifact properties
and documentation rather than recreating rich-text/table appearance. Embedded blueprints
preserve all annotation options for reimport.

## Attributes

Every resource type has the attributes you would configure in Azure: SKU / tier, location, hosting
plan, networking, identity, and so on. Location is inherited from the resource group unless you
override it. You can add **custom attributes** (key/value) to any object.

The **eye icon** next to each attribute controls whether that attribute appears on the diagram
when the detail level is *Selected attributes*. A grey eye means the per-type default from
*Options › Diagram* applies. See [Diagram styles](Diagram-Styles.md).

## Tags and the Tag Manager

Every object - management groups, subscriptions, resource groups and resources - can have
**tags** (name/value pairs such as *Managed by: customer*). Edit them in the **Tags** section of
the properties panel: suggestions come from the Tag Manager, and the *+ Managed by* style
buttons add a defined tag in one click. With several objects selected, *Tag the selection* sets a
tag on all of them.

**Options › Tag Manager** is the central place for tags:

- define tag names with **suggested values**, a **colour** and whether they are **shown on the
  diagram**; the *Used by* column counts the objects that have the tag;
- renaming a tag renames it on all objects; *Remove from objects* removes it everywhere;
- **Assign a tag to many objects**: set a tag on all Azure tenants, management groups & subscriptions, resource
  groups, Azure resources and/or external objects at once (optionally overwriting existing
  values).

Nothing is changed until you press *Save* (one undo step). On the diagram, tags are drawn as
coloured chips ("Key: Value") below the attributes of a resource or in the header of a container.
They wrap over up to three rows; further tags are summarised in a "+N" chip (hover for the list).
Tags are hidden at the *High-level* detail level and can be switched off with *Show tags*.

Azure limits are validated: at most 50 tags per object, names up to 512 characters without
`< > % & \ ? /` (names are case-insensitive, so *Env* and *env* are duplicates) and values up to
256 characters. Azure does not support tags on Azure tenants or management groups; there they are
documentation only. Older blueprints with the former "Tags (key=value per line)" attribute are converted
automatically when they are opened or imported.

## Virtual networks and subnets

Resources that can be placed in or connected to a virtual network have a **Virtual networks /
subnets** section in the properties panel. This includes resources with a private endpoint, VNet
integration or a VNet mode, such as Logic App (Standard), Function App, App Service, API
Management, Service Bus, Event Hubs, Storage, Key Vault, SQL and Cosmos DB. It also includes
networking resources such as Private Endpoint, Private DNS Zone, NSG, Application Gateway,
Firewall, VNet Gateway, Container Apps Environment and Data Factory.

Add a **Virtual Network** (with **Subnets**) from the *Networking* palette first. Then tick the
VNets and/or subnets the resource is attached to. A resource can be attached to several. On the
diagram they appear as a **Network** line, for example `vnet-integration-dev-weu-001 /
snet-integration`. Use the eye icon in the section header to hide that line. When you delete a VNet
or subnet, its links are removed. When you paste a resource, it keeps its links to existing
networks, or links to the pasted copies if the VNet/subnet was copied as well.

## Connections

Drag the **○ handle** that appears on the selected object onto another object. Select a
connection to set its:

- **Type**: data flow, trigger / event, dependency, data access, network path, or association.
  These map to ArchiMate relationships.
- **Direction**: *One-way* (source → target, the default) or *Bidirectional* (source ↔ target,
  drawn with an arrow head at both ends). *Reverse direction* swaps source and target.
- **Protocol** (HTTPS, AMQP, SFTP, AS2, Private Link, …) and a **label**.

Connections start with an automatic route. To adjust a line or arrow afterward, **select it
and drag one of its routing handles**. Small filled handles add points; larger outlined
handles move existing points. You can add several points to route around objects, using any
connector style (orthogonal, straight or curved).

Automatic orthogonal routes avoid unrelated resource tiles and container headers where a
clear path is available. Labels are placed on visible path segments rather than through
resource tiles. Saved routing points and endpoint attachments remain under your control;
use **Reset route** to return a manually routed connection to automatic routing.

**Drag a square endpoint handle** (source or arrow end) to snap it to the nearest edge of
its own object, without reconnecting to another object. The attachment is saved as an edge
and relative position, so it follows the object when moved or resized. The first routing or
endpoint drag fixes both current attachments; later routing edits no longer move the arrow.
Unedited connections continue to choose their attachments automatically.

**Double-click an outlined point** to remove it, or choose **Reset route** in Properties to
remove routing points without changing attachments. **Reset anchors** separately restores
automatic attachments without removing routing points. *Reverse direction* swaps attachments
and reverses routing points. Routing-point dragging respects the diagram's grid setting; press **Escape**
while dragging to cancel. Each completed drag is one undo step. Routes are saved with the
blueprint and included in exports. Draw.io uses fixed entry/exit positions; ArchiMate retains
attachments in embedded blueprint metadata when embedding is enabled.

## Copy, paste and drag-and-drop

- **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste the selection, including children and the
  connections between them. The clipboard content is JSON, so you can also paste between browser
  tabs, between projects, or into a text editor.
- Pasting a full **configuration package** (JSON) from the clipboard imports it as a new project.
- **Ctrl+D** duplicates the selection.
- Copies using naming conventions receive an unused number in their destination naming scope.
  Patterns with `{instance}` advance that number; patterns with `{name}` number the copied
  label instead. Custom names and patterns without either token are kept unchanged.
- When you paste, objects go into the selected container if it accepts them. Otherwise they go next
  to the originals.
- Drag-and-drop is supported everywhere: palette › canvas, palette › explorer, canvas › canvas
  (move or re-parent), explorer › explorer (re-parent). You can also drop a configuration package
  file (`.json`) or an exported PNG, PDF, SVG, draw.io or ArchiMate file with an embedded
  blueprint on the canvas to import it.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Delete / Backspace | Delete the selection |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut, paste |
| Ctrl+D | Duplicate |
| Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) | Undo / redo |
| Ctrl+A | Select everything |
| Ctrl+S | Save now (projects are also saved automatically) |
| Arrow keys (Shift = 10×) | Move the selection |
| Escape | Clear the selection |
| + / - / 0 / F | Zoom in, zoom out, reset zoom, fit to screen |
| Shift+drag | Select with a rectangle |
| Drag empty space / mouse wheel | Pan |
| Ctrl+wheel | Zoom |

On macOS, use ⌘ instead of Ctrl.

## Light and dark mode

The **Theme** selector in the toolbar switches the application between **System** (the default;
follows the light/dark setting of your operating system, also when it changes), **Light** and
**Dark**. The choice is remembered in this browser (`localStorage`). In server mode it is also
stored in the database, so it applies to everyone using that instance (there are no user
accounts). In the dark theme the editor canvas is dark too: light display styles (Azure classic,
Minimal, Whiteboard) are shown with dark colours while keeping their own fonts, corners and line
patterns. **Exports always use the chosen display style** as-is; pick the *Dark* or *Blueprint*
style if you want a dark exported diagram. The browser tab icon (favicon) switches to a light variant in the dark theme
so it stays visible.

## Action labels

Use **Labels › Show / Hide** in the toolbar to display text next to toolbar action icons or use
compact icon-only toolbar actions. The choice is remembered in this browser, independently of the blueprint
and server settings. Hidden labels remain available to screen readers, and tooltips identify
the actions. Submenu, dialog, properties, and other buttons keep their labels. Controls without
action icons and the zoom percentage also remain visible.

## Projects

Projects are saved automatically, shortly after every change. **Open** lists your projects, where
you can open or delete them. **New** starts a blank blueprint or a copy of the sample. Use
**Export › Configuration package** for backups and to share blueprints with colleagues.
