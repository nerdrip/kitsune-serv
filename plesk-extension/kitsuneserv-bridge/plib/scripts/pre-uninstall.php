<?php

pm_Context::init('kitsuneserv-bridge');
require_once dirname(__DIR__) . '/library/Config.php';
try { (new pm_LongTask_Manager())->cancelAllTasks(); } catch (Throwable $exception) {}
foreach (glob(pm_Context::getVarDir() . '/operation-*.json') ?: [] as $path) @unlink($path);

$proxyDomains = Modules_KitsuneservBridge_Config::proxyDomains();
pm_Settings::set('proxy_mode', 'manual');
foreach ($proxyDomains as $domainName) {
    try { (new pm_WebServer())->updateDomainConfiguration(pm_Domain::getByName($domainName)); }
    catch (Throwable $exception) {}
}

// Celowo pozostawiamy kod, dane i usługę systemd. Usunięcie rozszerzenia nie może
// nieodwracalnie usuwać wdrożenia użytkownika bez osobnej, jawnej operacji.
