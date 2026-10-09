<?php
/**
 * AIS BluePrinter - optional storage API.
 *
 * Contract (consumed by ApiAdapter in js/core/storage.js):
 *   GET  api.php?action=list           -> { ok: true, projects: [{ id, name, modified }] }
 *   GET  api.php?action=load&id=ID     -> { ok: true, project }
 *   POST api.php?action=save&id=ID     body: project JSON -> { ok: true }
 *   POST api.php?action=delete&id=ID   -> { ok: true }
 *   GET  api.php?action=prefs          -> { ok: true, prefs: { theme? } }
 *   POST api.php?action=save-prefs     body: { theme: 'system'|'light'|'dark' } -> { ok: true }
 *   GET  api.php?action=ping           -> { ok: true, installed: bool }
 * Errors: { ok: false, error } with an appropriate HTTP status.
 *
 * Authentication: when config.php defines a non-empty 'apiKey', every request must send it in
 * the X-API-Key header. The API is same-origin only (no CORS headers are emitted).
 */

declare(strict_types=1);

require __DIR__ . '/lib.php';

use function AISBP\connect;
use function AISBP\json_response;
use function AISBP\load_config;

$config = load_config();
$action = isset($_GET['action']) && is_string($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($action === 'ping') {
    json_response(['ok' => true, 'installed' => $config !== null]);
}
if ($config === null) {
    json_response(['ok' => false, 'error' => 'The server is not installed yet. Run server/php/install.php.'], 503);
}

$expectedKey = (string)($config['apiKey'] ?? '');
if ($expectedKey !== '') {
    $given = isset($_SERVER['HTTP_X_API_KEY']) ? (string)$_SERVER['HTTP_X_API_KEY'] : '';
    if (!hash_equals($expectedKey, $given)) {
        json_response(['ok' => false, 'error' => 'Invalid or missing API key.'], 401);
    }
}

$id = isset($_GET['id']) && is_string($_GET['id']) ? $_GET['id'] : '';
$needsId = in_array($action, ['load', 'save', 'delete'], true);
if ($needsId && !preg_match(AISBP\ID_PATTERN, $id)) {
    json_response(['ok' => false, 'error' => 'Invalid project id.'], 400);
}
$writes = ['save', 'delete', 'save-prefs'];
if (in_array($action, $writes, true) && $method !== 'POST') {
    json_response(['ok' => false, 'error' => 'Use POST for this action.'], 405);
}

try {
    $db = (array)$config['db'];
    $pdo = connect($db);
    $repo = new AISBP\ProjectRepository($pdo);
    switch ($action) {
        case 'list':
            json_response(['ok' => true, 'projects' => $repo->list()]);
            // no break (json_response exits)
        case 'load':
            $project = $repo->load($id);
            if ($project === null) {
                json_response(['ok' => false, 'error' => 'Project not found.'], 404);
            }
            json_response(['ok' => true, 'project' => $project]);
            // no break
        case 'save':
            $contentType = (string)($_SERVER['CONTENT_TYPE'] ?? '');
            if (stripos($contentType, 'application/json') !== 0) {
                // Requiring JSON also blocks simple cross-site form posts.
                json_response(['ok' => false, 'error' => 'Content-Type must be application/json.'], 415);
            }
            $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($length > AISBP\MAX_BODY) {
                json_response(['ok' => false, 'error' => 'Project is too large.'], 413);
            }
            $raw = (string)file_get_contents('php://input', false, null, 0, AISBP\MAX_BODY + 1);
            if (strlen($raw) > AISBP\MAX_BODY) {
                json_response(['ok' => false, 'error' => 'Project is too large.'], 413);
            }
            $project = json_decode($raw, false, 64);
            if (!is_object($project) || ($project->format ?? null) !== 'ais-blueprinter'
                || !is_object($project->meta ?? null) || ($project->meta->id ?? null) !== $id) {
                json_response(['ok' => false, 'error' => 'Body is not an AIS BluePrinter project for this id.'], 400);
            }
            $repo->save($id, $project);
            json_response(['ok' => true]);
            // no break
        case 'delete':
            $repo->delete($id);
            json_response(['ok' => true]);
            // no break
        case 'prefs':
            $settings = new AISBP\SettingsRepository($pdo, (string)($db['driver'] ?? 'mysql'));
            json_response(['ok' => true, 'prefs' => (object)$settings->all()]);
            // no break
        case 'save-prefs':
            if (stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
                json_response(['ok' => false, 'error' => 'Content-Type must be application/json.'], 415);
            }
            $prefs = json_decode((string)file_get_contents('php://input', false, null, 0, 4096), true, 4);
            if (!is_array($prefs)) {
                json_response(['ok' => false, 'error' => 'Body must be a JSON object.'], 400);
            }
            (new AISBP\SettingsRepository($pdo, (string)($db['driver'] ?? 'mysql')))->save($prefs);
            json_response(['ok' => true]);
            // no break
        default:
            json_response(['ok' => false, 'error' => 'Unknown action.'], 400);
    }
} catch (Throwable $e) {
    error_log('AIS BluePrinter API: ' . $e->getMessage());
    json_response(['ok' => false, 'error' => 'Database error; see the server log for details.'], 500);
}
