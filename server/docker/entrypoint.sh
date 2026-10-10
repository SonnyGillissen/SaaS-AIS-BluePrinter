#!/bin/sh
# AIS BluePrinter container entrypoint: configure database storage, then start Apache.
set -e
APP=/var/www/html

if [ -n "$AISBP_DB_DRIVER" ]; then
  # Creates the table and server/php/config.php from the AISBP_* environment variables.
  su -s /bin/sh www-data -c "php $APP/server/php/setup-cli.php" || { echo "Database setup failed" >&2; exit 1; }
  # Switch the browser app to server storage.
  sed -i "s/mode: 'local'/mode: 'server'/" "$APP/js/config.js"
  if [ -n "$AISBP_API_KEY" ]; then
    case "$AISBP_API_KEY" in *[!A-Za-z0-9_-]*) echo "AISBP_API_KEY may only contain letters, digits, - and _" >&2; exit 1;; esac
    sed -i "s/apiKey: '[^']*'/apiKey: '$AISBP_API_KEY'/" "$APP/js/config.js"
  fi
fi

exec docker-php-entrypoint "$@"
