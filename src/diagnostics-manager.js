'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { SERVICE_IDS } = require('./path-utils');

const PORT_FIELDS = Object.freeze(['port', 'sslPort', 'httpPort', 'consolePort', 'inspectPort']);
const WEB_SERVICES = Object.freeze(['apache', 'nginx', 'caddy']);

class DiagnosticsManager {
  constructor(appRoot, configManager, downloadManager, serviceManager, pathManager) {
    this.appRoot = path.resolve(appRoot);
    this.configManager = configManager;
    this.downloadManager = downloadManager;
    this.serviceManager = serviceManager;
    this.pathManager = pathManager;
  }

  async _isPortAvailable(port) {
    return new Promise(resolve => {
      const server = net.createServer();
      server.unref();
      server.once('error', () => resolve(false));
      server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
    });
  }

  async ports() {
    const config = this.configManager.getConfig();
    const rows = [];
    for (const service of SERVICE_IDS) {
      const profile = this.configManager.getActiveProfile(config, service);
      if (!profile) continue;
      for (const field of PORT_FIELDS) {
        const port = Number(profile[field]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
        const running = this.serviceManager.getServiceStatus(service).running;
        rows.push({ service, field, port, running, available: running ? false : await this._isPortAvailable(port) });
      }
    }
    const counts = new Map();
    for (const row of rows) counts.set(row.port, (counts.get(row.port) || 0) + 1);
    return rows.map(row => ({ ...row, conflict: (counts.get(row.port) || 0) > 1 }));
  }

  async findFreePort(start = 3000, end = 65535) {
    const first = Math.max(1024, Number(start) || 3000);
    const last = Math.min(65535, Math.max(first, Number(end) || 65535));
    for (let port = first; port <= Math.min(last, first + 1000); port += 1) {
      if (await this._isPortAvailable(port)) return { success: true, port };
    }
    return { success: false, error: 'No free port found in the selected range' };
  }

  compatibility(project = null) {
    const config = this.configManager.getConfig();
    const issues = [];
    const services = project?.services || SERVICE_IDS;
    const add = (severity, code, message, details = {}) => issues.push({ severity, code, message, ...details });
    for (const service of services) {
      if (!SERVICE_IDS.includes(service)) continue;
      const profile = this.configManager.getActiveProfile(config, service);
      if (!profile) {
        add('error', 'missing-profile', `No active ${service} profile`, { service });
        continue;
      }
      const requiredVersion = project?.runtimeVersions?.[service] || profile.version;
      if (!this.downloadManager.isInstalled(service, requiredVersion)) {
        add('error', 'missing-version', `${service} ${requiredVersion} is not installed`, { service, version: requiredVersion, repair: 'install-version' });
      }
    }
    const web = services.find(service => WEB_SERVICES.includes(service));
    if (web && services.includes('php')) {
      const webProfile = this.configManager.getActiveProfile(config, web);
      const phpProfile = this.configManager.getActiveProfile(config, 'php');
      if (!webProfile?.phpEnabled && web !== 'apache') add('warning', 'php-disabled', `${web} does not have PHP integration enabled`, { service: web });
      if (web === 'apache' && webProfile && !webProfile.modProxyFcgi && !webProfile.modPhp) add('warning', 'php-handler-disabled', 'Apache has no PHP handler enabled', { service: web });
      if (phpProfile && (!Number.isInteger(Number(phpProfile.port)) || Number(phpProfile.port) < 1)) add('error', 'invalid-php-port', 'PHP FastCGI port is invalid', { service: 'php' });
    }
    if (services.includes('php')) {
      const php = this.configManager.getActiveProfile(config, 'php');
      const enabled = new Set((php?.extensions || []).filter(item => item.enabled).map(item => item.name));
      if ((services.includes('mysql') || services.includes('mariadb')) && !enabled.has('pdo_mysql') && !enabled.has('mysqli')) add('warning', 'missing-php-mysql-driver', 'PHP has no enabled MySQL driver', { service: 'php' });
      if (services.includes('postgresql') && !enabled.has('pdo_pgsql') && !enabled.has('pgsql')) add('warning', 'missing-php-pgsql-driver', 'PHP has no enabled PostgreSQL driver', { service: 'php' });
    }
    return { compatible: !issues.some(issue => issue.severity === 'error'), issues };
  }

  async doctor(project = null) {
    const issues = [];
    const add = (severity, code, message, details = {}) => issues.push({ id: `${code}:${issues.length}`, severity, code, message, ...details });
    const config = this.configManager.getConfig();
    if (!fs.existsSync(this.appRoot)) add('error', 'missing-data-root', 'KitsuneServ data directory does not exist', { path: this.appRoot });
    const roots = [];
    if (config.general?.globalDocumentRoot) roots.push({ service: 'global', root: path.resolve(config.general.globalDocumentRoot) });
    for (const service of WEB_SERVICES) {
      const profile = this.configManager.getActiveProfile(config, service);
      if (profile?.documentRoot) roots.push({ service, root: path.resolve(profile.documentRoot) });
    }
    for (const item of roots) {
      if (!fs.existsSync(item.root)) add('warning', 'missing-directory', `${item.service} document root does not exist`, { service: item.service, path: item.root, repair: 'create-directory' });
    }
    const portRows = await this.ports();
    for (const row of portRows.filter(item => item.conflict)) add('error', 'duplicate-port', `Port ${row.port} is assigned more than once`, row);
    for (const row of portRows.filter(item => !item.running && !item.available && !item.conflict)) add('warning', 'external-port-conflict', `Port ${row.port} is occupied by another process`, row);
    const compatibility = this.compatibility(project);
    for (const issue of compatibility.issues) add(issue.severity, issue.code, issue.message, issue);
    let pathStatus = null;
    try {
      pathStatus = this.pathManager?.getStatus() || null;
      for (const selected of pathStatus?.selected || []) {
        const row = pathStatus.services?.find?.(item => item.service === selected);
        if (row && !row.installed) add('warning', 'stale-path-selection', `${selected} is selected for PATH but is not installed`, { service: selected, repair: 'sync-path' });
      }
    } catch (error) {
      add('warning', 'path-inspection-failed', `PATH inspection failed: ${error.message}`);
    }
    if (project) {
      if (!fs.existsSync(project.root)) add('error', 'missing-project-root', 'Project directory does not exist', { path: project.root });
      const publicRoot = path.resolve(project.root, project.publicDir || '.');
      if (!fs.existsSync(publicRoot)) add('warning', 'missing-project-public-root', 'Project public directory does not exist', { path: publicRoot, repair: 'create-directory' });
    }
    const counts = { error: 0, warning: 0, info: 0 };
    for (const issue of issues) counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return {
      healthy: counts.error === 0,
      generatedAt: new Date().toISOString(),
      system: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, appRoot: this.appRoot },
      counts,
      issues,
      ports: portRows,
      path: pathStatus
    };
  }

  repair(issue) {
    if (!issue || typeof issue !== 'object') return { success: false, error: 'Invalid diagnostic issue' };
    if (['missing-directory', 'missing-project-public-root'].includes(issue.code) && typeof issue.path === 'string') {
      const resolved = path.resolve(issue.path);
      fs.mkdirSync(resolved, { recursive: true });
      return { success: true, message: `Created ${resolved}` };
    }
    if (issue.code === 'stale-path-selection' || issue.code === 'sync-path') {
      if (!this.pathManager) return { success: false, error: 'PATH manager is not available' };
      return this.pathManager.sync(this.pathManager.getSelectedServices());
    }
    return { success: false, error: 'This issue requires a manual decision' };
  }
}

module.exports = DiagnosticsManager;
