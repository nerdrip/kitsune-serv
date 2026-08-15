'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdvancedOpsManager = require('../src/advanced-ops-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-advanced-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { id: 'server-1', name: 'Production', host: 'prod.test', port: 22, type: 'ssh', production: true, remotePath: '/srv/app' };
  const files = new Map([['/srv/app/config.txt', 'hello token=super-secret-value']]);
  const remote = { list: () => [session], listTunnels: () => [], resolve: () => session, readRemote: async (_session, target) => ({ content: files.get(target), size: Buffer.byteLength(files.get(target)) }), writeRemote: async (_session, target, content) => { files.set(target, content); return { success: true }; }, diagnose: async () => ({ success: true, diagnostics: { ssh: { durationMs: 4 }, dns: { durationMs: 2 } } }) };
  const ops = { exec: async (_session, command) => command.includes('grep -RIl') ? { success: true, stdout: '/srv/app/config.txt\n' } : { success: true, stdout: 'disk=999999\nwritable=yes\ngit=0\ndocker=yes\nmemory=999999\n' } };
  return { manager: new AdvancedOpsManager(root, remote, ops, {}, { list: () => [] }), root, files, session };
}

test('secret scan, graph and deterministic anomaly baseline work', t => {
  const { manager, session } = fixture(t);
  assert.equal(manager.graph().nodes.some(item => item.id === 'server:server-1'), true);
  assert.equal(manager.secretScan('password=extremely-secret').success, false);
  for (const load of [1, 1, 1, 1, 1, 20]) manager.recordMetric(session.id, { load: [load], memory: { used: 1, total: 2 }, disk: { percent: '10%' }, containers: 2 });
  assert.equal(manager.anomalyBaseline(session.id).metrics.load.anomalous, true);
});

test('global replace snapshots originals and can roll back', async t => {
  const { manager, files, session } = fixture(t);
  const preview = await manager.replacePreview('hello', 'goodbye', { content: true, root: '/srv/app', sessionIds: [session.id] });
  const applied = await manager.replaceApply(preview, [`${session.id}:/srv/app/config.txt`]);
  assert.equal(files.get('/srv/app/config.txt').startsWith('goodbye'), true);
  assert.ok(applied.rollbackId);
  await manager.replaceRollback(applied.rollbackId);
  assert.equal(files.get('/srv/app/config.txt').startsWith('hello'), true);
});

test('maintenance gates, preflight and path validation are enforced', async t => {
  const { manager, session } = fixture(t);
  assert.equal((await manager.preflight(session, { target: '/srv/app' })).success, true);
  assert.throws(() => manager.safeCommand('tail', { path: '/srv/../etc/passwd' }), /safe absolute/i);
  manager.saveMaintenanceWindow({ sessionId: session.id, startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T01:00:00Z', operations: ['deploy'] });
  assert.equal(manager.maintenanceAllowed(session.id, 'deploy', new Date('2030-01-01T00:30:00Z')).allowed, true);
  assert.equal(manager.maintenanceAllowed(session.id, 'deploy', new Date('2030-01-02T00:00:00Z')).allowed, false);
});
