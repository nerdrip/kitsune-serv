'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ObservabilityManager = require('../src/observability-manager');
const AutomationManager = require('../src/automation-manager');

function root(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-observability-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('observability records service resources, threshold alerts and Prometheus metrics', async t => {
  const directory = root(t);
  const manager = new ObservabilityManager(directory, {
    getAllStatuses: () => ({ node: { running: true, pid: 123, uptime: 120000 }, mysql: { running: false } })
  }, { resourceCollector: async () => ({ 123: { memoryMB: 1536, cpuPercent: 12.5 } }) });
  manager.saveRule({ service: 'node', metric: 'memoryMB', operator: '>', threshold: 1024, severity: 'warning' });
  const sample = await manager.collect();
  assert.equal(sample.services.node.memoryMB, 1536);
  assert.equal(sample.services.node.uptimeSeconds, 120);
  assert.equal(manager.activeAlerts().length, 1);
  manager.recordServiceExit('node', 2);
  assert.equal(manager.activeAlerts().some(alert => alert.severity === 'error'), true);
  assert.match(manager.prometheus(), /kitsuneserv_service_memory_bytes\{service="node"\} 1610612736/);
  manager.stop();
  const restored = new ObservabilityManager(directory, { getAllStatuses: () => ({}) }, { resourceCollector: async () => ({}) });
  assert.equal(restored.history().length, 1);
  assert.equal(restored.alertsList().length, 2);
});

test('automation scheduler executes only supported named actions and keeps history', async t => {
  const directory = root(t);
  const calls = [];
  const manager = new AutomationManager(directory, {
    serviceManager: {
      startService: async target => { calls.push(`start:${target}`); return { success: true }; },
      stopService: async target => { calls.push(`stop:${target}`); return { success: true }; }
    },
    projectManager: { start: async () => ({ success: true }), stop: async () => ({ success: true }) },
    commandManager: { runAndWait: async (target, command) => { calls.push(`command:${target}:${command}`); return { success: true }; } },
    labManager: { start: async () => ({ success: true }), stop: async () => ({ success: true }), provision: async () => ({ success: true }) },
    backupManager: { runDue: async () => ({ success: true }) }, diagnosticsManager: { doctor: async () => ({ healthy: true }) }
  });
  const service = manager.save({ name: 'Start DB', action: 'service-start', target: 'mysql', intervalMinutes: 5, nextRunAt: new Date(Date.now() - 1000).toISOString() });
  const command = manager.save({ name: 'Test API', action: 'project-command', target: 'api', commandName: 'test', intervalMinutes: 10 });
  const due = await manager.runDue();
  assert.equal(due.success, true);
  assert.deepEqual(calls, ['start:mysql']);
  assert.equal((await manager.run(command.id, { manual: true })).success, true);
  assert.deepEqual(calls, ['start:mysql', 'command:api:test']);
  assert.equal(manager.history().length, 2);
  assert.equal(manager.list().find(item => item.id === service.id).lastSuccessAt != null, true);
  assert.throws(() => manager.save({ name: 'Unsafe', action: 'shell', target: 'rm' }), /unsupported/i);
});
