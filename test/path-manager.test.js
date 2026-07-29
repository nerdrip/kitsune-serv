'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PathManager, normalizeEntry } = require('../src/path-manager');
const { SERVICE_IDS } = require('../src/path-utils');

const VERSIONS = Object.freeze({
  apache: '2.4.66', nginx: '1.30.4', caddy: '2.11.4', postgresql: '18.4',
  mysql: '8.4.10', mariadb: '12.3.2', mongodb: '8.0.6', php: '8.5.9',
  node: '24.18.0', go: '1.26.5', bun: '1.3.14', python: '3.14.3',
  deno: '2.9.4', redis: '8.8.1', memcached: '1.6.8', minio: 'latest'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MemoryConfigManager {
  constructor(initialized = true) {
    this.config = {
      general: { pathServices: [], pathSelectionInitialized: initialized }
    };
    for (const service of SERVICE_IDS) {
      const profile = { id: `${service}-active`, name: service, version: VERSIONS[service] };
      this.config[service] = { enabled: true, activeProfileId: profile.id, profiles: [profile] };
    }
  }

  getConfig() { return clone(this.config); }

  getActiveProfile(config, service) {
    return config[service]?.profiles.find(profile => profile.id === config[service].activeProfileId) || null;
  }

  saveConfig(config) {
    this.config = clone(config);
    return { success: true };
  }
}

class FakeDownloadManager {
  constructor(root) { this.dataDir = path.join(root, 'servers'); }

  getInstallPath(service, version) { return path.join(this.dataDir, service, version); }

  isInstalled(service, version) { return fs.existsSync(this.getInstallPath(service, version)); }

  getInstalledVersions(service) {
    const root = path.join(this.dataDir, service);
    return fs.existsSync(root) ? fs.readdirSync(root).filter(version => fs.statSync(path.join(root, version)).isDirectory()) : [];
  }
}

function createHarness(t, initialized = true, machinePath = '', managerOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = new MemoryConfigManager(initialized);
  const downloadManager = new FakeDownloadManager(root);
  let userPath = 'C:\\External Tools;C:\\Windows\\System32';
  let pythonManagerOwned = false;
  const env = { PATH: userPath, LOCALAPPDATA: path.join(root, 'local-app-data') };
  const manager = new PathManager(downloadManager, configManager, {
    platform: 'win32', env,
    readUserPath: () => userPath,
    readMachinePath: () => machinePath,
    writeUserPath: value => { userPath = value; },
    broadcast: () => true,
    readPythonManagerOwnership: () => pythonManagerOwned,
    writePythonManagerOwnership: value => { pythonManagerOwned = value; },
    ...managerOptions
  });
  return {
    root, manager, configManager, downloadManager, env,
    getUserPath: () => userPath,
    getPythonManagerOwned: () => pythonManagerOwned,
    setUserPath: value => { userPath = value; env.PATH = value; }
  };
}

function install(harness, service, version = VERSIONS[service], relative = '.') {
  const target = path.join(harness.downloadManager.getInstallPath(service, version), relative);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function normalizedEntries(manager, value) {
  return manager.split(value).map(entry => normalizeEntry(entry, 'win32'));
}

test('resolves nested Apache and PostgreSQL binary layouts', t => {
  const h = createHarness(t);
  const apacheBin = install(h, 'apache', VERSIONS.apache, 'Apache24/bin');
  const postgresBin = install(h, 'postgresql', VERSIONS.postgresql, 'pgsql/bin');

  assert.deepEqual(h.manager.getEntries(['apache']), [apacheBin]);
  assert.deepEqual(h.manager.getEntries(['postgresql']), [postgresBin]);
});

test('applies an exact service selection and preserves unrelated user PATH entries', t => {
  const h = createHarness(t);
  const apacheBin = install(h, 'apache', VERSIONS.apache, 'Apache24/bin');
  const nodeBin = install(h, 'node');
  const phpBin = install(h, 'php');

  const result = h.manager.apply(['node', 'php']);
  assert.equal(result.success, true);
  assert.deepEqual(result.selected, ['php', 'node']);
  const entries = normalizedEntries(h.manager, h.getUserPath());
  assert.ok(entries.includes(normalizeEntry(nodeBin, 'win32')));
  assert.ok(entries.includes(normalizeEntry(phpBin, 'win32')));
  assert.ok(!entries.includes(normalizeEntry(apacheBin, 'win32')));
  assert.match(h.getUserPath(), /C:\\External Tools/);
  assert.deepEqual(h.configManager.config.general.pathServices, ['php', 'node']);
  const unchanged = h.getUserPath();
  assert.equal(h.manager.apply(['node', '../outside']).success, false);
  assert.equal(h.getUserPath(), unchanged);
  h.manager._writeUserPathOverride = value => { h.setUserPath(value); return false; };
  const broadcastWarning = h.manager.apply(['node', 'php']);
  assert.equal(broadcastWarning.success, true);
  assert.match(broadcastWarning.warning, /could not broadcast/);
});

test('container mode exposes terminal binaries without changing the host PATH selection', t => {
  const h = createHarness(t, true, '', { systemIntegrationDisabled: true });
  install(h, 'node');
  const before = h.getUserPath();
  const applied = h.manager.apply(['node']);
  assert.equal(applied.success, false);
  assert.equal(h.getUserPath(), before);
  assert.deepEqual(h.configManager.config.general.pathServices, []);
  assert.equal(h.manager.getStatus().integrationDisabled, true);
  assert.ok(h.manager.buildEnvironment(h.env).PATH.includes(h.downloadManager.getInstallPath('node', VERSIONS.node)));
});

test('switching a selected runtime version replaces its old PATH entry immediately', t => {
  const h = createHarness(t);
  const oldNodeBin = install(h, 'node');
  const phpBin = install(h, 'php');
  assert.equal(h.manager.apply(['node', 'php']).success, true);

  const previousConfig = h.configManager.getConfig();
  const newVersion = '25.0.0';
  const newNodeBin = install(h, 'node', newVersion);
  h.configManager.config.node.profiles[0].version = newVersion;
  const result = h.manager.syncForConfigTransition(previousConfig, h.configManager.getConfig());

  assert.equal(result.success, true);
  const entries = normalizedEntries(h.manager, h.getUserPath());
  assert.ok(entries.includes(normalizeEntry(newNodeBin, 'win32')));
  assert.ok(entries.includes(normalizeEntry(phpBin, 'win32')));
  assert.ok(!entries.includes(normalizeEntry(oldNodeBin, 'win32')));
  assert.match(h.getUserPath(), /C:\\Windows\\System32/);
});

test('removes selected services individually or all at once', t => {
  const h = createHarness(t);
  const nodeBin = install(h, 'node');
  const phpBin = install(h, 'php');
  h.manager.apply(['node', 'php']);

  const partial = h.manager.remove(['php']);
  assert.equal(partial.success, true);
  let entries = normalizedEntries(h.manager, h.getUserPath());
  assert.ok(entries.includes(normalizeEntry(nodeBin, 'win32')));
  assert.ok(!entries.includes(normalizeEntry(phpBin, 'win32')));

  const all = h.manager.remove();
  assert.equal(all.success, true);
  entries = normalizedEntries(h.manager, h.getUserPath());
  assert.ok(!entries.includes(normalizeEntry(nodeBin, 'win32')));
  assert.match(h.getUserPath(), /C:\\External Tools/);
  assert.deepEqual(h.configManager.config.general.pathServices, []);
});

test('keeps uninstalled selections pending and adds them after installation', t => {
  const h = createHarness(t);
  const pending = h.manager.apply(['python']);
  assert.equal(pending.success, true);
  assert.deepEqual(pending.pending, ['python']);
  assert.deepEqual(h.configManager.config.general.pathServices, ['python']);

  const pythonBin = install(h, 'python');
  const synced = h.manager.syncIfSelected('python');
  assert.equal(synced.success, true);
  assert.ok(normalizedEntries(h.manager, h.getUserPath()).includes(normalizeEntry(pythonBin, 'win32')));
});

test('creates py and python3 launchers that follow the active managed Python', t => {
  const h = createHarness(t);
  const pythonDir = install(h, 'python');
  fs.writeFileSync(path.join(pythonDir, 'python.exe'), 'synthetic executable');

  const result = h.manager.apply(['python']);
  assert.equal(result.success, true);
  assert.equal(result.python.launcherAvailable, true);
  const pyLauncher = path.join(pythonDir, 'py.cmd');
  const pyPowerShellLauncher = path.join(pythonDir, 'kitsune-py-launcher.ps1');
  const python3Launcher = path.join(pythonDir, 'python3.cmd');
  assert.equal(fs.existsSync(pyLauncher), true);
  assert.equal(fs.existsSync(pyPowerShellLauncher), true);
  assert.equal(fs.existsSync(python3Launcher), true);
  assert.match(fs.readFileSync(pyLauncher, 'utf8'), /kitsune-py-launcher\.ps1/);
  assert.match(fs.readFileSync(pyLauncher, 'utf8'), /if "%~1"=="" goto run/);
  assert.match(fs.readFileSync(pyPowerShellLauncher, 'utf8'), /--list/);
  assert.match(fs.readFileSync(pyPowerShellLauncher, 'utf8'), /KitsuneServ Python runtimes/);
  assert.match(fs.readFileSync(python3Launcher, 'utf8'), /python\.exe/);

  const status = h.manager.getStatus();
  assert.equal(status.python.version, VERSIONS.python);
  assert.equal(status.python.launcherPath, pyLauncher);
  assert.equal(status.python.storeAliasConflict, false);
});

test('prefers the official Python Install Manager and registers KitsuneServ runtimes', t => {
  let registration = null;
  let defaultTag = '';
  const h = createHarness(t, true, '', {
    registerPythonRuntimes: (versions, activeVersion) => { registration = { versions, activeVersion }; },
    setPythonManagerDefault: value => { defaultTag = value; }
  });
  const pythonDir = install(h, 'python');
  fs.writeFileSync(path.join(pythonDir, 'python.exe'), 'synthetic executable');
  const windowsApps = path.join(h.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
  fs.mkdirSync(windowsApps, { recursive: true });
  fs.writeFileSync(path.join(windowsApps, 'pymanager.exe'), 'synthetic manager alias');

  const result = h.manager.apply(['python']);
  assert.equal(result.success, true);
  assert.equal(result.python.managerInstalled, true);
  assert.equal(result.python.launcherKind, 'official');
  assert.equal(result.python.integrationError, '');
  assert.deepEqual(registration, { versions: [VERSIONS.python], activeVersion: VERSIONS.python });
  assert.equal(defaultTag, `KitsuneServ/${VERSIONS.python}`);
  assert.equal(result.python.defaultTag, `KitsuneServ/${VERSIONS.python}`);
  assert.equal(fs.existsSync(path.join(pythonDir, 'py.cmd')), false);
  assert.equal(fs.existsSync(path.join(pythonDir, 'python3.cmd')), true);

  let smokeRegistrationTouched = false;
  const smoke = createHarness(t, true, '', {
    systemIntegrationDisabled: true,
    registerPythonRuntimes: () => { smokeRegistrationTouched = true; }
  });
  const smokePython = install(smoke, 'python');
  fs.writeFileSync(path.join(smokePython, 'python.exe'), 'synthetic executable');
  const smokeWindowsApps = path.join(smoke.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
  fs.mkdirSync(smokeWindowsApps, { recursive: true });
  fs.writeFileSync(path.join(smokeWindowsApps, 'pymanager.exe'), 'synthetic manager alias');
  const smokeStatus = smoke.manager.getStatus();
  assert.equal(smokeStatus.python.managerInstalled, true);
  assert.equal(smokeRegistrationTouched, false);
});

test('installs the official Python manager and replaces the fallback launcher', async t => {
  const h = createHarness(t, true, '', {
    registerPythonRuntimes: () => true,
    setPythonManagerDefault: () => true
  });
  const pythonDir = install(h, 'python');
  fs.writeFileSync(path.join(pythonDir, 'python.exe'), 'synthetic executable');
  h.manager.apply(['python']);
  assert.equal(fs.existsSync(path.join(pythonDir, 'py.cmd')), true);

  h.manager._installPythonManagerOverride = () => {
    const windowsApps = path.join(h.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
    fs.mkdirSync(windowsApps, { recursive: true });
    fs.writeFileSync(path.join(windowsApps, 'pymanager.exe'), 'synthetic manager alias');
    return { success: true };
  };
  const result = await h.manager.installOfficialPythonManager();
  assert.equal(result.success, true);
  assert.equal(result.python.managerInstalled, true);
  assert.equal(result.python.launcherKind, 'official');
  assert.equal(fs.existsSync(path.join(pythonDir, 'py.cmd')), false);
  assert.equal(h.getPythonManagerOwned(), true);

  fs.rmSync(pythonDir, { recursive: true, force: true });
  h.manager._uninstallPythonManagerOverride = () => {
    fs.rmSync(path.join(h.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pymanager.exe'), { force: true });
    return { success: true };
  };
  const removed = await h.manager.uninstallOfficialPythonManagerIfUnused();
  assert.equal(removed.success, true);
  assert.equal(removed.removed, true);
  assert.equal(h.getPythonManagerOwned(), false);
});

test('detects a machine PATH Windows Store alias that overrides managed Python', t => {
  const h = createHarness(t);
  const pythonDir = install(h, 'python');
  fs.writeFileSync(path.join(pythonDir, 'python.exe'), 'synthetic executable');
  const windowsApps = path.join(h.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps');
  fs.mkdirSync(windowsApps, { recursive: true });
  fs.writeFileSync(path.join(windowsApps, 'python.exe'), '');
  h.manager._readMachinePathOverride = () => `C:\\Windows\\System32;${windowsApps}`;

  h.manager.apply(['python']);
  const status = h.manager.getStatus();
  assert.equal(status.python.storeAliasConflict, true);
  assert.deepEqual(status.python.storeAliases, [path.join(windowsApps, 'python.exe')]);
});

test('migrates stale legacy entries and built-in terminal exposes all active binaries', t => {
  const h = createHarness(t, false);
  const oldNodeBin = install(h, 'node', '20.19.0');
  const activeNodeBin = install(h, 'node');
  const apacheBin = install(h, 'apache', VERSIONS.apache, 'Apache24/bin');
  h.setUserPath(`${oldNodeBin};C:\\External Tools`);

  assert.deepEqual(h.manager.getSelectedServices(), ['node']);
  assert.equal(h.manager.sync().success, true);
  const userEntries = normalizedEntries(h.manager, h.getUserPath());
  assert.ok(userEntries.includes(normalizeEntry(activeNodeBin, 'win32')));
  assert.ok(!userEntries.includes(normalizeEntry(oldNodeBin, 'win32')));

  const terminalEntries = normalizedEntries(h.manager, h.manager.buildEnvironment({ PATH: 'C:\\Windows' }).PATH);
  assert.ok(terminalEntries.includes(normalizeEntry(activeNodeBin, 'win32')));
  assert.ok(terminalEntries.includes(normalizeEntry(apacheBin, 'win32')));
});
