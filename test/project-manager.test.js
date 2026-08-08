'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ActivityManager = require('../src/activity-manager');
const ProjectManager = require('../src/project-manager');
const SecretStore = require('../src/secret-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profiles = new Map([
    ['postgresql', { id: 'pg', version: '18.4', port: 5432 }],
    ['redis', { id: 'redis', version: '8.8.1', port: 6379 }],
    ['node', { id: 'node', version: '24.18.0', port: 3000 }],
    ['php', { id: 'php', version: '8.5.9', port: 9000 }],
    ['nginx', { id: 'nginx', version: '1.30.4', port: 8080, phpEnabled: true }]
  ]);
  const config = { general: { forceGlobalDocumentRoot: false, globalDocumentRoot: path.join(root, 'www') } };
  for (const [service, profile] of profiles) config[service] = { activeProfileId: profile.id, profiles: [profile] };
  const configManager = {
    getConfig: () => structuredClone(config),
    getActiveProfile: (cfg, service) => cfg[service]?.profiles?.find(item => item.id === cfg[service].activeProfileId),
    saveConfig: next => { Object.assign(config, structuredClone(next)); return { success: true }; }
  };
  const running = new Set();
  const calls = [];
  const serviceManager = {
    getServiceStatus: service => ({ running: running.has(service) }),
    setDocumentRoot: async (service, directory) => { profiles.get(service).documentRoot = directory; config[service].profiles[0].documentRoot = directory; calls.push(`root:${service}:${directory}`); return { success: true }; },
    switchVersion: async () => ({ success: true }),
    startService: async service => { running.add(service); calls.push(`start:${service}`); return { success: true }; },
    stopService: async service => { running.delete(service); calls.push(`stop:${service}`); return { success: true }; }
  };
  const downloadManager = { isInstalled: () => true };
  const activityManager = new ActivityManager(root);
  const manager = new ProjectManager(root, configManager, downloadManager, serviceManager, activityManager);
  return { root, manager, running, calls, config, configManager, downloadManager, serviceManager, activityManager };
}

test('project manager creates normalized projects from stack templates', t => {
  const { manager } = fixture(t);
  const project = manager.create({ name: 'My API', templateId: 'node-postgresql' });
  assert.equal(project.slug, 'my-api');
  assert.deepEqual(project.services, ['postgresql', 'node']);
  assert.equal(project.domain, 'my-api.test');
  assert.equal(fs.existsSync(project.root), true);
  assert.equal(manager.list().length, 1);
  assert.ok(manager.templates().some(template => template.id === 'laravel'));
});

test('project manager synchronizes every registered local domain on request', t => {
  const { root, manager } = fixture(t);
  manager.create({ name: 'API', templateId: 'blank' });
  manager.domainManager = {
    apply: (projects, options) => ({ success: true, domains: projects.map(project => project.domain), options })
  };
  const result = manager.syncDomains({ elevate: true });
  assert.deepEqual(result.domains, ['api.test']);
  assert.equal(result.options.elevate, true);
  assert.equal(fs.existsSync(path.join(root, 'projects', 'workspaces', 'api')), true);
});

test('project start orders dependencies and stop reverses them', async t => {
  const { manager, calls, running } = fixture(t);
  const project = manager.create({ name: 'API', templateId: 'node-postgresql' });
  const started = await manager.start(project.id);
  assert.equal(started.success, true);
  assert.deepEqual(calls.filter(call => call.startsWith('start:')), ['start:postgresql', 'start:node']);
  assert.equal(running.has('node'), true);
  const stopped = await manager.stop(project.id);
  assert.equal(stopped.success, true);
  assert.deepEqual(calls.filter(call => call.startsWith('stop:')), ['stop:node', 'stop:postgresql']);
});

test('project manifests round-trip without copying runtime state', t => {
  const { manager, root } = fixture(t);
  const project = manager.create({ name: 'Site', templateId: 'static' });
  const manifest = manager.exportManifest(project.id);
  manager.remove(project.id);
  manifest.project.name = 'Imported Site';
  manifest.project.slug = 'imported-site';
  const imported = manager.importManifest(manifest, { root: path.join(root, 'imported') });
  assert.equal(imported.templateId, 'static');
  assert.equal(imported.domain, 'site.test');
  assert.equal(manager.list().length, 1);
});

test('external project directories are never deleted by metadata removal', t => {
  const { manager, root } = fixture(t);
  const external = path.join(root, 'external-project');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external, 'keep.txt'), 'keep');
  const project = manager.create({ name: 'External', root: external, createDirectory: false });
  const result = manager.remove(project.id, { deleteFiles: true });
  assert.equal(result.success, true);
  assert.equal(fs.existsSync(path.join(external, 'keep.txt')), true);
});

test('projects cannot silently overwrite a web server owned by another project', async t => {
  const { manager } = fixture(t);
  const first = manager.create({ name: 'First Site', templateId: 'php-nginx-postgresql' });
  const second = manager.create({ name: 'Second Site', templateId: 'php-nginx-postgresql' });
  assert.equal((await manager.start(first.id)).success, true);
  const result = await manager.start(second.id);
  assert.equal(result.success, false);
  assert.match(result.error, /already assigned/);
});

test('stopping a web project restores the previous server domain and document root', async t => {
  const { manager, config, root } = fixture(t);
  const originalRoot = path.join(root, 'www');
  fs.mkdirSync(originalRoot, { recursive: true });
  config.nginx.profiles[0].serverName = 'localhost';
  config.nginx.profiles[0].documentRoot = originalRoot;
  const project = manager.create({ name: 'Temporary Site', templateId: 'php-nginx-postgresql' });
  await manager.start(project.id);
  assert.equal(config.nginx.profiles[0].serverName, 'temporary-site.test');
  await manager.stop(project.id);
  assert.equal(config.nginx.profiles[0].serverName, 'localhost');
  assert.equal(path.resolve(config.nginx.profiles[0].documentRoot), path.resolve(originalRoot));
});

test('project manager persists and recovers an interrupted running state', async t => {
  const { root, manager, configManager, downloadManager, serviceManager } = fixture(t);
  const project = manager.create({ name: 'Recoverable API', templateId: 'node-postgresql' });
  await manager.start(project.id);
  const nextSession = new ProjectManager(root, configManager, downloadManager, serviceManager, new ActivityManager(root));
  const report = await nextSession.recover({ enabled: true });
  assert.deepEqual(report.interrupted, [project.id]);
  assert.equal(nextSession.get(project.id).state.status, 'interrupted');
  assert.match(nextSession.get(project.id).state.error, /previous session/i);
});

test('project environment profiles, encrypted secrets and lifecycle hooks work together', async t => {
  const { root, manager, calls } = fixture(t);
  const secretStore = new SecretStore(root, { externalKey: 'project-test-key' });
  const hooks = [];
  manager.setSecretStore(secretStore);
  manager.setHookRunner(async (_projectId, commandName, options) => {
    hooks.push(`${options.hookName}:${commandName}`);
    return { success: true };
  });
  const project = manager.create({
    name: 'Profiled API',
    templateId: 'node-postgresql',
    env: { SHARED_VALUE: 'base' },
    environmentProfiles: { development: { env: { PROFILE_VALUE: 'local' } } },
    activeEnvironment: 'development',
    commands: { prepare: 'node -e "process.exit(0)"', cleanup: 'node -e "process.exit(0)"' },
    hooks: { beforeStart: 'prepare', afterStop: 'cleanup' },
    tags: ['api', 'local']
  });
  assert.equal(manager.setSecrets(project.id, { DATABASE_PASSWORD: 'encrypted-value' }).success, true);
  assert.deepEqual(manager.listSecretKeys(project.id), ['DATABASE_PASSWORD']);
  assert.deepEqual(manager.resolveEnvironment(project.id, { includeSecrets: true }), {
    SHARED_VALUE: 'base', PROFILE_VALUE: 'local', DATABASE_PASSWORD: 'encrypted-value'
  });
  assert.equal(fs.readFileSync(path.join(root, 'config', 'secrets.json'), 'utf8').includes('encrypted-value'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project.root, 'kitsune.lock'), 'utf8')).environment, 'development');
  await manager.start(project.id);
  await manager.stop(project.id);
  assert.deepEqual(hooks, ['beforeStart:prepare', 'afterStop:cleanup']);
  assert.ok(calls.includes('start:node'));
  const removed = manager.remove(project.id);
  assert.equal(removed.success, true);
  assert.deepEqual(secretStore.keys(`project:${project.id}:env:`), []);
});
