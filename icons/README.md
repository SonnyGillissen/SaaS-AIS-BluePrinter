# Self-hosted icon mirror (optional)

By default AIS BluePrinter loads its resource icons directly from [MS Icons](https://msicons.com/)
(community project by Daniel Bradley, icons © Microsoft). To run fully offline or in a network
that blocks msicons.com, run:

```sh
node tools/mirror-icons.js
```

This downloads the icons used by the catalog into `icons/msicons/` (ignored by git) and the
application then uses them automatically when you set `defaults.icons.baseUrl` to `'icons/msicons/'`
in `js/config.js` (or in *Options › Icons*).
