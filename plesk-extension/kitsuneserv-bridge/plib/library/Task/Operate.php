<?php

class Modules_KitsuneservBridge_Task_Operate extends pm_LongTask_Task
{
    public $trackProgress = true;

    public function run()
    {
        $runtimeConfig = (string) $this->getParam('runtimeConfig');
        try {
            $this->updateProgress(5);
            $result = pm_ApiCli::callSbin('kitsuneserv-bridge-r11', ['--config', $runtimeConfig], pm_ApiCli::RESULT_FULL);
            $this->updateProgress(100);
            if ((int) ($result['code'] ?? 1) !== 0) {
                $detail = trim((string) ($result['stderr'] ?? $result['stdout'] ?? 'Operation failed.'));
                throw new RuntimeException($detail !== '' ? $detail : 'Operation failed.');
            }
            return (string) ($result['stdout'] ?? 'OK');
        } finally {
            if ($runtimeConfig !== '' && is_file($runtimeConfig)) @unlink($runtimeConfig);
        }
    }
}
