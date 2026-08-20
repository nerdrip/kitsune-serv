<?php

pm_Context::init('kitsuneserv-bridge');
require_once dirname(__DIR__) . '/library/Config.php';

$varDir = pm_Context::getVarDir();
if (!is_dir($varDir)) mkdir($varDir, 0700, true);
@chmod($varDir, 0700);
if (is_file($varDir . '/state.json')) @chmod($varDir . '/state.json', 0644);

foreach (Modules_KitsuneservBridge_Config::defaults() as $key => $value) {
    if (pm_Settings::get($key) === null) pm_Settings::set($key, (string) $value);
}
foreach (['node_binary' => '/usr/bin/node', 'npm_binary' => '/usr/bin/npm'] as $key => $legacyDefault) {
    if (trim((string) pm_Settings::get($key, '')) === $legacyDefault) pm_Settings::set($key, 'auto');
}

try {
    $selfCheck = pm_ApiCli::callSbin('kitsuneserv-bridge-r17', ['--self-check'], pm_ApiCli::RESULT_FULL);
} catch (Throwable $exception) {
    throw new RuntimeException('Nie udało się uruchomić uprzywilejowanego executora KitsuneServ Bridge r17 przez Plesk.', 0, $exception);
}
if ((int) ($selfCheck['code'] ?? 1) !== 0 || trim((string) ($selfCheck['stdout'] ?? '')) !== '3.1.1-r17') {
    throw new RuntimeException('Executor KitsuneServ Bridge r17 nie przeszedł kontroli wersji przez Plesk.');
}

$config = Modules_KitsuneservBridge_Config::values();
if (($config['deployment_mode'] ?? 'managed') === 'managed' && ($config['proxy_mode'] ?? 'manual') === 'managed' && Modules_KitsuneservBridge_Config::proxyDomains($config)) {
    $runtimeConfig = null;
    try {
        $runtimeConfig = Modules_KitsuneservBridge_Config::createRuntimeConfig('proxy');
        $proxyResult = pm_ApiCli::callSbin('kitsuneserv-bridge-r17', ['--config', $runtimeConfig], pm_ApiCli::RESULT_FULL);
        if ((int) ($proxyResult['code'] ?? 1) !== 0) throw new RuntimeException(trim((string) ($proxyResult['stderr'] ?? $proxyResult['stdout'] ?? '')));
    } catch (Throwable $exception) {
        /* Instalacja ma pozostać możliwa; widok i dziennik operacji pokażą problem do ręcznego rozwiązania. */
    } finally {
        if ($runtimeConfig !== null && is_file($runtimeConfig)) @unlink($runtimeConfig);
    }
}
