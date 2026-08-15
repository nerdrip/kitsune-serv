'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { TerminalFileRuntimeManager, CAPABILITIES } = require('../src/terminal-file-runtime-manager');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-runtime-')); const secrets = new Map(); let remoteContent = 'before';
  const secretStore = { get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); }, remove: key => secrets.delete(key) };
  const remoteAccess = {
    list: () => [{ id: 'srv-1', host: 'server.test' }],
    transferResumable: async (_connection, _direction, _local, _remote, progress) => { progress({ transferred: 50, total: 100 }); progress({ transferred: 100, total: 100 }); return { success: true, bytes: 100 }; },
    transferServerToServer: async (_source, _sourcePath, _destination, _destinationPath, progress) => { progress({ transferred: 200, total: 200 }); return { success: true, direct: true, bytes: 200 }; },
    readRemote: async () => ({ content: remoteContent, encoding: 'utf8' }),
    writeRemote: async (_session, _target, content) => { remoteContent = content; return { success: true }; }
  };
  const manager = new TerminalFileRuntimeManager(root, { remoteAccess, secretStore, portableTools: { list: () => [{ id: 'winscp', verified: true }] }, ...overrides });
  return { root, manager, secrets, remoteContent: () => remoteContent };
}

test('Production Runtime exposes ten healthy layers without inflating workflow count', () => {
  const { manager } = fixture(); const summary = manager.summary(); assert.equal(CAPABILITIES.length, 10); assert.equal(summary.total, 10); assert.equal(summary.healthy, 10); assert.equal(summary.journalValid, true);
});

test('connection broker reuses identity-pinned transport and enforces channel limits', () => {
  const { manager } = fixture(); const first = manager.execute('connection-broker-2', { sessionId: 'srv-1', host: 'server.test', user: 'ops', channelLimit: 2 }); const second = manager.execute('connection-broker-2', { sessionId: 'srv-1', host: 'server.test', user: 'ops', kind: 'files', channelLimit: 2 }); assert.equal(first.reusedTransport, false); assert.equal(second.reusedTransport, true); assert.equal(second.lease.credentialsIncluded, false); assert.throws(() => manager.execute('connection-broker-2', { sessionId: 'srv-1', host: 'server.test', user: 'ops', channelLimit: 2 }), /channel limit/); const released = manager.execute('connection-broker-2', { action: 'release', id: first.lease.id }); assert.ok(released.lease.releasedAt);
});

test('native shell integration writes bounded OSC packages without modifying profiles', () => {
  const { manager } = fixture(); for (const shell of ['bash', 'zsh', 'fish', 'powershell']) { const result = manager.execute('native-shell-integration', { shell }); assert.equal(fs.existsSync(result.file), true); assert.equal(result.profileModified, false); assert.ok(result.signals.includes('OSC-7-cwd')); } assert.equal(manager.summary().layers.find(item => item.id === 'native-shell-integration').status, 'installed');
});

test('workspace recovery journal is hash chained and never replays commands or stores buffers', () => {
  const { manager } = fixture(); const saved = manager.execute('crash-safe-workspace-journal', { workspaceId: 'ops', cwd: '/srv/app', tabs: [{ name: 'Terminal' }], unsavedBuffers: [{ path: '/srv/app/note', content: 'token=hidden' }] }); assert.equal(saved.contentPersisted, false); assert.equal(JSON.stringify(saved).includes('hidden'), false); const recovered = manager.execute('crash-safe-workspace-journal', { action: 'recover' }); assert.equal(recovered.journalValid, true); assert.equal(recovered.commandsReplayed, false); assert.equal(recovered.workspaces.length, 1);
});

test('production transfers persist checkpoints and execute only after approval', async () => {
  const { manager } = fixture(); const planned = await manager.execute('production-transfer-core', { action: 'create', direction: 'upload', connection: { id: 'srv-1' }, localPath: 'C:\\temp\\a', remotePath: '/srv/a' }); assert.equal(planned.requiresApproval, true); await assert.rejects(() => manager.execute('production-transfer-core', { action: 'execute', id: planned.transfer.id }), /explicit approval/); const completed = await manager.execute('production-transfer-core', { action: 'execute', id: planned.transfer.id, approved: true }); assert.equal(completed.verified, true); assert.equal(completed.transfer.status, 'completed'); assert.equal(completed.transfer.transferred, 100);
});

test('Remote Editor Core applies a signed optimistic plan and verifies the result', async () => {
  const { manager, remoteContent } = fixture(); const preview = await manager.execute('remote-editor-core', { action: 'preview', sessionId: 'srv-1', path: '/etc/app.conf', content: 'after' }); assert.equal(preview.plan.contentPersisted, false); const applied = await manager.execute('remote-editor-core', { action: 'apply', id: preview.plan.id, approved: true }); assert.equal(applied.verified, true); assert.equal(remoteContent(), 'after');
});

test('protocol matrix, scale profiler and hardening are bounded and production-safe', () => {
  const { manager } = fixture(); const matrix = manager.execute('real-protocol-test-matrix', {}); assert.equal(matrix.matrix.length, 49); assert.equal(matrix.productionTouched, undefined); assert.ok(matrix.matrix.every(item => item.productionTouched === false)); const scale = manager.execute('extreme-scale-profiling', { servers: 10000, files: 1000000 }); assert.equal(scale.rawRowsRendered, false); assert.equal(scale.sampled.files, 100000); assert.equal(scale.pass, true); const security = manager.execute('security-hardening-pass', {}); assert.equal(security.classes, 8); assert.equal(security.passed, true); assert.equal(security.serverMutations, false);
});

test('portable updater requires an Ed25519 signature and stages verified payloads', () => {
  const { manager, root } = fixture(); const file = path.join(root, 'tool.exe'); fs.writeFileSync(file, 'portable-tool'); const pair = crypto.generateKeyPairSync('ed25519'); const payload = { tools: [{ id: 'tool', version: '1.0.0', file, sha256: crypto.createHash('sha256').update('portable-tool').digest('hex') }] }; const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), pair.privateKey).toString('base64'); const staged = manager.execute('signed-portable-tool-updater', { manifest: { payload, signature }, publicKey: pair.publicKey }); assert.equal(staged.update.signatureVerified, true); assert.equal(staged.bundledToolsReplaced, false); assert.equal(fs.existsSync(staged.update.staging), true); assert.throws(() => manager.execute('signed-portable-tool-updater', { manifest: { payload, signature: Buffer.from('bad').toString('base64') }, publicKey: pair.publicKey }), /signature/);
});

test('runtime audit combines health, real bounded profiling and security gates', () => {
  const { manager } = fixture(); const report = manager.runtimeAudit({ servers: 1000, files: 10000 }); assert.equal(report.score, 100); assert.equal(report.security.passed, true); assert.equal(report.performance.pass, true); assert.equal(report.protocolCells, 49); assert.equal(manager.summary().audits, 1);
});
