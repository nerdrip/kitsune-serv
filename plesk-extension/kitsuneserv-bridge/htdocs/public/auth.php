<?php

require_once 'sdk.php';
pm_Context::init('kitsuneserv-bridge');

function kitsuneAuthResponse($status, array $payload)
{
    http_response_code((int) $status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, max-age=0');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function kitsuneAuthHeader($name)
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return trim((string) ($_SERVER[$key] ?? ''));
}

function kitsuneAuthBase64Url($value)
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function kitsuneConsumeAuthNonce($nonce, $expiresAt)
{
    $varDir = rtrim((string) pm_Context::getVarDir(), '/\\');
    if (!is_dir($varDir) && !mkdir($varDir, 0700, true) && !is_dir($varDir)) return false;
    @chmod($varDir, 0700);
    $lockPath = $varDir . '/password-auth.lock';
    $statePath = $varDir . '/password-auth-nonces.json';
    $lock = fopen($lockPath, 'c');
    if (!is_resource($lock)) return false;
    @chmod($lockPath, 0600);
    try {
        if (!flock($lock, LOCK_EX)) return false;
        $now = (int) round(microtime(true) * 1000);
        $state = [];
        if (is_file($statePath)) {
            $decoded = json_decode((string) file_get_contents($statePath), true);
            if (is_array($decoded)) $state = $decoded;
        }
        foreach ($state as $key => $expiry) {
            if ((!is_int($expiry) && !ctype_digit((string) $expiry)) || (int) $expiry < $now) unset($state[$key]);
        }
        if (isset($state[$nonce])) return false;
        if (count($state) >= 2000) $state = array_slice($state, -1000, null, true);
        $state[$nonce] = (int) $expiresAt;
        $encoded = json_encode($state, JSON_UNESCAPED_SLASHES);
        if ($encoded === false || file_put_contents($statePath, $encoded, LOCK_EX) === false) return false;
        @chmod($statePath, 0600);
        return true;
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') kitsuneAuthResponse(405, ['error' => 'Method not allowed.']);
$length = isset($_SERVER['CONTENT_LENGTH']) ? (int) $_SERVER['CONTENT_LENGTH'] : 0;
if ($length > 16384) kitsuneAuthResponse(413, ['error' => 'Request is too large.']);
$raw = (string) file_get_contents('php://input');
if ($raw === '' || strlen($raw) > 16384) kitsuneAuthResponse(400, ['error' => 'Invalid request.']);
$payload = json_decode($raw, true);
if (!is_array($payload)) kitsuneAuthResponse(400, ['error' => 'Invalid request.']);

$connectorId = kitsuneAuthHeader('X-Kitsune-Connector');
$signature = kitsuneAuthHeader('X-Kitsune-Signature');
$timestamp = isset($payload['timestamp']) ? (int) $payload['timestamp'] : 0;
$nonce = strtolower(trim((string) ($payload['nonce'] ?? '')));
$configuredConnector = (string) pm_Settings::get('connector_id', '');
$authenticationMode = (string) pm_Settings::get('auth_mode', 'hybrid');
try { $sharedSecret = (string) pm_Settings::getDecrypted('shared_secret'); }
catch (Throwable $exception) { $sharedSecret = ''; }

$now = (int) round(microtime(true) * 1000);
if ($authenticationMode === 'independent' || $connectorId === '' || !hash_equals($configuredConnector, $connectorId) || $sharedSecret === '' || !preg_match('/^[a-f0-9]{32}$/', $nonce) || abs($now - $timestamp) > 60000) {
    kitsuneAuthResponse(401, ['error' => 'Authentication failed.']);
}
$signed = $timestamp . "\n" . $nonce . "\n" . hash('sha256', $raw);
$expected = kitsuneAuthBase64Url(hash_hmac('sha256', $signed, $sharedSecret, true));
if ($signature === '' || !hash_equals($expected, $signature)) kitsuneAuthResponse(401, ['error' => 'Authentication failed.']);
if (!kitsuneConsumeAuthNonce($nonce, $now + 120000)) kitsuneAuthResponse(409, ['error' => 'Request was already used.']);

$username = trim((string) ($payload['username'] ?? ''));
$password = (string) ($payload['password'] ?? '');
if ($username === '' || strlen($username) > 254 || $password === '' || strlen($password) > 1024 || preg_match('/[\r\n\0]/', $username)) {
    kitsuneAuthResponse(200, ['valid' => false, 'accountExists' => false]);
}

$client = null;
try { $client = pm_Client::getByLogin($username); }
catch (Throwable $exception) {}
$accountExists = $client instanceof pm_Client;
$valid = false;
try { $valid = $accountExists && pm_Auth::isValidCredentials($username, $password); }
catch (Throwable $exception) { $valid = false; }
if (!$valid) kitsuneAuthResponse(200, ['valid' => false, 'accountExists' => $accountExists]);

$role = $client->isAdmin() ? 'admin' : ($client->isReseller() ? 'reseller' : 'customer');
kitsuneAuthResponse(200, [
    'valid' => true,
    'accountExists' => true,
    'subject' => (string) $client->getId(),
    'username' => (string) $client->getProperty('login'),
    'displayName' => (string) $client->getProperty('pname'),
    'email' => (string) $client->getProperty('email'),
    'role' => $role,
]);
