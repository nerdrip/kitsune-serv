<?php

pm_Context::init('kitsuneserv-bridge');
require_once dirname(__DIR__) . '/library/Config.php';

$varDir = pm_Context::getVarDir();
if (!is_dir($varDir)) mkdir($varDir, 0700, true);
@chmod($varDir, 0700);

foreach (Modules_KitsuneservBridge_Config::defaults() as $key => $value) {
    if (pm_Settings::get($key) === null) pm_Settings::set($key, (string) $value);
}
foreach (['node_binary' => '/usr/bin/node', 'npm_binary' => '/usr/bin/npm'] as $key => $legacyDefault) {
    if (trim((string) pm_Settings::get($key, '')) === $legacyDefault) pm_Settings::set($key, 'auto');
}

try {
    $selfCheck = pm_ApiCli::callSbin('kitsuneserv-bridge-r12', ['--self-check'], pm_ApiCli::RESULT_FULL);
} catch (Throwable $exception) {
    throw new RuntimeException('Nie udało się uruchomić uprzywilejowanego executora KitsuneServ Bridge r12 przez Plesk.', 0, $exception);
}
if ((int) ($selfCheck['code'] ?? 1) !== 0 || trim((string) ($selfCheck['stdout'] ?? '')) !== '3.1.0-r12') {
    throw new RuntimeException('Executor KitsuneServ Bridge r12 nie przeszedł kontroli wersji przez Plesk.');
}
