'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PlatformManager = require('../src/platform-manager');

test('platform inventory is safe and reports only current-platform package managers', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-platform-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inventory = new PlatformManager(root).inventory();
  assert.equal(inventory.platform, process.platform);
  assert.ok(Array.isArray(inventory.packageManagers));
  if (process.platform !== 'win32') assert.equal(inventory.packageManagers.some(item => item.id === 'winget'), false);
  if (process.platform !== 'linux') assert.equal(inventory.systemd.supported, false);
});
