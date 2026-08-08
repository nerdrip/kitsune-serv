<?php

pm_Context::init('kitsuneserv-bridge');
require_once dirname(__DIR__) . '/library/Config.php';

$varDir = pm_Context::getVarDir();
if (!is_dir($varDir)) mkdir($varDir, 0700, true);
@chmod($varDir, 0700);

foreach (Modules_KitsuneservBridge_Config::defaults() as $key => $value) {
    if (pm_Settings::get($key) === null) pm_Settings::set($key, (string) $value);
}

$productRoot = defined('PRODUCT_ROOT_D') ? PRODUCT_ROOT_D : '/usr/local/psa';
$utility = $productRoot . '/admin/bin/modules/kitsuneserv-bridge/kitsuneserv-bridge';
if (is_file($utility)) @chmod($utility, 0750);
