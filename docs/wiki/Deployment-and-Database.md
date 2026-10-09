# Deployment and database

AIS BluePrinter has two storage modes:

| Mode | Where projects are stored | Requirements |
|---|---|---|
| **Browser (default)** | `localStorage` of the user's browser, on their own machine | None. Static files only. |
| **Server (optional)** | A **MySQL / MariaDB** or **Microsoft SQL Server / Azure SQL** database, via a small PHP API | PHP 8.1+ with PDO (`pdo_mysql` or `pdo_sqlsrv`) |

The browser mode needs no server-side code at all. See [Getting started](Getting-Started.md).

## One-click install with Docker

Requires [Docker](https://docs.docker.com/get-docker/) with Compose v2.

```sh
./install.sh mysql      # Apache + PHP + MySQL 8.4
./install.sh mssql      # Apache + PHP + SQL Server 2022 (Express edition)
```

```powershell
.\install.ps1 -Database mysql
.\install.ps1 -Database mssql -Port 8081
```

The installer:

1. generates random database passwords and an API key in `server/docker/.env`
   (kept on re-runs, and git-ignored);
2. builds the web image (`server/docker/Dockerfile`) with the right PDO driver;
3. starts the database and the web container
   (`server/docker/docker-compose.mysql.yml` / `docker-compose.mssql.yml`).

On start, the web container waits for the database, creates the database (SQL Server) and the
table, writes `server/php/config.php`, and switches `js/config.js` to server mode. Open
http://localhost:8080 when it's done.

To do it by hand: copy `server/docker/.env.example` to `server/docker/.env`, adjust it, and run
`docker compose -f server/docker/docker-compose.mysql.yml up -d --build`.

> SQL Server container images are subject to Microsoft's license terms (`ACCEPT_EULA`).
> `MSSQL_PID` defaults to *Express*; set `AISBP_MSSQL_PID` in `.env` to change it.

## Install on existing PHP hosting (web installer)

1. Upload all files to your web host (Apache, IIS, nginx with PHP-FPM, Azure App Service, …).
2. Create an empty database and a database user:
   - **MySQL**: `CREATE DATABASE aisbp CHARACTER SET utf8mb4; CREATE USER 'aisbp'@'%' IDENTIFIED BY '…'; GRANT ALL ON aisbp.* TO 'aisbp'@'%';`
   - **SQL Server / Azure SQL**: create a database and a login/user with `db_ddladmin`,
     `db_datareader` and `db_datawriter`.
3. Browse to `https://your-host/server/php/install.php`, choose the database type, enter the
   connection details, and click **Install**.

The installer tests the connection, creates the table, writes `server/php/config.php`, generates
an API key, switches `js/config.js` to server mode (if the file is writable; otherwise it shows
the snippet to paste), and creates `install.lock` so it can't run again. To re-run it, delete
`install.lock` and `config.php`.

For **Azure SQL**, tick *Encrypt connection*. The SQL Server option needs the
[Microsoft Drivers for PHP for SQL Server](https://learn.microsoft.com/sql/connect/php/download-drivers-php-sql-server)
(`pdo_sqlsrv`). `pdo_dblib` is used as a fallback when it's available.

### Scripted install (CI/CD, containers)

```sh
AISBP_DB_DRIVER=mysql AISBP_DB_HOST=db.example.com AISBP_DB_NAME=aisbp \
AISBP_DB_USER=aisbp AISBP_DB_PASSWORD=… AISBP_API_KEY=… php server/php/setup-cli.php
```

Optional variables: `AISBP_DB_PORT`, `AISBP_DB_ENCRYPT=1`, `AISBP_DB_TRUST_CERT=0`,
`AISBP_DB_CREATE=1` (SQL Server: create the database), and `AISBP_DB_WAIT` (seconds to wait
for the database). The script is idempotent. Then set `storage.mode = 'server'` and the API key
in `js/config.js`.

### Manual schema

The SQL scripts are in `server/php/schema/` (`mysql.sql`, `mssql.sql`). They create a single
table, `aisbp_projects` (`id`, `name`, `modified`, `data`, `updated_at`). Each project is stored
as one JSON document, in the same format as the [configuration package](Configuration-Package.md).

## API

`server/php/api.php` is a minimal JSON API used by the browser:

| Request | Result |
|---|---|
| `GET ?action=ping` | `{ ok, installed }` |
| `GET ?action=list` | `{ ok, projects: [{ id, name, modified }] }` |
| `GET ?action=load&id=…` | `{ ok, project }` |
| `POST ?action=save&id=…` (JSON body) | `{ ok }` |
| `POST ?action=delete&id=…` | `{ ok }` |

## Security notes

- All queries use **prepared statements**. Ids are validated, request bodies are limited to 5 MB,
  and they must be JSON (`Content-Type: application/json`), which also blocks cross-site form
  posts. The API is same-origin only (no CORS headers).
- The optional **API key** (`X-API-Key` header) is compared in constant time. Note that it is
  delivered to every browser that loads the app, so it's a basic guard, not user authentication.
  When the app is reachable from the internet, protect the whole site, for example with
  [App Service authentication (Microsoft Entra ID)](https://learn.microsoft.com/azure/app-service/overview-authentication-authorization),
  a reverse proxy, or web-server login.
- `server/php/.htaccess` (Apache) and `server/php/web.config` (IIS) block direct access to
  `config.php`, `lib.php`, `setup-cli.php`, `install.lock` and the schema files. On **nginx**, add
  an equivalent rule, for example:
  `location ~ ^/server/php/(config|config\.sample|lib|setup-cli)\.php$|install\.lock|/schema/ { deny all; }`
- Database errors are logged on the server and not returned to the browser.
