'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DownloadManager = require('../src/download-manager');

test('offline download cache verifies, exports, imports and clears archives', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'downloads.json'), '{}');
  const source = path.join(root, 'source.zip');
  fs.writeFileSync(source, 'archive-data');
  const manager = new DownloadManager(root);
  const stored = manager._storeInCache('node', '24.0.0', '.zip', source, 'https://example.test/node.zip');
  assert.equal(fs.existsSync(stored.path), true);
  assert.equal(manager.cacheStatus().entries.length, 1);
  const restored = path.join(root, 'restored.zip');
  assert.equal(manager._restoreFromCache('node', '24.0.0', '.zip', restored).sha256, stored.sha256);
  assert.equal(fs.readFileSync(restored, 'utf8'), 'archive-data');
  const exportRoot = path.join(root, 'export');
  const exported = manager.exportCache(exportRoot);
  assert.equal(exported.success, true);
  assert.equal(manager.clearCache().removed, 1);
  assert.equal(manager.importCache(exported.path).success, true);
  assert.equal(manager.cacheStatus().entries.length, 1);
});

test('offline cache rejects recursive export and corrupt entries', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-cache-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'downloads.json'), '{}');
  const manager = new DownloadManager(root);
  assert.equal(manager.exportCache(path.join(manager.cacheDir, 'nested')).success, false);
  const source = path.join(root, 'source.zip'); fs.writeFileSync(source, 'valid');
  const stored = manager._storeInCache('php', '8.4.0', '.zip', source, 'https://example.test/php.zip');
  fs.writeFileSync(stored.path, 'tampered');
  assert.equal(manager._restoreFromCache('php', '8.4.0', '.zip', path.join(root, 'copy.zip')), null);
});
