'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OperationsWorkspaceManager = require('../src/operations-workspace-manager');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-ops-workspace-'));
  const sessions = [{ id: 'a', name: 'Alpha', host: 'alpha.example', port: 22, username: 'ops', type: 'ssh', production: true, useAgent: true }, { id: 'b', name: 'Beta', host: 'beta.example', port: 22, username: 'ops', type: 'ssh' }];
  const advanced = {
    dnsInspect: async host => ({ records: { A: [`192.0.2.${host.startsWith('alpha') ? 1 : 2}`] } }),
    safeCommand: (template, parameters) => ({ command: `${template}:${JSON.stringify(parameters)}`, explanation: `Generated from the bounded “${template}” template.`, destructive: false }),
    captureInfrastructure: async session => ({ sessionId: session.id, sessionName: session.name, fingerprint: session.id, output: `===PACKAGES===\nnode-${session.id}\n===SERVICES===\napp.service\n` }),
    diffInfrastructure: (left, right) => ({ identical: left.fingerprint === right.fingerprint, added: [right.fingerprint], removed: [left.fingerprint] }),
    timeMachineRestore: async (snapshotId, session, paths) => ({ success: true, snapshotId, sessionId: session.id, paths }),
    timelineList: () => [{ at: '2026-01-01T00:00:00.000Z', type: 'deploy', status: 'completed', message: 'release' }],
    blastRadius: ({ session, operation }) => ({ session: session.name, operation, risk: session.production ? 'high' : 'low', affected: [{ kind: 'server', id: session.id }] })
  };
  const fabric = {
    fleetRun: async (ids, template, parameters, options) => ({ success: true, ids, template, parameters, options }),
    rescueEnvironment: input => { const target = path.resolve(input.target); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'rescue-manifest.json'), '{}'); return { success: true, target, secretsIncluded: false }; }
  };
  const incidents = { start: async input => ({ success: true, incident: { id: 'incident-1', title: input.title, sessionIds: input.sessionIds || [], status: 'active' } }), collaborationStart: input => ({ success: true, session: { id: 'collab-1', ...input } }) };
  const remote = { list: () => sessions, listTunnels: () => [{ id: 't1', sessionId: 'a' }], diagnose: async () => ({ success: true }) };
  return { root, manager: new OperationsWorkspaceManager(root, { remoteAccess: remote, remoteOperations: {}, advanced, fabric, incidents, nextgen: {}, resilience: {} }) };
}

test('Universal Connection Workspace persists a redacted resumable multi-panel context', t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const saved = manager.saveUniversalWorkspace({ name: 'Production', sessionIds: ['a', 'b'], activeSessionId: 'a', resumeState: { tabs: ['terminal', 'files'], password: 'never-store' } });
  assert.equal(saved.workspace.resumeState.password, undefined); assert.equal(manager.resumeWorkspace(saved.workspace.id).workspace.activeSessionId, 'a'); assert.equal(manager.summary().resumable, 1);
});

test('Command Timeline is integrity chained and undo requires explicit approval', async t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = manager.recordCommandEffect({ sessionId: 'a', command: 'systemctl restart app --token=must-not-persist', effects: [{ service: 'app', password: 'hidden' }], undo: { snapshotId: 'snap-1', paths: ['/etc/app.conf'] } }).event; assert.match(first.command, /<redacted>/); assert.equal(first.effects[0].password, undefined);
  const second = manager.recordCommandEffect({ sessionId: 'a', command: 'systemctl status app', effects: [] }).event; assert.equal(second.previousHash, first.recordHash);
  assert.equal(manager.undoPlan(first.id).requiresApproval, true); await assert.rejects(manager.undoExecute(first.id), /approval/i); assert.equal((await manager.undoExecute(first.id, true)).success, true);
});

test('Connection Doctor and Secretless readiness expose bounded diagnostics without secrets', async t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const doctor = await manager.connectionDoctor('a'); assert.equal(doctor.success, true); assert.ok(doctor.stages.some(item => item.name === 'DNS'));
  const readiness = manager.secretlessReadiness('a'); assert.equal(readiness.passwordRequired, false); assert.equal(readiness.secretsReturned, false);
});

test('Smart Transfer selects delta, parallel and server-to-server strategies', t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(manager.smartTransferPlan({ bytes: 20_000_000, destinationSignature: {}, latencyMs: 40 }).strategy, 'delta');
  assert.equal(manager.smartTransferPlan({ bytes: 500_000_000, bandwidthMbps: 200 }).strategy, 'parallel-resumable');
  assert.equal(manager.smartTransferPlan({ bytes: 1000, sourceRemote: true, destinationRemote: true }).strategy, 'server-to-server');
});

test('Fleet Terminal previews a bounded canary command and refuses unapproved execution', async t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preview = manager.fleetPreview(['a', 'b'], 'disk', {}, { canarySessionId: 'b', batchSize: 1 }); assert.equal(preview.executable, false); assert.equal(preview.canarySessionId, 'b');
  await assert.rejects(manager.fleetExecute(preview), /approval/i); const result = await manager.fleetExecute(preview, true); assert.deepEqual(result.ids, ['a', 'b']); assert.equal(result.options.batchSize, 1);
});

test('Environment diff, collaboration and multiplexer retain governed metadata', async t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const diff = await manager.environmentDiff('a', 'b'); assert.equal(diff.identical, false); assert.equal(diff.secretsIncluded, false);
  const mux = manager.saveMultiplexer({ panes: [{ sessionId: 'a', tmux: 'ops' }, { sessionId: 'b', readOnly: true }], synchronizedInput: true }); assert.equal(mux.multiplexer.requireConfirmation, true);
  const change = manager.collaborativeFileChange({ sessionId: 'a', path: '/etc/app.conf', collaborationId: 'c1', participantId: 'alice', baseHash: 'old', resultHash: 'new' }); assert.equal(change.writeExecuted, false);
});

test('Operational Memory, movie, blast map and policy autocomplete remain local and read-only', t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  manager.recordMemory({ signature: 'SSH connection refused', symptoms: ['port 22 closed'], resolution: 'Start sshd', sessionId: 'a' }); assert.equal(manager.searchMemory('connection refused', 'a')[0].localOnly, true);
  assert.equal(manager.infrastructureMovie('a').playbackOnly, true); assert.equal(manager.liveBlastRadius('a', 'restart').decision, 'approval-required');
  const completion = manager.policyAutocomplete({ query: 'systemctl', forbidden: ['restart'] }); assert.equal(completion.suggestions.length, 1); assert.equal(completion.arbitraryShellSuggested, false);
});

test('Incident room, rescue kits, network replay and intent palette are isolated by default', async t => {
  const { root, manager } = setup(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const room = await manager.createIncidentRoom({ title: 'SSH outage', sessionIds: ['a'] }); assert.equal(room.workspace.resumeState.incidentId, 'incident-1');
  const disposable = manager.createDisposableRescue({ target: path.join(root, 'disposable'), sessionId: 'a', ttlHours: 2 }); assert.equal(disposable.manifest.networkPolicy, 'deny-by-default');
  const portable = manager.createPortableRescueKit({ target: path.join(root, 'portable') }); assert.equal(portable.kit.installRequired, false);
  const replay = manager.createNetworkReplay({ sessionId: 'a', scenarios: [{ kind: 'dns-failure' }, { kind: 'invalid' }] }); const run = manager.runNetworkReplay(replay.replay.id, [{ kind: 'dns-failure' }]); assert.equal(run.productionTouched, false); assert.equal(run.outcomes.length, 1);
  const plan = manager.commandPalettePlan({ intent: 'porównaj dwa serwery', sessionId: 'a' }); assert.equal(plan.plan.action, 'environment-diff'); assert.equal(plan.plan.executable, false);
});
