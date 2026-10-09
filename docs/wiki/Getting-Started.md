# Getting started

AIS BluePrinter is a set of static files (HTML, CSS and JavaScript) with **no build step and no
runtime dependencies**. Pick whichever way of running it suits you.

## 1. Open it locally (no server)

1. Download or clone the repository.
2. Double-click `index.html`, or open it in a modern browser (Edge, Chrome, Firefox or Safari).

That's it. Everything works from `file://`, including saving to `localStorage`, copy/paste and all
exports.

> Browsers keep `localStorage` per *origin*. Projects you save while using `file://` are not visible
> when you later open the app from `http://localhost`, and the other way round. Use **Export ›
> Configuration package** to move projects between them.

## 2. Serve it from any web server

Copy these files and folders to any static host: `index.html`, `assets/`, `css/`, `js/`, and
optionally `icons/`. For example:

- **Azure Static Web Apps** or **Azure Storage static website**: upload the files, done.
- **GitHub Pages**: enable Pages for the repository (branch `main`, folder `/`).
- **IIS / Apache / nginx**: copy the files into the web root.
- **Local development server**: `python3 -m http.server 8080` or `npx serve`, then browse to
  http://localhost:8080.

## 3. With a database (optional)

If you want projects stored centrally in **MySQL** or **Microsoft SQL Server**, use the one-click
installers:

```sh
./install.sh mysql        # or: ./install.sh mssql
```

```powershell
.\install.ps1 -Database mysql   # or: -Database mssql
```

See [Deployment and database](Deployment-and-Database.md) for the details and for installing on
existing PHP hosting.

## Your first blueprint

1. On first start a **sample landing zone** is loaded so you can explore. Use **New** to start
   with an empty blueprint, or a new copy of the sample.
2. Click **Function App** in the palette. AIS BluePrinter adds it to the selected (or the first)
   resource group, and creates the subscription and resource group for it if they don't exist yet.
   You can also drag palette items onto a container on the canvas.
3. Select the object. In the properties panel on the right you can change its name, naming
   tokens, attributes and parent.
4. Drag the small **○ handle** of an object onto another object to connect them.
5. Open **Options** to set your naming convention: organization, workload, environment and so on.
6. Use **Export** to download the diagram or the configuration package.
