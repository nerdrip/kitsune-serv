<?php
require_once 'pm/bootstrap.php';
pm_Context::init('kitsuneserv-bridge');
$application = new pm_Application();
$application->run();
