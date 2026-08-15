'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RemoteAccessManager = require('../src/remote-access-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-remote-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const values = new Map();
  const secrets = { set: (key, value) => values.set(key, value), get: key => values.get(key) || '', remove: key => values.delete(key) };
  return { root, values, manager: new RemoteAccessManager(root, secrets) };
}

test('remote sessions persist metadata without plaintext credentials', t => {
  const { root, values, manager } = fixture(t);
  const result = manager.save({ name: 'Production', host: 'prod.example.test', username: 'deploy', type: 'sftp' }, { password: 'top-secret' });
  assert.equal(result.success, true);
  assert.equal(manager.list()[0].host, 'prod.example.test');
  const raw = fs.readFileSync(path.join(root, 'config', 'remote-sessions.json'), 'utf8');
  assert.equal(raw.includes('top-secret'), false);
  assert.equal(values.get(`remote:${result.session.id}:password`), 'top-secret');
});

test('remote session update preserves identity and delete removes secrets', t => {
  const { values, manager } = fixture(t);
  const saved = manager.save({ name: 'Box', host: 'one.example.test' }, { password: 'secret' }).session;
  const updated = manager.save({ ...saved, host: 'two.example.test' }, {}).session;
  assert.equal(updated.id, saved.id);
  assert.equal(manager.list().length, 1);
  assert.equal(manager.list()[0].host, 'two.example.test');
  manager.remove(saved.id);
  assert.equal(manager.list().length, 0);
  assert.equal(values.has(`remote:${saved.id}:password`), false);
});

test('local browser lists directories before files', t => {
  const { root, manager } = fixture(t);
  fs.mkdirSync(path.join(root, 'folder'));
  fs.writeFileSync(path.join(root, 'file.txt'), 'hello');
  const listing = manager.localList(root);
  assert.deepEqual(listing.entries.map(item => item.name), ['folder', 'file.txt']);
  assert.equal(listing.entries[0].directory, true);
});

test('local editor enforces its size limit and search is recursive', t => {
  const { root, manager } = fixture(t);
  const nested = path.join(root, 'nested'); fs.mkdirSync(nested);
  const file = path.join(nested, 'settings.json'); fs.writeFileSync(file, '{"ok":true}');
  assert.equal(manager.readLocal(file).content, '{"ok":true}');
  manager.writeLocal(file, '{"ok":false}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":false}');
  assert.equal(manager.searchLocal(root, 'settings').results[0].path, file);
  assert.throws(() => manager.writeLocal(file, 'x'.repeat(2 * 1024 * 1024 + 1)), /too large/i);
});

test('local preview only accepts bounded image and PDF formats', t => {
  const { root, manager } = fixture(t); const image = path.join(root, 'pixel.png'); fs.writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47])); const preview = manager.previewLocal(image);
  assert.equal(preview.mime, 'image/png'); assert.equal(preview.base64, 'iVBORw=='); const script = path.join(root, 'script.html'); fs.writeFileSync(script, '<script>'); assert.throws(() => manager.previewLocal(script), /supports PNG/i);
});

test('sessions keep organization metadata and can be duplicated with secrets', t => {
  const { values, manager } = fixture(t);
  const saved = manager.save({ name: 'Primary', host: 'box.test', group: 'Production', favorite: true, production: true }, { password: 'encrypted-value' }).session;
  const copy = manager.duplicate(saved.id).session;
  assert.equal(copy.group, 'Production');
  assert.equal(copy.favorite, true);
  assert.equal(copy.production, true);
  assert.notEqual(copy.id, saved.id);
  assert.equal(values.get(`remote:${copy.id}:password`), 'encrypted-value');
});

test('SSH profiles persist jump host, agent forwarding and tmux preferences', t => {
  const { manager } = fixture(t);
  const jump = manager.save({ name: 'Bastion', host: 'jump.test' }).session;
  const target = manager.save({ name: 'Private', host: '10.0.0.8', jumpHostId: jump.id, useAgent: true, agentForward: true, tmuxSession: 'ops-main' }).session;
  assert.equal(target.jumpHostId, jump.id); assert.equal(target.useAgent, true); assert.equal(target.agentForward, true); assert.equal(target.tmuxSession, 'ops-main');
  assert.equal(manager.save({ ...target, tmuxSession: 'bad;name' }).session.tmuxSession, 'badname');
});

test('ProxyCommand profiles persist while unsafe shell syntax is rejected', t => {
  const { manager } = fixture(t);
  const session = manager.save({ name: 'Tor', host: 'private.test', proxyCommand: 'nc -X 5 -x 127.0.0.1:9050 %h %p' }).session;
  assert.match(session.proxyCommand, /127\.0\.0\.1:9050/);
  assert.throws(() => manager._proxySocket('nc %h %p; calc.exe', session), /shell syntax/i);
  assert.throws(() => manager._proxySocket('powershell -Command x', session), /not allowed/i);
});

test('imports OpenSSH and WinSCP profiles without credentials', t => {
  const { manager } = fixture(t);
  const ssh = manager.importProfiles('Host bastion\n  HostName jump.example.test\n  User ops\nHost private\n  HostName 10.0.0.8\n  User deploy\n  ProxyJump bastion\n  IdentityFile ~/.ssh/id_ed25519', 'openssh');
  assert.equal(ssh.imported.length, 2); assert.equal(ssh.imported[1].jumpHostId, ssh.imported[0].id); assert.equal(ssh.imported[1].auth, 'key');
  const winscp = manager.importProfiles('[Sessions\\Web%20server]\nHostName=web.example.test\nUserName=admin\nPortNumber=2222\nRemoteDirectory=/srv/www\nFSProtocol=2', 'winscp');
  assert.equal(winscp.imported[0].name, 'Web server'); assert.equal(winscp.imported[0].port, 2222); assert.equal(winscp.imported[0].remotePath, '/srv/www');
});

test('desktop and console protocols retain their safe defaults', t => {
  const { manager } = fixture(t);
  assert.equal(manager.save({ name: 'Screen', host: 'desk.test', type: 'vnc' }).session.port, 5900);
  const serial = manager.save({ name: 'Switch', host: 'COM7', type: 'serial', baudRate: 921600 }).session;
  assert.equal(serial.type, 'serial'); assert.equal(serial.baudRate, 921600);
  assert.equal(manager.save({ name: 'Legacy', host: 'old.test', type: 'telnet' }).session.port, 23);
});

test('portable profile sharing excludes secrets and trust state', t => {
  const { manager } = fixture(t); manager.save({ name: 'Shared', host: 'shared.test', hostFingerprint: 'SHA256:private-state' }, { password: 'never-export' });
  const bundle = manager.exportProfiles(); assert.equal(bundle.includes('never-export'), false); assert.equal(bundle.includes('private-state'), false);
  const imported = manager.importProfiles(bundle, 'kitsune'); assert.equal(imported.imported[0].host, 'shared.test'); assert.notEqual(imported.imported[0].id, manager.list()[0].id);
});

test('SSH host keys use trust-on-first-use and reject a changed pinned key', t => {
  const { manager } = fixture(t);
  const session = manager.save({ name: 'Pinned', host: 'box.test', hostFingerprint: 'SHA256:known' }).session;
  const { options } = manager.connectionOptions(session);
  assert.equal(options.hostHash, 'sha256');
  assert.equal(options.hostVerifier('known'), true);
  assert.equal(options.hostVerifier('changed'), false);
  manager.resetHostKey(session.id);
  const reset = manager.connectionOptions({ id: session.id }).options;
  assert.equal(reset.hostVerifier('new-key'), true);
});

test('SSH leases share one pinned transport and release channels independently', async t => {
  const { manager } = fixture(t); const session = manager.save({ name: 'Pool', host: 'pool.test' }).session; let connections = 0; let ended = 0;
  manager.connect = async () => { connections++; return { session, fingerprint: 'SHA256:test', client: { once() {}, end() { ended++; } } }; };
  manager.connectionPoolIdleMs = 5; const first = await manager.lease(session, 'terminal'); const second = await manager.lease(session, 'sftp');
  assert.equal(connections, 1); assert.equal(first.client, second.client); assert.equal(manager.poolStatus().activeLeases, 2); first.release(); assert.equal(manager.poolStatus().connections, 1); second.release(); await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(manager.poolStatus().connections, 0); assert.equal(ended, 1);
});
