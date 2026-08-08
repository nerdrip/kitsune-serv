'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { MANAGED_IDS } = require('./path-utils');

const SECRET_KEY = /(pass(word)?|secret|token|private.?key|api.?key|database.?url|authorization|cookie)/i;

function sanitize(value, context = {}) {
  const pathVariants = (value, placeholder) => {
    if (!value) return [];
    const raw = String(value);
    const resolved = path.resolve(raw);
    return [...new Set([raw, resolved, raw.replace(/\\/g, '/'), resolved.replace(/\\/g, '/')])]
      .filter(Boolean).sort((a, b) => b.length - a.length).map(candidate => ({ candidate, placeholder }));
  };
  const privatePaths = [...pathVariants(context.appRoot, '<DATA_ROOT>'), ...pathVariants(context.home, '<HOME>')];
  const visit = (item, key = '') => {
    if (SECRET_KEY.test(key)) return '[REDACTED]';
    if (Array.isArray(item)) return item.slice(0, 500).map(entry => visit(entry, key));
    if (item && typeof item === 'object') {
      const result = {};
      for (const [childKey, childValue] of Object.entries(item)) result[childKey] = visit(childValue, childKey);
      return result;
    }
    if (typeof item !== 'string') return item;
    let text = item.replace(/(password|secret|token|api[_-]?key)\s*[=:]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
    for (const { candidate, placeholder } of privatePaths) {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(escaped, 'gi'), placeholder);
    }
    return text.slice(0, 200000);
  };
  return visit(value);
}

class SupportManager {
  constructor(appRoot, managers = {}) {
    this.appRoot = path.resolve(appRoot);
    this.managers = managers;
    this.reportRoot = path.join(this.appRoot, 'reports');
  }

  async generate() {
    const { configManager, downloadManager, serviceManager, diagnosticsManager, projectManager, activityManager, environmentManager, pluginManager, platformManager } = this.managers;
    const environment = environmentManager ? environmentManager.export('support report') : { config: configManager?.getConfig?.(), projects: projectManager?.list?.() || [] };
    const doctor = diagnosticsManager ? await diagnosticsManager.doctor() : null;
    const statuses = serviceManager?.getAllStatuses?.() || {};
    const services = {};
    for (const service of MANAGED_IDS) {
      const installed = downloadManager?.getInstalledVersions?.(service) || [];
      const logs = serviceManager?.getLogs?.(service, 80) || [];
      if (installed.length || statuses[service]?.running || logs.length) services[service] = { installed, status: statuses[service] || {}, logs };
    }
    const report = sanitize({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      application: { name: 'KitsuneServ', version: require('../package.json').version },
      system: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, cpus: os.cpus().length, memoryBytes: os.totalmem() },
      environment,
      diagnostics: doctor,
      services,
      recentActivities: activityManager?.list?.({ limit: 100 }) || [],
      plugins: pluginManager?.list?.() || [],
      platformIntegration: platformManager?.inventory?.() || null
    }, { appRoot: this.appRoot, home: os.homedir() });
    const serialized = JSON.stringify(report, null, 2);
    const sha256 = crypto.createHash('sha256').update(serialized).digest('hex');
    fs.mkdirSync(this.reportRoot, { recursive: true });
    const id = `support-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const reportPath = path.join(this.reportRoot, `${id}.json`);
    const temp = `${reportPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, serialized, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, reportPath);
    fs.writeFileSync(`${reportPath}.sha256`, `${sha256}  ${path.basename(reportPath)}\n`, { encoding: 'utf8', mode: 0o600 });
    return { success: true, id, path: reportPath, sha256, report };
  }
}

module.exports = SupportManager;
module.exports.sanitize = sanitize;
