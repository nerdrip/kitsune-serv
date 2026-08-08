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
  assert.equal(fs.existsSync(path.join(sharedRoot, 'index.html')), false, 'starting a web server must not write into the document root');
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

test('database object navigator exposes MongoDB metadata and paged data', async t => {
  const root = tempRoot(t);
  const viewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  const cursor = {
    skip(value) { this.offset = value; return this; },
    limit(value) { this.count = value; return this; },
    async toArray() { return [{ _id: 'one', title: 'Kitsune' }]; }
  };
  const collection = {
    async findOne() { return { _id: 'one', title: 'Kitsune' }; },
    async indexes() { return [{ name: '_id_', key: { _id: 1 }, unique: true }]; },
    find() { return cursor; }
  };
  const database = {
    listCollections: () => ({ toArray: async () => [{ name: 'projects', type: 'collection' }] }),
    collection: () => collection,
    command: async () => ({ count: 1, size: 128, storageSize: 256, totalIndexSize: 64 })
  };
  viewer._withNativeConnection = async (_input, selectedDatabase, action) => {
    assert.equal(selectedDatabase, 'workspace');
    return action({ type: 'mongodb', db: database });
  };
  const connection = { type: 'mongodb', host: '127.0.0.1', port: 27017 };
  const objects = await viewer.listObjectsFor(connection, 'workspace');
  assert.equal(objects.schemas[0].objects[0].name, 'projects');
  const metadata = await viewer.describeObjectFor(connection, 'workspace', 'workspace', 'projects');
  assert.equal(metadata.columns.find(column => column.name === 'title').dataType, 'string');
  assert.equal(metadata.indexes[0].name, '_id_');
  assert.equal(metadata.stats.storageSize, 256);
  const data = await viewer.tableDataFor(connection, 'workspace', 'projects', 250, 500, 'workspace');
  assert.deepEqual(data.columns, ['_id', 'title']);
  assert.equal(data.offset, 500);
  assert.equal(cursor.offset, 500);
  assert.equal(cursor.count, 250);
});

test('database workbench enforces read-only mode and wraps SQL in a transaction', async t => {
  const root = tempRoot(t);
  const viewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  const calls = [];
  viewer._withNativeConnection = async (_input, database, action) => {
    assert.equal(database, 'workspace');
    return action({
      type: 'postgresql',
      client: {
        query: async query => {
          calls.push(query);
          if (String(query).startsWith('SELECT')) return { rows: [{ id: 1, state: 'ready' }], rowCount: 1 };
          return { rows: [], rowCount: null };
        },
        end: async () => {}
      }
    });
  };
  const connection = { type: 'postgresql', host: '127.0.0.1', port: 5432, name: 'Test' };
  await assert.rejects(() => viewer.executeWorkbench(connection, 'workspace', 'UPDATE projects SET state = 1', { readOnly: true }), /read-only/i);
  const result = await viewer.executeWorkbench(connection, 'workspace', 'SELECT 1 AS id', { readOnly: true, transaction: true, timeoutMs: 5000, queryId: 'query-test-123' });
  assert.deepEqual(calls, ['BEGIN READ ONLY', 'SET statement_timeout TO 5000', 'SELECT 1 AS id', 'COMMIT']);
  assert.deepEqual(result.rows, [['1', 'ready']]);
  assert.equal(result.transaction, true);
  assert.equal(result.readOnly, true);
  assert.equal(viewer.queryHistory()[0].success, true);
});

test('database workbench persists reusable saved queries and blocks MongoDB writes', async t => {
  const root = tempRoot(t);
  const viewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  const saved = viewer.saveQuery({ name: 'Recent projects', query: 'SELECT * FROM projects', type: 'postgresql', database: 'workspace', tags: ['debug'] });
  const nextViewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  assert.equal(nextViewer.listSavedQueries()[0].id, saved.id);
  assert.equal(nextViewer.removeSavedQuery(saved.id).removed, true);
  await assert.rejects(() => nextViewer.executeWorkbench(
    { type: 'mongodb', host: '127.0.0.1', port: 27017, name: 'Mongo' },
    'workspace',
    JSON.stringify({ collection: 'projects', operation: 'deleteMany', filter: {} }),
    { readOnly: true }
  ), /read-only/i);
});

test('active database workbench queries can be cancelled by id', t => {
  const root = tempRoot(t);
  const viewer = new DbViewer({}, new ConfigManager(root), { getServiceStatus: () => ({ running: true }) });
  let cancelled = false;
  viewer.activeQueries.set('query-cancel', { queryId: 'query-cancel', cancel: () => { cancelled = true; } });
  assert.equal(viewer.cancelQuery('query-cancel').success, true);
  assert.equal(cancelled, true);
  assert.equal(viewer.listActiveQueries().length, 0);
});
