# Diagram styles and detail levels

The canvas is the diagram. Anything you change is drawn straight away and exported the same way.

## Display styles

Pick a style from the **Style** box in the toolbar, or in *Options › Diagram*:

| Style | Look |
|---|---|
| **Azure (classic)** | Light background, Azure-blue containers, coloured hierarchy levels |
| **Blueprint** | White lines on a blueprint-blue background |
| **Minimal** | Monochrome and borderless, for documents and slides |
| **Dark** | Dark theme for presentations |
| **Whiteboard** | Hand-drawn look for workshops and early designs |

Connector styles: **orthogonal** (default), **straight** or **curved**.

## Detail levels

Pick a level from the **Detail** box in the toolbar:

| Level | Shows |
|---|---|
| **High-level (names only)** | Icons and names. Ideal for management overviews. |
| **Selected attributes** | Names plus the attributes you selected |
| **Detailed (all attributes)** | Every attribute that has a value |

### Choosing attributes (Selected attributes level)

- *Options › Diagram › Attributes shown by default per resource type* sets the defaults per type.
  For example, show *SKU* and *Hosting plan* for Logic Apps.
- The **eye icon** next to each attribute in the properties panel overrides the default for that
  single object. A grey eye means the type default is used. **Reset display** returns to the
  defaults.

### Hiding container levels

For a high-level view, hide whole container levels in *Options › Diagram › Hide container
levels*. For example, hide resource groups, subscriptions or Service Bus namespaces. Hidden
containers are not drawn, and their contents move up into the next visible level.

### Other options

- Show or hide resource type labels and connection labels.
- Show the title in exports.
- Snap to grid and set the grid size.
- PDF page size: fit to diagram, A4, A3 or Letter.
