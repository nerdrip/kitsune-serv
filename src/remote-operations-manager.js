'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dgram = require('dgram');

function shellQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }

function deploymentTarget(value) {
  const target = path.posix.normalize(String(value || ''));
  if (!target.startsWith('/') || target === '/' || target.split('/').filter(Boolean).length < 2) throw new Error('Deployment target must be a specific absolute remote directory');
  return target;
}

const SAFE_ACTIONS = {
  inventory: "printf '=== PROCESSES ===\\n'; ps -eo pid,pcpu,pmem,comm,args --sort=-pcpu 2>/dev/null | head -n 31; printf '\\n=== SYSTEMD ===\\n'; systemctl list-units --type=service --state=running,failed --no-pager --plain 2>/dev/null | head -n 80; printf '\\n=== DOCKER ===\\n'; docker ps -a --format '{{json .}}' 2>/dev/null | head -n 100",
  dockerList: "docker ps -a --format '{{json .}}'",
  dockerImages: "docker images --format '{{json .}}'",
  systemdList: "systemctl list-units --type=service --all --no-pager --plain",
  processList: 'ps -eo pid,ppid,user,pcpu,pmem,etime,comm,args --sort=-pcpu | head -n 201'
};

function safeIdentifier(value, label = 'identifier') {
  const normalized = String(value || '');
  if (!/^[A-Za-z0-9_.:@/-]{1,200}$/.test(normalized) || normalized.includes('..')) throw new Error(`Invalid ${label}`);
  return normalized;
}

class RemoteOperationsManager {
  constructor(appRoot, remoteAccessManager) {
    this.file = path.join(path.resolve(appRoot), 'config', 'remote-runbooks.json');
    this.remote = remoteAccessManager;
  }

  _read() { try { const value = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(value.runbooks) ? value.runbooks : []; } catch { return []; } }
  _write(runbooks) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temporary = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, runbooks }, null, 2), { mode: 0o600 }); try { fs.renameSync(temporary, this.file); } catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temporary, this.file); fs.unlinkSync(temporary); } }

  listRunbooks() { return this._read(); }
  saveRunbook(input = {}) {
    const runbooks = this._read(); const id = String(input.id || crypto.randomUUID()); const index = runbooks.findIndex(item => item.id === id);
    const steps = (Array.isArray(input.steps) ? input.steps : []).slice(0, 50).map(step => ({ name: String(step.name || 'Step').slice(0, 100), command: String(step.command || '').slice(0, 8000), continueOnError: Boolean(step.continueOnError) })).filter(step => step.command);
    if (!steps.length) throw new Error('Runbook requires at least one command');
    const previous = index >= 0 ? runbooks[index] : {}; const runbook = { id, name: String(input.name || 'Runbook').slice(0, 100), description: String(input.description || '').slice(0, 500), parameters: (Array.isArray(input.parameters) ? input.parameters : []).slice(0, 20).map(value => safeIdentifier(value, 'parameter')), steps, productionApproval: input.productionApproval !== false, createdAt: previous.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (index >= 0) runbooks[index] = runbook; else runbooks.push(runbook); this._write(runbooks); return { success: true, runbook };
  }
  removeRunbook(id) { const before = this._read(); const after = before.filter(item => item.id !== id); this._write(after); return { success: true, removed: before.length !== after.length }; }

  async exec(input, command, timeoutMs = 30000) {
    const { client, release } = await this.remote.lease(input, 'command');
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Remote command timed out')), Math.max(1000, Math.min(300000, timeoutMs)));
        client.exec(command, (error, stream) => {
          if (error) { clearTimeout(timer); reject(error); return; } let stdout = ''; let stderr = '';
          stream.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk.toString(); }); stream.stderr.on('data', chunk => { if (stderr.length < 250_000) stderr += chunk.toString(); });
          stream.once('close', code => { clearTimeout(timer); resolve({ success: code === 0, code, stdout, stderr }); }); stream.once('error', error => { clearTimeout(timer); reject(error); });
        });
      });
    } finally { release(); }
  }

  inspect(input, kind = 'inventory') { if (!SAFE_ACTIONS[kind]) throw new Error('Unsupported inspection'); return this.exec(input, SAFE_ACTIONS[kind]); }
  docker(input, action, target) { if (!['start', 'stop', 'restart', 'pause', 'unpause', 'rm'].includes(action)) throw new Error('Unsupported Docker action'); return this.exec(input, `docker ${action} -- ${safeIdentifier(target, 'container')}`); }
  systemd(input, action, unit) { if (!['start', 'stop', 'restart', 'reload', 'status', 'enable', 'disable'].includes(action)) throw new Error('Unsupported systemd action'); return this.exec(input, `systemctl ${action} -- ${safeIdentifier(unit, 'unit')}`); }
  signal(input, pid, signal = 'TERM') { const number = Number(pid); if (!Number.isInteger(number) || number < 2) throw new Error('Invalid PID'); if (!['TERM', 'KILL', 'HUP', 'INT'].includes(signal)) throw new Error('Invalid signal'); return this.exec(input, `kill -${signal} ${number}`); }
  archive(input, action, source, destination) {
    const src = safeIdentifier(source, 'source path'); const dest = safeIdentifier(destination, 'destination path');
    if (action === 'tar') return this.exec(input, `tar -czf ${dest} -- ${src}`, 300000);
    if (action === 'unpack') return this.exec(input, `mkdir -p ${dest} && tar -xzf ${src} -C ${dest}`, 300000);
    throw new Error('Unsupported archive action');
  }

  async deploy(input, options = {}, onStage = () => {}) {
    const localDirectory = path.resolve(String(options.localDirectory || '')); const stat = fs.statSync(localDirectory);
    if (!stat.isDirectory()) throw new Error('Deployment source must be a local directory');
    const target = deploymentTarget(options.remoteDirectory); const releaseId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const staging = `${target}.kitsune-stage-${releaseId}`; const previous = `${target}.kitsune-previous-${releaseId}`; const backup = `${target}.kitsune-backup-${releaseId}.tar.gz`;
    const run = async (stage, command, timeout = 300000) => { onStage({ stage, status: 'running' }); const result = await this.exec(input, command, timeout); onStage({ stage, status: result.success ? 'success' : 'error', code: result.code }); if (!result.success) throw Object.assign(new Error(result.stderr || `${stage} failed`), { result }); return result; };
    let switched = false;
    try {
      await run('prepare', `rm -rf -- ${shellQuote(staging)} && mkdir -p -- ${shellQuote(staging)} ${shellQuote(path.posix.dirname(target))}`);
      onStage({ stage: 'upload', status: 'running' }); await this.remote.transferRecursive(input, 'upload', localDirectory, staging); onStage({ stage: 'upload', status: 'success' });
      await run('backup', `if [ -e ${shellQuote(target)} ]; then tar -czf ${shellQuote(backup)} -C ${shellQuote(path.posix.dirname(target))} -- ${shellQuote(path.posix.basename(target))}; fi`);
      await run('activate', `if [ -e ${shellQuote(target)} ]; then mv -- ${shellQuote(target)} ${shellQuote(previous)}; fi && mv -- ${shellQuote(staging)} ${shellQuote(target)}`); switched = true;
      if (String(options.postCommand || '').trim()) await run('post-command', `cd -- ${shellQuote(target)} && (${String(options.postCommand).slice(0, 8000)})`);
      if (String(options.healthCommand || '').trim()) await run('health-check', `cd -- ${shellQuote(target)} && (${String(options.healthCommand).slice(0, 8000)})`, 120000);
      await run('finalize', `rm -rf -- ${shellQuote(previous)}`); switched = false;
      return { success: true, target, backup, releaseId };
    } catch (error) {
      if (switched) {
        try { await run('rollback', `rm -rf -- ${shellQuote(target)} && if [ -e ${shellQuote(previous)} ]; then mv -- ${shellQuote(previous)} ${shellQuote(target)}; fi`); } catch (rollbackError) { error.rollbackError = rollbackError.message; }
      } else { try { await this.exec(input, `rm -rf -- ${shellQuote(staging)}`); } catch {} }
      return { success: false, target, backup, releaseId, error: error.message, rollbackError: error.rollbackError || '', rolledBack: switched && !error.rollbackError };
    }
  }

  async runRunbook(input, id, parameters = {}, onStep = () => {}) {
    const runbook = this._read().find(item => item.id === id); if (!runbook) throw new Error('Unknown runbook');
    const values = {}; for (const key of runbook.parameters) values[key] = String(parameters[key] || '').slice(0, 2000);
    const render = command => command.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (_match, key) => { if (!(key in values)) throw new Error(`Missing parameter ${key}`); return `'${values[key].replace(/'/g, `'"'"'`)}'`; });
    const results = [];
    for (let index = 0; index < runbook.steps.length; index++) { const step = runbook.steps[index]; onStep({ index, total: runbook.steps.length, name: step.name, status: 'running' }); const result = await this.exec(input, render(step.command), 300000); results.push({ ...result, name: step.name }); onStep({ index, total: runbook.steps.length, name: step.name, status: result.success ? 'success' : 'error' }); if (!result.success && !step.continueOnError) break; }
    return { success: results.every(item => item.success), runbook: { id: runbook.id, name: runbook.name }, results };
  }

  wake(mac, address = '255.255.255.255', port = 9) {
    const hex = String(mac || '').replace(/[^a-fA-F0-9]/g, ''); if (!/^[a-fA-F0-9]{12}$/.test(hex)) throw new Error('Invalid MAC address');
    const hardware = Buffer.from(hex, 'hex'); const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => hardware)]); const socket = dgram.createSocket('udp4'); socket.bind(() => { socket.setBroadcast(true); socket.send(packet, 0, packet.length, Number(port) || 9, address, () => socket.close()); }); return { success: true, mac: hex.match(/../g).join(':').toUpperCase(), address, port: Number(port) || 9 };
  }
}

module.exports = RemoteOperationsManager;
