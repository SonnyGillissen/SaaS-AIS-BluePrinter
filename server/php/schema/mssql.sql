-- AIS BluePrinter - Microsoft SQL Server / Azure SQL schema.
-- Applied automatically by install.php / setup-cli.php; can also be run manually (sqlcmd / SSMS).
-- Each project is stored as one JSON document (the same format as the configuration package).

IF OBJECT_ID(N'dbo.aisbp_projects', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.aisbp_projects (
    id         NVARCHAR(64)  NOT NULL CONSTRAINT PK_aisbp_projects PRIMARY KEY,
    name       NVARCHAR(200) NOT NULL,
    modified   NVARCHAR(40)  NOT NULL,
    data       NVARCHAR(MAX) NOT NULL,
    updated_at DATETIME2     NOT NULL CONSTRAINT DF_aisbp_projects_updated DEFAULT SYSUTCDATETIME()
  );
END
