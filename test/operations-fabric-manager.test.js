'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const OperationsFabricManager = require('../src/operations-fabric-manager');
const ResilienceManager = require('../src/resilience-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-fabric-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const values = new Map(); const secrets = { get: key => values.get(key) || '', set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
  const session = { id: 's1', name: 'Production', host: 'prod.test', port: 22, type: 'ssh', production: true, remotePath: '/srv/app' }; const remoteFiles = new Map([['/srv/app/config.txt', 'original']]);
  const remote = { list: () => [session], resolve: () => session, diagnose: async () => ({ success: true }), readRemote: async (_profile, target) => { if (!remoteFiles.has(target)) throw new Error('missing'); const content = remoteFiles.get(target); return { content, size: Buffer.byteLength(content) }; }, writeRemote: async (_profile, target, content) => { remoteFiles.set(target, content); return { success: true }; } };
  const executions = []; const ops = { listRunbooks: () => [{ id: 'r1', name: 'Recover', steps: [{ command: 'true' }] }], exec: async (_session, command) => { executions.push(command); return { success: !command.includes('fail-me'), code: command.includes('fail-me') ? 1 : 0, stdout: command.includes("printf 'PORT") ? 'PORT\tLISTEN 0 128 0.0.0.0:443 users:(("nginx"))|\nSERVICE\tnginx.service loaded active running nginx|\nCONTAINER\tabcd\tweb\timage\t0.0.0.0:443->443/tcp|\n' : '', stderr: '' }; } };
  const advanced = { safeCommand: kind => ({ command: kind === 'fail' ? 'fail-me' : `safe-${kind}`, destructive: false }), evaluateHealthContract: async () => ({ success: true }) };
  const incidents = { start: async input => ({ incident: { id: 'incident', ...input } }), update: () => ({ success: true }) };
  const cloud = { list: () => [], read: async () => { throw new Error('missing'); }, write: async () => ({ success: true }) };
  const resilience = new ResilienceManager(root, secrets, remote, ops);
  const db = { listObjectsFor: async () => ({ schemas: [{ name: 'public', objects: [{ name: 'users', type: 'table' }] }] }), describeObjectFor: async () => ({ schema: 'public', name: 'users', type: 'table', columns: [{ name: 'email' }] }), tableDataFor: async () => ({ rows: [{ email: 'alice@example.test', password: 'plain' }] }) };
  const manager = new OperationsFabricManager(root, secrets, remote, ops, advanced, incidents, resilience, cloud, db);
  return { root, values, session, remoteFiles, executions, resilience, manager };
}

test('Zero-Trust policies produce signed, scoped, expiring and one-use grants', t => {
  const { manager, session } = fixture(t);
  manager.savePolicy({ name: 'Production', actions: ['connect'], sessionIds: [session.id], minimumApprovals: 1, requireMfa: true, conditions: [{ field: 'production', operator: 'eq', value: true }] });
  assert.equal(manager.requestAccess({ action: 'connect', sessionId: session.id, production: true, approvals: 0, mfaVerified: true }).success, false);
  const issued = manager.requestAccess({ action: 'connect', sessionId: session.id, production: true, approvals: 1, mfaVerified: true, scopes: ['connect'] });
  assert.equal(manager.consumeAccess(issued.token, 'connect').success, true);
  assert.throws(() => manager.consumeAccess(issued.token, 'connect'), /already used|expired/i);
  const tampered = `${issued.token.slice(0, -1)}x`; assert.throws(() => manager.consumeAccess(tampered, 'connect'), /signature/i);
});

test('multi-person access requests require distinct approvers before issuing a token', t => {
  const { manager, session } = fixture(t); manager.savePolicy({ name: 'Four eyes', actions: ['deploy'], sessionIds: [session.id], minimumApprovals: 2, requireMfa: true });
  const request = manager.beginAccessRequest({ subject: 'operator', action: 'deploy', scopes: ['deploy'], sessionId: session.id }).request;
  const first = manager.approveAccessRequest(request.id, 'alice', true); assert.equal(first.issued, false);
  const duplicate = manager.approveAccessRequest(request.id, 'alice', true); assert.equal(duplicate.issued, false); assert.equal(duplicate.request.approvals.length, 1);
  const second = manager.approveAccessRequest(request.id, 'bob', true); assert.equal(second.issued, true); assert.match(second.token, /\./);
});

test('Secrets Broker never persists material and consumes a lease once', t => {
  const { manager, root } = fixture(t); const lease = manager.createSecretLease({ reference: 'TOKEN', value: 'never-persist-me', scopes: ['remote-env'] }).lease;
  assert.equal(fs.readFileSync(path.join(root, 'operations-fabric', 'state.json'), 'utf8').includes('never-persist-me'), false);
  assert.equal(manager.consumeSecretLease(lease.id, 'remote-env', value => value.length), 16);
  assert.throws(() => manager.consumeSecretLease(lease.id, 'remote-env', value => value), /invalid or expired/i);
});

test('live service map, GitOps export and fleet canary are bounded', async t => {
  const { manager, root, session } = fixture(t); const map = await manager.serviceMap(session);
  assert.equal(map.nodes.some(item => item.kind === 'container'), true); assert.equal(map.edges.some(item => item.kind === 'publishes'), true);
  const target = path.join(root, 'iac', 'main.tf'); const exported = manager.gitOpsExport({ fingerprint: 'abc', output: '===PACKAGES===\nnginx 1\n===SERVICES===\nnginx.service enabled\n===PORTS===\n443' }, 'opentofu', target);
  assert.equal(exported.success, true); assert.match(fs.readFileSync(target, 'utf8'), /source_fingerprint/);
  const fleet = await manager.fleetRun([session.id], 'disk', {}, { canarySessionId: session.id, batchSize: 1 }); assert.equal(fleet.success, true); assert.equal(fleet.command.destructive, false);
});

test('offline workspace detects remote divergence before synchronization', async t => {
  const { manager, remoteFiles, session } = fixture(t); const originalHash = crypto.createHash('sha256').update('original').digest('hex'); const mount = manager.saveOfflineMount({ provider: 'remote', profileId: session.id, remoteRoot: '/srv/app' }).mount;
  manager.stageOfflineChange(mount.id, 'config.txt', 'offline edit', originalHash); remoteFiles.set('/srv/app/config.txt', 'remote edit');
  const conflicted = await manager.reconcileOfflineMount(mount.id); assert.equal(conflicted.success, false); assert.equal(conflicted.conflicts.length, 1); assert.equal(remoteFiles.get('/srv/app/config.txt'), 'remote edit');
});

test('database studio creates diffs, ERD edges and deterministic masking', t => {
  const { manager } = fixture(t); const left = { objects: [{ schema: 'public', name: 'users', columns: [{ name: 'id' }] }] }; const right = { objects: [{ schema: 'public', name: 'accounts', columns: [] }] };
  const diff = manager.databaseSchemaDiff(left, right); assert.equal(diff.destructiveChanges, 1); assert.match(diff.migrationSql, /DESTRUCTIVE/);
  const erd = manager.databaseErd({ objects: [{ schema: 'public', name: 'orders', columns: [{ name: 'user_id', foreignTable: 'users' }] }] }); assert.equal(erd.edges[0].to, 'public.users');
  const masked = manager.maskRows([{ name: 'Alice', email: 'alice@example.test', password: 'plain' }]); assert.notEqual(masked[0].name, 'Alice'); assert.equal(masked[0].password, '[REDACTED]'); assert.match(masked[0].email, /masked\.invalid/);
});

test('Database Studio captures live metadata and exports masked clone data', async t => {
  const { manager, root } = fixture(t); const schema = await manager.captureDatabaseSchema({}, 'app'); assert.equal(schema.objects[0].name, 'users');
  const target = path.join(root, 'masked.json'); const exported = await manager.exportMaskedDatabase({}, 'app', target, 100); assert.equal(exported.masked, true); const payload = fs.readFileSync(target, 'utf8'); assert.equal(payload.includes('alice@example.test'), false); assert.equal(payload.includes('plain'), false);
});

test('scheduled synthetic checks advance their due time', async t => {
  const { manager, session } = fixture(t); const saved = manager.saveSynthetic({ name: 'SSH', kind: 'ssh', sessionId: session.id, intervalMinutes: 5, nextRunAt: new Date(0).toISOString() });
  const due = await manager.runDueSynthetics(); assert.equal(due.results.length, 1); assert.equal(due.results[0].result.success, true); assert.ok(new Date(manager._state().syntheticScenarios.find(item => item.id === saved.scenario.id).nextRunAt) > new Date());
});

test('DR simulation restores and hashes a deduplicated backup in isolation', t => {
  const { manager, resilience, root } = fixture(t); const source = path.join(root, 'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'data.txt'), 'recoverable'); const backup = resilience.deduplicatedBackup(source, 'dr');
  const simulation = manager.simulateDisaster(backup.manifest.id); assert.equal(simulation.success, true); assert.equal(simulation.isolated, true); assert.equal(simulation.destroyedAfterTest, true);
});

test('canary rolls back on thresholds and ephemeral environments expire safely', async t => {
  const { manager, root, session } = fixture(t); assert.throws(() => manager.saveCanary({ sessionId: session.id, stages: [1, 100], trafficCommandTemplate: 'route {{percent}}' }), /rollback command/i); const canary = manager.saveCanary({ sessionId: session.id, stages: [1, 10, 100], maximumErrorRate: 0.05, maximumLatencyMs: 1000 }).canary;
  const rollback = await manager.advanceCanary(canary.id, { errorRate: 0.2, latencyMs: 500 }); assert.equal(rollback.rollback, true); assert.equal(rollback.canary.currentStage, 0);
  assert.throws(() => manager.saveEphemeral({ source: 'https://user:password@example.test/repo.git' }), /credential-free/i);
  const environment = manager.saveEphemeral({ source: root, ttlMinutes: 10 }).environment; const cleaned = manager.cleanupEphemeral(new Date(Date.now() + 11 * 60000)); assert.deepEqual(cleaned.removed, [environment.id]); assert.equal(fs.existsSync(environment.directory), false);
});

test('Evidence Vault detects payload tampering and Replay Lab requires valid capsules', t => {
  const { manager, root } = fixture(t); const sealed = manager.sealEvidence({ kind: 'test', value: 42 }); assert.equal(manager.verifyEvidence(sealed.record.id).success, true);
  const evidenceFile = path.join(root, 'operations-fabric', 'evidence', `${sealed.record.id}.json`); const tampered = JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); tampered.payload.value = 43; fs.writeFileSync(evidenceFile, JSON.stringify(tampered)); assert.equal(manager.verifyEvidence(sealed.record.id).success, false);
  const incident = { id: 'i1', title: 'Outage', timeline: [{ type: 'note', message: 'Observed' }], evidence: [] }; const capsule = { incident, integrity: crypto.createHash('sha256').update(JSON.stringify(incident)).digest('hex') }; const capsuleFile = path.join(root, 'capsule.json'); fs.writeFileSync(capsuleFile, JSON.stringify(capsule)); const lab = manager.createReplayLab(capsuleFile).lab; assert.equal(manager.simulateReplay(lab.id, { command: 'rm -rf /', target: 'production' }).success, false);
});

test('Local Copilot remains deterministic and never executes commands', t => {
  const { manager } = fixture(t); const result = manager.localCopilot({ logs: 'ENOSPC no space left on device' }); assert.equal(result.localOnly, true); assert.equal(result.executedCommands, false); assert.match(result.hypotheses[0].cause, /Filesystem/i);
});
