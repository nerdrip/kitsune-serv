<?php

class Modules_KitsuneservBridge_HubClient
{
    private $hubUrl;

    public function __construct($hubUrl)
    {
        $this->hubUrl = rtrim((string)$hubUrl, '/');
        $parts = parse_url($this->hubUrl);
        $local = isset($parts['host']) && in_array(strtolower($parts['host']), ['127.0.0.1', 'localhost', '::1'], true);
        if (!$parts || !isset($parts['scheme'], $parts['host']) || ($parts['scheme'] !== 'https' && !($parts['scheme'] === 'http' && $local))) {
            throw new pm_Exception('Hub URL must use HTTPS (loopback HTTP is allowed for local testing).');
        }
    }

    public function pair($code, array $device)
    {
        return $this->request('/auth/pair', ['code' => $code, 'device' => $device]);
    }

    public function heartbeat($nodeId, $token, array $inventory)
    {
        return $this->request('/api/hub/heartbeat', ['nodeId' => $nodeId, 'input' => ['inventory' => $inventory, 'version' => '3.1.1', 'platform' => PHP_OS_FAMILY]], $token);
    }

    public function probe()
    {
        try { $token = pm_Settings::getDecrypted('device_token'); } catch (Exception $e) { $token = ''; }
        return $this->request('/api/hub/status', [], $token);
    }

    private function request($path, array $payload, $token = '')
    {
        $handle = curl_init($this->hubUrl . $path);
        $headers = ['Accept: application/json', 'Content-Type: application/json'];
        if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($handle); $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE); $error = curl_error($handle); curl_close($handle);
        if ($body === false || $error !== '') throw new pm_Exception('Hub connection failed: ' . $error);
        $result = json_decode($body, true);
        if ($status < 200 || $status >= 300) throw new pm_Exception(isset($result['error']) ? $result['error'] : 'Hub returned HTTP ' . $status);
        if (!is_array($result)) throw new pm_Exception('Hub returned an invalid response.');
        return $result;
    }
}
