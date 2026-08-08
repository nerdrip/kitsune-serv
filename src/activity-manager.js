'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

class ActivityManager extends EventEmitter {
  constructor(appRoot, options = {}) {
    super();
    this.historyLimit = Math.max(50, Number(options.historyLimit) || 500);
    this.configDir = path.join(path.resolve(appRoot), 'config');
    this.historyPath = path.join(this.configDir, 'activity.json');
    this.entries = this._load();
    this.controllers = new Map();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(entry => entry && typeof entry === 'object' && typeof entry.id === 'string')
        .map(entry => entry.status === 'running'
          ? { ...entry, status: 'interrupted', finishedAt: entry.finishedAt || new Date().toISOString() }
          : entry)
        .slice(-this.historyLimit);
    } catch {
      return [];
    }
  }

  _persist() {
    fs.mkdirSync(this.configDir, { recursive: true });
    const temp = `${this.historyPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.entries.slice(-this.historyLimit), null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temp, this.historyPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, this.historyPath);
      fs.unlinkSync(temp);
    }
  }

  _publish(entry) {
    this._persist();
    const snapshot = structuredClone(entry);
    this.emit('changed', snapshot);
    return snapshot;
  }

  begin(type, title, metadata = {}) {
    const now = new Date().toISOString();
    const entry = {
      id: crypto.randomUUID(),
      type: String(type || 'operation').slice(0, 80),
      title: String(title || type || 'Operation').slice(0, 200),
      status: 'running',
      stage: 'starting',
      progress: 0,
      cancellable: true,
      cancelRequested: false,
      message: '',
      metadata: metadata && typeof metadata === 'object' ? structuredClone(metadata) : {},
      startedAt: now,
      updatedAt: now,
      finishedAt: null
    };
    this.entries.push(entry);
    this.controllers.set(entry.id, { cancelled: false });
    this._publish(entry);
    return structuredClone(entry);
  }

  update(id, patch = {}) {
    const entry = this.entries.find(item => item.id === id);
    if (!entry || TERMINAL_STATES.has(entry.status)) return null;
    const allowed = ['stage', 'progress', 'message', 'cancellable', 'metadata'];
    for (const key of allowed) {
      if (Object.hasOwn(patch, key)) entry[key] = key === 'progress'
        ? Math.min(100, Math.max(0, Number(patch[key]) || 0))
        : structuredClone(patch[key]);
    }
    entry.updatedAt = new Date().toISOString();
    return this._publish(entry);
  }

  finish(id, status = 'completed', result = {}) {
    const entry = this.entries.find(item => item.id === id);
    if (!entry) return null;
    const finalStatus = ['completed', 'failed', 'cancelled'].includes(status) ? status : 'completed';
    entry.status = finalStatus;
    entry.progress = finalStatus === 'completed' ? 100 : entry.progress;
    entry.stage = finalStatus;
    entry.result = result && typeof result === 'object' ? structuredClone(result) : { value: result };
    entry.message = result?.error || result?.message || entry.message || '';
    entry.cancellable = false;
    entry.updatedAt = new Date().toISOString();
    entry.finishedAt = entry.updatedAt;
    this.controllers.delete(id);
    return this._publish(entry);
  }

  cancel(id) {
    const entry = this.entries.find(item => item.id === id);
    const controller = this.controllers.get(id);
    if (!entry || !controller || entry.status !== 'running' || entry.cancellable === false) {
      return { success: false, error: 'Operation cannot be cancelled' };
    }
    controller.cancelled = true;
    entry.cancelRequested = true;
    entry.message = 'Cancellation requested';
    entry.updatedAt = new Date().toISOString();
    this._publish(entry);
    return { success: true };
  }

  isCancelled(id) {
    return Boolean(this.controllers.get(id)?.cancelled);
  }

  async run(type, title, metadata, worker) {
    const operation = this.begin(type, title, metadata);
    const context = {
      id: operation.id,
      update: patch => this.update(operation.id, patch),
      isCancelled: () => this.isCancelled(operation.id),
      throwIfCancelled: () => {
        if (this.isCancelled(operation.id)) {
          const error = new Error('Operation cancelled');
          error.code = 'KITSUNE_CANCELLED';
          throw error;
        }
      }
    };
    try {
      const result = await worker(context);
      this.finish(operation.id, 'completed', result || {});
      return result;
    } catch (error) {
      const cancelled = error?.code === 'KITSUNE_CANCELLED';
      this.finish(operation.id, cancelled ? 'cancelled' : 'failed', { error: error.message });
      if (cancelled) return { success: false, cancelled: true, error: error.message };
      throw error;
    }
  }

  list(options = {}) {
    let entries = this.entries;
    if (options.status) entries = entries.filter(entry => entry.status === options.status);
    const limit = Math.min(this.historyLimit, Math.max(1, Number(options.limit) || 100));
    return structuredClone(entries.slice(-limit).reverse());
  }

  clearCompleted() {
    const before = this.entries.length;
    this.entries = this.entries.filter(entry => !TERMINAL_STATES.has(entry.status));
    this._persist();
    return { success: true, removed: before - this.entries.length };
  }
}

module.exports = ActivityManager;
