'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ConfigManager = require('../src/config-manager');
const ServiceManager = require('../src/service-manager');

class MemoryConfigManager {
  constructor(config) { this.config = structuredClone(config); }
  getConfig() { return structuredClone(this.config); }
  getActiveProfile(config, section) {
    const service = config[section];
    return service?.profiles?.find(profile => profile.id === service.activeProfileId) || service?.profiles?.[0] || null;
  }
  saveConfig(config) { this.config = structuredClone(config); return { success: true }; }
}

function stackConfig(root, phpVersion = '8.4.20') {
  const factory = new ConfigManager(root);
  const config = factory.getDefaults();
  const php = factory.getActiveProfile(config, 'php');
  const apache = factory.getActiveProfile(config, 'apache');
  const nginx = factory.getActiveProfile(config, 'nginx');
  php.version = phpVersion;
  php.port = 9123;
  apache.documentRoot = path.join(root, 'www');
  apache.port = 18080;
  apache.modProxyFcgi = true;
  nginx.documentRoot = path.join(root, 'www');
  nginx.port = 18081;
  nginx.phpEnabled = true;
  return config;
}

test('generates valid FastCGI wiring and only loads PHP extension files that exist', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-web-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = stackConfig(root);
  const configManager = new MemoryConfigManager(config);
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);

  const phpDir = path.join(root, 'php');
  fs.mkdirSync(path.join(phpDir, 'ext'), { recursive: true });
  const extensionFiles = process.platform === 'win32'
    ? ['php_curl.dll', 'php_mysqli.dll', 'php_opcache.dll']
    : ['curl.so', 'mysqli.so', 'opcache.so'];
  for (const file of extensionFiles) {
    fs.writeFileSync(path.join(phpDir, 'ext', file), 'test');
  }
  const phpProfile = configManager.getActiveProfile(configManager.getConfig(), 'php');
  manager._buildArgs('php', phpProfile, phpDir);
  const phpIni = fs.readFileSync(path.join(phpDir, 'php.ini'), 'utf8');
  assert.match(phpIni, process.platform === 'win32' ? /extension=php_curl\.dll/ : /extension=curl\.so/);
  assert.match(phpIni, process.platform === 'win32' ? /extension=php_mysqli\.dll/ : /extension=mysqli\.so/);
  assert.match(phpIni, process.platform === 'win32' ? /zend_extension=php_opcache\.dll/ : /zend_extension=opcache\.so/);
  assert.doesNotMatch(phpIni, /extension=(?:php_)?(?:bcmath|ctype|json)(?:\.dll)?/);
  assert.doesNotMatch(phpIni, /extension=(?:php_)?pgsql\.(?:dll|so)/);
  assert.match(phpIni, /cgi\.force_redirect = 0/);

  const apacheDir = path.join(root, 'apache');
  fs.mkdirSync(path.join(apacheDir, 'conf'), { recursive: true });
  const apacheBuild = manager._buildArgs('apache', configManager.getActiveProfile(configManager.getConfig(), 'apache'), apacheDir);
  const apacheConf = fs.readFileSync(path.join(apacheDir, 'conf', 'httpd.conf'), 'utf8');
  assert.match(apacheConf, /proxy:fcgi:\/\/127\.0\.0\.1:9123/);
  assert.match(apacheConf, /ProxyFCGIBackendType GENERIC/);
  assert.match(apacheConf, /ProxyFCGISetEnvIf/);
  if (process.platform === 'win32') assert.doesNotMatch(apacheConf, /LoadModule mpm_winnt_module/);
  assert.match(apacheConf, /Alias \/adminer/);
  assert.ok(apacheBuild.logFiles.includes(path.join(apacheDir, 'logs', 'error.log')));

  const wrappedApache = path.join(root, 'apache-release');
  fs.mkdirSync(path.join(wrappedApache, 'Apache24', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(wrappedApache, 'Apache24', 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd'), 'test');
  assert.equal(manager._resolveServiceHome(wrappedApache, 'apache'), path.join(wrappedApache, 'Apache24'));

  const nginxDir = path.join(root, 'nginx');
  fs.mkdirSync(path.join(nginxDir, 'conf'), { recursive: true });
  const nginxBuild = manager._buildArgs('nginx', configManager.getActiveProfile(configManager.getConfig(), 'nginx'), nginxDir);
  const nginxConf = fs.readFileSync(path.join(nginxDir, 'conf', 'nginx.conf'), 'utf8');
  assert.match(nginxConf, /fastcgi_pass\s+127\.0\.0\.1:9123/);
  assert.match(nginxConf, /SCRIPT_FILENAME \$document_root\$fastcgi_script_name/);
  assert.ok(nginxBuild.logFiles.includes(path.join(nginxDir, 'logs', 'error.log')));

  const caddyDir = path.join(root, 'caddy');
  fs.mkdirSync(caddyDir, { recursive: true });
  manager._buildArgs('caddy', configManager.getActiveProfile(configManager.getConfig(), 'caddy'), caddyDir);
  const caddyfile = fs.readFileSync(path.join(caddyDir, 'conf', 'Caddyfile'), 'utf8');
  assert.match(caddyfile, /php_fastcgi 127\.0\.0\.1:9123/);
});

test('tails server log files incrementally and clears the shared log buffer', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-log-tail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(stackConfig(root));
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  const errorLog = path.join(root, 'error.log');
  fs.writeFileSync(errorLog, 'old output\n');

  const tracker = manager._createLogTracker([errorLog]);
  const logs = [];
  manager.logs.set('nginx', logs);
  fs.appendFileSync(errorLog, 'new failure\n');
  manager._pollLogTracker(logs, tracker);

  assert.deepEqual(logs, ['[ERR][error.log] new failure\n']);
  assert.deepEqual(manager.clearLogs('nginx'), { success: true });
  assert.equal(logs.length, 0);

  fs.writeFileSync(errorLog, 'x\n');
  manager._pollLogTracker(logs, tracker);
  assert.match(logs.join(''), /Log rotated: error\.log/);
  assert.match(logs.join(''), /\[ERR\]\[error\.log\] x/);
});

test('stopAll waits for every managed service before completing shutdown', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-stop-all-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(stackConfig(root));
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  manager.processes.set('nginx', {});
  manager.processes.set('php', {});
  const stopped = [];
  manager.stopService = async section => {
    await new Promise(resolve => setTimeout(resolve, section === 'nginx' ? 15 : 5));
    stopped.push(section);
    manager.processes.delete(section);
    return { success: true };
  };

  const results = await manager.stopAll();
  assert.equal(results.length, 2);
  assert.deepEqual(new Set(stopped), new Set(['nginx', 'php']));
  assert.equal(manager.processes.size, 0);
  assert.equal(manager._stoppingAll, false);
});

test('PHP version switch restarts dependent web servers in dependency order', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-switch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(stackConfig(root));
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  manager.processes.set('php', {});
  manager.processes.set('apache', {});
  manager.processes.set('nginx', {});
  const events = [];
  manager.stopService = async section => { events.push(`stop:${section}`); manager.processes.delete(section); return { success: true }; };
  manager.startService = async section => { events.push(`start:${section}`); manager.processes.set(section, {}); return { success: true }; };

  const result = await manager.switchVersion('php', '8.5.9');
  assert.equal(result.success, true);
  assert.equal(configManager.getActiveProfile(configManager.getConfig(), 'php').version, '8.5.9');
  assert.deepEqual(events, [
    'stop:apache', 'stop:nginx', 'stop:php',
    'start:php', 'start:apache', 'start:nginx'
  ]);
  assert.deepEqual(result.restarted, ['php', 'apache', 'nginx']);
});

test('failed PHP switch restores the previous version and running stack', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-rollback-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(stackConfig(root));
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  manager.processes.set('php', {});
  manager.processes.set('apache', {});
  const events = [];
  manager.stopService = async section => { events.push(`stop:${section}`); manager.processes.delete(section); return { success: true }; };
  manager.startService = async section => {
    const version = configManager.getActiveProfile(configManager.getConfig(), 'php').version;
    events.push(`start:${section}:${version}`);
    if (section === 'php' && version === '8.5.9') return { success: false, error: 'synthetic startup failure' };
    manager.processes.set(section, {});
    return { success: true };
  };

  const result = await manager.switchVersion('php', '8.5.9');
  assert.equal(result.success, false);
  assert.equal(result.rolledBack, true);
  assert.equal(configManager.getActiveProfile(configManager.getConfig(), 'php').version, '8.4.20');
  assert.equal(manager.processes.has('php'), true);
  assert.equal(manager.processes.has('apache'), true);
  assert.deepEqual(events, [
    'stop:apache', 'stop:php', 'start:php:8.5.9',
    'start:php:8.4.20', 'start:apache:8.4.20'
  ]);
});

test('raw config save cannot bypass a running PHP stack switch', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-config-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(stackConfig(root));
  const manager = new ServiceManager({ isInstalled: () => true }, configManager);
  manager.processes.set('apache', {});
  manager.processes.set('php', {});
  const proposed = configManager.getConfig();
  configManager.getActiveProfile(proposed, 'php').version = '8.5.9';
  assert.equal(manager.validateConfigChange(proposed).success, false);
});
