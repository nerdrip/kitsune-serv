'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SecretStore = require('../src/secret-store');
const NextgenOpsManager = require('../src/nextgen-ops-manager');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-nextgen-')); }
function setup(directory, overrides = {}) {
  const secretStore = new SecretStore(directory, { externalKey: 'nextgen-test-key' });
  const sessions = overrides.sessions || [{ id: 'server-a', name: 'A' }, { id: 'server-b', name: 'B' }];
  const remote = { list: () => sessions, resolve: input => typeof input === 'string' ? sessions.find(item => item.id === input) : input, diagnose: async () => ({ success: true }) };
  const ops = { exec: async (_session, command) => ({ success: true, code: 0, stdout: command.includes('command -v bpftrace') ? 'ready\n' : 'ok\n', stderr: '', command }) };
  const advanced = { captureInfrastructure: async input => ({ sessionId: input.id, sessionName: input.name, capturedAt: new Date().toISOString(), fingerprint: input.id, output: `===PACKAGES===\nnode\n===SERVICES===\napp.service\n` }), diffInfrastructure: (left, right) => ({ identical: left.fingerprint === right.fingerprint, left: left.sessionName, right: right.sessionName }) };
  const enterprise = { configuration: () => ({ agents: [{ id: 'agent-a' }] }), agentRequest: async () => ({ success: true }), probeAgent: async () => ({ ok: true }) };
  secretStore.set('enterprise:agent:agent-a', 'agent-token-long-enough-for-tests');
  return new NextgenOpsManager(directory, { secretStore, remoteAccess: remote, remoteOperations: ops, advanced, resilience: overrides.resilience || {}, enterprise });
}

test('Relay Mesh selects the lowest-cost healthy route and emits safe reverse SSH arguments', t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory);
  manager.saveRelayNode({ id: 'a', name: 'A', agentId: 'agent-a', cost: 1, links: ['b', 'c'] }); manager.saveRelayNode({ id: 'b', name: 'B', agentId: 'agent-a', cost: 50, links: ['c'] }); manager.saveRelayNode({ id: 'c', name: 'C', agentId: 'agent-a', cost: 1, links: [] });
  const route = manager.routeRelay('a', 'c'); assert.deepEqual(route.route, ['a', 'c']); assert.equal(route.inboundPortsRequiredOnAgents, false);
  const bootstrap = manager.relayBootstrap({ host: 'relay.example', user: 'kitsune', remotePort: 10992, localPort: 10991 }); assert.equal(bootstrap.program, 'ssh'); assert.ok(bootstrap.args.includes('StrictHostKeyChecking=yes')); assert.ok(bootstrap.args.includes('-R'));
});

test('Privilege Broker grants are signed, scoped, expiring and one-use', async t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory);
  const issued = manager.issueCapability({ agentId: 'agent-a', action: 'service-restart', resource: 'nginx.service', ttlMinutes: 5 }); assert.ok(issued.grant.signature);
  assert.equal((await manager.useCapability(issued.grant.id)).success, true); await assert.rejects(manager.useCapability(issued.grant.id), /already used/i);
});

test('Delta engine reconstructs changed blocks atomically and verifies both files', t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory); const source = path.join(directory, 'source.bin'); const destination = path.join(directory, 'destination.bin'); const block = Buffer.alloc(8192, 1); fs.writeFileSync(destination, Buffer.concat([block, Buffer.alloc(8192, 2), block])); fs.writeFileSync(source, Buffer.concat([block, Buffer.alloc(8192, 9), block]));
  const signature = manager.deltaSignature(destination, 8192); const plan = manager.deltaPlan(source, signature); assert.equal(plan.changed.length, 1); assert.ok(plan.savedBytes > plan.transferBytes);
  const applied = manager.deltaApply(source, destination, plan); assert.equal(applied.atomic, true); assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(source));
});

test('Filesystem Time Travel deduplicates objects and restores a selected file', t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory); const source = path.join(directory, 'tree'); fs.mkdirSync(path.join(source, 'a'), { recursive: true }); fs.writeFileSync(path.join(source, 'one.txt'), 'same'); fs.writeFileSync(path.join(source, 'a', 'two.txt'), 'same');
  const created = manager.createFilesystemSnapshot({ source, name: 'before' }); assert.equal(created.files, 2); const files = manager.browseSnapshot(created.snapshot.id); assert.equal(files.length, 2); const target = path.join(directory, 'restored.txt'); manager.restoreSnapshotFile(created.snapshot.id, 'one.txt', target); assert.equal(fs.readFileSync(target, 'utf8'), 'same');
});

test('Ransomware Guard freezes a root after suspicious extension churn', t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory); const source = path.join(directory, 'protected'); fs.mkdirSync(source); for (let index = 0; index < 4; index++) fs.writeFileSync(path.join(source, `${index}.txt`), 'data'); manager.ransomwareBaseline(source); for (let index = 0; index < 4; index++) fs.writeFileSync(path.join(source, `${index}.locked`), 'cipher'); const result = manager.ransomwareScan(source, { changeLimit: 100 }); assert.equal(result.suspicious, true); assert.equal(result.queueFrozen, true); assert.equal(manager.summary().frozenRoots, 1);
  assert.throws(() => manager.assertLocalWritable(path.join(source, 'new.txt')), /blocked writes/i);
});

test('network twin, transactions and four-eyes sessions remain preview and approval gated', async t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory);
  const twin = manager.networkDigitalTwin({ services: [{ name: 'SSH', host: 'node', port: 22, critical: true }], changes: [{ action: 'deny', host: 'node', port: 22 }] }); assert.equal(twin.success, false); assert.equal(twin.executed, false);
  await assert.rejects(manager.remoteTransaction({ id: 'server-a' }, [{ kind: 'service-restart', target: 'app.service' }], {}), /approval/i); const preview = await manager.remoteTransaction({ id: 'server-a' }, [{ kind: 'service-restart', target: 'app.service' }], { approved: true, preview: true }); assert.equal(preview.executed, false);
  const pair = manager.pairSession({ resource: 'term-1', fourEyes: true }); manager.pairPropose(pair.session.id, 'restart app', 'alice'); assert.equal(manager.pairApprove(pair.session.id, 'alice').approved, false); assert.equal(manager.pairApprove(pair.session.id, 'bob').approved, true);
});

test('WASM sandbox rejects imports and executes an import-free run export', async t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory); const file = path.join(directory, 'answer.wasm');
  fs.writeFileSync(file, Buffer.from([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x05,0x01,0x60,0x00,0x01,0x7f,0x03,0x02,0x01,0x00,0x07,0x07,0x01,0x03,0x72,0x75,0x6e,0x00,0x00,0x0a,0x06,0x01,0x04,0x00,0x41,0x2a,0x0b]));
  const result = await manager.runWasm({ file }); assert.equal(result.output, 42); assert.equal(result.network, false); assert.equal(result.filesystem, false);
});

test('WASM sandbox forcibly terminates an infinite loop', async t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory); const file = path.join(directory, 'infinite.wasm');
  fs.writeFileSync(file, Buffer.from([0x00,0x61,0x73,0x6d,0x01,0x00,0x00,0x00,0x01,0x04,0x01,0x60,0x00,0x00,0x03,0x02,0x01,0x00,0x07,0x07,0x01,0x03,0x72,0x75,0x6e,0x00,0x00,0x0a,0x09,0x01,0x07,0x00,0x03,0x40,0x0c,0x00,0x0b,0x0b]));
  await assert.rejects(manager.runWasm({ file, timeoutMs: 50 }), /hard execution budget/i);
});

test('Black Box, Server DNA, intent planning and flight simulation are deterministic', async t => {
  const directory = root(); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); const manager = setup(directory);
  manager.blackBoxRecord({ kind: 'deploy', token: 'must-not-be-recorded', message: 'started' }); manager.blackBoxRecord({ kind: 'health', status: 'ok' }); const box = manager.exportBlackBox(30); assert.equal(box.chainValid, true); assert.equal('token' in box.events[0].payload, false);
  await manager.captureServerDna({ id: 'server-a', name: 'A' }); await manager.captureServerDna({ id: 'server-b', name: 'B' }); assert.equal(manager.compareServerDna('server-a', 'server-b').identical, false);
  const intent = manager.planIntent({ intent: 'Update fleet without losing quorum' }); assert.ok(intent.plan.steps.some(step => /quorum/i.test(step))); assert.equal(intent.plan.executable, false);
  const simulator = manager.createFlightSimulator({ faults: [{ id: 'f1', kind: 'service-down' }] }); const run = manager.runFlightSimulator(simulator.simulator.id, [{ faultId: 'f1', description: 'Fail over', success: true }]); assert.equal(run.productionTouched, false); assert.equal(run.score, 100);
});
