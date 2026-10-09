<?php
/**
 * AIS BluePrinter - one-click web installer for the optional database storage.
 *
 * Open server/php/install.php in a browser, enter the database details and press Install.
 * The installer tests the connection, creates the table, writes config.php, switches
 * js/config.js to server mode (when writable) and finally creates install.lock so it cannot
 * be run again. Delete install.lock (and config.php) to re-run it.
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

use const AISBP\CONFIG_FILE;
use const AISBP\DRIVERS;
use const AISBP\LOCK_FILE;

session_start();
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");

if (empty($_SESSION['aisbp_csrf'])) {
    $_SESSION['aisbp_csrf'] = bin2hex(random_bytes(16));
}

/** HTML-escape helper. */
function h(mixed $v): string
{
    return htmlspecialchars((string)$v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Switch js/config.js to server mode with the generated key (best effort).
 * @return bool true when the file was updated
 */
function update_client_config(string $apiKey): bool
{
    $file = dirname(__DIR__, 2) . '/js/config.js';
    if (!is_file($file) || !is_writable($file)) {
        return false;
    }
    $js = (string)file_get_contents($file);
    $js = preg_replace("/mode:\s*'local'/", "mode: 'server'", $js, 1) ?? $js;
    $js = preg_replace("/apiKey:\s*'[^']*'/", "apiKey: '" . $apiKey . "'", $js, 1) ?? $js;
    return file_put_contents($file, $js, LOCK_EX) !== false;
}

$locked = is_file(LOCK_FILE) || is_file(CONFIG_FILE);
$errors = [];
$done = null;
$form = [
    'driver' => 'mysql', 'host' => 'localhost', 'port' => '', 'name' => 'aisbp', 'user' => 'aisbp',
    'password' => '', 'encrypt' => '', 'trust' => '1', 'useKey' => '1',
];

if (!$locked && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    foreach ($form as $k => $_) {
        $form[$k] = isset($_POST[$k]) && is_string($_POST[$k]) ? trim($_POST[$k]) : '';
    }
    if (!hash_equals((string)$_SESSION['aisbp_csrf'], (string)($_POST['csrf'] ?? ''))) {
        $errors[] = 'Your session expired; please submit the form again.';
    }
    if (!isset(DRIVERS[$form['driver']])) {
        $errors[] = 'Choose a database type.';
    }
    if ($form['port'] !== '' && (!ctype_digit($form['port']) || (int)$form['port'] > 65535)) {
        $errors[] = 'Port must be a number.';
    }
    if (!$errors) {
        $db = [
            'driver' => $form['driver'],
            'host' => $form['host'],
            'port' => (int)($form['port'] ?: ($form['driver'] === 'sqlsrv' ? 1433 : 3306)),
            'name' => $form['name'],
            'user' => $form['user'],
            'password' => is_string($_POST['password'] ?? null) ? $_POST['password'] : '',
            'encrypt' => $form['encrypt'] === '1',
            'trustServerCertificate' => $form['trust'] === '1',
        ];
        try {
            $pdo = AISBP\connect($db);
            AISBP\install_schema($pdo, $db['driver']);
            $apiKey = $form['useKey'] === '1' ? AISBP\random_key() : '';
            AISBP\write_config(['db' => $db, 'apiKey' => $apiKey]);
            file_put_contents(LOCK_FILE, gmdate('c') . "\n");
            $done = ['apiKey' => $apiKey, 'client' => update_client_config($apiKey)];
            $locked = true;
        } catch (Throwable $e) {
            $errors[] = 'Installation failed: ' . $e->getMessage();
        }
    }
}
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AIS BluePrinter - database installer</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; background: #f3f5f8; color: #1b2430; margin: 0; }
  main { max-width: 640px; margin: 40px auto; background: #fff; padding: 28px 32px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h1 { margin-top: 0; font-size: 22px; } label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input, select { width: 100%; padding: 8px; border: 1px solid #c5ccd6; border-radius: 6px; font: inherit; box-sizing: border-box; }
  .check { display: flex; gap: 8px; align-items: center; font-weight: normal; } .check input { width: auto; }
  .row { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; }
  button { margin-top: 20px; padding: 10px 20px; background: #0f6cbd; color: #fff; border: 0; border-radius: 6px; font: inherit; cursor: pointer; }
  .err { background: #fde7e9; color: #a4262c; padding: 10px 14px; border-radius: 6px; }
  .ok { background: #dff6dd; color: #0e700e; padding: 10px 14px; border-radius: 6px; }
  code, pre { background: #eef1f5; padding: 2px 6px; border-radius: 4px; } pre { padding: 12px; overflow: auto; }
  small { color: #5b6573; }
</style>
</head>
<body>
<main>
<h1>AIS BluePrinter &ndash; database installer</h1>
<?php if ($done !== null): ?>
  <p class="ok">Installation completed. Projects are now stored in the database.</p>
  <?php if ($done['client']): ?>
    <p><code>js/config.js</code> was switched to server mode automatically.</p>
  <?php else: ?>
    <p>Update <code>js/config.js</code> to enable server mode:</p>
    <pre>storage: { mode: 'server', apiUrl: 'server/php/api.php', apiKey: '<?= h($done['apiKey']) ?>' }</pre>
  <?php endif; ?>
  <?php if ($done['apiKey'] !== ''): ?>
    <p>API key: <code><?= h($done['apiKey']) ?></code><br><small>The key is stored in <code>server/php/config.php</code>. Note that it is shared with every browser that loads the app; protect the site itself (e.g. App Service authentication or web-server login) when it is reachable from the internet.</small></p>
  <?php endif; ?>
  <p><a href="../../index.html">Open AIS BluePrinter</a></p>
<?php elseif ($locked): ?>
  <p class="ok">AIS BluePrinter is already installed.</p>
  <p>To run the installer again, delete <code>server/php/install.lock</code> and <code>server/php/config.php</code>.</p>
<?php else: ?>
  <p>This optional step stores projects in <strong>MySQL / MariaDB</strong> or <strong>Microsoft SQL Server / Azure SQL</strong> instead of the browser's localStorage. The database and user must already exist; the installer creates the table.</p>
  <?php foreach ($errors as $error): ?><p class="err"><?= h($error) ?></p><?php endforeach; ?>
  <p><small>Available PDO drivers on this server: <?= h(implode(', ', PDO::getAvailableDrivers()) ?: 'none') ?></small></p>
  <form method="post" autocomplete="off">
    <input type="hidden" name="csrf" value="<?= h($_SESSION['aisbp_csrf']) ?>">
    <label for="driver">Database type</label>
    <select id="driver" name="driver">
      <?php foreach (DRIVERS as $key => $label): ?>
        <option value="<?= h($key) ?>"<?= $form['driver'] === $key ? ' selected' : '' ?>><?= h($label) ?></option>
      <?php endforeach; ?>
    </select>
    <div class="row">
      <div><label for="host">Host</label><input id="host" name="host" value="<?= h($form['host']) ?>" required></div>
      <div><label for="port">Port</label><input id="port" name="port" value="<?= h($form['port']) ?>" placeholder="3306 / 1433"></div>
    </div>
    <label for="name">Database name</label><input id="name" name="name" value="<?= h($form['name']) ?>" required>
    <label for="user">User</label><input id="user" name="user" value="<?= h($form['user']) ?>" required>
    <label for="password">Password</label><input id="password" name="password" type="password">
    <label class="check"><input type="checkbox" name="encrypt" value="1"<?= $form['encrypt'] === '1' ? ' checked' : '' ?>> Encrypt connection (SQL Server; required for Azure SQL)</label>
    <label class="check"><input type="checkbox" name="trust" value="1"<?= $form['trust'] === '1' ? ' checked' : '' ?>> Trust server certificate (SQL Server)</label>
    <label class="check"><input type="checkbox" name="useKey" value="1"<?= $form['useKey'] === '1' ? ' checked' : '' ?>> Generate an API key</label>
    <button type="submit">Install</button>
  </form>
<?php endif; ?>
</main>
</body>
</html>
