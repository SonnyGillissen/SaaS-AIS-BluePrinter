<#
.SYNOPSIS
  AIS BluePrinter - one-click installer for the optional database-backed deployment (Docker).

.DESCRIPTION
  Generates random passwords and an API key into server/docker/.env (kept on re-runs), then
  builds and starts the containers. Not needed for the default browser-only mode: just open
  index.html or host the files on any static web server.

.EXAMPLE
  .\install.ps1 -Database mysql
.EXAMPLE
  .\install.ps1 -Database mssql -Port 8081
#>
[CmdletBinding()]
param(
  [ValidateSet('mysql', 'mssql')]
  [string] $Database = 'mysql',
  [ValidateRange(1, 65535)]
  [int] $Port = 8080
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required: https://docs.docker.com/get-docker/'
}
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required (docker compose).' }

$root = $PSScriptRoot
$envFile = Join-Path $root 'server/docker/.env'

function New-RandomString([int] $Length) {
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $Length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

if (-not (Test-Path $envFile)) {
  # Prefix guarantees SQL Server complexity rules (upper, lower, digit, symbol).
  @(
    "AISBP_DB_PASSWORD=Ab1-$(New-RandomString 24)"
    "AISBP_DB_ROOT_PASSWORD=Ab1-$(New-RandomString 24)"
    "AISBP_API_KEY=$(New-RandomString 40)"
    "AISBP_PORT=$Port"
  ) | Set-Content -Path $envFile -Encoding ascii
  Write-Host "Generated $envFile"
}

docker compose -f (Join-Path $root "server/docker/docker-compose.$Database.yml") --env-file $envFile up -d --build
if ($LASTEXITCODE -ne 0) { throw 'docker compose failed.' }

$configuredPort = ((Get-Content $envFile | Where-Object { $_ -like 'AISBP_PORT=*' }) -split '=', 2)[1]
Write-Host ''
Write-Host "AIS BluePrinter is starting with $Database storage: http://localhost:$configuredPort"
Write-Host "Follow the logs with: docker compose -f server/docker/docker-compose.$Database.yml logs -f web"
