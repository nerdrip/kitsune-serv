<?php

class Modules_KitsuneservBridge_Permissions extends pm_Hook_Permissions
{
    public function getPermissions()
    {
        return ['use_hub' => ['default' => true, 'place' => self::PLACE_ADDITIONAL, 'name' => 'Use Kitsune Hub', 'description' => 'Allow subscription users to sign in to Kitsune Hub and access synchronized development resources.']];
    }
}
