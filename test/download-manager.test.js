'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const DownloadManager = require('../src/download-manager');

function createManager(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-download-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'downloads.json'), JSON.stringify({
    node: { '24.18.0': { win: 'https://example.invalid/node.zip', linux: 'https://example.invalid/node.tar.xz' } }
  }));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new DownloadManager(root);
}

test('download paths cannot escape the managed servers directory', t => {
  const manager = createManager(t);
  assert.match(manager.getInstallPath('node', '24.18.0'), /servers/);
  assert.throws(() => manager.getInstallPath('node', '../../outside'), /invalid/i);
  assert.deepEqual(manager.removeVersion('node', '../../outside'), { success: false, error: 'Invalid version' });
});

test('catalog exposes all supported services and installed state', t => {
  const manager = createManager(t);
  const catalog = manager.getCatalog();
  assert.equal(catalog.length, 18);
  assert.equal(catalog.find(service => service.id === 'node').versions[0].version, '24.18.0');
  assert.equal(catalog.find(service => service.id === 'composer').category, 'Developer tools');
  assert.equal(catalog.find(service => service.id === 'java').name, 'Eclipse Temurin JDK');
});

test('creates a platform launcher for managed Composer', async t => {
  const manager = createManager(t);
  manager._platform = 'win';
  const target = manager.getInstallPath('composer', '2.10.2');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'composer.phar'), 'synthetic phar');
  await manager._finalizeManagedTool('composer', target);
  const launcher = fs.readFileSync(path.join(target, 'composer.cmd'), 'utf8');
  assert.match(launcher, /php .*composer\.phar/i);
  assert.equal(manager._urlExtension('OpenJDK25U-jdk_x64_windows_hotspot.zip'), '.zip');
});

test('plain HTTP downloads are rejected unless they target loopback', async t => {
  const manager = createManager(t);
  const destination = path.join(manager.tempDir, 'blocked.zip');
  await assert.rejects(manager._downloadFile('http://example.com/file.zip', destination), /HTTPS/i);
});

test('flattens a single archive directory without losing nested PostgreSQL-style content', async t => {
  const manager = createManager(t);
  const target = path.join(manager.tempDir, 'postgresql-extract');
  const nested = path.join(target, 'pgsql');
  fs.mkdirSync(path.join(nested, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(nested, 'doc'), { recursive: true });
  fs.writeFileSync(path.join(nested, 'bin', 'postgres.exe'), 'synthetic executable');
  fs.writeFileSync(path.join(nested, 'doc', 'readme.txt'), 'documentation');

  await manager._flattenSingleDir(target);

  assert.equal(fs.existsSync(path.join(target, 'pgsql')), false);
  assert.equal(fs.readFileSync(path.join(target, 'bin', 'postgres.exe'), 'utf8'), 'synthetic executable');
  assert.equal(fs.readFileSync(path.join(target, 'doc', 'readme.txt'), 'utf8'), 'documentation');
});

test('reports an archive finalization error instead of throwing outside the download promise', async t => {
  const manager = createManager(t);
  const source = path.join(manager.tempDir, 'archive-source');
  const destination = path.join(manager.tempDir, 'archive-destination');
  const archive = path.join(manager.tempDir, 'synthetic.zip');
  fs.mkdirSync(path.join(source, 'pgsql'), { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, 'pgsql', 'postgres.exe'), 'synthetic executable');
  execFileSync('tar', ['-a', '-cf', archive, '-C', source, 'pgsql']);
  manager._flattenSingleDir = async () => {
    const error = new Error('simulated Windows lock');
    error.code = 'EPERM';
    throw error;
  };

  await assert.rejects(manager._extractZip(archive, destination), /Archive finalization failed: simulated Windows lock/);
});
