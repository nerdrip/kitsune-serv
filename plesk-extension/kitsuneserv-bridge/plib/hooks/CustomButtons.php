<?php

class Modules_KitsuneservBridge_CustomButtons extends pm_Hook_CustomButtons
{
    public function getButtons()
    {
        return [[
            'place' => [self::PLACE_ADMIN_NAVIGATION, self::PLACE_RESELLER_NAVIGATION],
            'section' => self::SECTION_NAV_SERVER_MANAGEMENT,
            'title' => 'Kitsune Hub',
            'description' => 'Projects, Test Labs, API Flow and server synchronization',
            'icon' => pm_Context::getBaseUrl() . 'images/icon.png',
            'link' => pm_Context::getActionUrl('index', 'index'),
        ], [
            'place' => [self::PLACE_ADMIN_HOME, self::PLACE_RESELLER_HOME, self::PLACE_CUSTOMER_HOME],
            'title' => 'Open Kitsune Hub',
            'description' => 'Sign in using the current Plesk account',
            'icon' => pm_Context::getBaseUrl() . 'images/icon.png',
            'link' => pm_Context::getActionUrl('index', 'sso'),
        ]];
    }
}
