#!/usr/bin/env sh
# AIS BluePrinter - one-click installer for the optional database-backed deployment (Docker).
#
#   ./install.sh mysql      # Apache + PHP + MySQL 8
#   ./install.sh mssql      # Apache + PHP + Microsoft SQL Server 2022 (Express)
#
# Generates random passwords and an API key into server/docker/.env (kept on re-runs), then
# builds and starts the containers. The app is served on http://localhost:${AISBP_PORT:-8080}.
# Not needed for the default browser-only mode: just open index.html or host the files.
set -eu

DB="${1:-mysql}"
case "$DB" in
  mysql|mssql) ;;
  *) echo "Usage: $0 [mysql|mssql]" >&2; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/server/docker/.env"

rand() {
  # $1 = length; alphanumeric only so values are safe in .env and JavaScript.
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"
}

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  {
    # Prefix guarantees SQL Server complexity rules (upper, lower, digit, symbol).
    echo "AISBP_DB_PASSWORD=Ab1-$(rand 24)"
    echo "AISBP_DB_ROOT_PASSWORD=Ab1-$(rand 24)"
    echo "AISBP_API_KEY=$(rand 40)"
    echo "AISBP_PORT=${AISBP_PORT:-8080}"
  } > "$ENV_FILE"
  echo "Generated $ENV_FILE"
fi

docker compose -f "$ROOT/server/docker/docker-compose.$DB.yml" --env-file "$ENV_FILE" up -d --build

PORT="$(grep '^AISBP_PORT=' "$ENV_FILE" | cut -d= -f2)"
echo
echo "AIS BluePrinter is starting with $DB storage: http://localhost:${PORT:-8080}"
echo "Follow the logs with: docker compose -f server/docker/docker-compose.$DB.yml logs -f web"
