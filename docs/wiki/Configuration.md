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
  branding: {
    footerText: 'Sonny Gillissen',  // "Community Project by <footerText>"
    footerLogo: '',                 // image URL / relative path; replaces the text when set
    footerLink: ''                  // optional link (https://...)
  },
  defaults: {                       // defaults for NEW projects (merged into built-in defaults)
    naming: { tokens: { org: 'fabrikam', workload: 'integration', env: 'dev' } },
    diagram: { style: 'classic', detailLevel: 'selected' },
    icons: { baseUrl: 'icons/msicons/' }
  }
};
```

## Branding: footer text or logo

The footer always reads **"Community Project by Sonny Gillissen"**. You can replace the name
**"Sonny Gillissen"** with your own text, or with a **logo**:

- **Per user**: *Options › Branding*. Enter a name, a logo URL, or upload a logo (PNG, JPEG, SVG,
  GIF or WebP, up to 300 KB), and optionally a link. This is stored in the user's browser, not
  in the project.
- **Per deployment**: set `branding.footerLogo` in `js/config.js`, for example
  `footerLogo: 'assets/logo.svg'`. The text is then used as the logo's alternative text, for
  accessibility. Users can still override it in *Options › Branding*; *Restore defaults* goes
  back to the deployment values.

Logo URLs are restricted to `http(s)`, relative paths, and `data:image/...`, so script URLs are
rejected.

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
no inline scripts, and images from https/data/blob. If you host the icons or the logo on another
domain, they are already allowed (`img-src https:`). If your server sends its own CSP header,
make sure it permits the same.
