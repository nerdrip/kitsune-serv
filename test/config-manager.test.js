'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ConfigManager = require('../src/config-manager');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('creates and persists defaults on first read', t => {
  const root = tempRoot(t);
  const manager = new ConfigManager(root);
  const config = manager.getConfig();
  assert.equal(config.general.theme, 'dark');
  assert.equal(config.node.profiles.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'config', 'kitsuneserv.json')), true);
});

test('merges newly introduced profile settings without losing user values', t => {
  const root = tempRoot(t);
  const manager = new ConfigManager(root);
  const config = manager.getDefaults();
  config.node.profiles[0] = { id: 'node-profile', name: 'Custom Node', version: '20.19.0', port: 4567 };
  config.node.activeProfileId = 'node-profile';
  assert.equal(manager.saveConfig(config).success, true);
  const loaded = manager.getConfig();
  assert.equal(loaded.node.profiles[0].port, 4567);
  assert.equal(loaded.node.profiles[0].watchMode, true);
});

test('recovers a valid backup when the primary configuration is corrupt', t => {
  const root = tempRoot(t);
  const manager = new ConfigManager(root);
  const config = manager.getDefaults();
  config.general.theme = 'light';
  assert.equal(manager.saveConfig(config).success, true);
  fs.copyFileSync(manager.configPath, `${manager.configPath}.bak`);
  fs.writeFileSync(manager.configPath, '{broken', 'utf-8');
  assert.equal(manager.getConfig().general.theme, 'light');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(manager.configPath, 'utf-8')));
});

test('migrates versionless configuration to the current schema and records the step', t => {
  const root = tempRoot(t);
  const manager = new ConfigManager(root);
  const legacy = manager.getDefaults();
  delete legacy.schemaVersion;
  delete legacy.general.crashRecovery;
  delete legacy.general.projectPreflight;
  fs.mkdirSync(path.dirname(manager.configPath), { recursive: true });
  fs.writeFileSync(manager.configPath, JSON.stringify(legacy), 'utf8');
  const loaded = manager.getConfig();
  assert.equal(loaded.schemaVersion, ConfigManager.CURRENT_SCHEMA_VERSION);
  assert.equal(loaded.general.crashRecovery, true);
  assert.equal(loaded.general.projectPreflight, true);
  assert.equal(manager.getMigrationInfo().migrated, true);
  const history = JSON.parse(fs.readFileSync(manager.migrationHistoryPath, 'utf8'));
  assert.equal(history.at(-1).to, ConfigManager.CURRENT_SCHEMA_VERSION);
});

test('refuses a newer configuration schema without overwriting it', t => {
  const root = tempRoot(t);
  const manager = new ConfigManager(root);
  const future = { schemaVersion: ConfigManager.CURRENT_SCHEMA_VERSION + 1, general: { theme: 'future' } };
  fs.mkdirSync(path.dirname(manager.configPath), { recursive: true });
  fs.writeFileSync(manager.configPath, JSON.stringify(future), 'utf8');
  assert.throws(() => manager.getConfig(), /newer than supported/);
  assert.deepEqual(JSON.parse(fs.readFileSync(manager.configPath, 'utf8')), future);
});
