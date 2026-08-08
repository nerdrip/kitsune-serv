'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.copyFileSync(temporary, file); fs.unlinkSync(temporary);
  }
}

class ObservabilityManager {
  constructor(appRoot, serviceManager, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.storePath = path.join(this.appRoot, 'config', 'observability.json');
    this.serviceManager = serviceManager;
    this.platform = options.platform || process.platform;
    this._execFile = options.execFile || execFile;
    this.resourceCollector = options.resourceCollector || (pids => this._collectResources(pids));
    const saved = this._read();
    this.samples = saved.samples;
    this.events = saved.events;
    this.alerts = saved.alerts;
    this.rules = saved.rules;
    this.timer = null;
    this.collectCount = 0;
    this.onChanged = null;
  }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return {
        samples: Array.isArray(payload.samples) ? payload.samples.slice(-1440) : [],
        events: Array.isArray(payload.events) ? payload.events.slice(-1000) : [],
        alerts: Array.isArray(payload.alerts) ? payload.alerts.slice(-500) : [],
        rules: Array.isArray(payload.rules) ? payload.rules : []
      };
    } catch { return { samples: [], events: [], alerts: [], rules: [] }; }
  }

  _persist() {
    atomicWrite(this.storePath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      samples: this.samples.slice(-1440),
      events: this.events.slice(-1000),
      alerts: this.alerts.slice(-500),
      rules: this.rules
    });
  }

  start(intervalMs = 15000) {
    if (this.timer) return;
    const interval = Math.max(5000, Math.min(300000, Number(intervalMs) || 15000));
    this.timer = setInterval(() => this.collect().catch(() => {}), interval);
    this.timer.unref?.();
    void this.collect();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this._persist(); }

  _collectResources(pids) {
    if (!pids.length) return Promise.resolve({});
    if (this.platform === 'win32') {
      return new Promise(resolve => {
        this._execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
          if (error) return resolve({});
          const wanted = new Set(pids.map(Number));
          const result = {};
          for (const line of String(stdout).split(/\r?\n/)) {
            const match = line.match(/^"(?:[^"]|"")*","(\d+)","[^"]*","[^"]*","([^"]*)"/);
            if (!match || !wanted.has(Number(match[1]))) continue;
            const memoryKB = Number(match[2].replace(/[^0-9]/g, '')) || 0;
            result[match[1]] = { memoryMB: Math.round(memoryKB / 102.4) / 10 };
          }
          resolve(result);
        });
      });
    }
    return new Promise(resolve => {
      this._execFile('ps', ['-o', 'pid=,rss=,%cpu=', '-p', pids.join(',')], { encoding: 'utf8', timeout: 5000 }, (error, stdout) => {
        if (error) return resolve({});
        const result = {};
        for (const line of String(stdout).trim().split(/\r?\n/)) {
          const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)/);
          if (match) result[match[1]] = { memoryMB: Math.round(Number(match[2]) / 102.4) / 10, cpuPercent: Number(match[3]) || 0 };
        }
        resolve(result);
      });
    });
  }

  async collect() {
    const statuses = this.serviceManager.getAllStatuses();
    const pids = Object.values(statuses).filter(status => status.running && status.pid).map(status => Number(status.pid));
    const resources = await this.resourceCollector(pids);
    const services = {};
    for (const [service, status] of Object.entries(statuses)) {
      const usage = status.pid ? resources[String(status.pid)] || resources[status.pid] || {} : {};
      services[service] = {
        running: Boolean(status.running), pid: status.pid || null,
        uptimeSeconds: Math.max(0, Math.round(Number(status.uptime || 0) / 1000)),
        memoryMB: Number(usage.memoryMB || 0), cpuPercent: Number(usage.cpuPercent || 0)
      };
    }
    const sample = { at: new Date().toISOString(), services };
    this.samples.push(sample);
    this.samples = this.samples.slice(-1440);
    this._evaluateRules(sample);
    this.collectCount += 1;
    if (this.collectCount % 4 === 0) this._persist();
    try { this.onChanged?.({ type: 'sample', sample, alerts: this.activeAlerts() }); } catch {}
    return structuredClone(sample);
  }

  recordEvent(type, target, details = {}) {
    const event = { id: crypto.randomUUID(), type: String(type || 'event').slice(0, 80), target: String(target || '').slice(0, 100), details: structuredClone(details || {}), at: new Date().toISOString() };
    this.events.push(event); this.events = this.events.slice(-1000); this._persist();
    try { this.onChanged?.({ type: 'event', event }); } catch {}
    return structuredClone(event);
  }

  recordServiceExit(service, code) {
    const event = this.recordEvent(code === 0 ? 'service-exit' : 'service-crash', service, { exitCode: code });
    if (code !== 0) this._raiseAlert(`crash:${service}`, 'error', `${service} exited unexpectedly with code ${code}`, service, { exitCode: code });
    return event;
  }

  _evaluateRules(sample) {
    for (const rule of this.rules.filter(item => item.enabled !== false)) {
      const service = sample.services[rule.service];
      if (!service) continue;
      const value = Number(service[rule.metric] || 0);
      const triggered = rule.operator === '<' ? value < rule.threshold : value > rule.threshold;
      const key = `rule:${rule.id}`;
      if (triggered) this._raiseAlert(key, rule.severity, `${rule.service} ${rule.metric} is ${value} (threshold ${rule.operator} ${rule.threshold})`, rule.service, { metric: rule.metric, value, threshold: rule.threshold });
      else this._resolveAlert(key);
    }
  }

  _raiseAlert(key, severity, message, target, details) {
    const active = this.alerts.find(item => item.key === key && !item.resolvedAt);
    if (active) { active.lastSeenAt = new Date().toISOString(); active.occurrences += 1; active.details = details; return active; }
    const alert = { id: crypto.randomUUID(), key, severity: ['info', 'warning', 'error'].includes(severity) ? severity : 'warning', message, target, details, occurrences: 1, acknowledgedAt: null, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), resolvedAt: null };
    this.alerts.push(alert); this.alerts = this.alerts.slice(-500); this._persist();
    try { this.onChanged?.({ type: 'alert', alert }); } catch {}
    return alert;
  }

  _resolveAlert(key) {
    const active = this.alerts.find(item => item.key === key && !item.resolvedAt);
    if (active) active.resolvedAt = new Date().toISOString();
  }

  rulesList() { return structuredClone(this.rules); }
  saveRule(input = {}) {
    const metric = ['memoryMB', 'cpuPercent', 'uptimeSeconds'].includes(input.metric) ? input.metric : 'memoryMB';
    const rule = {
      id: typeof input.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(input.id) ? input.id : crypto.randomUUID(),
      name: String(input.name || `${input.service || 'service'} ${metric}`).slice(0, 120),
      service: String(input.service || '').slice(0, 40), metric,
      operator: input.operator === '<' ? '<' : '>',
      threshold: Math.max(0, Number(input.threshold) || 0),
      severity: ['info', 'warning', 'error'].includes(input.severity) ? input.severity : 'warning',
      enabled: input.enabled !== false
    };
    if (!rule.service) throw new Error('Alert rule service is required');
    const index = this.rules.findIndex(item => item.id === rule.id);
    if (index >= 0) this.rules[index] = rule; else this.rules.push(rule);
    this._persist(); return structuredClone(rule);
  }

  removeRule(id) { const before = this.rules.length; this.rules = this.rules.filter(item => item.id !== id); this._persist(); return { success: true, removed: before !== this.rules.length }; }
  activeAlerts() { return structuredClone(this.alerts.filter(item => !item.resolvedAt)); }
  alertsList() { return structuredClone([...this.alerts].reverse()); }
  acknowledgeAlert(id) { const alert = this.alerts.find(item => item.id === id); if (!alert) return { success: false, error: 'Alert not found' }; alert.acknowledgedAt = new Date().toISOString(); this._persist(); return { success: true }; }

  history(options = {}) {
    const limit = Math.max(1, Math.min(1440, Number(options.limit) || 240));
    const since = options.since ? Date.parse(options.since) : 0;
    return structuredClone(this.samples.filter(sample => !since || Date.parse(sample.at) >= since).slice(-limit));
  }

  overview() {
    const latest = this.samples.at(-1) || { at: null, services: {} };
    const running = Object.values(latest.services).filter(service => service.running).length;
    const memoryMB = Object.values(latest.services).reduce((sum, service) => sum + Number(service.memoryMB || 0), 0);
    return { latest: structuredClone(latest), running, memoryMB: Math.round(memoryMB * 10) / 10, activeAlerts: this.activeAlerts(), recentEvents: structuredClone(this.events.slice(-50).reverse()) };
  }

  prometheus() {
    const latest = this.samples.at(-1) || { services: {} };
    const lines = ['# HELP kitsuneserv_service_running Whether a managed service is running.', '# TYPE kitsuneserv_service_running gauge'];
    for (const [service, value] of Object.entries(latest.services)) lines.push(`kitsuneserv_service_running{service="${service}"} ${value.running ? 1 : 0}`);
    lines.push('# HELP kitsuneserv_service_memory_bytes Resident memory used by a managed service.', '# TYPE kitsuneserv_service_memory_bytes gauge');
    for (const [service, value] of Object.entries(latest.services)) lines.push(`kitsuneserv_service_memory_bytes{service="${service}"} ${Math.round(value.memoryMB * 1024 * 1024)}`);
    lines.push('# HELP kitsuneserv_active_alerts Active alerts by severity.', '# TYPE kitsuneserv_active_alerts gauge');
    for (const severity of ['info', 'warning', 'error']) lines.push(`kitsuneserv_active_alerts{severity="${severity}"} ${this.alerts.filter(item => !item.resolvedAt && item.severity === severity).length}`);
    return `${lines.join('\n')}\n`;
  }
}

module.exports = ObservabilityManager;
