<?php

class Modules_KitsuneservBridge_Suite
{
    public const HUB_ID = 'kitsuneserv-bridge';
    public const DEFAULT_MANIFEST_URL = 'https://raw.githubusercontent.com/nerdrip/kitsune-serv/main/update/manifest.json';

    private const CATALOG_SETTING = 'suite_update_catalog';
    private const MAX_MANIFEST_BYTES = 2097152;
    private const MAX_PACKAGE_BYTES = 134217728;

    private const KNOWN_IDS = [
        'kitsuneirc-manager',
        'kitsune-manager',
        'kitsuneartifactory-manager',
        'kitsunecolab-manager',
        'kitsunepaint-manager',
        'kitsunepnc-manager',
        'kitsunetab-manager',
        'kitsunetest-manager',
        'nailit-manager',
        'kitsune-git',
        'wpkit-parse-manager',
        'nerd-apps-runtime-manager',
        'ultimate-tool',
        self::HUB_ID,
    ];

    private const ICONS = [
        'kitsuneartifactory-manager' => 'kitsuneartifactory-menu.svg',
        'kitsuneirc-manager' => 'kitsuneirc-menu.svg',
        'kitsune-manager' => 'kitsunecolab-menu.svg',
        'kitsunecolab-manager' => 'kitsunecolab-menu.svg',
        'kitsunepaint-manager' => 'kitsunepaint-menu.svg',
        'kitsunepnc-manager' => 'kitsunepnc-menu.svg',
        'kitsunetab-manager' => 'kitsunetab-menu.svg',
        'kitsunetest-manager' => 'kitsunetest-menu.svg',
        'nailit-manager' => 'nailit-menu.svg',
        'kitsune-git' => 'kitsune-git-menu.svg',
        'wpkit-parse-manager' => 'wpkit-parse-menu.svg',
        'nerd-apps-runtime-manager' => 'nerd-runtime-menu.svg',
        'ultimate-tool' => 'ultimate-tool-menu.svg',
        self::HUB_ID => 'kitsune-hub-menu.svg',
    ];

    public static function installedExtensions()
    {
        $catalog = self::catalog();
        $packages = [];
        foreach ((array) ($catalog['packages'] ?? []) as $package) {
            if (is_array($package) && isset($package['id'])) $packages[(string) $package['id']] = $package;
        }
        $items = [];
        foreach (pm_Extension::getExtensions() as $extension) {
            try {
                $id = (string) $extension->getId();
                $name = (string) $extension->getName();
                if (!self::isSuiteExtension($id, $name)) continue;
                $item = [
                    'id' => $id,
                    'name' => $name,
                    'version' => (string) $extension->getVersion(),
                    'release' => (string) $extension->getRelease(),
                    'active' => (bool) $extension->isActive(),
                    'isHub' => $id === self::HUB_ID,
                    'url' => self::extensionUrl($id),
                    'icon' => self::extensionIcon($id),
                    'updateStatus' => empty($catalog['checkedAt']) ? 'unchecked' : 'missing',
                    'availableVersion' => '',
                    'availableRelease' => '',
                ];
                if (isset($packages[$id])) {
                    $package = $packages[$id];
                    $item['availableVersion'] = (string) $package['version'];
                    $item['availableRelease'] = (string) $package['release'];
                    $item['updateStatus'] = self::isNewer($item['version'], $item['release'], $item['availableVersion'], $item['availableRelease']) ? 'available' : 'current';
                }
                if ($item['isHub']) $item['updateStatus'] = 'hub';
                $items[] = $item;
            } catch (Throwable $exception) {
                continue;
            }
        }
        usort($items, static function ($left, $right) {
            if ($left['isHub'] !== $right['isHub']) return $left['isHub'] ? -1 : 1;
            return strcasecmp($left['name'], $right['name']);
        });
        return $items;
    }

    public static function catalog()
    {
        $raw = (string) pm_Settings::get(self::CATALOG_SETTING, '');
        if ($raw === '') return ['checkedAt' => '', 'generatedAt' => '', 'packages' => [], 'error' => ''];
        $catalog = json_decode($raw, true);
        return is_array($catalog) ? array_merge(['checkedAt' => '', 'generatedAt' => '', 'packages' => [], 'error' => ''], $catalog) : ['checkedAt' => '', 'generatedAt' => '', 'packages' => [], 'error' => 'Zapisany stan katalogu jest uszkodzony.'];
    }

    public static function refreshCatalog()
    {
        try {
            $body = self::downloadToMemory(self::DEFAULT_MANIFEST_URL, self::MAX_MANIFEST_BYTES);
            $manifest = json_decode($body, true);
            if (!is_array($manifest) || (int) ($manifest['schemaVersion'] ?? 0) !== 1 || !is_array($manifest['packages'] ?? null)) {
                throw new RuntimeException('Repozytorium zwróciło nieprawidłowy manifest aktualizacji.');
            }
            $packages = [];
            $seen = [];
            foreach ($manifest['packages'] as $package) {
                $package = self::validateCatalogPackage($package);
                if (isset($seen[$package['id']])) throw new RuntimeException('Manifest zawiera powtórzony identyfikator ' . $package['id'] . '.');
                $seen[$package['id']] = true;
                $packages[] = $package;
            }
            $catalog = [
                'checkedAt' => gmdate('c'),
                'generatedAt' => trim((string) ($manifest['generatedAt'] ?? '')),
                'packages' => $packages,
                'error' => '',
            ];
            pm_Settings::set(self::CATALOG_SETTING, json_encode($catalog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            return $catalog;
        } catch (Throwable $exception) {
            $catalog = self::catalog();
            $catalog['checkedAt'] = gmdate('c');
            $catalog['error'] = $exception->getMessage();
            pm_Settings::set(self::CATALOG_SETTING, json_encode($catalog, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            throw $exception;
        }
    }

    public static function updateFromCatalog($id)
    {
        $id = strtolower(trim((string) $id));
        if (!in_array($id, self::KNOWN_IDS, true) || $id === self::HUB_ID) throw new RuntimeException('Wybierz manager produktu obsługiwany przez Kitsune Suite.');
        $catalog = self::refreshCatalog();
        $package = null;
        foreach ($catalog['packages'] as $candidate) {
            if ($candidate['id'] === $id) { $package = $candidate; break; }
        }
        if (!$package) throw new RuntimeException('Repozytorium nie zawiera paczki dla ' . $id . '.');

        $installed = pm_Extension::getById($id);
        $installedVersion = (string) $installed->getVersion();
        $installedRelease = (string) $installed->getRelease();
        if (!self::isNewer($installedVersion, $installedRelease, $package['version'], $package['release'])) {
            throw new RuntimeException('Wersja ' . $installedVersion . '-r' . $installedRelease . ' jest już aktualna.');
        }

        $temporary = tempnam(pm_Context::getVarDir(), 'suite-update-');
        if ($temporary === false) throw new RuntimeException('Nie można utworzyć pliku tymczasowego aktualizacji.');
        try {
            self::downloadToFile(self::packageUrl($package['file']), $temporary, self::MAX_PACKAGE_BYTES);
            $digest = hash_file('sha256', $temporary);
            if (!is_string($digest) || !hash_equals($package['sha256'], strtolower($digest))) throw new RuntimeException('Suma SHA-256 pobranej paczki jest nieprawidłowa.');
            $metadata = self::inspectPackage($temporary);
            foreach (['id', 'version', 'release'] as $field) {
                if ((string) $metadata[$field] !== (string) $package[$field]) throw new RuntimeException('Metadane paczki nie odpowiadają manifestowi (' . $field . ').');
            }
            pm_Extension::installByFile($temporary);
            return $metadata;
        } finally {
            if (is_file($temporary)) @unlink($temporary);
        }
    }

    public static function isSuiteExtension($id, $name = '')
    {
        $id = strtolower(trim((string) $id));
        if (in_array($id, self::KNOWN_IDS, true)) return true;
        return preg_match('/(?:kitsune|nailit|wpkit)/i', $id . ' ' . (string) $name) === 1;
    }

    public static function extensionUrl($id)
    {
        if (!preg_match('/^[a-z0-9][a-z0-9._-]{1,63}$/', (string) $id)) return pm_Context::getModulesListUrl();
        return '/modules/' . rawurlencode((string) $id) . '/index.php/index/index';
    }

    public static function extensionIcon($id)
    {
        $id = strtolower(trim((string) $id));
        $icon = self::ICONS[$id] ?? 'icon.png';
        return '/modules/' . rawurlencode($id) . '/images/' . rawurlencode($icon);
    }

    public static function inspectPackage($path)
    {
        if (!is_file($path)) throw new RuntimeException('Nie odebrano paczki ZIP.');
        if (!class_exists('ZipArchive')) throw new RuntimeException('Plesk PHP nie udostępnia rozszerzenia ZipArchive.');
        $archive = new ZipArchive();
        if ($archive->open($path) !== true) throw new RuntimeException('Nie można otworzyć paczki ZIP.');
        try {
            $metadata = $archive->getFromName('meta.xml');
            if ($metadata === false) throw new RuntimeException('Paczka nie zawiera meta.xml w katalogu głównym.');
        } finally {
            $archive->close();
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $xml = simplexml_load_string($metadata, 'SimpleXMLElement', LIBXML_NONET);
            if ($xml === false) throw new RuntimeException('meta.xml w paczce jest nieprawidłowy.');
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
        $id = trim((string) $xml->id);
        $name = trim((string) $xml->name);
        $version = trim((string) $xml->version);
        $release = trim((string) $xml->release);
        if (!self::isSuiteExtension($id, $name)) throw new RuntimeException('To nie jest paczka rozszerzenia Kitsune Plesk Suite.');
        if ($id === self::HUB_ID) throw new RuntimeException('Kitsune Hub aktualizuj w zakładce Wdrożenie, aby zachować bezpieczny restart zadania.');
        if (!preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', $version)) throw new RuntimeException('Paczka nie ma prawidłowej wersji semantycznej.');
        if ($release === '' || strlen($release) > 32) throw new RuntimeException('Paczka nie ma prawidłowego numeru wydania.');
        return ['id' => $id, 'name' => $name, 'version' => $version, 'release' => $release];
    }

    private static function validateCatalogPackage($package)
    {
        if (!is_array($package)) throw new RuntimeException('Manifest zawiera nieprawidłowy wpis paczki.');
        $normalized = [];
        foreach (['id', 'name', 'version', 'release', 'file', 'sha256'] as $field) $normalized[$field] = trim((string) ($package[$field] ?? ''));
        if (!in_array($normalized['id'], self::KNOWN_IDS, true)) throw new RuntimeException('Manifest zawiera nieznane rozszerzenie ' . $normalized['id'] . '.');
        if ($normalized['name'] === '' || strlen($normalized['name']) > 160) throw new RuntimeException('Manifest zawiera nieprawidłową nazwę rozszerzenia.');
        if (!preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', $normalized['version'])) throw new RuntimeException('Manifest zawiera nieprawidłową wersję dla ' . $normalized['id'] . '.');
        if (!preg_match('/^\d+$/', $normalized['release'])) throw new RuntimeException('Manifest zawiera nieprawidłowe wydanie dla ' . $normalized['id'] . '.');
        if (!preg_match('#^packages/[A-Za-z0-9][A-Za-z0-9._-]*\.zip$#', $normalized['file'])) throw new RuntimeException('Manifest zawiera nieprawidłową ścieżkę paczki dla ' . $normalized['id'] . '.');
        if (!preg_match('/^[a-f0-9]{64}$/', $normalized['sha256'])) throw new RuntimeException('Manifest nie zawiera prawidłowej sumy SHA-256 dla ' . $normalized['id'] . '.');
        return $normalized;
    }

    private static function isNewer($currentVersion, $currentRelease, $candidateVersion, $candidateRelease)
    {
        $comparison = version_compare((string) $candidateVersion, (string) $currentVersion);
        return $comparison > 0 || ($comparison === 0 && (int) $candidateRelease > (int) $currentRelease);
    }

    private static function packageUrl($relative)
    {
        $base = substr(self::DEFAULT_MANIFEST_URL, 0, strrpos(self::DEFAULT_MANIFEST_URL, '/') + 1);
        return $base . $relative;
    }

    private static function downloadToMemory($url, $maximumBytes)
    {
        $body = '';
        self::request($url, function ($chunk) use (&$body, $maximumBytes) {
            if (strlen($body) + strlen($chunk) > $maximumBytes) return 0;
            $body .= $chunk;
            return strlen($chunk);
        });
        return $body;
    }

    private static function downloadToFile($url, $path, $maximumBytes)
    {
        $stream = fopen($path, 'wb');
        if ($stream === false) throw new RuntimeException('Nie można zapisać pobieranej paczki.');
        $written = 0;
        try {
            self::request($url, function ($chunk) use ($stream, &$written, $maximumBytes) {
                $length = strlen($chunk);
                if ($written + $length > $maximumBytes) return 0;
                $result = fwrite($stream, $chunk);
                if ($result !== $length) return 0;
                $written += $result;
                return $result;
            });
        } finally {
            fclose($stream);
        }
        if ($written < 1) throw new RuntimeException('Repozytorium zwróciło pustą paczkę.');
    }

    private static function request($url, callable $writer)
    {
        $parts = parse_url((string) $url);
        if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host']) || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
            throw new RuntimeException('Kanał aktualizacji musi używać bezpiecznego adresu HTTPS.');
        }
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_HTTPHEADER => ['Accept: application/json, application/zip', 'User-Agent: Kitsune-Plesk-Suite/' . Modules_KitsuneservBridge_Config::EXTENSION_VERSION],
            CURLOPT_RETURNTRANSFER => false,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 180,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
            CURLOPT_WRITEFUNCTION => static function ($handle, $chunk) use ($writer) { return $writer($chunk); },
        ]);
        $ok = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        if ($ok === false) throw new RuntimeException('Nie pobrano danych aktualizacji: ' . ($error !== '' ? $error : 'przekroczono dozwolony rozmiar odpowiedzi'));
        if ($status < 200 || $status >= 300) throw new RuntimeException('Repozytorium aktualizacji zwróciło HTTP ' . $status . '.');
    }
}
