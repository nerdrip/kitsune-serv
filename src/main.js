const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { execSync, execFileSync } = require('child_process');
const ConfigManager = require('./config-manager');
const DownloadManager = require('./download-manager');
const ServiceManager = require('./service-manager');
const DbViewer = require('./db-viewer');
const AppStoreManager = require('./app-store-manager');
const ActivityManager = require('./activity-manager');
const ProjectManager = require('./project-manager');
const DiagnosticsManager = require('./diagnostics-manager');
const DomainManager = require('./domain-manager');
const BackupManager = require('./backup-manager');
const SecretStore = require('./secret-store');
const CommandManager = require('./command-manager');
const EnvironmentManager = require('./environment-manager');
const PluginManager = require('./plugin-manager');
const PlatformManager = require('./platform-manager');
const TunnelManager = require('./tunnel-manager');
const UpdateManager = require('./update-manager');
const SupportManager = require('./support-manager');
const { initializeDesktopDataRoot } = require('./runtime-paths');
const { isPathInside, resolveInside, assertProjectSection, assertProjectName } = require('./path-utils');
const { PathManager } = require('./path-manager');

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// Keep mutable services, databases and projects outside the installed application.
// KITSUNE_DATA_DIR can be used to place large service data on another drive.
const { dataRoot: _appRoot, defaultsRoot: _defaultsRoot } = initializeDesktopDataRoot(app);
process.chdir(_appRoot);

let mainWindow;
let tray = null;
const configManager = new ConfigManager(_appRoot);
let downloadManager;
let serviceManager;
let appStoreManager;
let pathManager;
let activityManager;
let projectManager;
let diagnosticsManager;
let domainManager;
let backupManager;
let commandManager;
let environmentManager;
let pluginManager;
let platformManager;
let tunnelManager;
let updateManager;
let supportManager;
let quitInProgress = false;
let servicesStoppedForQuit = false;

function sendPythonManagerStatus(payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('path:pythonManagerStatus', payload);
  } catch {}
}

async function installOfficialPythonManager(automatic = false) {
  if (!pathManager) return { success: false, error: 'PATH manager is not ready' };
  const wasInstalled = pathManager.isOfficialPythonManagerInstalled();
  if (!wasInstalled) sendPythonManagerStatus({ stage: 'installing', automatic });
  const result = await pathManager.installOfficialPythonManager();
  sendPythonManagerStatus({
    stage: result?.success ? 'complete' : 'failed',
    automatic,
    alreadyInstalled: Boolean(result?.alreadyInstalled),
    error: result?.error || ''
  });
  return result;
}

async function quitAfterStoppingServices() {
  if (quitInProgress) return;
  quitInProgress = true;
  try {
    commandManager?.stopAll();
    tunnelManager?.stopAll();
    if (serviceManager) await serviceManager.stopAll();
  } catch (err) {
    console.warn('Could not stop every service during shutdown:', err.message);
  } finally {
    servicesStoppedForQuit = true;
    app.quit();
  }
}

function createWindow() {
  const general = configManager.getConfig().general || {};

  const appIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'KitsuneServ',
    backgroundColor: '#0f0f1a',
    show: false,
    icon: fs.existsSync(appIcon) ? appIcon : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    frame: false,
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!general.startMinimized && !process.argv.includes('--hidden')) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(parsed.toString());
    } catch {}
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

app.whenReady().then(() => {
  downloadManager = new DownloadManager({ appRoot: _appRoot, catalogRoot: _defaultsRoot });
  serviceManager = new ServiceManager(downloadManager, configManager);
  pathManager = new PathManager(downloadManager, configManager, {
    systemIntegrationDisabled: process.argv.includes('--smoke-test') || process.env.KITSUNE_SMOKE_TEST === '1'
  });
  activityManager = new ActivityManager(_appRoot);
  domainManager = new DomainManager(_appRoot);
  projectManager = new ProjectManager(_appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager);
  pluginManager = new PluginManager(_appRoot);
  projectManager.setTemplateProvider(() => pluginManager.projectTemplates());
  platformManager = new PlatformManager(_appRoot);
  tunnelManager = new TunnelManager(projectManager);
  updateManager = new UpdateManager(_appRoot, app.getVersion(), activityManager, { allowInstall: true });
  diagnosticsManager = new DiagnosticsManager(_appRoot, configManager, downloadManager, serviceManager, pathManager);
  commandManager = new CommandManager(projectManager, pathManager, activityManager, { allowDesktopIntegration: true, platformManager });
  commandManager.setToolProvider(() => pluginManager.tools());
  environmentManager = new EnvironmentManager(_appRoot, configManager, downloadManager, projectManager, pathManager, serviceManager);
  commandManager.onOutput = payload => { try { mainWindow?.webContents.send('command:output', payload); } catch {} };
  commandManager.onExit = payload => { try { mainWindow?.webContents.send('command:exit', payload); } catch {} };
  tunnelManager.onChanged = payload => { try { mainWindow?.webContents.send('tunnel:changed', payload); } catch {} };
  activityManager.on('changed', payload => {
    try { mainWindow?.webContents.send('activity:changed', payload); } catch {}
  });
  try {
    const selected = pathManager.getSelectedServices();
    if (selected.length || pathManager.hasManagedEntries()) pathManager.sync(selected);
  } catch (err) {
    console.warn('Could not synchronize the Windows user PATH:', err.message);
  }
  const secretStore = new SecretStore(_appRoot, {
    encrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Platform encryption unavailable');
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
  });
  global.dbViewer = new DbViewer(downloadManager, configManager, serviceManager, secretStore);
  backupManager = new BackupManager(_appRoot, configManager, downloadManager, global.dbViewer, activityManager);
  supportManager = new SupportManager(_appRoot, { configManager, downloadManager, serviceManager, diagnosticsManager, projectManager, activityManager, environmentManager, pluginManager, platformManager });
  const backupTimer = setInterval(() => backupManager.runDue().catch(error => console.warn('Scheduled backup warning:', error.message)), 60_000);
  if (typeof backupTimer.unref === 'function') backupTimer.unref();
  setTimeout(() => backupManager.runDue().catch(error => console.warn('Scheduled backup warning:', error.message)), 5_000);
  appStoreManager = new AppStoreManager(downloadManager, configManager, global.dbViewer, serviceManager);

  // Notify renderer when a service exits unexpectedly
  serviceManager._onServiceExit = (section, code) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('service:exited', { section, code });
      }
    } catch {}
  };

  createWindow();
  createTray();
  // Deterministic packaged-app probe used by release verification.
  if (process.argv.includes('--smoke-test') || process.env.KITSUNE_SMOKE_TEST === '1') {
    setTimeout(() => app.quit(), 1500);
  }
});

function createTray() {
  const generatedIcon = path.join(__dirname, '..', 'assets', 'icon.png');
  let icon = fs.existsSync(generatedIcon)
    ? nativeImage.createFromPath(generatedIcon).resize({ width: 16, height: 16 })
    : nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAk0lEQVQ4T2NkoBAwUqifYdAb8P9/' +
    'AwMDgyZQTAkoZkPILEZ0F4DEmRj+MzIx/GdYCnTFBKAcI5oBjP8Z/jNwMDD8nwA0YANSM7oB/xkYGBj+M0xg+M+4FMkQsg0A+R7d' +
    'ACSDJoCCkgGvAf8ZGBj+MzNwMPxnXIDsFYINAIUh0AUcDEz/4TGBHAb/GUBhSHEiAgBVgjARlH2MjgAAAABJRU5ErkJggg=='
    );
  tray = new Tray(icon);
  tray.setToolTip('KitsuneServ');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show KitsuneServ', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Start All', click: () => { if (mainWindow) mainWindow.webContents.send('tray:start-all'); } },
    { label: 'Stop All', click: async () => { if (serviceManager) await serviceManager.stopAll(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { void quitAfterStoppingServices(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') void quitAfterStoppingServices();
});

app.on('before-quit', (e) => {
  if (servicesStoppedForQuit || !serviceManager) return;
  e.preventDefault();
  void quitAfterStoppingServices();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== Config IPC =====
ipcMain.handle('config:get', () => configManager.getConfig());
ipcMain.handle('config:save', (_event, config) => {
  const previous = configManager.getConfig();
  const validation = serviceManager?.validateConfigChange(config);
  if (validation && !validation.success) return validation;
  const result = configManager.saveConfig(config);
  // Sync OS auto-start shortcut when autoStartOnBoot changes
  if (result.success) _syncAutoStartOnBoot(config?.general?.autoStartOnBoot);
  return syncPathForConfigTransition(previous, configManager.getConfig(), result);
});
ipcMain.handle('config:reset', () => {
  const previous = configManager.getConfig();
  const defaults = configManager.getDefaults();
  const validation = serviceManager?.validateConfigChange(defaults);
  if (validation && !validation.success) return validation;
  const result = configManager.saveConfig(defaults);
  return syncPathForConfigTransition(previous, configManager.getConfig(), result);
});
ipcMain.handle('config:getDefaults', () => configManager.getDefaults());
ipcMain.handle('config:getAppRoot', () => downloadManager.getAppRoot());

// ===== Auto-start on boot (Windows startup shortcut / Linux .desktop) =====
function _syncAutoStartOnBoot(enabled) {
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath, args: ['--hidden'] });
    } else if (process.platform === 'linux') {
      const autostartDir = path.join(process.env.HOME || '', '.config', 'autostart');
      const desktopPath = path.join(autostartDir, 'kitsuneserv.desktop');
      if (enabled) {
        if (!fs.existsSync(autostartDir)) fs.mkdirSync(autostartDir, { recursive: true });
        const exePath = app.isPackaged ? process.execPath : `${process.execPath} ${path.join(app.getAppPath(), 'src', 'main.js')}`;
        const desktop = `[Desktop Entry]\nType=Application\nName=KitsuneServ\nExec=${exePath}\nX-GNOME-Autostart-enabled=true`;
        fs.writeFileSync(desktopPath, desktop.replace(/\\n/g, '\n'), 'utf-8');
      } else {
        if (fs.existsSync(desktopPath)) fs.unlinkSync(desktopPath);
      }
    }
  } catch {}
}

// ===== Profile IPC =====
async function syncPathAfterChange(section, result) {
  if (!result?.success || !pathManager) return result;
  const pathResult = pathManager.syncIfSelected(section);
  return pathResult.success
    ? { ...result, pathUpdated: !pathResult.skipped, ...(pathResult.warning ? { pathWarning: pathResult.warning } : {}) }
    : { ...result, pathWarning: pathResult.error };
}

function syncPathForConfigTransition(previous, current, result) {
  if (!result?.success || !pathManager) return result;
  const pathResult = pathManager.syncForConfigTransition(previous, current);
  if (pathResult.skipped) return result;
  return pathResult.success
    ? { ...result, pathUpdated: true, ...(pathResult.warning ? { pathWarning: pathResult.warning } : {}) }
    : { ...result, pathWarning: pathResult.error };
}

ipcMain.handle('config:newProfile', async (_event, section, type, version, name) => {
  const config = configManager.getConfig();
  let profile;
  switch (section) {
    case 'apache':      profile = configManager.defaultApacheProfile(version); break;
    case 'nginx':       profile = configManager.defaultNginxProfile(version); break;
    case 'postgresql':  profile = configManager.defaultPostgresqlProfile(version); break;
    case 'mysql':       profile = configManager.defaultMysqlProfile(version); break;
    case 'mongodb':     profile = configManager.defaultMongodbProfile(version); break;
    case 'mariadb':     profile = configManager.defaultMariadbProfile(version); break;
    case 'php':         profile = configManager.defaultPhpProfile(version); break;
    case 'node':        profile = configManager.defaultNodeProfile(version); break;
    case 'go':          profile = configManager.defaultGoProfile(version); break;
    case 'bun':         profile = configManager.defaultBunProfile(version); break;
    case 'redis':       profile = configManager.defaultRedisProfile(version); break;
    case 'memcached':   profile = configManager.defaultMemcachedProfile(version); break;
    case 'python':      profile = configManager.defaultPythonProfile(version); break;
    case 'deno':        profile = configManager.defaultDenoProfile(version); break;
    case 'caddy':       profile = configManager.defaultCaddyProfile(version); break;
    case 'minio':       profile = configManager.defaultMinioProfile(version); break;
    default: return { success: false, error: 'Unknown section' };
  }
  if (name) profile.name = name;
  config[section].profiles.push(profile);
  const saved = configManager.saveConfig(config);
  if (!saved.success) return saved;
  const switched = await syncPathAfterChange(section, await serviceManager.switchProfile(section, profile.id));
  return { ...switched, profile, config: switched.config || configManager.getConfig() };
});

ipcMain.handle('config:renameProfile', (_event, section, profileId, newName) => {
  const config = configManager.getConfig();
  const svc = config[section];
  if (!svc) return { success: false, error: 'Unknown section' };
  const profile = svc.profiles.find(p => p.id === profileId);
  if (!profile) return { success: false, error: 'Profile not found' };
  profile.name = newName;
  configManager.saveConfig(config);
  return { success: true, config };
});

ipcMain.handle('config:deleteProfile', async (_event, section, profileId) => {
  let config = configManager.getConfig();
  let svc = config[section];
  if (!svc || svc.profiles.length <= 1) return { success: false, error: 'Cannot delete last profile' };
  if (!svc.profiles.some(profile => profile.id === profileId)) return { success: false, error: 'Profile not found' };
  if (svc.activeProfileId === profileId) {
    const replacement = svc.profiles.find(profile => profile.id !== profileId);
    const switched = await syncPathAfterChange(section, await serviceManager.switchProfile(section, replacement.id));
    if (!switched.success) return switched;
    config = configManager.getConfig();
    svc = config[section];
  }
  svc.profiles = svc.profiles.filter(p => p.id !== profileId);
  const saved = configManager.saveConfig(config);
  return saved.success ? { success: true, config: configManager.getConfig() } : saved;
});

ipcMain.handle('config:duplicateProfile', async (_event, section, profileId) => {
  const config = configManager.getConfig();
  const svc = config[section];
  if (!svc) return { success: false, error: 'Unknown section' };
  const source = svc.profiles.find(p => p.id === profileId);
  if (!source) return { success: false, error: 'Profile not found' };
  const clone = JSON.parse(JSON.stringify(source));
  clone.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  clone.name = source.name + ' (copy)';
  svc.profiles.push(clone);
  const saved = configManager.saveConfig(config);
  if (!saved.success) return saved;
  return syncPathAfterChange(section, await serviceManager.switchProfile(section, clone.id));
});

ipcMain.handle('config:setActiveProfile', async (_event, section, profileId) => syncPathAfterChange(section, await serviceManager.switchProfile(section, profileId)));

ipcMain.handle('config:setDocumentRoot', (_event, section, directory) => serviceManager.setDocumentRoot(section, directory));
ipcMain.handle('config:setGlobalDocumentRoot', (_event, enabled, directory) => serviceManager.setGlobalDocumentRoot(enabled, directory));

// ===== Download IPC =====
ipcMain.handle('download:getVersions', () => downloadManager.getVersionMap());
ipcMain.handle('download:catalog', () => downloadManager.getCatalog());
ipcMain.handle('download:refreshCatalog', () => downloadManager.refreshCatalog());
ipcMain.handle('download:status', () => downloadManager.getStatus());
ipcMain.handle('download:isInstalled', (_event, service, version) => downloadManager.isInstalled(service, version));
ipcMain.handle('download:installedVersions', (_event, service) => downloadManager.getInstalledVersions(service));
ipcMain.handle('download:install', async (_event, service, version) => {
  const result = await downloadManager.download(service, version, (progress) => {
    mainWindow?.webContents.send('download:progress', progress);
  });
  if (result.success) {
    if (service === 'python' && process.platform === 'win32') {
      mainWindow?.webContents.send('download:progress', { service, version, stage: 'python-manager', percent: 100 });
      const managerResult = await installOfficialPythonManager(true);
      if (!managerResult.success) result.pythonManagerWarning = managerResult.error;
      mainWindow?.webContents.send('download:progress', { service, version, stage: 'done', percent: 100 });
    }
    const pathResult = pathManager.syncIfSelected(service);
    if (!pathResult.success) result.pathWarning = pathResult.error;
  }
  return result;
});
ipcMain.handle('download:remove', async (_event, service, version) => {
  const config = configManager.getConfig();
  const referenced = config[service]?.profiles?.some(profile => profile.version === version);
  if (referenced) return { success: false, error: `${service} ${version} is used by a profile. Change or delete that profile first.` };
  const result = downloadManager.removeVersion(service, version);
  if (result.success && service === 'python') {
    const pathResult = pathManager.syncIfSelected('python');
    if (!pathResult.success) result.pathWarning = pathResult.error;
    if (downloadManager.getInstalledVersions('python').length === 0) {
      sendPythonManagerStatus({ stage: 'removing', automatic: true });
      const managerResult = await pathManager.uninstallOfficialPythonManagerIfUnused();
      sendPythonManagerStatus({
        stage: managerResult.removed ? 'removed' : (managerResult.success ? 'complete' : 'failed'),
        automatic: true,
        skipped: Boolean(managerResult.skipped),
        error: managerResult.error || ''
      });
      if (!managerResult.success) result.pythonManagerWarning = managerResult.error;
    }
  }
  return result;
});
ipcMain.handle('app:getInfo', () => ({ name: app.getName(), version: app.getVersion(), dataRoot: _appRoot, platform: process.platform, mode: 'desktop' }));

// ===== Service IPC =====
ipcMain.handle('service:start', async (_event, service) => serviceManager.startService(service));
ipcMain.handle('service:stop', (_event, service) => serviceManager.stopService(service));
ipcMain.handle('service:restart', async (_event, service) => {
  await serviceManager.stopService(service);
  return serviceManager.startService(service);
});
ipcMain.handle('service:switchVersion', async (_event, service, version) => syncPathAfterChange(service, await serviceManager.switchVersion(service, version)));
ipcMain.handle('service:status', (_event, service) => serviceManager.getServiceStatus(service));
ipcMain.handle('service:allStatuses', () => serviceManager.getAllStatuses());
ipcMain.handle('service:logs', (_event, service, lines) => serviceManager.getLogs(service, lines));
ipcMain.handle('service:clearLogs', (_event, service) => serviceManager.clearLogs(service));
ipcMain.handle('service:stopAll', () => serviceManager.stopAll());

// ===== Database Viewer IPC =====
ipcMain.handle('db:listDatabases', (_e, section) => global.dbViewer.listDatabases(section));
ipcMain.handle('db:listTables', (_e, section, database) => global.dbViewer.listTables(section, database));
ipcMain.handle('db:tableData', (_e, section, database, table, limit, offset) => global.dbViewer.tableData(section, database, table, limit, offset));
ipcMain.handle('db:executeQuery', (_e, section, database, query) => global.dbViewer.executeQuery(section, database, query));
ipcMain.handle('db:createDatabase', (_e, section, name) => global.dbViewer.createDatabase(section, name));
ipcMain.handle('db:dropDatabase', (_e, section, name) => global.dbViewer.dropDatabase(section, name));
ipcMain.handle('db:connections', () => global.dbViewer.listConnections());
ipcMain.handle('db:saveConnection', (_e, connection) => global.dbViewer.saveConnection(connection));
ipcMain.handle('db:removeConnection', (_e, id) => global.dbViewer.removeConnection(id));
ipcMain.handle('db:testConnection', (_e, connection) => global.dbViewer.testConnection(connection));
ipcMain.handle('db:listDatabasesFor', (_e, connection) => global.dbViewer.listDatabasesFor(connection));
ipcMain.handle('db:listTablesFor', (_e, connection, database) => global.dbViewer.listTablesFor(connection, database));
ipcMain.handle('db:executeQueryFor', (_e, connection, database, query) => global.dbViewer.executeQueryFor(connection, database, query));
ipcMain.handle('db:createDatabaseFor', (_e, connection, name) => global.dbViewer.createDatabaseFor(connection, name));
ipcMain.handle('db:dropDatabaseFor', (_e, connection, name) => global.dbViewer.dropDatabaseFor(connection, name));
ipcMain.handle('db:getToolUrl', async (_e, section, database) => {
  await appStoreManager.ensureAdminer();
  return appStoreManager.getDbToolUrl(section, database);
});

// ===== Shell IPC =====
ipcMain.handle('shell:openPath', (_event, targetPath) => {
  try {
    if (typeof targetPath !== 'string') throw new Error('Invalid path');
    const resolved = path.resolve(targetPath);
    const appRoot = downloadManager.getAppRoot();
    if (!isPathInside(appRoot, resolved)) throw new Error('Path outside app root');
    if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
    return shell.openPath(resolved).then(error => error ? { success: false, error } : { success: true });
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.handle('backup:list', (_event, filters) => backupManager.list(filters));
ipcMain.handle('backup:create', (_event, connection, database, options) => backupManager.create(connection, database, options));
ipcMain.handle('backup:verify', (_event, id) => backupManager.verify(id));
ipcMain.handle('backup:restore', (_event, id, connection, database) => backupManager.restore(id, connection, database));
ipcMain.handle('backup:remove', (_event, id) => backupManager.remove(id));
ipcMain.handle('backup:schedules', () => backupManager.schedules());
ipcMain.handle('backup:saveSchedule', (_event, schedule) => backupManager.saveSchedule(schedule));
ipcMain.handle('backup:removeSchedule', (_event, id) => backupManager.removeSchedule(id));
ipcMain.handle('backup:runDue', () => backupManager.runDue());

ipcMain.handle('shell:selectDirectory', async (_event, initialPath) => {
  const defaultPath = typeof initialPath === 'string' && initialPath.trim() && fs.existsSync(path.resolve(initialPath))
    ? path.resolve(initialPath)
    : downloadManager.getAppRoot();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose document root',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  });
  return result.canceled || !result.filePaths.length
    ? { success: false, canceled: true }
    : { success: true, path: result.filePaths[0] };
});

ipcMain.handle('shell:openExternal', (_event, url) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid URL');
    shell.openExternal(parsed.toString());
    return { success: true };
  } catch {
    return { success: false, error: 'Invalid URL' };
  }
});

ipcMain.handle('shell:openSystemSettings', async (_event, page) => {
  if (process.platform !== 'win32' || page !== 'appExecutionAliases') {
    return { success: false, error: 'This Windows settings page is not available' };
  }
  try {
    // Windows does not publish a stable URI for the App execution aliases
    // subpage. Open the documented Apps page and copy a localized search
    // phrase instead of silently falling back to the Settings home screen.
    clipboard.writeText('Aliasy wykonywania aplikacji');
    await shell.openExternal('ms-settings:appsfeatures');
    return {
      success: true,
      message: 'Opened Apps settings. Go to Advanced app settings → App execution aliases. Polish search text was copied to the clipboard.'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('projects:list', (_event, section) => {
  try {
    assertProjectSection(section);
    const projectsDir = resolveInside(path.resolve('projects'), section);
    if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
});

ipcMain.handle('projects:create', (_event, section, name) => {
  try {
    assertProjectSection(section);
    const safeName = assertProjectName(name);
    const projectDir = resolveInside(path.resolve('projects'), section, safeName);
    if (fs.existsSync(projectDir)) return { success: false, error: 'Project already exists' };
    fs.mkdirSync(projectDir, { recursive: false });
    return { success: true, path: projectDir };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('projects:delete', (_event, section, name) => {
  try {
    assertProjectSection(section);
    const safeName = assertProjectName(name);
    const projectDir = resolveInside(path.resolve('projects'), section, safeName);
    if (!fs.existsSync(projectDir)) return { success: false, error: 'Not found' };
    fs.rmSync(projectDir, { recursive: true, force: false });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== Project workspaces / stack orchestration =====
ipcMain.handle('workspace:templates', () => projectManager.templates());
ipcMain.handle('workspace:list', () => projectManager.list());
ipcMain.handle('workspace:get', (_event, id) => projectManager.get(id));
ipcMain.handle('workspace:create', (_event, options) => projectManager.create(options));
ipcMain.handle('workspace:update', (_event, id, patch) => projectManager.update(id, patch));
ipcMain.handle('workspace:remove', (_event, id, options) => projectManager.remove(id, options));
ipcMain.handle('workspace:start', (_event, id) => projectManager.start(id));
ipcMain.handle('workspace:stop', (_event, id) => projectManager.stop(id));
ipcMain.handle('workspace:export', (_event, id) => projectManager.exportManifest(id));
ipcMain.handle('workspace:import', (_event, manifest, options) => projectManager.importManifest(manifest, options));
ipcMain.handle('workspace:url', (_event, id) => ({ url: projectManager.getUrl(id) }));
ipcMain.handle('workspace:open', async (_event, id) => {
  const project = projectManager.get(id);
  const error = await shell.openPath(project.root);
  return error ? { success: false, error } : { success: true, path: project.root };
});

ipcMain.handle('activity:list', (_event, options) => activityManager.list(options));
ipcMain.handle('activity:cancel', (_event, id) => activityManager.cancel(id));
ipcMain.handle('activity:clear', () => activityManager.clearCompleted());

ipcMain.handle('diagnostics:doctor', (_event, projectId) => diagnosticsManager.doctor(projectId ? projectManager.get(projectId) : null));
ipcMain.handle('diagnostics:compatibility', (_event, projectId) => diagnosticsManager.compatibility(projectId ? projectManager.get(projectId) : null));
ipcMain.handle('diagnostics:ports', () => diagnosticsManager.ports());
ipcMain.handle('diagnostics:findFreePort', (_event, start, end) => diagnosticsManager.findFreePort(start, end));
ipcMain.handle('diagnostics:repair', (_event, issue) => diagnosticsManager.repair(issue));
ipcMain.handle('command:start', (_event, projectId, name, execution, distribution) => commandManager.start(projectId, name, execution, distribution));
ipcMain.handle('command:stop', (_event, id) => commandManager.stop(id));
ipcMain.handle('command:list', (_event, projectId) => commandManager.list(projectId));
ipcMain.handle('command:get', (_event, id) => commandManager.get(id));
ipcMain.handle('command:clear', () => commandManager.clearFinished());
ipcMain.handle('toolchain:list', () => commandManager.toolchains());
ipcMain.handle('ide:list', () => commandManager.ides());
ipcMain.handle('ide:open', (_event, projectId, ideId) => commandManager.openIDE(projectId, ideId));
ipcMain.handle('environment:export', (_event, label) => environmentManager.export(label));
ipcMain.handle('environment:inspect', (_event, payload) => environmentManager.inspect(payload));
ipcMain.handle('environment:apply', (_event, payload, options) => environmentManager.apply(payload, options));
ipcMain.handle('environment:createSnapshot', (_event, label) => environmentManager.createSnapshot(label));
ipcMain.handle('environment:listSnapshots', () => environmentManager.listSnapshots());
ipcMain.handle('environment:restoreSnapshot', (_event, id, options) => environmentManager.restoreSnapshot(id, options));
ipcMain.handle('environment:removeSnapshot', (_event, id) => environmentManager.removeSnapshot(id));
ipcMain.handle('plugin:list', () => pluginManager.list());
ipcMain.handle('plugin:install', (_event, directory) => pluginManager.install(directory));
ipcMain.handle('plugin:setEnabled', (_event, id, enabled) => pluginManager.setEnabled(id, enabled));
ipcMain.handle('plugin:remove', (_event, id) => pluginManager.remove(id));
ipcMain.handle('platform:inventory', () => platformManager.inventory());
ipcMain.handle('platform:wslPath', (_event, directory, distribution) => platformManager.toWslPath(directory, distribution));
ipcMain.handle('platform:installSystemd', (_event, options) => platformManager.installSystemdUserService(options));
ipcMain.handle('platform:removeSystemd', () => platformManager.removeSystemdUserService());
ipcMain.handle('tunnel:providers', () => tunnelManager.providers());
ipcMain.handle('tunnel:list', (_event, projectId) => tunnelManager.list(projectId));
ipcMain.handle('tunnel:start', (_event, projectId, provider) => tunnelManager.start(projectId, provider));
ipcMain.handle('tunnel:stop', (_event, id) => tunnelManager.stop(id));
ipcMain.handle('update:status', () => updateManager.status());
ipcMain.handle('update:check', () => updateManager.check());
ipcMain.handle('update:download', () => updateManager.download());
ipcMain.handle('update:install', () => {
  const result = updateManager.install();
  if (result.success && result.launched) setTimeout(() => void quitAfterStoppingServices(), 750);
  return result;
});
ipcMain.handle('support:generate', () => supportManager.generate());
ipcMain.handle('security:status', () => ({ mode: 'desktop', https: false, totpEnabled: false, apiTokenEnabled: false, allowlistEnabled: false, allowedRules: [], sessionCount: 0 }));
ipcMain.handle('security:sessions', () => []);
ipcMain.handle('security:revokeSession', () => ({ success: false, error: 'Web sessions exist only in server mode' }));
ipcMain.handle('security:revokeOtherSessions', () => ({ success: true, removed: 0 }));

ipcMain.handle('domain:status', () => domainManager.status(projectManager.list()));
ipcMain.handle('domain:apply', () => domainManager.apply(projectManager.list(), { elevate: true }));
ipcMain.handle('domain:certificateStatus', (_event, domain) => domainManager.certificateStatus(domain));
ipcMain.handle('domain:installCertificateAuthority', () => domainManager.installCertificateAuthority());
ipcMain.handle('domain:issueCertificate', (_event, domain) => domainManager.issueCertificate(domain));

// ===== Window IPC =====
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => {
  // Minimize to tray instead of closing
  if (tray && mainWindow) {
    mainWindow.hide();
  } else {
    mainWindow.close();
  }
});

// ===== Built-in Terminal IPC =====
const terminals = new Map(); // id -> { process, id }
let terminalIdCounter = 0;

function buildTerminalEnv() {
  return pathManager.buildEnvironment(process.env);
}

ipcMain.handle('terminal:create', () => {
  const id = ++terminalIdCounter;
  const env = buildTerminalEnv();
  const isWin = process.platform === 'win32';
  const shell = isWin ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
  const child = spawn(shell, [], {
    env,
    cwd: path.resolve('.'),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(isWin ? { windowsHide: true } : {})
  });

  terminals.set(id, { process: child, id });

  child.stdout.on('data', (data) => {
    mainWindow?.webContents.send('terminal:data', { id, data: data.toString() });
  });
  child.stderr.on('data', (data) => {
    mainWindow?.webContents.send('terminal:data', { id, data: data.toString() });
  });
  child.on('exit', (code) => {
    terminals.delete(id);
    mainWindow?.webContents.send('terminal:exit', { id, code });
  });

  return { id };
});

ipcMain.handle('terminal:write', (_event, id, data) => {
  const term = terminals.get(id);
  if (!term) return { success: false, error: 'Terminal not found' };
  if (typeof data !== 'string' || data.length > 65536) return { success: false, error: 'Invalid terminal input' };
  term.process.stdin.write(data);
  return { success: true };
});

ipcMain.handle('terminal:kill', (_event, id) => {
  const term = terminals.get(id);
  if (!term) return { success: false };
  try { term.process.kill(); } catch {}
  terminals.delete(id);
  return { success: true };
});

ipcMain.handle('terminal:resize', (_event, id, cols, rows) => {
  // Not applicable for cmd.exe pipe-based terminals, but accept for API compatibility
  return { success: true };
});

// ===== Composer IPC =====
ipcMain.handle('composer:getStatus', () => {
  const config = configManager.getConfig();
  const phpProfile = configManager.getActiveProfile(config, 'php');
  if (!phpProfile) return { installed: false, phpAvailable: false };
  const version = phpProfile.version;
  if (!downloadManager.isInstalled('php', version)) return { installed: false, phpAvailable: false };
  const phpPath = downloadManager.getInstallPath('php', version);
  const composerPath = path.join(phpPath, 'composer.phar');
  return { installed: fs.existsSync(composerPath), phpAvailable: true, phpPath };
});

ipcMain.handle('composer:install', async () => {
  const config = configManager.getConfig();
  const phpProfile = configManager.getActiveProfile(config, 'php');
  if (!phpProfile) return { success: false, error: 'No active PHP profile' };
  const version = phpProfile.version;
  if (!downloadManager.isInstalled('php', version)) return { success: false, error: 'PHP not installed' };
  const phpPath = downloadManager.getInstallPath('php', version);
  const isWin = process.platform === 'win32';
  const phpExe = path.join(phpPath, isWin ? 'php.exe' : 'bin/php');
  const composerPath = path.join(phpPath, 'composer.phar');
  const setupPath = path.join(phpPath, 'composer-setup.php');
  const signaturePath = `${setupPath}.sig`;
  try {
    await downloadManager._downloadFile('https://getcomposer.org/installer', setupPath);
    await downloadManager._downloadFile('https://composer.github.io/installer.sig', signaturePath);
    const expected = fs.readFileSync(signaturePath, 'utf-8').trim().toLowerCase();
    const actual = crypto.createHash('sha384').update(fs.readFileSync(setupPath)).digest('hex');
    if (!/^[a-f0-9]{96}$/.test(expected) || actual !== expected) throw new Error('Composer installer signature verification failed');
    execFileSync(phpExe, [setupPath, `--install-dir=${phpPath}`, '--filename=composer.phar'], { encoding: 'utf-8', timeout: 60000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    for (const tempPath of [setupPath, signaturePath]) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    }
  }
});

ipcMain.handle('composer:run', (_event, command, cwd) => {
  const config = configManager.getConfig();
  const phpProfile = configManager.getActiveProfile(config, 'php');
  if (!phpProfile) return { success: false, output: 'No active PHP profile' };
  const version = phpProfile.version;
  if (!downloadManager.isInstalled('php', version)) return { success: false, output: 'PHP not installed' };
  const phpPath = downloadManager.getInstallPath('php', version);
  const isWin = process.platform === 'win32';
  const phpExe = path.join(phpPath, isWin ? 'php.exe' : 'bin/php');
  const composerPhar = path.join(phpPath, 'composer.phar');
  if (!fs.existsSync(composerPhar)) return { success: false, output: 'Composer not installed. Install it first.' };
  // Split command into safe args array — no shell interpolation
  const args = command.trim().split(/\s+/).filter(Boolean);
  const allowedCmds = ['install', 'update', 'require', 'remove', 'dump-autoload', 'create-project', 'init', 'show', 'list', 'search', 'validate', 'status', 'self-update', 'config', 'run-script', 'exec', 'outdated', 'audit'];
  if (args.length > 0 && !allowedCmds.includes(args[0])) {
    return { success: false, output: `Command "${args[0]}" is not allowed. Allowed: ${allowedCmds.join(', ')}` };
  }
  try {
    const resolvedCwd = cwd ? path.resolve(cwd) : _appRoot;
    if (!isPathInside(_appRoot, resolvedCwd) || !fs.existsSync(resolvedCwd)) {
      return { success: false, output: 'Working directory must be inside the KitsuneServ data directory' };
    }
    const output = execFileSync(phpExe, [composerPhar, ...args], {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: resolvedCwd,
      env: { ...process.env, COMPOSER_HOME: path.join(phpPath, 'composer') }
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.stdout || err.stderr || err.message };
  }
});

// ===== PATH Management IPC =====
ipcMain.handle('path:getStatus', () => pathManager.getStatus());
ipcMain.handle('path:apply', (_event, services) => pathManager.apply(services));
ipcMain.handle('path:add', (_event, services) => pathManager.add(services));
ipcMain.handle('path:remove', (_event, services) => pathManager.remove(services));
ipcMain.handle('path:installPythonManager', () => installOfficialPythonManager(false));

// ===== Health Check IPC =====
const http = require('http');
const net = require('net');

ipcMain.handle('service:healthCheck', async (_event, section) => {
  const config = configManager.getConfig();
  const profile = configManager.getActiveProfile(config, section);
  if (!profile || !profile.port) return { healthy: false, error: 'No port configured' };
  const status = serviceManager.getServiceStatus(section);
  if (!status.running) return { healthy: false, error: 'Not running' };

  // HTTP health check for web servers and runtime services
  if (['apache', 'nginx', 'caddy', 'node', 'bun', 'go', 'python', 'deno'].includes(section)) {
    const start = Date.now();
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${profile.port}/`, { timeout: 3000 }, (res) => {
        resolve({ healthy: true, statusCode: res.statusCode, responseTime: Date.now() - start });
      });
      req.on('error', () => resolve({ healthy: false, error: 'Connection refused' }));
      req.on('timeout', () => { req.destroy(); resolve({ healthy: false, error: 'Timeout' }); });
    });
  }

  // TCP connection health check for databases and cache services
  if (['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'minio', 'php'].includes(section)) {
    const host = profile.host || '127.0.0.1';
    const port = profile.port;
    const start = Date.now();
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port, timeout: 3000 }, () => {
        socket.destroy();
        resolve({ healthy: true, responseTime: Date.now() - start });
      });
      socket.on('error', () => resolve({ healthy: false, error: 'Connection refused' }));
      socket.on('timeout', () => { socket.destroy(); resolve({ healthy: false, error: 'Timeout' }); });
    });
  }

  // Fallback: just check if the process is alive
  return { healthy: status.running, pid: status.pid };
});

// ===== Config Import/Export IPC =====
ipcMain.handle('config:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `kitsuneserv-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return { success: false };
  const config = configManager.getConfig();
  fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf-8');
  return { success: true, path: result.filePath };
});

ipcMain.handle('config:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return { success: false };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const imported = JSON.parse(raw);
    // Basic validation - must have at least one known section
    if (!imported.general && !imported.apache && !imported.nginx) {
      return { success: false, error: 'Invalid config file' };
    }
    const validation = serviceManager.validateConfigChange(imported);
    if (!validation.success) return validation;
    const previous = configManager.getConfig();
    const saved = configManager.saveConfig(imported);
    if (!saved.success) return saved;
    const current = configManager.getConfig();
    return { ...syncPathForConfigTransition(previous, current, { success: true }), config: current };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== Auto-start services on launch =====
ipcMain.handle('service:autoStart', async () => {
  const config = configManager.getConfig();
  const started = [];
  const sections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
  // Start ordering: databases → cache → php → web servers → runtimes
  const startPriority = { postgresql: 0, mysql: 0, mariadb: 0, mongodb: 0, redis: 1, memcached: 1, minio: 1, php: 2, apache: 3, nginx: 3, caddy: 3, node: 4, go: 4, bun: 4, python: 4, deno: 4 };
  sections.sort((a, b) => (startPriority[a] ?? 9) - (startPriority[b] ?? 9));
  for (const section of sections) {
    if (!config[section]?.enabled) continue;
    const profile = configManager.getActiveProfile(config, section);
    if (!profile) continue;
    // Per-service autoStart check
    if (!profile.autoStart) continue;
    const dlKey = section;
    if (!downloadManager.isInstalled(dlKey, profile.version)) continue;
    const result = await serviceManager.startService(section);
    if (result.success) started.push(section);
  }
  return { started };
});

// ===== Process Resource Usage IPC =====
ipcMain.handle('service:resourceUsage', async () => {
  const allStatuses = serviceManager.getAllStatuses();
  const result = {};
  const pids = [];
  const pidMap = {}; // pid -> section name

  for (const [section, status] of Object.entries(allStatuses)) {
    if (status.running && status.pid) {
      pids.push(status.pid);
      pidMap[status.pid] = section;
    }
  }

  if (pids.length === 0) return result;

  try {
    if (process.platform === 'win32') {
      const pidFilter = pids.map(p => `/FI "PID eq ${p}"`).join(' ');
      const output = execSync(`tasklist /FO CSV /NH ${pidFilter}`, { encoding: 'utf-8', timeout: 5000 });
      for (const line of output.split('\n')) {
        const match = line.match(/"[^"]*","(\d+)","[^"]*","[^"]*","([^"]*)"/);
        if (match) {
          const pid = parseInt(match[1]);
          const memStr = match[2].replace(/[^0-9]/g, '');
          const memKB = parseInt(memStr) || 0;
          const section = pidMap[pid];
          if (section) {
            result[section] = { memoryMB: Math.round(memKB / 1024 * 10) / 10, pid };
          }
        }
      }
    } else {
      // Linux/macOS: use ps
      for (const pid of pids) {
        try {
          const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8', timeout: 3000 }).trim();
          const memKB = parseInt(output) || 0;
          const section = pidMap[pid];
          if (section) {
            result[section] = { memoryMB: Math.round(memKB / 1024 * 10) / 10, pid };
          }
        } catch {}
      }
    }
  } catch {}

  return result;
});

// ===== Disk Usage per service =====
// ===== App Store IPC =====
ipcMain.handle('appStore:catalog', () => {
  return appStoreManager.getCatalogWithStatus();
});

ipcMain.handle('appStore:installed', () => appStoreManager.getInstalledApps());

ipcMain.handle('appStore:install', async (_event, appId, instanceName) => {
  return appStoreManager.install(appId, (progress) => {
    mainWindow?.webContents.send('appStore:progress', { appId, instanceName, ...progress });
  }, instanceName);
});

ipcMain.handle('appStore:remove', (_event, instanceName) => appStoreManager.remove(instanceName));

ipcMain.handle('appStore:getUrl', (_event, instanceName) => appStoreManager.getAppUrl(instanceName));

ipcMain.handle('appStore:getExePath', (_event, instanceName) => appStoreManager.getExePath(instanceName));

ipcMain.handle('appStore:addCustomApp', (_event, opts) => appStoreManager.addCustomApp(opts));

ipcMain.handle('appStore:removeCustomApp', (_event, appId) => appStoreManager.removeCustomApp(appId));

ipcMain.handle('appStore:checkRequirements', (_event, appId) => {
  return appStoreManager.checkRequirementsById(appId);
});

let _diskUsageCache = null;
let _diskUsageCacheTime = 0;
ipcMain.handle('download:diskUsage', () => {
  if (_diskUsageCache && Date.now() - _diskUsageCacheTime < 60000) return _diskUsageCache;
  const usage = {};
  const servicesDir = downloadManager.dataDir;
  try {
    const services = fs.readdirSync(servicesDir);
    for (const svc of services) {
      const svcPath = path.join(servicesDir, svc);
      if (!fs.statSync(svcPath).isDirectory()) continue;
      let totalBytes = 0;
      const walk = (dir) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else try { totalBytes += fs.statSync(full).size; } catch {}
          }
        } catch {}
      };
      walk(svcPath);
      if (totalBytes > 0) usage[svc] = Math.round(totalBytes / 1024 / 1024 * 10) / 10;
    }
  } catch {}
  _diskUsageCache = usage;
  _diskUsageCacheTime = Date.now();
  return usage; // { nginx: 12.3, php: 85.1, ... } in MB
});
ipcMain.handle('download:cacheStatus', () => downloadManager.cacheStatus());
ipcMain.handle('download:clearCache', (_event, service, version) => downloadManager.clearCache(service, version));
ipcMain.handle('download:exportCache', (_event, directory) => downloadManager.exportCache(directory));
ipcMain.handle('download:importCache', (_event, directory) => downloadManager.importCache(directory));
