<?php

class Modules_KitsuneservBridge_Suite
{
    public const HUB_ID = 'kitsuneserv-bridge';
    private const CATALOG_SETTING = 'suite_update_catalog';

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

    private const REPOSITORIES = [
        'kitsuneartifactory-manager' => ['url' => 'https://github.com/nerdrip/KitsuneArtifactory.git', 'source' => 'tools/plesk-extension/kitsuneartifactory-manager'],
        'kitsuneirc-manager' => ['url' => 'https://github.com/nerdrip/kitsune-irc.git', 'source' => 'tools/plesk-extension/kitsuneirc-manager'],
        'kitsunecolab-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/kitsunecolab.git', 'source' => 'tools/plesk-extension/kitsunecolab-manager'],
        'kitsunepaint-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/kitsunepaint.git', 'source' => 'tools/plesk-extension/kitsunepaint-manager'],
        'kitsunepnc-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/kitsunepnc.git', 'source' => 'tools/plesk-extension/kitsunepnc-manager'],
        'kitsunetab-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/kitsunetab.git', 'source' => 'tools/plesk-extension/kitsunetab-manager'],
        'kitsunetest-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/kitsunetest.git', 'source' => 'tools/plesk-extension/kitsunetest-manager'],
        'nailit-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/nailit.git', 'source' => 'tools/plesk-extension/nailit-manager'],
        'kitsune-git' => ['url' => 'https://github.com/nerdrip/kitsune-git.git', 'source' => 'deploy/plesk'],
        'wpkit-parse-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/wpkit.git', 'source' => 'tools/plesk-extension/wpkit-parse-manager'],
        'nerd-apps-runtime-manager' => ['url' => 'ssh://git@git.servx.site:32785/boberski/dicex.git', 'source' => 'tools/plesk-extension/nerd-apps-runtime-manager'],
        'ultimate-tool' => ['url' => 'ssh://git@git.servx.site:32785/boberski/ultimatetool.git', 'source' => 'plesk-extension'],
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
            $packages = [];
            foreach (self::REPOSITORIES as $id => $repository) {
                $metadata = self::repositoryOperation($id, 'check');
                $packages[] = [
                    'id' => $id,
                    'name' => $metadata['name'],
                    'version' => $metadata['version'],
                    'release' => $metadata['release'],
                    'branch' => $metadata['branch'],
                    'commit' => $metadata['commit'],
                    'repository' => $repository['url'],
                ];
            }
            $catalog = [
                'checkedAt' => gmdate('c'),
                'generatedAt' => gmdate('c'),
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

        return self::repositoryOperation($id, 'install');
    }

    private static function repositoryOperation($id, $mode)
    {
        if (!isset(self::REPOSITORIES[$id]) || !in_array($mode, ['check', 'install'], true)) throw new RuntimeException('Nieprawidłowa operacja repozytorium Suite.');
        $repository = self::REPOSITORIES[$id];
        $runtime = null;
        try {
            $runtime = Modules_KitsuneservBridge_Config::createRuntimeConfig('suite-extension-' . $mode, [
                'extensionId' => $id,
                'repositoryUrl' => $repository['url'],
                'repositoryBranch' => 'main',
                'extensionSource' => $repository['source'],
            ]);
            $result = pm_ApiCli::callSbin('kitsune-suite-self-update', ['--' . $mode, $runtime], pm_ApiCli::RESULT_FULL);
            if ((int) ($result['code'] ?? 1) !== 0) {
                $detail = trim((string) ($result['stderr'] ?? $result['stdout'] ?? ''));
                throw new RuntimeException($detail !== '' ? mb_substr($detail, -3000) : 'Runner repozytorium Suite zakończył się błędem.');
            }
            if (!preg_match('/^KITSUNE_SELF_UPDATE_RESULT=(\{[^\r\n]+\})$/m', (string) ($result['stdout'] ?? ''), $match)) throw new RuntimeException('Runner repozytorium Suite nie zwrócił metadanych.');
            $metadata = json_decode($match[1], true);
            if (!is_array($metadata) || (string) ($metadata['id'] ?? '') !== $id || !preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', (string) ($metadata['version'] ?? '')) || !preg_match('/^[1-9]\d{0,8}$/', (string) ($metadata['release'] ?? '')) || !preg_match('/^[a-f0-9]{40,64}$/', (string) ($metadata['commit'] ?? ''))) throw new RuntimeException('Runner repozytorium Suite zwrócił nieprawidłowe metadane.');
            return $metadata;
        } finally {
            if ($runtime !== null && is_file($runtime)) @unlink($runtime);
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

    private static function isNewer($currentVersion, $currentRelease, $candidateVersion, $candidateRelease)
    {
        $comparison = version_compare((string) $candidateVersion, (string) $currentVersion);
        return $comparison > 0 || ($comparison === 0 && (int) $candidateRelease > (int) $currentRelease);
    }

}
