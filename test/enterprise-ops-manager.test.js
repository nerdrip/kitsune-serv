'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const SecretStore = require('../src/secret-store');
const EnterpriseOpsManager = require('../src/enterprise-ops-manager');
const { KitsuneAgent, canonicalSignature } = require('../src/kitsune-agent');

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-enterprise-')); }
function dependencies(root, sessions = []) {
  const secretStore = new SecretStore(root, { externalKey: 'enterprise-test-key' });
  const remote = { list: () => sessions };
  const ops = { exec: async (_session, command) => ({ success: true, code: 0, stdout: command.includes('command -v apt-get') ? 'apt\n' : 'root=no\npassword=no\nfirewall=active\nupdates=enabled\n', stderr: '', command }) };
  const advanced = { digitalTwin: (_capture, operation) => ({ success: true, simulated: true, operation, warnings: [] }) };
  const db = { executeWorkbench: async (_connection, database, sql, options) => ({ database, sql, options, rows: [] }) };
  return { secretStore, remote, ops, advanced, db, manager: new EnterpriseOpsManager(root, { secretStore, remoteAccess: remote, remoteOperations: ops, advanced, dbViewer: db }) };
}

test('Kitsune Agent accepts signed calls and rejects replayed nonces', async t => {
  const root = workspace(); const token = 'agent-test-token-with-at-least-24-characters'; const agent = new KitsuneAgent({ token, host: '127.0.0.1', port: 0, allowedRoots: [root] });
  await agent.start(); t.after(async () => { await agent.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${agent.address().port}`; const deps = dependencies(root); deps.manager.enrollAgent({ id: 'node-1', name: 'Node 1', endpoint, token });
  const health = await deps.manager.probeAgent('node-1'); assert.equal(health.ok, true); assert.equal(health.version, 1);
  const timestamp = String(Date.now()); const nonce = crypto.randomBytes(18).toString('base64url'); const pathname = '/v1/health'; const signature = canonicalSignature(token, timestamp, nonce, 'GET', pathname, '');
  const call = () => new Promise(resolve => { const request = http.request(`${endpoint}${pathname}`, { headers: { 'x-kitsune-timestamp': timestamp, 'x-kitsune-nonce': nonce, 'x-kitsune-signature': signature } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) })); }); request.end(); });
  assert.equal((await call()).status, 200); const replay = await call(); assert.equal(replay.status, 401); assert.match(replay.body.error, /replay/i);
});

test('SLO error budgets freeze deployments and capacity forecast predicts exhaustion', t => {
  const root = workspace(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const { manager } = dependencies(root);
  const saved = manager.saveSlo({ name: 'API', service: 'api', target: 0.99, latencyMs: 100, windowDays: 30 });
  for (let index = 0; index < 100; index++) manager.recordSlo(saved.slo.id, { success: index < 95, latencyMs: 50 });
  const evaluation = manager.evaluateSlos()[0]; assert.equal(evaluation.exhausted, true); assert.equal(evaluation.deploymentFreeze, true);
  const now = Date.now(); manager.recordCapacity('disk', 50, new Date(now - 2 * 86400000).toISOString()); manager.recordCapacity('disk', 60, new Date(now - 86400000).toISOString()); const forecast = manager.recordCapacity('disk', 70, new Date(now).toISOString()); assert.equal(forecast.ready, true); assert.ok(forecast.dailySlope > 9); assert.ok(forecast.projectedExhaustion);
});

test('patch plans preview fixed commands and reboot plans separate quorum peers', async t => {
  const root = workspace(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const sessions = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }]; const { manager } = dependencies(root, sessions);
  const patch = manager.savePatchPlan({ sessionIds: ['a', 'b'], canarySessionId: 'a', batchSize: 1 }); const preview = await manager.runPatchPlan(patch.plan.id, { preview: true }); assert.equal(preview.success, true); assert.match(preview.results[0].preview, /apt-get/);
  const reboot = manager.planReboots({ targets: [{ sessionId: 'a', quorumGroup: 'db' }, { sessionId: 'b', quorumGroup: 'db' }, { sessionId: 'c', quorumGroup: 'web' }] }); assert.equal(reboot.plan.batches.length, 2); assert.equal(reboot.plan.batches[0].filter(item => item.group === 'db').length, 1); assert.equal(reboot.plan.batches[1].filter(item => item.group === 'db').length, 1);
});

test('supply-chain promotion is sequential and chaos refuses production', t => {
  const root = workspace(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const { manager } = dependencies(root, [{ id: 'prod', name: 'Prod', production: true }]); const digest = `sha256:${'a'.repeat(64)}`;
  assert.throws(() => manager.promoteImage({ image: 'app', digest, stage: 'staging' }), /every environment/i);
  for (const stage of ['development', 'staging', 'canary']) assert.equal(manager.promoteImage({ image: 'app', digest, stage }).success, true);
  assert.throws(() => manager.promoteImage({ image: 'app', digest, stage: 'production' }), /approver/i); assert.equal(manager.promoteImage({ image: 'app', digest, stage: 'production', approvedBy: 'owner' }).success, true);
  assert.throws(() => manager.saveChaosExperiment({ environment: 'production', sessionId: 'prod', action: 'latency', target: 'eth0' }), /cannot target production/i);
});

test('air-gap backup deduplicates and verifies immutable objects', t => {
  const root = workspace(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const { manager } = dependencies(root); const source = path.join(root, 'source'); const target = path.join(root, 'offline'); fs.mkdirSync(path.join(source, 'nested'), { recursive: true }); fs.writeFileSync(path.join(source, 'one.txt'), 'same'); fs.writeFileSync(path.join(source, 'nested', 'two.txt'), 'same');
  const created = manager.createAirgapBackup({ source, destination: target, retentionDays: 90 }); assert.equal(created.backup.files, 2); assert.equal(created.deduplicatedObjects, 1); assert.equal(manager.verifyAirgap(created.backup.id).success, true);
});

test('migration rehearsal requires a disposable database and marketplace rejects code', async t => {
  const root = workspace(); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const { manager } = dependencies(root);
  await assert.rejects(manager.rehearseMigration({ id: 'db' }, 'production', 'ALTER TABLE x ADD y int'), /disposable database/i);
  const result = await manager.rehearseMigration({ id: 'db' }, 'app_rehearsal', 'ALTER TABLE x ADD y int'); assert.equal(result.productionTouched, false); assert.equal(result.result.options.transaction, true);
  assert.throws(() => manager.installMarketplacePack({ payload: { schemaVersion: 1, name: 'Bad', resources: [{ kind: 'javascript' }] }, signature: 'x', trustedKey: 'publisher-key-that-is-long-enough' }), /executable plugin code/i);
});
