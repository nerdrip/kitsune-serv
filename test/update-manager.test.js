'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
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
