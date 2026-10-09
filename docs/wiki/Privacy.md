# Privacy

**By default, AIS BluePrinter runs entirely in your browser, and everything stays on your
machine.**

| Data | Where it is stored | Leaves your machine? |
|---|---|---|
| Blueprints (projects) | Your browser's `localStorage` (keys `aisbp.index`, `aisbp.project.<id>`, `aisbp.last`) | **No** |
| Preferences (branding, logo) | Your browser's `localStorage` (`aisbp.prefs`) | **No** |
| Exports (PNG, PDF, SVG, draw.io, ArchiMate, JSON) | Generated in the browser and downloaded to your computer | **No** |
| Clipboard | Your system clipboard (only when you copy) | **No** |

- There is no account, no cookies, no analytics or tracking, and no backend.
- The only network requests are for the **resource icons** from `msicons.com`. These are plain
  image downloads that contain no project data. To avoid them, use a
  [self-hosted icon mirror](Configuration.md#icons).
- `localStorage` belongs to the browser profile and the site's origin. Clearing your browser data
  deletes your blueprints. Export a configuration package regularly as a backup.
  *Options › Storage & privacy* shows how much space is used, and can delete all AIS BluePrinter
  data from the browser.

## Server mode

If an administrator enables the optional [database storage](Deployment-and-Database.md),
blueprints are stored in that organization's MySQL or SQL Server database instead. The
*Storage & privacy* tab and the footer indicator show which mode is active.
