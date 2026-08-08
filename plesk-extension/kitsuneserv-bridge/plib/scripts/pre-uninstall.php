<?php

pm_Context::init('kitsuneserv-bridge');
try { (new pm_LongTask_Manager())->cancelAllTasks(); } catch (Throwable $exception) {}
foreach (glob(pm_Context::getVarDir() . '/operation-*.json') ?: [] as $path) @unlink($path);

// Celowo pozostawiamy kod, dane i usługę systemd. Usunięcie rozszerzenia nie może
// nieodwracalnie usuwać wdrożenia użytkownika bez osobnej, jawnej operacji.
