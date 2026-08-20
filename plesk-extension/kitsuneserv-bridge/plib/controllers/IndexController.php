<?php

class IndexController extends pm_Controller_Action
{
    public function init()
    {
        parent::init();
        $version = Modules_KitsuneservBridge_Config::EXTENSION_VERSION;
        $this->view->pageTitle = 'KitsuneServ Bridge';
        $this->view->headLink()->appendStylesheet(pm_Context::getBaseUrl() . 'css/kitsuneserv.css?v=' . $version);
        $this->view->headScript()->appendFile(pm_Context::getBaseUrl() . 'js/kitsuneserv.js?v=' . $version);
    }

    public function indexAction()
    {
        $client = pm_Session::getClient();
        $config = Modules_KitsuneservBridge_Config::values();
        $domains = $this->domainOptions($config['panel_domain']);
        $statusError = $client->isAdmin() ? $this->refreshStatus() : null;
        $state = Modules_KitsuneservBridge_Config::readState();

        $this->view->isAdmin = $client->isAdmin();
        $this->view->config = $config;
        $this->view->domains = $domains;
        $this->view->state = $state;
        $this->view->statusError = $statusError;
        $this->view->extensionVersion = Modules_KitsuneservBridge_Config::EXTENSION_VERSION;
        $this->view->paired = Modules_KitsuneservBridge_Config::hasSecret('device_token');
        $this->view->secretStatus = $this->secretStatus();
        $this->view->warnings = $this->warnings($config, $domains, $state, $statusError);
        $this->view->manualProxy = $this->manualProxy($config);
    }

    public function saveAction()
    {
        $this->requireAdmin();
        if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        try {
            $values = $this->validatedConfiguration((array) $this->getRequest()->getPost());
            Modules_KitsuneservBridge_Config::save($values);
            $clear = [];
            foreach (['git_token', 'git_ssh_private_key', 'bootstrap_password', 'secret_key', 'api_token', 'shared_secret'] as $field) {
                if ($this->getRequest()->getPost('clear_' . $field)) $clear[] = $field;
            }
            Modules_KitsuneservBridge_Config::clearSecrets($clear);
            $generated = Modules_KitsuneservBridge_Config::ensureSsoConfiguration($this->currentPleskOrigin());
            $message = 'Konfiguracja KitsuneServ Bridge została zapisana.';
            if (array_filter($generated)) $message .= ' Brakujące ustawienia Plesk SSO zostały wygenerowane automatycznie.';
            $this->_status->addMessage('info', $message);
        } catch (Throwable $exception) {
            $this->_status->addMessage('error', 'Nie zapisano konfiguracji: ' . $exception->getMessage());
        }
        $this->_helper->redirector('index');
    }

    public function operationAction()
    {
        $this->requireAdmin();
        if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        $action = trim((string) $this->getRequest()->getPost('operation'));
        $allowed = ['check', 'sync', 'deploy', 'sync-deploy', 'start', 'stop', 'restart', 'proxy'];
        try {
            if (!in_array($action, $allowed, true)) throw new RuntimeException('Wybierz prawidłową operację.');
            Modules_KitsuneservBridge_Config::ensureSsoConfiguration($this->currentPleskOrigin());
            $config = Modules_KitsuneservBridge_Config::values();
            if ($config['deployment_mode'] !== 'managed') throw new RuntimeException('Operacje serwera są dostępne tylko w trybie wdrożenia zarządzanego.');
            if ($action === 'proxy' && $config['proxy_mode'] !== 'managed') throw new RuntimeException('Automatyczna konfiguracja proxy jest wyłączona.');
            if (in_array($action, ['deploy', 'sync-deploy'], true) && !Modules_KitsuneservBridge_Config::hasSecret('bootstrap_password')) {
                throw new RuntimeException('Ustaw hasło pierwszego administratora przed wdrożeniem.');
            }
            $runtime = Modules_KitsuneservBridge_Config::createRuntimeConfig($action);
            $task = new Modules_KitsuneservBridge_Task_Operate();
            $task->setParam('runtimeConfig', $runtime);
            (new pm_LongTask_Manager())->start($task);
            $this->_status->addMessage('info', 'Operacja „' . $this->operationLabel($action) . '” została dodana do kolejki Pleska.');
        } catch (Throwable $exception) {
            $this->_status->addMessage('error', 'Nie uruchomiono operacji: ' . $exception->getMessage());
        }
        $this->_helper->redirector('index');
    }

    public function pairAction()
    {
        $this->requireAdmin();
        if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        try {
            $code = strtolower(trim((string) $this->getRequest()->getPost('pairing_code')));
            if (!preg_match('/^[a-f0-9]{6}-[a-f0-9]{6}$/', $code)) throw new RuntimeException('Kod powinien mieć format abcdef-123456.');
            $result = $this->client()->pair($code, [
                'name' => gethostname() ?: 'Plesk',
                'platform' => PHP_OS_FAMILY,
                'version' => Modules_KitsuneservBridge_Config::EXTENSION_VERSION,
                'capabilities' => ['plesk-sso', 'domains', 'inventory', 'projects', 'labs', 'api-flows', 'managed-deployment'],
            ]);
            if (empty($result['token']) || empty($result['node']['id'])) throw new RuntimeException('Hub nie zwrócił danych rejestracji węzła.');
            pm_Settings::setEncrypted('device_token', (string) $result['token']);
            pm_Settings::set('node_id', (string) $result['node']['id']);
            $this->_status->addMessage('info', 'Serwer Plesk został sparowany z Kitsune Hub.');
        } catch (Throwable $exception) {
            $this->_status->addMessage('error', 'Parowanie nie powiodło się: ' . $exception->getMessage());
        }
        $this->_helper->redirector('index');
    }

    public function syncAction()
    {
        $this->requireAdmin();
        if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        try {
            $nodeId = pm_Settings::get('node_id', '');
            $token = $this->secret('device_token');
            if ($nodeId === '' || $token === '') throw new RuntimeException('Najpierw sparuj ten serwer Plesk z Hubem.');
            $inventory = [
                'pleskVersion' => pm_ProductInfo::getVersion(),
                'bridgeVersion' => Modules_KitsuneservBridge_Config::EXTENSION_VERSION,
                'hostname' => gethostname(),
                'domains' => $this->domainNames(),
                'authMode' => pm_Settings::get('auth_mode', 'hybrid'),
                'deploymentMode' => pm_Settings::get('deployment_mode', 'managed'),
            ];
            $this->client()->heartbeat($nodeId, $token, $inventory);
            pm_Settings::set('last_sync', gmdate('c'));
            $this->_status->addMessage('info', 'Inwentarz Pleska został zsynchronizowany.');
        } catch (Throwable $exception) {
            $this->_status->addMessage('error', 'Synchronizacja nie powiodła się: ' . $exception->getMessage());
        }
        $this->_helper->redirector('index');
    }

    public function ssoAction()
    {
        if (!$this->canUseHub()) throw new pm_Exception('Twój plan usług nie pozwala korzystać z Kitsune Hub.');
        $hubUrl = pm_Settings::get('hub_url', '');
        $connectorId = pm_Settings::get('connector_id', '');
        $secret = $this->secret('shared_secret');
        if ($hubUrl === '' || $connectorId === '' || $secret === '') throw new pm_Exception('Logowanie Plesk SSO nie jest jeszcze skonfigurowane.');
        $client = pm_Session::getClient();
        $now = (int) round(microtime(true) * 1000);
        $claims = [
            'connectorId' => $connectorId,
            'subject' => (string) $client->getId(),
            'username' => (string) $client->getProperty('login'),
            'displayName' => (string) $client->getProperty('pname'),
            'email' => (string) $client->getProperty('email'),
            'role' => $client->isAdmin() ? 'admin' : ($client->isReseller() ? 'reseller' : 'customer'),
            'domains' => $this->domainNames(),
            'iat' => $now,
            'exp' => $now + 60000,
            'nonce' => bin2hex(random_bytes(16)),
        ];
        $json = json_encode($claims, JSON_UNESCAPED_SLASHES);
        $assertion = rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
        $signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $assertion, $secret, true)), '+/', '-_'), '=');
        $this->view->hubAuthUrl = rtrim($hubUrl, '/') . '/auth/plesk';
        $this->view->assertion = $assertion;
        $this->view->signature = $signature;
    }

    private function validatedConfiguration(array $post)
    {
        $current = Modules_KitsuneservBridge_Config::values();
        $values = [];
        foreach (array_keys(Modules_KitsuneservBridge_Config::defaults()) as $key) {
            if (array_key_exists($key, $post)) $values[$key] = trim((string) $post[$key]);
        }
        foreach (['git_token', 'git_ssh_private_key', 'bootstrap_password', 'secret_key', 'api_token', 'shared_secret'] as $secret) {
            if (array_key_exists($secret, $post)) $values[$secret] = trim((string) $post[$secret]);
        }
        $values['auto_provision'] = isset($post['auto_provision']) && (string) $post['auto_provision'] === '1' ? '1' : '0';
        $values['safe_mode'] = isset($post['safe_mode']) && (string) $post['safe_mode'] === '1' ? 'true' : 'false';
        $values['disable_system_integration'] = isset($post['disable_system_integration']) && (string) $post['disable_system_integration'] === '1' ? 'true' : 'false';

        if (!in_array($values['deployment_mode'] ?? '', ['managed', 'external'], true)) throw new RuntimeException('Wybierz wdrożenie zarządzane albo istniejący Hub.');
        if (!in_array($values['url_mode'] ?? '', ['automatic', 'manual'], true)) throw new RuntimeException('Wybierz automatyczny albo ręczny adres Hub.');
        if (!in_array($values['proxy_mode'] ?? '', ['managed', 'manual'], true)) throw new RuntimeException('Wybierz automatyczną albo ręczną konfigurację reverse proxy.');
        if (($values['deployment_mode'] ?? '') === 'external' && ($values['proxy_mode'] ?? '') !== 'manual') throw new RuntimeException('Istniejący, zewnętrzny Hub wymaga ręcznej konfiguracji publikacji.');

        $domains = $this->domainOptions($current['panel_domain']);
        $domain = strtolower(trim((string) ($values['panel_domain'] ?? '')));
        if (!$domains) throw new RuntimeException('Plesk nie zwrócił żadnej aktywnej domeny z hostingiem WWW. Dodaj domenę lub subdomenę przed zapisaniem konfiguracji.');
        if (!array_key_exists($domain, $domains)) throw new RuntimeException('Wybierz aktywną domenę bezpośrednio z listy Pleska.');
        $values['panel_domain'] = $domain;

        if (($values['url_mode'] ?? '') === 'automatic') $values['hub_url'] = 'https://' . $domain;
        $values['hub_url'] = rtrim((string) ($values['hub_url'] ?? ''), '/');
        $parts = parse_url($values['hub_url']);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment']) || !empty($parts['path'])) {
            throw new RuntimeException('Adres Hub musi mieć postać https://domena bez ścieżki, danych logowania, parametrów i fragmentu.');
        }
        if (($values['url_mode'] ?? '') === 'automatic' && strtolower((string) $parts['host']) !== $domain) throw new RuntimeException('Automatyczny adres Hub musi używać wybranej domeny Pleska.');
        new Modules_KitsuneservBridge_HubClient($values['hub_url']);

        if (($values['deployment_mode'] ?? '') === 'managed') {
            $repositoryUrl = (string) ($values['repository_url'] ?? '');
            if (!preg_match('#^(?:https://[^\s]+|ssh://[^\s]+|git@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+)$#', $repositoryUrl) || strlen($repositoryUrl) > 1000) throw new RuntimeException('Repozytorium musi używać poprawnego adresu HTTPS albo SSH.');
            $repositoryParts = strpos($repositoryUrl, 'git@') === 0 ? null : parse_url($repositoryUrl);
            if (is_array($repositoryParts) && (isset($repositoryParts['pass']) || (($repositoryParts['scheme'] ?? '') === 'https' && isset($repositoryParts['user'])))) throw new RuntimeException('Nie umieszczaj loginu ani tokenu w adresie repozytorium. Użyj osobnych, szyfrowanych pól poświadczeń.');
            if (!preg_match('/^(?![-.])(?!.*\.\.)(?!.*@\{)[A-Za-z0-9._\/-]+$/', (string) ($values['repository_branch'] ?? '')) || strlen((string) $values['repository_branch']) > 200) throw new RuntimeException('Nieprawidłowa nazwa gałęzi Git.');
            foreach (['repository_path', 'deploy_path', 'data_path'] as $field) $this->validatePath((string) ($values[$field] ?? ''), $field);
            if ($this->pathsOverlap($values['repository_path'], $values['deploy_path']) || $this->pathsOverlap($values['repository_path'], $values['data_path']) || $this->pathsOverlap($values['deploy_path'], $values['data_path'])) {
                throw new RuntimeException('Katalog repozytorium, katalog wdrożenia i katalog danych nie mogą się pokrywać ani zawierać jeden w drugim.');
            }
            foreach (['node_binary', 'npm_binary'] as $field) {
                $runtime = trim((string) ($values[$field] ?? 'auto'));
                if ($runtime !== 'auto' && (!preg_match('#^/[A-Za-z0-9._/-]+$#', $runtime) || strpos($runtime, '..') !== false)) throw new RuntimeException('Wpisz „auto” albo bezpieczną, absolutną ścieżkę dla ' . $field . '.');
                $values[$field] = $runtime;
            }
            if (!preg_match('/^[a-z_][a-z0-9_-]{0,31}$/', (string) ($values['service_user'] ?? ''))) throw new RuntimeException('Nieprawidłowy użytkownik usługi Linux.');
            if (!in_array((string) ($values['bind_address'] ?? ''), ['127.0.0.1', '::1'], true)) throw new RuntimeException('Zarządzany Hub może nasłuchiwać wyłącznie na interfejsie loopback.');
            $port = filter_var($values['hub_port'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1024, 'max_range' => 65535]]);
            if ($port === false) throw new RuntimeException('Port Hub musi mieścić się w zakresie 1024–65535.');
            if (!preg_match('/^[A-Za-z0-9._@+-]{3,100}$/', (string) ($values['bootstrap_user'] ?? ''))) throw new RuntimeException('Nieprawidłowa nazwa pierwszego administratora.');
            $isSsh = strpos($repositoryUrl, 'ssh://') === 0 || strpos($repositoryUrl, 'git@') === 0;
            if ($isSsh && trim((string) ($values['git_ssh_known_hosts'] ?? '')) === '') throw new RuntimeException('Repozytorium SSH wymaga przypiętej, zweryfikowanej zawartości known_hosts.');
        }

        if (!in_array((string) ($values['auth_mode'] ?? ''), ['independent', 'plesk', 'hybrid'], true)) throw new RuntimeException('Nieprawidłowy tryb uwierzytelniania.');
        if (($values['connector_id'] ?? '') !== '' && !preg_match('/^[A-Za-z0-9_-]{2,120}$/', (string) $values['connector_id'])) throw new RuntimeException('Connector ID może zawierać 2–120 liter, cyfr, podkreśleń i myślników.');
        if (($values['plesk_url'] ?? '') !== '') {
            $values['plesk_url'] = rtrim((string) $values['plesk_url'], '/');
            $plesk = parse_url($values['plesk_url']);
            if (!is_array($plesk) || ($plesk['scheme'] ?? '') !== 'https' || empty($plesk['host']) || isset($plesk['user']) || isset($plesk['pass']) || isset($plesk['query']) || isset($plesk['fragment']) || !empty($plesk['path'])) {
                throw new RuntimeException('Adres panelu Plesk musi mieć postać https://host:8443 bez ścieżki, parametrów i danych logowania.');
            }
        }
        $this->validateIps((string) ($values['allowed_ips'] ?? ''));
        if (($values['update_manifest_url'] ?? '') !== '') {
            $manifest = parse_url((string) $values['update_manifest_url']);
            if (!is_array($manifest) || ($manifest['scheme'] ?? '') !== 'https' || empty($manifest['host']) || isset($manifest['user']) || isset($manifest['pass']) || isset($manifest['fragment'])) throw new RuntimeException('Manifest aktualizacji musi używać HTTPS i nie może zawierać danych logowania ani fragmentu.');
        }
        if (($values['update_public_key'] ?? '') !== '') {
            $encodedKey = preg_replace('/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/', '', (string) $values['update_public_key']);
            if (!is_string($encodedKey) || $encodedKey === '' || !preg_match('/^[A-Za-z0-9+\/=]+$/', $encodedKey) || base64_decode($encodedKey, true) === false) throw new RuntimeException('Klucz aktualizacji musi być prawidłowym kluczem SPKI w formacie PEM albo base64.');
        }
        foreach (['bootstrap_password' => 12, 'secret_key' => 32, 'api_token' => 24, 'shared_secret' => 32] as $field => $minimum) {
            if (($values[$field] ?? '') !== '' && strlen((string) $values[$field]) < $minimum) throw new RuntimeException('Nowa wartość „' . $field . '” musi mieć co najmniej ' . $minimum . ' znaków.');
            if (($values[$field] ?? '') !== '' && preg_match('/[\r\n\0]/', (string) $values[$field])) throw new RuntimeException('Wartość „' . $field . '” nie może zawierać znaków końca linii.');
        }
        if (($values['git_token'] ?? '') !== '' && preg_match('/[\r\n\0]/', (string) $values['git_token'])) throw new RuntimeException('Token Git nie może zawierać znaków końca linii.');
        if (($values['git_ssh_private_key'] ?? '') !== '' && strpos((string) $values['git_ssh_private_key'], 'PRIVATE KEY') === false) throw new RuntimeException('Nieprawidłowy klucz prywatny SSH.');
        return $values;
    }

    private function warnings(array $config, array $domains, array $state, $statusError)
    {
        $warnings = [];
        if (!$domains) $warnings[] = ['critical', 'Brak aktywnej domeny lub subdomeny z hostingiem WWW w Plesku.'];
        elseif ($config['panel_domain'] === '' || !isset($domains[$config['panel_domain']])) $warnings[] = ['critical', 'Wybierz domenę publikacji z listy Pleska i zapisz konfigurację.'];
        if ($config['deployment_mode'] === 'managed' && !Modules_KitsuneservBridge_Config::hasSecret('bootstrap_password')) $warnings[] = ['critical', 'Przed pierwszym wdrożeniem ustaw hasło administratora KitsuneServ.'];
        if ($config['deployment_mode'] === 'managed' && $config['service_user'] === 'root') $warnings[] = ['warning', 'Usługa działa jako root. To wariant zgodny z pełną integracją systemową, ale na produkcji warto wskazać dedykowanego użytkownika.'];
        $isSsh = strpos($config['repository_url'], 'ssh://') === 0 || strpos($config['repository_url'], 'git@') === 0;
        if ($config['deployment_mode'] === 'managed' && $isSsh && $config['git_ssh_known_hosts'] === '') $warnings[] = ['critical', 'Repozytorium SSH wymaga zweryfikowanej zawartości known_hosts.'];
        if ($config['proxy_mode'] === 'manual') $warnings[] = ['info', 'Publikacja jest ręczna — skopiuj konfigurację nginx z zakładki Instrukcja.'];
        if ($config['auth_mode'] !== 'independent' && ($config['plesk_url'] === '' || $config['connector_id'] === '' || !Modules_KitsuneservBridge_Config::hasSecret('shared_secret'))) $warnings[] = ['info', 'Brakujące ustawienia Plesk SSO zostaną wygenerowane automatycznie przy zapisie lub pierwszym wdrożeniu.'];
        if (!Modules_KitsuneservBridge_Config::hasSecret('device_token')) $warnings[] = ['info', 'Ten Plesk nie jest jeszcze sparowany jako węzeł Kitsune Hub.'];
        if ($config['update_manifest_url'] !== '' && $config['update_public_key'] === '') $warnings[] = ['critical', 'Skonfigurowano kanał aktualizacji bez klucza publicznego do weryfikacji podpisu.'];
        if ($statusError) $warnings[] = ['warning', 'Nie udało się odświeżyć stanu usługi: ' . $statusError];
        if (($state['extensionUpdate']['status'] ?? '') === 'failed') $warnings[] = ['warning', 'Automatyczna aktualizacja Plesk Bridge nie powiodła się: ' . ($state['extensionUpdate']['error'] ?? 'sprawdź log operacji.')];
        if (!empty($state['lastError'])) $warnings[] = ['critical', 'Ostatnia operacja zakończyła się błędem: ' . $state['lastError']];
        return $warnings;
    }

    private function refreshStatus()
    {
        $runtime = null;
        try {
            $runtime = Modules_KitsuneservBridge_Config::createRuntimeConfig('status');
            $result = pm_ApiCli::callSbin('kitsuneserv-bridge-r12', ['--config', $runtime], pm_ApiCli::RESULT_FULL);
            if ((int) ($result['code'] ?? 1) !== 0) {
                $detail = trim((string) ($result['stderr'] ?? $result['stdout'] ?? ''));
                return mb_substr($detail !== '' ? $detail : 'Narzędzie statusu zakończyło się błędem.', -2000);
            }
            return null;
        } catch (Throwable $exception) {
            return mb_substr($exception->getMessage(), -2000);
        } finally {
            if ($runtime && is_file($runtime)) @unlink($runtime);
        }
    }

    private function domainOptions($savedDomain = '')
    {
        $options = [];
        try {
            foreach ((array) pm_Domain::getAllDomains() as $domain) {
                if (!$domain instanceof pm_Domain || !$domain->hasHosting() || !$domain->isActive() || $domain->isSuspended() || $domain->isDisabled()) continue;
                $name = strtolower(trim((string) $domain->getName()));
                if (preg_match('/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/', $name)) $options[$name] = $name;
            }
        } catch (Throwable $exception) {
            // Walidacja zostanie ponowiona podczas zapisu i uruchamiania operacji.
        }
        natcasesort($options);
        return $options;
    }

    private function domainNames()
    {
        $result = [];
        try {
            $client = pm_Session::getClient();
            foreach ((array) pm_Domain::getAllDomains() as $domain) {
                if ($client->isAdmin() || $client->hasAccessToDomain($domain->getId())) $result[] = $domain->getName();
                if (count($result) >= 500) break;
            }
        } catch (Throwable $exception) {}
        natcasesort($result);
        return array_values($result);
    }

    private function manualProxy(array $config)
    {
        $port = max(1024, min(65535, (int) ($config['hub_port'] ?: 10000)));
        return "# Dodatkowe dyrektywy nginx dla wybranej domeny Pleska\n"
            . "# Działa równolegle z Plesk Proxy Mode i zachowuje /.well-known.\n"
            . "rewrite ^/(?!\\.well-known(?:/|$)|__kitsuneserv_bridge_internal__$).* /__kitsuneserv_bridge_internal__ last;\n\n"
            . "location = /__kitsuneserv_bridge_internal__ {\n"
            . "    internal;\n"
            . "    proxy_pass http://127.0.0.1:" . $port . "\$request_uri;\n"
            . "    proxy_http_version 1.1;\n"
            . "    proxy_set_header Host \$host;\n"
            . "    proxy_set_header X-Real-IP \$remote_addr;\n"
            . "    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\n"
            . "    proxy_set_header X-Forwarded-Proto \$scheme;\n"
            . "    proxy_set_header Upgrade \$http_upgrade;\n"
            . "    proxy_set_header Connection \"upgrade\";\n"
            . "    proxy_read_timeout 300s;\n    proxy_send_timeout 300s;\n    proxy_buffering off;\n    client_max_body_size 64m;\n}";
    }

    private function secretStatus()
    {
        $result = [];
        foreach (['git_token', 'git_ssh_private_key', 'bootstrap_password', 'secret_key', 'api_token', 'shared_secret'] as $field) {
            $result[$field] = Modules_KitsuneservBridge_Config::hasSecret($field);
        }
        return $result;
    }

    private function validatePath($value, $field)
    {
        if (!preg_match('#^/(?:home|opt|srv|var/lib)/[A-Za-z0-9._/-]+$#', $value) || strpos($value, '..') !== false || strlen($value) > 1000) {
            throw new RuntimeException('Nieprawidłowa ścieżka „' . $field . '”. Użyj pełnej ścieżki w /home, /opt, /srv albo /var/lib.');
        }
    }

    private function validateIps($value)
    {
        foreach (preg_split('/\s*,\s*/', trim($value), -1, PREG_SPLIT_NO_EMPTY) as $entry) {
            $parts = explode('/', $entry, 2);
            if (!filter_var($parts[0], FILTER_VALIDATE_IP)) throw new RuntimeException('Nieprawidłowy adres na liście dozwolonych IP: ' . $entry);
            if (isset($parts[1])) {
                $max = strpos($parts[0], ':') !== false ? 128 : 32;
                if (!ctype_digit($parts[1]) || (int) $parts[1] < 0 || (int) $parts[1] > $max) throw new RuntimeException('Nieprawidłowy prefiks CIDR: ' . $entry);
            }
        }
    }

    private function pathsOverlap($left, $right)
    {
        $left = rtrim((string) $left, '/');
        $right = rtrim((string) $right, '/');
        return $left === $right || strpos($left . '/', $right . '/') === 0 || strpos($right . '/', $left . '/') === 0;
    }

    private function operationLabel($action)
    {
        return ['check' => 'sprawdź', 'sync' => 'pobierz kod', 'deploy' => 'wdrożenie', 'sync-deploy' => 'pobierz i wdróż', 'start' => 'uruchom', 'stop' => 'zatrzymaj', 'restart' => 'restart', 'proxy' => 'skonfiguruj proxy'][$action] ?? $action;
    }

    private function currentPleskOrigin()
    {
        $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
        if ($host === '' || preg_match('/[\r\n\0\/\\@]/', $host)) return '';
        $parts = parse_url('https://' . $host);
        if (!is_array($parts) || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['path']) || isset($parts['query']) || isset($parts['fragment'])) return '';
        $origin = 'https://' . (strpos((string) $parts['host'], ':') !== false ? '[' . $parts['host'] . ']' : strtolower((string) $parts['host']));
        if (isset($parts['port']) && (int) $parts['port'] !== 443) $origin .= ':' . (int) $parts['port'];
        return $origin;
    }

    private function client()
    {
        return new Modules_KitsuneservBridge_HubClient(pm_Settings::get('hub_url', ''));
    }

    private function requireAdmin()
    {
        if (!pm_Session::getClient()->isAdmin()) throw new pm_Exception('Wymagany jest dostęp administratora Pleska.');
    }

    private function canUseHub()
    {
        $client = pm_Session::getClient();
        if ($client->isAdmin() || $client->isReseller()) return true;
        try {
            foreach (pm_Session::getCurrentDomains(true) as $domain) if ($client->hasPermission('use_hub', $domain)) return true;
        } catch (Throwable $exception) {}
        return false;
    }

    private function secret($key)
    {
        try { return (string) pm_Settings::getDecrypted($key); }
        catch (Throwable $exception) { return ''; }
    }
}
