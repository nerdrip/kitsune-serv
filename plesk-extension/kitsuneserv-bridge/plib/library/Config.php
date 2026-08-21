<?php

class Modules_KitsuneservBridge_Config
{
    public const EXTENSION_VERSION = '3.1.3-r9';

    private const SECRET_FIELDS = [
        'git_token' => 'secret_git_token',
        'git_ssh_private_key' => 'secret_git_ssh_private_key',
        'bootstrap_password' => 'secret_bootstrap_password',
        'secret_key' => 'secret_kitsune_secret_key',
        'api_token' => 'secret_api_token',
        'shared_secret' => 'shared_secret',
        'device_token' => 'device_token',
    ];

    public static function defaultOpenRepositories()
    {
        return "https://github.com/nerdrip/kitsune-serv|kitsune-serv|Przenośny, wszechstronny menedżer środowisk programistycznych dla systemów Windows i Linux. Pomyśl o nim jako o nowoczesnej, bogatej w funkcje alternatywie dla XAMPP/WAMP/MAMP z pięknym interfejsem graficznym, wbudowanym terminalem, przeglądarką baz danych, sklepem z aplikacjami i wieloma innymi funkcjami.|Portable, all-in-one development environment manager for Windows and Linux. Think of it as a modern, feature-rich alternative to XAMPP/WAMP/MAMP with a beautiful GUI, built-in terminal, database viewer, app store, and more.\nhttps://github.com/nerdrip/kitsune-git|kitsune-git|Lekki, szybki i uniwersalny klient graficzny Git — podobny do SourceTree, ale szybszy|Lightweight, fast, universal Git GUI client — like SourceTree but faster\nhttps://github.com/nerdrip/kitsune-irc|kitsune-irc|Nowoczesny serwer IRC ze zintegrowanymi usługami (NickServ, ChanServ, MemoServ, OperServ, BotServ, HostServ) i internetowym panelem administracyjnym. Łączy funkcjonalność UnrealIRCd i Anope w Node.js.|Modern IRC server with integrated services (NickServ, ChanServ, MemoServ, OperServ, BotServ, HostServ) and web administration panel. Combines UnrealIRCd + Anope functionality in Node.js.\nhttps://github.com/nerdrip/nodeuo|nodeuo|Eksperymentalny shard Ultima Online w Node.js z przeglądarkowym klientem WebGL, narzędziami do ekstrakcji assetów, panelem administracyjnym i mostkiem WebSocket/TCP. Inspirowany ClassicUO i ServUO, nastawiony na webowy klient, skryptowalny serwer i otwarty rozwój społeczności.|Experimental Ultima Online shard in Node.js with a WebGL browser client, asset extraction tools, administration panel, and WebSocket/TCP bridge. Inspired by ClassicUO and ServUO, focused on a web-native client, scriptable server, and open community development.";
    }

    public static function defaults()
    {
        return [
            'deployment_mode' => 'managed',
            'url_mode' => 'automatic',
            'proxy_mode' => 'managed',
            'panel_domain' => '',
            'api_domains' => '',
            'hub_url' => '',
            'repository_url' => 'https://github.com/nerdrip/kitsune-serv.git',
            'repository_branch' => 'main',
            'repository_path' => '/opt/kitsuneserv/source',
            'deploy_path' => '/opt/kitsuneserv/app',
            'data_path' => '/var/lib/kitsuneserv',
            'git_username' => 'x-access-token',
            'git_ssh_known_hosts' => '',
            'showcase_domain' => '',
            'showcase_repositories' => "adictlibrary|ssh://git@git.servx.site:32785/boberski/adictlibrary.git|ADict Library\nkitsune-db|ssh://git@git.servx.site:32785/boberski/kitsune-db.git|Kitsune DB\nkitsune-net|ssh://git@git.servx.site:32785/boberski/kitsune-net.git|Kitsune NET\nkitsunescript|ssh://git@git.servx.site:32785/boberski/kitsunescript.git|KitsuneScript\nwpkit|ssh://git@git.servx.site:32785/boberski/wpkit.git|WPKit",
            'showcase_open_repositories' => self::defaultOpenRepositories(),
            'node_binary' => 'auto',
            'npm_binary' => 'auto',
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
            'runtime' => ['node' => null, 'nodeVersion' => null, 'npm' => null, 'detectedAt' => null],
            'deployment' => ['version' => null, 'commit' => null, 'path' => null, 'deployedAt' => null],
            'service' => ['installed' => false, 'active' => false, 'enabled' => false, 'health' => null, 'pid' => null],
            'proxy' => ['mode' => null, 'domain' => null, 'configuredAt' => null, 'path' => null],
            'extensionUpdate' => ['status' => 'never-checked', 'current' => self::EXTENSION_VERSION, 'candidate' => null, 'checkedAt' => null],
            'showcase' => ['domain' => null, 'lastSync' => null, 'libraries' => []],
            'log' => [],
        ];
        $path = pm_Context::getVarDir() . '/state.json';
        if (!is_file($path)) return $empty;
        $decoded = json_decode((string) @file_get_contents($path), true);
        $state = is_array($decoded) ? array_replace_recursive($empty, $decoded) : $empty;
        $state['extensionUpdate']['current'] = self::EXTENSION_VERSION;
        if (($state['extensionUpdate']['candidate'] ?? '') === self::EXTENSION_VERSION && in_array(($state['extensionUpdate']['status'] ?? ''), ['available', 'scheduled'], true)) {
            $state['extensionUpdate']['status'] = 'current';
        }
        return $state;
    }

    public static function proxyDomains($values = null)
    {
        $values = $values === null ? self::values() : $values;
        $domains = [(string) ($values['panel_domain'] ?? '')];
        foreach (preg_split('/\s*,\s*/', (string) ($values['api_domains'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $domain) $domains[] = $domain;
        $valid = [];
        foreach ($domains as $domain) {
            $domain = strtolower(trim((string) $domain));
            if (preg_match('/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/', $domain)) $valid[$domain] = $domain;
        }
        return array_values($valid);
    }

    public static function createRuntimeConfig($action, array $extra = [])
    {
        $allowed = ['status', 'check', 'sync', 'deploy', 'sync-deploy', 'start', 'stop', 'restart', 'proxy', 'extension-check', 'extension-update', 'showcase-sync', 'suite-extension-check', 'suite-extension-install'];
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
        $config = array_merge($config, $extra);
        if ($action === 'showcase-sync') {
            $domain = self::hostedDomain((string) ($config['showcase_domain'] ?? ''));
            $home = realpath((string) $domain->getHomePath());
            if ($home === false || !is_dir($home)) throw new RuntimeException('Nie udało się ustalić katalogu webspace domeny Showcase.');
            $documentRoot = (string) $domain->getDocumentRoot();
            if ($documentRoot === '' || $documentRoot[0] !== '/') $documentRoot = $home . '/' . ltrim($documentRoot, '/');
            $documentRoot = realpath($documentRoot);
            $home = rtrim(str_replace('\\', '/', $home), '/');
            if ($documentRoot === false || !is_dir($documentRoot)) throw new RuntimeException('Nie udało się ustalić katalogu dokumentów domeny Showcase.');
            $documentRoot = rtrim(str_replace('\\', '/', $documentRoot), '/');
            if (strpos($documentRoot . '/', $home . '/') !== 0) throw new RuntimeException('Katalog dokumentów Showcase musi znajdować się wewnątrz webspace wybranej domeny.');
            $template = realpath(pm_Context::getPlibDir() . '/resources/showcase');
            if ($template === false || !is_file($template . '/index.php')) throw new RuntimeException('Brakuje szablonu strony Showcase w rozszerzeniu.');
            $config['showcase_document_root'] = $documentRoot;
            $config['showcase_home_path'] = $home;
            $config['showcase_template_path'] = $template;
        }
        if (in_array($action, ['suite-extension-check', 'suite-extension-install'], true)) {
            $config['gitToken'] = (string) ($config['git_token'] ?? '');
            $config['gitSshPrivateKey'] = (string) ($config['git_ssh_private_key'] ?? '');
            $config['gitUsername'] = (string) ($config['git_username'] ?? 'x-access-token');
            $config['gitSshKnownHosts'] = (string) ($config['git_ssh_known_hosts'] ?? '');
            $config['schemaVersion'] = 1;
        }

        if ($config['proxy_mode'] === 'managed' && in_array($action, ['deploy', 'sync-deploy', 'proxy'], true)) {
            $verified = [];
            $vhostPaths = [];
            foreach (self::proxyDomains($config) as $domainName) {
                $domain = self::hostedDomain($domainName);
                $verifiedName = strtolower((string) $domain->getName());
                $verified[] = $verifiedName;
                $vhostPaths[$verifiedName] = (string) $domain->getVhostSystemPath();
            }
            if (!$verified) throw new RuntimeException('Wybierz co najmniej jedną aktywną domenę publikacji.');
            $config['proxy_domains'] = implode(',', $verified);
            $config['proxy_vhost_paths'] = $vhostPaths;
        }

        $prefix = in_array($action, ['suite-extension-check', 'suite-extension-install'], true) ? 'self-update-' : 'operation-';
        $path = $realVarDir . '/' . $prefix . bin2hex(random_bytes(12)) . '.json';
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
