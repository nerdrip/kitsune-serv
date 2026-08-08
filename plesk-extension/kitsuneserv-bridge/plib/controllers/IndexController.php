<?php

class IndexController extends pm_Controller_Action
{
    public function indexAction()
    {
        $client = pm_Session::getClient();
        $this->view->isAdmin = $client->isAdmin();
        $this->view->settings = [
            'hubUrl' => pm_Settings::get('hub_url', ''),
            'panelDomain' => pm_Settings::get('panel_domain', ''),
            'connectorId' => pm_Settings::get('connector_id', ''),
            'authMode' => pm_Settings::get('auth_mode', 'hybrid'),
            'autoProvision' => pm_Settings::get('auto_provision', '1') === '1',
            'paired' => $this->secret('device_token') !== '',
            'nodeId' => pm_Settings::get('node_id', ''),
            'lastSync' => pm_Settings::get('last_sync', ''),
        ];
    }

    public function saveAction()
    {
        $this->requireAdmin();
        if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        $hubUrl = rtrim(trim((string)$this->getRequest()->getPost('hub_url')), '/');
        new Modules_KitsuneservBridge_HubClient($hubUrl);
        $panelDomain = strtolower(trim((string)$this->getRequest()->getPost('panel_domain')));
        if ($panelDomain !== '' && !preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/', $panelDomain)) throw new pm_Exception('Invalid panel domain.');
        $mode = (string)$this->getRequest()->getPost('auth_mode'); if (!in_array($mode, ['independent', 'plesk', 'hybrid'], true)) $mode = 'hybrid';
        pm_Settings::set('hub_url', $hubUrl); pm_Settings::set('panel_domain', $panelDomain); pm_Settings::set('connector_id', trim((string)$this->getRequest()->getPost('connector_id'))); pm_Settings::set('auth_mode', $mode); pm_Settings::set('auto_provision', $this->getRequest()->getPost('auto_provision') ? '1' : '0');
        $secret = (string)$this->getRequest()->getPost('shared_secret'); if ($secret !== '') pm_Settings::setEncrypted('shared_secret', $secret);
        $this->_status->addMessage('info', 'Kitsune Hub configuration saved.'); $this->_helper->redirector('index');
    }

    public function pairAction()
    {
        $this->requireAdmin(); if (!$this->getRequest()->isPost()) throw new pm_Exception('POST is required.');
        $code = strtolower(trim((string)$this->getRequest()->getPost('pairing_code'))); if (!preg_match('/^[a-f0-9]{6}-[a-f0-9]{6}$/', $code)) throw new pm_Exception('Invalid pairing code.');
        $result = $this->client()->pair($code, ['name' => gethostname() ?: 'Plesk', 'platform' => PHP_OS_FAMILY, 'version' => '3.0.0', 'capabilities' => ['plesk-sso', 'domains', 'inventory']]);
        if (empty($result['token']) || empty($result['node']['id'])) throw new pm_Exception('Hub did not return enrollment credentials.');
        pm_Settings::setEncrypted('device_token', $result['token']); pm_Settings::set('node_id', $result['node']['id']);
        $this->_status->addMessage('info', 'Plesk node paired with Kitsune Hub.'); $this->_helper->redirector('index');
    }

    public function syncAction()
    {
        $this->requireAdmin(); $nodeId = pm_Settings::get('node_id', ''); $token = $this->secret('device_token'); if ($nodeId === '' || $token === '') throw new pm_Exception('Pair this Plesk server first.');
        $inventory = ['pleskVersion' => pm_ProductInfo::getVersion(), 'hostname' => gethostname(), 'domains' => $this->domainNames(), 'authMode' => pm_Settings::get('auth_mode', 'hybrid')];
        $this->client()->heartbeat($nodeId, $token, $inventory); pm_Settings::set('last_sync', gmdate('c'));
        $this->_status->addMessage('info', 'Plesk inventory synchronized.'); $this->_helper->redirector('index');
    }

    public function ssoAction()
    {
        if (!$this->canUseHub()) throw new pm_Exception('Your service plan does not allow Kitsune Hub.');
        $hubUrl = pm_Settings::get('hub_url', ''); $connectorId = pm_Settings::get('connector_id', ''); $secret = $this->secret('shared_secret');
        if ($hubUrl === '' || $connectorId === '' || $secret === '') throw new pm_Exception('Kitsune Hub SSO is not configured.');
        $client = pm_Session::getClient(); $now = (int)round(microtime(true) * 1000);
        $claims = ['connectorId' => $connectorId, 'subject' => (string)$client->getId(), 'username' => (string)$client->getProperty('login'), 'displayName' => (string)$client->getProperty('pname'), 'email' => (string)$client->getProperty('email'), 'role' => $client->isAdmin() ? 'admin' : ($client->isReseller() ? 'reseller' : 'customer'), 'domains' => $this->domainNames(), 'iat' => $now, 'exp' => $now + 60000, 'nonce' => bin2hex(random_bytes(16))];
        $json = json_encode($claims, JSON_UNESCAPED_SLASHES); $assertion = rtrim(strtr(base64_encode($json), '+/', '-_'), '='); $signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $assertion, $secret, true)), '+/', '-_'), '=');
        $this->view->hubAuthUrl = rtrim($hubUrl, '/') . '/auth/plesk'; $this->view->assertion = $assertion; $this->view->signature = $signature;
    }

    private function client() { return new Modules_KitsuneservBridge_HubClient(pm_Settings::get('hub_url', '')); }
    private function requireAdmin() { if (!pm_Session::getClient()->isAdmin()) throw new pm_Exception('Administrator access is required.'); }
    private function canUseHub() { $client = pm_Session::getClient(); if ($client->isAdmin() || $client->isReseller()) return true; try { foreach (pm_Session::getCurrentDomains(true) as $domain) if ($client->hasPermission('use_hub', $domain)) return true; } catch (Exception $e) {} return false; }
    private function domainNames() { $result = []; try { $client = pm_Session::getClient(); foreach (pm_Domain::getAll() as $domain) { if ($client->isAdmin() || $client->hasAccessToDomain($domain->getId())) $result[] = $domain->getName(); if (count($result) >= 500) break; } } catch (Exception $e) {} sort($result); return $result; }
    private function secret($key) { try { return (string)pm_Settings::getDecrypted($key); } catch (Exception $e) { return ''; } }
}
