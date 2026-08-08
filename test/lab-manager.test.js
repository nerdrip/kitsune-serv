'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const LabManager = require('../src/lab-manager');
const SecretStore = require('../src/secret-store');

function temporary(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('sidecar recipes persist and run as independently managed processes', async t => {
  const root = temporary(t, 'kitsune-lab-sidecar-');
  const source = path.join(root, 'api');
  fs.mkdirSync(source);
  const children = [];
  const manager = new LabManager(root, {}, {
    spawn: (_executable, _args, options) => {
      const child = new EventEmitter();
      child.pid = 4321;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => child.emit('exit', 0);
      child.options = options;
      children.push(child);
      return child;
    },
    platform: 'linux'
  });
  const lab = manager.create({ name: 'API test', recipeId: 'node-api', root: source, setupCommand: '', command: 'npm run dev', port: 4100, env: { TEST_MODE: 'yes' } });
  assert.equal((await manager.provision(lab.id)).success, true);
  const started = await manager.start(lab.id);
  assert.equal(started.success, true);
  assert.equal(manager.get(lab.id).status, 'running');
  assert.equal(children[0].options.env.PORT, '4100');
  assert.equal(children[0].options.env.TEST_MODE, 'yes');
  children[0].stdout.emit('data', 'ready\n');
  assert.match(manager.get(lab.id).output, /ready/);
  assert.equal(manager.stop(lab.id).success, true);
  assert.equal(manager.get(lab.id).status, 'stopped');
});

test('WordPress recipe live-mounts plugins and never deletes their sources', async t => {
  const root = temporary(t, 'kitsune-lab-wordpress-');
  const pluginRoot = temporary(t, 'kitsune-plugin-source-');
  fs.writeFileSync(path.join(pluginRoot, 'sample-plugin.php'), '<?php\n/* Plugin Name: Sample Plugin */\n');
  const wordpressRoot = path.join(root, 'www', 'apps', 'test-wordpress');
  fs.mkdirSync(path.join(wordpressRoot, 'wp-content', 'plugins'), { recursive: true });
  const phpRoot = path.join(root, 'services', 'php', '8.5');
  fs.mkdirSync(phpRoot, { recursive: true });
  fs.writeFileSync(path.join(phpRoot, process.platform === 'win32' ? 'php.exe' : 'php'), 'stub');
  const config = { php: { activeProfileId: 'php', profiles: [{ id: 'php', version: '8.5' }] } };
  const services = new Set();
  let executableCall = null;
  const secretStore = new SecretStore(root, { externalKey: 'lab-test-key' });
  const manager = new LabManager(root, {
    secretStore,
    serviceManager: {
      getServiceStatus: service => ({ running: services.has(service) }),
      startService: async service => { services.add(service); return { success: true }; }
    },
    configManager: {
      getConfig: () => config,
      getActiveProfile: (value, service) => value[service]?.profiles?.[0]
    },
    downloadManager: { getInstallPath: () => phpRoot },
    appStoreManager: {
      install: async (_app, _progress, instanceName) => {
        assert.match(instanceName, /^kitlab-/);
        return { success: true, path: wordpressRoot };
      },
      getAppUrl: () => 'http://localhost:8080/apps/test-wordpress/',
      remove: async () => ({ success: true })
    }
  }, {
    execFile: (executable, args, options, callback) => {
      executableCall = { executable, args, options };
      callback(null, 'KITSUNE_WORDPRESS_READY', '');
    }
  });
  const lab = manager.create({
    name: 'WordPress plugin', recipeId: 'wordpress-plugin', pluginPaths: [pluginRoot],
    wordpress: { webService: 'apache', databaseService: 'mysql', adminUser: 'tester', adminEmail: 'tester@example.test' }
  }, { adminPassword: 'secret-admin-password' });
  const result = await manager.provision(lab.id);
  assert.equal(result.success, true);
  const saved = manager.get(lab.id);
  assert.equal(saved.mounts.length, 1);
  assert.equal(fs.realpathSync(saved.mounts[0].target), fs.realpathSync(pluginRoot));
  assert.deepEqual([...services].sort(), ['apache', 'mysql', 'php']);
  assert.equal(executableCall.options.env.KITSUNE_WP_USER, 'tester');
  assert.equal(executableCall.options.env.KITSUNE_WP_PASSWORD, 'secret-admin-password');
  assert.match(executableCall.options.env.KITSUNE_WP_PLUGINS, /sample-plugin\.php/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'config', 'labs.json'), 'utf8'), /secret-admin-password/);
  assert.equal((await manager.remove(lab.id, { deleteInstance: false })).success, true);
  assert.equal(fs.existsSync(pluginRoot), true);
  assert.equal(fs.existsSync(path.join(pluginRoot, 'sample-plugin.php')), true);
});

test('visual blueprint mirrors dependencies and starts them before an API sidecar', async t => {
  const root = temporary(t, 'kitsune-lab-blueprint-');
  const source = path.join(root, 'api');
  fs.mkdirSync(source);
  const order = [];
  const children = [];
  let serviceRunning = false;
  const manager = new LabManager(root, {
    configManager: {
      getConfig: () => ({ postgresql: { profiles: [{ id: 'pg', name: 'PG dev', version: '18.4' }] } }),
      getActiveProfile: (config, service) => config[service]?.profiles?.[0]
    },
    downloadManager: { isInstalled: (service, version) => service === 'postgresql' && version === '18.4' },
    serviceManager: {
      getServiceStatus: () => ({ running: serviceRunning }),
      startService: async service => { serviceRunning = true; order.push(`service:${service}`); return { success: true }; }
    }
  }, {
    platform: 'linux',
    spawn: () => {
      order.push('sidecar');
      const child = new EventEmitter(); child.pid = 991; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
      children.push(child); return child;
    }
  });

  const input = { name: 'Orders API', recipeId: 'node-api', root: source, setupCommand: '', command: 'npm run dev', port: 4400, services: ['postgresql'] };
  const plan = manager.preview(input);
  assert.equal(plan.valid, true);
  assert.ok(plan.nodes.some(node => node.id === 'service:postgresql' && node.status === 'ready'));
  assert.ok(plan.connections.some(edge => edge.from === 'service:postgresql' && edge.to === 'runtime'));

  const lab = manager.create(input);
  assert.equal((await manager.provision(lab.id)).success, true);
  assert.equal((await manager.start(lab.id)).success, true);
  assert.deepEqual(order, ['service:postgresql', 'sidecar']);
  manager.stop(lab.id);
});
