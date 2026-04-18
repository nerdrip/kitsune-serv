const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { execSync } = require('child_process');
const ConfigManager = require('./config-manager');
const DownloadManager = require('./download-manager');
const ServiceManager = require('./service-manager');
const DbViewer = require('./db-viewer');
const AppStoreManager = require('./app-store-manager');

// Ensure CWD is always the app root (next to the exe) so all relative paths work
const _appRoot = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
process.chdir(_appRoot);

let mainWindow;
let tray = null;
const configManager = new ConfigManager();
let downloadManager;
let serviceManager;
let appStoreManager;

function createWindow() {
  const general = configManager.getConfig().general || {};

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'KitsuneServ',
    backgroundColor: '#0f0f1a',
    show: !general.startMinimized,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: false,
    titleBarStyle: 'hidden'
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // If startMinimized, show the window once ready then immediately hide to tray
  if (general.startMinimized) {
    mainWindow.once('ready-to-show', () => {
      // Don't show — keep hidden in tray
    });
  }
}

app.whenReady().then(() => {
  downloadManager = new DownloadManager();
  serviceManager = new ServiceManager(downloadManager, configManager);
  global.dbViewer = new DbViewer(downloadManager, configManager, serviceManager);
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
});

function createTray() {
  // Create a small 16x16 tray icon using nativeImage
  const icon = nativeImage.createFromDataURL(
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
    { label: 'Quit', click: async () => { if (serviceManager) await serviceManager.stopAll(); app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
}

app.on('window-all-closed', async () => {
  if (serviceManager) await serviceManager.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  if (serviceManager?.processes?.size > 0) {
    e.preventDefault();
    await serviceManager.stopAll();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ===== Config IPC =====
ipcMain.handle('config:get', () => configManager.getConfig());
ipcMain.handle('config:save', (_event, config) => {
  const result = configManager.saveConfig(config);
  // Sync OS auto-start shortcut when autoStartOnBoot changes
  _syncAutoStartOnBoot(config.general?.autoStartOnBoot);
  return result;
});
ipcMain.handle('config:reset', () => configManager.resetConfig());
ipcMain.handle('config:getDefaults', () => configManager.getDefaults());
ipcMain.handle('config:getAppRoot', () => downloadManager.getAppRoot());

// ===== Auto-start on boot (Windows startup shortcut / Linux .desktop) =====
function _syncAutoStartOnBoot(enabled) {
  try {
    if (process.platform === 'win32') {
      const startupDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const shortcutPath = path.join(startupDir, 'KitsuneServ.vbs');
      if (enabled) {
        const exePath = app.isPackaged ? process.execPath : `"${process.execPath}" "${path.join(app.getAppPath(), 'src', 'main.js')}"`;
        const script = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${exePath.replace(/\\/g, '\\\\')}", 0, False`;
        fs.writeFileSync(shortcutPath, script.replace(/\\n/g, '\r\n'), 'utf-8');
      } else {
        if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
      }
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
ipcMain.handle('config:newProfile', (_event, section, type, version, name) => {
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
  config[section].activeProfileId = profile.id;
  configManager.saveConfig(config);
  return { success: true, profile, config };
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

ipcMain.handle('config:deleteProfile', (_event, section, profileId) => {
  const config = configManager.getConfig();
  const svc = config[section];
  if (!svc || svc.profiles.length <= 1) return { success: false, error: 'Cannot delete last profile' };
  svc.profiles = svc.profiles.filter(p => p.id !== profileId);
  if (svc.activeProfileId === profileId) svc.activeProfileId = svc.profiles[0].id;
  configManager.saveConfig(config);
  return { success: true, config };
});

ipcMain.handle('config:duplicateProfile', (_event, section, profileId) => {
  const config = configManager.getConfig();
  const svc = config[section];
  if (!svc) return { success: false, error: 'Unknown section' };
  const source = svc.profiles.find(p => p.id === profileId);
  if (!source) return { success: false, error: 'Profile not found' };
  const clone = JSON.parse(JSON.stringify(source));
  clone.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  clone.name = source.name + ' (copy)';
  svc.profiles.push(clone);
  svc.activeProfileId = clone.id;
  configManager.saveConfig(config);
  return { success: true, config };
});

ipcMain.handle('config:setActiveProfile', (_event, section, profileId) => {
  const config = configManager.getConfig();
  const svc = config[section];
  if (!svc) return { success: false, error: 'Unknown section' };
  const exists = svc.profiles.find(p => p.id === profileId);
  if (!exists) return { success: false, error: 'Profile not found' };
  svc.activeProfileId = profileId;
  configManager.saveConfig(config);
  return { success: true, config };
});

// ===== Download IPC =====
ipcMain.handle('download:getVersions', () => downloadManager.getVersionMap());
ipcMain.handle('download:status', () => downloadManager.getStatus());
ipcMain.handle('download:isInstalled', (_event, service, version) => downloadManager.isInstalled(service, version));
ipcMain.handle('download:installedVersions', (_event, service) => downloadManager.getInstalledVersions(service));
ipcMain.handle('download:install', async (_event, service, version) => {
  const result = await downloadManager.download(service, version, (progress) => {
    mainWindow?.webContents.send('download:progress', progress);
  });
  return result;
});
ipcMain.handle('download:remove', (_event, service, version) => downloadManager.removeVersion(service, version));

// ===== Service IPC =====
ipcMain.handle('service:start', async (_event, service) => serviceManager.startService(service));
ipcMain.handle('service:stop', (_event, service) => serviceManager.stopService(service));
ipcMain.handle('service:restart', async (_event, service) => {
  await serviceManager.stopService(service);
  return serviceManager.startService(service);
});
ipcMain.handle('service:status', (_event, service) => serviceManager.getServiceStatus(service));
ipcMain.handle('service:allStatuses', () => serviceManager.getAllStatuses());
ipcMain.handle('service:logs', (_event, service, lines) => serviceManager.getLogs(service, lines));
ipcMain.handle('service:stopAll', () => serviceManager.stopAll());

// ===== Database Viewer IPC =====
ipcMain.handle('db:listDatabases', (_e, section) => global.dbViewer.listDatabases(section));
ipcMain.handle('db:listTables', (_e, section, database) => global.dbViewer.listTables(section, database));
ipcMain.handle('db:tableData', (_e, section, database, table, limit, offset) => global.dbViewer.tableData(section, database, table, limit, offset));
ipcMain.handle('db:executeQuery', (_e, section, database, query) => global.dbViewer.executeQuery(section, database, query));
ipcMain.handle('db:createDatabase', (_e, section, name) => global.dbViewer.createDatabase(section, name));
ipcMain.handle('db:dropDatabase', (_e, section, name) => global.dbViewer.dropDatabase(section, name));
ipcMain.handle('db:getToolUrl', async (_e, section, database) => {
  await appStoreManager.ensureAdminer();
  return appStoreManager.getDbToolUrl(section, database);
});

// ===== Shell IPC =====
ipcMain.handle('shell:openPath', (_event, targetPath) => {
  const resolved = path.resolve(targetPath);
  const appRoot = downloadManager.getAppRoot();
  if (!resolved.startsWith(appRoot)) return { success: false, error: 'Path outside app root' };
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  shell.openPath(resolved);
  return { success: true };
});

ipcMain.handle('shell:openExternal', (_event, url) => {
  // Only allow http/https URLs
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});

ipcMain.handle('projects:list', (_event, section) => {
  const projectsDir = path.resolve('projects', section);
  if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch { return []; }
});

ipcMain.handle('projects:create', (_event, section, name) => {
  const safeName = name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
  if (!safeName) return { success: false, error: 'Invalid project name' };
  const projectDir = path.resolve('projects', section, safeName);
  if (fs.existsSync(projectDir)) return { success: false, error: 'Project already exists' };
  fs.mkdirSync(projectDir, { recursive: true });
  return { success: true, path: projectDir };
});

ipcMain.handle('projects:delete', (_event, section, name) => {
  const safeName = name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
  const projectDir = path.resolve('projects', section, safeName);
  const projectsRoot = path.resolve('projects', section);
  if (!projectDir.startsWith(projectsRoot) || !fs.existsSync(projectDir)) return { success: false, error: 'Not found' };
  fs.rmSync(projectDir, { recursive: true, force: true });
  return { success: true };
});

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
  const config = configManager.getConfig();
  const sections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
  const extraPaths = [];

  for (const section of sections) {
    const profile = configManager.getActiveProfile(config, section);
    if (!profile) continue;
    const dlKey = section;
    const version = profile.version;
    if (!downloadManager.isInstalled(dlKey, version)) continue;
    const installPath = downloadManager.getInstallPath(dlKey, version);

    const binCandidates = {
      apache: ['bin'],
      nginx: ['.'],
      caddy: ['.'],
      postgresql: ['bin', 'pgsql/bin'],
      mysql: ['bin'],
      mariadb: ['bin'],
      mongodb: ['bin'],
      php: ['.'],
      node: [process.platform === 'win32' ? '.' : 'bin'],
      go: ['bin'],
      bun: ['.'],
      redis: [process.platform === 'win32' ? '.' : 'bin'],
      memcached: ['.', 'bin'],
      minio: ['.'],
      python: [process.platform === 'win32' ? '.' : 'bin'],
      deno: ['.']
    };
    for (const rel of (binCandidates[section] || ['.'])) {
      const binDir = path.join(installPath, rel);
      if (fs.existsSync(binDir)) extraPaths.push(binDir);
    }
  }

  const env = { ...process.env };
  const pathSep = process.platform === 'win32' ? ';' : ':';
  if (extraPaths.length) {
    env.PATH = extraPaths.join(pathSep) + pathSep + (env.PATH || '');
  }
  return env;
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
  try {
    // Download composer-setup.php and install
    const https = require('https');
    const setupPath = path.join(phpPath, 'composer-setup.php');
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(setupPath);
      https.get('https://getcomposer.org/installer', (response) => {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err) => { fs.unlinkSync(setupPath); reject(err); });
    });
    execSync(`"${phpExe}" "${setupPath}" --install-dir="${phpPath}" --filename=composer.phar`, { encoding: 'utf-8', timeout: 60000 });
    try { fs.unlinkSync(setupPath); } catch {}
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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
    const { execFileSync } = require('child_process');
    const output = execFileSync(phpExe, [composerPhar, ...args], {
      encoding: 'utf-8',
      timeout: 120000,
      cwd: cwd && fs.existsSync(cwd) ? cwd : path.resolve('.'),
      env: { ...process.env, COMPOSER_HOME: path.join(phpPath, 'composer') }
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.stdout || err.stderr || err.message };
  }
});

// ===== PATH Management IPC =====
const PATH_MARKER = '# KitsuneServ';

function getKitsunePathEntries() {
  const config = configManager.getConfig();
  const sections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
  const entries = [];

  for (const section of sections) {
    const profile = configManager.getActiveProfile(config, section);
    if (!profile) continue;
    const dlKey = section;
    const version = profile.version;
    if (!downloadManager.isInstalled(dlKey, version)) continue;
    const installPath = downloadManager.getInstallPath(dlKey, version);

    const binCandidates = {
      apache: ['bin'],
      nginx: ['.'],
      caddy: ['.'],
      postgresql: ['bin', 'pgsql/bin'],
      mysql: ['bin'],
      mariadb: ['bin'],
      mongodb: ['bin'],
      php: ['.'],
      node: ['.'],
      go: ['bin'],
      bun: ['.'],
      redis: ['.'],
      memcached: ['.', 'bin'],
      minio: ['.'],
      python: ['.'],
      deno: ['.']
    };
    for (const rel of (binCandidates[section] || ['.'])) {
      const binDir = path.resolve(path.join(installPath, rel));
      if (fs.existsSync(binDir)) entries.push(binDir);
    }
  }
  return entries;
}

ipcMain.handle('path:getStatus', () => {
  if (process.platform === 'win32') {
    try {
      const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
      const kitsuneEntries = getKitsunePathEntries();
      const pathParts = userPath.split(';').map(p => p.replace(/\\/g, '/').toLowerCase());
      const added = kitsuneEntries.some(e => pathParts.includes(e.replace(/\\/g, '/').toLowerCase()));
      return { added, entries: kitsuneEntries };
    } catch {
      return { added: false, entries: [] };
    }
  } else {
    // Linux/macOS: check if shell profile has KitsuneServ entries
    try {
      const shellRc = _getShellRcPath();
      if (shellRc && fs.existsSync(shellRc)) {
        const content = fs.readFileSync(shellRc, 'utf-8');
        const added = content.includes('# KitsuneServ PATH');
        return { added, entries: getKitsunePathEntries() };
      }
      return { added: false, entries: getKitsunePathEntries() };
    } catch {
      return { added: false, entries: [] };
    }
  }
});

function _getShellRcPath() {
  const home = process.env.HOME || '';
  if (!home) return null;
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  return path.join(home, '.bashrc');
}

ipcMain.handle('path:add', () => {
  try {
    const entries = getKitsunePathEntries();
    if (!entries.length) return { success: false, error: 'No installed services found' };
    if (process.platform === 'win32') {
      const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
      const pathParts = userPath.split(';').filter(Boolean);
      const appRoot = downloadManager.getAppRoot().replace(/\\/g, '/').toLowerCase();
      const cleaned = pathParts.filter(p => !p.replace(/\\/g, '/').toLowerCase().includes(appRoot + '/servers'));
      const newPath = [...entries, ...cleaned].join(';');
      execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${newPath.replace(/'/g, "''")}','User')"`, { encoding: 'utf-8' });
    } else {
      const shellRc = _getShellRcPath();
      if (!shellRc) return { success: false, error: 'Could not determine shell config file' };
      let content = fs.existsSync(shellRc) ? fs.readFileSync(shellRc, 'utf-8') : '';
      // Remove old KitsuneServ block
      content = content.replace(/\n# KitsuneServ PATH - START[\s\S]*?# KitsuneServ PATH - END\n?/g, '');
      const block = `\n# KitsuneServ PATH - START\nexport PATH="${entries.join(':')}:$PATH"\n# KitsuneServ PATH - END\n`;
      content += block;
      fs.writeFileSync(shellRc, content, 'utf-8');
    }
    return { success: true, entries };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('path:remove', () => {
  try {
    if (process.platform === 'win32') {
      const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
      const pathParts = userPath.split(';').filter(Boolean);
      const appRoot = downloadManager.getAppRoot().replace(/\\/g, '/').toLowerCase();
      const cleaned = pathParts.filter(p => !p.replace(/\\/g, '/').toLowerCase().includes(appRoot + '/servers'));
      const newPath = cleaned.join(';');
      execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${newPath.replace(/'/g, "''")}','User')"`, { encoding: 'utf-8' });
    } else {
      const shellRc = _getShellRcPath();
      if (shellRc && fs.existsSync(shellRc)) {
        let content = fs.readFileSync(shellRc, 'utf-8');
        content = content.replace(/\n# KitsuneServ PATH - START[\s\S]*?# KitsuneServ PATH - END\n?/g, '');
        fs.writeFileSync(shellRc, content, 'utf-8');
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

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
const { dialog } = require('electron');

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
    configManager.saveConfig(imported);
    return { success: true, config: imported };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ===== Auto-start services on launch =====
ipcMain.handle('service:autoStart', async () => {
  const config = configManager.getConfig();
  if (!config.general?.autoStartOnBoot) return { started: [] };
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
  const catalog = appStoreManager.getCatalog();
  const instances = appStoreManager._loadInstances();
  return catalog.map(app => {
    const appInstances = Object.entries(instances)
      .filter(([, v]) => v.appId === app.id)
      .map(([name, v]) => ({ instanceName: name, dbName: v.dbName }));
    // Also check for legacy folder match (no instance record yet)
    if (appInstances.length === 0 && appStoreManager.isInstalled(app.id)) {
      appInstances.push({ instanceName: app.id, dbName: app.database || '' });
    }
    return {
      ...app,
      installed: appInstances.length > 0,
      instances: appInstances
    };
  });
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
  const catalog = appStoreManager.getCatalog();
  const appDef = catalog.find(a => a.id === appId);
  if (!appDef) return { ok: true, missing: [] };
  return appStoreManager.checkRequirements(appDef);
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
