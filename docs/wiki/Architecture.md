# Architecture

AIS BluePrinter is written in **vanilla HTML5, CSS and JavaScript (ES2020)**. It has **no
frameworks, no runtime dependencies and no build step**: what's in the repository is what runs.
That keeps it transparent, easy to host anywhere (including `file://`), and free of supply-chain
risk.

## Repository layout

```
index.html              App shell (toolbar, panels, footer with branding and MS Icons credit)
css/app.css             All styles (CSS custom properties; light UI)
js/config.js            Deployment configuration (storage mode, branding, defaults)
js/core/                Pure logic, no DOM. Runs in the browser and in Node (unit tests).
  util.js               Ids, escaping, cloning, URL checks
  catalog.js            Resource types: hierarchy rules, attributes, naming rules, icons, ArchiMate types
  model.js              Project data model, mutations, clipboard, import validation (normalize)
  naming.js             Naming conventions: patterns, tokens, Azure rule enforcement and validation
  layout.js             Geometry: container sizes, attribute lines, hit testing, auto layout
  store.js              State container: undo/redo, gestures, selection, change events
  storage.js            Persistence adapters: localStorage (default) and the PHP API
js/render/
  svg.js                Diagram renderer (SVG string). Used by the canvas and all image exports.
  icons.js              MS Icons URLs, data-URI cache for self-contained exports
js/export/
  package.js            Configuration package (JSON) export/import
  drawio.js             draw.io (mxfile) export
  archimate.js          ArchiMate Model Exchange File Format export
  raster.js             PNG and PDF (minimal PDF writer, no library)
js/ui/                  Browser-only UI components
  dom.js                Tiny DOM helpers (h(), modal, toast, file reading)
  palette.js            Resource palette (click / drag)
  explorer.js           Hierarchy tree (drag to re-parent)
  canvas.js             Interactive canvas: pan/zoom, select, drag, connect, drop
  properties.js         Properties panel (naming, attributes, eye toggles, connections)
  dialogs.js            Options, Projects and Help dialogs
  exporter.js           Runs the exports and downloads the files
js/app.js               Bootstrap: wires store, storage, UI, actions, keyboard and clipboard
server/php/             Optional database storage (API, installer, schemas)
server/docker/          Docker image and compose files for the one-click installers
tools/mirror-icons.js   Downloads the MS Icons used by the catalog for offline hosting
tests/                  Unit tests (node:test)
docs/wiki/              This documentation
```

## Module pattern

Every script is an IIFE that registers itself on one global namespace, `AISBP`, and also exports
itself with `module.exports` when it runs in Node:

```js
(function (root) {
  'use strict';
  const AISBP = (root.AISBP = root.AISBP || {});
  const Util = AISBP.Util || (typeof require === 'function' ? require('./util.js') : null);
  // ...
  AISBP.Naming = { resolveName, validateName /* ... */ };
  if (typeof module !== 'undefined' && module.exports) module.exports = AISBP.Naming;
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

Why not ES modules? Browsers block module scripts on `file://`, and opening `index.html`
directly is a core requirement. Classic scripts load in the order listed in `index.html`
(core › render › export › ui › app).

## Data flow

```
 user action ──► app.actions / UI component
                    │
                    ▼
            store.change(label, fn)  ── snapshot for undo, emits 'change'
                    │
        ┌───────────┼───────────────────────────┐
        ▼           ▼                           ▼
   canvas.render  explorer / properties    autosave (debounced) ──► storage adapter
        │                                                         (localStorage or API)
        ▼
 Layout.compute ──► Render.renderContent (SVG string, all user text escaped)
```

- The **project** is a plain JSON object (see [Configuration package](Configuration-Package.md)).
  All mutations go through `Model` functions inside `store.change(...)`, so every change can be
  undone.
- During drags, `store.begin()` / `store.live()` / `store.commit()` update the canvas live and
  record a single undo step.
- **Derived data** (names, geometry and validation problems) is computed once per version, by
  `store.derived()`.
- The same renderer draws the on-screen canvas and the exports, so they look identical.

## Security principles

- All user text is escaped before it goes into SVG or XML (`Util.escapeXml`). The canvas is the
  only place that uses `innerHTML`, and it only inserts the renderer's SVG markup, which is
  escaped. All other UI components build DOM nodes with `h()` / `textContent`.
- Imports and clipboard payloads are untrusted: `Model.normalize` / `Model.sanitizeClipboard`
  validate ids, types, hierarchy, lengths and URLs, and protect against prototype pollution.
- Image URLs (logo, icon base) are restricted to `http(s)`, relative paths and `data:image/...`.
- A Content Security Policy in `index.html` disallows inline and third-party scripts.
- The PHP API uses prepared statements, size limits, JSON-only bodies and an optional API key.

## Adding a resource type

1. Find the icon on [msicons.com](https://msicons.com/) and add its path to the `I` (icons)
   object in `js/core/catalog.js`.
2. Add an entry to `TYPES`:

   ```js
   'function-app': {
     label: 'Function App', category: 'compute', icon: I.functionApp, abbr: 'func',
     provider: 'Microsoft.Web/sites (kind: functionapp)',
     parents: RG,                       // allowed parent types (ROOT = top level)
     archimate: 'ApplicationComponent', // ArchiMate element type
     rule: R.webSite,                   // Azure naming rule (length, chars, scope, ...)
     attributes: [
       select('plan', 'Hosting plan', ['Flex Consumption', 'Premium (EP1)'], { default: 'Flex Consumption', show: true }),
       text('runtimeVersion', 'Runtime version'),
       bool('vnetIntegration', 'VNet integration'), MANAGED_IDENTITY
     ]
   },
   ```

   `show: true` means the attribute appears on the diagram by default at the *Selected
   attributes* level.
3. Run `npm test`. The tests check that every icon path is valid and that every type has a
   naming rule.
4. Regenerate [Resource catalog](Resource-Catalog.md) if you maintain it alongside the code.

## Tests

```sh
npm test            # = node --test (Node 18+; no dependencies to install)
```

Unit tests cover naming (patterns, overrides and Azure rules), the model (hierarchy rules,
copy/paste, import validation), undo/redo, storage, and all exporters (escaping, structure,
PDF cross-reference table). CI (`.github/workflows/ci.yml`) also lints the PHP code and runs an
API smoke test against MySQL.

## Coding conventions

- Vanilla JavaScript (ES2020), `'use strict'`, 2-space indentation, single quotes, semicolons.
- JSDoc on every module and public function. Comments explain *why*.
- Keep `js/core` free of DOM access, so it stays testable in Node.
- New external libraries need a very good reason. So far, none has been needed.
