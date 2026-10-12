# Configuration

## `js/config.js`

Hosting providers and teams can preconfigure an instance in `js/config.js`. Every setting is
optional.

```js
window.AISBP_CONFIG = {
  storage: {
    mode: 'local',                  // 'local' (browser, default) or 'server' (database via PHP API)
    apiUrl: 'server/php/api.php',
    apiKey: ''
  },
  defaults: {                       // defaults for NEW projects (merged into built-in defaults)
    naming: { tokens: { org: 'fabrikam', workload: 'integration', env: 'dev' } },
    diagram: { style: 'classic', detailLevel: 'selected' },
    icons: { baseUrl: 'icons/msicons/' }
  },
  exports: { embedDiagram: true }    // default for the export popup's embedding checkbox
};
```

## Footer

The footer always reads **"Community Project by Sonny Gillissen"**. This text is fixed and
cannot be configured.

## Embedded blueprints

`exports.embedDiagram` defaults to `true` and sets the initial **Embed complete blueprint**
checkbox in the export popup. Embedded SVG, PNG, PDF, draw.io and ArchiMate downloads carry a
complete configuration package, allowing **Import** to restore the original blueprint.
Set it to `false` to default to exports without this additional hidden data. Users can enable
or disable embedding for each export; this is a default, not a restriction.
It applies to exports of both existing and new projects; JSON packages remain complete backups.

The embedded package includes data hidden from the diagram. Review this setting before
sharing files externally. Disabling it does not remove the native attributes exported to
draw.io or ArchiMate. Background choices in the export popup are per-file overrides and do not
change project settings. See [Exports](Exports.md#embedded-blueprints).

## Icons

All resource icons come from [MS Icons](https://msicons.com/). By default they are loaded from
`https://msicons.com/icons/`. To run without internet access, or behind a firewall that blocks
msicons.com, mirror the icons next to the app:

```sh
node tools/mirror-icons.js        # or: npm run mirror-icons
```

This downloads every icon used by the catalog into `icons/msicons/`, from msicons.com or, as a
fallback, from the [MS Icons GitHub repository](https://github.com/DanielBradley1/msicons), and
writes an `ATTRIBUTION.txt`. Then set the icon base URL to `icons/msicons/`, either in
*Options › Icons* (per project) or in `defaults.icons.baseUrl` (for new projects). Requires
Node.js 18 or later.

If an icon can't be loaded, the app shows a neutral placeholder with the type's abbreviation, so
the designer stays fully usable offline.

## Content Security Policy

`index.html` ships with a restrictive Content Security Policy: scripts only from the app itself,
no inline scripts, and images from https/data/blob. If you host the icons on another
domain, they are already allowed (`img-src https:`). If your server sends its own CSP header,
make sure it permits the same.
