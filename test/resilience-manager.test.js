'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ResilienceManager = require('../src/resilience-manager');

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-resilience-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, manager: new ResilienceManager(root, { set() {}, get() { return ''; } }, {}, { exec: async () => ({ success: true, stdout: '' }) }) }; }

test('content cache and deduplicated backup restore both directories and single files', t => {
  const { root, manager } = fixture(t); const source = path.join(root, 'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'a.txt'), 'same'); fs.writeFileSync(path.join(source, 'b.txt'), 'same');
  const backup = manager.deduplicatedBackup(source, 'pair'); assert.equal(backup.manifest.uniqueObjects, 1);
  const restored = path.join(root, 'restored'); manager.restoreDeduplicated(backup.manifest.id, restored); assert.equal(fs.readFileSync(path.join(restored, 'a.txt'), 'utf8'), 'same');
  const single = manager.deduplicatedBackup(path.join(source, 'a.txt'), 'single'); const singleOut = path.join(root, 'single-out'); manager.restoreDeduplicated(single.manifest.id, singleOut); assert.equal(fs.readFileSync(path.join(singleOut, 'a.txt'), 'utf8'), 'same');
});

test('Offline Vault is encrypted and Break Glass is MFA-bound and single-use', t => {
  const { manager } = fixture(t); assert.throws(() => manager.offlineVaultCreate({ passphrase: 'short' }), /12 characters/i);
  const vault = manager.offlineVaultCreate({ passphrase: 'correct horse battery', profiles: [{ host: 'server.test' }] }); const raw = fs.readFileSync(vault.file); assert.equal(raw.subarray(0, 6).toString(), 'KSVLT1'); assert.equal(raw.includes(Buffer.from('server.test')), false);
  const grant = manager.breakGlassCreate({ sessionId: 's1', reason: 'Recovery' }); assert.throws(() => manager.breakGlassConsume(grant.id, grant.code, false), /MFA/i); assert.equal(manager.breakGlassConsume(grant.id, grant.code, true).success, true); assert.throws(() => manager.breakGlassConsume(grant.id, grant.code, true), /invalid or expired/i);
});

test('firewall changes are previewed before execution', t => {
  const { manager } = fixture(t); const action = manager.firewall({}, 'allow', { port: 443, protocol: 'tcp', source: '10.0.0.0/8' }); assert.match(action.preview, /ufw allow/); assert.equal(typeof action.execute, 'function'); assert.throws(() => manager.firewall({}, 'allow', { port: 70000 }), /port/i);
});
