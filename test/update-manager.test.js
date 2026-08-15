'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const UpdateManager = require('../src/update-manager');
const { compareVersions, canonicalManifest, verifyManifest } = require('../src/update-manager');

test('semantic version comparison handles stable and prerelease builds', () => {
  assert.equal(compareVersions('1.0.0-beta12', '1.0.0-beta13'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta99'), 1);
  assert.equal(compareVersions('2.1.0', '2.1.0'), 0);
});

test('update manifest must have a valid Ed25519 signature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const manifest = { version: '1.0.0-beta13', url: 'https://updates.example/KitsuneServ.exe', sha256: 'a'.repeat(64), platform: 'win32', arch: 'x64' };
  manifest.signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64');
  assert.equal(verifyManifest(manifest, publicKey), true);
  assert.throws(() => verifyManifest({ ...manifest, sha256: 'b'.repeat(64) }, publicKey), /signature/);
});

test('rollback accepts only an existing package with its recorded checksum', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const updates = path.join(root, 'updates'); fs.mkdirSync(updates, { recursive: true });
  const installer = path.join(updates, 'old.exe'); fs.writeFileSync(installer, 'verified installer');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
  fs.writeFileSync(path.join(updates, 'verified-history.json'), JSON.stringify([{ version: '2.9.0', path: installer, sha256 }]));
  const manager = new UpdateManager(root, '3.0.0', { run: () => {} }, { platform: 'win32', allowInstall: false });
  const result = manager.rollback(); assert.equal(result.manual, true); assert.equal(result.path, installer);
  fs.writeFileSync(installer, 'tampered'); assert.match(manager.rollback().error, /No previously verified/);
});
