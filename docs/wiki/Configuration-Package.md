# Configuration package

A configuration package is the **complete** blueprint as one JSON document: the hierarchy,
every attribute, the connections, the layout, and all naming and diagram options. JSON is an open,
human-readable format. It's easy to diff in Git and to generate or process with scripts.

- **Export**: *Export › Configuration package* downloads `<name>.aisbp.json`.
- **Import**: use *Import* in the toolbar, drop the file on the canvas, or paste the JSON
  with Ctrl+V. If a blueprint with the same id already exists, you can replace it or import a copy.
- **Embedded exports**: by default the same package is embedded in PNG, PDF, SVG, draw.io and
  ArchiMate downloads. Import or drop these files to restore the blueprint. See
  [Exports](Exports.md#embedded-blueprints) for limitations and sharing considerations.

## Format

```jsonc
{
  "format": "ais-blueprinter",          // identifies the file type
  "version": 1,                          // format version
  "meta": {
    "id": "p1a2b3c4",                    // [A-Za-z0-9][A-Za-z0-9_-]{0,63}
    "name": "Order integration",
    "description": "", "author": "",
    "created": "2026-10-09T08:00:00.000Z",
    "modified": "2026-10-09T08:00:00.000Z",
    "seq": 12                            // last sequence number (stable ordering)
  },
  "settings": {
    "naming": {
      "pattern": "{abbr}-{workload}-{env}-{region}-{instance}",
      "childPattern": "{abbr}-{name}",
      "tokens": { "org": "contoso", "workload": "integration", "env": "dev" },
      "instancePadding": 3,
      "typePatterns": { "storage-account": "{abbr}{workload}{env}{instance}" },
      "abbreviations": { "function-app": "fa" },
      "regionAbbreviations": { "westeurope": "we" },
      "enforce": true
    },
    "diagram": {
      "style": "classic", "detailLevel": "selected", "connector": "orthogonal",
      "showTypeLabels": true, "showConnectionLabels": true, "showTitle": true, "showTags": true,
      "hiddenContainers": [], "typeDisplay": { "logic-app-standard": { "sku": true } },
      "snapToGrid": true, "gridSize": 10, "pdfPageSize": "fit"
    },
    "icons": { "baseUrl": "https://msicons.com/icons/" },
    "tags": {                            // Tag Manager definitions (suggestions, colour, visibility)
      "definitions": [{ "key": "Managed by", "values": ["customer", "provider"], "color": "#0078d4", "show": true }]
    }
  },
  "nodes": {
    "n1": {
      "id": "n1", "type": "resource-group", "parentId": "n0", "seq": 2,
      "label": "orders",                 // name / purpose ({name} token)
      "nameMode": "convention",          // or "custom" (then "name" is used as-is)
      "name": "",
      "naming": { "pattern": "", "tokens": { "workload": "orders" } },  // per-object overrides
      "attributes": { "location": "westeurope" },
      "custom": [{ "key": "Owner", "value": "Team A" }],
      "tags": [{ "key": "Managed by", "value": "customer" }],  // Azure tags (max. 50, names case-insensitive)
      "display": { "location": true },   // per-attribute diagram visibility overrides
      "network": [],                     // ids of attached virtual networks / subnets
      "x": 40, "y": 60,                   // position on the canvas
      "w": 600, "h": 400                  // optional manual container size (minimum; never smaller than its contents)
    }
  },
  "connections": {
    "c1": {
      "id": "c1", "from": "n5", "to": "n7", "kind": "flow",
      "direction": "forward",            // or "bidirectional"
      "label": "send order", "attributes": { "protocol": "AMQP" }
    }
  },
  "package": {                           // added on export, ignored on import
    "generator": "AIS BluePrinter", "generatorVersion": "1.0.0",
    "exported": "2026-10-09T08:00:00.000Z"
  }
}
```

The resource `type` ids and their attribute keys are listed in the
[Resource catalog](Resource-Catalog.md) and defined in `js/core/catalog.js`.

## Validation on import

Imports are validated and repaired, never trusted blindly:

- the package must be JSON with `"format": "ais-blueprinter"` and be at most 20 MB; embedded
  packages pass through the same validation as standalone JSON;
- ids must match the id pattern. Unknown resource types and connections to missing objects are
  dropped. Cycles in the hierarchy are broken. Objects in a parent that doesn't accept them are
  kept but flagged, so you can fix them. Each of these produces a warning.
- text is length-limited and numbers are checked; image and icon URLs are restricted to safe
  schemes;
- unknown properties are ignored, so you can add your own metadata without breaking anything.
