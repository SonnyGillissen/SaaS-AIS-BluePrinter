# AIS BluePrinter - web server image (Apache + PHP) for the optional database storage.
# Build from the repository root:
#   docker build -f server/docker/Dockerfile --build-arg DB_DRIVER=mysql  -t ais-blueprinter .
#   docker build -f server/docker/Dockerfile --build-arg DB_DRIVER=sqlsrv -t ais-blueprinter .
# Debian 12 (bookworm) base: supported by the Microsoft ODBC driver repository.
FROM php:8.3-apache-bookworm

ARG DB_DRIVER=mysql

RUN set -eux; \
    if [ "$DB_DRIVER" = "sqlsrv" ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends curl gnupg ca-certificates unixodbc-dev $PHPIZE_DEPS; \
      curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg; \
      . /etc/os-release; \
      echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/${VERSION_ID}/prod ${VERSION_CODENAME} main" > /etc/apt/sources.list.d/mssql-release.list; \
      apt-get update; \
      ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18; \
      pecl install pdo_sqlsrv; \
      docker-php-ext-enable pdo_sqlsrv; \
      apt-get purge -y --auto-remove $PHPIZE_DEPS; \
      rm -rf /var/lib/apt/lists/* /tmp/pear; \
    else \
      docker-php-ext-install pdo_mysql; \
    fi; \
    a2enmod headers; \
    { echo '<Directory /var/www/html>'; echo '  AllowOverride All'; echo '</Directory>'; echo 'ServerTokens Prod'; echo 'ServerSignature Off'; } > /etc/apache2/conf-enabled/aisbp.conf

COPY index.html /var/www/html/
COPY assets /var/www/html/assets
COPY css /var/www/html/css
COPY js /var/www/html/js
COPY server/php /var/www/html/server/php
COPY server/docker/entrypoint.sh /usr/local/bin/aisbp-entrypoint
# Optional self-hosted icon mirror (see icons/README.md).
COPY icons /var/www/html/icons

RUN chmod +x /usr/local/bin/aisbp-entrypoint && chown -R www-data:www-data /var/www/html

ENTRYPOINT ["aisbp-entrypoint"]
CMD ["apache2-foreground"]
