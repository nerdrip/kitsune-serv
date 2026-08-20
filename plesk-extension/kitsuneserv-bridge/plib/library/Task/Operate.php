<?php

class Modules_KitsuneservBridge_Task_Operate extends pm_LongTask_Task
{
    public $trackProgress = true;

    public function run()
    {
        $runtimeConfig = (string) $this->getParam('runtimeConfig');
        try {
            $config = json_decode((string) @file_get_contents($runtimeConfig), true);
            if (!is_array($config)) $config = [];
            $this->updateProgress(5);
            $result = pm_ApiCli::callSbin('kitsuneserv-bridge-r17', ['--config', $runtimeConfig], pm_ApiCli::RESULT_FULL);
            if ((int) ($result['code'] ?? 1) !== 0) {
                $detail = trim((string) ($result['stderr'] ?? $result['stdout'] ?? 'Operation failed.'));
                throw new RuntimeException($detail !== '' ? $detail : 'Operation failed.');
            }
            $this->updateProgress(90);
            $connectionMessage = $this->finishAutomaticConnection($config);
            $this->updateProgress(100);
            return trim((string) ($result['stdout'] ?? 'OK') . ($connectionMessage !== '' ? "\n" . $connectionMessage : ''));
        } finally {
            if ($runtimeConfig !== '' && is_file($runtimeConfig)) @unlink($runtimeConfig);
        }
    }

    private function finishAutomaticConnection(array $config)
    {
        if (!in_array((string) ($config['action'] ?? ''), ['deploy', 'sync-deploy', 'start', 'restart'], true) || ($config['auth_mode'] ?? 'hybrid') === 'independent') return '';
        try {
            $hubUrl = trim((string) ($config['hub_url'] ?? ''));
            $connectorId = trim((string) ($config['connector_id'] ?? ''));
            $sharedSecret = (string) ($config['shared_secret'] ?? '');
            if ($hubUrl === '' || $connectorId === '' || $sharedSecret === '') throw new RuntimeException('Brakuje automatycznych danych zaufania Bridge.');
            $client = new Modules_KitsuneservBridge_HubClient($hubUrl);
            $inventory = $this->inventory($config);
            $nodeId = (string) pm_Settings::get('node_id', '');
            try { $token = (string) pm_Settings::getDecrypted('device_token'); } catch (Throwable $exception) { $token = ''; }
            if ($nodeId !== '' && $token !== '') {
                try {
                    $client->heartbeat($nodeId, $token, $inventory);
                    pm_Settings::set('last_sync', gmdate('c'));
                    pm_Settings::set('automatic_connection_error', '');
                    return 'Automatyczne SSO i inwentarz węzła zostały odświeżone.';
                } catch (Throwable $exception) {
                    // Token mógł zostać unieważniony po odtworzeniu Huba; podpisany enrollment naprawi połączenie.
                }
            }
            $enrolled = $client->autoEnroll($connectorId, $sharedSecret, [
                'name' => gethostname() ?: 'Plesk', 'platform' => PHP_OS_FAMILY,
                'version' => Modules_KitsuneservBridge_Config::EXTENSION_VERSION,
                'address' => (string) ($config['plesk_url'] ?? ''),
                'capabilities' => ['plesk-sso', 'domains', 'inventory', 'projects', 'labs', 'api-flows', 'managed-deployment'],
            ]);
            if (empty($enrolled['token']) || empty($enrolled['node']['id'])) throw new RuntimeException('Hub nie zwrócił danych rejestracji.');
            pm_Settings::setEncrypted('device_token', (string) $enrolled['token']);
            pm_Settings::set('node_id', (string) $enrolled['node']['id']);
            $client->heartbeat((string) $enrolled['node']['id'], (string) $enrolled['token'], $inventory);
            pm_Settings::set('last_sync', gmdate('c'));
            pm_Settings::set('automatic_connection_error', '');
            return 'Automatyczne SSO i węzeł Plesk zostały połączone bez kodu parowania.';
        } catch (Throwable $exception) {
            pm_Settings::set('automatic_connection_error', mb_substr($exception->getMessage(), 0, 1500));
            return 'UWAGA: Hub działa, ale automatyczne połączenie zostanie ponowione przy otwarciu Bridge: ' . $exception->getMessage();
        }
    }

    private function inventory(array $config)
    {
        $domains = [];
        if (!empty($config['panel_domain'])) $domains[] = (string) $config['panel_domain'];
        foreach (preg_split('/\s*,\s*/', (string) ($config['proxy_domains'] ?? $config['api_domains'] ?? ''), -1, PREG_SPLIT_NO_EMPTY) as $domain) $domains[] = $domain;
        return [
            'pleskVersion' => pm_ProductInfo::getVersion(), 'bridgeVersion' => Modules_KitsuneservBridge_Config::EXTENSION_VERSION,
            'hostname' => gethostname(), 'domains' => array_values(array_unique($domains)),
            'hubDomain' => (string) ($config['panel_domain'] ?? ''),
            'apiDomains' => array_values(array_diff($domains, [(string) ($config['panel_domain'] ?? '')])),
            'authMode' => (string) ($config['auth_mode'] ?? 'hybrid'), 'deploymentMode' => (string) ($config['deployment_mode'] ?? 'managed'),
        ];
    }
}
