<?php

class Modules_KitsuneservBridge_CustomButtons extends pm_Hook_CustomButtons
{
    public function getButtons()
    {
        return [[
            'place' => [self::PLACE_ADMIN_NAVIGATION, self::PLACE_RESELLER_NAVIGATION, self::PLACE_HOSTING_PANEL_NAVIGATION],
            'section' => self::SECTION_NAV_SERVER_MANAGEMENT,
            'order' => 58,
            'title' => 'Kitsune Hub',
            'description' => 'Projects, Test Labs, API Flow and server synchronization',
            'icon' => pm_Context::getBaseUrl() . 'images/kitsune-hub-menu.svg',
            'link' => pm_Context::getActionUrl('index', 'index'),
        ], [
            'place' => self::PLACE_ADMIN_TOOLS_AND_SETTINGS,
            'section' => self::SECTION_ADMIN_TOOLS_SERVER_MANAGEMENT,
            'title' => 'Kitsune Hub',
            'description' => 'Configure the Kitsune Hub connection and pair this Plesk server',
            'icon' => pm_Context::getBaseUrl() . 'images/kitsune-hub-menu.svg',
            'link' => pm_Context::getActionUrl('index', 'index'),
        ], [
            'place' => self::PLACE_RESELLER_TOOLS_AND_SETTINGS,
            'section' => self::SECTION_RESELLER_TOOLS_ADDITIONAL_SERVICES,
            'title' => 'Kitsune Hub',
            'description' => 'Open Kitsune Hub using your Plesk identity',
            'icon' => pm_Context::getBaseUrl() . 'images/kitsune-hub-menu.svg',
            'link' => pm_Context::getActionUrl('index', 'index'),
        ], [
            'place' => [self::PLACE_ADMIN_HOME, self::PLACE_RESELLER_HOME, self::PLACE_CUSTOMER_HOME],
            'title' => 'Open Kitsune Hub',
            'description' => 'Sign in using the current Plesk account',
            'icon' => pm_Context::getBaseUrl() . 'images/kitsune-hub-menu.svg',
            'link' => pm_Context::getActionUrl('index', 'sso'),
        ]];
    }
}
