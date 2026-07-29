'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConfigManager = require('../src/config-manager');
const ServiceManager = require('../src/service-manager');
const DbViewer = require('../src/db-viewer');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-roots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('global document root is used by Apache, Nginx and Caddy generators', t => {
  const root = tempRoot(t);
  const configManager = new ConfigManager(root);
  const config = configManager.getDefaults();
  const sharedRoot = path.join(root, 'shared-www');
  fs.mkdirSync(sharedRoot, { recursive: true });
  config.general.forceGlobalDocumentRoot = true;
  config.general.globalDocumentRoot = sharedRoot;
  for (const section of ['apache', 'nginx', 'caddy']) {
    configManager.getActiveProfile(config, section).documentRoot = path.join(root, `private-${section}`);
  }
  assert.equal(configManager.saveConfig(config).success, true);

  const downloads = { isInstalled: () => true };
  const manager = new ServiceManager(downloads, configManager);
  const installDirs = {};
  for (const section of ['apache', 'nginx', 'caddy']) {
    installDirs[section] = path.join(root, section);
    fs.mkdirSync(installDirs[section], { recursive: true });
    manager._buildArgs(section, configManager.getActiveProfile(configManager.getConfig(), section), installDirs[section]);
  }

  const normalized = sharedRoot.replace(/\\/g, '/');
  assert.match(fs.readFileSync(path.join(installDirs.apache, 'conf', 'httpd.conf'), 'utf8'), new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(fs.readFileSync(path.join(installDirs.nginx, 'conf', 'nginx.conf'), 'utf8'), new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(fs.readFileSync(path.join(installDirs.caddy, 'conf', 'Caddyfile'), 'utf8'), new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('global document root change restarts every running web server and locks profile roots', async t => {
  const root = tempRoot(t);
  const configManager = new ConfigManager(root);
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  manager.processes.set('apache', {});
  manager.processes.set('nginx', {});
  const events = [];
  manager.stopService = async section => { events.push(`stop:${section}`); manager.processes.delete(section); return { success: true }; };
  manager.startService = async section => { events.push(`start:${section}`); manager.processes.set(section, {}); return { success: true }; };
  const sharedRoot = path.join(root, 'global-www');
  fs.mkdirSync(sharedRoot);

  const result = await manager.setGlobalDocumentRoot(true, sharedRoot);
  assert.equal(result.success, true);
  assert.deepEqual(result.restarted, ['apache', 'nginx']);
  assert.deepEqual(events, ['stop:apache', 'stop:nginx', 'start:apache', 'start:nginx']);
  assert.equal(configManager.getConfig().general.globalDocumentRoot, sharedRoot);
  const rejected = await manager.setDocumentRoot('apache', root);
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /global document root is enforced/i);
});

test('custom database connections persist without passwords', t => {
  const root = tempRoot(t);
  const configManager = new ConfigManager(root);
  const downloads = { getInstalledVersions: () => [], getInstallPath: () => root };
  const viewer = new DbViewer(downloads, configManager, { getServiceStatus: () => ({ running: false }) });
  const saved = viewer.saveConnection({
    name: 'External PostgreSQL', type: 'postgresql', host: 'db.local', port: 5544,
    username: 'developer', password: 'do-not-persist'
  });
  assert.equal(saved.success, true);
  const stored = configManager.getConfig().databaseManager.connections[0];
  assert.equal(stored.name, 'External PostgreSQL');
  assert.equal(stored.password, undefined);
  assert.equal(viewer._resolveConnection({ id: saved.id, password: 'session-only' }).password, 'session-only');
});

test('database manager uses native drivers and returns tabular query results', async t => {
  const root = tempRoot(t);
  const configManager = new ConfigManager(root);
  const viewer = new DbViewer({}, configManager, { getServiceStatus: () => ({ running: true }) });
  const connection = { type: 'postgresql', host: '127.0.0.1', port: 5432, username: 'postgres' };
  viewer._withNativeConnection = async (_input, database, action) => {
    assert.equal(database, 'example');
    return action({
      type: 'postgresql',
      client: { query: async query => ({ rows: [{ id: 1, label: 'ready' }], rowCount: 1, query }) }
    });
  };
  const result = await viewer.executeQueryFor(connection, 'example', 'SELECT 1');
  assert.deepEqual(result.columns, ['id', 'label']);
  assert.deepEqual(result.rows, [['1', 'ready']]);
});

test('MongoDB JSON query format supports bounded collection reads', async t => {
  const root = tempRoot(t);
  const viewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  const calls = [];
  const cursor = {
    skip(value) { calls.push(['skip', value]); return this; },
    limit(value) { calls.push(['limit', value]); return this; },
    async toArray() { return [{ _id: 'one', enabled: true }]; }
  };
  const database = { collection: name => ({ find: filter => { calls.push(['find', name, filter]); return cursor; } }) };
  const result = await viewer._executeMongoOperation(database, JSON.stringify({ collection: 'items', operation: 'find', filter: { enabled: true }, limit: 5000 }));
  assert.deepEqual(calls, [['find', 'items', { enabled: true }], ['skip', 0], ['limit', 1000]]);
  assert.deepEqual(result.columns, ['_id', 'enabled']);
});
