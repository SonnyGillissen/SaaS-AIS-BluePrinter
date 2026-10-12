# Privacy

**By default, AIS BluePrinter runs entirely in your browser, and everything stays on your
machine.**

| Data | Where it is stored | Leaves your machine? |
|---|---|---|
| Blueprints (projects) | Your browser's `localStorage` (keys `aisbp.index`, `aisbp.project.<id>`, `aisbp.last`) | **No** |
| Preferences (light/dark theme) | Your browser's `localStorage` (key `aisbp.prefs`) | **No** |
| *Load from Azure* client ID and tenant | Your browser's `localStorage` (key `aisbp.azure`) | **No** |
| *Load from Azure* access token | Memory of the browser tab only (gone when the tab closes) | Only to Microsoft (see below) |
| Exports (PNG, PDF, SVG, draw.io, ArchiMate, JSON) | Generated in the browser and downloaded to your computer | **No** |
| Clipboard | Your system clipboard (only when you copy) | **No** |

- There is no account, no cookies, no analytics or tracking, and no backend.
- The only network requests are for the **resource icons** from `msicons.com`, and, only when
  you use it, [Load from Azure](#load-from-azure). These are plain
  image downloads that contain no project data. To avoid them, use a
  [self-hosted icon mirror](Configuration.md#icons).
- `localStorage` belongs to the browser profile and the site's origin. Clearing your browser data
  deletes your blueprints. Export a configuration package regularly as a backup.
  *Options › Storage & privacy* shows how much space is used, and can delete all AIS BluePrinter
  data from the browser.
- Diagram exports embed the complete blueprint by default, including hidden attributes and
  containers. Anyone receiving the file can recover this data with **Import**. Uncheck
  **Embed complete blueprint** in the export popup before sharing if this is unwanted.
  `exports.embedDiagram` in `js/config.js` sets the initial checkbox state, not a restriction.
  JSON packages remain complete, and draw.io/ArchiMate still include native
  shape/element data. See [Embedded blueprints](Exports.md#embedded-blueprints).

## Load from Azure

[Load from Azure](Load-from-Azure.md) only makes network requests when you use it:

- Signing in opens Microsoft's sign-in page (`login.microsoftonline.com`) in a popup, using the
  OAuth 2.0 authorization code flow with PKCE and your own app registration. No client secret
  is used, and AIS BluePrinter never sees your password.
- The access token is kept in the memory of the browser tab. It is never written to
  `localStorage`, a cookie, a blueprint, an export or a server, and it is only sent to Azure
  Resource Manager (`management.azure.com`).
- Your environment is read directly from Azure Resource Manager and Azure Resource Graph with
  your own permissions (read-only requests; the only POST requests are read queries).
- The loaded blueprint is stored like any other blueprint (in `localStorage`, or in the database
  in server mode). It contains resource names, IDs, tags and properties of your environment;
  treat its exports accordingly.

## Server mode

If an administrator enables the optional [database storage](Deployment-and-Database.md),
blueprints are stored in that organization's MySQL or SQL Server database instead. The
*Storage & privacy* tab and the footer indicator show which mode is active. The light/dark theme
preference is then also stored in the database (`aisbp_settings`), shared by everyone using that
instance.
