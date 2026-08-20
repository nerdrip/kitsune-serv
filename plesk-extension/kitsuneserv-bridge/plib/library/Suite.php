<?php

class Modules_KitsuneservBridge_Suite
{
    public const HUB_ID = 'kitsuneserv-bridge';

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
        self::HUB_ID,
    ];

    public static function installedExtensions()
    {
        $items = [];
        foreach (pm_Extension::getExtensions() as $extension) {
            try {
                $id = (string) $extension->getId();
                $name = (string) $extension->getName();
                if (!self::isSuiteExtension($id, $name)) continue;
                $items[] = [
                    'id' => $id,
                    'name' => $name,
                    'version' => (string) $extension->getVersion(),
                    'release' => (string) $extension->getRelease(),
                    'active' => (bool) $extension->isActive(),
                    'isHub' => $id === self::HUB_ID,
                    'url' => self::extensionUrl($id),
                ];
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
}
