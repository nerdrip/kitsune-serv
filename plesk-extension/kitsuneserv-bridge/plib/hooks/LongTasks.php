<?php

class Modules_KitsuneservBridge_LongTasks extends pm_Hook_LongTasks
{
    public function getLongTasks()
    {
        return [new Modules_KitsuneservBridge_Task_Operate()];
    }
}
