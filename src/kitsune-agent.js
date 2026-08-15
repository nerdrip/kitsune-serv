#!/usr/bin/env node
'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const MAX_BODY = 256 * 1024;
const SERVICE_RE = /^[A-Za-z0-9_.@-]{1,180}$/;

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonicalSignature(token, timestamp, nonce, method, pathname, body = '') {
  return crypto.createHmac('sha256', token).update(`${timestamp}\n${nonce}\n${method.toUpperCase()}\n${pathname}\n${digest(body)}`).digest('hex');
}
function secureEqual(left, right) {
  const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function run(program, args, timeout = 15000) {
  return new Promise(resolve => execFile(program, args, { timeout, windowsHide: true, maxBuffer: 2_000_000 }, (error, stdout, stderr) => resolve({
    success: !error, code: Number.isInteger(error?.code) ? error.code : (error ? 1 : 0), stdout: String(stdout || ''), stderr: String(stderr || error?.message || '')
  })));
}
function contained(root, requested) {
  const base = path.resolve(root); const target = path.resolve(base, requested || '.');
  return target === base || target.startsWith(`${base}${path.sep}`) ? target : '';
}

class KitsuneAgent {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port ?? 10991);
    this.token = String(options.token || '');
    this.name = String(options.name || os.hostname()).slice(0, 120);
    this.allowedRoots = (options.allowedRoots || [path.join(process.cwd(), 'logs'), ...(process.platform === 'win32' ? [] : ['/var/log'])]).map(item => path.resolve(item));
    this.clockSkewMs = Math.max(30000, Math.min(10 * 60_000, Number(options.clockSkewMs || 120000)));
    this.nonces = new Map();
    this.capabilityNonces = new Map();
    this.relays = new Map();
    this.relayKeyPath = options.relayKeyPath || process.env.KITSUNE_AGENT_RELAY_KEY || '';
    this.knownHostsPath = options.knownHostsPath || process.env.KITSUNE_AGENT_KNOWN_HOSTS || '';
    this.server = null;
    if (this.token.length < 24) throw new Error('Agent token must contain at least 24 characters');
  }

  _authenticate(request, body, pathname) {
    const timestamp = String(request.headers['x-kitsune-timestamp'] || '');
    const nonce = String(request.headers['x-kitsune-nonce'] || '');
    const signature = String(request.headers['x-kitsune-signature'] || '');
    const now = Date.now(); const sent = Number(timestamp);
    for (const [key, expiry] of this.nonces) if (expiry < now) this.nonces.delete(key);
    if (!Number.isFinite(sent) || Math.abs(now - sent) > this.clockSkewMs) throw Object.assign(new Error('Expired request'), { status: 401 });
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(nonce) || this.nonces.has(nonce)) throw Object.assign(new Error('Invalid or replayed nonce'), { status: 401 });
    const expected = canonicalSignature(this.token, timestamp, nonce, request.method, pathname, body);
    if (!secureEqual(signature, expected)) throw Object.assign(new Error('Invalid signature'), { status: 401 });
    this.nonces.set(nonce, now + this.clockSkewMs);
  }

  async _body(request) {
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 }); chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }

  async _inventory() {
    const base = { agent: this.name, hostname: os.hostname(), platform: process.platform, arch: os.arch(), release: os.release(), cpus: os.cpus().length, totalMemory: os.totalmem(), uptime: os.uptime(), node: process.version };
    if (process.platform === 'win32') {
      const services = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Service | Select-Object -First 200 Name,Status,StartType | ConvertTo-Json -Compress']);
      return { ...base, services: services.success ? JSON.parse(services.stdout || '[]') : [], capabilities: ['service-control', 'metrics', 'bounded-files'] };
    }
    const services = await run('systemctl', ['list-units', '--type=service', '--all', '--no-pager', '--plain']);
    const containers = await run('docker', ['ps', '-a', '--format', '{{json .}}']);
    return { ...base, services: services.stdout.split(/\r?\n/).filter(Boolean).slice(0, 300), containers: containers.stdout.split(/\r?\n/).filter(Boolean).slice(0, 300), capabilities: ['systemd', 'docker', 'metrics', 'bounded-files'] };
  }

  _metrics() {
    const cpus = os.cpus(); const total = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
    const idle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
    return { timestamp: new Date().toISOString(), loadAverage: os.loadavg(), cpuBusyRatio: total ? 1 - idle / total : 0, memoryUsed: os.totalmem() - os.freemem(), memoryTotal: os.totalmem(), uptime: os.uptime() };
  }

  _safeFile(input) {
    for (const root of this.allowedRoots) { const target = contained(root, input.path); if (target && fs.existsSync(target)) return target; }
    throw Object.assign(new Error('Path is outside configured agent roots'), { status: 403 });
  }

  async _action(input = {}) {
    const service = String(input.service || ''); if (!SERVICE_RE.test(service)) throw new Error('Invalid service name');
    const action = String(input.action || 'status');
    if (!['status', 'start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported agent action');
    if (process.platform === 'win32') {
      const command = action === 'status' ? `(Get-Service -Name '${service}').Status.ToString()` : `${action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Restart'}-Service -Name '${service}' -ErrorAction Stop`;
      return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], 45000);
    }
    return run('systemctl', [action, '--', service], 45000);
  }

  _verifyCapability(grant, action, resource) {
    if (!grant || typeof grant !== 'object') throw Object.assign(new Error('Capability grant is required'), { status: 403 });
    const signature = String(grant.signature || ''); const unsigned = { ...grant }; delete unsigned.signature;
    const expected = crypto.createHmac('sha256', this.token).update(JSON.stringify(unsigned)).digest('base64url');
    if (!secureEqual(signature, expected) || new Date(grant.expiresAt) <= new Date() || this.capabilityNonces.has(grant.nonce)) throw Object.assign(new Error('Capability is invalid, expired or already used'), { status: 403 });
    const expectedAction = grant.action === 'service-status' ? 'status' : grant.action === 'service-restart' ? 'restart' : grant.action;
    if (expectedAction !== action || (['status', 'restart'].includes(action) && grant.resource !== resource)) throw Object.assign(new Error('Capability scope mismatch'), { status: 403 });
    this.capabilityNonces.set(grant.nonce, Date.parse(grant.expiresAt));
  }

  _startRelay(parameters = {}) {
    if (!this.relayKeyPath || !this.knownHostsPath) throw new Error('Relay key and known_hosts must be configured on the agent');
    const host = String(parameters.host || ''); const user = String(parameters.user || 'kitsune-relay'); const port = Number(parameters.port || 22); const remotePort = Number(parameters.remotePort); const localPort = Number(parameters.localPort || this.port);
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(host) || !/^[A-Za-z0-9_.-]{1,100}$/.test(user) || ![port, remotePort, localPort].every(value => Number.isInteger(value) && value > 0 && value < 65536)) throw new Error('Invalid relay parameters');
    const relayId = crypto.randomUUID(); const child = spawn('ssh', ['-NT', '-i', path.resolve(this.relayKeyPath), '-o', `UserKnownHostsFile=${path.resolve(this.knownHostsPath)}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-R', `127.0.0.1:${remotePort}:127.0.0.1:${localPort}`, '-p', String(port), `${user}@${host}`], { windowsHide: true, stdio: 'ignore' });
    this.relays.set(relayId, { id: relayId, host, port, remotePort, localPort, pid: child.pid, startedAt: new Date().toISOString(), child }); child.once('exit', () => this.relays.delete(relayId));
    return { success: true, relay: { id: relayId, host, port, remotePort, localPort, pid: child.pid, inboundPortsRequired: false } };
  }

  async _capabilityAction(input = {}) {
    const action = String(input.action || ''); const service = String(input.service || 'system'); this._verifyCapability(input.grant, action, service);
    if (['status', 'restart'].includes(action)) return this._action({ action, service });
    if (action === 'relay-start') return this._startRelay(input.parameters || {});
    if (action === 'diagnostics') return { metrics: this._metrics(), inventory: await this._inventory(), relays: [...this.relays.values()].map(({ child: _child, ...relay }) => relay) };
    throw new Error('Unsupported privileged capability');
  }

  _deltaSignature(input = {}) {
    const target = this._safeFile(input); const stat = fs.statSync(target); if (!stat.isFile()) throw new Error('Delta target is not a file'); const blockSize = Math.max(4096, Math.min(1024 * 1024, Number(input.blockSize) || 65536)); const blocks = []; const handle = fs.openSync(target, 'r'); try { for (let offset = 0; offset < stat.size; offset += blockSize) { const buffer = Buffer.alloc(Math.min(blockSize, stat.size - offset)); fs.readSync(handle, buffer, 0, buffer.length, offset); blocks.push({ offset, bytes: buffer.length, weak: buffer.reduce((sum, value) => (sum + value) >>> 0, 0), strong: digest(buffer) }); } } finally { fs.closeSync(handle); } return { path: target, bytes: stat.size, blockSize, sha256: digest(fs.readFileSync(target)), blocks };
  }

  async _route(method, pathname, input) {
    if (method === 'GET' && pathname === '/v1/health') return { ok: true, agent: this.name, version: 1, uptime: process.uptime() };
    if (method === 'GET' && pathname === '/v1/metrics') return this._metrics();
    if (method === 'GET' && pathname === '/v1/inventory') return this._inventory();
    if (method === 'POST' && pathname === '/v1/files/read') {
      const target = this._safeFile(input); const stat = fs.statSync(target); if (!stat.isFile()) throw new Error('Path is not a file');
      const maxBytes = Math.max(1, Math.min(1024 * 1024, Number(input.maxBytes || 262144)));
      const offset = Math.max(0, Number(input.offset || 0)); const handle = fs.openSync(target, 'r'); const buffer = Buffer.alloc(Math.min(maxBytes, Math.max(0, stat.size - offset)));
      try { fs.readSync(handle, buffer, 0, buffer.length, offset); } finally { fs.closeSync(handle); }
      return { path: target, offset, size: stat.size, data: buffer.toString(input.encoding === 'base64' ? 'base64' : 'utf8'), encoding: input.encoding === 'base64' ? 'base64' : 'utf8' };
    }
    if (method === 'POST' && pathname === '/v1/action') return this._action(input);
    if (method === 'POST' && pathname === '/v1/capability/action') return this._capabilityAction(input);
    if (method === 'POST' && pathname === '/v1/delta/signature') return this._deltaSignature(input);
    if (method === 'GET' && pathname === '/v1/relay/status') return { relays: [...this.relays.values()].map(({ child: _child, ...relay }) => relay) };
    throw Object.assign(new Error('Endpoint not found'), { status: 404 });
  }

  async _handle(request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`); const raw = await this._body(request);
      this._authenticate(request, raw, url.pathname); const input = raw ? JSON.parse(raw) : {};
      const result = await this._route(request.method, url.pathname, input);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ success: true, result }));
    } catch (error) {
      response.writeHead(error.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ success: false, error: error.message }));
    }
  }

  start() {
    if (this.server) return Promise.resolve(this.address());
    this.server = http.createServer((request, response) => this._handle(request, response));
    return new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, () => { this.server.off('error', reject); resolve(this.address()); }); });
  }
  address() { const address = this.server?.address(); return { host: this.host, port: typeof address === 'object' ? address.port : this.port, name: this.name }; }
  stop() { for (const relay of this.relays.values()) { try { relay.child.kill(); } catch {} } this.relays.clear(); return new Promise(resolve => { if (!this.server) return resolve(); const server = this.server; this.server = null; server.close(() => resolve()); }); }
}

if (require.main === module) {
  const token = process.env.KITSUNE_AGENT_TOKEN || '';
  if (process.argv.includes('--generate-token')) { process.stdout.write(`${crypto.randomBytes(32).toString('base64url')}\n`); process.exit(0); }
  const agent = new KitsuneAgent({ token, host: process.env.KITSUNE_AGENT_HOST, port: process.env.KITSUNE_AGENT_PORT });
  agent.start().then(address => process.stdout.write(`Kitsune Agent listening on ${address.host}:${address.port}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

module.exports = { KitsuneAgent, canonicalSignature };
