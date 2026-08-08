'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EnvironmentManager = require('../src/environment-manager');

test('environment snapshots redact secrets and verify integrity', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = { postgresql: { activeProfileId: 'pg', profiles: [{ id: 'pg', version: '18', password: 'db-secret' }] }, general: {} };
  const manager = new EnvironmentManager(
    root,
    { getConfig: () => structuredClone(config), saveConfig: () => ({ success: true }) },
    { getInstalledVersions: service => service === 'postgresql' ? ['18'] : [], isInstalled: () => true },
    { list: () => [{ id: 'one', slug: 'one', name: 'One', root: path.join(root, 'one'), env: { API_TOKEN: 'hidden', PUBLIC: 'visible' } }] },
    { getSelectedServices: () => ['postgresql'] },
    { getAllStatuses: () => ({}) }
  );
  const created = manager.createSnapshot('before update');
  assert.equal(created.success, true);
  const serialized = fs.readFileSync(created.snapshot.file, 'utf8');
  assert.doesNotMatch(serialized, /db-secret|hidden/);
  assert.match(serialized, /visible/);
  assert.equal(manager.listSnapshots()[0].valid, true);
  fs.appendFileSync(created.snapshot.file, 'tampered');
  assert.equal(manager.listSnapshots()[0].valid, false);
});
