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
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const { isPathInside, resolveInside, assertProjectSection, assertProjectName } = require('./path-utils');
const { initializeServerDataRoot } = require('./runtime-paths');
const { timingSafeTextEqual, verifyTotp, isIpAllowed, normalizeIp } = require('./auth-utils');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, def) {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
}

const PORT = parseInt(getArg('port', process.env.KITSUNE_PORT || '10000'), 10);
const HOST = getArg('host', process.env.KITSUNE_HOST || '127.0.0.1');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('KITSUNE_PORT must be an integer between 1 and 65535');
}
const TLS_CERT_PATH = process.env.KITSUNE_TLS_CERT;
const TLS_KEY_PATH = process.env.KITSUNE_TLS_KEY;
if (Boolean(TLS_CERT_PATH) !== Boolean(TLS_KEY_PATH)) {
  throw new Error('KITSUNE_TLS_CERT and KITSUNE_TLS_KEY must be provided together');
}
const IS_HTTPS = Boolean(TLS_CERT_PATH && TLS_KEY_PATH);

// Authentication credentials (from env or auto-generated)
const AUTH_USER = process.env.KITSUNE_USER || 'admin';
const AUTH_PASS = process.env.KITSUNE_PASS || crypto.randomBytes(12).toString('base64url');
const API_TOKEN = process.env.KITSUNE_API_TOKEN || '';
const TOTP_SECRET = process.env.KITSUNE_TOTP_SECRET || '';
const ALLOWED_IPS = String(process.env.KITSUNE_ALLOWED_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
// Sessions store (in-memory)
const sessions = new Map();
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const loginAttempts = new Map();
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_LIMIT = 10;

// Static application files and mutable user data deliberately use separate roots.
const codeRoot = path.resolve(__dirname, '..');
const { dataRoot: appRoot, defaultsRoot } = initializeServerDataRoot(codeRoot);
process.chdir(appRoot);

// Import managers
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
const { PathManager } = require('./path-manager');

const configManager = new ConfigManager(appRoot);
const downloadManager = new DownloadManager({ appRoot, catalogRoot: defaultsRoot });
const serviceManager = new ServiceManager(downloadManager, configManager);
const pathManager = new PathManager(downloadManager, configManager, {
  systemIntegrationDisabled: process.env.KITSUNE_DISABLE_SYSTEM_INTEGRATION === '1'
});
try {
  const selectedPathServices = pathManager.getSelectedServices();
  if (selectedPathServices.length || pathManager.hasManagedEntries()) pathManager.sync(selectedPathServices);
} catch (err) {
  console.warn('Could not synchronize the user PATH:', err.message);
}
const activityManager = new ActivityManager(appRoot);
const secretStore = new SecretStore(appRoot);
const dbViewer = new DbViewer(downloadManager, configManager, serviceManager, secretStore);
const backupManager = new BackupManager(appRoot, configManager, downloadManager, dbViewer, activityManager);
const backupTimer = setInterval(() => backupManager.runDue().catch(error => console.warn('[KitsuneServ] Scheduled backup warning:', error.message)), 60_000);
backupTimer.unref();
setTimeout(() => backupManager.runDue().catch(error => console.warn('[KitsuneServ] Scheduled backup warning:', error.message)), 5_000).unref();
const appStoreManager = new AppStoreManager(downloadManager, configManager, dbViewer, serviceManager);
const domainManager = new DomainManager(appRoot);
const projectManager = new ProjectManager(appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager);
const pluginManager = new PluginManager(appRoot);
projectManager.setTemplateProvider(() => pluginManager.projectTemplates());
const platformManager = new PlatformManager(appRoot);
const tunnelManager = new TunnelManager(projectManager);
const updateManager = new UpdateManager(appRoot, require('../package.json').version, activityManager, { allowInstall: false });
const diagnosticsManager = new DiagnosticsManager(appRoot, configManager, downloadManager, serviceManager, pathManager);
const commandManager = new CommandManager(projectManager, pathManager, activityManager, { allowDesktopIntegration: false, platformManager });
commandManager.setToolProvider(() => pluginManager.tools());
const environmentManager = new EnvironmentManager(appRoot, configManager, downloadManager, projectManager, pathManager, serviceManager);
const supportManager = new SupportManager(appRoot, { configManager, downloadManager, serviceManager, diagnosticsManager, projectManager, activityManager, environmentManager, pluginManager, platformManager });
activityManager.on('changed', payload => broadcastSSE('activity:changed', payload));
commandManager.onOutput = payload => broadcastSSE('command:output', payload);
commandManager.onExit = payload => broadcastSSE('command:exit', payload);
tunnelManager.onChanged = payload => broadcastSSE('tunnel:changed', payload);

// ============ Session helpers ============

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(username, req) {
  const id = generateSessionId();
  sessions.set(id, {
    username, createdAt: Date.now(), lastSeenAt: Date.now(),
    address: normalizeIp(req?.socket?.remoteAddress || ''),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300)
  });
  return id;
}

function validateSession(sessionId) {
  const now = Date.now();
  for (const [id, value] of sessions) {
    if (now - value.createdAt > SESSION_MAX_AGE) {
      sessions.delete(id);
      terminateSessionResources(id);
    }
  }
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (now - session.createdAt > SESSION_MAX_AGE) {
    sessions.delete(sessionId);
    return false;
  }
  session.lastSeenAt = now;
  return true;
}

function getSessionIdFromReq(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/kitsune_session=([a-f0-9]{64})/);
  return match ? match[1] : null;
}

function getClientKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

function isLoginRateLimited(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const recent = (loginAttempts.get(key) || []).filter(time => now - time < LOGIN_WINDOW);
  loginAttempts.set(key, recent);
  return recent.length >= LOGIN_LIMIT;
}

function recordFailedLogin(req) {
  const key = getClientKey(req);
  const attempts = loginAttempts.get(key) || [];
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

function hasValidOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host && ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function hasValidApiToken(req) {
  if (!API_TOKEN) return false;
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return Boolean(match && timingSafeTextEqual(match[1], API_TOKEN));
}

// ============ HTTP helpers ============

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const MAX_BODY = 10 * 1024 * 1024; // 10MB limit
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        settled = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON request body'));
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
    ${TOTP_SECRET ? '<label for="totp">Authenticator code</label><input type="text" id="totp" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>' : ''}
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
window.__KITSUNE_WEB_MODE__ = true;
window.kitsuneAPI = {
  _call: async function(endpoint, data) {
    const res = await fetch('/api/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data || {}),
      credentials: 'same-origin'
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || ('Request failed: ' + res.status));
    return payload;
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
    setDocumentRoot: (section, directory) => window.kitsuneAPI._call('config/setDocumentRoot', { section, directory }),
    setGlobalDocumentRoot: (enabled, directory) => window.kitsuneAPI._call('config/setGlobalDocumentRoot', { enabled, directory }),
    renameProfile: (section, profileId, newName) => window.kitsuneAPI._call('config/renameProfile', { section, profileId, newName }),
    exportConfig: async () => {
      const result = await window.kitsuneAPI._call('config/export');
      if (result.success && result.config) {
        const blob = new Blob([JSON.stringify(result.config, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'kitsuneserv-config.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      return result;
    },
    importConfig: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return resolve({ success: false, canceled: true });
        if (file.size > 10 * 1024 * 1024) return resolve({ success: false, error: 'Configuration file is too large' });
        try {
          const config = JSON.parse(await file.text());
          resolve(await window.kitsuneAPI._call('config/import', { config }));
        } catch (error) {
          resolve({ success: false, error: error.message || 'Invalid configuration file' });
        }
      }, { once: true });
      input.click();
    })
  },
  download: {
    getVersions: () => window.kitsuneAPI._call('download/getVersions'),
    catalog: () => window.kitsuneAPI._call('download/catalog'),
    refreshCatalog: () => window.kitsuneAPI._call('download/refreshCatalog'),
    status: () => window.kitsuneAPI._call('download/status'),
    isInstalled: (service, version) => window.kitsuneAPI._call('download/isInstalled', { service, version }),
    installedVersions: (service) => window.kitsuneAPI._call('download/installedVersions', { service }),
    install: (service, version) => window.kitsuneAPI._call('download/install', { service, version }),
    remove: (service, version) => window.kitsuneAPI._call('download/remove', { service, version }),
    diskUsage: () => window.kitsuneAPI._call('download/diskUsage'),
    cacheStatus: () => window.kitsuneAPI._call('download/cacheStatus'),
    clearCache: (service, version) => window.kitsuneAPI._call('download/clearCache', { service, version }),
    exportCache: (directory) => window.kitsuneAPI._call('download/exportCache', { directory }),
    importCache: (directory) => window.kitsuneAPI._call('download/importCache', { directory }),
    onProgress: (cb) => { window._kitsuneProgressCb = cb; }
  },
  app: {
    getInfo: () => window.kitsuneAPI._call('app/getInfo')
  },
  db: {
    listDatabases: (section) => window.kitsuneAPI._call('db/listDatabases', { section }),
    listTables: (section, database) => window.kitsuneAPI._call('db/listTables', { section, database }),
    tableData: (section, database, table, limit, offset) => window.kitsuneAPI._call('db/tableData', { section, database, table, limit, offset }),
    executeQuery: (section, database, query) => window.kitsuneAPI._call('db/executeQuery', { section, database, query }),
    createDatabase: (section, name) => window.kitsuneAPI._call('db/createDatabase', { section, name }),
    dropDatabase: (section, name) => window.kitsuneAPI._call('db/dropDatabase', { section, name }),
    getToolUrl: (section, database) => window.kitsuneAPI._call('db/getToolUrl', { section, database }),
    connections: () => window.kitsuneAPI._call('db/connections'),
    saveConnection: (connection) => window.kitsuneAPI._call('db/saveConnection', { connection }),
    removeConnection: (id) => window.kitsuneAPI._call('db/removeConnection', { id }),
    testConnection: (connection) => window.kitsuneAPI._call('db/testConnection', { connection }),
    listDatabasesFor: (connection) => window.kitsuneAPI._call('db/listDatabasesFor', { connection }),
    listTablesFor: (connection, database) => window.kitsuneAPI._call('db/listTablesFor', { connection, database }),
    executeQueryFor: (connection, database, query) => window.kitsuneAPI._call('db/executeQueryFor', { connection, database, query }),
    createDatabaseFor: (connection, name) => window.kitsuneAPI._call('db/createDatabaseFor', { connection, name }),
    dropDatabaseFor: (connection, name) => window.kitsuneAPI._call('db/dropDatabaseFor', { connection, name })
  },
  backup: {
    list: (filters) => window.kitsuneAPI._call('backup/list', { filters }),
    create: (connection, database, options) => window.kitsuneAPI._call('backup/create', { connection, database, options }),
    verify: (id) => window.kitsuneAPI._call('backup/verify', { id }),
    restore: (id, connection, database) => window.kitsuneAPI._call('backup/restore', { id, connection, database }),
    remove: (id) => window.kitsuneAPI._call('backup/remove', { id }),
    schedules: () => window.kitsuneAPI._call('backup/schedules'),
    saveSchedule: (schedule) => window.kitsuneAPI._call('backup/saveSchedule', { schedule }),
    removeSchedule: (id) => window.kitsuneAPI._call('backup/removeSchedule', { id }),
    runDue: () => window.kitsuneAPI._call('backup/runDue')
  },
  service: {
    start: (service) => window.kitsuneAPI._call('service/start', { service }),
    stop: (service) => window.kitsuneAPI._call('service/stop', { service }),
    restart: (service) => window.kitsuneAPI._call('service/restart', { service }),
    switchVersion: (service, version) => window.kitsuneAPI._call('service/switchVersion', { service, version }),
    status: (service) => window.kitsuneAPI._call('service/status', { service }),
    allStatuses: () => window.kitsuneAPI._call('service/allStatuses'),
    logs: (service, lines) => window.kitsuneAPI._call('service/logs', { service, lines }),
    clearLogs: (service) => window.kitsuneAPI._call('service/clearLogs', { service }),
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
    apply: (services) => window.kitsuneAPI._call('path/apply', { services }),
    add: (services) => window.kitsuneAPI._call('path/add', { services }),
    remove: (services) => window.kitsuneAPI._call('path/remove', { services }),
    installPythonManager: () => window.kitsuneAPI._call('path/installPythonManager'),
    onPythonManagerStatus: (cb) => { window._kitsunePythonManagerCb = cb; }
  },
  composer: {
    getStatus: () => window.kitsuneAPI._call('composer/getStatus'),
    install: () => window.kitsuneAPI._call('composer/install'),
    run: (command, cwd) => window.kitsuneAPI._call('composer/run', { command, cwd })
  },
  shell: {
    openPath: async (p) => {
      const result = await window.kitsuneAPI._call('shell/openPath', { path: p });
      if (result.success && result.path && navigator.clipboard) {
        try { await navigator.clipboard.writeText(result.path); result.copied = true; } catch {}
      }
      return result;
    },
    selectDirectory: (initialPath) => window.kitsuneAPI._selectServerDirectory(initialPath),
    openExternal: (url) => {
      try {
        const parsed = new URL(url, window.location.href);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) throw new Error('Invalid URL');
        const loopback = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', '::', '[::]'];
        if (loopback.includes(parsed.hostname.toLowerCase()) && !loopback.includes(window.location.hostname.toLowerCase())) {
          parsed.hostname = window.location.hostname;
        }
        window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
        return Promise.resolve({ success: true });
      } catch { return Promise.resolve({ success: false, error: 'Invalid URL' }); }
    },
    openSystemSettings: () => Promise.resolve({ success: false, error: 'Windows Settings can only be opened from desktop mode' })
  },
  projects: {
    list: (section) => window.kitsuneAPI._call('projects/list', { section }),
    create: (section, name) => window.kitsuneAPI._call('projects/create', { section, name }),
    delete: (section, name) => window.kitsuneAPI._call('projects/delete', { section, name })
  },
  workspace: {
    templates: () => window.kitsuneAPI._call('workspace/templates'),
    list: () => window.kitsuneAPI._call('workspace/list'),
    get: (id) => window.kitsuneAPI._call('workspace/get', { id }),
    create: (options) => window.kitsuneAPI._call('workspace/create', { options }),
    update: (id, patch) => window.kitsuneAPI._call('workspace/update', { id, patch }),
    remove: (id, options) => window.kitsuneAPI._call('workspace/remove', { id, options }),
    start: (id) => window.kitsuneAPI._call('workspace/start', { id }),
    stop: (id) => window.kitsuneAPI._call('workspace/stop', { id }),
    export: (id) => window.kitsuneAPI._call('workspace/export', { id }),
    import: (manifest, options) => window.kitsuneAPI._call('workspace/import', { manifest, options }),
    url: (id) => window.kitsuneAPI._call('workspace/url', { id }),
    open: (id) => window.kitsuneAPI._call('workspace/open', { id })
  },
  activity: {
    list: (options) => window.kitsuneAPI._call('activity/list', { options }),
    cancel: (id) => window.kitsuneAPI._call('activity/cancel', { id }),
    clear: () => window.kitsuneAPI._call('activity/clear'),
    onChanged: (cb) => { window._kitsuneActivityCb = cb; }
  },
  diagnostics: {
    doctor: (projectId) => window.kitsuneAPI._call('diagnostics/doctor', { projectId }),
    compatibility: (projectId) => window.kitsuneAPI._call('diagnostics/compatibility', { projectId }),
    ports: () => window.kitsuneAPI._call('diagnostics/ports'),
    findFreePort: (start, end) => window.kitsuneAPI._call('diagnostics/findFreePort', { start, end }),
    repair: (issue) => window.kitsuneAPI._call('diagnostics/repair', { issue })
  },
  domain: {
    status: () => window.kitsuneAPI._call('domain/status'),
    apply: () => window.kitsuneAPI._call('domain/apply'),
    certificateStatus: (domain) => window.kitsuneAPI._call('domain/certificateStatus', { domain }),
    installCertificateAuthority: () => window.kitsuneAPI._call('domain/installCertificateAuthority'),
    issueCertificate: (domain) => window.kitsuneAPI._call('domain/issueCertificate', { domain })
  },
  command: {
    start: (projectId, name, execution, distribution) => window.kitsuneAPI._call('command/start', { projectId, name, execution, distribution }),
    stop: (id) => window.kitsuneAPI._call('command/stop', { id }),
    list: (projectId) => window.kitsuneAPI._call('command/list', { projectId }),
    get: (id) => window.kitsuneAPI._call('command/get', { id }),
    clear: () => window.kitsuneAPI._call('command/clear'),
    onOutput: (cb) => { window._kitsuneCommandOutputCb = cb; },
    onExit: (cb) => { window._kitsuneCommandExitCb = cb; }
  },
  toolchain: { list: () => window.kitsuneAPI._call('toolchain/list') },
  ide: {
    list: () => window.kitsuneAPI._call('ide/list'),
    open: (projectId, ideId) => window.kitsuneAPI._call('ide/open', { projectId, ideId })
  },
  environment: {
    export: (label) => window.kitsuneAPI._call('environment/export', { label }),
    inspect: (payload) => window.kitsuneAPI._call('environment/inspect', { payload }),
    apply: (payload, options) => window.kitsuneAPI._call('environment/apply', { payload, options }),
    createSnapshot: (label) => window.kitsuneAPI._call('environment/createSnapshot', { label }),
    listSnapshots: () => window.kitsuneAPI._call('environment/listSnapshots'),
    restoreSnapshot: (id, options) => window.kitsuneAPI._call('environment/restoreSnapshot', { id, options }),
    removeSnapshot: (id) => window.kitsuneAPI._call('environment/removeSnapshot', { id })
  },
  plugin: {
    list: () => window.kitsuneAPI._call('plugin/list'),
    install: (directory) => window.kitsuneAPI._call('plugin/install', { directory }),
    setEnabled: (id, enabled) => window.kitsuneAPI._call('plugin/setEnabled', { id, enabled }),
    remove: (id) => window.kitsuneAPI._call('plugin/remove', { id })
  },
  platform: {
    inventory: () => window.kitsuneAPI._call('platform/inventory'),
    wslPath: (directory, distribution) => window.kitsuneAPI._call('platform/wslPath', { directory, distribution }),
    installSystemd: (options) => window.kitsuneAPI._call('platform/installSystemd', { options }),
    removeSystemd: () => window.kitsuneAPI._call('platform/removeSystemd')
  },
  tunnel: {
    providers: () => window.kitsuneAPI._call('tunnel/providers'),
    list: (projectId) => window.kitsuneAPI._call('tunnel/list', { projectId }),
    start: (projectId, provider) => window.kitsuneAPI._call('tunnel/start', { projectId, provider }),
    stop: (id) => window.kitsuneAPI._call('tunnel/stop', { id }),
    onChanged: (cb) => { window._kitsuneTunnelCb = cb; }
  },
  update: {
    status: () => window.kitsuneAPI._call('update/status'),
    check: () => window.kitsuneAPI._call('update/check'),
    download: () => window.kitsuneAPI._call('update/download'),
    install: () => window.kitsuneAPI._call('update/install')
  },
  support: { generate: () => window.kitsuneAPI._call('support/generate') },
  security: {
    status: () => window.kitsuneAPI._call('security/status'),
    sessions: () => window.kitsuneAPI._call('security/sessions'),
    revokeSession: (id) => window.kitsuneAPI._call('security/revokeSession', { id }),
    revokeOtherSessions: () => window.kitsuneAPI._call('security/revokeOtherSessions')
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

window.kitsuneAPI._selectServerDirectory = function(initialPath) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(760px,96vw);max-height:82vh;display:flex;flex-direction:column;gap:12px;background:#17172a;border:1px solid #34345a;border-radius:12px;padding:18px;color:#eee;box-shadow:0 20px 60px rgba(0,0,0,.5)';
    box.innerHTML = '<strong style="font-size:17px">Choose a directory on the server</strong><div style="display:flex;gap:8px"><button type="button" data-up>↑ Up</button><input data-path style="flex:1;background:#10101d;color:#eee;border:1px solid #3a3a5c;border-radius:6px;padding:9px" spellcheck="false"></div><div data-roots style="display:flex;gap:6px;flex-wrap:wrap"></div><div data-error style="color:#ff7d91;min-height:18px;font-size:12px"></div><div data-list style="min-height:220px;overflow:auto;border:1px solid #30304f;border-radius:7px;background:#10101b"></div><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" data-cancel>Cancel</button><button type="button" data-select>Select this directory</button></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const pathInput = box.querySelector('[data-path]');
    const list = box.querySelector('[data-list]');
    const error = box.querySelector('[data-error]');
    const roots = box.querySelector('[data-roots]');
    let current = initialPath || '';
    let parent = '';
    const finish = (value) => { overlay.remove(); resolve(value); };
    const load = async (directory) => {
      error.textContent = 'Loading…';
      try {
        const result = await window.kitsuneAPI._call('shell/listDirectories', { path: directory || '' });
        current = result.current;
        parent = result.parent || '';
        pathInput.value = current;
        error.textContent = '';
        roots.innerHTML = '';
        for (const root of result.roots || []) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = root;
          button.addEventListener('click', () => load(root));
          roots.appendChild(button);
        }
        list.innerHTML = '';
        if (!result.entries.length) list.innerHTML = '<div style="padding:14px;color:#888">No subdirectories</div>';
        for (const entry of result.entries) {
          const row = document.createElement('button');
          row.type = 'button'; row.textContent = '📁 ' + entry.name;
          row.style.cssText = 'display:block;width:100%;padding:10px 12px;text-align:left;background:transparent;color:#ddd;border:0;border-bottom:1px solid #252540;cursor:pointer';
          row.addEventListener('click', () => load(entry.path));
          list.appendChild(row);
        }
      } catch (err) { error.textContent = err.message; }
    };
    box.querySelector('[data-up]').addEventListener('click', () => parent && load(parent));
    box.querySelector('[data-cancel]').addEventListener('click', () => finish({ success: false, canceled: true }));
    box.querySelector('[data-select]').addEventListener('click', async () => {
      try {
        const checked = await window.kitsuneAPI._call('shell/listDirectories', { path: pathInput.value });
        finish({ success: true, path: checked.current });
      } catch (err) { error.textContent = err.message; }
    });
    pathInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') load(pathInput.value); });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish({ success: false, canceled: true }); });
    load(current);
  });
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
      if (msg.type === 'path:pythonManagerStatus' && window._kitsunePythonManagerCb) window._kitsunePythonManagerCb(msg.payload);
      if (msg.type === 'activity:changed' && window._kitsuneActivityCb) window._kitsuneActivityCb(msg.payload);
      if (msg.type === 'command:output' && window._kitsuneCommandOutputCb) window._kitsuneCommandOutputCb(msg.payload);
      if (msg.type === 'command:exit' && window._kitsuneCommandExitCb) window._kitsuneCommandExitCb(msg.payload);
      if (msg.type === 'tunnel:changed' && window._kitsuneTunnelCb) window._kitsuneTunnelCb(msg.payload);
    } catch {}
  };
})();
`;
}

// ============ SSE clients ============
const sseClients = new Map();

function broadcastSSE(type, payload, targetSessionId = null) {
  const data = JSON.stringify({ type, payload });
  for (const [res, sessionId] of sseClients) {
    if (targetSessionId && sessionId !== targetSessionId) continue;
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

function terminateSessionResources(sessionId) {
  for (const [id, terminal] of terminals) {
    if (terminal.sessionId !== sessionId) continue;
    try { terminal.process.kill(); } catch {}
    terminals.delete(id);
  }
  for (const [res, clientSessionId] of sseClients) {
    if (clientSessionId !== sessionId) continue;
    try { res.end(); } catch {}
    sseClients.delete(res);
  }
}

function buildTerminalEnv() {
  return pathManager.buildEnvironment(process.env);
}

// ============ API Router ============

const net = require('net');

async function syncPathAfterChange(section, result) {
  if (!result?.success) return result;
  const pathResult = pathManager.syncIfSelected(section);
  return pathResult.success
    ? { ...result, pathUpdated: !pathResult.skipped, ...(pathResult.warning ? { pathWarning: pathResult.warning } : {}) }
    : { ...result, pathWarning: pathResult.error };
}

function syncPathForConfigTransition(previous, current, result) {
  if (!result?.success) return result;
  const pathResult = pathManager.syncForConfigTransition(previous, current);
  if (pathResult.skipped) return result;
  return pathResult.success
    ? { ...result, pathUpdated: true, ...(pathResult.warning ? { pathWarning: pathResult.warning } : {}) }
    : { ...result, pathWarning: pathResult.error };
}

async function handleAPI(endpoint, body, context = {}) {
  switch (endpoint) {
    case 'security/status': return {
      mode: 'server', https: IS_HTTPS, totpEnabled: Boolean(TOTP_SECRET), apiTokenEnabled: Boolean(API_TOKEN),
      allowlistEnabled: ALLOWED_IPS.length > 0, allowedRules: ALLOWED_IPS, currentSessionId: context.sessionId || null,
      sessionCount: sessions.size, clientAddress: context.clientAddress || ''
    };
    case 'security/sessions': return [...sessions.entries()].map(([id, session]) => ({ id, ...session, current: id === context.sessionId }));
    case 'security/revokeSession': {
      const id = String(body.id || '');
      if (!/^[a-f0-9]{64}$/.test(id) || !sessions.has(id)) return { success: false, error: 'Session not found' };
      sessions.delete(id); terminateSessionResources(id); return { success: true, revokedCurrent: id === context.sessionId };
    }
    case 'security/revokeOtherSessions': {
      let removed = 0;
      for (const id of [...sessions.keys()]) if (id !== context.sessionId) { sessions.delete(id); terminateSessionResources(id); removed += 1; }
      return { success: true, removed };
    }
    // Config
    case 'config/get': return configManager.getConfig();
    case 'config/save': {
      const previous = configManager.getConfig();
      const validation = serviceManager.validateConfigChange(body.config);
      if (!validation.success) return validation;
      const result = configManager.saveConfig(body.config);
      return syncPathForConfigTransition(previous, configManager.getConfig(), result);
    }
    case 'config/reset': {
      const previous = configManager.getConfig();
      const defaults = configManager.getDefaults();
      const validation = serviceManager.validateConfigChange(defaults);
      if (!validation.success) return validation;
      const result = configManager.saveConfig(defaults);
      return syncPathForConfigTransition(previous, configManager.getConfig(), result);
    }
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
      const saved = configManager.saveConfig(config);
      if (!saved.success) return saved;
      const switched = await syncPathAfterChange(section, await serviceManager.switchProfile(section, profile.id));
      return { ...switched, profile, config: switched.config || configManager.getConfig() };
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
      let config = configManager.getConfig();
      let svc = config[body.section];
      if (!svc || svc.profiles.length <= 1) return { success: false, error: 'Cannot delete last profile' };
      if (!svc.profiles.some(profile => profile.id === body.profileId)) return { success: false, error: 'Profile not found' };
      if (svc.activeProfileId === body.profileId) {
        const replacement = svc.profiles.find(profile => profile.id !== body.profileId);
        const switched = await syncPathAfterChange(body.section, await serviceManager.switchProfile(body.section, replacement.id));
        if (!switched.success) return switched;
        config = configManager.getConfig();
        svc = config[body.section];
      }
      svc.profiles = svc.profiles.filter(p => p.id !== body.profileId);
      const saved = configManager.saveConfig(config);
      return saved.success ? { success: true, config: configManager.getConfig() } : saved;
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
      const saved = configManager.saveConfig(config);
      if (!saved.success) return saved;
      return syncPathAfterChange(body.section, await serviceManager.switchProfile(body.section, clone.id));
    }
    case 'config/setActiveProfile': {
      return syncPathAfterChange(body.section, await serviceManager.switchProfile(body.section, body.profileId));
    }
    case 'config/setDocumentRoot': return serviceManager.setDocumentRoot(body.section, body.directory);
    case 'config/setGlobalDocumentRoot': return serviceManager.setGlobalDocumentRoot(body.enabled, body.directory);
    case 'config/export': {
      return { success: true, config: configManager.getConfig() };
    }
    case 'config/import': {
      if (!body.config || (!body.config.general && !body.config.apache && !body.config.nginx)) {
        return { success: false, error: 'Invalid config' };
      }
      const validation = serviceManager.validateConfigChange(body.config);
      if (!validation.success) return validation;
      const previous = configManager.getConfig();
      const saved = configManager.saveConfig(body.config);
      if (!saved.success) return saved;
      const current = configManager.getConfig();
      return { ...syncPathForConfigTransition(previous, current, { success: true }), config: current };
    }

    // Downloads
    case 'download/getVersions': return downloadManager.getVersionMap();
    case 'download/catalog': return downloadManager.getCatalog();
    case 'download/refreshCatalog': return downloadManager.refreshCatalog();
    case 'download/status': return downloadManager.getStatus ? downloadManager.getStatus() : {};
    case 'download/isInstalled': return downloadManager.isInstalled(body.service, body.version);
    case 'download/installedVersions': return downloadManager.getInstalledVersions(body.service);
    case 'download/install': {
      const result = await downloadManager.download(body.service, body.version, (progress) => {
        broadcastSSE('download:progress', progress);
      });
      if (result.success) {
        if (body.service === 'python' && process.platform === 'win32') {
          broadcastSSE('download:progress', { service: body.service, version: body.version, stage: 'python-manager', percent: 100 });
          broadcastSSE('path:pythonManagerStatus', { stage: 'installing', automatic: true });
          const managerResult = await pathManager.installOfficialPythonManager();
          if (!managerResult.success) result.pythonManagerWarning = managerResult.error;
          broadcastSSE('path:pythonManagerStatus', {
            stage: managerResult.success ? 'complete' : 'failed', automatic: true,
            alreadyInstalled: Boolean(managerResult.alreadyInstalled), error: managerResult.error || ''
          });
          broadcastSSE('download:progress', { service: body.service, version: body.version, stage: 'done', percent: 100 });
        }
        const pathResult = pathManager.syncIfSelected(body.service);
        if (!pathResult.success) result.pathWarning = pathResult.error;
      }
      return result;
    }
    case 'download/remove': {
      const config = configManager.getConfig();
      if (config[body.service]?.profiles?.some(profile => profile.version === body.version)) {
        return { success: false, error: `${body.service} ${body.version} is used by a profile. Change or delete that profile first.` };
      }
      const result = downloadManager.removeVersion(body.service, body.version);
      if (result.success && body.service === 'python') {
        const pathResult = pathManager.syncIfSelected('python');
        if (!pathResult.success) result.pathWarning = pathResult.error;
        if (downloadManager.getInstalledVersions('python').length === 0) {
          broadcastSSE('path:pythonManagerStatus', { stage: 'removing', automatic: true });
          const managerResult = await pathManager.uninstallOfficialPythonManagerIfUnused();
          if (!managerResult.success) result.pythonManagerWarning = managerResult.error;
          broadcastSSE('path:pythonManagerStatus', {
            stage: managerResult.success ? 'removed' : 'failed', automatic: true,
            skipped: Boolean(managerResult.skipped), error: managerResult.error || ''
          });
        }
      }
      return result;
    }
    case 'app/getInfo': {
      const packageInfo = require('../package.json');
      return { name: 'KitsuneServ', version: packageInfo.version, dataRoot: appRoot, platform: process.platform, mode: 'server' };
    }
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
    case 'download/cacheStatus': return downloadManager.cacheStatus();
    case 'download/clearCache': return downloadManager.clearCache(body.service, body.version);
    case 'download/exportCache': return downloadManager.exportCache(body.directory);
    case 'download/importCache': return downloadManager.importCache(body.directory);
    case 'service/switchVersion': return syncPathAfterChange(body.service, await serviceManager.switchVersion(body.service, body.version));
    case 'service/status': return serviceManager.getServiceStatus(body.service);
    case 'service/allStatuses': return serviceManager.getAllStatuses();
    case 'service/logs': return serviceManager.getLogs(body.service, body.lines);
    case 'service/clearLogs': return serviceManager.clearLogs(body.service);
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
    case 'db/connections': return dbViewer.listConnections();
    case 'db/saveConnection': return dbViewer.saveConnection(body.connection);
    case 'db/removeConnection': return dbViewer.removeConnection(body.id);
    case 'db/testConnection': return dbViewer.testConnection(body.connection);
    case 'db/listDatabasesFor': return dbViewer.listDatabasesFor(body.connection);
    case 'db/listTablesFor': return dbViewer.listTablesFor(body.connection, body.database);
    case 'db/executeQueryFor': return dbViewer.executeQueryFor(body.connection, body.database, body.query);
    case 'db/createDatabaseFor': return dbViewer.createDatabaseFor(body.connection, body.name);
    case 'db/dropDatabaseFor': return dbViewer.dropDatabaseFor(body.connection, body.name);
    case 'db/getToolUrl': {
      await appStoreManager.ensureAdminer();
      return appStoreManager.getDbToolUrl(body.section, body.database);
    }

    // Shell
    case 'shell/openPath': {
      if (typeof body.path !== 'string') return { success: false, error: 'Invalid path' };
      const resolved = path.resolve(body.path);
      if (!fs.existsSync(resolved)) return { success: false, error: 'Path does not exist' };
      return { success: true, path: resolved };
    }
    case 'backup/list': return backupManager.list(body.filters || {});
    case 'backup/create': return backupManager.create(body.connection, body.database, body.options || {});
    case 'backup/verify': return backupManager.verify(body.id);
    case 'backup/restore': return backupManager.restore(body.id, body.connection, body.database);
    case 'backup/remove': return backupManager.remove(body.id);
    case 'backup/schedules': return backupManager.schedules();
    case 'backup/saveSchedule': return backupManager.saveSchedule(body.schedule);
    case 'backup/removeSchedule': return backupManager.removeSchedule(body.id);
    case 'backup/runDue': return backupManager.runDue();
    case 'shell/listDirectories': {
      const requested = typeof body.path === 'string' && body.path.trim() ? body.path.trim() : appRoot;
      const current = path.resolve(requested);
      let stat;
      try { stat = fs.statSync(current); } catch { throw new HttpError(404, 'Directory does not exist'); }
      if (!stat.isDirectory()) throw new HttpError(400, 'Selected path is not a directory');
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .slice(0, 2000)
          .map(entry => ({ name: entry.name, path: path.join(current, entry.name) }))
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      } catch { throw new HttpError(403, 'Directory cannot be read'); }
      const root = path.parse(current).root;
      const roots = process.platform === 'win32'
        ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`).filter(candidate => fs.existsSync(candidate))
        : ['/'];
      return { success: true, current, parent: current === root ? '' : path.dirname(current), roots, entries };
    }

    // Projects
    case 'projects/list': {
      assertProjectSection(body.section);
      const projectsDir = resolveInside(path.resolve('projects'), body.section);
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch { return []; }
    }
    case 'projects/create': {
      assertProjectSection(body.section);
      const safeName = assertProjectName(body.name);
      const projectDir = resolveInside(path.resolve('projects'), body.section, safeName);
      if (fs.existsSync(projectDir)) return { success: false, error: 'Project already exists' };
      fs.mkdirSync(projectDir, { recursive: true });
      return { success: true, path: projectDir };
    }
    case 'projects/delete': {
      assertProjectSection(body.section);
      const safeName = assertProjectName(body.name);
      const projectDir = resolveInside(path.resolve('projects'), body.section, safeName);
      if (!fs.existsSync(projectDir)) return { success: false, error: 'Not found' };
      fs.rmSync(projectDir, { recursive: true, force: false });
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
      terminals.set(id, { process: child, id, sessionId: context.sessionId });
      child.stdout.on('data', (data) => broadcastSSE('terminal:data', { id, data: data.toString() }, context.sessionId));
      child.stderr.on('data', (data) => broadcastSSE('terminal:data', { id, data: data.toString() }, context.sessionId));
      child.on('error', (error) => {
        terminals.delete(id);
        broadcastSSE('terminal:data', { id, data: `[KitsuneServ] ${error.message}\n` }, context.sessionId);
        broadcastSSE('terminal:exit', { id, code: 1 }, context.sessionId);
      });
      child.on('exit', (code) => { terminals.delete(id); broadcastSSE('terminal:exit', { id, code }, context.sessionId); });
      return { id };
    }

    // Project workspaces and stack orchestration
    case 'workspace/templates': return projectManager.templates();
    case 'workspace/list': return projectManager.list();
    case 'workspace/get': return projectManager.get(body.id);
    case 'workspace/create': return projectManager.create(body.options || {});
    case 'workspace/update': return projectManager.update(body.id, body.patch || {});
    case 'workspace/remove': return projectManager.remove(body.id, body.options || {});
    case 'workspace/start': return projectManager.start(body.id);
    case 'workspace/stop': return projectManager.stop(body.id);
    case 'workspace/export': return projectManager.exportManifest(body.id);
    case 'workspace/import': return projectManager.importManifest(body.manifest, body.options || {});
    case 'workspace/url': return { url: projectManager.getUrl(body.id) };
    case 'workspace/open': {
      const project = projectManager.get(body.id);
      return { success: true, path: project.root, copied: false, webMode: true };
    }

    case 'activity/list': return activityManager.list(body.options || {});
    case 'activity/cancel': return activityManager.cancel(body.id);
    case 'activity/clear': return activityManager.clearCompleted();

    case 'diagnostics/doctor': return diagnosticsManager.doctor(body.projectId ? projectManager.get(body.projectId) : null);
    case 'diagnostics/compatibility': return diagnosticsManager.compatibility(body.projectId ? projectManager.get(body.projectId) : null);
    case 'diagnostics/ports': return diagnosticsManager.ports();
    case 'diagnostics/findFreePort': return diagnosticsManager.findFreePort(body.start, body.end);
    case 'diagnostics/repair': return diagnosticsManager.repair(body.issue);
    case 'command/start': return commandManager.start(body.projectId, body.name, body.execution, body.distribution);
    case 'command/stop': return commandManager.stop(body.id);
    case 'command/list': return commandManager.list(body.projectId);
    case 'command/get': return commandManager.get(body.id);
    case 'command/clear': return commandManager.clearFinished();
    case 'toolchain/list': return commandManager.toolchains();
    case 'ide/list': return commandManager.ides();
    case 'ide/open': return commandManager.openIDE(body.projectId, body.ideId);
    case 'environment/export': return environmentManager.export(body.label);
    case 'environment/inspect': return environmentManager.inspect(body.payload);
    case 'environment/apply': return environmentManager.apply(body.payload, body.options || {});
    case 'environment/createSnapshot': return environmentManager.createSnapshot(body.label);
    case 'environment/listSnapshots': return environmentManager.listSnapshots();
    case 'environment/restoreSnapshot': return environmentManager.restoreSnapshot(body.id, body.options || {});
    case 'environment/removeSnapshot': return environmentManager.removeSnapshot(body.id);
    case 'plugin/list': return pluginManager.list();
    case 'plugin/install': return pluginManager.install(body.directory);
    case 'plugin/setEnabled': return pluginManager.setEnabled(body.id, body.enabled);
    case 'plugin/remove': return pluginManager.remove(body.id);
    case 'platform/inventory': return platformManager.inventory();
    case 'platform/wslPath': return platformManager.toWslPath(body.directory, body.distribution);
    case 'platform/installSystemd': return platformManager.installSystemdUserService(body.options || {});
    case 'platform/removeSystemd': return platformManager.removeSystemdUserService();
    case 'tunnel/providers': return tunnelManager.providers();
    case 'tunnel/list': return tunnelManager.list(body.projectId || null);
    case 'tunnel/start': return tunnelManager.start(body.projectId, body.provider);
    case 'tunnel/stop': return tunnelManager.stop(body.id);
    case 'update/status': return updateManager.status();
    case 'update/check': return updateManager.check();
    case 'update/download': return updateManager.download();
    case 'update/install': return updateManager.install();
    case 'support/generate': return supportManager.generate();
    case 'domain/status': return domainManager.status(projectManager.list());
    case 'domain/apply': return domainManager.apply(projectManager.list(), { elevate: false });
    case 'domain/certificateStatus': return domainManager.certificateStatus(body.domain);
    case 'domain/installCertificateAuthority': return domainManager.installCertificateAuthority();
    case 'domain/issueCertificate': return domainManager.issueCertificate(body.domain);
    case 'terminal/write': {
      const term = terminals.get(body.id);
      if (!term || term.sessionId !== context.sessionId) return { success: false, error: 'Terminal not found' };
      if (typeof body.data !== 'string' || Buffer.byteLength(body.data) > 65536) {
        return { success: false, error: 'Invalid terminal input' };
      }
      if (!term.process.stdin.writable) return { success: false, error: 'Terminal input is closed' };
      term.process.stdin.write(body.data);
      return { success: true };
    }
    case 'terminal/kill': {
      const term = terminals.get(body.id);
      if (!term || term.sessionId !== context.sessionId) return { success: false };
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
        const resolvedCwd = body.cwd ? path.resolve(body.cwd) : appRoot;
        if (!isPathInside(appRoot, resolvedCwd) || !fs.existsSync(resolvedCwd)) {
          return { success: false, output: 'Working directory must be inside the KitsuneServ data directory' };
        }
        const output = execFileSync(phpExe, [composerPhar, ...composerArgs], {
          encoding: 'utf-8', timeout: 120000,
          cwd: resolvedCwd,
          env: { ...process.env, COMPOSER_HOME: path.join(phpPath, 'composer') }
        });
        return { success: true, output };
      } catch (err) {
        return { success: false, output: err.stdout || err.stderr || err.message };
      }
    }

    // PATH management
    case 'path/getStatus': return pathManager.getStatus();
    case 'path/apply': return pathManager.apply(body.services);
    case 'path/add': return pathManager.add(body.services);
    case 'path/remove': return pathManager.remove(body.services);
    case 'path/installPythonManager': {
      if (process.platform !== 'win32') return { success: false, error: 'Python Install Manager is available on Windows only' };
      broadcastSSE('path:pythonManagerStatus', { stage: 'installing', automatic: false }, context.sessionId);
      const result = await pathManager.installOfficialPythonManager();
      broadcastSSE('path:pythonManagerStatus', {
        stage: result?.success ? 'complete' : 'failed',
        automatic: false,
        alreadyInstalled: Boolean(result?.alreadyInstalled),
        error: result?.error || ''
      }, context.sessionId);
      return result;
    }

    // App Store
    case 'appStore/catalog': return appStoreManager.getCatalogWithStatus();
    case 'appStore/installed': return appStoreManager.getInstalledApps();
    case 'appStore/install': return appStoreManager.install(body.appId, progress => broadcastSSE('appStore:progress', { appId: body.appId, ...progress }), body.instanceName);
    case 'appStore/remove': return appStoreManager.remove(body.instanceName);
    case 'appStore/getUrl': return appStoreManager.getAppUrl(body.instanceName);
    case 'appStore/getExePath': return appStoreManager.getExePath(body.instanceName);
    case 'appStore/addCustomApp': return appStoreManager.addCustomApp(body.opts);
    case 'appStore/removeCustomApp': return appStoreManager.removeCustomApp(body.appId);
    case 'appStore/checkRequirements': return appStoreManager.checkRequirementsById(body.appId);

    default: throw new HttpError(404, 'Unknown endpoint');
  }
}

// ============ Parse form body for login ============
function parseFormBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > 65536) {
        settled = true;
        reject(new HttpError(413, 'Login request is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf-8');
      const params = {};
      for (const [key, value] of new URLSearchParams(raw)) params[key] = value;
      resolve(params);
    });
    req.on('error', reject);
  });
}

// ============ HTTP Server ============

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const clientAddress = normalizeIp(req.socket.remoteAddress || '');
  if (!isIpAllowed(clientAddress, ALLOWED_IPS)) {
    sendJSON(res, { error: 'Client address is not allowed' }, 403);
    return;
  }

  // Browser hardening headers. The UI is self-contained and never needs framing.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (IS_HTTPS) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // ---- Login endpoint ----
  if (pathname === '/auth/login' && req.method === 'POST') {
    if (isLoginRateLimited(req)) {
      res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '900' });
      res.end(getLoginPage('Too many failed attempts. Try again later.'));
      return;
    }
    const form = await parseFormBody(req);
    const inputUser = form.username || '';
    const inputPass = form.password || '';
    // Compare fixed-size digests so Unicode input cannot create unequal buffers.
    const userOk = timingSafeTextEqual(inputUser, AUTH_USER);
    const passOk = timingSafeTextEqual(inputPass, AUTH_PASS);
    const totpOk = !TOTP_SECRET || verifyTotp(TOTP_SECRET, form.totp || '');
    if (userOk && passOk && totpOk) {
      loginAttempts.delete(getClientKey(req));
      const sessionId = createSession(form.username, req);
      res.writeHead(302, {
        'Set-Cookie': `kitsune_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}${IS_HTTPS ? '; Secure' : ''}`,
        'Location': '/'
      });
      res.end();
    } else {
      recordFailedLogin(req);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage('Invalid username, password or authenticator code'));
    }
    return;
  }

  // ---- Logout ----
  if (pathname === '/auth/logout') {
    const sid = getSessionIdFromReq(req);
    if (sid) {
      sessions.delete(sid);
      terminateSessionResources(sid);
    }
    res.writeHead(302, {
      'Set-Cookie': 'kitsune_session=; Path=/; HttpOnly; Max-Age=0',
      'Location': '/'
    });
    res.end();
    return;
  }

  // ---- Auth check for everything else ----
  const sessionId = getSessionIdFromReq(req);
  const apiTokenAuthenticated = pathname.startsWith('/api/') && hasValidApiToken(req);
  if (!validateSession(sessionId) && !apiTokenAuthenticated) {
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
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(':\n\n'); // initial heartbeat
    sseClients.set(res, sessionId);
    // Periodic keepalive to prevent connection drops (every 25s)
    const heartbeat = setInterval(() => {
      try { res.write(':\n\n'); } catch { clearInterval(heartbeat); sseClients.delete(res); }
    }, 25000);
    req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    return;
  }

  // ---- API endpoints ----
  if (pathname.startsWith('/api/') && req.method === 'POST') {
    if (!hasValidOrigin(req)) {
      sendJSON(res, { error: 'Invalid request origin' }, 403);
      return;
    }
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJSON(res, { error: 'Content-Type must be application/json' }, 415);
      return;
    }
    const endpoint = pathname.slice(5); // strip '/api/'
    try {
      const body = await parseBody(req);
      const result = await handleAPI(endpoint, body, { sessionId, apiTokenAuthenticated, clientAddress });
      sendJSON(res, result);
    } catch (err) {
      sendJSON(res, { error: err.message || 'Internal server error' }, err.status || 500);
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
    try {
      const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
      filePath = path.resolve(__dirname, 'renderer', safePath);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
  }

  // Security: ensure file is within renderer directory
  const rendererDir = path.join(__dirname, 'renderer');
  if (!isPathInside(rendererDir, filePath)) {
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
      html = html.replace('</head>', '<script src="/web-preload.js"></script></head>');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Server error');
    }
    return;
  }

  sendFile(res, filePath, contentType);
}

const requestListener = (req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[KitsuneServ] HTTP request failed:', err);
    if (!res.headersSent) sendJSON(res, { error: err.message || 'Internal server error' }, err.status || 500);
    else if (!res.writableEnded) res.end();
  });
};

const server = IS_HTTPS
  ? https.createServer({ key: fs.readFileSync(TLS_KEY_PATH), cert: fs.readFileSync(TLS_CERT_PATH) }, requestListener)
  : http.createServer(requestListener);

// ============ Graceful shutdown ============
let shutdownInProgress = false;
async function shutdown(exitCode = 0) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  console.log('\n[KitsuneServ] Shutting down...');
  commandManager.stopAll();
  tunnelManager.stopAll();
  try { await serviceManager.stopAll(); } catch (err) { console.warn('[KitsuneServ] Service shutdown warning:', err.message); }
  for (const term of terminals.values()) {
    try { term.process.kill(); } catch {}
  }
  for (const res of sseClients.keys()) {
    try { res.end(); } catch {}
  }
  await new Promise(resolve => server.close(resolve));
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  process.exitCode = exitCode;
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// ============ Start ============
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║       🦊 KitsuneServ — Server Mode       ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  URL:  ${IS_HTTPS ? 'https' : 'http'}://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`.padEnd(46) + '║');
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
