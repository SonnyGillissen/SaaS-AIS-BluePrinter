-- AIS BluePrinter - MySQL / MariaDB schema.
-- Applied automatically by install.php / setup-cli.php; can also be run manually.
-- Each project is stored as one JSON document (the same format as the configuration package).

CREATE TABLE IF NOT EXISTS aisbp_projects (
  id         VARCHAR(64)  NOT NULL,
  name       VARCHAR(200) NOT NULL,
  modified   VARCHAR(40)  NOT NULL,
  data       LONGTEXT     NOT NULL,
  updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- ;;

-- Shared preferences of this instance (e.g. the colour theme). Values are small JSON strings.
CREATE TABLE IF NOT EXISTS aisbp_settings (
  name  VARCHAR(64)   NOT NULL,
  value VARCHAR(2000) NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
