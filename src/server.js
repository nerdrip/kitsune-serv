#!/usr/bin/env node
/**
 * KitsuneServ — Server Mode
 * 
 * Runs the KitsuneServ management UI as a web application accessible via browser.
 * Default port: 10000
 * 
 * Usage:
 *   node src/server.js                        # Start with defaults
 *   node src/server.js --port 8888            # Custom port
 *   node src/server.js --host 0.0.0.0         # Listen on all interfaces
 *   KITSUNE_USER=admin KITSUNE_PASS=secret node src/server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const PORT = parseInt(getArg('port', process.env.KITSUNE_PORT || '10000'), 10);
const HOST = getArg('host', process.env.KITSUNE_HOST || '0.0.0.0');

// Authentication credentials (from env or auto-generated)
const AUTH_USER = process.env.KITSUNE_USER || 'admin';
const AUTH_PASS = process.env.KITSUNE_PASS || crypto.randomBytes(12).toString('base64url');
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');

// Sessions store (in-memory)
const sessions = new Map();
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// Set CWD to project root
const appRoot = path.resolve(__dirname, '..');
process.chdir(appRoot);

// Import managers
const ConfigManager = require('./config-manager');
const DownloadManager = require('./download-manager');
const ServiceManager = require('./service-manager');
const DbViewer = require('./db-viewer');
const AppStoreManager = require('./app-store-manager');

const configManager = new ConfigManager(appRoot);
const downloadManager = new DownloadManager(appRoot);
const serviceManager = new ServiceManager(downloadManager, configManager);
const dbViewer = new DbViewer(downloadManager, configManager, serviceManager);
const appStoreManager = new AppStoreManager(downloadManager, configManager, dbViewer, serviceManager);

// ============ Session helpers ============

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(username) {
  const id = generateSessionId();
  sessions.set(id, { username, createdAt: Date.now() });
  return id;
}

function validateSession(sessionId) {
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

function getSessionIdFromReq(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/kitsune_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

// ============ HTTP helpers ============

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_BODY = 10 * 1024 * 1024; // 10MB limit
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// ============ Login page ============

function getLoginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KitsuneServ - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f0f1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-box { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 40px; width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .login-box h1 { text-align: center; margin-bottom: 8px; font-size: 24px; }
    .login-box .logo { text-align: center; font-size: 48px; margin-bottom: 16px; }
    .login-box .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 14px; }
    label { display: block; margin-bottom: 4px; font-size: 13px; color: #aaa; }
    input { width: 100%; padding: 10px 12px; background: #16162b; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 14px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #e94560; }
    button { width: 100%; padding: 12px; background: #e94560; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #d63851; }
    .error { color: #e94560; text-align: center; margin-bottom: 12px; font-size: 13px; }
  </style>
</head>
<body>
  <form class="login-box" method="POST" action="/auth/login">
    <div class="logo">🦊</div>
    <h1>KitsuneServ</h1>
    <div class="subtitle">Server Management Console</div>
    ${error ? `<div class="error">${error.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}</div>` : ''}
    <label for="username">Username</label>
    <input type="text" id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required>
    <button type="submit">Sign In</button>
  </form>
</body>
</html>`;
}

// ============ Web adapter for renderer ============
// Wraps the preload API to be available as window.kitsuneAPI via fetch calls

function getWebPreload() {
  return `
// KitsuneServ Web Mode — API adapter
// Replaces Electron's preload.js, mapping kitsuneAPI calls to REST endpoints
window.kitsuneAPI = {
  _call: async function(endpoint, data) {
    const res = await fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
      credentials: 'same-origin'
    });
    return res.json();
  },
  config: {
    get: () => window.kitsuneAPI._call('config/get'),
    save: (config) => window.kitsuneAPI._call('config/save', { config }),
    reset: () => window.kitsuneAPI._call('config/reset'),
    getDefaults: () => window.kitsuneAPI._call('config/getDefaults'),
    getAppRoot: () => window.kitsuneAPI._call('config/getAppRoot'),
    newProfile: (section, type, version, name) => window.kitsuneAPI._call('config/newProfile', { section, type, version, name }),
    deleteProfile: (section, profileId) => window.kitsuneAPI._call('config/deleteProfile', { section, profileId }),
    duplicateProfile: (section, profileId) => window.kitsuneAPI._call('config/duplicateProfile', { section, profileId }),
    setActiveProfile: (section, profileId) => window.kitsuneAPI._call('config/setActiveProfile', { section, profileId }),
    renameProfile: (section, profileId, newName) => window.kitsuneAPI._call('config/renameProfile', { section, profileId, newName }),
    exportConfig: () => window.kitsuneAPI._call('config/export'),
    importConfig: () => window.kitsuneAPI._call('config/import')
  },
  download: {
    getVersions: () => window.kitsuneAPI._call('download/getVersions'),
    status: () => window.kitsuneAPI._call('download/status'),
    isInstalled: (service, version) => window.kitsuneAPI._call('download/isInstalled', { service, version }),
    installedVersions: (service) => window.kitsuneAPI._call('download/installedVersions', { service }),
    install: (service, version) => window.kitsuneAPI._call('download/install', { service, version }),
    remove: (service, version) => window.kitsuneAPI._call('download/remove', { service, version }),
    diskUsage: () => window.kitsuneAPI._call('download/diskUsage'),
    onProgress: (cb) => { window._kitsuneProgressCb = cb; }
  },
  db: {
    listDatabases: (section) => window.kitsuneAPI._call('db/listDatabases', { section }),
    listTables: (section, database) => window.kitsuneAPI._call('db/listTables', { section, database }),
    tableData: (section, database, table, limit, offset) => window.kitsuneAPI._call('db/tableData', { section, database, table, limit, offset }),
    executeQuery: (section, database, query) => window.kitsuneAPI._call('db/executeQuery', { section, database, query }),
    createDatabase: (section, name) => window.kitsuneAPI._call('db/createDatabase', { section, name }),
    dropDatabase: (section, name) => window.kitsuneAPI._call('db/dropDatabase', { section, name }),
    getToolUrl: (section, database) => window.kitsuneAPI._call('db/getToolUrl', { section, database })
  },
  service: {
    start: (service) => window.kitsuneAPI._call('service/start', { service }),
    stop: (service) => window.kitsuneAPI._call('service/stop', { service }),
    restart: (service) => window.kitsuneAPI._call('service/restart', { service }),
    status: (service) => window.kitsuneAPI._call('service/status', { service }),
    allStatuses: () => window.kitsuneAPI._call('service/allStatuses'),
    logs: (service, lines) => window.kitsuneAPI._call('service/logs', { service, lines }),
    stopAll: () => window.kitsuneAPI._call('service/stopAll'),
    healthCheck: (service) => window.kitsuneAPI._call('service/healthCheck', { service }),
    autoStart: () => window.kitsuneAPI._call('service/autoStart'),
    resourceUsage: () => window.kitsuneAPI._call('service/resourceUsage'),
    onExited: (cb) => { window._kitsuneExitedCb = cb; }
  },
  terminal: {
    create: () => window.kitsuneAPI._call('terminal/create'),
    write: (id, data) => window.kitsuneAPI._call('terminal/write', { id, data }),
    kill: (id) => window.kitsuneAPI._call('terminal/kill', { id }),
    resize: (id, cols, rows) => window.kitsuneAPI._call('terminal/resize', { id, cols, rows }),
    onData: (cb) => { window._kitsuneTermDataCb = cb; },
    onExit: (cb) => { window._kitsuneTermExitCb = cb; }
  },
  path: {
    getStatus: () => window.kitsuneAPI._call('path/getStatus'),
    add: () => window.kitsuneAPI._call('path/add'),
    remove: () => window.kitsuneAPI._call('path/remove')
  },
  composer: {
    getStatus: () => window.kitsuneAPI._call('composer/getStatus'),
    install: () => window.kitsuneAPI._call('composer/install'),
    run: (command, cwd) => window.kitsuneAPI._call('composer/run', { command, cwd })
  },
  shell: {
    openPath: (p) => window.kitsuneAPI._call('shell/openPath', { path: p }),
    openExternal: (url) => { window.open(url, '_blank'); return Promise.resolve({ success: true }); }
  },
  projects: {
    list: (section) => window.kitsuneAPI._call('projects/list', { section }),
    create: (section, name) => window.kitsuneAPI._call('projects/create', { section, name }),
    delete: (section, name) => window.kitsuneAPI._call('projects/delete', { section, name })
  },
  appStore: {
    catalog: () => window.kitsuneAPI._call('appStore/catalog'),
    installed: () => window.kitsuneAPI._call('appStore/installed'),
    install: (appId, instanceName) => window.kitsuneAPI._call('appStore/install', { appId, instanceName }),
    remove: (instanceName) => window.kitsuneAPI._call('appStore/remove', { instanceName }),
    getUrl: (instanceName) => window.kitsuneAPI._call('appStore/getUrl', { instanceName }),
    getExePath: (instanceName) => window.kitsuneAPI._call('appStore/getExePath', { instanceName }),
    addCustomApp: (opts) => window.kitsuneAPI._call('appStore/addCustomApp', { opts }),
    removeCustomApp: (appId) => window.kitsuneAPI._call('appStore/removeCustomApp', { appId }),
    checkRequirements: (appId) => window.kitsuneAPI._call('appStore/checkRequirements', { appId }),
    onProgress: (cb) => { window._kitsuneAppStoreCb = cb; }
  },
  window: {
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    close: () => Promise.resolve()
  },
  tray: {
    onStartAll: () => {}
  },
  removeAllListeners: () => {}
};

// SSE for real-time events (terminal, service exit, download progress)
(function() {
  const evtSource = new EventSource('/api/events');
  evtSource.onmessage = function(e) {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'terminal:data' && window._kitsuneTermDataCb) window._kitsuneTermDataCb(msg.payload);
      if (msg.type === 'terminal:exit' && window._kitsuneTermExitCb) window._kitsuneTermExitCb(msg.payload);
      if (msg.type === 'service:exited' && window._kitsuneExitedCb) window._kitsuneExitedCb(msg.payload);
      if (msg.type === 'download:progress' && window._kitsuneProgressCb) window._kitsuneProgressCb(msg.payload);
      if (msg.type === 'appStore:progress' && window._kitsuneAppStoreCb) window._kitsuneAppStoreCb(msg.payload);
    } catch {}
  };
})();
`;
}

// ============ SSE clients ============
const sseClients = new Set();

function broadcastSSE(type, payload) {
  const data = JSON.stringify({ type, payload });
  for (const res of sseClients) {
    try { res.write(`data: ${data}\n\n`); } catch { sseClients.delete(res); }
  }
}

// Wire up service exit events
serviceManager._onServiceExit = (section, code) => {
  broadcastSSE('service:exited', { section, code });
};

// ============ Terminal management (server-side) ============
const { spawn } = require('child_process');
const terminals = new Map();
let terminalIdCounter = 0;

function buildTerminalEnv() {
  const config = configManager.getConfig();
  const sections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
  const extraPaths = [];
  const isWin = process.platform === 'win32';
  for (const section of sections) {
    const profile = configManager.getActiveProfile(config, section);
    if (!profile) continue;
    const version = profile.version;
    if (!downloadManager.isInstalled(section, version)) continue;
    const installPath = downloadManager.getInstallPath(section, version);
    const binCandidates = {
      apache: ['bin'], nginx: ['.'], caddy: ['.'],
      postgresql: ['bin', 'pgsql/bin'], mysql: ['bin'], mariadb: ['bin'], mongodb: ['bin'],
      php: ['.'], node: [isWin ? '.' : 'bin'], go: ['bin'], bun: ['.'],
      redis: [isWin ? '.' : 'bin'], memcached: ['.', 'bin'], minio: ['.'],
      python: [isWin ? '.' : 'bin'], deno: ['.']
    };
    for (const rel of (binCandidates[section] || ['.'])) {
      const binDir = path.join(installPath, rel);
      if (fs.existsSync(binDir)) extraPaths.push(binDir);
    }
  }
  const env = { ...process.env };
  const sep = isWin ? ';' : ':';
  if (extraPaths.length) env.PATH = extraPaths.join(sep) + sep + (env.PATH || '');
  return env;
}

// ============ API Router ============

const net = require('net');

async function handleAPI(endpoint, body) {
  switch (endpoint) {
    // Config
    case 'config/get': return configManager.getConfig();
    case 'config/save': return configManager.saveConfig(body.config);
    case 'config/reset': return configManager.resetConfig();
    case 'config/getDefaults': return configManager.getDefaults();
    case 'config/getAppRoot': return downloadManager.getAppRoot();

    // Profiles
    case 'config/newProfile': {
      const { section, type, version, name } = body;
      const config = configManager.getConfig();
      let profile;
      switch (section) {
        case 'apache': profile = configManager.defaultApacheProfile(version); break;
        case 'nginx': profile = configManager.defaultNginxProfile(version); break;
        case 'postgresql': profile = configManager.defaultPostgresqlProfile(version); break;
        case 'mysql': profile = configManager.defaultMysqlProfile(version); break;
        case 'mongodb': profile = configManager.defaultMongodbProfile(version); break;
        case 'mariadb': profile = configManager.defaultMariadbProfile(version); break;
        case 'php': profile = configManager.defaultPhpProfile(version); break;
        case 'node': profile = configManager.defaultNodeProfile(version); break;
        case 'go': profile = configManager.defaultGoProfile(version); break;
        case 'bun': profile = configManager.defaultBunProfile(version); break;
        case 'redis': profile = configManager.defaultRedisProfile(version); break;
        case 'memcached': profile = configManager.defaultMemcachedProfile(version); break;
        case 'python': profile = configManager.defaultPythonProfile(version); break;
        case 'deno': profile = configManager.defaultDenoProfile(version); break;
        case 'caddy': profile = configManager.defaultCaddyProfile(version); break;
        case 'minio': profile = configManager.defaultMinioProfile(version); break;
        default: return { success: false, error: 'Unknown section' };
      }
      if (name) profile.name = name;
      config[section].profiles.push(profile);
      config[section].activeProfileId = profile.id;
      configManager.saveConfig(config);
      return { success: true, profile, config };
    }
    case 'config/renameProfile': {
      const config = configManager.getConfig();
      const svc = config[body.section];
      if (!svc) return { success: false, error: 'Unknown section' };
      const profile = svc.profiles.find(p => p.id === body.profileId);
      if (!profile) return { success: false, error: 'Profile not found' };
      profile.name = body.newName;
      configManager.saveConfig(config);
      return { success: true, config };
    }
    case 'config/deleteProfile': {
      const config = configManager.getConfig();
      const svc = config[body.section];
      if (!svc || svc.profiles.length <= 1) return { success: false, error: 'Cannot delete last profile' };
      svc.profiles = svc.profiles.filter(p => p.id !== body.profileId);
      if (svc.activeProfileId === body.profileId) svc.activeProfileId = svc.profiles[0].id;
      configManager.saveConfig(config);
      return { success: true, config };
    }
    case 'config/duplicateProfile': {
      const config = configManager.getConfig();
      const svc = config[body.section];
      if (!svc) return { success: false, error: 'Unknown section' };
      const source = svc.profiles.find(p => p.id === body.profileId);
      if (!source) return { success: false, error: 'Profile not found' };
      const clone = JSON.parse(JSON.stringify(source));
      clone.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      clone.name = source.name + ' (copy)';
      svc.profiles.push(clone);
      svc.activeProfileId = clone.id;
      configManager.saveConfig(config);
      return { success: true, config };
    }
    case 'config/setActiveProfile': {
      const config = configManager.getConfig();
      const svc = config[body.section];
      if (!svc) return { success: false, error: 'Unknown section' };
      if (!svc.profiles.find(p => p.id === body.profileId)) return { success: false, error: 'Profile not found' };
      svc.activeProfileId = body.profileId;
      configManager.saveConfig(config);
      return { success: true, config };
    }
    case 'config/export': {
      return { success: true, config: configManager.getConfig() };
    }
    case 'config/import': {
      if (!body.config || (!body.config.general && !body.config.apache && !body.config.nginx)) {
        return { success: false, error: 'Invalid config' };
      }
      configManager.saveConfig(body.config);
      return { success: true, config: body.config };
    }

    // Downloads
    case 'download/getVersions': return downloadManager.getVersionMap();
    case 'download/status': return downloadManager.getStatus ? downloadManager.getStatus() : {};
    case 'download/isInstalled': return downloadManager.isInstalled(body.service, body.version);
    case 'download/installedVersions': return downloadManager.getInstalledVersions(body.service);
    case 'download/install': {
      const result = await downloadManager.download(body.service, body.version, (progress) => {
        broadcastSSE('download:progress', progress);
      });
      return result;
    }
    case 'download/remove': return downloadManager.removeVersion(body.service, body.version);
    case 'download/diskUsage': {
      // Compute disk usage per service
      const usage = {};
      const serversDir = path.join(appRoot, 'servers');
      if (fs.existsSync(serversDir)) {
        for (const svc of fs.readdirSync(serversDir)) {
          const svcDir = path.join(serversDir, svc);
          if (!fs.statSync(svcDir).isDirectory()) continue;
          let total = 0;
          const walk = (dir) => {
            try {
              for (const f of fs.readdirSync(dir)) {
                const fp = path.join(dir, f);
                const st = fs.statSync(fp);
                if (st.isDirectory()) walk(fp); else total += st.size;
              }
            } catch {}
          };
          walk(svcDir);
          usage[svc] = total;
        }
      }
      return usage;
    }

    // Services
    case 'service/start': return serviceManager.startService(body.service);
    case 'service/stop': return serviceManager.stopService(body.service);
    case 'service/restart': {
      await serviceManager.stopService(body.service);
      return serviceManager.startService(body.service);
    }
    case 'service/status': return serviceManager.getServiceStatus(body.service);
    case 'service/allStatuses': return serviceManager.getAllStatuses();
    case 'service/logs': return serviceManager.getLogs(body.service, body.lines);
    case 'service/stopAll': return serviceManager.stopAll();

    // Health Check
    case 'service/healthCheck': {
      const config = configManager.getConfig();
      const profile = configManager.getActiveProfile(config, body.service);
      if (!profile || !profile.port) return { healthy: false, error: 'No port configured' };
      const status = serviceManager.getServiceStatus(body.service);
      if (!status.running) return { healthy: false, error: 'Not running' };
      if (['apache', 'nginx', 'caddy', 'node', 'bun', 'go', 'python', 'deno'].includes(body.service)) {
        const start = Date.now();
        return new Promise((resolve) => {
          const req = http.get(`http://127.0.0.1:${profile.port}/`, { timeout: 3000 }, (res) => {
            resolve({ healthy: true, statusCode: res.statusCode, responseTime: Date.now() - start });
          });
          req.on('error', () => resolve({ healthy: false, error: 'Connection refused' }));
          req.on('timeout', () => { req.destroy(); resolve({ healthy: false, error: 'Timeout' }); });
        });
      }
      if (['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'minio', 'php'].includes(body.service)) {
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
      return { healthy: status.running, pid: status.pid };
    }

    // Auto-start
    case 'service/autoStart': {
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
        if (!profile || !profile.autoStart) continue;
        if (!downloadManager.isInstalled(section, profile.version)) continue;
        const result = await serviceManager.startService(section);
        if (result.success) started.push(section);
      }
      return { started };
    }

    // Resource usage
    case 'service/resourceUsage': {
      const allStatuses = serviceManager.getAllStatuses();
      const result = {};
      const pids = [];
      const pidMap = {};
      for (const [section, status] of Object.entries(allStatuses)) {
        if (status.running && status.pid) { pids.push(status.pid); pidMap[status.pid] = section; }
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
              if (section) result[section] = { memoryMB: Math.round(memKB / 1024 * 10) / 10, pid };
            }
          }
        } else {
          for (const pid of pids) {
            try {
              const output = execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf-8', timeout: 3000 }).trim();
              const memKB = parseInt(output) || 0;
              const section = pidMap[pid];
              if (section) result[section] = { memoryMB: Math.round(memKB / 1024 * 10) / 10, pid };
            } catch {}
          }
        }
      } catch {}
      return result;
    }

    // Database Viewer
    case 'db/listDatabases': return dbViewer.listDatabases(body.section);
    case 'db/listTables': return dbViewer.listTables(body.section, body.database);
    case 'db/tableData': return dbViewer.tableData(body.section, body.database, body.table, body.limit, body.offset);
    case 'db/executeQuery': return dbViewer.executeQuery(body.section, body.database, body.query);
    case 'db/createDatabase': return dbViewer.createDatabase(body.section, body.name);
    case 'db/dropDatabase': return dbViewer.dropDatabase(body.section, body.name);
    case 'db/getToolUrl': {
      await appStoreManager.ensureAdminer();
      return appStoreManager.getDbToolUrl(body.section, body.database);
    }

    // Shell
    case 'shell/openPath': {
      const resolved = path.resolve(body.path);
      if (!resolved.startsWith(appRoot)) return { success: false, error: 'Path outside app root' };
      return { success: true, path: resolved };
    }

    // Projects
    case 'projects/list': {
      const projectsDir = path.resolve('projects', body.section);
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch { return []; }
    }
    case 'projects/create': {
      const safeName = body.name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
      if (!safeName) return { success: false, error: 'Invalid project name' };
      const projectDir = path.resolve('projects', body.section, safeName);
      if (fs.existsSync(projectDir)) return { success: false, error: 'Project already exists' };
      fs.mkdirSync(projectDir, { recursive: true });
      return { success: true, path: projectDir };
    }
    case 'projects/delete': {
      const safeName = body.name.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim();
      const projectDir = path.resolve('projects', body.section, safeName);
      const projectsRoot = path.resolve('projects', body.section);
      if (!projectDir.startsWith(projectsRoot) || !fs.existsSync(projectDir)) return { success: false, error: 'Not found' };
      fs.rmSync(projectDir, { recursive: true, force: true });
      return { success: true };
    }

    // Terminal
    case 'terminal/create': {
      const id = ++terminalIdCounter;
      const env = buildTerminalEnv();
      const isWin = process.platform === 'win32';
      const shell = isWin ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/bash');
      const child = spawn(shell, [], {
        env, cwd: path.resolve('.'), stdio: ['pipe', 'pipe', 'pipe'],
        ...(isWin ? { windowsHide: true } : {})
      });
      terminals.set(id, { process: child, id });
      child.stdout.on('data', (data) => broadcastSSE('terminal:data', { id, data: data.toString() }));
      child.stderr.on('data', (data) => broadcastSSE('terminal:data', { id, data: data.toString() }));
      child.on('exit', (code) => { terminals.delete(id); broadcastSSE('terminal:exit', { id, code }); });
      return { id };
    }
    case 'terminal/write': {
      const term = terminals.get(body.id);
      if (!term) return { success: false, error: 'Terminal not found' };
      term.process.stdin.write(body.data);
      return { success: true };
    }
    case 'terminal/kill': {
      const term = terminals.get(body.id);
      if (!term) return { success: false };
      try { term.process.kill(); } catch {}
      terminals.delete(body.id);
      return { success: true };
    }
    case 'terminal/resize': return { success: true };

    // Composer
    case 'composer/getStatus': {
      const config = configManager.getConfig();
      const phpProfile = configManager.getActiveProfile(config, 'php');
      if (!phpProfile) return { installed: false, phpAvailable: false };
      const version = phpProfile.version;
      if (!downloadManager.isInstalled('php', version)) return { installed: false, phpAvailable: false };
      const phpPath = downloadManager.getInstallPath('php', version);
      const composerPath = path.join(phpPath, 'composer.phar');
      return { installed: fs.existsSync(composerPath), phpAvailable: true, phpPath };
    }
    case 'composer/install': {
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
        const https2 = require('https');
        const setupPath = path.join(phpPath, 'composer-setup.php');
        await new Promise((resolve, reject) => {
          const file = fs.createWriteStream(setupPath);
          https2.get('https://getcomposer.org/installer', (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', (err) => { try { fs.unlinkSync(setupPath); } catch {} reject(err); });
        });
        execSync(`"${phpExe}" "${setupPath}" --install-dir="${phpPath}" --filename=composer.phar`, { encoding: 'utf-8', timeout: 60000 });
        try { fs.unlinkSync(setupPath); } catch {}
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
    case 'composer/run': {
      const config = configManager.getConfig();
      const phpProfile = configManager.getActiveProfile(config, 'php');
      if (!phpProfile) return { success: false, output: 'No active PHP profile' };
      const version = phpProfile.version;
      if (!downloadManager.isInstalled('php', version)) return { success: false, output: 'PHP not installed' };
      const phpPath = downloadManager.getInstallPath('php', version);
      const isWin = process.platform === 'win32';
      const phpExe = path.join(phpPath, isWin ? 'php.exe' : 'bin/php');
      const composerPhar = path.join(phpPath, 'composer.phar');
      if (!fs.existsSync(composerPhar)) return { success: false, output: 'Composer not installed.' };
      const composerArgs = body.command.trim().split(/\s+/).filter(Boolean);
      const allowedCmds = ['install', 'update', 'require', 'remove', 'dump-autoload', 'create-project', 'init', 'show', 'list', 'search', 'validate', 'status', 'self-update', 'config', 'run-script', 'exec', 'outdated', 'audit'];
      if (composerArgs.length > 0 && !allowedCmds.includes(composerArgs[0])) {
        return { success: false, output: `Command "${composerArgs[0]}" is not allowed.` };
      }
      try {
        const { execFileSync } = require('child_process');
        const output = execFileSync(phpExe, [composerPhar, ...composerArgs], {
          encoding: 'utf-8', timeout: 120000,
          cwd: body.cwd && fs.existsSync(body.cwd) ? body.cwd : path.resolve('.'),
          env: { ...process.env, COMPOSER_HOME: path.join(phpPath, 'composer') }
        });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: err.stdout || err.stderr || err.message };
      }
    }

    // PATH management
    case 'path/getStatus': {
      if (process.platform === 'win32') {
        try {
          const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
          const kitsuneEntries = _getKitsunePathEntries();
          const pathParts = userPath.split(';').map(p => p.replace(/\\/g, '/').toLowerCase());
          const added = kitsuneEntries.some(e => pathParts.includes(e.replace(/\\/g, '/').toLowerCase()));
          return { added, entries: kitsuneEntries };
        } catch { return { added: false, entries: [] }; }
      } else {
        try {
          const shellRc = _getShellRcFilePath();
          if (shellRc && fs.existsSync(shellRc)) {
            const content = fs.readFileSync(shellRc, 'utf-8');
            return { added: content.includes('# KitsuneServ PATH'), entries: _getKitsunePathEntries() };
          }
          return { added: false, entries: _getKitsunePathEntries() };
        } catch { return { added: false, entries: [] }; }
      }
    }
    case 'path/add': {
      const entries = _getKitsunePathEntries();
      if (!entries.length) return { success: false, error: 'No installed services' };
      if (process.platform === 'win32') {
        try {
          const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
          const appRootNorm = appRoot.replace(/\\/g, '/').toLowerCase();
          const cleaned = userPath.split(';').filter(Boolean).filter(p => !p.replace(/\\/g, '/').toLowerCase().includes(appRootNorm + '/servers'));
          const newPath = [...entries, ...cleaned].join(';');
          execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${newPath.replace(/'/g, "''")}','User')"`, { encoding: 'utf-8' });
          return { success: true, entries };
        } catch (err) { return { success: false, error: err.message }; }
      } else {
        try {
          const shellRc = _getShellRcFilePath();
          if (!shellRc) return { success: false, error: 'Could not determine shell config' };
          let content = fs.existsSync(shellRc) ? fs.readFileSync(shellRc, 'utf-8') : '';
          content = content.replace(/\n# KitsuneServ PATH - START[\s\S]*?# KitsuneServ PATH - END\n?/g, '');
          content += `\n# KitsuneServ PATH - START\nexport PATH="${entries.join(':')}:$PATH"\n# KitsuneServ PATH - END\n`;
          fs.writeFileSync(shellRc, content, 'utf-8');
          return { success: true, entries };
        } catch (err) { return { success: false, error: err.message }; }
      }
    }
    case 'path/remove': {
      if (process.platform === 'win32') {
        try {
          const userPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf-8' }).trim();
          const appRootNorm = appRoot.replace(/\\/g, '/').toLowerCase();
          const cleaned = userPath.split(';').filter(Boolean).filter(p => !p.replace(/\\/g, '/').toLowerCase().includes(appRootNorm + '/servers'));
          execSync(`powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${cleaned.join(';').replace(/'/g, "''")}','User')"`, { encoding: 'utf-8' });
          return { success: true };
        } catch (err) { return { success: false, error: err.message }; }
      } else {
        try {
          const shellRc = _getShellRcFilePath();
          if (shellRc && fs.existsSync(shellRc)) {
            let content = fs.readFileSync(shellRc, 'utf-8');
            content = content.replace(/\n# KitsuneServ PATH - START[\s\S]*?# KitsuneServ PATH - END\n?/g, '');
            fs.writeFileSync(shellRc, content, 'utf-8');
          }
          return { success: true };
        } catch (err) { return { success: false, error: err.message }; }
      }
    }

    // App Store
    case 'appStore/catalog': return appStoreManager.getCatalog();
    case 'appStore/installed': return appStoreManager.getInstalled();
    case 'appStore/install': return appStoreManager.install(body.appId, body.instanceName);
    case 'appStore/remove': return appStoreManager.remove(body.instanceName);
    case 'appStore/getUrl': return appStoreManager.getUrl(body.instanceName);
    case 'appStore/getExePath': return appStoreManager.getExePath(body.instanceName);
    case 'appStore/addCustomApp': return appStoreManager.addCustomApp(body.opts);
    case 'appStore/removeCustomApp': return appStoreManager.removeCustomApp(body.appId);
    case 'appStore/checkRequirements': return appStoreManager.checkRequirements(body.appId);

    default: return { error: 'Unknown endpoint' };
  }
}

function _getKitsunePathEntries() {
  const config = configManager.getConfig();
  const sections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
  const entries = [];
  for (const section of sections) {
    const profile = configManager.getActiveProfile(config, section);
    if (!profile) continue;
    if (!downloadManager.isInstalled(section, profile.version)) continue;
    const installPath = downloadManager.getInstallPath(section, profile.version);
    const isWin = process.platform === 'win32';
    const binCandidates = {
      apache: ['bin'], nginx: ['.'], caddy: ['.'],
      postgresql: ['bin', 'pgsql/bin'], mysql: ['bin'], mariadb: ['bin'], mongodb: ['bin'],
      php: ['.'], node: [isWin ? '.' : 'bin'], go: ['bin'], bun: ['.'],
      redis: [isWin ? '.' : 'bin'], memcached: ['.', 'bin'], minio: ['.'],
      python: [isWin ? '.' : 'bin'], deno: ['.']
    };
    for (const rel of (binCandidates[section] || ['.'])) {
      const binDir = path.resolve(path.join(installPath, rel));
      if (fs.existsSync(binDir)) entries.push(binDir);
    }
  }
  return entries;
}

function _getShellRcFilePath() {
  const home = process.env.HOME || '';
  if (!home) return null;
  const shell = process.env.SHELL || '';
  return shell.includes('zsh') ? path.join(home, '.zshrc') : path.join(home, '.bashrc');
}

// ============ Parse form body for login ============
function parseFormBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) { req.destroy(); resolve({}); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const params = {};
      for (const pair of raw.split('&')) {
        const [k, v] = pair.split('=').map(decodeURIComponent);
        if (k) params[k] = v || '';
      }
      resolve(params);
    });
  });
}

// ============ HTTP Server ============

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS / security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // ---- Login endpoint ----
  if (pathname === '/auth/login' && req.method === 'POST') {
    const form = await parseFormBody(req);
    const inputUser = form.username || '';
    const inputPass = form.password || '';
    // Constant-time comparison — pad to equal lengths to prevent length-leak via timingSafeEqual
    const maxUserLen = Math.max(inputUser.length, AUTH_USER.length);
    const maxPassLen = Math.max(inputPass.length, AUTH_PASS.length);
    const userOk = inputUser.length === AUTH_USER.length &&
      crypto.timingSafeEqual(Buffer.from(inputUser.padEnd(maxUserLen)), Buffer.from(AUTH_USER.padEnd(maxUserLen)));
    const passOk = inputPass.length === AUTH_PASS.length &&
      crypto.timingSafeEqual(Buffer.from(inputPass.padEnd(maxPassLen)), Buffer.from(AUTH_PASS.padEnd(maxPassLen)));
    if (userOk && passOk) {
      const sessionId = createSession(form.username);
      res.writeHead(302, {
        'Set-Cookie': `kitsune_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}`,
        'Location': '/'
      });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage('Invalid username or password'));
    }
    return;
  }

  // ---- Logout ----
  if (pathname === '/auth/logout') {
    const sid = getSessionIdFromReq(req);
    if (sid) sessions.delete(sid);
    res.writeHead(302, {
      'Set-Cookie': 'kitsune_session=; Path=/; HttpOnly; Max-Age=0',
      'Location': '/'
    });
    res.end();
    return;
  }

  // ---- Auth check for everything else ----
  const sessionId = getSessionIdFromReq(req);
  if (!validateSession(sessionId)) {
    // Unauthenticated
    if (pathname.startsWith('/api/')) {
      sendJSON(res, { error: 'Unauthorized' }, 401);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage());
    }
    return;
  }

  // ---- SSE events endpoint ----
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(':\n\n'); // initial heartbeat
    sseClients.add(res);
    // Periodic keepalive to prevent connection drops (every 25s)
    const heartbeat = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(heartbeat); sseClients.delete(res); }
    }, 25000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return;
  }

  // ---- API endpoints ----
  if (pathname.startsWith('/api/') && req.method === 'POST') {
    const endpoint = pathname.slice(5); // strip '/api/'
    try {
      const body = await parseBody(req);
      const result = await handleAPI(endpoint, body);
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---- Serve web-preload.js (API adapter) ----
  if (pathname === '/web-preload.js') {
    const content = getWebPreload();
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(content)
    });
    res.end(content);
    return;
  }

  // ---- Serve static files (renderer) ----
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(__dirname, 'renderer', 'index.html');
  } else {
    // Prevent path traversal
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    filePath = path.join(__dirname, 'renderer', safePath);
  }

  // Security: ensure file is within renderer directory
  const rendererDir = path.join(__dirname, 'renderer');
  if (!filePath.startsWith(rendererDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (pathname === '/' || pathname === '/index.html') {
    // Inject web-preload.js into HTML
    try {
      let html = fs.readFileSync(filePath, 'utf-8');
      // Hide titlebar controls (minimize/maximize/close) in web mode
      html = html.replace('</head>', '<script>window.__KITSUNE_WEB_MODE__ = true;</script><script src="/web-preload.js"></script></head>');
      // Remove Electron-specific CSP that blocks inline scripts
      html = html.replace(
        /content="default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'"/,
        'content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; connect-src \'self\'"'
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
    return;
  }

  sendFile(res, filePath, contentType);
});

// ============ Graceful shutdown ============
async function shutdown() {
  console.log('\n[KitsuneServ] Shutting down...');
  await serviceManager.stopAll();
  for (const term of terminals.values()) {
    try { term.process.kill(); } catch {}
  }
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============ Start ============
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       🦊 KitsuneServ — Server Mode       ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  URL:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`.padEnd(46) + '║');
  console.log(`  ║  User: ${AUTH_USER}`.padEnd(46) + '║');
  if (!process.env.KITSUNE_PASS) {
    console.log(`  ║  Pass: ${AUTH_PASS}`.padEnd(46) + '║');
    console.log('  ║  (auto-generated, set KITSUNE_PASS to fix) ║');
  } else {
    console.log(`  ║  Pass: ********`.padEnd(46) + '║');
  }
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
