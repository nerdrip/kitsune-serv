const { app, BrowserWindow, ipcMain, shell, clipboard, Tray, Menu, nativeImage, dialog, safeStorage, globalShortcut } = require('electron');
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
const IntegrationManager = require('./integration-manager');
const ProjectDetector = require('./project-detector');
const LabManager = require('./lab-manager');
const ApiFlowManager = require('./api-flow-manager');
const ObservabilityManager = require('./observability-manager');
const AutomationManager = require('./automation-manager');
const AuditManager = require('./audit-manager');
const IdentityManager = require('./identity-manager');
const HubManager = require('./hub-manager');
const { initializeDesktopDataRoot } = require('./runtime-paths');
const { isPathInside, resolveInside, assertProjectSection, assertProjectName } = require('./path-utils');
const { PathManager } = require('./path-manager');
const RemoteDevOpsManager = require('./remote-devops-manager');
const WorkspaceSuiteManager = require('./workspace-suite-manager');
const AdvancedOpsManager = require('./advanced-ops-manager');
const IncidentManager = require('./incident-manager');
const ResilienceManager = require('./resilience-manager');
const OperationsFabricManager = require('./operations-fabric-manager');
const EnterpriseOpsManager = require('./enterprise-ops-manager');
const NextgenOpsManager = require('./nextgen-ops-manager');
const OperationsWorkspaceManager = require('./operations-workspace-manager');
const TerminalFileProManager = require('./terminal-file-pro-manager');
const { TerminalFileVisionManager } = require('./terminal-file-vision-manager');
const { TerminalFileRuntimeManager } = require('./terminal-file-runtime-manager');
const { TerminalFileDeepManager } = require('./terminal-file-deep-manager');

const SAFE_MODE = process.argv.includes('--safe-mode') || process.env.KITSUNE_SAFE_MODE === '1';

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
function requestedPanel(argv = process.argv) {
  if (argv.includes('--open-file-manager')) return 'file-manager';
  if (argv.includes('--open-terminal')) return 'terminal';
  return '';
}

function showPanel(panel) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (panel) mainWindow.webContents.send('app:open-panel', panel);
}

app.on('second-instance', (_event, argv) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showPanel(requestedPanel(argv));
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
let integrationManager;
let projectDetector;
let labManager;
let apiFlowManager;
let observabilityManager;
let automationManager;
let auditManager;
let identityManager;
let hubManager;
let remoteAccessManager;
let remoteOperationsManager;
let portableToolsManager;
let cloudStorageManager;
let remoteDevOpsManager;
let workspaceSuiteManager;
let advancedOpsManager;
let incidentManager;
let resilienceManager;
let operationsFabricManager;
let enterpriseOpsManager;
let nextgenOpsManager;
let operationsWorkspaceManager;
let terminalFileProManager;
let terminalFileVisionManager;
let terminalFileRuntimeManager;
let terminalFileDeepManager;
let nodePty;
let quitInProgress = false;
let servicesStoppedForQuit = false;

async function auditOperation(action, target, operation, details = {}) {
  const started = Date.now();
  try {
    const result = await operation();
    auditManager?.record({ source: 'desktop-ipc', action, target, success: result?.success !== false, durationMs: Date.now() - started, details });
    nextgenOpsManager?.blackBoxRecord({ kind: 'desktop-operation', action, target, success: result?.success !== false, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    auditManager?.record({ source: 'desktop-ipc', action, target, success: false, durationMs: Date.now() - started, details: { ...details, error: error.message } });
    nextgenOpsManager?.blackBoxRecord({ kind: 'desktop-operation', action, target, success: false, durationMs: Date.now() - started });
    throw error;
  }
}

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
    remoteAccessManager?.stopAll();
    terminalFileDeepManager?.stopAll();
    tunnelManager?.stopAll();
    labManager?.stopAll();
    if (apiFlowManager) await apiFlowManager.stopAll();
    observabilityManager?.stop();
    if (projectManager) await projectManager.stopAll();
    if (serviceManager) await serviceManager.stopAll();
  } catch (err) {
    console.warn('Could not stop every service during shutdown:', err.message);
  } finally {
    try { projectManager?.markCleanShutdown(); } catch {}
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
    const panel = requestedPanel();
    if (panel) showPanel(panel);
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

app.whenReady().then(async () => {
  const RemoteAccessManager = require('./remote-access-manager');
  const RemoteOperationsManager = require('./remote-operations-manager');
  const PortableToolsManager = require('./portable-tools-manager');
  const CloudStorageManager = require('./cloud-storage-manager');
  nodePty = require('node-pty');
  downloadManager = new DownloadManager({ appRoot: _appRoot, catalogRoot: _defaultsRoot });
  serviceManager = new ServiceManager(downloadManager, configManager);
  pathManager = new PathManager(downloadManager, configManager, {
    systemIntegrationDisabled: SAFE_MODE || process.argv.includes('--smoke-test') || process.env.KITSUNE_SMOKE_TEST === '1'
  });
  activityManager = new ActivityManager(_appRoot);
  domainManager = new DomainManager(_appRoot);
  projectManager = new ProjectManager(_appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager);
  projectDetector = new ProjectDetector();
  pluginManager = new PluginManager(_appRoot);
  projectManager.setTemplateProvider(() => pluginManager.projectTemplates());
  platformManager = new PlatformManager(_appRoot);
  tunnelManager = new TunnelManager(projectManager);
  updateManager = new UpdateManager(_appRoot, app.getVersion(), activityManager, { allowInstall: true });
  diagnosticsManager = new DiagnosticsManager(_appRoot, configManager, downloadManager, serviceManager, pathManager, {
    domainManager,
    projectProvider: () => projectManager.list()
  });
  projectManager.setDiagnosticsManager(diagnosticsManager);
  const recovery = await projectManager.recover({ enabled: configManager.getConfig().general?.crashRecovery !== false, safeMode: SAFE_MODE });
  if (recovery.interrupted.length) console.warn(`Recovered ${recovery.interrupted.length} interrupted project state(s)${SAFE_MODE ? ' (safe mode: configuration restoration skipped)' : ''}.`);
  commandManager = new CommandManager(projectManager, pathManager, activityManager, { allowDesktopIntegration: true, platformManager });
  commandManager.setToolProvider(() => pluginManager.tools());
  environmentManager = new EnvironmentManager(_appRoot, configManager, downloadManager, projectManager, pathManager, serviceManager);
  commandManager.onOutput = payload => { try { mainWindow?.webContents.send('command:output', payload); } catch {} };
  commandManager.onExit = payload => { try { mainWindow?.webContents.send('command:exit', payload); } catch {} };
  tunnelManager.onChanged = payload => { try { mainWindow?.webContents.send('tunnel:changed', payload); } catch {} };
  activityManager.on('changed', payload => {
    try { mainWindow?.webContents.send('activity:changed', payload); } catch {}
  });
  if (!SAFE_MODE) {
    try {
      const selected = pathManager.getSelectedServices();
      if (selected.length || pathManager.hasManagedEntries()) pathManager.sync(selected);
    } catch (err) {
      console.warn('Could not synchronize the Windows user PATH:', err.message);
    }
  }
  const secretStore = new SecretStore(_appRoot, {
    encrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Platform encryption unavailable');
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64'))
  });
  integrationManager = new IntegrationManager(_appRoot, secretStore);
  remoteAccessManager = new RemoteAccessManager(_appRoot, secretStore);
  remoteOperationsManager = new RemoteOperationsManager(_appRoot, remoteAccessManager);
  remoteDevOpsManager = new RemoteDevOpsManager(remoteOperationsManager);
  workspaceSuiteManager = new WorkspaceSuiteManager(_appRoot, secretStore, remoteOperationsManager, remoteAccessManager);
  portableToolsManager = new PortableToolsManager(app.isPackaged ? path.join(process.resourcesPath, 'portable-tools', 'windows') : path.join(__dirname, '..', 'vendor', 'portable-tools', 'windows'));
  cloudStorageManager = new CloudStorageManager(_appRoot, secretStore);
  advancedOpsManager = new AdvancedOpsManager(_appRoot, remoteAccessManager, remoteOperationsManager, workspaceSuiteManager, cloudStorageManager);
  incidentManager = new IncidentManager(_appRoot, secretStore, remoteAccessManager, remoteOperationsManager, advancedOpsManager, workspaceSuiteManager);
  resilienceManager = new ResilienceManager(_appRoot, secretStore, remoteAccessManager, remoteOperationsManager);
  auditManager = new AuditManager(_appRoot);
  projectManager.setSecretStore(secretStore);
  projectManager.setHookRunner((projectId, commandName, options) => commandManager.runAndWait(projectId, commandName, options));
  commandManager.setIntegrationEnvironmentProvider(() => integrationManager.buildEnvironment());
  global.dbViewer = new DbViewer(downloadManager, configManager, serviceManager, secretStore);
  operationsFabricManager = new OperationsFabricManager(_appRoot, secretStore, remoteAccessManager, remoteOperationsManager, advancedOpsManager, incidentManager, resilienceManager, cloudStorageManager, global.dbViewer);
  enterpriseOpsManager = new EnterpriseOpsManager(_appRoot, { secretStore, remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, fabric: operationsFabricManager, dbViewer: global.dbViewer });
  nextgenOpsManager = new NextgenOpsManager(_appRoot, { secretStore, remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, resilience: resilienceManager, enterprise: enterpriseOpsManager });
  operationsWorkspaceManager = new OperationsWorkspaceManager(_appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, fabric: operationsFabricManager, incidents: incidentManager, nextgen: nextgenOpsManager, resilience: resilienceManager });
  terminalFileProManager = new TerminalFileProManager(_appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, operationsWorkspace: operationsWorkspaceManager, nextgen: nextgenOpsManager, secretStore });
  terminalFileVisionManager = new TerminalFileVisionManager(_appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, sshTunnel: tunnelManager, advanced: advancedOpsManager, secretStore });
  terminalFileRuntimeManager = new TerminalFileRuntimeManager(_appRoot, { remoteAccess: remoteAccessManager, portableTools: portableToolsManager, secretStore });
  terminalFileDeepManager = new TerminalFileDeepManager(_appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, cloudStorage: cloudStorageManager, terminalFilePro: terminalFileProManager, portableTools: portableToolsManager, secretStore, allowMount: true });
  const ephemeralCleanupTimer = setInterval(() => { if (!incidentManager?.hasActive()) operationsFabricManager.cleanupEphemeral(); }, 60_000);
  if (typeof ephemeralCleanupTimer.unref === 'function') ephemeralCleanupTimer.unref();
  if (!SAFE_MODE) { const syntheticTimer = setInterval(() => { if (!incidentManager?.hasActive()) operationsFabricManager.runDueSynthetics().catch(error => console.warn('Synthetic monitor warning:', error.message)); }, 60_000); if (typeof syntheticTimer.unref === 'function') syntheticTimer.unref(); }
  backupManager = new BackupManager(_appRoot, configManager, downloadManager, global.dbViewer, activityManager);
  supportManager = new SupportManager(_appRoot, { configManager, downloadManager, serviceManager, diagnosticsManager, projectManager, activityManager, environmentManager, pluginManager, platformManager });
  if (!SAFE_MODE) {
    const backupTimer = setInterval(() => { if (!incidentManager?.hasActive()) backupManager.runDue().catch(error => console.warn('Scheduled backup warning:', error.message)); }, 60_000);
    if (typeof backupTimer.unref === 'function') backupTimer.unref();
    setTimeout(() => { if (!incidentManager?.hasActive()) backupManager.runDue().catch(error => console.warn('Scheduled backup warning:', error.message)); }, 5_000);
    const workspaceScheduleTimer = setInterval(() => { if (!incidentManager?.hasActive()) workspaceSuiteManager.runDue().catch(error => console.warn('Workspace schedule warning:', error.message)); }, 60_000); if (typeof workspaceScheduleTimer.unref === 'function') workspaceScheduleTimer.unref();
    setTimeout(() => { if (!incidentManager?.hasActive()) workspaceSuiteManager.runDue().catch(error => console.warn('Workspace schedule warning:', error.message)); }, 7_500);
  }
  appStoreManager = new AppStoreManager(downloadManager, configManager, global.dbViewer, serviceManager);
  labManager = new LabManager(_appRoot, { appStoreManager, serviceManager, configManager, downloadManager, pathManager, secretStore, activityManager });
  labManager.onChanged = payload => { try { mainWindow?.webContents.send('lab:changed', payload); } catch {} };
  apiFlowManager = new ApiFlowManager(_appRoot, { dbViewer: global.dbViewer, secretStore });
  apiFlowManager.onChanged = payload => { try { mainWindow?.webContents.send('apiFlow:changed', payload); } catch {} };
  identityManager = new IdentityManager(_appRoot, secretStore);
  identityManager.bootstrap(process.env.KITSUNE_USER || 'admin', process.env.KITSUNE_PASS || crypto.randomBytes(24).toString('base64url'));
  hubManager = new HubManager(_appRoot, { identityManager, secretStore, projectManager, labManager, apiFlowManager, environmentManager });
  hubManager.onChanged = payload => { try { mainWindow?.webContents.send('hub:changed', payload); } catch {} };
  observabilityManager = new ObservabilityManager(_appRoot, serviceManager);
  automationManager = new AutomationManager(_appRoot, { serviceManager, projectManager, commandManager, labManager, backupManager, diagnosticsManager });
  observabilityManager.onChanged = payload => { try { mainWindow?.webContents.send('observability:changed', payload); } catch {} };
  automationManager.onChanged = payload => { try { mainWindow?.webContents.send('automation:changed', payload); } catch {} };
  if (!SAFE_MODE) {
    observabilityManager.start();
    const automationTimer = setInterval(() => { if (!incidentManager?.hasActive()) automationManager.runDue().catch(error => console.warn('Automation warning:', error.message)); }, 30000);
    automationTimer.unref?.();
  }

  // Notify renderer when a service exits unexpectedly
  serviceManager._onServiceExit = (section, code) => {
    observabilityManager?.recordServiceExit(section, code);
    auditManager?.record({ source: 'service-supervisor', action: code === 0 ? 'service.exit' : 'service.crash', target: section, success: code === 0, details: { exitCode: code } });
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('service:exited', { section, code });
      }
    } catch {}
  };

  if (process.argv.includes('--smoke-test') || process.env.KITSUNE_SMOKE_TEST === '1') {
    const probeExecutable = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : '/bin/sh';
    const probeArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'exit 0'] : ['-c', 'true'];
    const probe = nodePty.spawn(probeExecutable, probeArgs, { name: 'xterm-256color', cols: 20, rows: 4, cwd: _appRoot, env: buildTerminalEnv(), useConpty: process.platform === 'win32' });
    probe.onExit(() => {});
  }

  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+T', () => showPanel('terminal'));
  globalShortcut.register('CommandOrControl+Alt+F', () => showPanel('file-manager'));
  globalShortcut.register('CommandOrControl+Alt+O', () => showPanel('operations-center'));
  // Deterministic packaged-app probe used by release verification.
  if (process.argv.includes('--smoke-test') || process.env.KITSUNE_SMOKE_TEST === '1') {
    setTimeout(() => { servicesStoppedForQuit = true; app.quit(); }, 1500);
  }
}).catch(error => {
  console.error('KitsuneServ startup failed:', error);
  app.exit(1);
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
    { label: 'File Manager', click: () => showPanel('file-manager') },
    { label: 'Terminal', click: () => showPanel('terminal') },
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
ipcMain.handle('config:save', (_event, config) => auditOperation('config.save', 'application', () => {
  const previous = configManager.getConfig();
  const validation = serviceManager?.validateConfigChange(config);
  if (validation && !validation.success) return validation;
  const result = configManager.saveConfig(config);
  // Sync OS auto-start shortcut when autoStartOnBoot changes
  if (result.success) _syncAutoStartOnBoot(config?.general?.autoStartOnBoot);
  return syncPathForConfigTransition(previous, configManager.getConfig(), result);
}));
ipcMain.handle('config:reset', () => auditOperation('config.reset', 'application', () => {
  const previous = configManager.getConfig();
  const defaults = configManager.getDefaults();
  const validation = serviceManager?.validateConfigChange(defaults);
  if (validation && !validation.success) return validation;
  const result = configManager.saveConfig(defaults);
  return syncPathForConfigTransition(previous, configManager.getConfig(), result);
}));
ipcMain.handle('config:getDefaults', () => configManager.getDefaults());
ipcMain.handle('config:getAppRoot', () => downloadManager.getAppRoot());

// ===== Auto-start on boot (Windows startup shortcut / Linux .desktop) =====
function _syncAutoStartOnBoot(enabled) {
  if (SAFE_MODE) return;
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
  const progress = payload => mainWindow?.webContents.send('download:progress', payload);
  let result;
  if (service === 'python' && process.platform === 'win32') {
    progress({ service, version, stage: 'python-manager', percent: 5 });
    const managerResult = await installOfficialPythonManager(true);
    if (!managerResult.success) return { success: false, error: managerResult.error || 'Python Install Manager installation failed' };
    result = await pathManager.installPythonRuntime(version, progress);
  } else {
    result = await downloadManager.download(service, version, progress);
  }
  if (result.success) {
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
ipcMain.handle('app:getInfo', () => ({
  name: app.getName(), version: app.getVersion(), dataRoot: _appRoot, platform: process.platform, mode: 'desktop', safeMode: SAFE_MODE,
  capabilities: { hostTerminal: true, remoteShell: true, hostFiles: true, remoteFiles: true, nativeLaunch: true, nativeDesktop: true },
  initialPanel: requestedPanel(), migration: configManager.getMigrationInfo(), recovery: projectManager?.getRecoveryReport()
}));

// ===== Service IPC =====
ipcMain.handle('service:start', (_event, service) => auditOperation('service.start', service, () => serviceManager.startService(service)));
ipcMain.handle('service:stop', (_event, service) => auditOperation('service.stop', service, () => serviceManager.stopService(service)));
ipcMain.handle('service:restart', (_event, service) => auditOperation('service.restart', service, async () => {
  await serviceManager.stopService(service);
  return serviceManager.startService(service);
}));
ipcMain.handle('service:switchVersion', async (_event, service, version) => syncPathAfterChange(service, await serviceManager.switchVersion(service, version)));
ipcMain.handle('service:status', (_event, service) => serviceManager.getServiceStatus(service));
ipcMain.handle('service:allStatuses', () => serviceManager.getAllStatuses());
ipcMain.handle('service:logs', (_event, service, lines) => serviceManager.getLogs(service, lines));
ipcMain.handle('service:clearLogs', (_event, service) => serviceManager.clearLogs(service));
ipcMain.handle('service:stopAll', () => auditOperation('service.stop-all', 'all', () => serviceManager.stopAll()));

// ===== Database Viewer IPC =====
ipcMain.handle('db:listDatabases', (_e, section) => global.dbViewer.listDatabases(section));
ipcMain.handle('db:listTables', (_e, section, database) => global.dbViewer.listTables(section, database));
ipcMain.handle('db:tableData', (_e, section, database, table, limit, offset) => global.dbViewer.tableData(section, database, table, limit, offset));
ipcMain.handle('db:executeQuery', (_e, section, database, query) => auditOperation('database.execute', `${section}:${database}`, () => global.dbViewer.executeQuery(section, database, query)));
ipcMain.handle('db:createDatabase', (_e, section, name) => auditOperation('database.create', `${section}:${name}`, () => global.dbViewer.createDatabase(section, name)));
ipcMain.handle('db:dropDatabase', (_e, section, name) => auditOperation('database.drop', `${section}:${name}`, () => global.dbViewer.dropDatabase(section, name)));
ipcMain.handle('db:connections', () => global.dbViewer.listConnections());
ipcMain.handle('db:saveConnection', (_e, connection) => auditOperation('database.connection-save', connection?.id || connection?.name || 'new', () => global.dbViewer.saveConnection(connection)));
ipcMain.handle('db:removeConnection', (_e, id) => auditOperation('database.connection-remove', id, () => global.dbViewer.removeConnection(id)));
ipcMain.handle('db:testConnection', (_e, connection) => auditOperation('database.connection-test', connection?.id || connection?.name || connection?.type || 'connection', () => global.dbViewer.testConnection(connection)));
ipcMain.handle('db:listDatabasesFor', (_e, connection) => global.dbViewer.listDatabasesFor(connection));
ipcMain.handle('db:listTablesFor', (_e, connection, database) => global.dbViewer.listTablesFor(connection, database));
ipcMain.handle('db:listObjectsFor', (_e, connection, database) => global.dbViewer.listObjectsFor(connection, database));
ipcMain.handle('db:describeObjectFor', (_e, connection, database, schema, objectName) => global.dbViewer.describeObjectFor(connection, database, schema, objectName));
ipcMain.handle('db:tableDataFor', (_e, connection, database, table, limit, offset, schema) => global.dbViewer.tableDataFor(connection, database, table, limit, offset, schema));
ipcMain.handle('db:executeQueryFor', (_e, connection, database, query) => auditOperation('database.execute', `${connection?.id || connection?.type || 'connection'}:${database}`, () => global.dbViewer.executeQueryFor(connection, database, query)));
ipcMain.handle('db:executeWorkbench', (_e, connection, database, query, options) => auditOperation('database.workbench-execute', `${connection?.id || connection?.type || 'connection'}:${database}`, () => global.dbViewer.executeWorkbench(connection, database, query, options), { readOnly: options?.readOnly !== false, transaction: Boolean(options?.transaction), explain: Boolean(options?.explain) }));
ipcMain.handle('db:cancelQuery', (_e, id) => global.dbViewer.cancelQuery(id));
ipcMain.handle('db:activeQueries', () => global.dbViewer.listActiveQueries());
ipcMain.handle('db:queryHistory', (_e, limit) => global.dbViewer.queryHistory(limit));
ipcMain.handle('db:clearQueryHistory', () => auditOperation('database.history-clear', 'workbench', () => global.dbViewer.clearQueryHistory()));
ipcMain.handle('db:savedQueries', () => global.dbViewer.listSavedQueries());
ipcMain.handle('db:saveQuery', (_e, input) => auditOperation('database.saved-query-save', input?.id || input?.name || 'new', () => global.dbViewer.saveQuery(input)));
ipcMain.handle('db:removeSavedQuery', (_e, id) => auditOperation('database.saved-query-remove', id, () => global.dbViewer.removeSavedQuery(id)));
ipcMain.handle('db:createDatabaseFor', (_e, connection, name) => auditOperation('database.create', `${connection?.id || connection?.type || 'connection'}:${name}`, () => global.dbViewer.createDatabaseFor(connection, name)));
ipcMain.handle('db:dropDatabaseFor', (_e, connection, name) => auditOperation('database.drop', `${connection?.id || connection?.type || 'connection'}:${name}`, () => global.dbViewer.dropDatabaseFor(connection, name)));
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
ipcMain.handle('backup:create', (_event, connection, database, options) => auditOperation('backup.create', database, () => backupManager.create(connection, database, options)));
ipcMain.handle('backup:verify', (_event, id) => backupManager.verify(id));
ipcMain.handle('backup:restore', (_event, id, connection, database) => auditOperation('backup.restore', `${id}:${database}`, () => backupManager.restore(id, connection, database)));
ipcMain.handle('backup:remove', (_event, id) => auditOperation('backup.remove', id, () => backupManager.remove(id)));
ipcMain.handle('backup:schedules', () => backupManager.schedules());
ipcMain.handle('backup:saveSchedule', (_event, schedule) => auditOperation('backup.schedule-save', schedule?.id || schedule?.database || 'new', () => backupManager.saveSchedule(schedule)));
ipcMain.handle('backup:removeSchedule', (_event, id) => auditOperation('backup.schedule-remove', id, () => backupManager.removeSchedule(id)));
ipcMain.handle('backup:runDue', () => auditOperation('backup.run-due', 'scheduled', () => backupManager.runDue()));

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
const synchronizeWorkspaceMutation = result => {
  if (result?.success === false) return result;
  return { ...result, hostsSync: projectManager.syncDomains({ elevate: true }) };
};
ipcMain.handle('workspace:create', (_event, options) => auditOperation('workspace.create', options?.id || options?.name || 'new', () => synchronizeWorkspaceMutation(projectManager.create(options))));
ipcMain.handle('workspace:update', (_event, id, patch) => auditOperation('workspace.update', id, () => synchronizeWorkspaceMutation(projectManager.update(id, patch))));
ipcMain.handle('workspace:remove', (_event, id, options) => auditOperation('workspace.remove', id, () => synchronizeWorkspaceMutation(projectManager.remove(id, options))));
ipcMain.handle('workspace:start', (_event, id) => auditOperation('workspace.start', id, () => projectManager.start(id)));
ipcMain.handle('workspace:stop', (_event, id) => auditOperation('workspace.stop', id, () => projectManager.stop(id)));
ipcMain.handle('workspace:export', (_event, id) => projectManager.exportManifest(id));
ipcMain.handle('workspace:import', (_event, manifest, options) => auditOperation('workspace.import', manifest?.project?.id || manifest?.project?.name || 'manifest', () => synchronizeWorkspaceMutation(projectManager.importManifest(manifest, options))));
ipcMain.handle('workspace:detect', (_event, directory) => projectDetector.detect(directory));
ipcMain.handle('workspace:inspectCompose', (_event, file) => projectDetector.inspectCompose(file));
ipcMain.handle('workspace:inspectDevcontainer', (_event, file) => projectDetector.inspectDevcontainer(file));
ipcMain.handle('workspace:secretKeys', (_event, id) => projectManager.listSecretKeys(id));
ipcMain.handle('workspace:setSecrets', (_event, id, secrets) => auditOperation('workspace.secrets-update', id, () => projectManager.setSecrets(id, secrets), { keysChanged: Object.keys(secrets || {}).length }));
ipcMain.handle('workspace:environment', (_event, id) => projectManager.resolveEnvironment(id, { includeSecrets: false }));
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
ipcMain.handle('diagnostics:preflight', (_event, projectId) => diagnosticsManager.preflight(projectManager.get(projectId)));
ipcMain.handle('diagnostics:ports', () => diagnosticsManager.ports());
ipcMain.handle('diagnostics:findFreePort', (_event, start, end) => diagnosticsManager.findFreePort(start, end));
ipcMain.handle('diagnostics:repair', (_event, issue) => diagnosticsManager.repair(issue));
ipcMain.handle('diagnostics:repairAll', (_event, projectId) => diagnosticsManager.repairAll(projectId ? projectManager.get(projectId) : null));
ipcMain.handle('integration:list', () => integrationManager.list());
ipcMain.handle('integration:save', (_event, id, config, secrets) => auditOperation('integration.save', id, () => integrationManager.save(id, config, secrets), { secretFieldsChanged: Object.keys(secrets || {}).length }));
ipcMain.handle('integration:remove', (_event, id) => auditOperation('integration.remove', id, () => integrationManager.remove(id)));
ipcMain.handle('integration:test', (_event, id) => auditOperation('integration.test', id, () => integrationManager.test(id)));
ipcMain.handle('integration:readiness', (_event, category) => integrationManager.readiness(category));
ipcMain.handle('integration:assistant', (_event, prompt, context) => integrationManager.assistant(prompt, context));
ipcMain.handle('command:start', (_event, projectId, name, execution, distribution) => commandManager.start(projectId, name, execution, distribution));
ipcMain.handle('command:stop', (_event, id) => commandManager.stop(id));
ipcMain.handle('command:list', (_event, projectId) => commandManager.list(projectId));
ipcMain.handle('command:get', (_event, id) => commandManager.get(id));
ipcMain.handle('command:clear', () => commandManager.clearFinished());
ipcMain.handle('toolchain:list', () => commandManager.toolchains());
ipcMain.handle('toolchain:repair', (_event, id) => commandManager.repairTool(id, progress => {
  mainWindow?.webContents.send('download:progress', progress);
}));
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
ipcMain.handle('audit:list', (_event, options) => auditManager.list(options));
ipcMain.handle('audit:verify', () => auditManager.verify());

ipcMain.handle('domain:status', () => domainManager.status(projectManager.list()));
ipcMain.handle('domain:apply', () => projectManager.syncDomains({ elevate: true }));
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

function localShellProfiles() {
  const profiles = [];
  const add = (id, name, executable, args = []) => {
    try { const resolved = process.platform === 'win32' ? execFileSync('where.exe', [executable], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim() : executable; if (resolved) profiles.push({ id, name, executable: resolved, args }); } catch {}
  };
  if (process.platform === 'win32') {
    add('powershell', 'Windows PowerShell', 'powershell.exe', ['-NoLogo']);
    add('pwsh', 'PowerShell 7', 'pwsh.exe', ['-NoLogo']);
    add('cmd', 'Command Prompt', 'cmd.exe');
    add('wsl', 'WSL', 'wsl.exe');
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(fs.existsSync);
    if (gitBash) profiles.push({ id: 'git-bash', name: 'Git Bash', executable: gitBash, args: ['--login', '-i'] });
  } else {
    for (const [id, name, executable] of [['shell', 'Default shell', process.env.SHELL || '/bin/bash'], ['bash', 'Bash', '/bin/bash'], ['zsh', 'Zsh', '/bin/zsh']]) if (fs.existsSync(executable)) profiles.push({ id, name, executable, args: ['-l'] });
  }
  return profiles;
}

ipcMain.handle('terminal:profiles', () => localShellProfiles().map(({ executable, ...profile }) => profile));

ipcMain.handle('terminal:create', async (_event, connection = null) => {
  const id = ++terminalIdCounter;
  if (connection?.host || connection?.id) {
    try {
      const resolvedSession = remoteAccessManager.resolve(connection);
      if (resolvedSession.type === 'telnet' || resolvedSession.type === 'serial') {
        let executable; let args;
        if (resolvedSession.type === 'telnet') {
          if (process.platform === 'win32') { try { executable = execFileSync('where.exe', ['telnet.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); args = [resolvedSession.host, String(resolvedSession.port || 23)]; } catch { const bundled = portableToolsManager.verify('plink'); if (!bundled.valid) throw new Error('Bundled Plink failed SHA-256 verification'); executable = bundled.file; args = ['-telnet', resolvedSession.host, '-P', String(resolvedSession.port || 23)]; } }
          else { executable = fs.existsSync('/usr/bin/telnet') ? '/usr/bin/telnet' : '/usr/bin/nc'; args = [resolvedSession.host, String(resolvedSession.port || 23)]; }
        } else if (process.platform === 'win32') {
          if (!/^COM\d{1,3}$/i.test(resolvedSession.host)) throw new Error('Serial device must use a COM port such as COM3');
          executable = execFileSync('where.exe', ['powershell.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
          const script = `$p=New-Object System.IO.Ports.SerialPort '${resolvedSession.host.toUpperCase()}',${resolvedSession.baudRate || 115200},'None',8,'One';$p.Open();try{while($true){if($p.BytesToRead -gt 0){[Console]::Write($p.ReadExisting())};while([Console]::KeyAvailable){$k=[Console]::ReadKey($true);$p.Write([string]$k.KeyChar)};Start-Sleep -Milliseconds 10}}finally{$p.Close()}`;
          args = ['-NoLogo', '-NoProfile', '-Command', script];
        } else {
          if (!/^\/dev\/[A-Za-z0-9._/-]+$/.test(resolvedSession.host)) throw new Error('Invalid serial TTY device'); executable = '/usr/bin/picocom'; args = ['--baud', String(resolvedSession.baudRate || 115200), resolvedSession.host];
        }
        if (!executable || !fs.existsSync(executable)) throw new Error(`${resolvedSession.type === 'serial' ? 'picocom' : 'telnet'} client is not installed`);
        const child = nodePty.spawn(executable, args, { name: 'xterm-256color', cols: 120, rows: 32, cwd: path.resolve('.'), env: buildTerminalEnv(), useConpty: process.platform === 'win32' }); terminals.set(id, { process: child, id, localPty: true }); child.onData(data => { workspaceSuiteManager?.appendRecording(id, data); mainWindow?.webContents.send('terminal:data', { id, data }); }); child.onExit(({ exitCode }) => { terminals.delete(id); mainWindow?.webContents.send('terminal:exit', { id, code: exitCode }); });
        return { id, name: resolvedSession.name, remote: true, pty: true, sessionId: resolvedSession.id, protocol: resolvedSession.type };
      }
      const { client, session, release } = await remoteAccessManager.lease(connection, 'terminal');
      let stream; try { stream = await new Promise((resolve, reject) => client.shell({ term: 'xterm-256color', cols: 120, rows: 32 }, (error, value) => error ? reject(error) : resolve(value))); } catch (error) { release(); throw error; }
      terminals.set(id, { process: stream, client, release, id, remote: true });
      stream.on('data', data => { workspaceSuiteManager?.appendRecording(id, data.toString()); mainWindow?.webContents.send('terminal:data', { id, data: data.toString() }); });
      stream.stderr?.on('data', data => { workspaceSuiteManager?.appendRecording(id, data.toString()); mainWindow?.webContents.send('terminal:data', { id, data: data.toString() }); });
      stream.on('close', () => {
        terminals.delete(id);
        release();
        mainWindow?.webContents.send('terminal:exit', { id, code: 0 });
      });
      if (session.tmuxSession) stream.write(`tmux new-session -A -s ${session.tmuxSession}\r`);
      return { id, name: session.name, remote: true, pty: true, sessionId: session.id };
    } catch (error) { return { success: false, error: error.message }; }
  }
  const profileId = connection?.localProfile || '';
  const profiles = localShellProfiles();
  const profile = profiles.find(item => item.id === profileId) || profiles.find(item => item.id === 'pwsh') || profiles[0];
  if (!profile) return { success: false, error: 'No local shell is available' };
  const child = nodePty.spawn(profile.executable, profile.args, { name: 'xterm-256color', cols: 120, rows: 32, cwd: path.resolve('.'), env: buildTerminalEnv(), useConpty: process.platform === 'win32' });
  terminals.set(id, { process: child, id, localPty: true });
  child.onData(data => { workspaceSuiteManager?.appendRecording(id, data); mainWindow?.webContents.send('terminal:data', { id, data }); });
  child.onExit(({ exitCode }) => {
    terminals.delete(id);
    mainWindow?.webContents.send('terminal:exit', { id, code: exitCode });
  });
  return { id, name: profile.name, pty: true, profileId: profile.id };
});

ipcMain.handle('terminal:write', (_event, id, data) => {
  const term = terminals.get(id);
  if (!term) return { success: false, error: 'Terminal not found' };
  if (typeof data !== 'string' || data.length > 65536) return { success: false, error: 'Invalid terminal input' };
  if (term.remote || term.localPty) term.process.write(data);
  else term.process.stdin.write(data);
  return { success: true };
});

ipcMain.handle('terminal:kill', (_event, id) => {
  const term = terminals.get(id);
  if (!term) return { success: false };
  try { term.process.kill(); } catch {}
  try { term.release?.(); } catch {}
  terminals.delete(id);
  return { success: true };
});

ipcMain.handle('terminal:resize', (_event, id, cols, rows) => {
  const term = terminals.get(id);
  if (term?.remote && Number.isFinite(cols) && Number.isFinite(rows)) term.process.setWindow(rows, cols, 0, 0);
  if (term?.localPty && Number.isFinite(cols) && Number.isFinite(rows)) term.process.resize(cols, rows);
  return { success: true };
});
app.on('will-quit', () => globalShortcut.unregisterAll());
ipcMain.handle('update:rollback', () => { const result = updateManager.rollback(); if (result.success && result.launched) setTimeout(() => void quitAfterStoppingServices(), 750); return result; });
ipcMain.handle('terminal:record-start', (_event, id, metadata) => auditOperation('terminal.record-start', id, () => workspaceSuiteManager.startRecording(id, metadata)));
ipcMain.handle('terminal:record-stop', (_event, id) => auditOperation('terminal.record-stop', id, () => workspaceSuiteManager.stopRecording(id)));
ipcMain.handle('terminal:record-list', () => workspaceSuiteManager.listRecordings());
ipcMain.handle('terminal:record-export', async (_event, id, format) => { const exported = workspaceSuiteManager.exportRecording(id, format); const result = await dialog.showSaveDialog(mainWindow, { defaultPath: `terminal-${id}.${exported.extension}` }); if (result.canceled || !result.filePath) return { success: false, canceled: true }; fs.writeFileSync(result.filePath, exported.content, { mode: 0o600 }); return { success: true, filePath: result.filePath }; });

// ===== Remote sessions / two-pane file manager =====
ipcMain.handle('remote:list', () => remoteAccessManager.list());
ipcMain.handle('remote:save', (_event, input, secrets) => auditOperation('remote.save', input?.id || input?.host || 'new', () => remoteAccessManager.save(input, secrets)));
ipcMain.handle('remote:remove', (_event, id) => auditOperation('remote.remove', id, () => remoteAccessManager.remove(id)));
ipcMain.handle('remote:duplicate', (_event, id) => auditOperation('remote.duplicate', id, () => remoteAccessManager.duplicate(id)));
ipcMain.handle('remote:importProfiles', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: 'Import OpenSSH, WinSCP or KitsuneServ profiles', properties: ['openFile'], filters: [{ name: 'Connection profiles', extensions: ['ini', 'conf', 'config', 'txt', 'json'] }] }); if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true, imported: [] }; const file = result.filePaths[0]; return auditOperation('remote.import-profiles', path.basename(file), () => remoteAccessManager.importProfiles(fs.readFileSync(file, 'utf8'), path.extname(file).toLowerCase() === '.ini' ? 'winscp' : 'auto')); });
ipcMain.handle('remote:exportProfiles', async () => { const result = await dialog.showSaveDialog(mainWindow, { title: 'Export portable session bundle', defaultPath: 'kitsuneserv-sessions.json', filters: [{ name: 'KitsuneServ sessions', extensions: ['json'] }] }); if (result.canceled || !result.filePath) return { success: false, canceled: true }; fs.writeFileSync(result.filePath, remoteAccessManager.exportProfiles(), { mode: 0o600 }); auditManager?.record({ source: 'desktop-ipc', action: 'remote.export-profiles', target: path.basename(result.filePath), success: true }); return { success: true, filePath: result.filePath }; });
ipcMain.handle('portable:list', () => portableToolsManager.list());
ipcMain.handle('portable:launch', (_event, id) => auditOperation('portable.launch', id, () => portableToolsManager.launch(id, [])));
ipcMain.handle('remote:openWinScp', (_event, input) => auditOperation('portable.winscp', input?.id || input?.host || 'remote', () => { const session = remoteAccessManager.resolve(input); const host = session.host.includes(':') && !session.host.startsWith('[') ? `[${session.host}]` : session.host; const username = session.username ? `${encodeURIComponent(session.username)}@` : ''; const url = `sftp://${username}${host}:${session.port || 22}${session.remotePath || '/'}`; const args = ['/ini=nul', '/newinstance', url]; if (session.privateKeyPath) args.push(`/privatekey=${path.resolve(session.privateKeyPath)}`); if (session.hostFingerprint) args.push(`/hostkey=${session.hostFingerprint}`); return portableToolsManager.launch('winscp', args); }));
ipcMain.handle('remote:openPuTTY', (_event, input) => auditOperation('portable.putty', input?.id || input?.host || 'remote', () => { const session = remoteAccessManager.resolve(input); const target = session.username ? `${session.username}@${session.host}` : session.host; const args = ['-ssh', target, '-P', String(session.port || 22)]; if (session.privateKeyPath) args.push('-i', path.resolve(session.privateKeyPath)); return portableToolsManager.launch('putty', args); }));
ipcMain.handle('remote:resetHostKey', (_event, id) => auditOperation('remote.reset-host-key', id, () => remoteAccessManager.resetHostKey(id)));
ipcMain.handle('remote:test', async (_event, input) => {
  try { const { client } = await remoteAccessManager.connect(input); client.end(); return { success: true }; }
  catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('remote:diagnose', (_event, input) => auditOperation('remote.diagnose', input?.id || input?.host || 'remote', () => remoteAccessManager.diagnose(input)));
ipcMain.handle('remote:inspect', (_event, input, kind) => remoteOperationsManager.inspect(input, kind));
ipcMain.handle('remote:docker', (_event, input, action, target) => auditOperation(`remote.docker-${action}`, target, () => remoteOperationsManager.docker(input, action, target)));
ipcMain.handle('remote:systemd', (_event, input, action, unit) => auditOperation(`remote.systemd-${action}`, unit, () => remoteOperationsManager.systemd(input, action, unit)));
ipcMain.handle('remote:signal', (_event, input, pid, signal) => auditOperation(`remote.signal-${signal}`, String(pid), () => remoteOperationsManager.signal(input, pid, signal)));
ipcMain.handle('remote:archive', (_event, input, action, source, destination) => auditOperation(`remote.archive-${action}`, source, () => remoteOperationsManager.archive(input, action, source, destination)));
ipcMain.handle('remote:wake', (_event, mac, address, port) => auditOperation('remote.wake-on-lan', mac, () => remoteOperationsManager.wake(mac, address, port)));
ipcMain.handle('remote:deploy', (event, input, options) => auditOperation('remote.deploy', options?.remoteDirectory || '', () => remoteOperationsManager.deploy(input, options, progress => { if (!event.sender.isDestroyed()) event.sender.send('remote:deploy-progress', progress); })));
ipcMain.handle('devops:git', (_event, input, repository, action, options) => auditOperation(`devops.git-${action}`, repository, () => remoteDevOpsManager.git(input, repository, action, options)));
ipcMain.handle('devops:compose', (_event, input, directory, action, service) => auditOperation(`devops.compose-${action}`, directory, () => remoteDevOpsManager.compose(input, directory, action, service)));
ipcMain.handle('devops:kubernetes', (_event, input, action, options) => auditOperation(`devops.kubernetes-${action}`, options?.pod || options?.namespace || '', () => remoteDevOpsManager.kubernetes(input, action, options)));
ipcMain.handle('devops:metrics', (_event, input) => remoteDevOpsManager.metrics(input));
ipcMain.handle('devops:alerts', (_event, input, thresholds) => remoteDevOpsManager.alerts(input, thresholds));
ipcMain.handle('devops:http', (_event, request) => auditOperation('devops.http', request?.url || '', () => remoteDevOpsManager.httpRequest(request), { method: request?.method || 'GET' }));
ipcMain.handle('suite:capabilities', () => workspaceSuiteManager.capabilities());
ipcMain.handle('suite:vault-import', (_event, provider, reference, sessionId, options) => auditOperation('suite.vault-import', `${provider}:${sessionId}`, () => workspaceSuiteManager.importVaultSecret(provider, reference, sessionId, options)));
ipcMain.handle('suite:keys', () => workspaceSuiteManager.listKeys());
ipcMain.handle('suite:key-generate', (_event, input) => auditOperation('suite.key-generate', input?.name || 'new', () => workspaceSuiteManager.generateKey(input)));
ipcMain.handle('suite:key-remove', (_event, id) => auditOperation('suite.key-remove', id, () => workspaceSuiteManager.removeKey(id)));
ipcMain.handle('suite:key-install', (_event, connection, id) => auditOperation('suite.key-install', id, () => workspaceSuiteManager.installKey(connection, id)));
ipcMain.handle('suite:key-rotate', (_event, connection, id, passphrase) => auditOperation('suite.key-rotate', id, () => workspaceSuiteManager.rotateKey(connection, id, passphrase)));
ipcMain.handle('suite:snapshot', (_event, file) => auditOperation('suite.snapshot', file, () => workspaceSuiteManager.snapshotLocal(file)));
ipcMain.handle('suite:snapshots', () => workspaceSuiteManager.listSnapshots());
ipcMain.handle('suite:snapshot-restore', (_event, id) => auditOperation('suite.snapshot-restore', id, () => workspaceSuiteManager.restoreSnapshot(id)));
ipcMain.handle('suite:merge3', (_event, base, local, remote) => workspaceSuiteManager.merge3(base, local, remote));
ipcMain.handle('suite:state', () => workspaceSuiteManager.listState());
ipcMain.handle('suite:run-due', () => auditOperation('suite.run-due', 'schedules', () => workspaceSuiteManager.runDue()));
ipcMain.handle('suite:item-save', (_event, collection, input) => auditOperation(`suite.${collection}-save`, input?.id || input?.name || 'new', () => workspaceSuiteManager.saveItem(collection, input)));
ipcMain.handle('suite:item-remove', (_event, collection, id) => auditOperation(`suite.${collection}-remove`, id, () => workspaceSuiteManager.removeItem(collection, id)));
ipcMain.handle('suite:handoff-create', (_event, sessionId, recipient, ttl) => auditOperation('suite.handoff-create', sessionId, () => workspaceSuiteManager.createHandoff(sessionId, recipient, ttl)));
ipcMain.handle('suite:handoff-consume', (_event, id, token) => auditOperation('suite.handoff-consume', id, () => workspaceSuiteManager.consumeHandoff(id, token)));
ipcMain.handle('advanced:graph', () => advancedOpsManager.graph());
ipcMain.handle('advanced:commands', () => advancedOpsManager.commandCatalog());
ipcMain.handle('advanced:configuration', () => advancedOpsManager.configuration());
ipcMain.handle('advanced:workspaces', () => advancedOpsManager.listSmartWorkspaces());
ipcMain.handle('advanced:workspace-save', (_event, input) => auditOperation('advanced.workspace-save', input?.name || 'new', () => advancedOpsManager.saveSmartWorkspace(input)));
ipcMain.handle('advanced:search', (_event, query, options) => advancedOpsManager.globalSearch(query, options));
ipcMain.handle('advanced:replace-preview', (_event, query, replacement, options) => advancedOpsManager.replacePreview(query, replacement, options));
ipcMain.handle('advanced:replace-apply', (_event, preview, approved) => auditOperation('advanced.replace-apply', `${approved?.length || 0} files`, () => advancedOpsManager.replaceApply(preview, approved)));
ipcMain.handle('advanced:replace-rollback', (_event, id) => auditOperation('advanced.replace-rollback', id, () => advancedOpsManager.replaceRollback(id)));
ipcMain.handle('advanced:secret-scan', (_event, content, label) => advancedOpsManager.secretScan(content, label));
ipcMain.handle('advanced:preflight', (_event, input, options) => advancedOpsManager.preflight(input, options));
ipcMain.handle('advanced:infrastructure-capture', (_event, input) => advancedOpsManager.captureInfrastructure(input));
ipcMain.handle('advanced:infrastructure-diff', (_event, left, right) => advancedOpsManager.diffInfrastructure(left, right));
ipcMain.handle('advanced:baseline-set', (_event, input) => auditOperation('advanced.baseline-set', input?.id || input?.host || '', () => advancedOpsManager.setBaseline(input)));
ipcMain.handle('advanced:drift', (_event, input) => advancedOpsManager.checkDrift(input));
ipcMain.handle('advanced:blast-radius', (_event, input) => advancedOpsManager.blastRadius(input));
ipcMain.handle('advanced:digital-twin', (_event, capture, operation) => advancedOpsManager.digitalTwin(capture, operation));
ipcMain.handle('advanced:timeline', (_event, sessionId) => advancedOpsManager.timelineList(sessionId));
ipcMain.handle('advanced:timeline-record', (_event, input) => advancedOpsManager.timelineRecord(input));
ipcMain.handle('advanced:time-machine-capture', (_event, input, options) => auditOperation('advanced.time-machine-capture', input?.id || '', () => advancedOpsManager.timeMachineCapture(input, options)));
ipcMain.handle('advanced:time-machine-list', (_event, sessionId) => advancedOpsManager.listTimeMachine(sessionId));
ipcMain.handle('advanced:time-machine-restore', (_event, id, input, paths) => auditOperation('advanced.time-machine-restore', id, () => advancedOpsManager.timeMachineRestore(id, input, paths)));
ipcMain.handle('advanced:shadow-deploy', (event, input, options) => auditOperation('advanced.shadow-deploy', options?.liveLink || '', () => advancedOpsManager.shadowDeploy(input, options, progress => { if (!event.sender.isDestroyed()) event.sender.send('remote:deploy-progress', progress); })));
ipcMain.handle('advanced:shadow-promote', (_event, input, shadow) => auditOperation('advanced.shadow-promote', shadow?.releasePath || '', () => advancedOpsManager.promoteShadow(input, shadow)));
ipcMain.handle('advanced:replay-save', (_event, input) => advancedOpsManager.saveReplay(input));
ipcMain.handle('advanced:replay-run', (_event, id, input) => auditOperation('advanced.replay-run', id, () => advancedOpsManager.runReplay(id, input, { runbook: (session, runbookId, parameters) => remoteOperationsManager.runRunbook(session, runbookId, parameters) })));
ipcMain.handle('advanced:logs-correlate', (_event, sources) => advancedOpsManager.logCorrelate(sources));
ipcMain.handle('advanced:anomaly', (_event, samples) => advancedOpsManager.anomaly(samples));
ipcMain.handle('advanced:metric-record', (_event, sessionId, metrics) => advancedOpsManager.recordMetric(sessionId, metrics));
ipcMain.handle('advanced:anomaly-baseline', (_event, sessionId) => advancedOpsManager.anomalyBaseline(sessionId));
ipcMain.handle('advanced:explain', (_event, value) => advancedOpsManager.explainError(value));
ipcMain.handle('advanced:safe-command', (_event, kind, input) => advancedOpsManager.safeCommand(kind, input));
ipcMain.handle('advanced:health-save', (_event, input) => advancedOpsManager.saveHealthContract(input));
ipcMain.handle('advanced:health-evaluate', (_event, id) => advancedOpsManager.evaluateHealthContract(id));
ipcMain.handle('advanced:maintenance-save', (_event, input) => advancedOpsManager.saveMaintenanceWindow(input));
ipcMain.handle('advanced:maintenance-check', (_event, sessionId, operation, at) => advancedOpsManager.maintenanceAllowed(sessionId, operation, at ? new Date(at) : new Date()));
ipcMain.handle('advanced:dns', (_event, hostname) => advancedOpsManager.dnsInspect(hostname));
ipcMain.handle('advanced:dns-propagation', (_event, hostname, type) => advancedOpsManager.dnsPropagation(hostname, type));
ipcMain.handle('advanced:certificate', (_event, hostname, port) => advancedOpsManager.certificateInspect(hostname, port));
ipcMain.handle('incident:list', () => incidentManager.list());
ipcMain.handle('incident:start', (_event, input) => auditOperation('incident.start', input?.title || '', () => incidentManager.start(input)));
ipcMain.handle('incident:update', (_event, id, patch) => auditOperation('incident.update', id, () => incidentManager.update(id, patch)));
ipcMain.handle('incident:collect', (_event, id, input) => auditOperation('incident.collect', id, () => incidentManager.collect(id, input)));
ipcMain.handle('incident:capsule', (_event, id) => auditOperation('incident.capsule', id, () => incidentManager.capsule(id)));
ipcMain.handle('incident:suggest-runbook', (_event, id) => incidentManager.suggestRunbook(id));
ipcMain.handle('collab:start', (_event, input) => incidentManager.collaborationStart(input));
ipcMain.handle('collab:join', (_event, id, participant) => incidentManager.collaborationJoin(id, participant));
ipcMain.handle('collab:control', (_event, id, participantId, actorId) => incidentManager.transferControl(id, participantId, actorId));
ipcMain.handle('collab:lock', (_event, sessionId, filePath, participantId) => incidentManager.lockFile(sessionId, filePath, participantId));
ipcMain.handle('collab:event', (_event, id, participantId, value) => incidentManager.collaborationEvent(id, participantId, value));
ipcMain.handle('collab:events', (_event, id, since) => incidentManager.collaborationEvents(id, since));
ipcMain.handle('resilience:capabilities', () => resilienceManager.capabilities());
ipcMain.handle('resilience:ssh-ca-create', (_event, name, passphrase) => auditOperation('resilience.ssh-ca-create', name, () => resilienceManager.createSshCa(name, passphrase)));
ipcMain.handle('resilience:ssh-sign', (_event, caId, publicKeyPath, identity, principals, validity) => auditOperation('resilience.ssh-sign', identity, () => resilienceManager.signSshKey(caId, publicKeyPath, identity, principals, validity)));
ipcMain.handle('resilience:ssh-ca-install', (_event, input, caId) => auditOperation('resilience.ssh-ca-install', caId, () => resilienceManager.installSshCa(input, caId)));
ipcMain.handle('resilience:mosh', (_event, input) => auditOperation('resilience.mosh', input?.id || '', () => resilienceManager.openMosh(input)));
ipcMain.handle('resilience:ports', (_event, input) => resilienceManager.portInspect(input));
ipcMain.handle('resilience:db-tunnel', (_event, input, options) => auditOperation('resilience.db-tunnel', String(options?.remotePort || ''), () => resilienceManager.databaseTunnel(input, options)));
ipcMain.handle('resilience:cron', (_event, input, action, options) => auditOperation(`resilience.cron-${action}`, input?.id || '', () => resilienceManager.cron(input, action, options)));
ipcMain.handle('resilience:timer', (_event, input, action, options) => auditOperation(`resilience.timer-${action}`, options?.name || '', () => resilienceManager.systemdTimer(input, action, options)));
ipcMain.handle('resilience:firewall', async (_event, input, action, rule, execute) => { const plan = await resilienceManager.firewall(input, action, rule); if (action === 'status' || !execute) return action === 'status' ? plan : { success: true, preview: plan.preview }; return auditOperation(`resilience.firewall-${action}`, String(rule?.port || ''), () => plan.execute()); });
ipcMain.handle('resilience:certificate-renew', (_event, input, provider, domain) => auditOperation('resilience.certificate-renew', domain, () => resilienceManager.certificateRenew(input, provider, domain)));
ipcMain.handle('resilience:cache-put', (_event, file) => resilienceManager.cachePut(file));
ipcMain.handle('resilience:cache-restore', (_event, hash, target) => resilienceManager.cacheRestore(hash, target));
ipcMain.handle('resilience:transfer-limited', (_event, input, direction, local, remote, rate) => auditOperation('resilience.transfer-limited', remote, () => resilienceManager.transferLimited(input, direction, local, remote, rate)));
ipcMain.handle('resilience:backup', (_event, source, name) => auditOperation('resilience.deduplicated-backup', source, () => resilienceManager.deduplicatedBackup(source, name)));
ipcMain.handle('resilience:backup-restore', (_event, id, target) => auditOperation('resilience.deduplicated-restore', id, () => resilienceManager.restoreDeduplicated(id, target)));
ipcMain.handle('resilience:offline-vault', (_event, input) => auditOperation('resilience.offline-vault', 'export', () => resilienceManager.offlineVaultCreate(input)));
ipcMain.handle('resilience:break-glass-create', (_event, input) => auditOperation('resilience.break-glass-create', input?.sessionId || '', () => resilienceManager.breakGlassCreate(input)));
ipcMain.handle('resilience:break-glass-consume', (_event, id, code, authentication) => auditOperation('resilience.break-glass-consume', id, () => { const verified = identityManager.authenticate(authentication?.username, authentication?.password, authentication?.secondFactor); if (!verified.success) throw new Error(verified.error); return resilienceManager.breakGlassConsume(id, code, true); }));
ipcMain.handle('fabric:summary', () => operationsFabricManager.summary());
ipcMain.handle('fabric:policy-save', (_event, input) => auditOperation('fabric.policy-save', input?.name || 'new', () => operationsFabricManager.savePolicy(input)));
ipcMain.handle('fabric:policy-evaluate', (_event, context) => operationsFabricManager.evaluatePolicy(context));
ipcMain.handle('fabric:access-request', (_event, input = {}) => auditOperation('fabric.access-request', input.sessionId || '', () => { const authentication = input.authentication || {}; const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Authentication failed'); return operationsFabricManager.requestAccess({ ...input, authentication: undefined, mfaVerified: true, approvals: 1, approvedBy: [authentication.username] }); }));
ipcMain.handle('fabric:access-begin', (_event, input) => auditOperation('fabric.access-begin', input?.sessionId || '', () => operationsFabricManager.beginAccessRequest(input)));
ipcMain.handle('fabric:access-approve', (_event, requestId, authentication = {}) => auditOperation('fabric.access-approve', requestId, () => { const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Authentication failed'); return operationsFabricManager.approveAccessRequest(requestId, authentication.username, true); }));
ipcMain.handle('fabric:access-consume', (_event, token, scope) => auditOperation('fabric.access-consume', scope, () => operationsFabricManager.consumeAccess(token, scope)));
ipcMain.handle('fabric:secret-lease-create', (_event, input) => auditOperation('fabric.secret-lease-create', input?.reference || '', () => operationsFabricManager.createSecretLease(input), { scopes: input?.scopes || [] }));
ipcMain.handle('fabric:secret-lease-use', (_event, leaseId, input, environmentName, command) => auditOperation('fabric.secret-lease-use', leaseId, () => {
  const variable = String(environmentName || 'KITSUNE_SECRET'); if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(variable)) throw new Error('Invalid environment variable name'); const bounded = String(command || '').trim().slice(0, 8000); if (!bounded || /[\0\r\n]/.test(bounded)) throw new Error('A single-line remote command is required');
  return operationsFabricManager.consumeSecretLease(leaseId, 'remote-env', secret => { const encoded = Buffer.from(secret).toString('base64'); return remoteOperationsManager.exec(input, `${variable}=$(printf %s '${encoded}' | base64 -d); export ${variable}; (${bounded}); unset ${variable}`, 300000); });
}));
ipcMain.handle('fabric:service-map', (_event, input) => operationsFabricManager.serviceMap(input));
ipcMain.handle('fabric:gitops-export', (_event, capture, format, target) => auditOperation('fabric.gitops-export', target, () => operationsFabricManager.gitOpsExport(capture, format, target)));
ipcMain.handle('fabric:gitops-plan', (_event, observed, desired) => operationsFabricManager.gitOpsPlan(observed, desired));
ipcMain.handle('fabric:synthetic-save', (_event, input) => auditOperation('fabric.synthetic-save', input?.name || '', () => operationsFabricManager.saveSynthetic(input)));
ipcMain.handle('fabric:synthetic-run', (_event, id) => auditOperation('fabric.synthetic-run', id, () => operationsFabricManager.runSynthetic(id)));
ipcMain.handle('fabric:synthetic-run-due', () => operationsFabricManager.runDueSynthetics());
ipcMain.handle('fabric:canary-save', (_event, input) => auditOperation('fabric.canary-save', input?.name || '', () => operationsFabricManager.saveCanary(input)));
ipcMain.handle('fabric:canary-advance', (_event, id, metrics) => auditOperation('fabric.canary-advance', id, () => operationsFabricManager.advanceCanary(id, metrics)));
ipcMain.handle('fabric:network-record', (_event, input, options) => auditOperation('fabric.network-record', input?.id || '', () => operationsFabricManager.networkFlightRecorder(input, options)));
ipcMain.handle('fabric:offline-mount-save', (_event, input) => auditOperation('fabric.offline-mount-save', input?.name || '', () => operationsFabricManager.saveOfflineMount(input)));
ipcMain.handle('fabric:offline-stage', (_event, id, relativePath, content, baseHash) => operationsFabricManager.stageOfflineChange(id, relativePath, content, baseHash));
ipcMain.handle('fabric:offline-reconcile', (_event, id) => auditOperation('fabric.offline-reconcile', id, () => operationsFabricManager.reconcileOfflineMount(id)));
ipcMain.handle('fabric:db-schema-diff', (_event, left, right) => operationsFabricManager.databaseSchemaDiff(left, right));
ipcMain.handle('fabric:db-erd', (_event, schema) => operationsFabricManager.databaseErd(schema));
ipcMain.handle('fabric:db-mask', (_event, rows, rules) => operationsFabricManager.maskRows(rows, rules));
ipcMain.handle('fabric:db-schema-capture', (_event, connection, database) => operationsFabricManager.captureDatabaseSchema(connection, database));
ipcMain.handle('fabric:db-masked-export', (_event, connection, database, target, limit) => auditOperation('fabric.db-masked-export', database, () => operationsFabricManager.exportMaskedDatabase(connection, database, target, limit)));
ipcMain.handle('fabric:dr-simulate', (_event, backupId) => auditOperation('fabric.dr-simulate', backupId, () => operationsFabricManager.simulateDisaster(backupId)));
ipcMain.handle('fabric:ephemeral-save', (_event, input) => auditOperation('fabric.ephemeral-save', input?.name || '', () => operationsFabricManager.saveEphemeral(input)));
ipcMain.handle('fabric:ephemeral-cleanup', () => auditOperation('fabric.ephemeral-cleanup', 'expired', () => operationsFabricManager.cleanupEphemeral()));
ipcMain.handle('fabric:fleet-run', (_event, sessionIds, template, parameters, options) => auditOperation('fabric.fleet-run', `${sessionIds?.length || 0} servers`, () => operationsFabricManager.fleetRun(sessionIds, template, parameters, options), { template, batchSize: options?.batchSize }));
ipcMain.handle('fabric:remote-desktop-save', (_event, input) => auditOperation('fabric.remote-desktop-save', input?.name || '', () => operationsFabricManager.saveRemoteDesktop(input)));
ipcMain.handle('fabric:rescue-create', (_event, input) => auditOperation('fabric.rescue-create', input?.target || '', () => operationsFabricManager.rescueEnvironment(input)));
ipcMain.handle('fabric:evidence-seal', (_event, payload) => auditOperation('fabric.evidence-seal', payload?.kind || '', () => operationsFabricManager.sealEvidence(payload)));
ipcMain.handle('fabric:evidence-verify', (_event, id) => operationsFabricManager.verifyEvidence(id));
ipcMain.handle('fabric:copilot', (_event, context) => operationsFabricManager.localCopilot(context));
ipcMain.handle('fabric:replay-create', (_event, file) => auditOperation('fabric.replay-create', file, () => operationsFabricManager.createReplayLab(file)));
ipcMain.handle('fabric:replay-simulate', (_event, id, action) => operationsFabricManager.simulateReplay(id, action));

// ===== Enterprise operations / Kitsune Agent =====
ipcMain.handle('enterprise:summary', () => enterpriseOpsManager.summary());
ipcMain.handle('enterprise:configuration', () => enterpriseOpsManager.configuration());
ipcMain.handle('enterprise:agent-list', () => enterpriseOpsManager.listAgents());
ipcMain.handle('enterprise:agent-enroll', (_event, input) => auditOperation('enterprise.agent-enroll', input?.name || input?.endpoint || '', () => enterpriseOpsManager.enrollAgent(input)));
ipcMain.handle('enterprise:agent-remove', (_event, id) => auditOperation('enterprise.agent-remove', id, () => enterpriseOpsManager.removeAgent(id)));
ipcMain.handle('enterprise:agent-probe', (_event, id) => enterpriseOpsManager.probeAgent(id));
ipcMain.handle('enterprise:agent-bootstrap', (_event, input) => enterpriseOpsManager.agentBootstrap(input));
ipcMain.handle('enterprise:slo-save', (_event, input) => auditOperation('enterprise.slo-save', input?.name || '', () => enterpriseOpsManager.saveSlo(input)));
ipcMain.handle('enterprise:slo-record', (_event, id, sample) => enterpriseOpsManager.recordSlo(id, sample));
ipcMain.handle('enterprise:slo-evaluate', () => enterpriseOpsManager.evaluateSlos());
ipcMain.handle('enterprise:capacity-record', (_event, resource, value, at) => enterpriseOpsManager.recordCapacity(resource, value, at));
ipcMain.handle('enterprise:capacity-forecast', (_event, resource, limit) => enterpriseOpsManager.forecastCapacity(resource, limit));
ipcMain.handle('enterprise:patch-save', (_event, input) => auditOperation('enterprise.patch-save', input?.name || '', () => enterpriseOpsManager.savePatchPlan(input)));
ipcMain.handle('enterprise:patch-run', (_event, id, options) => auditOperation('enterprise.patch-run', id, () => enterpriseOpsManager.runPatchPlan(id, options)));
ipcMain.handle('enterprise:reboot-plan', (_event, input) => enterpriseOpsManager.planReboots(input));
ipcMain.handle('enterprise:reboot-run', (_event, id, options) => auditOperation('enterprise.reboot-run', id, () => enterpriseOpsManager.runReboots(id, options)));
ipcMain.handle('enterprise:compliance-save', (_event, input) => enterpriseOpsManager.saveComplianceBaseline(input));
ipcMain.handle('enterprise:compliance-scan', (_event, id, sessions) => auditOperation('enterprise.compliance-scan', id, () => enterpriseOpsManager.scanCompliance(id, sessions)));
ipcMain.handle('enterprise:supply-chain-scan', (_event, input) => enterpriseOpsManager.scanSupplyChain(input));
ipcMain.handle('enterprise:image-promote', (_event, input) => auditOperation('enterprise.image-promote', input?.digest || '', () => enterpriseOpsManager.promoteImage(input)));
ipcMain.handle('enterprise:airgap-create', (_event, input) => auditOperation('enterprise.airgap-create', input?.destination || '', () => enterpriseOpsManager.createAirgapBackup(input)));
ipcMain.handle('enterprise:airgap-verify', (_event, id) => enterpriseOpsManager.verifyAirgap(id));
ipcMain.handle('enterprise:oidc-save', (_event, input) => enterpriseOpsManager.saveOidcProfile(input));
ipcMain.handle('enterprise:oidc-login', (_event, id) => auditOperation('enterprise.oidc-login', id, () => enterpriseOpsManager.loginOidc(id)));
ipcMain.handle('enterprise:chaos-save', (_event, input) => enterpriseOpsManager.saveChaosExperiment(input));
ipcMain.handle('enterprise:chaos-run', (_event, id, options) => auditOperation('enterprise.chaos-run', id, () => enterpriseOpsManager.runChaos(id, options)));
ipcMain.handle('enterprise:remediation-save', (_event, input) => enterpriseOpsManager.saveRemediationRule(input));
ipcMain.handle('enterprise:autonomous-sandbox', (_event, context) => enterpriseOpsManager.autonomousSandbox(context));
ipcMain.handle('enterprise:migration-rehearse', (_event, connection, database, sql) => auditOperation('enterprise.migration-rehearse', database, () => enterpriseOpsManager.rehearseMigration(connection, database, sql)));
ipcMain.handle('enterprise:config-validate', (_event, input) => enterpriseOpsManager.validateConfig(input));
ipcMain.handle('enterprise:cloud-init', (_event, input) => auditOperation('enterprise.cloud-init', input?.hostname || '', () => enterpriseOpsManager.generateCloudInit(input)));
ipcMain.handle('enterprise:region-save', (_event, input) => enterpriseOpsManager.saveRegion(input));
ipcMain.handle('enterprise:failover-plan', (_event, fromId, toId) => enterpriseOpsManager.failoverPlan(fromId, toId));
ipcMain.handle('enterprise:marketplace-install', (_event, input) => auditOperation('enterprise.marketplace-install', input?.payload?.name || '', () => enterpriseOpsManager.installMarketplacePack(input)));

// ===== Next-generation operations =====
ipcMain.handle('nextgen:summary', () => nextgenOpsManager.summary());
ipcMain.handle('nextgen:configuration', () => nextgenOpsManager.configuration());
ipcMain.handle('nextgen:relay-save', (_event, input) => nextgenOpsManager.saveRelayNode(input));
ipcMain.handle('nextgen:relay-route', (_event, fromId, toId) => nextgenOpsManager.routeRelay(fromId, toId));
ipcMain.handle('nextgen:relay-bootstrap', (_event, input) => nextgenOpsManager.relayBootstrap(input));
ipcMain.handle('nextgen:capability-issue', (_event, input) => auditOperation('nextgen.capability-issue', input?.resource || '', () => nextgenOpsManager.issueCapability(input)));
ipcMain.handle('nextgen:capability-use', (_event, id, parameters) => auditOperation('nextgen.capability-use', id, () => nextgenOpsManager.useCapability(id, parameters)));
ipcMain.handle('nextgen:shell-parse', (_event, transcript) => nextgenOpsManager.parseShellTranscript(transcript));
ipcMain.handle('nextgen:delta-signature', (_event, file, blockSize) => nextgenOpsManager.deltaSignature(file, blockSize));
ipcMain.handle('nextgen:delta-plan', (_event, file, signature) => nextgenOpsManager.deltaPlan(file, signature));
ipcMain.handle('nextgen:delta-apply', (_event, source, destination, plan) => auditOperation('nextgen.delta-apply', destination, () => nextgenOpsManager.deltaApply(source, destination, plan)));
ipcMain.handle('nextgen:snapshot-create', (_event, input) => auditOperation('nextgen.snapshot-create', input?.source || '', () => nextgenOpsManager.createFilesystemSnapshot(input)));
ipcMain.handle('nextgen:snapshot-browse', (_event, id, prefix) => nextgenOpsManager.browseSnapshot(id, prefix));
ipcMain.handle('nextgen:snapshot-restore', (_event, id, relative, target) => auditOperation('nextgen.snapshot-restore', target, () => nextgenOpsManager.restoreSnapshotFile(id, relative, target)));
ipcMain.handle('nextgen:ransomware-baseline', (_event, root) => nextgenOpsManager.ransomwareBaseline(root));
ipcMain.handle('nextgen:ransomware-scan', (_event, root, thresholds) => nextgenOpsManager.ransomwareScan(root, thresholds));
ipcMain.handle('nextgen:desktop-save', (_event, input) => nextgenOpsManager.saveDesktopGateway(input));
ipcMain.handle('nextgen:ssh-policy-save', (_event, input) => nextgenOpsManager.saveSshCertificatePolicy(input));
ipcMain.handle('nextgen:ssh-certificate-issue', (_event, policyId, publicKey, identity, authentication = {}) => auditOperation('nextgen.ssh-certificate-issue', identity, () => { const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Fresh MFA authentication failed'); return nextgenOpsManager.issueSshCertificate(policyId, publicKey, identity, true); }));
ipcMain.handle('nextgen:ebpf', (_event, input, kind) => nextgenOpsManager.ebpfDiagnostics(input, kind));
ipcMain.handle('nextgen:network-twin', (_event, input) => nextgenOpsManager.networkDigitalTwin(input));
ipcMain.handle('nextgen:transaction', (_event, input, steps, options) => auditOperation('nextgen.remote-transaction', input?.id || '', () => nextgenOpsManager.remoteTransaction(input, steps, options)));
ipcMain.handle('nextgen:pair-create', (_event, input) => nextgenOpsManager.pairSession(input));
ipcMain.handle('nextgen:pair-propose', (_event, id, action, actor) => nextgenOpsManager.pairPropose(id, action, actor));
ipcMain.handle('nextgen:pair-approve', (_event, id, actor) => nextgenOpsManager.pairApprove(id, actor));
ipcMain.handle('nextgen:mobile-create', (_event, input) => nextgenOpsManager.createMobileApproval(input));
ipcMain.handle('nextgen:mobile-resolve', (_event, id, challenge, decision, authentication = {}) => { const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Fresh MFA authentication failed'); return nextgenOpsManager.resolveMobileApproval(id, challenge, decision, { verified: true, username: authentication.username }); });
ipcMain.handle('nextgen:wasm-run', (_event, input) => auditOperation('nextgen.wasm-run', input?.file || '', () => nextgenOpsManager.runWasm(input)));
ipcMain.handle('nextgen:blackbox-record', (_event, event) => nextgenOpsManager.blackBoxRecord(event));
ipcMain.handle('nextgen:blackbox-export', (_event, minutes) => nextgenOpsManager.exportBlackBox(minutes));
ipcMain.handle('nextgen:dna-capture', (_event, input) => nextgenOpsManager.captureServerDna(input));
ipcMain.handle('nextgen:dna-compare', (_event, left, right) => nextgenOpsManager.compareServerDna(left, right));
ipcMain.handle('nextgen:connectivity-heal', (_event, input) => nextgenOpsManager.selfHealConnectivity(input));
ipcMain.handle('nextgen:intent-plan', (_event, input) => nextgenOpsManager.planIntent(input));
ipcMain.handle('nextgen:simulator-create', (_event, input) => nextgenOpsManager.createFlightSimulator(input));
ipcMain.handle('nextgen:simulator-run', (_event, id, response) => nextgenOpsManager.runFlightSimulator(id, response));

// ===== Terminal & File Manager Operations Workspace =====
ipcMain.handle('opsWorkspace:summary', () => operationsWorkspaceManager.summary());
ipcMain.handle('opsWorkspace:configuration', () => operationsWorkspaceManager.configuration());
ipcMain.handle('opsWorkspace:save', (_event, input) => operationsWorkspaceManager.saveUniversalWorkspace(input));
ipcMain.handle('opsWorkspace:resume', (_event, id) => operationsWorkspaceManager.resumeWorkspace(id));
ipcMain.handle('opsWorkspace:timelineRecord', (_event, input) => operationsWorkspaceManager.recordCommandEffect(input));
ipcMain.handle('opsWorkspace:timeline', (_event, sessionId, options) => operationsWorkspaceManager.timeline(sessionId, options));
ipcMain.handle('opsWorkspace:undoPlan', (_event, id) => operationsWorkspaceManager.undoPlan(id));
ipcMain.handle('opsWorkspace:undoExecute', (_event, id, approved) => auditOperation('ops-workspace.undo', id, () => operationsWorkspaceManager.undoExecute(id, approved)));
ipcMain.handle('opsWorkspace:connectionDoctor', (_event, id) => operationsWorkspaceManager.connectionDoctor(id));
ipcMain.handle('opsWorkspace:smartTransfer', (_event, input) => operationsWorkspaceManager.smartTransferPlan(input));
ipcMain.handle('opsWorkspace:fleetPreview', (_event, ids, template, parameters, options) => operationsWorkspaceManager.fleetPreview(ids, template, parameters, options));
ipcMain.handle('opsWorkspace:fleetExecute', (_event, preview, approved) => auditOperation('ops-workspace.fleet', `${preview?.sessions?.length || 0} servers`, () => operationsWorkspaceManager.fleetExecute(preview, approved)));
ipcMain.handle('opsWorkspace:environmentDiff', (_event, left, right) => operationsWorkspaceManager.environmentDiff(left, right));
ipcMain.handle('opsWorkspace:disposableRescue', (_event, input) => operationsWorkspaceManager.createDisposableRescue(input));
ipcMain.handle('opsWorkspace:portableRescue', (_event, input) => operationsWorkspaceManager.createPortableRescueKit(input));
ipcMain.handle('opsWorkspace:memoryRecord', (_event, input) => operationsWorkspaceManager.recordMemory(input));
ipcMain.handle('opsWorkspace:memorySearch', (_event, query, sessionId) => operationsWorkspaceManager.searchMemory(query, sessionId));
ipcMain.handle('opsWorkspace:multiplexerSave', (_event, input) => operationsWorkspaceManager.saveMultiplexer(input));
ipcMain.handle('opsWorkspace:autocomplete', (_event, input) => operationsWorkspaceManager.policyAutocomplete(input));
ipcMain.handle('opsWorkspace:incidentRoom', (_event, input) => auditOperation('ops-workspace.incident-room', input?.title || '', () => operationsWorkspaceManager.createIncidentRoom(input)));
ipcMain.handle('opsWorkspace:collaborativeChange', (_event, input) => operationsWorkspaceManager.collaborativeFileChange(input));
ipcMain.handle('opsWorkspace:movie', (_event, sessionId, options) => operationsWorkspaceManager.infrastructureMovie(sessionId, options));
ipcMain.handle('opsWorkspace:blastRadius', (_event, sessionId, operation) => operationsWorkspaceManager.liveBlastRadius(sessionId, operation));
ipcMain.handle('opsWorkspace:networkReplayCreate', (_event, input) => operationsWorkspaceManager.createNetworkReplay(input));
ipcMain.handle('opsWorkspace:networkReplayRun', (_event, id, response) => operationsWorkspaceManager.runNetworkReplay(id, response));
ipcMain.handle('opsWorkspace:palettePlan', (_event, input) => operationsWorkspaceManager.commandPalettePlan(input));
ipcMain.handle('opsWorkspace:secretless', (_event, sessionId) => operationsWorkspaceManager.secretlessReadiness(sessionId));

// ===== Terminal & File Manager Pro =====
ipcMain.handle('terminalFilePro:summary', () => terminalFileProManager.summary());
ipcMain.handle('terminalFilePro:configuration', () => terminalFileProManager.configuration());
ipcMain.handle('terminalFilePro:notebookSave', (_event, input) => terminalFileProManager.saveNotebook(input));
ipcMain.handle('terminalFilePro:notebook', (_event, id) => terminalFileProManager.notebook(id));
ipcMain.handle('terminalFilePro:pasteAnalyze', (_event, value) => terminalFileProManager.analyzePaste(value));
ipcMain.handle('terminalFilePro:translate', (_event, input) => terminalFileProManager.translateShell(input));
ipcMain.handle('terminalFilePro:sidecar', (_event, sessionId) => terminalFileProManager.sidecar(sessionId));
ipcMain.handle('terminalFilePro:shadow', (_event, sessionId, template, parameters, options) => auditOperation('terminal.shadow', sessionId, () => terminalFileProManager.shadowCommand(sessionId, template, parameters, options)));
ipcMain.handle('terminalFilePro:checkpointSave', (_event, input) => terminalFileProManager.saveCheckpoint(input));
ipcMain.handle('terminalFilePro:checkpointRestore', (_event, id) => terminalFileProManager.restoreCheckpoint(id));
ipcMain.handle('terminalFilePro:resultMatrix', (_event, results) => terminalFileProManager.resultMatrix(results));
ipcMain.handle('terminalFilePro:outputActions', (_event, output) => terminalFileProManager.outputActions(output));
ipcMain.handle('terminalFilePro:recordingStudio', (_event, input) => terminalFileProManager.recordingStudio(input));
ipcMain.handle('terminalFilePro:protocolSave', (_event, input) => terminalFileProManager.saveProtocolConsole(input));
ipcMain.handle('terminalFilePro:multiFilePreview', (_event, sessionId, changes) => terminalFileProManager.multiFilePreview(sessionId, changes));
ipcMain.handle('terminalFilePro:multiFileApply', (_event, preview, approved) => auditOperation('files.multi-edit', preview?.sessionId || '', () => terminalFileProManager.multiFileApply(preview, approved)));
ipcMain.handle('terminalFilePro:containerFiles', (_event, sessionId, input) => terminalFileProManager.containerFiles(sessionId, input));
ipcMain.handle('terminalFilePro:gitFiles', (_event, sessionId, input) => terminalFileProManager.gitFiles(sessionId, input));
ipcMain.handle('terminalFilePro:archiveFiles', (_event, sessionId, input) => auditOperation(`files.archive-${input?.action || 'list'}`, input?.archive || '', () => terminalFileProManager.archiveFiles(sessionId, input)));
ipcMain.handle('terminalFilePro:hugeFile', (_event, sessionId, input) => terminalFileProManager.hugeFile(sessionId, input));
ipcMain.handle('terminalFilePro:indexBuild', (_event, sessionId, root, options) => terminalFileProManager.buildIndex(sessionId, root, options));
ipcMain.handle('terminalFilePro:indexSearch', (_event, id, query) => terminalFileProManager.searchIndex(id, query));
ipcMain.handle('terminalFilePro:provenanceRecord', (_event, input) => terminalFileProManager.recordProvenance(input));
ipcMain.handle('terminalFilePro:provenance', (_event, sha256) => terminalFileProManager.provenance(sha256));
ipcMain.handle('terminalFilePro:crossProtocolPlan', (_event, input) => terminalFileProManager.crossProtocolPlan(input));
ipcMain.handle('terminalFilePro:duplicates', (_event, sessionId, root) => terminalFileProManager.duplicates(sessionId, root));
ipcMain.handle('terminalFilePro:heatmap', (_event, sessionId, root) => terminalFileProManager.heatmap(sessionId, root));
ipcMain.handle('terminalFilePro:causality', (_event, sessionId, file) => terminalFileProManager.causality(sessionId, file));
ipcMain.handle('terminalFilePro:splitContext', (_event, input) => terminalFileProManager.updateSplitContext(input));
ipcMain.handle('terminalFilePro:pipelineSave', (_event, input) => terminalFileProManager.savePipeline(input));
ipcMain.handle('terminalFilePro:pipelinePlan', (_event, id, context) => terminalFileProManager.pipelinePlan(id, context));
ipcMain.handle('terminalFilePro:dropZoneCreate', (_event, input) => terminalFileProManager.createDropZone(input));
ipcMain.handle('terminalFilePro:dropZoneInspect', (_event, id) => terminalFileProManager.inspectDropZone(id));
ipcMain.handle('terminalFilePro:capsuleCreate', (_event, input) => terminalFileProManager.createConnectionCapsule(input));
ipcMain.handle('terminalFilePro:capsuleOpen', (_event, target, passphrase) => terminalFileProManager.openConnectionCapsule(target, passphrase));
ipcMain.handle('terminalFilePro:airDropCreate', (_event, input) => terminalFileProManager.createAirDrop(input));
ipcMain.handle('terminalFilePro:airDropConsume', (_event, id, code, destination) => auditOperation('files.airdrop-consume', id, () => terminalFileProManager.consumeAirDrop(id, code, destination)));
ipcMain.handle('terminalFilePro:clipboardPut', (_event, input) => terminalFileProManager.clipboardPut(input));
ipcMain.handle('terminalFilePro:clipboardTake', (_event, id, sessionId) => terminalFileProManager.clipboardTake(id, sessionId));
ipcMain.handle('terminalFilePro:filesystemWatch', (_event, input) => terminalFileProManager.filesystemWatch(input));
ipcMain.handle('terminalFileVision:summary', () => terminalFileVisionManager.summary());
ipcMain.handle('terminalFileVision:configuration', () => terminalFileVisionManager.configuration());
ipcMain.handle('terminalFileVision:execute', (_event, feature, input) => auditOperation(`terminal-file-vision.${feature}`, input?.sessionId || input?.target || '', () => terminalFileVisionManager.execute(feature, input), { previewFirst: true }));
ipcMain.handle('terminalFileRuntime:summary', () => terminalFileRuntimeManager.summary());
ipcMain.handle('terminalFileRuntime:audit', (_event, input) => auditOperation('terminal-file-runtime.audit', 'runtime', () => terminalFileRuntimeManager.runtimeAudit(input)));
ipcMain.handle('terminalFileRuntime:execute', (_event, capability, input) => auditOperation(`terminal-file-runtime.${capability}`, input?.sessionId || input?.id || '', () => terminalFileRuntimeManager.execute(capability, input), { governedRuntime: true }));
ipcMain.handle('terminalFileDeep:summary', () => terminalFileDeepManager.summary());
ipcMain.handle('terminalFileDeep:execute', (_event, capability, input) => auditOperation(`terminal-file-deep.${capability}`, input?.sessionId || input?.profileId || input?.id || '', () => terminalFileDeepManager.execute(capability, input), { governedRuntime: true, contextDrivenUx: true }));
ipcMain.handle('fabric:clipboard-write', (_event, value, options = {}) => {
  const bounded = String(value || '').slice(0, 2 * 1024 * 1024); const scan = advancedOpsManager.secretScan(bounded, 'secure-clipboard'); if (!scan.success && !options.allowSecrets) throw new Error(`Secure Clipboard blocked ${scan.findings.length} likely secret(s)`); const ttlSeconds = Math.max(5, Math.min(300, Number(options.ttlSeconds) || 30)); const digest = crypto.createHash('sha256').update(bounded).digest('hex'); clipboard.writeText(bounded); setTimeout(() => { try { if (crypto.createHash('sha256').update(clipboard.readText()).digest('hex') === digest) clipboard.clear(); } catch {} }, ttlSeconds * 1000).unref?.(); auditManager?.record({ source: 'desktop-ipc', action: 'fabric.clipboard-write', target: options.sessionId || 'local', success: true, details: { ttlSeconds, findings: scan.findings.length } }); return { success: true, ttlSeconds, findings: scan.findings };
});
ipcMain.handle('fabric:clipboard-clear', () => { clipboard.clear(); return { success: true }; });
ipcMain.handle('runbook:list', () => remoteOperationsManager.listRunbooks());
ipcMain.handle('runbook:save', (_event, input) => auditOperation('runbook.save', input?.id || input?.name || 'new', () => remoteOperationsManager.saveRunbook(input)));
ipcMain.handle('runbook:remove', (_event, id) => auditOperation('runbook.remove', id, () => remoteOperationsManager.removeRunbook(id)));
ipcMain.handle('runbook:run', (event, input, id, parameters) => auditOperation('runbook.run', id, () => remoteOperationsManager.runRunbook(input, id, parameters, progress => { if (!event.sender.isDestroyed()) event.sender.send('runbook:progress', progress); })));
ipcMain.handle('files:localList', (_event, directory) => remoteAccessManager.localList(directory));
ipcMain.handle('files:localMutate', (_event, operation, target, destination) => auditOperation(`files.local-${operation}`, target, () => { nextgenOpsManager.assertLocalWritable(target); if (destination) nextgenOpsManager.assertLocalWritable(destination); return remoteAccessManager.localMutate(operation, target, destination); }));
ipcMain.handle('files:remoteList', (_event, input, directory) => remoteAccessManager.remoteList(input, directory));
ipcMain.handle('files:transfer', (_event, input, direction, localPath, remotePath) => auditOperation(`files.${direction}`, remotePath, () => { if (direction === 'download') nextgenOpsManager.assertLocalWritable(localPath); return remoteAccessManager.transfer(input, direction, localPath, remotePath); }));
ipcMain.handle('files:transferResumable', (event, input, direction, localPath, remotePath, transferId) => auditOperation(`files.${direction}-resumable`, remotePath, () => { if (direction === 'download') nextgenOpsManager.assertLocalWritable(localPath); return remoteAccessManager.transferResumable(input, direction, localPath, remotePath, progress => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-progress', { transferId, ...progress }); }); }));
ipcMain.handle('files:transferRecursive', (event, input, direction, localPath, remotePath, transferId) => auditOperation(`files.${direction}-recursive`, remotePath, () => { if (direction === 'download') nextgenOpsManager.assertLocalWritable(localPath); return remoteAccessManager.transferRecursive(input, direction, localPath, remotePath, progress => {
  if (!event.sender.isDestroyed()) event.sender.send('files:transfer-progress', { transferId, ...progress });
}); }));
ipcMain.handle('files:remoteMutate', (_event, input, operation, target, destination) => auditOperation(`files.${operation}`, target, () => remoteAccessManager.mutate(input, operation, target, destination)));
ipcMain.handle('files:readLocal', (_event, target) => remoteAccessManager.readLocal(target));
ipcMain.handle('files:previewLocal', (_event, target) => remoteAccessManager.previewLocal(target));
ipcMain.handle('files:writeLocal', (_event, target, content) => auditOperation('files.local-write', target, () => { nextgenOpsManager.assertLocalWritable(target); return remoteAccessManager.writeLocal(target, content); }));
ipcMain.handle('files:readRemote', (_event, input, target) => remoteAccessManager.readRemote(input, target));
ipcMain.handle('files:previewRemote', (_event, input, target) => remoteAccessManager.previewRemote(input, target));
ipcMain.handle('files:writeRemote', (_event, input, target, content) => auditOperation('files.remote-write', target, () => remoteAccessManager.writeRemote(input, target, content)));
ipcMain.handle('files:searchLocal', (_event, directory, query) => remoteAccessManager.searchLocal(directory, query));
ipcMain.handle('files:searchRemote', (_event, input, directory, query) => remoteAccessManager.searchRemote(input, directory, query));
ipcMain.handle('files:diff', async (_event, input, localPath, remotePath) => { const remote = await remoteAccessManager.readRemote(input, remotePath); return remoteAccessManager.diffText(localPath, remote.content); });
ipcMain.handle('files:syncPreview', (_event, input, localPath, remotePath, options) => remoteAccessManager.syncPreview(input, localPath, remotePath, options));
ipcMain.handle('files:syncApply', (_event, input, preview, direction, selected) => auditOperation(`files.sync-${direction}`, preview?.remoteRoot || '', () => {
  if (direction === 'download' && preview?.localRoot) nextgenOpsManager.assertLocalWritable(preview.localRoot);
  return remoteAccessManager.syncApply(input, preview, direction, selected);
}));
ipcMain.handle('files:serverTransfer', (event, sourceInput, sourcePath, destinationInput, destinationPath, transferId) => auditOperation('files.server-to-server', `${sourcePath} -> ${destinationPath}`, () => remoteAccessManager.transferServerToServer(sourceInput, sourcePath, destinationInput, destinationPath, progress => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-progress', { transferId, ...progress }); })));
ipcMain.handle('storage:list', () => cloudStorageManager.list());
ipcMain.handle('storage:save', (_event, input, secrets) => auditOperation('storage.save', input?.id || input?.name || input?.type || 'new', () => cloudStorageManager.save(input, secrets)));
ipcMain.handle('storage:remove', (_event, id) => auditOperation('storage.remove', id, () => cloudStorageManager.remove(id)));
ipcMain.handle('storage:test', (_event, input) => cloudStorageManager.test(input));
ipcMain.handle('storage:listFiles', (_event, input, directory) => cloudStorageManager.listFiles(input, directory));
ipcMain.handle('storage:transfer', (_event, input, direction, localPath, remotePath) => auditOperation(`storage.${direction}`, remotePath, () => {
  if (direction === 'download') nextgenOpsManager.assertLocalWritable(localPath);
  return cloudStorageManager.transferLocal(input, direction, localPath, remotePath);
}));
ipcMain.handle('storage:transferRecursive', (event, input, direction, localPath, remotePath, transferId) => auditOperation(`storage.${direction}-recursive`, remotePath, () => {
  if (direction === 'download') nextgenOpsManager.assertLocalWritable(localPath);
  return cloudStorageManager.transferRecursive(input, direction, localPath, remotePath, progress => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-progress', { transferId, ...progress }); });
}));
ipcMain.handle('storage:mutate', (_event, input, operation, target, destination) => auditOperation(`storage.${operation}`, target, () => cloudStorageManager.mutate(input, operation, target, destination)));
ipcMain.handle('storage:read', (_event, input, remotePath) => cloudStorageManager.read(input, remotePath));
ipcMain.handle('storage:write', (_event, input, remotePath, content) => auditOperation('storage.write', remotePath, () => cloudStorageManager.write(input, remotePath, content)));
ipcMain.handle('sshTunnel:list', () => remoteAccessManager.listTunnels());
ipcMain.handle('sshTunnel:start', (_event, input, options) => auditOperation('tunnel.ssh-start', input?.id || input?.host || 'remote', () => remoteAccessManager.startTunnel(input, options)));
ipcMain.handle('sshTunnel:stop', (_event, id) => auditOperation('tunnel.ssh-stop', id, () => remoteAccessManager.stopTunnel(id)));
ipcMain.handle('remote:mountSftp', (_event, input, drive) => auditOperation('remote.mount-sftp', drive, () => remoteAccessManager.mountSftp(input, drive)));
ipcMain.handle('remote:listMounts', () => remoteAccessManager.listMounts());
ipcMain.handle('remote:unmountSftp', (_event, id) => auditOperation('remote.unmount-sftp', id, () => remoteAccessManager.unmountSftp(id)));
ipcMain.handle('remote:openRdp', async (_event, input) => {
  if (process.platform !== 'win32') return { success: false, error: 'RDP launcher is available on Windows' };
  try {
    const session = remoteAccessManager.resolve(input);
    let target = `${session.host}:${session.port || 3389}`; let tunnelId = '';
    if (session.type !== 'rdp') { const tunnel = await remoteAccessManager.startTunnel(session, { localPort: 0, remoteHost: '127.0.0.1', remotePort: Number(input?.rdpPort) || 3389 }); target = `127.0.0.1:${tunnel.localPort}`; tunnelId = tunnel.id; }
    let args = [`/v:${target}`]; let policyFile = '';
    if (input?.desktopPolicy) { const policy = input.desktopPolicy; const directory = path.join(_appRoot, 'remote-desktop'); fs.mkdirSync(directory, { recursive: true }); policyFile = path.join(directory, `${crypto.randomUUID()}.rdp`); const clipboardAllowed = policy.clipboardPolicy !== 'disabled'; const driveRedirect = policy.fileTransfer ? '*' : ''; fs.writeFileSync(policyFile, `full address:s:${target}\nredirectclipboard:i:${clipboardAllowed ? 1 : 0}\ndrivestoredirect:s:${driveRedirect}\nredirectprinters:i:0\nredirectcomports:i:0\nauthentication level:i:2\n`, { mode: 0o600 }); args = [policyFile]; }
    const child = spawn('mstsc.exe', args, { detached: true, stdio: 'ignore', windowsHide: false });
    auditManager?.record({ source: 'desktop-ipc', action: 'fabric.remote-desktop-launch', target: session.id, success: true, details: { protocol: 'rdp', clipboardPolicy: input?.desktopPolicy?.clipboardPolicy || 'default', fileTransfer: Boolean(input?.desktopPolicy?.fileTransfer) } });
    if (policyFile) child.once('exit', () => { try { fs.unlinkSync(policyFile); } catch {} });
    child.unref();
    return { success: true, tunnelId, target };
  } catch (error) { return { success: false, error: error.message }; }
});
ipcMain.handle('remote:openVnc', async (_event, input) => {
  if (process.platform !== 'win32') return { success: false, error: 'VNC launcher is currently available on Windows' };
  try {
    const session = remoteAccessManager.resolve(input); let target = `${session.host}:${session.port || 5900}`; let tunnelId = '';
    if (session.type !== 'vnc') { const tunnel = await remoteAccessManager.startTunnel(session, { localPort: 0, remoteHost: '127.0.0.1', remotePort: Number(input?.vncPort) || 5900 }); target = `127.0.0.1:${tunnel.localPort}`; tunnelId = tunnel.id; }
    const bundled = portableToolsManager.verify('vncviewer'); if (!bundled.valid) throw new Error('Bundled TigerVNC Viewer failed SHA-256 verification'); const known = [bundled.file, 'C:\\Program Files\\RealVNC\\VNC Viewer\\vncviewer.exe', 'C:\\Program Files\\TightVNC\\tvnviewer.exe']; let viewer = known.find(fs.existsSync);
    if (!viewer) { try { viewer = execFileSync('where.exe', ['vncviewer.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch {} }
    if (!viewer) { if (tunnelId) remoteAccessManager.stopTunnel(tunnelId); return { success: false, error: 'Install RealVNC Viewer or TightVNC Viewer first' }; }
    const child = spawn(viewer, [target], { detached: true, stdio: 'ignore', windowsHide: false }); child.unref(); return { success: true, tunnelId, target };
  } catch (error) { return { success: false, error: error.message }; }
});

// ===== Composer IPC =====
ipcMain.handle('composer:getStatus', () => {
  const config = configManager.getConfig();
  const phpProfile = configManager.getActiveProfile(config, 'php');
  if (!phpProfile) return { installed: false, phpAvailable: false };
  const version = phpProfile.version;
  if (!downloadManager.isInstalled('php', version)) return { installed: false, phpAvailable: false };
  const phpPath = downloadManager.getInstallPath('php', version);
  const composerProfile = configManager.getActiveProfile(config, 'composer');
  const managedPath = composerProfile && downloadManager.isInstalled('composer', composerProfile.version)
    ? downloadManager.getInstallPath('composer', composerProfile.version) : '';
  const composerPath = managedPath ? path.join(managedPath, 'composer.phar') : path.join(phpPath, 'composer.phar');
  return { installed: fs.existsSync(composerPath), phpAvailable: true, phpPath, composerPath, version: composerProfile?.version || '', managed: Boolean(managedPath) };
});

ipcMain.handle('composer:install', async () => {
  const config = configManager.getConfig();
  const phpProfile = configManager.getActiveProfile(config, 'php');
  if (!phpProfile) return { success: false, error: 'No active PHP profile' };
  const version = phpProfile.version;
  if (!downloadManager.isInstalled('php', version)) return { success: false, error: 'PHP not installed' };
  const composerProfile = configManager.getActiveProfile(config, 'composer');
  if (!composerProfile) return { success: false, error: 'No active Composer profile' };
  const result = await downloadManager.download('composer', composerProfile.version, progress => mainWindow?.webContents.send('download:progress', progress));
  if (result.success) {
    const pathResult = pathManager.syncIfSelected('composer');
    if (!pathResult.success) result.pathWarning = pathResult.error;
  }
  return result;
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
  const composerProfile = configManager.getActiveProfile(config, 'composer');
  const managedPath = composerProfile && downloadManager.isInstalled('composer', composerProfile.version)
    ? downloadManager.getInstallPath('composer', composerProfile.version) : '';
  const composerPhar = managedPath ? path.join(managedPath, 'composer.phar') : path.join(phpPath, 'composer.phar');
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
      env: { ...pathManager.buildEnvironment(process.env), COMPOSER_HOME: path.join(managedPath || phpPath, 'composer-home') }
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

ipcMain.handle('lab:recipes', () => labManager.recipes());
ipcMain.handle('lab:preview', (_event, input) => labManager.preview(input));
ipcMain.handle('lab:list', () => labManager.list());
ipcMain.handle('lab:get', (_event, id) => labManager.get(id));
ipcMain.handle('lab:create', (_event, input, secrets) => auditOperation('lab.create', input?.id || input?.name || 'new', () => labManager.create(input, secrets), { recipe: input?.recipe || '' }));
ipcMain.handle('lab:update', (_event, id, patch, secrets) => auditOperation('lab.update', id, () => labManager.update(id, patch, secrets)));
ipcMain.handle('lab:provision', (_event, id) => auditOperation('lab.provision', id, () => labManager.provision(id, progress => mainWindow?.webContents.send('lab:progress', progress))));
ipcMain.handle('lab:start', (_event, id) => auditOperation('lab.start', id, () => labManager.start(id)));
ipcMain.handle('lab:stop', (_event, id) => auditOperation('lab.stop', id, () => labManager.stop(id)));
ipcMain.handle('lab:health', (_event, id) => labManager.health(id));
ipcMain.handle('lab:remove', (_event, id, options) => auditOperation('lab.remove', id, () => labManager.remove(id, options)));
ipcMain.handle('apiFlow:catalog', () => apiFlowManager.catalog());
ipcMain.handle('apiFlow:list', () => apiFlowManager.list());
ipcMain.handle('apiFlow:get', (_event, id) => apiFlowManager.get(id));
ipcMain.handle('apiFlow:validate', (_event, input) => apiFlowManager.validate(input));
ipcMain.handle('apiFlow:save', (_event, input) => auditOperation('api-flow.save', input?.id || input?.name || 'new', () => apiFlowManager.save(input), { endpoints: input?.endpoints?.length || 0 }));
ipcMain.handle('apiFlow:remove', (_event, id) => auditOperation('api-flow.remove', id, () => apiFlowManager.remove(id)));
ipcMain.handle('apiFlow:start', (_event, id) => auditOperation('api-flow.start', id, () => apiFlowManager.start(id)));
ipcMain.handle('apiFlow:stop', (_event, id) => auditOperation('api-flow.stop', id, () => apiFlowManager.stop(id)));
ipcMain.handle('apiFlow:status', (_event, id) => apiFlowManager.status(id));
ipcMain.handle('apiFlow:test', (_event, projectId, endpointId, request) => auditOperation('api-flow.test', `${projectId}:${endpointId}`, () => apiFlowManager.test(projectId, endpointId, request)));
ipcMain.handle('apiFlow:request', (_event, projectId, endpointId, request) => auditOperation('api-flow.request', `${projectId}:${endpointId}`, () => apiFlowManager.request(projectId, endpointId, request)));
ipcMain.handle('apiFlow:logs', (_event, projectId, limit) => apiFlowManager.logs(projectId, limit));
ipcMain.handle('apiFlow:clearLogs', (_event, projectId) => auditOperation('api-flow.logs-clear', projectId || 'all', () => apiFlowManager.clearLogs(projectId)));
const desktopPrincipal = () => {
  const user = identityManager.listUsers().find(item => item.roles.includes('owner')) || identityManager.listUsers()[0];
  return user ? identityManager.principal(user, { provider: 'desktop-local' }) : null;
};
ipcMain.handle('identity:roles', () => identityManager.roles());
ipcMain.handle('identity:users', () => identityManager.listUsers());
ipcMain.handle('identity:createUser', (_event, input) => auditOperation('identity.user-create', input?.username || 'new', () => identityManager.createUser(input)));
ipcMain.handle('identity:updateUser', (_event, id, patch) => auditOperation('identity.user-update', id, () => identityManager.updateUser(id, patch)));
ipcMain.handle('identity:removeUser', (_event, id) => auditOperation('identity.user-remove', id, () => identityManager.removeUser(id)));
ipcMain.handle('identity:enableTotp', (_event, id) => identityManager.enableTotp(id));
ipcMain.handle('identity:disableTotp', (_event, id) => identityManager.disableTotp(id));
ipcMain.handle('identity:tokens', () => identityManager.listTokens());
ipcMain.handle('identity:createToken', (_event, input) => identityManager.createToken(input));
ipcMain.handle('identity:revokeToken', (_event, id) => identityManager.revokeToken(id));
ipcMain.handle('identity:invitations', () => identityManager.listInvitations());
ipcMain.handle('identity:createInvitation', (_event, input) => identityManager.createInvitation({ ...input, createdBy: desktopPrincipal()?.userId || '' }));
ipcMain.handle('identity:removeInvitation', (_event, id) => identityManager.removeInvitation(id));
ipcMain.handle('hub:status', () => hubManager.status());
ipcMain.handle('hub:settings', () => hubManager.settings());
ipcMain.handle('hub:configure', (_event, input) => auditOperation('hub.configure', input?.panelDomain || 'hub', () => hubManager.configure(input)));
ipcMain.handle('hub:teams', () => hubManager.listTeams());
ipcMain.handle('hub:saveTeam', (_event, input) => hubManager.saveTeam(input, desktopPrincipal()));
ipcMain.handle('hub:removeTeam', (_event, id) => hubManager.removeTeam(id));
ipcMain.handle('hub:nodes', () => hubManager.listNodes());
ipcMain.handle('hub:createPairing', (_event, input) => hubManager.createPairing(input, desktopPrincipal()));
ipcMain.handle('hub:revokeNode', (_event, id) => hubManager.revokeNode(id));
ipcMain.handle('hub:routes', () => hubManager.listRoutes());
ipcMain.handle('hub:saveRoute', (_event, input) => hubManager.saveRoute(input));
ipcMain.handle('hub:removeRoute', (_event, id) => hubManager.removeRoute(id));
ipcMain.handle('hub:inventory', (_event, filters) => hubManager.inventory(filters));
ipcMain.handle('hub:publishLocal', (_event, options) => hubManager.publishLocal(options, desktopPrincipal()));
ipcMain.handle('hub:publish', (_event, input) => hubManager.publish(input, desktopPrincipal()));
ipcMain.handle('hub:history', (_event, id) => hubManager.history(id));
ipcMain.handle('hub:rollback', (_event, id, revision) => hubManager.rollback(id, revision, desktopPrincipal()));
ipcMain.handle('hub:applyObject', (_event, id, options) => hubManager.applyObject(id, options));
ipcMain.handle('hub:deployments', (_event, filters) => hubManager.listDeployments(filters));
ipcMain.handle('hub:createDeployment', (_event, input) => hubManager.createDeployment(input, desktopPrincipal()));
ipcMain.handle('hub:approveDeployment', (_event, id) => hubManager.approveDeployment(id, desktopPrincipal()));
ipcMain.handle('hub:updateDeployment', (_event, id, input) => hubManager.updateDeployment(id, input));
ipcMain.handle('hub:connectors', () => hubManager.listConnectors());
ipcMain.handle('hub:saveConnector', (_event, input, secret) => hubManager.saveConnector(input, secret));
ipcMain.handle('hub:removeConnector', (_event, id) => hubManager.removeConnector(id));
ipcMain.handle('hub:remotes', () => hubManager.listRemotes());
ipcMain.handle('hub:saveRemote', (_event, input, token) => hubManager.saveRemote(input, token));
ipcMain.handle('hub:removeRemote', (_event, id) => hubManager.removeRemote(id));
ipcMain.handle('hub:pushRemote', (_event, id, options) => hubManager.pushToRemote(id, options, desktopPrincipal()));
ipcMain.handle('hub:pullRemote', (_event, id, options) => hubManager.pullFromRemote(id, options, desktopPrincipal()));
ipcMain.handle('hub:syncRemote', (_event, id, options) => hubManager.syncRemote(id, options, desktopPrincipal()));
ipcMain.handle('hub:compareRemote', (_event, id, options) => hubManager.compareRemote(id, options));
ipcMain.handle('hub:applyRemotePlan', (_event, id, selections, options) => auditOperation('hub.sync-plan', id, () => hubManager.applyRemotePlan(id, selections, options, desktopPrincipal())));
ipcMain.handle('hub:reconcile', () => hubManager.reconcile());
ipcMain.handle('observability:overview', () => observabilityManager.overview());
ipcMain.handle('observability:collect', () => observabilityManager.collect());
ipcMain.handle('observability:history', (_event, options) => observabilityManager.history(options));
ipcMain.handle('observability:alerts', () => observabilityManager.alertsList());
ipcMain.handle('observability:acknowledge', (_event, id) => observabilityManager.acknowledgeAlert(id));
ipcMain.handle('observability:rules', () => observabilityManager.rulesList());
ipcMain.handle('observability:saveRule', (_event, input) => observabilityManager.saveRule(input));
ipcMain.handle('observability:removeRule', (_event, id) => observabilityManager.removeRule(id));
ipcMain.handle('observability:prometheus', () => observabilityManager.prometheus());
ipcMain.handle('automation:list', () => automationManager.list());
ipcMain.handle('automation:history', (_event, limit) => automationManager.history(limit));
ipcMain.handle('automation:save', (_event, input) => auditOperation('automation.save', input?.id || input?.name || 'new', () => automationManager.save(input)));
ipcMain.handle('automation:remove', (_event, id) => auditOperation('automation.remove', id, () => automationManager.remove(id)));
ipcMain.handle('automation:run', (_event, id) => auditOperation('automation.run', id, () => automationManager.run(id, { manual: true })));
ipcMain.handle('automation:runDue', () => auditOperation('automation.run-due', 'scheduled', () => automationManager.runDue(), { automatic: true }));

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
