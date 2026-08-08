<?php
pm_Context::init('kitsuneserv-bridge');
if (pm_Settings::get('auth_mode', '') === '') pm_Settings::set('auth_mode', 'hybrid');
if (pm_Settings::get('auto_provision', '') === '') pm_Settings::set('auto_provision', '1');
