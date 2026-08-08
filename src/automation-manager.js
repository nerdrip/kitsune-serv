'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function write(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temporary, file); } catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temporary, file); fs.unlinkSync(temporary); }
}

class AutomationManager {
  constructor(appRoot, dependencies = {}) {
    this.storePath = path.join(path.resolve(appRoot), 'config', 'automations.json');
    this.dependencies = dependencies;
    this.running = new Set();
    this.onChanged = null;
  }

  _read() { try { const value = JSON.parse(fs.readFileSync(this.storePath, 'utf8')); return { automations: Array.isArray(value.automations) ? value.automations : [], history: Array.isArray(value.history) ? value.history : [] }; } catch { return { automations: [], history: [] }; } }
  _write(value) { write(this.storePath, { schemaVersion: 1, updatedAt: new Date().toISOString(), automations: value.automations, history: value.history.slice(-500) }); }
  list() { return structuredClone(this._read().automations.map(item => ({ ...item, running: this.running.has(item.id) }))); }
  history(limit = 100) { return structuredClone(this._read().history.slice(-Math.max(1, Math.min(500, Number(limit) || 100))).reverse()); }

  save(input = {}) {
    const actions = ['service-start', 'service-stop', 'service-restart', 'project-start', 'project-stop', 'project-command', 'lab-start', 'lab-stop', 'lab-provision', 'backup-run-due', 'doctor'];
    if (!actions.includes(input.action)) throw new Error('Unsupported automation action');
    const intervalMinutes = Math.max(1, Math.min(525600, Number(input.intervalMinutes) || 60));
    const now = Date.now();
    const item = {
      id: typeof input.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(input.id) ? input.id : crypto.randomUUID(),
      name: String(input.name || input.action).trim().slice(0, 120),
      action: input.action, target: String(input.target || '').slice(0, 100),
      commandName: String(input.commandName || '').slice(0, 50),
      enabled: input.enabled !== false, intervalMinutes,
      nextRunAt: input.nextRunAt && !Number.isNaN(Date.parse(input.nextRunAt)) ? input.nextRunAt : new Date(now + intervalMinutes * 60000).toISOString(),
      lastRunAt: input.lastRunAt || null, lastSuccessAt: input.lastSuccessAt || null,
      lastError: String(input.lastError || '').slice(0, 500),
      createdAt: input.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    if (!item.name) throw new Error('Automation name is required');
    if (!['backup-run-due', 'doctor'].includes(item.action) && !item.target) throw new Error('Automation target is required');
    if (item.action === 'project-command' && !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(item.commandName)) throw new Error('Named project command is required');
    const value = this._read(); const index = value.automations.findIndex(entry => entry.id === item.id);
    if (index >= 0) value.automations[index] = item; else value.automations.push(item);
    this._write(value); this._emit(); return structuredClone(item);
  }

  remove(id) { const value = this._read(); const before = value.automations.length; value.automations = value.automations.filter(item => item.id !== id); this._write(value); this._emit(); return { success: true, removed: before !== value.automations.length }; }
  _emit() { try { this.onChanged?.(this.list()); } catch {} }

  async _execute(item) {
    const d = this.dependencies;
    switch (item.action) {
      case 'service-start': return d.serviceManager.startService(item.target);
      case 'service-stop': return d.serviceManager.stopService(item.target);
      case 'service-restart': { const stopped = await d.serviceManager.stopService(item.target); return stopped?.success === false ? stopped : d.serviceManager.startService(item.target); }
      case 'project-start': return d.projectManager.start(item.target);
      case 'project-stop': return d.projectManager.stop(item.target);
      case 'project-command': return d.commandManager.runAndWait(item.target, item.commandName, { timeoutMs: 30 * 60 * 1000 });
      case 'lab-start': return d.labManager.start(item.target);
      case 'lab-stop': return d.labManager.stop(item.target);
      case 'lab-provision': return d.labManager.provision(item.target);
      case 'backup-run-due': return d.backupManager.runDue();
      case 'doctor': return d.diagnosticsManager.doctor();
      default: throw new Error('Unsupported automation action');
    }
  }

  async run(id, options = {}) {
    if (this.running.has(id)) return { success: false, error: 'Automation is already running' };
    const value = this._read(); const item = value.automations.find(entry => entry.id === id);
    if (!item) return { success: false, error: 'Automation not found' };
    this.running.add(id); this._emit(); const startedAt = new Date().toISOString();
    try {
      const result = await this._execute(item);
      const success = result?.success !== false;
      item.lastRunAt = new Date().toISOString(); if (success) { item.lastSuccessAt = item.lastRunAt; item.lastError = ''; } else item.lastError = String(result.error || 'Action failed').slice(0, 500);
      if (!options.manual) item.nextRunAt = new Date(Date.now() + item.intervalMinutes * 60000).toISOString();
      value.history.push({ id: crypto.randomUUID(), automationId: id, name: item.name, action: item.action, target: item.target, success, error: item.lastError, startedAt, finishedAt: new Date().toISOString() });
      this._write(value); return { success, result, automation: structuredClone(item) };
    } catch (error) {
      item.lastRunAt = new Date().toISOString(); item.lastError = error.message.slice(0, 500); item.nextRunAt = new Date(Date.now() + Math.min(item.intervalMinutes, 5) * 60000).toISOString();
      value.history.push({ id: crypto.randomUUID(), automationId: id, name: item.name, action: item.action, target: item.target, success: false, error: item.lastError, startedAt, finishedAt: new Date().toISOString() });
      this._write(value); return { success: false, error: error.message };
    } finally { this.running.delete(id); this._emit(); }
  }

  async runDue() {
    const due = this._read().automations.filter(item => item.enabled && Date.parse(item.nextRunAt) <= Date.now());
    const results = [];
    for (const item of due) results.push({ id: item.id, ...(await this.run(item.id)) });
    return { success: results.every(item => item.success), results };
  }
}

module.exports = AutomationManager;
