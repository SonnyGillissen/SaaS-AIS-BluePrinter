<?php
/**
 * AIS BluePrinter - non-interactive setup (used by the Docker image and install scripts).
 *
 * Reads AISBP_DB_DRIVER, AISBP_DB_HOST, AISBP_DB_PORT, AISBP_DB_NAME, AISBP_DB_USER,
 * AISBP_DB_PASSWORD, AISBP_DB_ENCRYPT, AISBP_DB_TRUST_CERT and AISBP_API_KEY from the
 * environment, waits for the database (up to AISBP_DB_WAIT seconds, default 90), creates the
 * table and writes config.php + install.lock.
 *
 * Usage: php server/php/setup-cli.php
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/lib.php';

$env = static fn(string $key, string $default = ''): string => (string)(getenv($key) !== false ? getenv($key) : $default);

$driver = $env('AISBP_DB_DRIVER', 'mysql');
$db = [
    'driver' => $driver,
    'host' => $env('AISBP_DB_HOST', 'localhost'),
    'port' => (int)$env('AISBP_DB_PORT', $driver === 'sqlsrv' ? '1433' : '3306'),
    'name' => $env('AISBP_DB_NAME', 'aisbp'),
    'user' => $env('AISBP_DB_USER', 'aisbp'),
    'password' => $env('AISBP_DB_PASSWORD'),
    'encrypt' => $env('AISBP_DB_ENCRYPT', '0') === '1',
    'trustServerCertificate' => $env('AISBP_DB_TRUST_CERT', '1') === '1',
];
$wait = max(0, (int)$env('AISBP_DB_WAIT', '90'));

$deadline = time() + $wait;
while (true) {
    try {
        if ($driver === 'sqlsrv' && $env('AISBP_DB_CREATE', '0') === '1') {
            // SQL Server containers start without an application database: create it via master.
            $master = AISBP\connect(array_merge($db, ['name' => 'master']));
            $stmt = $master->prepare('SELECT DB_ID(?)');
            $stmt->execute([$db['name']]);
            if ($stmt->fetchColumn() === null) {
                $master->exec('CREATE DATABASE [' . str_replace(']', ']]', $db['name']) . ']');
            }
        }
        $pdo = AISBP\connect($db);
        break;
    } catch (Throwable $e) {
        if (time() >= $deadline) {
            fwrite(STDERR, 'AIS BluePrinter setup: database not reachable: ' . $e->getMessage() . PHP_EOL);
            exit(1);
        }
        fwrite(STDOUT, "Waiting for the database...\n");
        sleep(3);
    }
}

AISBP\install_schema($pdo, $driver);
AISBP\write_config(['db' => $db, 'apiKey' => $env('AISBP_API_KEY')]);
file_put_contents(AISBP\LOCK_FILE, gmdate('c') . "\n");
fwrite(STDOUT, "AIS BluePrinter setup completed ({$driver}).\n");
