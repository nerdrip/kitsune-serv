<?php

class Modules_KitsuneservBridge_Config
{
    public const EXTENSION_VERSION = '3.0.0-r5';

    private const SECRET_FIELDS = [
        'git_token' => 'secret_git_token',
        'git_ssh_private_key' => 'secret_git_ssh_private_key',
        'bootstrap_password' => 'secret_bootstrap_password',
        'secret_key' => 'secret_kitsune_secret_key',
        'api_token' => 'secret_api_token',
        'shared_secret' => 'shared_secret',
        'device_token' => 'device_token',
    ];

    public static function defaults()
    {
        return [
            'deployment_mode' => 'managed',
            'url_mode' => 'automatic',
            'proxy_mode' => 'managed',
            'panel_domain' => '',
            'hub_url' => '',
            'repository_url' => 'https://github.com/nerdrip/kitsune-serv.git',
            'repository_branch' => 'main',
            'repository_path' => '/opt/kitsuneserv/source',
            'deploy_path' => '/opt/kitsuneserv/app',
            'data_path' => '/var/lib/kitsuneserv',
            'git_username' => 'x-access-token',
            'git_ssh_known_hosts' => '',
            'node_binary' => '/usr/bin/node',
            'npm_binary' => '/usr/bin/npm',
            'service_user' => 'root',
            'bind_address' => '127.0.0.1',
            'hub_port' => '10000',
            'bootstrap_user' => 'admin',
            'allowed_ips' => '',
            'safe_mode' => 'false',
            'disable_system_integration' => 'false',
            'update_manifest_url' => '',
            'update_public_key' => '',
            'plesk_url' => '',
            'connector_id' => '',
            'auth_mode' => 'hybrid',
            'auto_provision' => '1',
            'node_id' => '',
            'last_sync' => '',
        ];
    }

    public static function values()
    {
        $values = [];
        foreach (self::defaults() as $key => $default) {
            $values[$key] = (string) pm_Settings::get($key, $default);
        }
        return $values;
    }

    public static function save(array $values)
    {
        foreach (self::defaults() as $key => $default) {
            if (array_key_exists($key, $values)) {
                pm_Settings::set($key, trim((string) $values[$key]));
            }
        }
        foreach (self::SECRET_FIELDS as $field => $setting) {
            if (!array_key_exists($field, $values)) continue;
            $value = trim((string) $values[$field]);
            if ($field === 'git_ssh_private_key') $value = self::normalizePrivateKey($value);
            if ($value !== '') pm_Settings::setEncrypted($setting, $value);
        }
    }

    public static function hasSecret($field)
    {
        return self::secret($field) !== '';
    }

    public static function clearSecrets(array $fields)
    {
        foreach (array_unique($fields) as $field) {
            $setting = self::SECRET_FIELDS[$field] ?? null;
            if ($setting !== null) pm_Settings::setEncrypted($setting, '');
        }
    }

    public static function ensureSsoConfiguration($pleskUrl = '')
    {
        $current = self::values();
        $generated = ['connectorId' => false, 'sharedSecret' => false, 'pleskUrl' => false];
        if ($current['auth_mode'] === 'independent') return $generated;

        $changes = [];
        if ($current['connector_id'] === '') {
            $seed = strtolower(trim((string) ($pleskUrl ?: gethostname() ?: $current['panel_domain'] ?: 'plesk')));
            $changes['connector_id'] = 'plesk-' . substr(hash('sha256', $seed), 0, 20);
            $generated['connectorId'] = true;
        }
        if (!self::hasSecret('shared_secret')) {
            $changes['shared_secret'] = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
            $generated['sharedSecret'] = true;
        }
        if ($current['plesk_url'] === '' && trim((string) $pleskUrl) !== '') {
            $changes['plesk_url'] = rtrim(trim((string) $pleskUrl), '/');
            $generated['pleskUrl'] = true;
        }
        if ($changes) self::save($changes);
        return $generated;
    }

    public static function readState()
    {
        $empty = [
            'updatedAt' => null,
            'lastOperation' => null,
            'lastSuccess' => null,
            'lastError' => null,
            'repository' => ['branch' => null, 'localCommit' => null, 'remoteCommit' => null, 'dirty' => null, 'updateAvailable' => null],
            'deployment' => ['version' => null, 'commit' => null, 'path' => null, 'deployedAt' => null],
            'service' => ['installed' => false, 'active' => false, 'enabled' => false, 'health' => null, 'pid' => null],
            'proxy' => ['mode' => null, 'domain' => null, 'configuredAt' => null, 'path' => null],
            'log' => [],
        ];
        $path = pm_Context::getVarDir() . '/state.json';
        if (!is_file($path)) return $empty;
        $decoded = json_decode((string) file_get_contents($path), true);
        return is_array($decoded) ? array_replace_recursive($empty, $decoded) : $empty;
    }

    public static function createRuntimeConfig($action)
    {
        $allowed = ['status', 'check', 'sync', 'deploy', 'sync-deploy', 'start', 'stop', 'restart', 'proxy'];
        if (!in_array($action, $allowed, true)) throw new InvalidArgumentException('Unsupported operation.');
        $varDir = rtrim((string) pm_Context::getVarDir(), '/\\');
        if (!is_dir($varDir) && !mkdir($varDir, 0700, true) && !is_dir($varDir)) {
            throw new RuntimeException('Nie udało się utworzyć katalogu roboczego rozszerzenia.');
        }
        @chmod($varDir, 0700);
        $realVarDir = realpath($varDir);
        if ($realVarDir === false) throw new RuntimeException('Nie udało się ustalić katalogu roboczego rozszerzenia.');

        $config = self::values();
        foreach (array_keys(self::SECRET_FIELDS) as $field) $config[$field] = self::secret($field);
        $config['action'] = $action;
        $config['requested_at'] = gmdate('c');

        if ($config['proxy_mode'] === 'managed' && in_array($action, ['deploy', 'sync-deploy', 'proxy'], true)) {
            $domain = self::hostedDomain($config['panel_domain']);
            $config['vhost_system_path'] = (string) $domain->getVhostSystemPath();
            $config['domain_name'] = strtolower((string) $domain->getName());
        }

        $path = $realVarDir . '/operation-' . bin2hex(random_bytes(12)) . '.json';
        $json = json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $previousUmask = umask(0077);
        try {
            if ($json === false || file_put_contents($path, $json, LOCK_EX) === false) {
                throw new RuntimeException('Nie udało się zapisać bezpiecznej konfiguracji operacji.');
            }
            @chmod($path, 0600);
        } finally {
            umask($previousUmask);
        }
        return $path;
    }

    private static function hostedDomain($name)
    {
        $name = strtolower(trim((string) $name));
        try {
            $domain = pm_Domain::getByName($name);
        } catch (Throwable $exception) {
            throw new RuntimeException('Wybrana domena nie istnieje w Plesku: ' . $name, 0, $exception);
        }
        if (!$domain instanceof pm_Domain || !$domain->hasHosting() || !$domain->isActive() || $domain->isSuspended() || $domain->isDisabled()) {
            throw new RuntimeException('Wybrana domena musi być aktywna i mieć hosting WWW: ' . $name);
        }
        return $domain;
    }

    private static function secret($field)
    {
        $setting = self::SECRET_FIELDS[$field] ?? null;
        if ($setting === null) return '';
        try {
            return (string) pm_Settings::getDecrypted($setting);
        } catch (Exception $exception) {
            return '';
        }
    }

    private static function normalizePrivateKey($value)
    {
        $value = str_replace(["\r\n", "\r"], "\n", (string) $value);
        if (strncmp($value, "\xEF\xBB\xBF", 3) === 0) $value = substr($value, 3);
        return trim($value);
    }
}
