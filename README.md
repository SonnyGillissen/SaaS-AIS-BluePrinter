# AIS BluePrinter

**Integration Architecture Made Simple.** A visual designer for **Azure Integration Services**
architectures. Click your environment together, and get an architecture diagram you can export to
**PNG, PDF, SVG, draw.io and ArchiMate**.

> 🔒 **Runs entirely in your browser.** By default, AIS BluePrinter stores everything in your
> browser's **`localStorage`** on your own machine. No account, no server, no tracking: your
> architecture never leaves your computer. (A database backend is [optional](docs/wiki/Deployment-and-Database.md).)

## Features

- **Build your environment the Azure way**: management groups › subscriptions › resource groups ›
  resources › child resources, with the hierarchy rules enforced. Includes 70+ resource types:
  Logic Apps, API Management, Service Bus, Event Grid, Event Hubs, Functions, Container Apps,
  Data Factory, Integration Accounts, storage, Key Vault, networking, monitoring, and more. Each
  type comes with the attributes you configure in Azure (SKU, plan, networking, identity, …), plus
  your own custom attributes.
- **Diagram = design**: the canvas *is* the diagram. Choose from 5 **display styles** (Azure
  classic, Blueprint, Minimal, Dark, Whiteboard) and 3 connector styles.
- **High-level or detailed**: choose which attributes appear on the diagram, per resource type or
  per object (eye toggle), switch between names-only, selected attributes or all attributes, and
  hide whole container levels for management views.
- **Tag Manager**: define tags (e.g. *Managed by: customer*) with suggested values and colours,
  assign them in bulk to management groups, subscriptions, resource groups and resources, or per
  object; tags are shown as coloured chips on the diagram and exported to draw.io and ArchiMate.
- **Naming conventions**: global patterns and tokens (`{abbr}-{workload}-{env}-{region}-{instance}`),
  per-type and per-object overrides, inherited tokens, and the **Azure naming rules** (length,
  characters, case, uniqueness) applied and validated automatically.
- **Copy/paste and drag-and-drop everywhere**: palette › canvas, canvas › container, explorer
  tree, Ctrl+C/V (also between tabs), duplicate, undo/redo.
- **Configuration package**: export and import the complete setup as an open JSON document.
- **Exports**: PNG, PDF, SVG, **draw.io** (editable, with containers and shape data) and
  **ArchiMate** (Open Group exchange format, validated against the official XSD).
- **Runs anywhere**: open `index.html` from disk, or host the static files anywhere (GitHub Pages,
  Azure Static Web Apps, IIS, Apache, nginx). Vanilla HTML/CSS/JS, **zero dependencies, no build
  step**.
- **Light and dark mode**: follows your operating system by default, or switch manually in the
  toolbar (*Theme*); the editor canvas follows it, exports keep the chosen display style. The choice is remembered in the browser (and in the database in server mode).
- **Optional database storage**: MySQL / MariaDB or SQL Server / Azure SQL, with one-click
  installers (Docker) and a web installer for existing PHP hosting.

## Quick start

```sh
git clone https://github.com/SonnyGillissen/SaaS-AIS-BluePrinter.git
cd SaaS-AIS-BluePrinter
# Option 1: just open index.html in your browser
# Option 2: serve it
python3 -m http.server 8080      # then browse to http://localhost:8080
```

**With a database** (optional, requires Docker):

```sh
./install.sh mysql               # or: ./install.sh mssql
```

```powershell
.\install.ps1 -Database mysql    # or: -Database mssql
```

See [Deployment and database](docs/wiki/Deployment-and-Database.md) for PHP hosting and the
web installer.

## Documentation

The full documentation lives in [`docs/wiki`](docs/wiki/Home.md):

[Getting started](docs/wiki/Getting-Started.md) ·
[User guide](docs/wiki/User-Guide.md) ·
[Naming conventions](docs/wiki/Naming-Conventions.md) ·
[Diagram styles](docs/wiki/Diagram-Styles.md) ·
[Exports](docs/wiki/Exports.md) ·
[Configuration package](docs/wiki/Configuration-Package.md) ·
[Resource catalog](docs/wiki/Resource-Catalog.md) ·
[Deployment and database](docs/wiki/Deployment-and-Database.md) ·
[Configuration](docs/wiki/Configuration.md) ·
[Architecture](docs/wiki/Architecture.md) ·
[Privacy](docs/wiki/Privacy.md) ·
[Credits](docs/wiki/Credits.md)

## Icons: MS Icons

All resource icons come from **[MS Icons](https://msicons.com/)**, a community project by
**Daniel Bradley** ([github.com/DanielBradley1/msicons](https://github.com/DanielBradley1/msicons)).
The icons are the official Microsoft Azure architecture icons, © Microsoft, used according to
Microsoft's [icon terms](https://learn.microsoft.com/azure/architecture/icons/). They are loaded
from msicons.com at runtime. For offline or intranet use, run `node tools/mirror-icons.js` to
host them yourself (see [Configuration](docs/wiki/Configuration.md#icons)).

## Credits

AIS BluePrinter is a **Community Project by Sonny Gillissen**, as shown in the footer of the app.

## Development

```sh
npm test        # unit tests (node:test, no dependencies to install)
```

See [Architecture](docs/wiki/Architecture.md) for the code structure, the module pattern, and
how to add resource types.

---

*Community Project by Sonny Gillissen.*
