'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MANAGED_IDS, isPathInside } = require('./path-utils');

const SECRET_PATTERN = /(pass(word)?|secret|token|private[_-]?key|api[_-]?key|database_url)/i;

class EnvironmentManager {
  constructor(appRoot, configManager, downloadManager, projectManager, pathManager, serviceManager) {
    this.appRoot = path.resolve(appRoot);
    this.configManager = configManager;
    this.downloadManager = downloadManager;
    this.projectManager = projectManager;
    this.pathManager = pathManager;
    this.serviceManager = serviceManager;
    this.snapshotRoot = path.join(this.appRoot, 'backups', 'environments');
    fs.mkdirSync(this.snapshotRoot, { recursive: true });
  }

  _sanitizeConfig(config) {
    const clean = structuredClone(config);
    for (const service of MANAGED_IDS) {
      for (const profile of clean[service]?.profiles || []) {
        for (const key of Object.keys(profile)) if (SECRET_PATTERN.test(key)) delete profile[key];
        if (Array.isArray(profile.envVars)) profile.envVars = profile.envVars.map(item => SECRET_PATTERN.test(item?.key || '') ? { ...item, value: '' } : item);
      }
    }
    return clean;
  }

  _sanitizeProject(project) {
    const clean = structuredClone(project);
    delete clean.state; delete clean.exists; delete clean.documentRoot;
    for (const key of Object.keys(clean.env || {})) if (SECRET_PATTERN.test(key)) clean.env[key] = '';
    return clean;
  }

  _payload(label = '') {
    const config = this._sanitizeConfig(this.configManager.getConfig());
    const installed = {};
    for (const service of MANAGED_IDS) installed[service] = this.downloadManager.getInstalledVersions(service);
    return {
      schemaVersion: 1,
      kind: 'KitsuneServEnvironment',
      appVersion: require('../package.json').version,
      platform: process.platform,
      arch: process.arch,
      createdAt: new Date().toISOString(),
      label: String(label || '').slice(0, 100),
      config,
      projects: this.projectManager.list().map(project => this._sanitizeProject(project)),
      pathServices: this.pathManager.getSelectedServices(),
      installed
    };
  }

  export(label = '') {
    return this._payload(label);
  }

  inspect(payload) {
    if (!payload || payload.kind !== 'KitsuneServEnvironment' || payload.schemaVersion !== 1 || !payload.config || !Array.isArray(payload.projects)) throw new Error('Unsupported KitsuneServ environment file');
    const currentProjects = this.projectManager.list();
    const required = [];
    for (const [service, versions] of Object.entries(payload.installed || {})) {
      for (const version of versions || []) if (MANAGED_IDS.includes(service) && !this.downloadManager.isInstalled(service, version)) required.push({ service, version });
    }
    return {
      valid: true,
      createdAt: payload.createdAt,
      label: payload.label || '',
      projects: payload.projects.length,
      newProjects: payload.projects.filter(project => !currentProjects.some(current => current.slug === project.slug)).map(project => project.name),
      updatedProjects: payload.projects.filter(project => currentProjects.some(current => current.slug === project.slug)).map(project => project.name),
      missingVersions: required,
      pathServices: (payload.pathServices || []).filter(service => MANAGED_IDS.includes(service))
    };
  }

  _mergeSecretFields(next, current) {
    const result = structuredClone(next);
    for (const service of MANAGED_IDS) {
      for (const profile of result[service]?.profiles || []) {
        const currentProfile = current[service]?.profiles?.find(item => item.id === profile.id)
          || current[service]?.profiles?.find(item => item.version === profile.version);
        if (!currentProfile) continue;
        for (const [key, value] of Object.entries(currentProfile)) if (SECRET_PATTERN.test(key) && !Object.hasOwn(profile, key)) profile[key] = value;
      }
    }
    return result;
  }

  async apply(payload, options = {}) {
    const inspection = this.inspect(payload);
    const running = Object.entries(this.serviceManager.getAllStatuses()).filter(([, status]) => status.running).map(([service]) => service);
    if (running.length && options.stopServices !== true) return { success: false, error: `Stop running services before importing an environment: ${running.join(', ')}`, needsStop: true };
    if (running.length) await this.serviceManager.stopAll();
    const current = this.configManager.getConfig();
    const registryPath = this.projectManager.registryPath;
    let previousRegistry = null;
    try { previousRegistry = fs.readFileSync(registryPath); } catch {}
    const merged = this._mergeSecretFields(payload.config, current);
    try {
      const saved = this.configManager.saveConfig(merged);
      if (!saved.success) throw new Error(saved.error || 'Could not save imported configuration');
      const existing = this.projectManager.list();
      for (const project of payload.projects) {
        const match = existing.find(item => item.slug === project.slug);
        const requestedRoot = options.relocateRoot ? path.join(path.resolve(options.relocateRoot), project.slug) : project.root;
        const safeNewRoot = options.trustExternalRoots || isPathInside(this.projectManager.workspaceRoot, path.resolve(requestedRoot || ''))
          ? requestedRoot
          : path.join(this.projectManager.workspaceRoot, project.slug);
        if (match) this.projectManager.update(match.id, { ...project, id: match.id, root: options.relocateRoot ? requestedRoot : match.root });
        else this.projectManager.create({ ...project, id: undefined, root: safeNewRoot, createDirectory: true });
      }
      const selected = inspection.pathServices;
      const pathResult = this.pathManager.apply(selected);
      return { success: true, inspection, pathResult, pathWarning: pathResult.success === false ? pathResult.error : '', config: this.configManager.getConfig(), projects: this.projectManager.list() };
    } catch (error) {
      this.configManager.saveConfig(current);
      try {
        if (previousRegistry) fs.writeFileSync(registryPath, previousRegistry, { mode: 0o600 });
        else if (fs.existsSync(registryPath)) fs.unlinkSync(registryPath);
      } catch {}
      return { success: false, error: `${error.message}. Previous configuration and project registry were restored.`, rolledBack: true };
    }
  }

  createSnapshot(label = '') {
    const payload = this._payload(label);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const file = path.join(this.snapshotRoot, `${id}.json`);
    const serialized = JSON.stringify(payload, null, 2);
    fs.writeFileSync(file, serialized, { encoding: 'utf8', mode: 0o600 });
    const checksum = crypto.createHash('sha256').update(serialized).digest('hex');
    fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`, 'utf8');
    return { success: true, snapshot: { id, file, checksum, ...this.inspect(payload), size: Buffer.byteLength(serialized) } };
  }

  listSnapshots() {
    if (!fs.existsSync(this.snapshotRoot)) return [];
    return fs.readdirSync(this.snapshotRoot).filter(file => file.endsWith('.json')).map(file => {
      const fullPath = path.join(this.snapshotRoot, file);
      try {
        const serialized = fs.readFileSync(fullPath, 'utf8');
        const payload = JSON.parse(serialized);
        const expected = fs.readFileSync(`${fullPath}.sha256`, 'utf8').trim().split(/\s+/)[0];
        const actual = crypto.createHash('sha256').update(serialized).digest('hex');
        return { id: file.slice(0, -5), file: fullPath, size: Buffer.byteLength(serialized), valid: expected === actual, createdAt: payload.createdAt, label: payload.label || '', projects: payload.projects?.length || 0 };
      } catch (error) { return { id: file.slice(0, -5), file: fullPath, valid: false, error: error.message }; }
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async restoreSnapshot(id, options = {}) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{10,100}$/.test(id)) return { success: false, error: 'Invalid snapshot id' };
    const file = path.join(this.snapshotRoot, `${id}.json`);
    if (!isPathInside(this.snapshotRoot, file) || !fs.existsSync(file)) return { success: false, error: 'Snapshot not found' };
    const record = this.listSnapshots().find(item => item.id === id);
    if (!record?.valid) return { success: false, error: 'Snapshot integrity verification failed' };
    return this.apply(JSON.parse(fs.readFileSync(file, 'utf8')), options);
  }

  removeSnapshot(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{10,100}$/.test(id)) return { success: false, error: 'Invalid snapshot id' };
    const file = path.join(this.snapshotRoot, `${id}.json`);
    if (!isPathInside(this.snapshotRoot, file) || !fs.existsSync(file)) return { success: false, error: 'Snapshot not found' };
    fs.unlinkSync(file); try { fs.unlinkSync(`${file}.sha256`); } catch {}
    return { success: true };
  }
}

module.exports = EnvironmentManager;
