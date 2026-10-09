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

Containers grow automatically to fit their contents. Drag objects to rearrange them. Dropping an
object on another container moves it there (if allowed). **Tidy up** arranges everything
automatically.

## Attributes

Every resource type has the attributes you would configure in Azure: SKU / tier, location, hosting
plan, networking, identity, and so on. Location is inherited from the resource group unless you
override it. You can add **custom attributes** (key/value) to any object.

The **eye icon** next to each attribute controls whether that attribute appears on the diagram
when the detail level is *Selected attributes*. A grey eye means the per-type default from
*Options › Diagram* applies. See [Diagram styles](Diagram-Styles.md).

## Connections

Drag the **○ handle** that appears on the selected object onto another object. Select a
connection to set its:

- **Type**: data flow, trigger / event, dependency, data access, network path, or association.
  These map to ArchiMate relationships.
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

## Projects

Projects are saved automatically, shortly after every change. **Open** lists your projects, where
you can open or delete them. **New** starts a blank blueprint or a copy of the sample. Use
**Export › Configuration package** for backups and to share blueprints with colleagues.
