'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ActivityManager = require('../src/activity-manager');
const BackupManager = require('../src/backup-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-backups-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tool = path.join(root, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
  fs.writeFileSync(tool, 'tool');
  const profile = { id: 'pg', version: '18', host: '127.0.0.1', port: 5432, username: 'dev', password: 'secret' };
  const config = { postgresql: { activeProfileId: 'pg', profiles: [profile] } };
  const configManager = { getConfig: () => config, getActiveProfile: () => profile };
  const connection = { id: 'managed:postgresql', type: 'postgresql', version: '18', host: '127.0.0.1', port: 5432, username: 'dev', password: 'secret', name: 'Postgres' };
  const dbViewer = { _resolveConnection: () => connection };
  const downloadManager = { isInstalled: () => true, getInstallPath: () => root };
  const calls = [];
  const runner = async (_tool, args, env, spec) => {
    calls.push({ args, env: { PGPASSWORD: env.PGPASSWORD }, stdinFile: spec.stdinFile });
    const fileIndex = args.indexOf('--file');
    if (fileIndex >= 0) fs.writeFileSync(args[fileIndex + 1], 'valid backup contents');
  };
  const manager = new BackupManager(root, configManager, downloadManager, dbViewer, new ActivityManager(root), { runner });
  return { root, manager, calls };
}

test('creates, verifies and removes database backups without persisting passwords', async t => {
  const { manager, calls } = fixture(t);
  const result = await manager.create('managed:postgresql', 'app_db');
  assert.equal(result.success, true);
  assert.equal(manager.list().length, 1);
  assert.equal(manager.verify(result.backup.id).success, true);
  assert.equal(calls[0].env.PGPASSWORD, 'secret');
  const metadata = fs.readFileSync(manager.metadataPath, 'utf8');
  assert.doesNotMatch(metadata, /secret/);
  assert.equal(manager.remove(result.backup.id).success, true);
  assert.equal(manager.list().length, 0);
});

test('backup rotation retains the requested newest count', async t => {
  const { manager } = fixture(t);
  for (let index = 0; index < 3; index += 1) await manager.create('managed:postgresql', 'app_db');
  const result = manager.rotate('postgresql', 'app_db', 2);
  assert.equal(result.removed, 1);
  assert.equal(manager.list().length, 2);
});

test('backup schedules are normalized and persisted', t => {
  const { manager } = fixture(t);
  const schedule = manager.saveSchedule({ type: 'postgresql', database: 'app_db', intervalHours: 12, keep: 7 });
  assert.equal(schedule.intervalHours, 12);
  assert.equal(manager.schedules().length, 1);
  assert.equal(manager.removeSchedule(schedule.id).removed, 1);
});
