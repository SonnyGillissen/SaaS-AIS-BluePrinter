# User guide

## The screen

| Area | Purpose |
|---|---|
| **Toolbar** (top) | New / Open / Import / Export, undo and redo, copy and paste, delete, display style, detail level, zoom, *Tidy up*, Options and Help |
| **Palette** (left) | All resource types, grouped by category (Hierarchy, Integration, Messaging & Events, Compute & Hosting, Data & Storage, Security & Identity, Networking, Monitoring, AI, External & On-premises). Use the search box to filter. |
| **Explorer** (left, second tab) | The hierarchy as a tree. Drag rows to move objects to another parent; drop palette items on a row to add a child. |
| **Canvas** (centre) | The live diagram. This *is* the architecture diagram that you export. |
| **Properties** (right) | Name, naming tokens, placement, attributes and connections of the selected object or connection. |
| **Footer** | "Community Project by Sonny Gillissen", the MS Icons credit and the storage indicator. |

## Building the hierarchy

Azure's resource hierarchy is enforced:

```
Management group (optional, can be nested)
└── Subscription
    └── Resource group
        └── Resource (Logic App, Service Bus namespace, Function App, Key Vault, ...)
            └── Child resource (workflow, queue, topic › subscription, API, container, ...)
```

External systems, on-premises systems and users can be placed at the top level. The
[Resource catalog](Resource-Catalog.md) lists which parents each type accepts.

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
there; dropping it on another container moves it there (if allowed). **Tidy up** arranges
everything automatically and resets manually resized containers to the size they need.

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
- **Assign a tag to many objects**: set a tag on all management groups & subscriptions, resource
  groups, Azure resources and/or external objects at once (optionally overwriting existing
  values).

Nothing is changed until you press *Save* (one undo step). On the diagram, tags are drawn as
coloured chips ("Key: Value") below the attributes of a resource or in the header of a container.
They wrap over up to three rows; further tags are summarised in a "+N" chip (hover for the list).
Tags are hidden at the *High-level* detail level and can be switched off with *Show tags*.

Azure limits are validated: at most 50 tags per object, names up to 512 characters without
`< > % & \ ? /` (names are case-insensitive, so *Env* and *env* are duplicates) and values up to
256 characters. Azure does not support tags on management groups; there they are documentation
only. Older blueprints with the former "Tags (key=value per line)" attribute are converted
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

## Copy, paste and drag-and-drop

- **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste the selection, including children and the
  connections between them. The clipboard content is JSON, so you can also paste between browser
  tabs, between projects, or into a text editor.
- Pasting a full **configuration package** (JSON) from the clipboard imports it as a new project.
- **Ctrl+D** duplicates the selection.
- When you paste, objects go into the selected container if it accepts them. Otherwise they go next
  to the originals.
- Drag-and-drop is supported everywhere: palette › canvas, palette › explorer, canvas › canvas
  (move or re-parent), explorer › explorer (re-parent). You can also drop a configuration package
  file (`.json`) on the canvas to import it.

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

## Projects

Projects are saved automatically, shortly after every change. **Open** lists your projects, where
you can open or delete them. **New** starts a blank blueprint or a copy of the sample. Use
**Export › Configuration package** for backups and to share blueprints with colleagues.
