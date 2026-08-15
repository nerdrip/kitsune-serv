'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const PortableToolsManager = require('../src/portable-tools-manager');
const { rewriteManifest } = require('../scripts/after-sign-portable-tools');

test('portable tool manager verifies pinned binaries and rejects tampering', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-portable-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, 'tool.exe'); fs.writeFileSync(binary, 'trusted-binary'); const sha256 = crypto.createHash('sha256').update('trusted-binary').digest('hex');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ tools: [{ id: 'tool', name: 'Tool', version: '1.0', path: 'tool.exe', sha256 }] }));
  const manager = new PortableToolsManager(root); assert.equal(manager.verify('tool').valid, true); assert.equal(manager.list()[0].verified, true);
  fs.writeFileSync(binary, 'tampered'); assert.equal(manager.verify('tool').valid, false); assert.throws(() => manager.launch('tool'), /SHA-256/i);
});

test('bundled portable manifest includes licenses and corresponding GPL sources', () => {
  const root = path.join(__dirname, '..', 'vendor', 'portable-tools', 'windows'); const manager = new PortableToolsManager(root); const tools = manager.list();
  assert.ok(tools.length >= 10); assert.ok(tools.every(tool => tool.available && tool.verified)); const rclone = tools.find(tool => tool.id === 'rclone'); assert.equal(rclone.version, '1.75.0'); assert.equal(fs.existsSync(path.join(root, rclone.licenseFile)), true);
  for (const tool of tools.filter(item => item.license.startsWith('GPL'))) { assert.ok(tool.source); assert.equal(fs.existsSync(path.join(root, tool.source)), true); }
});

test('post-sign hook pins builder-signed packaged binaries without losing upstream hash', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-post-sign-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); fs.writeFileSync(path.join(root, 'tool.exe'), 'signed-content');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ tools: [{ id: 'tool', name: 'Tool', version: '1', path: 'tool.exe', sha256: 'UPSTREAM' }] }));
  assert.equal(rewriteManifest(root).updated, 1); const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')); assert.equal(manifest.tools[0].upstreamSha256, 'UPSTREAM'); assert.match(manifest.tools[0].sha256, /^[A-F0-9]{64}$/); assert.equal(new PortableToolsManager(root).verify('tool').valid, true);
});
