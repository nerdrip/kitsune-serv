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
const SAFE_MODE = args.includes('--safe-mode') || process.env.KITSUNE_SAFE_MODE === '1';

// Authentication credentials (from env or auto-generated)
const AUTH_USER = process.env.KITSUNE_USER || 'admin';
const AUTH_PASS = process.env.KITSUNE_PASS || crypto.randomBytes(12).toString('base64url');
const API_TOKEN = process.env.KITSUNE_API_TOKEN || '';
const TOTP_SECRET = process.env.KITSUNE_TOTP_SECRET || '';
const ALLOWED_IPS = String(process.env.KITSUNE_ALLOWED_IPS || '').split(',').map(value => value.trim()).filter(Boolean);
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
const IntegrationManager = require('./integration-manager');
const ProjectDetector = require('./project-detector');
const LabManager = require('./lab-manager');
const ApiFlowManager = require('./api-flow-manager');
const ObservabilityManager = require('./observability-manager');
const AutomationManager = require('./automation-manager');
const AuditManager = require('./audit-manager');
const IdentityManager = require('./identity-manager');
const HubManager = require('./hub-manager');
const RemoteAccessManager = require('./remote-access-manager');
const RemoteOperationsManager = require('./remote-operations-manager');
const RemoteDevOpsManager = require('./remote-devops-manager');
const WorkspaceSuiteManager = require('./workspace-suite-manager');
const CloudStorageManager = require('./cloud-storage-manager');
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
const { PathManager } = require('./path-manager');

const configManager = new ConfigManager(appRoot);
const downloadManager = new DownloadManager({ appRoot, catalogRoot: defaultsRoot });
const serviceManager = new ServiceManager(downloadManager, configManager);
const pathManager = new PathManager(downloadManager, configManager, {
  systemIntegrationDisabled: SAFE_MODE || process.env.KITSUNE_DISABLE_SYSTEM_INTEGRATION === '1'
});
if (!SAFE_MODE) {
  try {
    const selectedPathServices = pathManager.getSelectedServices();
    if (selectedPathServices.length || pathManager.hasManagedEntries()) pathManager.sync(selectedPathServices);
  } catch (err) {
    console.warn('Could not synchronize the user PATH:', err.message);
  }
}
const activityManager = new ActivityManager(appRoot);
const secretStore = new SecretStore(appRoot);
const integrationManager = new IntegrationManager(appRoot, secretStore);
const auditManager = new AuditManager(appRoot);
const dbViewer = new DbViewer(downloadManager, configManager, serviceManager, secretStore);
const backupManager = new BackupManager(appRoot, configManager, downloadManager, dbViewer, activityManager);
if (!SAFE_MODE) {
  const backupTimer = setInterval(() => backupManager.runDue().catch(error => console.warn('[KitsuneServ] Scheduled backup warning:', error.message)), 60_000);
  backupTimer.unref();
  setTimeout(() => backupManager.runDue().catch(error => console.warn('[KitsuneServ] Scheduled backup warning:', error.message)), 5_000).unref();
}
const appStoreManager = new AppStoreManager(downloadManager, configManager, dbViewer, serviceManager);
const labManager = new LabManager(appRoot, { appStoreManager, serviceManager, configManager, downloadManager, pathManager, secretStore, activityManager });
const apiFlowManager = new ApiFlowManager(appRoot, { dbViewer, secretStore });
const domainManager = new DomainManager(appRoot);
const projectManager = new ProjectManager(appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager);
const projectDetector = new ProjectDetector();
const pluginManager = new PluginManager(appRoot);
projectManager.setTemplateProvider(() => pluginManager.projectTemplates());
const platformManager = new PlatformManager(appRoot);
const tunnelManager = new TunnelManager(projectManager);
const updateManager = new UpdateManager(appRoot, require('../package.json').version, activityManager, { allowInstall: false });
const diagnosticsManager = new DiagnosticsManager(appRoot, configManager, downloadManager, serviceManager, pathManager, {
  domainManager,
  projectProvider: () => projectManager.list()
});
projectManager.setDiagnosticsManager(diagnosticsManager);
const recoveryPromise = projectManager.recover({ enabled: configManager.getConfig().general?.crashRecovery !== false, safeMode: SAFE_MODE })
  .catch(error => ({ success: false, interrupted: [], restored: [], warnings: [error.message], safeMode: SAFE_MODE }));
const commandManager = new CommandManager(projectManager, pathManager, activityManager, { allowDesktopIntegration: false, platformManager });
commandManager.setToolProvider(() => pluginManager.tools());
projectManager.setSecretStore(secretStore);
projectManager.setHookRunner((projectId, commandName, options) => commandManager.runAndWait(projectId, commandName, options));
commandManager.setIntegrationEnvironmentProvider(() => integrationManager.buildEnvironment());
const environmentManager = new EnvironmentManager(appRoot, configManager, downloadManager, projectManager, pathManager, serviceManager);
const identityManager = new IdentityManager(appRoot, secretStore, { sessionMaxAge: SESSION_MAX_AGE });
const identityBootstrap = identityManager.bootstrap(AUTH_USER, AUTH_PASS);
const hubManager = new HubManager(appRoot, { identityManager, secretStore, projectManager, labManager, apiFlowManager, environmentManager });
const remoteAccessManager = new RemoteAccessManager(appRoot, secretStore);
const remoteOperationsManager = new RemoteOperationsManager(appRoot, remoteAccessManager);
const remoteDevOpsManager = new RemoteDevOpsManager(remoteOperationsManager);
const workspaceSuiteManager = new WorkspaceSuiteManager(appRoot, secretStore, remoteOperationsManager, remoteAccessManager);
const cloudStorageManager = new CloudStorageManager(appRoot, secretStore);
const advancedOpsManager = new AdvancedOpsManager(appRoot, remoteAccessManager, remoteOperationsManager, workspaceSuiteManager, cloudStorageManager);
const incidentManager = new IncidentManager(appRoot, secretStore, remoteAccessManager, remoteOperationsManager, advancedOpsManager, workspaceSuiteManager);
const resilienceManager = new ResilienceManager(appRoot, secretStore, remoteAccessManager, remoteOperationsManager);
const operationsFabricManager = new OperationsFabricManager(appRoot, secretStore, remoteAccessManager, remoteOperationsManager, advancedOpsManager, incidentManager, resilienceManager, cloudStorageManager, dbViewer);
const enterpriseOpsManager = new EnterpriseOpsManager(appRoot, { secretStore, remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, fabric: operationsFabricManager, dbViewer });
const nextgenOpsManager = new NextgenOpsManager(appRoot, { secretStore, remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, resilience: resilienceManager, enterprise: enterpriseOpsManager });
const operationsWorkspaceManager = new OperationsWorkspaceManager(appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, fabric: operationsFabricManager, incidents: incidentManager, nextgen: nextgenOpsManager, resilience: resilienceManager });
const terminalFileProManager = new TerminalFileProManager(appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, advanced: advancedOpsManager, operationsWorkspace: operationsWorkspaceManager, nextgen: nextgenOpsManager, secretStore });
const terminalFileVisionManager = new TerminalFileVisionManager(appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, sshTunnel: tunnelManager, advanced: advancedOpsManager, secretStore });
const terminalFileRuntimeManager = new TerminalFileRuntimeManager(appRoot, { remoteAccess: remoteAccessManager, secretStore });
const terminalFileDeepManager = new TerminalFileDeepManager(appRoot, { remoteAccess: remoteAccessManager, remoteOperations: remoteOperationsManager, cloudStorage: cloudStorageManager, terminalFilePro: terminalFileProManager, secretStore, allowMount: false });
const managedPanelDomain = String(process.env.KITSUNE_PANEL_DOMAIN || '').trim();
if (managedPanelDomain) {
  hubManager.configure({
    enabled: true,
    panelDomain: managedPanelDomain,
    authMode: process.env.KITSUNE_HUB_AUTH_MODE || 'hybrid',
    gatewayEnabled: true,
    tlsMode: 'external',
    autoProvisionPleskUsers: process.env.KITSUNE_HUB_AUTO_PROVISION !== '0'
  });
}
const managedPleskConnectorId = String(process.env.KITSUNE_PLESK_CONNECTOR_ID || '').trim();
const managedPleskConnectorSecret = String(process.env.KITSUNE_PLESK_CONNECTOR_SECRET || '');
const managedPleskUrl = String(process.env.KITSUNE_PLESK_URL || '').trim();
if (managedPleskConnectorId && managedPleskConnectorSecret && managedPleskUrl) {
  hubManager.saveConnector({
    id: managedPleskConnectorId,
    name: `Plesk — ${new URL(managedPleskUrl).hostname}`,
    baseUrl: managedPleskUrl,
    authMode: process.env.KITSUNE_HUB_AUTH_MODE || 'hybrid',
    enabled: process.env.KITSUNE_HUB_AUTH_MODE !== 'independent',
    autoProvisionUsers: process.env.KITSUNE_HUB_AUTO_PROVISION !== '0'
  }, managedPleskConnectorSecret);
}
const supportManager = new SupportManager(appRoot, { configManager, downloadManager, serviceManager, diagnosticsManager, projectManager, activityManager, environmentManager, pluginManager, platformManager });
const observabilityManager = new ObservabilityManager(appRoot, serviceManager);
const automationManager = new AutomationManager(appRoot, { serviceManager, projectManager, commandManager, labManager, backupManager, diagnosticsManager });
if (!SAFE_MODE) {
  observabilityManager.start();
  const automationTimer = setInterval(() => automationManager.runDue().catch(error => console.warn('[KitsuneServ] Automation warning:', error.message)), 30000);
  automationTimer.unref();
}
activityManager.on('changed', payload => broadcastSSE('activity:changed', payload));
commandManager.onOutput = payload => broadcastSSE('command:output', payload);
commandManager.onExit = payload => broadcastSSE('command:exit', payload);
tunnelManager.onChanged = payload => broadcastSSE('tunnel:changed', payload);
labManager.onChanged = payload => broadcastSSE('lab:changed', payload);
apiFlowManager.onChanged = payload => broadcastSSE('apiFlow:changed', payload);
observabilityManager.onChanged = payload => broadcastSSE('observability:changed', payload);
automationManager.onChanged = payload => broadcastSSE('automation:changed', payload);
hubManager.onChanged = payload => broadcastSSE('hub:changed', payload);

// ============ Session helpers ============

function createSession(userId, req, provider = 'local') {
  return identityManager.createSession(userId, {
    address: normalizeIp(req?.socket?.remoteAddress || ''),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 300), provider
  });
}

function validateSession(sessionId) {
  return identityManager.validateSession(sessionId);
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

function getApiTokenFromRequest(req) {
  const bearer = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  if (bearer && bearer[1]) return bearer[1].trim();

  const headerNames = ['x-kitsune-api-token', 'x-api-token', 'x-kitsune-token'];
  for (const name of headerNames) {
    const value = req.headers[name];
    if (Array.isArray(value)) {
      if (value[0]) return String(value[0]).trim();
      continue;
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function hasValidApiToken(req) {
  const token = getApiTokenFromRequest(req);
  if (!token) return null;
  if (API_TOKEN && timingSafeTextEqual(token, API_TOKEN)) {
    const owner = identityManager.listUsers().find(item => item.roles.includes('owner')) || identityManager.listUsers()[0];
    return owner ? { user: owner, principal: identityManager.principal(owner, { tokenKind: 'legacy-api' }) } : null;
  }
  return identityManager.validateToken(token);
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
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

// ============ Login page ============

function escapeLoginHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getLoginPage(error = '') {
  const options = hubManager.loginOptions();
  const ssoButton = options.pleskEnabled ? `<a class="plesk-button" href="${escapeLoginHtml(options.pleskLoginUrl)}">Zaloguj przez aktywną sesję Plesk</a>` : '';
  const separator = options.pleskEnabled && options.localEnabled ? '<div class="separator"><span>lub użyj hasła</span></div>' : '';
  const localForm = options.localEnabled ? `<form method="POST" action="/auth/login">
      <label for="username">Nazwa użytkownika</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus>
      <label for="password">Hasło</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required>
      <label for="totp">Kod uwierzytelniający lub odzyskiwania <span class="muted">(jeśli włączony)</span></label>
      <input type="text" id="totp" name="totp" inputmode="numeric" autocomplete="one-time-code">
      <button type="submit">Zaloguj</button>
    </form>` : '';
  const modeHint = options.authMode === 'hybrid'
    ? 'Najpierw sprawdzimy hasło w Plesku. Jeśli Plesk nie ma takiego konta, użyjemy konta lokalnego Huba.'
    : options.authMode === 'plesk' ? 'Logowanie jest zarządzane przez Plesk.' : 'Logowanie używa lokalnych kont Kitsune Hub.';
  const unavailable = options.authMode === 'plesk' && !options.pleskEnabled ? '<div class="notice">Połączenie z Pleskiem nie jest jeszcze gotowe. Zapisz konfigurację lub uruchom wdrożenie w KitsuneServ Bridge — identyfikator i sekret utworzą się automatycznie.</div>' : '';
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KitsuneServ - Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f0f1a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .login-box { background: #1a1a2e; border: 1px solid #2a2a4a; border-radius: 12px; padding: 40px; width: min(420px, calc(100vw - 32px)); box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
    .login-box h1 { text-align: center; margin-bottom: 8px; font-size: 24px; }
    .login-box .logo { text-align: center; font-size: 48px; margin-bottom: 16px; }
    .login-box .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 14px; }
    label { display: block; margin-bottom: 4px; font-size: 13px; color: #aaa; }
    input { width: 100%; padding: 10px 12px; background: #16162b; border: 1px solid #333; border-radius: 6px; color: #fff; font-size: 14px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #e94560; }
    button { width: 100%; padding: 12px; background: #e94560; color: #fff; border: none; border-radius: 6px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #d63851; }
    .error { color: #e94560; text-align: center; margin-bottom: 12px; font-size: 13px; }
    .notice { background: #29243c; border: 1px solid #55486f; border-radius: 7px; color: #d7cbea; padding: 12px; margin: 16px 0; font-size: 13px; line-height: 1.45; }
    .mode-hint { color: #999; font-size: 12px; line-height: 1.45; text-align: center; margin: -12px 0 20px; }
    .plesk-button { display: block; width: 100%; padding: 12px; background: #3077db; color: #fff; border-radius: 6px; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; }
    .plesk-button:hover { background: #2669c7; }
    .separator { display: flex; align-items: center; gap: 10px; color: #74748d; font-size: 11px; margin: 19px 0; text-transform: uppercase; letter-spacing: .04em; }
    .separator::before, .separator::after { content: ''; height: 1px; flex: 1; background: #30304b; }
    .muted { color: #666; }
  </style>
</head>
<body>
  <main class="login-box">
    <div class="logo">🦊</div>
    <h1>KitsuneServ</h1>
    <div class="subtitle">Panel zarządzania serwerem</div>
    <div class="mode-hint">${escapeLoginHtml(modeHint)}</div>
    ${error ? `<div class="error">${escapeLoginHtml(error)}</div>` : ''}
    ${unavailable}
    ${ssoButton}${separator}${localForm}
  </main>
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
    listObjectsFor: (connection, database) => window.kitsuneAPI._call('db/listObjectsFor', { connection, database }),
    describeObjectFor: (connection, database, schema, objectName) => window.kitsuneAPI._call('db/describeObjectFor', { connection, database, schema, objectName }),
    tableDataFor: (connection, database, table, limit, offset, schema) => window.kitsuneAPI._call('db/tableDataFor', { connection, database, table, limit, offset, schema }),
    executeQueryFor: (connection, database, query) => window.kitsuneAPI._call('db/executeQueryFor', { connection, database, query }),
    executeWorkbench: (connection, database, query, options) => window.kitsuneAPI._call('db/executeWorkbench', { connection, database, query, options }),
    cancelQuery: (id) => window.kitsuneAPI._call('db/cancelQuery', { id }),
    activeQueries: () => window.kitsuneAPI._call('db/activeQueries'),
    queryHistory: (limit) => window.kitsuneAPI._call('db/queryHistory', { limit }),
    clearQueryHistory: () => window.kitsuneAPI._call('db/clearQueryHistory'),
    savedQueries: () => window.kitsuneAPI._call('db/savedQueries'),
    saveQuery: (input) => window.kitsuneAPI._call('db/saveQuery', { input }),
    removeSavedQuery: (id) => window.kitsuneAPI._call('db/removeSavedQuery', { id }),
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
    create: (connection = null) => window.kitsuneAPI._call('terminal/create', { connection }),
    write: (id, data) => window.kitsuneAPI._call('terminal/write', { id, data }),
    kill: (id) => window.kitsuneAPI._call('terminal/kill', { id }),
    resize: (id, cols, rows) => window.kitsuneAPI._call('terminal/resize', { id, cols, rows }),
    profiles: () => window.kitsuneAPI._call('terminal/profiles'),
    onData: (cb) => { window._kitsuneTermDataCb = cb; },
    onExit: (cb) => { window._kitsuneTermExitCb = cb; }
  },
  remote: {
    list: () => window.kitsuneAPI._call('remote/list'), save: (input, secrets) => window.kitsuneAPI._call('remote/save', { input, secrets }), remove: id => window.kitsuneAPI._call('remote/remove', { id }), duplicate: id => window.kitsuneAPI._call('remote/duplicate', { id }), resetHostKey: id => window.kitsuneAPI._call('remote/resetHostKey', { id }), test: input => window.kitsuneAPI._call('remote/test', { input }), diagnose: input => window.kitsuneAPI._call('remote/diagnose', { input }), inspect: (input, kind) => window.kitsuneAPI._call('remote/inspect', { input, kind }), docker: (input, action, target) => window.kitsuneAPI._call('remote/docker', { input, action, target }), systemd: (input, action, unit) => window.kitsuneAPI._call('remote/systemd', { input, action, unit }), signal: (input, pid, signal) => window.kitsuneAPI._call('remote/signal', { input, pid, signal }), archive: (input, action, source, destination) => window.kitsuneAPI._call('remote/archive', { input, action, source, destination }), wake: (mac, address, port) => window.kitsuneAPI._call('remote/wake', { mac, address, port }), deploy: (connection, options) => window.kitsuneAPI._call('remote/deploy', { connection, options }), onDeployProgress: () => {}, onOpenPanel: () => {}
  },
  files: {
    localList: directory => window.kitsuneAPI._call('files/localList', { directory }), localMutate: (operation, target, destination) => window.kitsuneAPI._call('files/localMutate', { operation, target, destination }), remoteList: (connection, directory) => window.kitsuneAPI._call('files/remoteList', { connection, directory }), transfer: (connection, direction, localPath, remotePath) => window.kitsuneAPI._call('files/transfer', { connection, direction, localPath, remotePath }), transferResumable: (connection, direction, localPath, remotePath, transferId) => window.kitsuneAPI._call('files/transferResumable', { connection, direction, localPath, remotePath, transferId }), transferRecursive: (connection, direction, localPath, remotePath, transferId) => window.kitsuneAPI._call('files/transferRecursive', { connection, direction, localPath, remotePath, transferId }), remoteMutate: (connection, operation, target, destination) => window.kitsuneAPI._call('files/remoteMutate', { connection, operation, target, destination }), readLocal: target => window.kitsuneAPI._call('files/readLocal', { target }), writeLocal: (target, content) => window.kitsuneAPI._call('files/writeLocal', { target, content }), readRemote: (connection, target) => window.kitsuneAPI._call('files/readRemote', { connection, target }), writeRemote: (connection, target, content) => window.kitsuneAPI._call('files/writeRemote', { connection, target, content }), searchLocal: (directory, query) => window.kitsuneAPI._call('files/searchLocal', { directory, query }), searchRemote: (connection, directory, query) => window.kitsuneAPI._call('files/searchRemote', { connection, directory, query }), diff: (connection, localPath, remotePath) => window.kitsuneAPI._call('files/diff', { connection, localPath, remotePath }), syncPreview: (connection, localPath, remotePath, options) => window.kitsuneAPI._call('files/syncPreview', { connection, localPath, remotePath, options }), syncApply: (connection, preview, direction, selected) => window.kitsuneAPI._call('files/syncApply', { connection, preview, direction, selected }), onTransferProgress: () => {}
  },
  storage: {
    list: () => window.kitsuneAPI._call('storage/list'), save: (input, secrets) => window.kitsuneAPI._call('storage/save', { input, secrets }), remove: id => window.kitsuneAPI._call('storage/remove', { id }), test: input => window.kitsuneAPI._call('storage/test', { input }), listFiles: (input, directory) => window.kitsuneAPI._call('storage/listFiles', { input, directory }), transfer: (input, direction, localPath, remotePath) => window.kitsuneAPI._call('storage/transfer', { input, direction, localPath, remotePath }), transferRecursive: (input, direction, localPath, remotePath, transferId) => window.kitsuneAPI._call('storage/transferRecursive', { input, direction, localPath, remotePath, transferId }), mutate: (input, operation, target, destination) => window.kitsuneAPI._call('storage/mutate', { input, operation, target, destination }), read: (input, remotePath) => window.kitsuneAPI._call('storage/read', { input, remotePath }), write: (input, remotePath, content) => window.kitsuneAPI._call('storage/write', { input, remotePath, content })
  },
  advanced: {
    graph: () => window.kitsuneAPI._call('advanced/graph'), commands: () => window.kitsuneAPI._call('advanced/commands'), configuration: () => window.kitsuneAPI._call('advanced/configuration'), workspaces: () => window.kitsuneAPI._call('advanced/workspaces'), workspaceSave: input => window.kitsuneAPI._call('advanced/workspaceSave', { input }), search: (query, options) => window.kitsuneAPI._call('advanced/search', { query, options }), secretScan: (content, label) => window.kitsuneAPI._call('advanced/secretScan', { content, label }), preflight: (input, options) => window.kitsuneAPI._call('advanced/preflight', { input, options }), captureInfrastructure: input => window.kitsuneAPI._call('advanced/capture', { input }), diffInfrastructure: (left, right) => window.kitsuneAPI._call('advanced/diff', { left, right }), drift: input => window.kitsuneAPI._call('advanced/drift', { input }), blastRadius: input => window.kitsuneAPI._call('advanced/blastRadius', { input }), digitalTwin: (capture, operation) => window.kitsuneAPI._call('advanced/digitalTwin', { capture, operation }), correlateLogs: sources => window.kitsuneAPI._call('advanced/logs', { sources }), anomaly: samples => window.kitsuneAPI._call('advanced/anomaly', { samples }), explain: value => window.kitsuneAPI._call('advanced/explain', { value }), dns: hostname => window.kitsuneAPI._call('advanced/dns', { hostname }), certificate: (hostname, port) => window.kitsuneAPI._call('advanced/certificate', { hostname, port })
  },
  fabric: {
    summary: () => window.kitsuneAPI._call('fabric/summary'), policySave: input => window.kitsuneAPI._call('fabric/policySave', { input }), policyEvaluate: context => window.kitsuneAPI._call('fabric/policyEvaluate', { context }), serviceMap: input => window.kitsuneAPI._call('fabric/serviceMap', { input }), gitOpsPlan: (observed, desired) => window.kitsuneAPI._call('fabric/gitOpsPlan', { observed, desired }), syntheticSave: input => window.kitsuneAPI._call('fabric/syntheticSave', { input }), syntheticRun: id => window.kitsuneAPI._call('fabric/syntheticRun', { id }), canarySave: input => window.kitsuneAPI._call('fabric/canarySave', { input }), canaryAdvance: (id, metrics) => window.kitsuneAPI._call('fabric/canaryAdvance', { id, metrics }), databaseSchemaDiff: (left, right) => window.kitsuneAPI._call('fabric/dbDiff', { left, right }), databaseErd: schema => window.kitsuneAPI._call('fabric/dbErd', { schema }), databaseMask: (rows, rules) => window.kitsuneAPI._call('fabric/dbMask', { rows, rules }), copilot: context => window.kitsuneAPI._call('fabric/copilot', { context }), replaySimulate: (id, action) => window.kitsuneAPI._call('fabric/replaySimulate', { id, action })
  },
  enterprise: {
    configuration: () => window.kitsuneAPI._call('enterprise/configuration'),
    summary: () => window.kitsuneAPI._call('enterprise/summary'), agents: () => window.kitsuneAPI._call('enterprise/agents'), agentEnroll: input => window.kitsuneAPI._call('enterprise/agentEnroll', { input }), agentRemove: id => window.kitsuneAPI._call('enterprise/agentRemove', { id }), agentProbe: id => window.kitsuneAPI._call('enterprise/agentProbe', { id }), agentBootstrap: input => window.kitsuneAPI._call('enterprise/agentBootstrap', { input }), sloSave: input => window.kitsuneAPI._call('enterprise/sloSave', { input }), sloRecord: (id, sample) => window.kitsuneAPI._call('enterprise/sloRecord', { id, sample }), sloEvaluate: () => window.kitsuneAPI._call('enterprise/sloEvaluate'), capacityRecord: (resource, value, at) => window.kitsuneAPI._call('enterprise/capacityRecord', { resource, value, at }), capacityForecast: (resource, limit) => window.kitsuneAPI._call('enterprise/capacityForecast', { resource, limit }), patchSave: input => window.kitsuneAPI._call('enterprise/patchSave', { input }), patchRun: (id, options) => window.kitsuneAPI._call('enterprise/patchRun', { id, options }), rebootPlan: input => window.kitsuneAPI._call('enterprise/rebootPlan', { input }), rebootRun: (id, options) => window.kitsuneAPI._call('enterprise/rebootRun', { id, options }), complianceSave: input => window.kitsuneAPI._call('enterprise/complianceSave', { input }), complianceScan: (id, sessions) => window.kitsuneAPI._call('enterprise/complianceScan', { id, sessions }), supplyChainScan: input => window.kitsuneAPI._call('enterprise/supplyChainScan', { input }), imagePromote: input => window.kitsuneAPI._call('enterprise/imagePromote', { input }), airgapCreate: input => window.kitsuneAPI._call('enterprise/airgapCreate', { input }), airgapVerify: id => window.kitsuneAPI._call('enterprise/airgapVerify', { id }), oidcSave: input => window.kitsuneAPI._call('enterprise/oidcSave', { input }), oidcLogin: id => window.kitsuneAPI._call('enterprise/oidcLogin', { id }), chaosSave: input => window.kitsuneAPI._call('enterprise/chaosSave', { input }), chaosRun: (id, options) => window.kitsuneAPI._call('enterprise/chaosRun', { id, options }), remediationSave: input => window.kitsuneAPI._call('enterprise/remediationSave', { input }), autonomousSandbox: context => window.kitsuneAPI._call('enterprise/autonomousSandbox', { context }), migrationRehearse: (connection, database, sql) => window.kitsuneAPI._call('enterprise/migrationRehearse', { connection, database, sql }), configValidate: input => window.kitsuneAPI._call('enterprise/configValidate', { input }), cloudInit: input => window.kitsuneAPI._call('enterprise/cloudInit', { input }), regionSave: input => window.kitsuneAPI._call('enterprise/regionSave', { input }), failoverPlan: (fromId, toId) => window.kitsuneAPI._call('enterprise/failoverPlan', { fromId, toId }), marketplaceInstall: input => window.kitsuneAPI._call('enterprise/marketplaceInstall', { input })
  },
  nextgen: {
    deltaApply: (source, destination, plan) => window.kitsuneAPI._call('nextgen/deltaApply', { source, destination, plan }),
    summary: () => window.kitsuneAPI._call('nextgen/summary'), configuration: () => window.kitsuneAPI._call('nextgen/configuration'), relaySave: input => window.kitsuneAPI._call('nextgen/relaySave', { input }), relayRoute: (fromId, toId) => window.kitsuneAPI._call('nextgen/relayRoute', { fromId, toId }), relayBootstrap: input => window.kitsuneAPI._call('nextgen/relayBootstrap', { input }), capabilityIssue: input => window.kitsuneAPI._call('nextgen/capabilityIssue', { input }), capabilityUse: (id, parameters) => window.kitsuneAPI._call('nextgen/capabilityUse', { id, parameters }), shellParse: transcript => window.kitsuneAPI._call('nextgen/shellParse', { transcript }), deltaSignature: (file, blockSize) => window.kitsuneAPI._call('nextgen/deltaSignature', { file, blockSize }), deltaPlan: (file, signature) => window.kitsuneAPI._call('nextgen/deltaPlan', { file, signature }), snapshotCreate: input => window.kitsuneAPI._call('nextgen/snapshotCreate', { input }), snapshotBrowse: (id, prefix) => window.kitsuneAPI._call('nextgen/snapshotBrowse', { id, prefix }), snapshotRestore: (id, relative, target) => window.kitsuneAPI._call('nextgen/snapshotRestore', { id, relative, target }), ransomwareBaseline: root => window.kitsuneAPI._call('nextgen/ransomwareBaseline', { root }), ransomwareScan: (root, thresholds) => window.kitsuneAPI._call('nextgen/ransomwareScan', { root, thresholds }), desktopSave: input => window.kitsuneAPI._call('nextgen/desktopSave', { input }), sshPolicySave: input => window.kitsuneAPI._call('nextgen/sshPolicySave', { input }), sshCertificateIssue: (policyId, publicKey, identity, authentication) => window.kitsuneAPI._call('nextgen/sshCertificateIssueMfa', { policyId, publicKey, identity, authentication }), ebpf: (input, kind) => window.kitsuneAPI._call('nextgen/ebpf', { input, kind }), networkTwin: input => window.kitsuneAPI._call('nextgen/networkTwin', { input }), transaction: (input, steps, options) => window.kitsuneAPI._call('nextgen/transaction', { input, steps, options }), pairCreate: input => window.kitsuneAPI._call('nextgen/pairCreate', { input }), pairPropose: (id, action, actor) => window.kitsuneAPI._call('nextgen/pairPropose', { id, action, actor }), pairApprove: (id, actor) => window.kitsuneAPI._call('nextgen/pairApprove', { id, actor }), mobileCreate: input => window.kitsuneAPI._call('nextgen/mobileCreate', { input }), mobileResolve: (id, challenge, decision, authentication) => window.kitsuneAPI._call('nextgen/mobileResolveMfa', { id, challenge, decision, authentication }), wasmRun: input => window.kitsuneAPI._call('nextgen/wasmRun', { input }), blackBoxRecord: event => window.kitsuneAPI._call('nextgen/blackBoxRecord', { event }), blackBoxExport: minutes => window.kitsuneAPI._call('nextgen/blackBoxExport', { minutes }), dnaCapture: input => window.kitsuneAPI._call('nextgen/dnaCapture', { input }), dnaCompare: (left, right) => window.kitsuneAPI._call('nextgen/dnaCompare', { left, right }), connectivityHeal: input => window.kitsuneAPI._call('nextgen/connectivityHeal', { input }), intentPlan: input => window.kitsuneAPI._call('nextgen/intentPlan', { input }), simulatorCreate: input => window.kitsuneAPI._call('nextgen/simulatorCreate', { input }), simulatorRun: (id, response) => window.kitsuneAPI._call('nextgen/simulatorRun', { id, response })
  },
  opsWorkspace: {
    summary: () => window.kitsuneAPI._call('opsWorkspace/summary'), configuration: () => window.kitsuneAPI._call('opsWorkspace/configuration'), save: input => window.kitsuneAPI._call('opsWorkspace/save', { input }), resume: id => window.kitsuneAPI._call('opsWorkspace/resume', { id }), timelineRecord: input => window.kitsuneAPI._call('opsWorkspace/timelineRecord', { input }), timeline: (sessionId, options) => window.kitsuneAPI._call('opsWorkspace/timeline', { sessionId, options }), undoPlan: id => window.kitsuneAPI._call('opsWorkspace/undoPlan', { id }), undoExecute: (id, approved) => window.kitsuneAPI._call('opsWorkspace/undoExecute', { id, approved }), connectionDoctor: id => window.kitsuneAPI._call('opsWorkspace/connectionDoctor', { id }), smartTransfer: input => window.kitsuneAPI._call('opsWorkspace/smartTransfer', { input }), fleetPreview: (ids, template, parameters, options) => window.kitsuneAPI._call('opsWorkspace/fleetPreview', { ids, template, parameters, options }), fleetExecute: (preview, approved) => window.kitsuneAPI._call('opsWorkspace/fleetExecute', { preview, approved }), environmentDiff: (left, right) => window.kitsuneAPI._call('opsWorkspace/environmentDiff', { left, right }), disposableRescue: input => window.kitsuneAPI._call('opsWorkspace/disposableRescue', { input }), portableRescue: input => window.kitsuneAPI._call('opsWorkspace/portableRescue', { input }), memoryRecord: input => window.kitsuneAPI._call('opsWorkspace/memoryRecord', { input }), memorySearch: (query, sessionId) => window.kitsuneAPI._call('opsWorkspace/memorySearch', { query, sessionId }), multiplexerSave: input => window.kitsuneAPI._call('opsWorkspace/multiplexerSave', { input }), autocomplete: input => window.kitsuneAPI._call('opsWorkspace/autocomplete', { input }), incidentRoom: input => window.kitsuneAPI._call('opsWorkspace/incidentRoom', { input }), collaborativeChange: input => window.kitsuneAPI._call('opsWorkspace/collaborativeChange', { input }), movie: (sessionId, options) => window.kitsuneAPI._call('opsWorkspace/movie', { sessionId, options }), blastRadius: (sessionId, operation) => window.kitsuneAPI._call('opsWorkspace/blastRadius', { sessionId, operation }), networkReplayCreate: input => window.kitsuneAPI._call('opsWorkspace/networkReplayCreate', { input }), networkReplayRun: (id, response) => window.kitsuneAPI._call('opsWorkspace/networkReplayRun', { id, response }), palettePlan: input => window.kitsuneAPI._call('opsWorkspace/palettePlan', { input }), secretless: sessionId => window.kitsuneAPI._call('opsWorkspace/secretless', { sessionId })
  },
  terminalFilePro: {
    summary: () => window.kitsuneAPI._call('terminalFilePro/summary'), configuration: () => window.kitsuneAPI._call('terminalFilePro/configuration'), notebookSave: input => window.kitsuneAPI._call('terminalFilePro/notebookSave', { input }), notebook: id => window.kitsuneAPI._call('terminalFilePro/notebook', { id }), pasteAnalyze: value => window.kitsuneAPI._call('terminalFilePro/pasteAnalyze', { value }), translate: input => window.kitsuneAPI._call('terminalFilePro/translate', { input }), sidecar: sessionId => window.kitsuneAPI._call('terminalFilePro/sidecar', { sessionId }), shadow: (sessionId, template, parameters, options) => window.kitsuneAPI._call('terminalFilePro/shadow', { sessionId, template, parameters, options }), checkpointSave: input => window.kitsuneAPI._call('terminalFilePro/checkpointSave', { input }), checkpointRestore: id => window.kitsuneAPI._call('terminalFilePro/checkpointRestore', { id }), resultMatrix: results => window.kitsuneAPI._call('terminalFilePro/resultMatrix', { results }), outputActions: output => window.kitsuneAPI._call('terminalFilePro/outputActions', { output }), recordingStudio: input => window.kitsuneAPI._call('terminalFilePro/recordingStudio', { input }), protocolSave: input => window.kitsuneAPI._call('terminalFilePro/protocolSave', { input }), multiFilePreview: (sessionId, changes) => window.kitsuneAPI._call('terminalFilePro/multiFilePreview', { sessionId, changes }), multiFileApply: (preview, approved) => window.kitsuneAPI._call('terminalFilePro/multiFileApply', { preview, approved }), containerFiles: (sessionId, input) => window.kitsuneAPI._call('terminalFilePro/containerFiles', { sessionId, input }), gitFiles: (sessionId, input) => window.kitsuneAPI._call('terminalFilePro/gitFiles', { sessionId, input }), archiveFiles: (sessionId, input) => window.kitsuneAPI._call('terminalFilePro/archiveFiles', { sessionId, input }), hugeFile: (sessionId, input) => window.kitsuneAPI._call('terminalFilePro/hugeFile', { sessionId, input }), indexBuild: (sessionId, root, options) => window.kitsuneAPI._call('terminalFilePro/indexBuild', { sessionId, root, options }), indexSearch: (id, query) => window.kitsuneAPI._call('terminalFilePro/indexSearch', { id, query }), provenanceRecord: input => window.kitsuneAPI._call('terminalFilePro/provenanceRecord', { input }), provenance: sha256 => window.kitsuneAPI._call('terminalFilePro/provenance', { sha256 }), crossProtocolPlan: input => window.kitsuneAPI._call('terminalFilePro/crossProtocolPlan', { input }), duplicates: (sessionId, root) => window.kitsuneAPI._call('terminalFilePro/duplicates', { sessionId, root }), heatmap: (sessionId, root) => window.kitsuneAPI._call('terminalFilePro/heatmap', { sessionId, root }), causality: (sessionId, file) => window.kitsuneAPI._call('terminalFilePro/causality', { sessionId, file }), splitContext: input => window.kitsuneAPI._call('terminalFilePro/splitContext', { input }), pipelineSave: input => window.kitsuneAPI._call('terminalFilePro/pipelineSave', { input }), pipelinePlan: (id, context) => window.kitsuneAPI._call('terminalFilePro/pipelinePlan', { id, context }), dropZoneCreate: input => window.kitsuneAPI._call('terminalFilePro/dropZoneCreate', { input }), dropZoneInspect: id => window.kitsuneAPI._call('terminalFilePro/dropZoneInspect', { id }), capsuleCreate: input => window.kitsuneAPI._call('terminalFilePro/capsuleCreate', { input }), capsuleOpen: (target, passphrase) => window.kitsuneAPI._call('terminalFilePro/capsuleOpen', { target, passphrase }), airDropCreate: input => window.kitsuneAPI._call('terminalFilePro/airDropCreate', { input }), airDropConsume: (id, code, destination) => window.kitsuneAPI._call('terminalFilePro/airDropConsume', { id, code, destination }), clipboardPut: input => window.kitsuneAPI._call('terminalFilePro/clipboardPut', { input }), clipboardTake: (id, sessionId) => window.kitsuneAPI._call('terminalFilePro/clipboardTake', { id, sessionId }), filesystemWatch: input => window.kitsuneAPI._call('terminalFilePro/filesystemWatch', { input })
  },
  terminalFileVision: {
    summary: () => window.kitsuneAPI._call('terminalFileVision/summary'),
    configuration: () => window.kitsuneAPI._call('terminalFileVision/configuration'),
    execute: (feature, input) => window.kitsuneAPI._call('terminalFileVision/execute', { feature, input })
  },
  terminalFileRuntime: {
    summary: () => window.kitsuneAPI._call('terminalFileRuntime/summary'),
    audit: input => window.kitsuneAPI._call('terminalFileRuntime/audit', { input }),
    execute: (capability, input) => window.kitsuneAPI._call('terminalFileRuntime/execute', { capability, input })
  },
  terminalFileDeep: {
    summary: () => window.kitsuneAPI._call('terminalFileDeep/summary'),
    execute: (capability, input) => window.kitsuneAPI._call('terminalFileDeep/execute', { capability, input })
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
    detect: (directory) => window.kitsuneAPI._call('workspace/detect', { directory }),
    inspectCompose: (file) => window.kitsuneAPI._call('workspace/inspectCompose', { file }),
    inspectDevcontainer: (file) => window.kitsuneAPI._call('workspace/inspectDevcontainer', { file }),
    secretKeys: (id) => window.kitsuneAPI._call('workspace/secretKeys', { id }),
    setSecrets: (id, secrets) => window.kitsuneAPI._call('workspace/setSecrets', { id, secrets }),
    environment: (id) => window.kitsuneAPI._call('workspace/environment', { id }),
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
    preflight: (projectId) => window.kitsuneAPI._call('diagnostics/preflight', { projectId }),
    ports: () => window.kitsuneAPI._call('diagnostics/ports'),
    findFreePort: (start, end) => window.kitsuneAPI._call('diagnostics/findFreePort', { start, end }),
    repair: (issue) => window.kitsuneAPI._call('diagnostics/repair', { issue }),
    repairAll: (projectId) => window.kitsuneAPI._call('diagnostics/repairAll', { projectId })
  },
  integration: {
    list: () => window.kitsuneAPI._call('integration/list'),
    save: (id, config, secrets) => window.kitsuneAPI._call('integration/save', { id, config, secrets }),
    remove: (id) => window.kitsuneAPI._call('integration/remove', { id }),
    test: (id) => window.kitsuneAPI._call('integration/test', { id }),
    readiness: (category) => window.kitsuneAPI._call('integration/readiness', { category }),
    assistant: (prompt, context) => window.kitsuneAPI._call('integration/assistant', { prompt, context })
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
  toolchain: {
    list: () => window.kitsuneAPI._call('toolchain/list'),
    repair: id => window.kitsuneAPI._call('toolchain/repair', { id })
  },
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
  identity: {
    roles: () => window.kitsuneAPI._call('identity/roles'), users: () => window.kitsuneAPI._call('identity/users'),
    createUser: (input) => window.kitsuneAPI._call('identity/createUser', { input }), updateUser: (id, patch) => window.kitsuneAPI._call('identity/updateUser', { id, patch }), removeUser: (id) => window.kitsuneAPI._call('identity/removeUser', { id }),
    enableTotp: (id) => window.kitsuneAPI._call('identity/enableTotp', { id }), disableTotp: (id) => window.kitsuneAPI._call('identity/disableTotp', { id }),
    tokens: () => window.kitsuneAPI._call('identity/tokens'), createToken: (input) => window.kitsuneAPI._call('identity/createToken', { input }), revokeToken: (id) => window.kitsuneAPI._call('identity/revokeToken', { id }),
    invitations: () => window.kitsuneAPI._call('identity/invitations'), createInvitation: (input) => window.kitsuneAPI._call('identity/createInvitation', { input }), removeInvitation: (id) => window.kitsuneAPI._call('identity/removeInvitation', { id })
  },
  hub: {
    status: () => window.kitsuneAPI._call('hub/status'), settings: () => window.kitsuneAPI._call('hub/settings'), configure: (input) => window.kitsuneAPI._call('hub/configure', { input }),
    teams: () => window.kitsuneAPI._call('hub/teams'), saveTeam: (input) => window.kitsuneAPI._call('hub/saveTeam', { input }), removeTeam: (id) => window.kitsuneAPI._call('hub/removeTeam', { id }),
    nodes: () => window.kitsuneAPI._call('hub/nodes'), createPairing: (input) => window.kitsuneAPI._call('hub/createPairing', { input }), revokeNode: (id) => window.kitsuneAPI._call('hub/revokeNode', { id }),
    routes: () => window.kitsuneAPI._call('hub/routes'), saveRoute: (input) => window.kitsuneAPI._call('hub/saveRoute', { input }), removeRoute: (id) => window.kitsuneAPI._call('hub/removeRoute', { id }),
    inventory: (filters) => window.kitsuneAPI._call('hub/inventory', { filters }), publishLocal: (options) => window.kitsuneAPI._call('hub/publishLocal', { options }), publish: (input) => window.kitsuneAPI._call('hub/sync/publish', { input }),
    history: (id) => window.kitsuneAPI._call('hub/history', { id }), rollback: (id, revision) => window.kitsuneAPI._call('hub/rollback', { id, revision }), applyObject: (id, options) => window.kitsuneAPI._call('hub/applyObject', { id, options }),
    deployments: (filters) => window.kitsuneAPI._call('hub/deployments', { filters }), createDeployment: (input) => window.kitsuneAPI._call('hub/createDeployment', { input }), approveDeployment: (id) => window.kitsuneAPI._call('hub/approveDeployment', { id }), updateDeployment: (id, input) => window.kitsuneAPI._call('hub/updateDeployment', { id, input }),
    connectors: () => window.kitsuneAPI._call('hub/connectors'), saveConnector: (input, secret) => window.kitsuneAPI._call('hub/saveConnector', { input, secret }), removeConnector: (id) => window.kitsuneAPI._call('hub/removeConnector', { id }),
    remotes: () => window.kitsuneAPI._call('hub/remotes'), saveRemote: (input, token) => window.kitsuneAPI._call('hub/saveRemote', { input, token }), removeRemote: (id) => window.kitsuneAPI._call('hub/removeRemote', { id }), pushRemote: (id, options) => window.kitsuneAPI._call('hub/pushRemote', { id, options }), pullRemote: (id, options) => window.kitsuneAPI._call('hub/pullRemote', { id, options }), syncRemote: (id, options) => window.kitsuneAPI._call('hub/syncRemote', { id, options }),
    reconcile: () => window.kitsuneAPI._call('hub/reconcile'), onChanged: (cb) => { window._kitsuneHubChangedCb = cb; }
  },
  security: {
    status: () => window.kitsuneAPI._call('security/status'),
    sessions: () => window.kitsuneAPI._call('security/sessions'),
    revokeSession: (id) => window.kitsuneAPI._call('security/revokeSession', { id }),
    revokeOtherSessions: () => window.kitsuneAPI._call('security/revokeOtherSessions'),
    audit: (options) => window.kitsuneAPI._call('audit/list', { options }),
    verifyAudit: () => window.kitsuneAPI._call('audit/verify')
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
  lab: {
    recipes: () => window.kitsuneAPI._call('lab/recipes'),
    preview: (input) => window.kitsuneAPI._call('lab/preview', { input }),
    list: () => window.kitsuneAPI._call('lab/list'),
    get: (id) => window.kitsuneAPI._call('lab/get', { id }),
    create: (input, secrets) => window.kitsuneAPI._call('lab/create', { input, secrets }),
    update: (id, patch, secrets) => window.kitsuneAPI._call('lab/update', { id, patch, secrets }),
    provision: (id) => window.kitsuneAPI._call('lab/provision', { id }),
    start: (id) => window.kitsuneAPI._call('lab/start', { id }),
    stop: (id) => window.kitsuneAPI._call('lab/stop', { id }),
    health: (id) => window.kitsuneAPI._call('lab/health', { id }),
    remove: (id, options) => window.kitsuneAPI._call('lab/remove', { id, options }),
    onChanged: (cb) => { window._kitsuneLabChangedCb = cb; },
    onProgress: (cb) => { window._kitsuneLabProgressCb = cb; }
  },
  apiFlow: {
    catalog: () => window.kitsuneAPI._call('apiFlow/catalog'),
    list: () => window.kitsuneAPI._call('apiFlow/list'),
    get: (id) => window.kitsuneAPI._call('apiFlow/get', { id }),
    validate: (input) => window.kitsuneAPI._call('apiFlow/validate', { input }),
    save: (input) => window.kitsuneAPI._call('apiFlow/save', { input }),
    remove: (id) => window.kitsuneAPI._call('apiFlow/remove', { id }),
    start: (id) => window.kitsuneAPI._call('apiFlow/start', { id }),
    stop: (id) => window.kitsuneAPI._call('apiFlow/stop', { id }),
    status: (id) => window.kitsuneAPI._call('apiFlow/status', { id }),
    test: (projectId, endpointId, request) => window.kitsuneAPI._call('apiFlow/test', { projectId, endpointId, request }),
    request: (projectId, endpointId, request) => window.kitsuneAPI._call('apiFlow/request', { projectId, endpointId, request }),
    logs: (projectId, limit) => window.kitsuneAPI._call('apiFlow/logs', { projectId, limit }),
    clearLogs: (projectId) => window.kitsuneAPI._call('apiFlow/clearLogs', { projectId }),
    onChanged: (cb) => { window._kitsuneApiFlowChangedCb = cb; }
  },
  observability: {
    overview: () => window.kitsuneAPI._call('observability/overview'),
    collect: () => window.kitsuneAPI._call('observability/collect'),
    history: (options) => window.kitsuneAPI._call('observability/history', { options }),
    alerts: () => window.kitsuneAPI._call('observability/alerts'),
    acknowledge: (id) => window.kitsuneAPI._call('observability/acknowledge', { id }),
    rules: () => window.kitsuneAPI._call('observability/rules'),
    saveRule: (input) => window.kitsuneAPI._call('observability/saveRule', { input }),
    removeRule: (id) => window.kitsuneAPI._call('observability/removeRule', { id }),
    prometheus: () => window.kitsuneAPI._call('observability/prometheus'),
    onChanged: (cb) => { window._kitsuneObservabilityCb = cb; }
  },
  automation: {
    list: () => window.kitsuneAPI._call('automation/list'),
    history: (limit) => window.kitsuneAPI._call('automation/history', { limit }),
    save: (input) => window.kitsuneAPI._call('automation/save', { input }),
    remove: (id) => window.kitsuneAPI._call('automation/remove', { id }),
    run: (id) => window.kitsuneAPI._call('automation/run', { id }),
    runDue: () => window.kitsuneAPI._call('automation/runDue'),
    onChanged: (cb) => { window._kitsuneAutomationCb = cb; }
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
      if (msg.type === 'lab:changed' && window._kitsuneLabChangedCb) window._kitsuneLabChangedCb(msg.payload);
      if (msg.type === 'lab:progress' && window._kitsuneLabProgressCb) window._kitsuneLabProgressCb(msg.payload);
      if (msg.type === 'apiFlow:changed' && window._kitsuneApiFlowChangedCb) window._kitsuneApiFlowChangedCb(msg.payload);
      if (msg.type === 'hub:changed' && window._kitsuneHubChangedCb) window._kitsuneHubChangedCb(msg.payload);
      if (msg.type === 'observability:changed' && window._kitsuneObservabilityCb) window._kitsuneObservabilityCb(msg.payload);
      if (msg.type === 'automation:changed' && window._kitsuneAutomationCb) window._kitsuneAutomationCb(msg.payload);
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
  observabilityManager.recordServiceExit(section, code);
  auditManager.record({ source: 'service-supervisor', action: code === 0 ? 'service.exit' : 'service.crash', target: section, success: code === 0, details: { exitCode: code } });
  broadcastSSE('service:exited', { section, code });
};

// ============ Terminal management (server-side) ============
const { spawn } = require('child_process');
let nodePty = null;
try { nodePty = require('node-pty'); } catch {}
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

function localShellProfiles() {
  const profiles = [];
  const addProfile = (id, name, executable, args = []) => {
    if (!executable) return;
    const resolved = process.platform === 'win32'
      ? (() => {
          try { return execFileSync('where.exe', [executable], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch { return ''; }
        })()
      : executable;
    if (resolved) profiles.push({ id, name, executable: resolved, args });
  };

  if (process.platform === 'win32') {
    addProfile('powershell', 'Windows PowerShell', 'powershell.exe', ['-NoLogo']);
    addProfile('pwsh', 'PowerShell 7', 'pwsh.exe', ['-NoLogo']);
    addProfile('cmd', 'Command Prompt', 'cmd.exe');
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find(file => fs.existsSync(file));
    if (gitBash) profiles.push({ id: 'git-bash', name: 'Git Bash', executable: gitBash, args: ['--login', '-i'] });
  } else {
    for (const [id, name, executable] of [
      ['shell', 'Default shell', process.env.SHELL || '/bin/bash'],
      ['bash', 'Bash', '/bin/bash'],
      ['zsh', 'Zsh', '/bin/zsh'],
      ['sh', 'Sh', '/bin/sh']
    ]) {
      addProfile(id, name, executable, ['-l']);
    }
  }

  return profiles;
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

function endpointPermission(endpoint, body = {}) {
  if (endpoint === 'security/status') return '';
  if (endpoint.startsWith('security/') || endpoint.startsWith('identity/')) return 'users.manage';
  if (endpoint.startsWith('audit/')) return 'audit.read';
  if (endpoint === 'hub/status' || endpoint === 'hub/settings' || endpoint === 'hub/reconcile') return 'nodes.read';
  if (endpoint === 'hub/nodes' || endpoint === 'hub/heartbeat') return 'nodes.read';
  if (['hub/createPairing', 'hub/revokeNode'].includes(endpoint)) return 'nodes.manage';
  if (endpoint === 'hub/teams') return 'nodes.read';
  if (endpoint.startsWith('hub/saveTeam') || endpoint.startsWith('hub/removeTeam')) return 'teams.manage';
  if (endpoint === 'hub/routes') return 'routes.read';
  if (['hub/saveRoute', 'hub/removeRoute'].includes(endpoint)) return 'routes.*';
  if (endpoint === 'hub/inventory' || endpoint === 'hub/history') return 'projects.read';
  if (endpoint === 'hub/sync/publish') {
    const kind = String(body.input?.kind || 'project');
    return kind === 'api-flow' ? 'api-flows.sync' : `${kind}s.sync`;
  }
  if (['hub/publishLocal', 'hub/rollback', 'hub/applyObject'].includes(endpoint)) return 'projects.sync';
  if (endpoint === 'hub/deployments') return 'deployments.read';
  if (endpoint === 'hub/createDeployment') return 'deployments.create';
  if (endpoint === 'hub/approveDeployment' || endpoint === 'hub/updateDeployment') return 'deployments.update';
  if (['hub/pushRemote', 'hub/pullRemote', 'hub/syncRemote'].includes(endpoint)) return 'projects.sync';
  if (endpoint.startsWith('hub/') && /(configure|Connector|Remote)/.test(endpoint)) return 'settings.manage';
  if (endpoint.startsWith('config/') && !['config/get', 'config/getDefaults', 'config/getAppRoot'].includes(endpoint)) return 'settings.manage';
  if (endpoint.startsWith('workspace/')) return /\/(list|get|templates|detect|inspect|environment|url|secretKeys)$/.test(endpoint) ? 'projects.read' : (/\/(start|stop|open)$/.test(endpoint) ? 'projects.operate' : 'projects.sync');
  if (endpoint.startsWith('lab/')) return /\/(list|get|recipes|preview|health)$/.test(endpoint) ? 'labs.read' : (/\/(start|stop|provision)$/.test(endpoint) ? 'labs.operate' : 'labs.sync');
  if (endpoint.startsWith('apiFlow/')) return /\/(list|get|catalog|validate|status|logs)$/.test(endpoint) ? 'api-flows.read' : 'api-flows.*';
  if (endpoint.startsWith('service/') || endpoint.startsWith('terminal/') || endpoint.startsWith('command/')) return 'nodes.operate';
if (/^(remote|files|storage|advanced|fabric|enterprise|nextgen|opsWorkspace|terminalFilePro|terminalFileVision|terminalFileRuntime|terminalFileDeep)\//.test(endpoint)) return /\/(list|summary|agents|graph|commands|configuration|workspaces|evaluate|forecast|diff|blastRadius|digitalTwin|logs|anomaly|explain|dns|certificate|policyEvaluate|serviceMap|gitOpsPlan|dbDiff|dbErd|dbMask|copilot|replaySimulate|agentProbe|agentBootstrap|sloEvaluate|capacityForecast|airgapVerify|failoverPlan|relayRoute|relayBootstrap|shellParse|deltaSignature|deltaPlan|snapshotBrowse|ransomwareScan|networkTwin|blackBoxExport|dnaCompare|connectivityHeal|intentPlan|simulatorRun|resume|timeline|undoPlan|connectionDoctor|smartTransfer|environmentDiff|memorySearch|autocomplete|movie|palettePlan|secretless|notebook|pasteAnalyze|translate|sidecar|checkpointRestore|resultMatrix|outputActions|recordingStudio|hugeFile|indexSearch|provenance|duplicates|heatmap|causality|pipelinePlan|dropZoneInspect)$/.test(endpoint) ? 'nodes.read' : 'nodes.operate';
  return '';
}

function syncPathForConfigTransition(previous, current, result) {
  if (!result?.success) return result;
  const pathResult = pathManager.syncForConfigTransition(previous, current);
  if (pathResult.skipped) return result;
  return pathResult.success
    ? { ...result, pathUpdated: true, ...(pathResult.warning ? { pathWarning: pathResult.warning } : {}) }
    : { ...result, pathWarning: pathResult.error };
}

const parityHandlers = {
  'remote/list': () => remoteAccessManager.list(), 'remote/save': body => remoteAccessManager.save(body.input, body.secrets), 'remote/remove': body => remoteAccessManager.remove(body.id), 'remote/duplicate': body => remoteAccessManager.duplicate(body.id), 'remote/resetHostKey': body => remoteAccessManager.resetHostKey(body.id), 'remote/test': async body => { try { const { client } = await remoteAccessManager.connect(body.input); client.end(); return { success: true }; } catch (error) { return { success: false, error: error.message }; } }, 'remote/diagnose': body => remoteAccessManager.diagnose(body.input), 'remote/inspect': body => remoteOperationsManager.inspect(body.input, body.kind), 'remote/docker': body => remoteOperationsManager.docker(body.input, body.action, body.target), 'remote/systemd': body => remoteOperationsManager.systemd(body.input, body.action, body.unit), 'remote/signal': body => remoteOperationsManager.signal(body.input, body.pid, body.signal), 'remote/archive': body => remoteOperationsManager.archive(body.input, body.action, body.source, body.destination), 'remote/wake': body => remoteOperationsManager.wake(body.mac, body.address, body.port), 'remote/deploy': body => remoteOperationsManager.deploy(body.connection, body.options),
  'files/localList': body => remoteAccessManager.localList(body.directory), 'files/localMutate': body => remoteAccessManager.localMutate(body.operation, body.target, body.destination), 'files/remoteList': body => remoteAccessManager.remoteList(body.connection, body.directory), 'files/transfer': body => remoteAccessManager.transfer(body.connection, body.direction, body.localPath, body.remotePath), 'files/transferResumable': body => remoteAccessManager.transferResumable(body.connection, body.direction, body.localPath, body.remotePath), 'files/transferRecursive': body => remoteAccessManager.transferRecursive(body.connection, body.direction, body.localPath, body.remotePath), 'files/remoteMutate': body => remoteAccessManager.mutate(body.connection, body.operation, body.target, body.destination), 'files/readLocal': body => remoteAccessManager.readLocal(body.target), 'files/writeLocal': body => remoteAccessManager.writeLocal(body.target, body.content), 'files/readRemote': body => remoteAccessManager.readRemote(body.connection, body.target), 'files/writeRemote': body => remoteAccessManager.writeRemote(body.connection, body.target, body.content), 'files/searchLocal': body => remoteAccessManager.searchLocal(body.directory, body.query), 'files/searchRemote': body => remoteAccessManager.searchRemote(body.connection, body.directory, body.query), 'files/diff': async body => { const remoteFile = await remoteAccessManager.readRemote(body.connection, body.remotePath); return remoteAccessManager.diffText(body.localPath, remoteFile.content); }, 'files/syncPreview': body => remoteAccessManager.syncPreview(body.connection, body.localPath, body.remotePath, body.options), 'files/syncApply': body => remoteAccessManager.syncApply(body.connection, body.preview, body.direction, body.selected),
  'storage/list': () => cloudStorageManager.list(), 'storage/save': body => cloudStorageManager.save(body.input, body.secrets), 'storage/remove': body => cloudStorageManager.remove(body.id), 'storage/test': body => cloudStorageManager.test(body.input), 'storage/listFiles': body => cloudStorageManager.listFiles(body.input, body.directory), 'storage/transfer': body => cloudStorageManager.transferLocal(body.input, body.direction, body.localPath, body.remotePath), 'storage/transferRecursive': body => cloudStorageManager.transferRecursive(body.input, body.direction, body.localPath, body.remotePath), 'storage/mutate': body => cloudStorageManager.mutate(body.input, body.operation, body.target, body.destination), 'storage/read': body => cloudStorageManager.read(body.input, body.remotePath), 'storage/write': body => cloudStorageManager.write(body.input, body.remotePath, body.content),
  'advanced/graph': () => advancedOpsManager.graph(), 'advanced/commands': () => advancedOpsManager.commandCatalog(), 'advanced/configuration': () => advancedOpsManager.configuration(), 'advanced/workspaces': () => advancedOpsManager.listSmartWorkspaces(), 'advanced/workspaceSave': body => advancedOpsManager.saveSmartWorkspace(body.input), 'advanced/search': body => advancedOpsManager.globalSearch(body.query, body.options), 'advanced/secretScan': body => advancedOpsManager.secretScan(body.content, body.label), 'advanced/preflight': body => advancedOpsManager.preflight(body.input, body.options), 'advanced/capture': body => advancedOpsManager.captureInfrastructure(body.input), 'advanced/diff': body => advancedOpsManager.diffInfrastructure(body.left, body.right), 'advanced/drift': body => advancedOpsManager.checkDrift(body.input), 'advanced/blastRadius': body => advancedOpsManager.blastRadius(body.input), 'advanced/digitalTwin': body => advancedOpsManager.digitalTwin(body.capture, body.operation), 'advanced/logs': body => advancedOpsManager.logCorrelate(body.sources), 'advanced/anomaly': body => advancedOpsManager.anomaly(body.samples), 'advanced/explain': body => advancedOpsManager.explainError(body.value), 'advanced/dns': body => advancedOpsManager.dnsInspect(body.hostname), 'advanced/certificate': body => advancedOpsManager.certificateInspect(body.hostname, body.port),
  'fabric/summary': () => operationsFabricManager.summary(), 'fabric/policySave': body => operationsFabricManager.savePolicy(body.input), 'fabric/policyEvaluate': body => operationsFabricManager.evaluatePolicy(body.context), 'fabric/serviceMap': body => operationsFabricManager.serviceMap(body.input), 'fabric/gitOpsPlan': body => operationsFabricManager.gitOpsPlan(body.observed, body.desired), 'fabric/syntheticSave': body => operationsFabricManager.saveSynthetic(body.input), 'fabric/syntheticRun': body => operationsFabricManager.runSynthetic(body.id), 'fabric/canarySave': body => operationsFabricManager.saveCanary(body.input), 'fabric/canaryAdvance': body => operationsFabricManager.advanceCanary(body.id, body.metrics), 'fabric/dbDiff': body => operationsFabricManager.databaseSchemaDiff(body.left, body.right), 'fabric/dbErd': body => operationsFabricManager.databaseErd(body.schema), 'fabric/dbMask': body => operationsFabricManager.maskRows(body.rows, body.rules), 'fabric/copilot': body => operationsFabricManager.localCopilot(body.context), 'fabric/replaySimulate': body => operationsFabricManager.simulateReplay(body.id, body.action),
  'enterprise/configuration': () => enterpriseOpsManager.configuration(),
  'enterprise/summary': () => enterpriseOpsManager.summary(), 'enterprise/agents': () => enterpriseOpsManager.listAgents(), 'enterprise/agentEnroll': body => enterpriseOpsManager.enrollAgent(body.input), 'enterprise/agentRemove': body => enterpriseOpsManager.removeAgent(body.id), 'enterprise/agentProbe': body => enterpriseOpsManager.probeAgent(body.id), 'enterprise/agentBootstrap': body => enterpriseOpsManager.agentBootstrap(body.input), 'enterprise/sloSave': body => enterpriseOpsManager.saveSlo(body.input), 'enterprise/sloRecord': body => enterpriseOpsManager.recordSlo(body.id, body.sample), 'enterprise/sloEvaluate': () => enterpriseOpsManager.evaluateSlos(), 'enterprise/capacityRecord': body => enterpriseOpsManager.recordCapacity(body.resource, body.value, body.at), 'enterprise/capacityForecast': body => enterpriseOpsManager.forecastCapacity(body.resource, body.limit), 'enterprise/patchSave': body => enterpriseOpsManager.savePatchPlan(body.input), 'enterprise/patchRun': body => enterpriseOpsManager.runPatchPlan(body.id, body.options), 'enterprise/rebootPlan': body => enterpriseOpsManager.planReboots(body.input), 'enterprise/rebootRun': body => enterpriseOpsManager.runReboots(body.id, body.options), 'enterprise/complianceSave': body => enterpriseOpsManager.saveComplianceBaseline(body.input), 'enterprise/complianceScan': body => enterpriseOpsManager.scanCompliance(body.id, body.sessions), 'enterprise/supplyChainScan': body => enterpriseOpsManager.scanSupplyChain(body.input), 'enterprise/imagePromote': body => enterpriseOpsManager.promoteImage(body.input), 'enterprise/airgapCreate': body => enterpriseOpsManager.createAirgapBackup(body.input), 'enterprise/airgapVerify': body => enterpriseOpsManager.verifyAirgap(body.id), 'enterprise/oidcSave': body => enterpriseOpsManager.saveOidcProfile(body.input), 'enterprise/oidcLogin': body => enterpriseOpsManager.loginOidc(body.id), 'enterprise/chaosSave': body => enterpriseOpsManager.saveChaosExperiment(body.input), 'enterprise/chaosRun': body => enterpriseOpsManager.runChaos(body.id, body.options), 'enterprise/remediationSave': body => enterpriseOpsManager.saveRemediationRule(body.input), 'enterprise/autonomousSandbox': body => enterpriseOpsManager.autonomousSandbox(body.context), 'enterprise/migrationRehearse': body => enterpriseOpsManager.rehearseMigration(body.connection, body.database, body.sql), 'enterprise/configValidate': body => enterpriseOpsManager.validateConfig(body.input), 'enterprise/cloudInit': body => enterpriseOpsManager.generateCloudInit(body.input), 'enterprise/regionSave': body => enterpriseOpsManager.saveRegion(body.input), 'enterprise/failoverPlan': body => enterpriseOpsManager.failoverPlan(body.fromId, body.toId), 'enterprise/marketplaceInstall': body => enterpriseOpsManager.installMarketplacePack(body.input)
  ,'nextgen/summary': () => nextgenOpsManager.summary(), 'nextgen/configuration': () => nextgenOpsManager.configuration(), 'nextgen/relaySave': body => nextgenOpsManager.saveRelayNode(body.input), 'nextgen/relayRoute': body => nextgenOpsManager.routeRelay(body.fromId, body.toId), 'nextgen/relayBootstrap': body => nextgenOpsManager.relayBootstrap(body.input), 'nextgen/capabilityIssue': body => nextgenOpsManager.issueCapability(body.input), 'nextgen/capabilityUse': body => nextgenOpsManager.useCapability(body.id, body.parameters), 'nextgen/shellParse': body => nextgenOpsManager.parseShellTranscript(body.transcript), 'nextgen/deltaSignature': body => nextgenOpsManager.deltaSignature(body.file, body.blockSize), 'nextgen/deltaPlan': body => nextgenOpsManager.deltaPlan(body.file, body.signature), 'nextgen/snapshotCreate': body => nextgenOpsManager.createFilesystemSnapshot(body.input), 'nextgen/snapshotBrowse': body => nextgenOpsManager.browseSnapshot(body.id, body.prefix), 'nextgen/snapshotRestore': body => nextgenOpsManager.restoreSnapshotFile(body.id, body.relative, body.target), 'nextgen/ransomwareBaseline': body => nextgenOpsManager.ransomwareBaseline(body.root), 'nextgen/ransomwareScan': body => nextgenOpsManager.ransomwareScan(body.root, body.thresholds), 'nextgen/desktopSave': body => nextgenOpsManager.saveDesktopGateway(body.input), 'nextgen/sshPolicySave': body => nextgenOpsManager.saveSshCertificatePolicy(body.input), 'nextgen/sshCertificateIssue': body => nextgenOpsManager.issueSshCertificate(body.policyId, body.publicKey, body.identity, body.verified), 'nextgen/ebpf': body => nextgenOpsManager.ebpfDiagnostics(body.input, body.kind), 'nextgen/networkTwin': body => nextgenOpsManager.networkDigitalTwin(body.input), 'nextgen/transaction': body => nextgenOpsManager.remoteTransaction(body.input, body.steps, body.options), 'nextgen/pairCreate': body => nextgenOpsManager.pairSession(body.input), 'nextgen/pairPropose': body => nextgenOpsManager.pairPropose(body.id, body.action, body.actor), 'nextgen/pairApprove': body => nextgenOpsManager.pairApprove(body.id, body.actor), 'nextgen/mobileCreate': body => nextgenOpsManager.createMobileApproval(body.input), 'nextgen/mobileResolve': body => nextgenOpsManager.resolveMobileApproval(body.id, body.challenge, body.decision, body.authenticator), 'nextgen/wasmRun': body => nextgenOpsManager.runWasm(body.input), 'nextgen/blackBoxRecord': body => nextgenOpsManager.blackBoxRecord(body.event), 'nextgen/blackBoxExport': body => nextgenOpsManager.exportBlackBox(body.minutes), 'nextgen/dnaCapture': body => nextgenOpsManager.captureServerDna(body.input), 'nextgen/dnaCompare': body => nextgenOpsManager.compareServerDna(body.left, body.right), 'nextgen/connectivityHeal': body => nextgenOpsManager.selfHealConnectivity(body.input), 'nextgen/intentPlan': body => nextgenOpsManager.planIntent(body.input), 'nextgen/simulatorCreate': body => nextgenOpsManager.createFlightSimulator(body.input), 'nextgen/simulatorRun': body => nextgenOpsManager.runFlightSimulator(body.id, body.response)
  ,'nextgen/sshCertificateIssueMfa': body => { const authentication = body.authentication || {}; const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Fresh MFA authentication failed'); return nextgenOpsManager.issueSshCertificate(body.policyId, body.publicKey, body.identity, true); },
  'files/localMutate': body => { nextgenOpsManager.assertLocalWritable(body.target); if (body.destination) nextgenOpsManager.assertLocalWritable(body.destination); return remoteAccessManager.localMutate(body.operation, body.target, body.destination); },
  'files/writeLocal': body => { nextgenOpsManager.assertLocalWritable(body.target); return remoteAccessManager.writeLocal(body.target, body.content); },
  'files/transfer': body => { if (body.direction === 'download') nextgenOpsManager.assertLocalWritable(body.localPath); return remoteAccessManager.transfer(body.connection, body.direction, body.localPath, body.remotePath); },
  'files/transferResumable': body => { if (body.direction === 'download') nextgenOpsManager.assertLocalWritable(body.localPath); return remoteAccessManager.transferResumable(body.connection, body.direction, body.localPath, body.remotePath); },
  'files/transferRecursive': body => { if (body.direction === 'download') nextgenOpsManager.assertLocalWritable(body.localPath); return remoteAccessManager.transferRecursive(body.connection, body.direction, body.localPath, body.remotePath); },
  'files/syncApply': body => { if (body.direction === 'download' && body.preview?.localRoot) nextgenOpsManager.assertLocalWritable(body.preview.localRoot); return remoteAccessManager.syncApply(body.connection, body.preview, body.direction, body.selected); },
  'storage/transfer': body => { if (body.direction === 'download') nextgenOpsManager.assertLocalWritable(body.localPath); return cloudStorageManager.transferLocal(body.input, body.direction, body.localPath, body.remotePath); },
  'storage/transferRecursive': body => { if (body.direction === 'download') nextgenOpsManager.assertLocalWritable(body.localPath); return cloudStorageManager.transferRecursive(body.input, body.direction, body.localPath, body.remotePath); },
  'nextgen/deltaApply': body => nextgenOpsManager.deltaApply(body.source, body.destination, body.plan),
  'nextgen/mobileResolveMfa': body => { const authentication = body.authentication || {}; const verified = identityManager.authenticate(authentication.username, authentication.password, authentication.secondFactor); if (!verified.success) throw new Error(verified.error || 'Fresh MFA authentication failed'); return nextgenOpsManager.resolveMobileApproval(body.id, body.challenge, body.decision, { verified: true, username: authentication.username }); }
};

Object.assign(parityHandlers, {
  'opsWorkspace/summary': () => operationsWorkspaceManager.summary(),
  'opsWorkspace/configuration': () => operationsWorkspaceManager.configuration(),
  'opsWorkspace/save': body => operationsWorkspaceManager.saveUniversalWorkspace(body.input),
  'opsWorkspace/resume': body => operationsWorkspaceManager.resumeWorkspace(body.id),
  'opsWorkspace/timelineRecord': body => operationsWorkspaceManager.recordCommandEffect(body.input),
  'opsWorkspace/timeline': body => operationsWorkspaceManager.timeline(body.sessionId, body.options),
  'opsWorkspace/undoPlan': body => operationsWorkspaceManager.undoPlan(body.id),
  'opsWorkspace/undoExecute': body => operationsWorkspaceManager.undoExecute(body.id, body.approved),
  'opsWorkspace/connectionDoctor': body => operationsWorkspaceManager.connectionDoctor(body.id),
  'opsWorkspace/smartTransfer': body => operationsWorkspaceManager.smartTransferPlan(body.input),
  'opsWorkspace/fleetPreview': body => operationsWorkspaceManager.fleetPreview(body.ids, body.template, body.parameters, body.options),
  'opsWorkspace/fleetExecute': body => operationsWorkspaceManager.fleetExecute(body.preview, body.approved),
  'opsWorkspace/environmentDiff': body => operationsWorkspaceManager.environmentDiff(body.left, body.right),
  'opsWorkspace/disposableRescue': body => operationsWorkspaceManager.createDisposableRescue(body.input),
  'opsWorkspace/portableRescue': body => operationsWorkspaceManager.createPortableRescueKit(body.input),
  'opsWorkspace/memoryRecord': body => operationsWorkspaceManager.recordMemory(body.input),
  'opsWorkspace/memorySearch': body => operationsWorkspaceManager.searchMemory(body.query, body.sessionId),
  'opsWorkspace/multiplexerSave': body => operationsWorkspaceManager.saveMultiplexer(body.input),
  'opsWorkspace/autocomplete': body => operationsWorkspaceManager.policyAutocomplete(body.input),
  'opsWorkspace/incidentRoom': body => operationsWorkspaceManager.createIncidentRoom(body.input),
  'opsWorkspace/collaborativeChange': body => operationsWorkspaceManager.collaborativeFileChange(body.input),
  'opsWorkspace/movie': body => operationsWorkspaceManager.infrastructureMovie(body.sessionId, body.options),
  'opsWorkspace/blastRadius': body => operationsWorkspaceManager.liveBlastRadius(body.sessionId, body.operation),
  'opsWorkspace/networkReplayCreate': body => operationsWorkspaceManager.createNetworkReplay(body.input),
  'opsWorkspace/networkReplayRun': body => operationsWorkspaceManager.runNetworkReplay(body.id, body.response),
  'opsWorkspace/palettePlan': body => operationsWorkspaceManager.commandPalettePlan(body.input),
  'opsWorkspace/secretless': body => operationsWorkspaceManager.secretlessReadiness(body.sessionId)
});

Object.assign(parityHandlers, {
  'terminalFileVision/summary': () => terminalFileVisionManager.summary(),
  'terminalFileVision/configuration': () => terminalFileVisionManager.configuration(),
  'terminalFileVision/execute': body => terminalFileVisionManager.execute(body.feature, body.input)
});
Object.assign(parityHandlers, {
  'terminalFileRuntime/summary': () => terminalFileRuntimeManager.summary(),
  'terminalFileRuntime/audit': body => terminalFileRuntimeManager.runtimeAudit(body.input),
  'terminalFileRuntime/execute': body => terminalFileRuntimeManager.execute(body.capability, body.input)
});
Object.assign(parityHandlers, {
  'terminalFileDeep/summary': () => terminalFileDeepManager.summary(),
  'terminalFileDeep/execute': body => terminalFileDeepManager.execute(body.capability, body.input)
});

Object.assign(parityHandlers, {
  'terminalFilePro/summary': () => terminalFileProManager.summary(), 'terminalFilePro/configuration': () => terminalFileProManager.configuration(), 'terminalFilePro/notebookSave': body => terminalFileProManager.saveNotebook(body.input), 'terminalFilePro/notebook': body => terminalFileProManager.notebook(body.id), 'terminalFilePro/pasteAnalyze': body => terminalFileProManager.analyzePaste(body.value), 'terminalFilePro/translate': body => terminalFileProManager.translateShell(body.input), 'terminalFilePro/sidecar': body => terminalFileProManager.sidecar(body.sessionId), 'terminalFilePro/shadow': body => terminalFileProManager.shadowCommand(body.sessionId, body.template, body.parameters, body.options), 'terminalFilePro/checkpointSave': body => terminalFileProManager.saveCheckpoint(body.input), 'terminalFilePro/checkpointRestore': body => terminalFileProManager.restoreCheckpoint(body.id), 'terminalFilePro/resultMatrix': body => terminalFileProManager.resultMatrix(body.results), 'terminalFilePro/outputActions': body => terminalFileProManager.outputActions(body.output), 'terminalFilePro/recordingStudio': body => terminalFileProManager.recordingStudio(body.input), 'terminalFilePro/protocolSave': body => terminalFileProManager.saveProtocolConsole(body.input),
  'terminalFilePro/multiFilePreview': body => terminalFileProManager.multiFilePreview(body.sessionId, body.changes), 'terminalFilePro/multiFileApply': body => terminalFileProManager.multiFileApply(body.preview, body.approved), 'terminalFilePro/containerFiles': body => terminalFileProManager.containerFiles(body.sessionId, body.input), 'terminalFilePro/gitFiles': body => terminalFileProManager.gitFiles(body.sessionId, body.input), 'terminalFilePro/archiveFiles': body => terminalFileProManager.archiveFiles(body.sessionId, body.input), 'terminalFilePro/hugeFile': body => terminalFileProManager.hugeFile(body.sessionId, body.input), 'terminalFilePro/indexBuild': body => terminalFileProManager.buildIndex(body.sessionId, body.root, body.options), 'terminalFilePro/indexSearch': body => terminalFileProManager.searchIndex(body.id, body.query), 'terminalFilePro/provenanceRecord': body => terminalFileProManager.recordProvenance(body.input), 'terminalFilePro/provenance': body => terminalFileProManager.provenance(body.sha256), 'terminalFilePro/crossProtocolPlan': body => terminalFileProManager.crossProtocolPlan(body.input), 'terminalFilePro/duplicates': body => terminalFileProManager.duplicates(body.sessionId, body.root), 'terminalFilePro/heatmap': body => terminalFileProManager.heatmap(body.sessionId, body.root), 'terminalFilePro/causality': body => terminalFileProManager.causality(body.sessionId, body.file), 'terminalFilePro/splitContext': body => terminalFileProManager.updateSplitContext(body.input),
  'terminalFilePro/pipelineSave': body => terminalFileProManager.savePipeline(body.input), 'terminalFilePro/pipelinePlan': body => terminalFileProManager.pipelinePlan(body.id, body.context), 'terminalFilePro/dropZoneCreate': body => terminalFileProManager.createDropZone(body.input), 'terminalFilePro/dropZoneInspect': body => terminalFileProManager.inspectDropZone(body.id), 'terminalFilePro/capsuleCreate': body => terminalFileProManager.createConnectionCapsule(body.input), 'terminalFilePro/capsuleOpen': body => terminalFileProManager.openConnectionCapsule(body.target, body.passphrase), 'terminalFilePro/airDropCreate': body => terminalFileProManager.createAirDrop(body.input), 'terminalFilePro/airDropConsume': body => terminalFileProManager.consumeAirDrop(body.id, body.code, body.destination), 'terminalFilePro/clipboardPut': body => terminalFileProManager.clipboardPut(body.input), 'terminalFilePro/clipboardTake': body => terminalFileProManager.clipboardTake(body.id, body.sessionId), 'terminalFilePro/filesystemWatch': body => terminalFileProManager.filesystemWatch(body.input)
});

async function handleAPI(endpoint, body, context = {}) {
  const permission = endpointPermission(endpoint, body);
  if (permission && !identityManager.hasPermission(context.principal, permission, context.resource || null)) {
    const error = new Error(`Missing permission: ${permission}`); error.status = 403; throw error;
  }
  if (parityHandlers[endpoint]) return parityHandlers[endpoint](body || {}, context);
  switch (endpoint) {
    case 'security/status': return {
      mode: 'server', https: IS_HTTPS, totpEnabled: identityManager.listUsers().some(user => user.mfaEnabled), apiTokenEnabled: Boolean(API_TOKEN) || identityManager.listTokens().length > 0,
      allowlistEnabled: ALLOWED_IPS.length > 0, allowedRules: ALLOWED_IPS, currentSessionId: context.sessionId || null,
      sessionCount: identityManager.listSessions().length, clientAddress: context.clientAddress || '', user: context.user || null,
      authMode: hubManager.settings().authMode
    };
    case 'security/sessions': return identityManager.listSessions(context.sessionId);
    case 'security/revokeSession': {
      const id = String(body.id || '');
      const result = identityManager.revokeSession(id); if (result.success) terminateSessionResources(id);
      return { ...result, revokedCurrent: id === context.sessionId };
    }
    case 'security/revokeOtherSessions': {
      const existing = identityManager.listSessions(context.sessionId).filter(item => !item.current);
      const result = identityManager.revokeOtherSessions(context.sessionId); for (const item of existing) terminateSessionResources(item.id); return result;
    }
    case 'identity/roles': return identityManager.roles();
    case 'identity/users': return identityManager.listUsers();
    case 'identity/createUser': return identityManager.createUser(body.input || {});
    case 'identity/updateUser': return identityManager.updateUser(body.id, body.patch || {});
    case 'identity/removeUser': return identityManager.removeUser(body.id);
    case 'identity/enableTotp': return identityManager.enableTotp(body.id);
    case 'identity/disableTotp': return identityManager.disableTotp(body.id);
    case 'identity/tokens': return identityManager.listTokens();
    case 'identity/createToken': return identityManager.createToken(body.input || {});
    case 'identity/revokeToken': return identityManager.revokeToken(body.id);
    case 'identity/invitations': return identityManager.listInvitations();
    case 'identity/createInvitation': return identityManager.createInvitation({ ...(body.input || {}), createdBy: context.principal?.userId || '' });
    case 'identity/removeInvitation': return identityManager.removeInvitation(body.id);
    case 'hub/status': return hubManager.status();
    case 'hub/settings': return hubManager.settings();
    case 'hub/configure': return hubManager.configure(body.input || {});
    case 'hub/teams': return hubManager.listTeams();
    case 'hub/saveTeam': return hubManager.saveTeam(body.input || {}, context.principal);
    case 'hub/removeTeam': return hubManager.removeTeam(body.id);
    case 'hub/nodes': return hubManager.listNodes();
    case 'hub/createPairing': return hubManager.createPairing(body.input || {}, context.principal);
    case 'hub/heartbeat': return hubManager.heartbeat(body.nodeId || context.principal?.nodeId, body.input || {});
    case 'hub/revokeNode': return hubManager.revokeNode(body.id);
    case 'hub/routes': return hubManager.listRoutes();
    case 'hub/saveRoute': return hubManager.saveRoute(body.input || {});
    case 'hub/removeRoute': return hubManager.removeRoute(body.id);
    case 'hub/inventory': return hubManager.inventory(body.filters || {});
    case 'hub/sync/publish': return hubManager.publish(body.input || {}, context.principal);
    case 'hub/publishLocal': return hubManager.publishLocal(body.options || {}, context.principal);
    case 'hub/history': return hubManager.history(body.id);
    case 'hub/rollback': return hubManager.rollback(body.id, body.revision, context.principal);
    case 'hub/applyObject': return hubManager.applyObject(body.id, body.options || {});
    case 'hub/deployments': return hubManager.listDeployments(body.filters || {});
    case 'hub/createDeployment': return hubManager.createDeployment(body.input || {}, context.principal);
    case 'hub/approveDeployment': return hubManager.approveDeployment(body.id, context.principal);
    case 'hub/updateDeployment': return hubManager.updateDeployment(body.id, body.input || {});
    case 'hub/connectors': return hubManager.listConnectors();
    case 'hub/saveConnector': return hubManager.saveConnector(body.input || {}, body.secret || '');
    case 'hub/removeConnector': return hubManager.removeConnector(body.id);
    case 'hub/remotes': return hubManager.listRemotes();
    case 'hub/saveRemote': return hubManager.saveRemote(body.input || {}, body.token || '');
    case 'hub/removeRemote': return hubManager.removeRemote(body.id);
    case 'hub/pushRemote': return hubManager.pushToRemote(body.id, body.options || {}, context.principal);
    case 'hub/pullRemote': return hubManager.pullFromRemote(body.id, body.options || {}, context.principal);
    case 'hub/syncRemote': return hubManager.syncRemote(body.id, body.options || {}, context.principal);
    case 'hub/reconcile': return hubManager.reconcile();
    case 'audit/list': return auditManager.list(body.options || {});
    case 'audit/verify': return auditManager.verify();
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
      const progress = payload => broadcastSSE('download:progress', payload);
      let result;
      if (body.service === 'python' && process.platform === 'win32') {
        progress({ service: body.service, version: body.version, stage: 'python-manager', percent: 5 });
        broadcastSSE('path:pythonManagerStatus', { stage: 'installing', automatic: true });
        const managerResult = await pathManager.installOfficialPythonManager();
        broadcastSSE('path:pythonManagerStatus', {
          stage: managerResult.success ? 'complete' : 'failed', automatic: true,
          alreadyInstalled: Boolean(managerResult.alreadyInstalled), error: managerResult.error || ''
        });
        if (!managerResult.success) return { success: false, error: managerResult.error || 'Python Install Manager installation failed' };
        result = await pathManager.installPythonRuntime(body.version, progress);
      } else {
        result = await downloadManager.download(body.service, body.version, progress);
      }
      if (result.success) {
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
      await recoveryPromise;
      return {
        name: 'KitsuneServ', version: packageInfo.version, dataRoot: appRoot, platform: process.platform, mode: 'server', safeMode: SAFE_MODE,
        migration: configManager.getMigrationInfo(), recovery: projectManager.getRecoveryReport()
      };
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
    case 'db/listObjectsFor': return dbViewer.listObjectsFor(body.connection, body.database);
    case 'db/describeObjectFor': return dbViewer.describeObjectFor(body.connection, body.database, body.schema, body.objectName);
    case 'db/tableDataFor': return dbViewer.tableDataFor(body.connection, body.database, body.table, body.limit, body.offset, body.schema);
    case 'db/executeQueryFor': return dbViewer.executeQueryFor(body.connection, body.database, body.query);
    case 'db/executeWorkbench': return dbViewer.executeWorkbench(body.connection, body.database, body.query, body.options || {});
    case 'db/cancelQuery': return dbViewer.cancelQuery(body.id);
    case 'db/activeQueries': return dbViewer.listActiveQueries();
    case 'db/queryHistory': return dbViewer.queryHistory(body.limit);
    case 'db/clearQueryHistory': return dbViewer.clearQueryHistory();
    case 'db/savedQueries': return dbViewer.listSavedQueries();
    case 'db/saveQuery': return dbViewer.saveQuery(body.input || {});
    case 'db/removeSavedQuery': return dbViewer.removeSavedQuery(body.id);
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
      const profiles = localShellProfiles();
      const localProfile = String(body?.connection?.localProfile || '').trim();
      const profile = profiles.find(item => item.id === localProfile) || profiles.find(item => item.id === 'shell') || profiles[0];
      if (!profile) return { success: false, error: 'No local shell is available' };
      const env = buildTerminalEnv();
      const isWin = process.platform === 'win32';
      let child;
      try {
        child = nodePty
          ? nodePty.spawn(profile.executable, profile.args, { name: 'xterm-256color', cols: 120, rows: 32, env, cwd: path.resolve('.'), useConpty: isWin })
          : spawn(profile.executable, profile.args, { env, cwd: path.resolve('.'), stdio: ['pipe', 'pipe', 'pipe'], ...(isWin ? { windowsHide: true } : {}) });
      } catch (error) {
        return { success: false, error: error.message };
      }
      terminals.set(id, { process: child, id, pty: Boolean(nodePty), sessionId: context.sessionId });
      if (nodePty) {
        child.onData(data => broadcastSSE('terminal:data', { id, data }, context.sessionId));
        child.onExit(({ exitCode }) => { terminals.delete(id); broadcastSSE('terminal:exit', { id, code: exitCode }, context.sessionId); });
      } else {
        child.stdout.on('data', data => broadcastSSE('terminal:data', { id, data: data.toString() }, context.sessionId));
        child.stderr.on('data', data => broadcastSSE('terminal:data', { id, data: data.toString() }, context.sessionId));
        child.on('error', error => { terminals.delete(id); broadcastSSE('terminal:data', { id, data: `[KitsuneServ] ${error.message}\n` }, context.sessionId); broadcastSSE('terminal:exit', { id, code: 1 }, context.sessionId); });
        child.on('exit', code => { terminals.delete(id); broadcastSSE('terminal:exit', { id, code }, context.sessionId); });
      }
      return { id, name: profile.name, profileId: profile.id, pty: Boolean(nodePty) };
    }
    case 'terminal/profiles': return localShellProfiles();

    // Project workspaces and stack orchestration
    case 'workspace/templates': return projectManager.templates();
    case 'workspace/list': return projectManager.list();
    case 'workspace/get': return projectManager.get(body.id);
    case 'workspace/create': {
      const project = projectManager.create(body.options || {});
      return { ...project, hostsSync: projectManager.syncDomains({ elevate: false }) };
    }
    case 'workspace/update': {
      const project = projectManager.update(body.id, body.patch || {});
      return { ...project, hostsSync: projectManager.syncDomains({ elevate: false }) };
    }
    case 'workspace/remove': {
      const result = projectManager.remove(body.id, body.options || {});
      return result.success ? { ...result, hostsSync: projectManager.syncDomains({ elevate: false }) } : result;
    }
    case 'workspace/start': await recoveryPromise; return projectManager.start(body.id);
    case 'workspace/stop': return projectManager.stop(body.id);
    case 'workspace/export': return projectManager.exportManifest(body.id);
    case 'workspace/import': {
      const project = projectManager.importManifest(body.manifest, body.options || {});
      return { ...project, hostsSync: projectManager.syncDomains({ elevate: false }) };
    }
    case 'workspace/detect': return projectDetector.detect(body.directory);
    case 'workspace/inspectCompose': return projectDetector.inspectCompose(body.file);
    case 'workspace/inspectDevcontainer': return projectDetector.inspectDevcontainer(body.file);
    case 'workspace/secretKeys': return projectManager.listSecretKeys(body.id);
    case 'workspace/setSecrets': return projectManager.setSecrets(body.id, body.secrets || {});
    case 'workspace/environment': return projectManager.resolveEnvironment(body.id, { includeSecrets: false });
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
    case 'diagnostics/preflight': return diagnosticsManager.preflight(projectManager.get(body.projectId));
    case 'diagnostics/ports': return diagnosticsManager.ports();
    case 'diagnostics/findFreePort': return diagnosticsManager.findFreePort(body.start, body.end);
    case 'diagnostics/repair': return diagnosticsManager.repair(body.issue);
    case 'diagnostics/repairAll': return diagnosticsManager.repairAll(body.projectId ? projectManager.get(body.projectId) : null);
    case 'integration/list': return integrationManager.list();
    case 'integration/save': return integrationManager.save(body.id, body.config, body.secrets);
    case 'integration/remove': return integrationManager.remove(body.id);
    case 'integration/test': return integrationManager.test(body.id);
    case 'integration/readiness': return integrationManager.readiness(body.category);
    case 'integration/assistant': return integrationManager.assistant(body.prompt, body.context || {});
    case 'command/start': return commandManager.start(body.projectId, body.name, body.execution, body.distribution);
    case 'command/stop': return commandManager.stop(body.id);
    case 'command/list': return commandManager.list(body.projectId);
    case 'command/get': return commandManager.get(body.id);
    case 'command/clear': return commandManager.clearFinished();
    case 'toolchain/list': return commandManager.toolchains();
    case 'toolchain/repair': return commandManager.repairTool(body.id, progress => broadcastSSE('download:progress', progress));
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
    case 'domain/apply': return projectManager.syncDomains({ elevate: false });
    case 'domain/certificateStatus': return domainManager.certificateStatus(body.domain);
    case 'domain/installCertificateAuthority': return domainManager.installCertificateAuthority();
    case 'domain/issueCertificate': return domainManager.issueCertificate(body.domain);
    case 'terminal/write': {
      const term = terminals.get(body.id);
      if (!term || term.sessionId !== context.sessionId) return { success: false, error: 'Terminal not found' };
      if (typeof body.data !== 'string' || Buffer.byteLength(body.data) > 65536) {
        return { success: false, error: 'Invalid terminal input' };
      }
      if (term.pty) term.process.write(body.data);
      else {
        if (!term.process.stdin.writable) return { success: false, error: 'Terminal input is closed' };
        term.process.stdin.write(body.data);
      }
      return { success: true };
    }
    case 'terminal/kill': {
      const term = terminals.get(body.id);
      if (!term || term.sessionId !== context.sessionId) return { success: false };
      try { term.process.kill(); } catch {}
      terminals.delete(body.id);
      return { success: true };
    }
    case 'terminal/resize': {
      const term = terminals.get(body.id); if (!term || term.sessionId !== context.sessionId) return { success: false };
      if (term.pty) try { term.process.resize(Math.max(2, Math.min(500, Number(body.cols) || 120)), Math.max(2, Math.min(200, Number(body.rows) || 32))); } catch {}
      return { success: true };
    }

    // Composer
    case 'composer/getStatus': {
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
    }
    case 'composer/install': {
      const config = configManager.getConfig();
      const phpProfile = configManager.getActiveProfile(config, 'php');
      if (!phpProfile) return { success: false, error: 'No active PHP profile' };
      const version = phpProfile.version;
      if (!downloadManager.isInstalled('php', version)) return { success: false, error: 'PHP not installed' };
      const composerProfile = configManager.getActiveProfile(config, 'composer');
      if (!composerProfile) return { success: false, error: 'No active Composer profile' };
      const result = await downloadManager.download('composer', composerProfile.version, progress => broadcastSSE('download:progress', progress));
      if (result.success) {
        const pathResult = pathManager.syncIfSelected('composer');
        if (!pathResult.success) result.pathWarning = pathResult.error;
      }
      return result;
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
      const composerProfile = configManager.getActiveProfile(config, 'composer');
      const managedPath = composerProfile && downloadManager.isInstalled('composer', composerProfile.version)
        ? downloadManager.getInstallPath('composer', composerProfile.version) : '';
      const composerPhar = managedPath ? path.join(managedPath, 'composer.phar') : path.join(phpPath, 'composer.phar');
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
          env: { ...pathManager.buildEnvironment(process.env), COMPOSER_HOME: path.join(managedPath || phpPath, 'composer-home') }
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
    case 'lab/recipes': return labManager.recipes();
    case 'lab/preview': return labManager.preview(body.input || {});
    case 'lab/list': return labManager.list();
    case 'lab/get': return labManager.get(body.id);
    case 'lab/create': return labManager.create(body.input || {}, body.secrets || {});
    case 'lab/update': return labManager.update(body.id, body.patch || {}, body.secrets || {});
    case 'lab/provision': return labManager.provision(body.id, progress => broadcastSSE('lab:progress', progress, context.sessionId));
    case 'lab/start': return labManager.start(body.id);
    case 'lab/stop': return labManager.stop(body.id);
    case 'lab/health': return labManager.health(body.id);
    case 'lab/remove': return labManager.remove(body.id, body.options || {});
    case 'apiFlow/catalog': return apiFlowManager.catalog();
    case 'apiFlow/list': return apiFlowManager.list();
    case 'apiFlow/get': return apiFlowManager.get(body.id);
    case 'apiFlow/validate': return apiFlowManager.validate(body.input || {});
    case 'apiFlow/save': return apiFlowManager.save(body.input || {});
    case 'apiFlow/remove': return apiFlowManager.remove(body.id);
    case 'apiFlow/start': return apiFlowManager.start(body.id);
    case 'apiFlow/stop': return apiFlowManager.stop(body.id);
    case 'apiFlow/status': return apiFlowManager.status(body.id);
    case 'apiFlow/test': return apiFlowManager.test(body.projectId, body.endpointId, body.request || {});
    case 'apiFlow/request': return apiFlowManager.request(body.projectId, body.endpointId, body.request || {});
    case 'apiFlow/logs': return apiFlowManager.logs(body.projectId, body.limit);
    case 'apiFlow/clearLogs': return apiFlowManager.clearLogs(body.projectId);
    case 'observability/overview': return observabilityManager.overview();
    case 'observability/collect': return observabilityManager.collect();
    case 'observability/history': return observabilityManager.history(body.options || {});
    case 'observability/alerts': return observabilityManager.alertsList();
    case 'observability/acknowledge': return observabilityManager.acknowledgeAlert(body.id);
    case 'observability/rules': return observabilityManager.rulesList();
    case 'observability/saveRule': return observabilityManager.saveRule(body.input || {});
    case 'observability/removeRule': return observabilityManager.removeRule(body.id);
    case 'observability/prometheus': return observabilityManager.prometheus();
    case 'automation/list': return automationManager.list();
    case 'automation/history': return automationManager.history(body.limit);
    case 'automation/save': return automationManager.save(body.input || {});
    case 'automation/remove': return automationManager.remove(body.id);
    case 'automation/run': return automationManager.run(body.id, { manual: true });
    case 'automation/runDue': return automationManager.runDue();
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

function shouldAuditEndpoint(endpoint) {
  return /(?:save|create|update|remove|delete|start|stop|restart|install|apply|reset|import|set|revoke|run|provision|acknowledge|clear|restore|download|execute|test|repair|issue|switch|rename|duplicate|drop|publish|sync|pair|rollback|approve|configure)/i.test(endpoint);
}

function auditTarget(body = {}) {
  const candidates = [
    body.id, body.projectId, body.service, body.section, body.name, body.instanceName,
    body.database, body.domain, body.appId, body.label, body.input?.id, body.input?.name,
    body.connection?.id, body.connection?.name
  ];
  return String(candidates.find(value => typeof value === 'string' && value.trim()) || '').slice(0, 200);
}

// ============ HTTP Server ============

function routeAuthentication(req, route) {
  if (route.authPolicy === 'public') return { allowed: true, authentication: null };
  const session = validateSession(getSessionIdFromReq(req));
  const token = hasValidApiToken(req);
  if (route.authPolicy === 'token') return { allowed: Boolean(token), authentication: token };
  return { allowed: Boolean(session || token), authentication: session || token };
}

function proxyHubRequest(req, res, route) {
  const target = new URL(route.target); const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': IS_HTTPS ? 'https' : 'http', 'x-kitsune-route': route.id };
  delete headers['proxy-authorization']; delete headers['proxy-connection'];
  const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers, timeout: 30_000 }, response => {
    const responseHeaders = { ...response.headers }; delete responseHeaders['transfer-encoding'];
    res.writeHead(response.statusCode || 502, responseHeaders); response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Gateway timeout')));
  upstream.on('error', error => { if (!res.headersSent) sendJSON(res, { error: `Hub gateway: ${error.message}` }, 502); else res.end(); });
  req.pipe(upstream);
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const clientAddress = normalizeIp(req.socket.remoteAddress || '');
  const hubRoute = hubManager.resolveRoute(req.headers.host || '');
  if (hubManager.settings().gatewayEnabled !== false && hubRoute) {
    const authorization = routeAuthentication(req, hubRoute);
    if (!authorization.allowed) { sendJSON(res, { error: 'Authentication is required for this Hub route' }, 401); return; }
    proxyHubRequest(req, res, hubRoute); return;
  }
  if (!isIpAllowed(clientAddress, ALLOWED_IPS)) {
    sendJSON(res, { error: 'Client address is not allowed' }, 403);
    return;
  }

  // Browser hardening headers. The UI is self-contained and never needs framing.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
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
    const totpOk = !TOTP_SECRET || verifyTotp(TOTP_SECRET, form.totp || '');
    const settings = hubManager.settings(); let authentication = { success: false }; let source = 'server-auth';
    if (totpOk && settings.authMode !== 'independent') {
      authentication = await hubManager.authenticateWithPlesk(inputUser, inputPass, form.totp || '', { address: clientAddress, userAgent: req.headers['user-agent'] || '' });
      if (authentication.success) source = 'plesk-password-auth';
    }
    const localModeEnabled = settings.authMode === 'independent' || settings.authMode === 'hybrid' || process.env.KITSUNE_ALLOW_LOCAL_LOGIN === '1';
    const safeLocalFallback = settings.authMode === 'independent' || (!authentication.accountExists && (!authentication.unavailable || hubManager.allowsLocalPassword(inputUser)));
    if (totpOk && !authentication.success && localModeEnabled && safeLocalFallback) authentication = identityManager.authenticate(inputUser, inputPass, form.totp || '');
    if (authentication.success && totpOk) {
      loginAttempts.delete(getClientKey(req));
      const session = authentication.token ? authentication : createSession(authentication.user.id, req);
      auditManager.record({ actor: authentication.user.username, source, action: 'session.login', target: clientAddress, success: true });
      res.writeHead(302, {
        'Set-Cookie': `kitsune_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}${IS_HTTPS ? '; Secure' : ''}`,
        'Location': '/'
      });
      res.end();
    } else {
      recordFailedLogin(req);
      auditManager.record({ actor: inputUser || 'unknown', source, action: 'session.login', target: clientAddress, success: false });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage('Invalid username, password or authenticator code'));
    }
    return;
  }

  // Short-lived, signed Plesk SSO hand-off. The Plesk password never leaves Plesk.
  if (pathname === '/auth/plesk' && req.method === 'POST') {
    try {
      const form = await parseFormBody(req);
      const login = hubManager.loginWithPlesk(form.assertion || '', form.signature || '', { address: clientAddress, userAgent: req.headers['user-agent'] || '' });
      auditManager.record({ actor: login.user.username, source: 'plesk-auth', action: 'session.login', target: clientAddress, success: true });
      res.writeHead(302, { 'Set-Cookie': `kitsune_session=${login.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE / 1000}${IS_HTTPS ? '; Secure' : ''}`, 'Location': '/' });
      res.end();
    } catch (error) {
      auditManager.record({ actor: 'plesk-user', source: 'plesk-auth', action: 'session.login', target: clientAddress, success: false, details: { error: error.message } });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(getLoginPage(error.message));
    }
    return;
  }

  if (pathname === '/auth/pair' && req.method === 'POST') {
    try { const body = await parseBody(req); sendJSON(res, hubManager.completePairing(body.code, body.device || {})); }
    catch (error) { sendJSON(res, { error: error.message }, 400); }
    return;
  }

  // ---- Logout ----
  if (pathname === '/auth/logout') {
    const token = getSessionIdFromReq(req);
    const authenticated = validateSession(token);
    if (authenticated) {
      const actor = authenticated.user.username;
      identityManager.revokeSession(authenticated.sessionId);
      terminateSessionResources(authenticated.sessionId);
      auditManager.record({ actor, source: 'server-auth', action: 'session.logout', target: clientAddress, success: true });
    }
    res.writeHead(302, {
      'Set-Cookie': 'kitsune_session=; Path=/; HttpOnly; Max-Age=0',
      'Location': '/'
    });
    res.end();
    return;
  }

  if (pathname === '/manifest.webmanifest') {
    const manifestPath = path.join(__dirname, 'renderer', 'manifest.webmanifest');
    try {
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': MIME_TYPES['.webmanifest'],
        'Content-Length': Buffer.byteLength(manifest),
        'Cache-Control': 'no-cache'
      });
      res.end(manifest);
    } catch {
      sendJSON(res, {
        name: 'KitsuneServ Operations',
        short_name: 'KitsuneServ',
        description: 'Offline-capable server operations and approval console',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0f0f1a',
        theme_color: '#0f0f1a',
        categories: ['developer', 'utilities', 'productivity']
      });
    }
    return;
  }

  // ---- Auth check for everything else ----
  const sessionToken = getSessionIdFromReq(req);
  const sessionAuthentication = validateSession(sessionToken);
  const apiAuthentication = pathname.startsWith('/api/') ? hasValidApiToken(req) : null;
  const authentication = apiAuthentication || sessionAuthentication;
  if (!authentication) {
    // Unauthenticated
    if (pathname.startsWith('/api/')) {
      sendJSON(res, { error: 'Unauthorized' }, 401);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getLoginPage());
    }
    return;
  }
  const sessionId = sessionAuthentication?.sessionId || '';
  const apiTokenAuthenticated = Boolean(apiAuthentication);

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

  if (pathname === '/api/metrics' && req.method === 'GET') {
    const content = observabilityManager.prometheus();
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Content-Length': Buffer.byteLength(content), 'Cache-Control': 'no-store' });
    res.end(content);
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
    const started = Date.now();
    let body = {};
    try {
      body = await parseBody(req);
      const result = await handleAPI(endpoint, body, { sessionId, apiTokenAuthenticated, clientAddress, user: authentication.user, principal: authentication.principal });
      if (shouldAuditEndpoint(endpoint)) auditManager.record({
        actor: authentication.user?.username || (apiTokenAuthenticated ? 'api-token' : 'web-user'),
        source: 'server-api', action: endpoint.replaceAll('/', '.'), target: auditTarget(body),
        success: result?.success !== false, durationMs: Date.now() - started
      });
      if (shouldAuditEndpoint(endpoint) && endpoint !== 'nextgen/blackBoxRecord') nextgenOpsManager.blackBoxRecord({ kind: 'server-operation', action: endpoint, target: auditTarget(body), actor: authentication.user?.username || 'api-token', success: result?.success !== false, durationMs: Date.now() - started });
      sendJSON(res, result);
    } catch (err) {
      if (shouldAuditEndpoint(endpoint)) auditManager.record({
        actor: authentication.user?.username || (apiTokenAuthenticated ? 'api-token' : 'web-user'),
        source: 'server-api', action: endpoint.replaceAll('/', '.'), target: auditTarget(body),
        success: false, durationMs: Date.now() - started, details: { error: err.message }
      });
      if (shouldAuditEndpoint(endpoint) && endpoint !== 'nextgen/blackBoxRecord') nextgenOpsManager.blackBoxRecord({ kind: 'server-operation', action: endpoint, target: auditTarget(body), actor: authentication.user?.username || 'api-token', success: false, durationMs: Date.now() - started });
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

  const terminalVendorAssets = {
    '/node_modules/@xterm/xterm/css/xterm.css': [path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'), 'text/css; charset=utf-8'],
    '/node_modules/@xterm/xterm/lib/xterm.js': [path.join(__dirname, '..', 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'), 'application/javascript; charset=utf-8'],
    '/node_modules/@xterm/addon-fit/lib/addon-fit.js': [path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js'), 'application/javascript; charset=utf-8'],
    '/node_modules/@xterm/addon-search/lib/addon-search.js': [path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-search', 'lib', 'addon-search.js'), 'application/javascript; charset=utf-8'],
    '/node_modules/@xterm/addon-image/lib/addon-image.js': [path.join(__dirname, '..', 'node_modules', '@xterm', 'addon-image', 'lib', 'addon-image.js'), 'application/javascript; charset=utf-8']
  };
  if (terminalVendorAssets[pathname]) {
    const [vendorPath, type] = terminalVendorAssets[pathname]; sendFile(res, vendorPath, type); return;
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

server.on('upgrade', (req, socket, head) => {
  const route = hubManager.resolveRoute(req.headers.host || '');
  if (!route || route.websocket === false || !routeAuthentication(req, route).allowed) { socket.destroy(); return; }
  const target = new URL(route.target); const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: 'GET', path: req.url, headers: { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host || '', 'x-forwarded-proto': IS_HTTPS ? 'https' : 'http' } });
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}\r\n`);
    for (const [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
    socket.write('\r\n'); if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on('error', () => socket.destroy()); upstream.end();
});

// ============ Graceful shutdown ============
let shutdownInProgress = false;
async function shutdown(exitCode = 0) {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  console.log('\n[KitsuneServ] Shutting down...');
  commandManager.stopAll();
  tunnelManager.stopAll();
  labManager.stopAll();
  await apiFlowManager.stopAll();
  observabilityManager.stop();
  try { await projectManager.stopAll(); } catch (err) { console.warn('[KitsuneServ] Project shutdown warning:', err.message); }
  try { await serviceManager.stopAll(); } catch (err) { console.warn('[KitsuneServ] Service shutdown warning:', err.message); }
  try { projectManager.markCleanShutdown(); } catch {}
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
