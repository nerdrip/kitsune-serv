<?php

class Modules_ExampleManager_CustomButtons extends pm_Hook_CustomButtons
{
    public function getButtons()
    {
        if ($this->hubOwnsNavigation()) return [];
        return [[
            'place' => [self::PLACE_ADMIN_NAVIGATION, self::PLACE_HOSTING_PANEL_NAVIGATION],
            'section' => self::SECTION_NAV_SERVER_MANAGEMENT,
            'order' => 55,
            'title' => 'Example Product Manager',
            'description' => 'Deploy and configure Example Product',
            'link' => pm_Context::getActionUrl('index', 'index'),
        ]];
    }

    private function hubOwnsNavigation()
    {
        try { return pm_Extension::getById('kitsuneserv-bridge')->isActive(); }
        catch (Throwable $exception) { return false; }
    }
}
