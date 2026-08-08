'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SENSITIVE_KEY = /(authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret)/i;
const MAX_DEPTH = 3;

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.copyFileSync(temporary, file);
    fs.unlinkSync(temporary);
  }
}

function redactString(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(password|passwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;&]+/gi, '$1=[REDACTED]')
    .slice(0, 500);
}

function sanitize(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitize(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 100);
  const clean = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    const safeKey = String(key).slice(0, 80);
    clean[safeKey] = SENSITIVE_KEY.test(safeKey) ? '[REDACTED]' : sanitize(item, depth + 1);
  }
  return clean;
}

function hashEntry(entry) {
  const payload = {
    id: entry.id,
    sequence: entry.sequence,
    at: entry.at,
    actor: entry.actor,
    source: entry.source,
    action: entry.action,
    target: entry.target,
    success: entry.success,
    durationMs: entry.durationMs,
    details: entry.details,
    previousHash: entry.previousHash
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

class AuditManager {
  constructor(appRoot, options = {}) {
    this.storePath = path.join(path.resolve(appRoot), 'config', 'audit.json');
    this.maxEntries = Math.max(100, Math.min(10000, Number(options.maxEntries) || 2000));
    this.state = this._read();
  }

  _read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return {
        anchorHash: /^[a-f0-9]{64}$/.test(value.anchorHash || '') ? value.anchorHash : '',
        nextSequence: Math.max(1, Number(value.nextSequence) || 1),
        entries: Array.isArray(value.entries) ? value.entries : []
      };
    } catch { return { anchorHash: '', nextSequence: 1, entries: [] }; }
  }

  _persist() {
    atomicWrite(this.storePath, {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      anchorHash: this.state.anchorHash,
      nextSequence: this.state.nextSequence,
      entries: this.state.entries
    });
  }

  record(input = {}) {
    const previous = this.state.entries.at(-1)?.hash || this.state.anchorHash || '';
    const entry = {
      id: crypto.randomUUID(),
      sequence: this.state.nextSequence++,
      at: new Date().toISOString(),
      actor: String(input.actor || 'local-user').slice(0, 100),
      source: String(input.source || 'application').slice(0, 80),
      action: String(input.action || 'unknown').slice(0, 160),
      target: String(input.target || '').slice(0, 200),
      success: input.success !== false,
      durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
      details: sanitize(input.details || {}),
      previousHash: previous
    };
    entry.hash = hashEntry(entry);
    this.state.entries.push(entry);
    if (this.state.entries.length > this.maxEntries) {
      const removed = this.state.entries.splice(0, this.state.entries.length - this.maxEntries);
      this.state.anchorHash = removed.at(-1)?.hash || this.state.anchorHash;
    }
    this._persist();
    return structuredClone(entry);
  }

  list(options = {}) {
    const limit = Math.max(1, Math.min(this.maxEntries, Number(options.limit) || 200));
    const action = String(options.action || '').toLowerCase();
    const source = String(options.source || '').toLowerCase();
    const success = typeof options.success === 'boolean' ? options.success : null;
    return structuredClone(this.state.entries
      .filter(entry => !action || entry.action.toLowerCase().includes(action))
      .filter(entry => !source || entry.source.toLowerCase() === source)
      .filter(entry => success == null || entry.success === success)
      .slice(-limit)
      .reverse());
  }

  verify() {
    let previous = this.state.anchorHash || '';
    let expectedSequence = this.state.entries.length ? this.state.entries[0].sequence : this.state.nextSequence;
    for (const entry of this.state.entries) {
      if (entry.sequence !== expectedSequence || entry.previousHash !== previous || entry.hash !== hashEntry(entry)) {
        return { valid: false, entries: this.state.entries.length, firstInvalidSequence: entry.sequence || expectedSequence, verifiedAt: new Date().toISOString() };
      }
      previous = entry.hash;
      expectedSequence += 1;
    }
    const nextSequenceValid = this.state.nextSequence === expectedSequence;
    return {
      valid: nextSequenceValid,
      entries: this.state.entries.length,
      firstSequence: this.state.entries[0]?.sequence || null,
      lastSequence: this.state.entries.at(-1)?.sequence || null,
      firstInvalidSequence: nextSequenceValid ? null : expectedSequence,
      headHash: previous,
      verifiedAt: new Date().toISOString()
    };
  }
}

AuditManager.sanitize = sanitize;
AuditManager.hashEntry = hashEntry;

module.exports = AuditManager;
