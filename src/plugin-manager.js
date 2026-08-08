'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isPathInside } = require('./path-utils');

class PluginManager {
  constructor(appRoot) {
    this.appRoot = path.resolve(appRoot);
    this.pluginRoot = path.join(this.appRoot, 'plugins');
    this.statePath = path.join(this.appRoot, 'config', 'plugins.json');
    fs.mkdirSync(this.pluginRoot, { recursive: true });
  }

  _state() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      return parsed && typeof parsed.plugins === 'object' ? parsed : { schemaVersion: 1, plugins: {} };
    } catch { return { schemaVersion: 1, plugins: {} }; }
  }

  _saveState(state) {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temp = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.statePath); }
    catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temp, this.statePath); fs.unlinkSync(temp); }
  }

  _validate(manifest) {
    if (!manifest || manifest.schemaVersion !== 1) throw new Error('Unsupported plugin manifest');
    if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(manifest.id)) throw new Error('Invalid plugin id');
    if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 100) throw new Error('Invalid plugin name');
    if (typeof manifest.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid plugin version');
    const platforms = Array.isArray(manifest.platforms) ? manifest.platforms.filter(item => ['win32', 'linux', 'darwin'].includes(item)) : ['win32', 'linux'];
    const contributes = manifest.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {};
    const projectTemplates = Array.isArray(contributes.projectTemplates) ? contributes.projectTemplates.map(template => {
      if (!template || typeof template.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(template.id)) throw new Error('Invalid contributed project template');
      return {
        id: `${manifest.id}:${template.id}`,
        name: String(template.name || template.id).slice(0, 100),
        description: String(template.description || '').slice(0, 500),
        services: Array.isArray(template.services) ? template.services : [],
        runtime: typeof template.runtime === 'string' ? template.runtime : null,
        publicDir: typeof template.publicDir === 'string' ? template.publicDir : '.',
        commands: template.commands && typeof template.commands === 'object' ? template.commands : {}
      };
    }) : [];
    const tools = Array.isArray(contributes.tools) ? contributes.tools.map(tool => ({
      id: `${manifest.id}:${String(tool.id || '').slice(0, 60)}`,
      name: String(tool.name || tool.id || '').slice(0, 100),
      command: String(tool.command || '').slice(0, 200),
      versionArgs: Array.isArray(tool.versionArgs) ? tool.versionArgs.map(String).slice(0, 10) : ['--version']
    })).filter(tool => tool.name && tool.command) : [];
    return { ...manifest, name: manifest.name.trim(), platforms, contributes: { projectTemplates, tools } };
  }

  _manifest(directory) {
    const file = path.join(directory, 'kitsune-plugin.json');
    if (!fs.existsSync(file)) throw new Error('kitsune-plugin.json was not found');
    const serialized = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error('Plugin manifest is too large');
    return { manifest: this._validate(JSON.parse(serialized)), serialized };
  }

  _digestDirectory(directory) {
    const hash = crypto.createHash('sha256');
    const visit = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Plugin packages cannot contain symbolic links');
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) {
          const stat = fs.statSync(full);
          if (stat.size > 10 * 1024 * 1024) throw new Error(`Plugin file is too large: ${entry.name}`);
          hash.update(path.relative(directory, full).replace(/\\/g, '/')); hash.update(fs.readFileSync(full));
        }
      }
    };
    visit(directory);
    return hash.digest('hex');
  }

  install(sourceDirectory) {
    const source = path.resolve(String(sourceDirectory || ''));
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) return { success: false, error: 'Plugin directory does not exist' };
    let target = ''; let staging = ''; let previous = '';
    try {
      const { manifest } = this._manifest(source);
      if (!manifest.platforms.includes(process.platform)) return { success: false, error: `Plugin does not support ${process.platform}` };
      const digest = this._digestDirectory(source);
      target = path.join(this.pluginRoot, manifest.id);
      if (!isPathInside(this.pluginRoot, target)) throw new Error('Unsafe plugin id');
      staging = `${target}.${process.pid}.installing`;
      previous = `${target}.${process.pid}.previous`;
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
      fs.cpSync(source, staging, { recursive: true, errorOnExist: false });
      if (fs.existsSync(target)) fs.renameSync(target, previous);
      fs.renameSync(staging, target);
      const state = this._state();
      state.plugins[manifest.id] = { enabled: true, version: manifest.version, digest, installedAt: new Date().toISOString() };
      this._saveState(state);
      if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true, force: true });
      return { success: true, plugin: this.get(manifest.id) };
    } catch (error) {
      try {
        if (target && fs.existsSync(target) && previous && fs.existsSync(previous)) fs.rmSync(target, { recursive: true, force: true });
        if (target && previous && fs.existsSync(previous) && !fs.existsSync(target)) fs.renameSync(previous, target);
        if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      } catch {}
      return { success: false, error: error.message };
    }
  }

  get(id) {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(id)) return null;
    const directory = path.join(this.pluginRoot, id);
    if (!fs.existsSync(directory)) return null;
    try {
      const { manifest } = this._manifest(directory);
      const state = this._state().plugins[id] || {};
      const actualDigest = this._digestDirectory(directory);
      return { ...manifest, directory, enabled: state.enabled !== false, integrity: state.digest === actualDigest, digest: actualDigest, installedAt: state.installedAt || null };
    } catch (error) { return { id, directory, enabled: false, integrity: false, error: error.message }; }
  }

  list() {
    return fs.readdirSync(this.pluginRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => this.get(entry.name)).filter(Boolean);
  }

  setEnabled(id, enabled) {
    if (!this.get(id)) return { success: false, error: 'Plugin not found' };
    const state = this._state(); state.plugins[id] = { ...(state.plugins[id] || {}), enabled: Boolean(enabled) }; this._saveState(state);
    return { success: true, plugin: this.get(id), restartRequired: true };
  }

  remove(id) {
    const plugin = this.get(id);
    if (!plugin) return { success: false, error: 'Plugin not found' };
    const target = path.join(this.pluginRoot, id);
    if (!isPathInside(this.pluginRoot, target) || target === this.pluginRoot) return { success: false, error: 'Unsafe plugin path' };
    fs.rmSync(target, { recursive: true, force: false });
    const state = this._state(); delete state.plugins[id]; this._saveState(state);
    return { success: true, restartRequired: true };
  }

  projectTemplates() {
    return this.list().filter(plugin => plugin.enabled && plugin.integrity).flatMap(plugin => plugin.contributes?.projectTemplates || []);
  }

  tools() {
    return this.list().filter(plugin => plugin.enabled && plugin.integrity).flatMap(plugin => plugin.contributes?.tools || []);
  }
}

module.exports = PluginManager;
