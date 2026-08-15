'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const { Duplex } = require('stream');
const { spawn, execFileSync } = require('child_process');
const { Client } = require('ssh2');

const SESSION_TYPES = new Set(['ssh', 'sftp', 'rdp', 'vnc', 'telnet', 'serial']);

function cleanName(value, fallback = 'New server') {
  return String(value || fallback).trim().slice(0, 100) || fallback;
}

function normalizeRemote(remotePath) {
  const value = String(remotePath || '/').replace(/\\/g, '/');
  return value.startsWith('/') ? path.posix.normalize(value) : path.posix.normalize(`/${value}`);
}

const PREVIEW_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf' };

class RemoteAccessManager {
  constructor(appRoot, secretStore) {
    this.file = path.join(path.resolve(appRoot), 'config', 'remote-sessions.json');
    this.secretStore = secretStore;
    this.tunnels = new Map();
    this.mounts = new Map();
    this.connectionPool = new Map();
    this.connectionPoolIdleMs = 30000;
  }

  _read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch { return []; }
  }

  _write(sessions) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, sessions }, null, 2), { mode: 0o600 });
    try { fs.renameSync(temporary, this.file); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temporary, this.file); fs.unlinkSync(temporary);
    }
  }

  list() { return this._read(); }

  importProfiles(content, format = 'auto') {
    const text = String(content || ''); const detected = format === 'auto' ? (/^\s*\{/m.test(text) ? 'kitsune' : /^\s*\[Sessions\\/mi.test(text) ? 'winscp' : 'openssh') : format; const profiles = [];
    if (detected === 'kitsune') {
      const data = JSON.parse(text); if (!Array.isArray(data.sessions)) throw new Error('Invalid KitsuneServ session bundle'); profiles.push(...data.sessions.map(({ id, createdAt, updatedAt, hostFingerprint, ...profile }) => profile));
    } else if (detected === 'winscp') {
      let current = null; for (const raw of text.split(/\r?\n/)) { const section = raw.match(/^\[Sessions\\(.+)]$/i); if (section) { if (current) profiles.push(current); current = { name: decodeURIComponent(section[1].replace(/%([0-9A-F]{2})/gi, '%$1')), type: 'sftp', port: 22 }; continue; } if (!current) continue; const pair = raw.match(/^([^=]+)=(.*)$/); if (!pair) continue; const key = pair[1].trim().toLowerCase(); const value = pair[2].trim(); if (key === 'hostname') current.host = value; else if (key === 'username') current.username = value; else if (key === 'portnumber') current.port = Number(value); else if (key === 'remotedirectory') current.remotePath = value; else if (key === 'fsprotocol') current.type = value === '2' ? 'sftp' : 'ssh'; } if (current) profiles.push(current);
    } else {
      let current = null; for (const raw of text.split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith('#')) continue; const pair = line.match(/^(\S+)\s+(.+)$/); if (!pair) continue; const key = pair[1].toLowerCase(); const value = pair[2].trim(); if (key === 'host') { if (current && !/[?*]/.test(current.alias)) profiles.push(current); current = { alias: value.split(/\s+/)[0], name: value.split(/\s+/)[0], host: value.split(/\s+/)[0], type: 'ssh', port: 22 }; continue; } if (!current) continue; if (key === 'hostname') current.host = value; else if (key === 'user') current.username = value; else if (key === 'port') current.port = Number(value); else if (key === 'identityfile') { current.auth = 'key'; current.privateKeyPath = value.replace(/^~(?=[\\/])/, require('os').homedir()); } else if (key === 'proxyjump') current.proxyJumpAlias = value.split(',')[0].replace(/^[^@]+@/, ''); }
      if (current && !/[?*]/.test(current.alias)) profiles.push(current);
    }
    const imported = []; const aliases = new Map(); for (const profile of profiles.filter(item => item.host)) { const saved = this.save(profile).session; imported.push(saved); if (profile.alias) aliases.set(profile.alias, saved.id); }
    if (detected === 'openssh') { for (let index = 0; index < profiles.length; index++) { const jumpHostId = aliases.get(profiles[index].proxyJumpAlias); if (jumpHostId && imported[index]) imported[index] = this.save({ ...imported[index], jumpHostId }).session; } }
    return { success: true, format: detected, imported };
  }

  exportProfiles() { return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), sessions: this._read().map(({ hostFingerprint, ...session }) => session) }, null, 2); }

  save(input = {}, secrets = {}) {
    const sessions = this._read();
    const id = String(input.id || crypto.randomUUID());
    const index = sessions.findIndex(item => item.id === id);
    const type = SESSION_TYPES.has(input.type) ? input.type : 'ssh';
    const previous = index >= 0 ? sessions[index] : {};
    const session = {
      id,
      name: cleanName(input.name),
      type,
      host: String(input.host || '').trim().slice(0, 255),
      port: Math.max(1, Math.min(65535, Number(input.port) || (type === 'rdp' ? 3389 : type === 'vnc' ? 5900 : type === 'telnet' ? 23 : 22))),
      baudRate: Math.max(300, Math.min(4_000_000, Number(input.baudRate) || 115200)),
      username: String(input.username || '').trim().slice(0, 128),
      auth: input.auth === 'key' ? 'key' : 'password',
      privateKeyPath: String(input.privateKeyPath || '').trim().slice(0, 2048),
      remotePath: normalizeRemote(input.remotePath || previous.remotePath || '/'),
      color: String(input.color || previous.color || '#6f7bff').slice(0, 16),
      group: cleanName(input.group, '').slice(0, 60),
      favorite: Boolean(input.favorite),
      production: Boolean(input.production),
      jumpHostId: String(input.jumpHostId || previous.jumpHostId || '').slice(0, 80),
      useAgent: Boolean(input.useAgent),
      agentForward: Boolean(input.agentForward),
      tmuxSession: String(input.tmuxSession || '').trim().replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80),
      proxyCommand: String(Object.hasOwn(input, 'proxyCommand') ? input.proxyCommand : (previous.proxyCommand || '')).trim().slice(0, 2000),
      hostFingerprint: String(input.hostFingerprint || previous.hostFingerprint || '').slice(0, 160),
      createdAt: previous.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!session.host) throw new Error('Host is required');
    if (index >= 0) sessions[index] = session; else sessions.push(session);
    this._write(sessions);
    if (typeof secrets.password === 'string' && secrets.password) this.secretStore.set(`remote:${id}:password`, secrets.password);
    if (typeof secrets.passphrase === 'string' && secrets.passphrase) this.secretStore.set(`remote:${id}:passphrase`, secrets.passphrase);
    return { success: true, session };
  }

  remove(id) {
    const sessions = this._read();
    const next = sessions.filter(item => item.id !== id);
    this._write(next);
    this.secretStore.remove(`remote:${id}:password`);
    this.secretStore.remove(`remote:${id}:passphrase`);
    return { success: true, removed: next.length !== sessions.length };
  }

  duplicate(id) {
    const source = this._read().find(item => item.id === id);
    if (!source) throw new Error('Unknown remote session');
    const password = this.secretStore.get(`remote:${id}:password`);
    const passphrase = this.secretStore.get(`remote:${id}:passphrase`);
    return this.save({ ...source, id: undefined, name: `${source.name} copy` }, { password, passphrase });
  }

  resetHostKey(id) {
    const sessions = this._read(); const index = sessions.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Unknown remote session');
    sessions[index].hostFingerprint = ''; sessions[index].updatedAt = new Date().toISOString(); this._write(sessions);
    return { success: true };
  }

  resolve(input) {
    const saved = input?.id ? this._read().find(item => item.id === input.id) : null;
    const session = { ...(saved || {}), ...(input || {}) };
    if (!session.host) throw new Error('Unknown remote session');
    return session;
  }

  connectionOptions(input) {
    const session = this.resolve(input);
    let observedFingerprint = '';
    const options = {
      host: session.host,
      port: Number(session.port) || 22,
      username: session.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      hostHash: 'sha256',
      hostVerifier: hash => {
        observedFingerprint = `SHA256:${hash}`;
        return !session.hostFingerprint || session.hostFingerprint === observedFingerprint;
      }
    };
    const password = String(input?.password || this.secretStore.get(`remote:${session.id}:password`) || '');
    if (session.auth === 'key') {
      if (!session.privateKeyPath) throw new Error('Private key path is required');
      options.privateKey = fs.readFileSync(path.resolve(session.privateKeyPath));
      const passphrase = String(input?.passphrase || this.secretStore.get(`remote:${session.id}:passphrase`) || '');
      if (passphrase) options.passphrase = passphrase;
    } else if (password) options.password = password;
    if (session.useAgent && process.env.SSH_AUTH_SOCK) options.agent = process.env.SSH_AUTH_SOCK;
    if (session.agentForward) options.agentForward = true;
    return { session, options, observedFingerprint: () => observedFingerprint };
  }

  _connectOptions(session, options, observedFingerprint) {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const done = (error) => {
        client.removeAllListeners('ready');
        if (error) { reject(error); return; }
        const fingerprint = observedFingerprint();
        if (session.id && fingerprint && !session.hostFingerprint) {
          const sessions = this._read(); const index = sessions.findIndex(item => item.id === session.id);
          if (index >= 0) { sessions[index].hostFingerprint = fingerprint; sessions[index].updatedAt = new Date().toISOString(); this._write(sessions); session.hostFingerprint = fingerprint; }
        }
        resolve({ client, session, fingerprint });
      };
      client.once('ready', () => done());
      client.once('error', done);
      client.connect(options);
    });
  }

  _proxySocket(command, session) { if (/[;&|<>\r\n\0]/.test(command)) throw new Error('ProxyCommand contains unsupported shell syntax'); const parts = [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3]); if (!parts.length) throw new Error('ProxyCommand is empty'); const executable = parts.shift(); const allowed = new Set(['ssh', 'ssh.exe', 'nc', 'nc.exe', 'ncat', 'ncat.exe', 'connect-proxy', 'connect-proxy.exe', 'cloudflared', 'cloudflared.exe']); if (!allowed.has(path.basename(executable).toLowerCase())) throw new Error('ProxyCommand executable is not allowed'); const args = parts.map(value => value.replace(/%h/g, session.host).replace(/%p/g, String(session.port || 22)).replace(/%r/g, session.username || '')); const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); const socket = new Duplex({ read() {}, write(chunk, _encoding, done) { if (!child.stdin.write(chunk)) child.stdin.once('drain', done); else done(); }, final(done) { child.stdin.end(done); }, destroy(error, done) { try { child.kill(); } catch {} done(error); } }); child.stdout.on('data', chunk => socket.push(chunk)); child.stdout.once('end', () => socket.push(null)); child.once('error', error => socket.destroy(error)); child.stderr.on('data', chunk => { if (!socket.proxyError) socket.proxyError = ''; if (socket.proxyError.length < 8192) socket.proxyError += chunk.toString(); }); socket.proxyProcess = child; return socket; }

  async connect(input) {
    const target = this.connectionOptions(input);
    if (target.session.proxyCommand && !target.session.jumpHostId) { const socket = this._proxySocket(target.session.proxyCommand, target.session); try { const connection = await this._connectOptions(target.session, { ...target.options, host: undefined, port: undefined, sock: socket }, target.observedFingerprint); connection.proxyCommand = true; connection.client.once('close', () => socket.destroy()); return connection; } catch (error) { socket.destroy(); throw error; } }
    if (!target.session.jumpHostId) return this._connectOptions(target.session, target.options, target.observedFingerprint);
    if (target.session.jumpHostId === target.session.id) throw new Error('A session cannot use itself as a jump host');
    const jumpSession = this._read().find(item => item.id === target.session.jumpHostId); if (!jumpSession) throw new Error('Jump host session was not found');
    const jump = this.connectionOptions(jumpSession); const jumpConnection = await this._connectOptions(jump.session, jump.options, jump.observedFingerprint);
    try {
      const socket = await new Promise((resolve, reject) => jumpConnection.client.forwardOut('127.0.0.1', 0, target.session.host, Number(target.session.port) || 22, (error, stream) => error ? reject(error) : resolve(stream)));
      const connection = await this._connectOptions(target.session, { ...target.options, host: undefined, port: undefined, sock: socket }, target.observedFingerprint);
      connection.jumpHost = { id: jumpSession.id, name: jumpSession.name }; connection.client.once('close', () => jumpConnection.client.end()); return connection;
    } catch (error) { jumpConnection.client.end(); throw error; }
  }

  _poolKey(input) {
    const session = this.resolve(input);
    const identity = session.id || `${session.username || ''}@${session.host}:${session.port || 22}`; const password = String(input?.password || this.secretStore.get(`remote:${session.id}:password`) || ''); const passphrase = String(input?.passphrase || this.secretStore.get(`remote:${session.id}:passphrase`) || ''); const credentialBinding = crypto.createHash('sha256').update(`${password}\0${passphrase}`).digest('hex');
    return crypto.createHash('sha256').update(`${identity}|${session.host}|${session.port || 22}|${session.username || ''}|${session.auth || ''}|${session.privateKeyPath || ''}|${session.useAgent ? 1 : 0}|${session.hostFingerprint || ''}|${session.jumpHostId || ''}|${session.proxyCommand || ''}|${credentialBinding}`).digest('hex');
  }

  async lease(input, purpose = 'ssh-channel') {
    const key = this._poolKey(input); let entry = this.connectionPool.get(key);
    if (!entry) {
      entry = { key, refs: 0, purposes: new Map(), idleTimer: null, createdAt: Date.now(), lastUsedAt: Date.now(), promise: null, connection: null };
      entry.promise = this.connect(input).then(connection => {
        entry.connection = connection;
        const discard = () => { if (this.connectionPool.get(key) === entry) this.connectionPool.delete(key); if (entry.idleTimer) clearTimeout(entry.idleTimer); };
        connection.client.once('close', discard); connection.client.once('error', discard);
        return connection;
      }).catch(error => { if (this.connectionPool.get(key) === entry) this.connectionPool.delete(key); throw error; });
      this.connectionPool.set(key, entry);
    }
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    const connection = await entry.promise; entry.refs++; entry.lastUsedAt = Date.now(); entry.purposes.set(purpose, (entry.purposes.get(purpose) || 0) + 1); let released = false;
    const release = () => {
      if (released) return; released = true; entry.refs = Math.max(0, entry.refs - 1); entry.lastUsedAt = Date.now();
      const remaining = Math.max(0, (entry.purposes.get(purpose) || 1) - 1); if (remaining) entry.purposes.set(purpose, remaining); else entry.purposes.delete(purpose);
      if (!entry.refs && this.connectionPool.get(key) === entry) entry.idleTimer = setTimeout(() => { if (!entry.refs && this.connectionPool.get(key) === entry) { this.connectionPool.delete(key); try { entry.connection?.client.end(); } catch {} } }, this.connectionPoolIdleMs);
    };
    return { ...connection, pooled: true, release };
  }

  poolStatus() {
    return { connections: this.connectionPool.size, activeLeases: [...this.connectionPool.values()].reduce((sum, item) => sum + item.refs, 0), channels: [...this.connectionPool.values()].flatMap(item => [...item.purposes.entries()].map(([purpose, count]) => ({ purpose, count }))), idleTimeoutMs: this.connectionPoolIdleMs, sharedTransport: true };
  }

  async withSftp(input, action) {
    const { client, release } = await this.lease(input, 'sftp');
    try {
      const sftp = await new Promise((resolve, reject) => client.sftp((error, value) => error ? reject(error) : resolve(value)));
      return await action(sftp);
    } finally { release(); }
  }

  async diagnose(input) {
    const startedAt = Date.now();
    const candidate = this.resolve(input); let addresses = []; let dnsMs = 0;
    try { const dnsStarted = Date.now(); addresses = await dns.lookup(candidate.host, { all: true }); dnsMs = Date.now() - dnsStarted; } catch (error) { throw new Error(`DNS resolution failed for ${candidate.host}: ${error.message}`); }
    const { client, session, release } = await this.lease(input, 'diagnostics');
    try {
      const command = "printf '=== SYSTEM ===\\n'; uname -a 2>/dev/null || ver; printf '\\n=== IDENTITY ===\\n'; id 2>/dev/null; hostname -f 2>/dev/null || hostname; printf '\\n=== UPTIME ===\\n'; uptime 2>/dev/null; printf '\\n=== DISK ===\\n'; df -h 2>/dev/null; printf '\\n=== INODES ===\\n'; df -ih 2>/dev/null; printf '\\n=== MEMORY ===\\n'; (free -h 2>/dev/null || vm_stat 2>/dev/null); printf '\\n=== NETWORK ===\\n'; (ip -brief address 2>/dev/null || ifconfig 2>/dev/null); (ip route 2>/dev/null || netstat -rn 2>/dev/null); printf '\\n=== DNS ===\\n'; cat /etc/resolv.conf 2>/dev/null; printf '\\n=== LISTENING PORTS ===\\n'; (ss -lntup 2>/dev/null || netstat -an 2>/dev/null) | head -n 120; printf '\\n=== TIME ===\\n'; date -Is 2>/dev/null; (timedatectl status 2>/dev/null || true); printf '\\n=== FIREWALL ===\\n'; (ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null || nft list ruleset 2>/dev/null | head -n 40 || true); printf '\\n=== RUNTIMES ===\\n'; for x in git docker kubectl node php python3; do command -v $x >/dev/null && printf '%s: ' $x && $x --version 2>/dev/null | head -n 1; done; printf '\\n=== FAILED SERVICES ===\\n'; systemctl --failed --no-pager 2>/dev/null | head -n 80";
      const output = await new Promise((resolve, reject) => client.exec(command, (error, stream) => {
        if (error) return reject(error); let stdout = ''; let stderr = '';
        stream.on('data', chunk => { if (stdout.length < 256000) stdout += chunk.toString(); }); stream.stderr.on('data', chunk => { if (stderr.length < 32000) stderr += chunk.toString(); });
        stream.once('close', code => resolve({ code, stdout, stderr })); stream.once('error', reject);
      }));
      return { success: output.code === 0 || Boolean(output.stdout), session: { id: session.id, name: session.name, host: session.host }, diagnostics: { dns: { success: true, durationMs: dnsMs, addresses: addresses.map(item => item.address) }, ssh: { success: true, durationMs: Date.now() - startedAt, port: session.port, hostKeyPinned: Boolean(session.hostFingerprint), jumpHost: session.jumpHostId || '' }, authentication: { success: true, method: session.privateKeyPath ? 'private-key' : session.agentForwarding ? 'agent' : 'password-or-agent' } }, ...output };
    } finally { release(); }
  }

  localList(directory) {
    const target = path.resolve(String(directory || process.cwd()));
    const entries = fs.readdirSync(target, { withFileTypes: true }).map(entry => {
      const full = path.join(target, entry.name);
      let stat = null; try { stat = fs.statSync(full); } catch {}
      return { name: entry.name, path: full, directory: entry.isDirectory(), size: stat?.size || 0, modifiedAt: stat?.mtime?.toISOString() || '' };
    }).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    return { path: target, parent: path.dirname(target) === target ? '' : path.dirname(target), entries };
  }

  localMutate(operation, target, destination) {
    const localTarget = path.resolve(String(target));
    if (operation === 'mkdir') fs.mkdirSync(localTarget);
    else if (operation === 'delete-file') fs.unlinkSync(localTarget);
    else if (operation === 'delete-directory') fs.rmdirSync(localTarget);
    else if (operation === 'rename') fs.renameSync(localTarget, path.resolve(String(destination)));
    else throw new Error('Invalid local operation');
    return { success: true };
  }

  async remoteList(input, directory) {
    const target = normalizeRemote(directory);
    return this.withSftp(input, sftp => new Promise((resolve, reject) => sftp.readdir(target, (error, list) => {
      if (error) return reject(error);
      const entries = list.map(item => ({ name: item.filename, path: path.posix.join(target, item.filename), directory: item.attrs.isDirectory(), size: item.attrs.size || 0, modifiedAt: item.attrs.mtime ? new Date(item.attrs.mtime * 1000).toISOString() : '', permissions: item.longname?.split(' ')[0] || '' }))
        .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
      resolve({ path: target, parent: target === '/' ? '' : path.posix.dirname(target), entries });
    })));
  }

  async transfer(input, direction, localPath, remotePath) {
    const local = path.resolve(String(localPath));
    const remote = normalizeRemote(remotePath);
    return this.withSftp(input, sftp => new Promise((resolve, reject) => {
      const callback = error => error ? reject(error) : resolve({ success: true });
      if (direction === 'download') sftp.fastGet(remote, local, callback);
      else if (direction === 'upload') sftp.fastPut(local, remote, callback);
      else reject(new Error('Invalid transfer direction'));
    }));
  }

  async transferResumable(input, direction, localPath, remotePath, onProgress = () => {}) {
    const local = path.resolve(String(localPath)); const remote = normalizeRemote(remotePath);
    return this.withSftp(input, async sftp => {
      const remoteStat = target => new Promise((resolve, reject) => sftp.stat(target, (error, value) => error ? reject(error) : resolve(value)));
      if (direction === 'download') {
        const source = await remoteStat(remote); if (!source.isFile()) throw new Error('Resumable download requires a file'); fs.mkdirSync(path.dirname(local), { recursive: true });
        let offset = 0; try { offset = fs.statSync(local).size; } catch {} if (offset > source.size) offset = 0; if (offset === source.size) return { success: true, resumed: true, bytes: source.size, files: 1 };
        return new Promise((resolve, reject) => { const inputStream = sftp.createReadStream(remote, { start: offset }); const output = fs.createWriteStream(local, { flags: offset ? 'a' : 'w' }); let transferred = offset; inputStream.on('data', chunk => { transferred += chunk.length; onProgress({ name: path.basename(local), transferred, total: source.size, files: 0, bytes: transferred }); }); inputStream.once('error', reject); output.once('error', reject); output.once('finish', () => resolve({ success: true, resumed: offset > 0, bytes: source.size, files: 1 })); inputStream.pipe(output); });
      }
      if (direction === 'upload') {
        const source = fs.statSync(local); if (!source.isFile()) throw new Error('Resumable upload requires a file'); let offset = 0; try { offset = (await remoteStat(remote)).size; } catch {} if (offset > source.size) offset = 0; if (offset === source.size) return { success: true, resumed: true, bytes: source.size, files: 1 };
        return new Promise((resolve, reject) => { const inputStream = fs.createReadStream(local, { start: offset }); const output = sftp.createWriteStream(remote, { flags: offset ? 'r+' : 'w', start: offset }); let transferred = offset; inputStream.on('data', chunk => { transferred += chunk.length; onProgress({ name: path.basename(local), transferred, total: source.size, files: 0, bytes: transferred }); }); inputStream.once('error', reject); output.once('error', reject); output.once('close', () => resolve({ success: true, resumed: offset > 0, bytes: source.size, files: 1 })); inputStream.pipe(output); });
      }
      throw new Error('Invalid transfer direction');
    });
  }

  async transferServerToServer(sourceInput, sourcePath, destinationInput, destinationPath, onProgress = () => {}) {
    const source = normalizeRemote(sourcePath); const destination = normalizeRemote(destinationPath); const sourceConnection = await this.lease(sourceInput, 'server-transfer-source'); let destinationConnection;
    try {
      destinationConnection = await this.lease(destinationInput, 'server-transfer-destination'); const sourceSftp = await new Promise((resolve, reject) => sourceConnection.client.sftp((error, value) => error ? reject(error) : resolve(value))); const destinationSftp = await new Promise((resolve, reject) => destinationConnection.client.sftp((error, value) => error ? reject(error) : resolve(value)));
      const stat = await new Promise((resolve, reject) => sourceSftp.stat(source, (error, value) => error ? reject(error) : resolve(value))); if (!stat.isFile()) throw new Error('Server-to-server transfer currently requires a file');
      return await new Promise((resolve, reject) => { const input = sourceSftp.createReadStream(source); const output = destinationSftp.createWriteStream(destination); let transferred = 0; input.on('data', chunk => { transferred += chunk.length; onProgress({ name: path.posix.basename(source), transferred, total: stat.size, files: 0, bytes: transferred }); }); input.once('error', reject); output.once('error', reject); output.once('close', () => resolve({ success: true, direct: true, files: 1, bytes: stat.size, source, destination })); input.pipe(output); });
    } finally { try { sourceConnection.release(); } catch {} try { destinationConnection?.release(); } catch {} }
  }

  async transferRecursive(input, direction, localPath, remotePath, onProgress = () => {}) {
    const local = path.resolve(String(localPath));
    const remote = normalizeRemote(remotePath);
    return this.withSftp(input, async sftp => {
      let files = 0; let bytes = 0;
      const call = (method, ...args) => new Promise((resolve, reject) => sftp[method](...args, error => error ? reject(error) : resolve()));
      const stat = target => new Promise((resolve, reject) => sftp.stat(target, (error, value) => error ? reject(error) : resolve(value)));
      const list = target => new Promise((resolve, reject) => sftp.readdir(target, (error, value) => error ? reject(error) : resolve(value)));
      const progress = (name, transferred, total) => onProgress({ name, transferred, total, files, bytes });
      const upload = async (localTarget, remoteTarget) => {
        const localStat = fs.statSync(localTarget);
        if (localStat.isDirectory()) {
          try { await call('mkdir', remoteTarget); } catch (error) { if (error.code !== 4) throw error; }
          for (const name of fs.readdirSync(localTarget)) await upload(path.join(localTarget, name), path.posix.join(remoteTarget, name));
          return;
        }
        await new Promise((resolve, reject) => sftp.fastPut(localTarget, remoteTarget, { step: transferred => progress(path.basename(localTarget), transferred, localStat.size) }, error => error ? reject(error) : resolve()));
        files++; bytes += localStat.size; progress(path.basename(localTarget), localStat.size, localStat.size);
      };
      const download = async (remoteTarget, localTarget) => {
        const remoteStat = await stat(remoteTarget);
        if (remoteStat.isDirectory()) {
          fs.mkdirSync(localTarget, { recursive: true });
          for (const item of await list(remoteTarget)) await download(path.posix.join(remoteTarget, item.filename), path.join(localTarget, item.filename));
          return;
        }
        fs.mkdirSync(path.dirname(localTarget), { recursive: true });
        await new Promise((resolve, reject) => sftp.fastGet(remoteTarget, localTarget, { step: transferred => progress(path.posix.basename(remoteTarget), transferred, remoteStat.size) }, error => error ? reject(error) : resolve()));
        files++; bytes += remoteStat.size; progress(path.posix.basename(remoteTarget), remoteStat.size, remoteStat.size);
      };
      if (direction === 'upload') await upload(local, remote);
      else if (direction === 'download') await download(remote, local);
      else throw new Error('Invalid transfer direction');
      return { success: true, files, bytes };
    });
  }

  readLocal(target, maxBytes = 2 * 1024 * 1024) {
    const local = path.resolve(String(target));
    const stat = fs.statSync(local);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('File is too large to edit (maximum 2 MB)');
    return { path: local, content: fs.readFileSync(local, 'utf8'), size: stat.size, modifiedAt: stat.mtime.toISOString() };
  }

  writeLocal(target, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 2 * 1024 * 1024) throw new Error('File is too large to save');
    fs.writeFileSync(path.resolve(String(target)), content, 'utf8');
    return { success: true, bytes: Buffer.byteLength(content) };
  }

  previewLocal(target, maxBytes = 12 * 1024 * 1024) {
    const local = path.resolve(String(target)); const mime = PREVIEW_MIME[path.extname(local).toLowerCase()]; if (!mime) throw new Error('Preview supports PNG, JPEG, GIF, WebP, BMP and PDF');
    const stat = fs.statSync(local); if (!stat.isFile() || stat.size > maxBytes) throw new Error('Preview file is too large (maximum 12 MB)'); return { path: local, mime, size: stat.size, base64: fs.readFileSync(local).toString('base64') };
  }

  async readRemote(input, target, maxBytes = 2 * 1024 * 1024) {
    const remote = normalizeRemote(target);
    return this.withSftp(input, sftp => new Promise((resolve, reject) => sftp.stat(remote, (statError, attrs) => {
      if (statError) return reject(statError);
      if (!attrs.isFile() || attrs.size > maxBytes) return reject(new Error('File is too large to edit (maximum 2 MB)'));
      const chunks = []; const stream = sftp.createReadStream(remote);
      stream.on('data', chunk => chunks.push(chunk)); stream.once('error', reject);
      stream.once('end', () => resolve({ path: remote, content: Buffer.concat(chunks).toString('utf8'), size: attrs.size, modifiedAt: attrs.mtime ? new Date(attrs.mtime * 1000).toISOString() : '' }));
    })));
  }

  async writeRemote(input, target, content, maxBytes = 2 * 1024 * 1024) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > maxBytes) throw new Error('File is too large to save');
    const remote = normalizeRemote(target);
    return this.withSftp(input, sftp => new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(remote, { encoding: 'utf8' });
      stream.once('error', reject); stream.once('close', () => resolve({ success: true, bytes: Buffer.byteLength(content) })); stream.end(content);
    }));
  }

  async previewRemote(input, target, maxBytes = 12 * 1024 * 1024) {
    const remote = normalizeRemote(target); const mime = PREVIEW_MIME[path.posix.extname(remote).toLowerCase()]; if (!mime) throw new Error('Preview supports PNG, JPEG, GIF, WebP, BMP and PDF');
    return this.withSftp(input, sftp => new Promise((resolve, reject) => sftp.stat(remote, (statError, attrs) => { if (statError) return reject(statError); if (!attrs.isFile() || attrs.size > maxBytes) return reject(new Error('Preview file is too large (maximum 12 MB)')); const chunks = []; const stream = sftp.createReadStream(remote); stream.on('data', chunk => chunks.push(chunk)); stream.once('error', reject); stream.once('end', () => resolve({ path: remote, mime, size: attrs.size, base64: Buffer.concat(chunks).toString('base64') })); })));
  }

  diffText(localPath, remoteContent) {
    const local = fs.readFileSync(path.resolve(String(localPath)), 'utf8');
    const left = local.split(/\r?\n/); const right = String(remoteContent).split(/\r?\n/); const lines = []; const count = Math.max(left.length, right.length);
    for (let index = 0; index < count; index++) { if (left[index] === right[index]) lines.push({ type: 'same', line: index + 1, local: left[index] || '', remote: right[index] || '' }); else lines.push({ type: 'changed', line: index + 1, local: left[index] ?? '', remote: right[index] ?? '' }); }
    return { identical: local === String(remoteContent), localLines: left.length, remoteLines: right.length, lines: lines.slice(0, 10000), truncated: lines.length > 10000 };
  }

  async syncPreview(input, localDirectory, remoteDirectory, options = {}) {
    const localRoot = path.resolve(String(localDirectory)); const remoteRoot = normalizeRemote(remoteDirectory); const ignore = (options.ignore || ['.git', 'node_modules']).map(String);
    const ignored = relative => relative.split(/[\\/]/).some(part => ignore.includes(part));
    const local = new Map();
    const walkLocal = (current, relative = '') => { for (const entry of fs.readdirSync(current, { withFileTypes: true })) { const rel = relative ? `${relative}/${entry.name}` : entry.name; if (ignored(rel)) continue; const full = path.join(current, entry.name); const stat = fs.statSync(full); local.set(rel, { directory: entry.isDirectory(), size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000), path: full }); if (entry.isDirectory()) walkLocal(full, rel); } };
    walkLocal(localRoot);
    return this.withSftp(input, async sftp => {
      const remote = new Map(); const list = target => new Promise((resolve, reject) => sftp.readdir(target, (error, value) => error ? reject(error) : resolve(value)));
      const walkRemote = async (current, relative = '') => { for (const entry of await list(current)) { const rel = relative ? `${relative}/${entry.filename}` : entry.filename; if (ignored(rel)) continue; const directory = entry.attrs.isDirectory(); remote.set(rel, { directory, size: entry.attrs.size, mtime: entry.attrs.mtime, path: path.posix.join(current, entry.filename) }); if (directory) { try { await walkRemote(path.posix.join(current, entry.filename), rel); } catch {} } } };
      await walkRemote(remoteRoot);
      const entries = []; const names = new Set([...local.keys(), ...remote.keys()]);
      for (const relative of [...names].sort()) { const a = local.get(relative); const b = remote.get(relative); let state = 'same'; if (!a) state = 'remote-only'; else if (!b) state = 'local-only'; else if (a.directory !== b.directory) state = 'conflict'; else if (!a.directory && (a.size !== b.size || Math.abs(a.mtime - b.mtime) > 2)) state = a.mtime > b.mtime ? 'local-newer' : b.mtime > a.mtime ? 'remote-newer' : 'conflict'; entries.push({ relative, state, directory: Boolean(a?.directory || b?.directory), local: a || null, remote: b || null }); }
      return { localRoot, remoteRoot, entries, summary: Object.fromEntries(['same', 'local-only', 'remote-only', 'local-newer', 'remote-newer', 'conflict'].map(state => [state, entries.filter(item => item.state === state).length])) };
    });
  }

  async syncApply(input, preview, direction, selected = []) {
    if (!['upload', 'download'].includes(direction)) throw new Error('Invalid synchronization direction');
    const allowed = new Set(selected.length ? selected : preview.entries.filter(item => direction === 'upload' ? ['local-only', 'local-newer'].includes(item.state) : ['remote-only', 'remote-newer'].includes(item.state)).map(item => item.relative));
    const actions = preview.entries.filter(item => allowed.has(item.relative) && !item.directory);
    const results = [];
    for (const item of actions) { const local = path.join(preview.localRoot, ...item.relative.split('/')); const remote = path.posix.join(preview.remoteRoot, item.relative); try { await this.transferRecursive(input, direction, local, remote); results.push({ relative: item.relative, success: true }); } catch (error) { results.push({ relative: item.relative, success: false, error: error.message }); } }
    return { success: results.every(item => item.success), direction, results };
  }

  searchLocal(directory, query, limit = 500) {
    const root = path.resolve(String(directory)); const needle = String(query || '').toLowerCase(); const results = [];
    const walk = current => {
      if (results.length >= limit) return;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.name.toLowerCase().includes(needle)) results.push({ name: entry.name, path: full, directory: entry.isDirectory() });
        if (entry.isDirectory() && results.length < limit) { try { walk(full); } catch {} }
      }
    };
    walk(root); return { root, query, results, truncated: results.length >= limit };
  }

  async searchRemote(input, directory, query, limit = 500) {
    const root = normalizeRemote(directory); const needle = String(query || '').toLowerCase();
    return this.withSftp(input, async sftp => {
      const results = [];
      const list = target => new Promise((resolve, reject) => sftp.readdir(target, (error, value) => error ? reject(error) : resolve(value)));
      const walk = async current => {
        if (results.length >= limit) return;
        for (const item of await list(current)) {
          const full = path.posix.join(current, item.filename); const directoryEntry = item.attrs.isDirectory();
          if (item.filename.toLowerCase().includes(needle)) results.push({ name: item.filename, path: full, directory: directoryEntry });
          if (directoryEntry && !item.filename.startsWith('.') && results.length < limit) { try { await walk(full); } catch {} }
        }
      };
      await walk(root); return { root, query, results, truncated: results.length >= limit };
    });
  }

  async mutate(input, operation, target, destination) {
    const remoteTarget = normalizeRemote(target);
    return this.withSftp(input, sftp => new Promise((resolve, reject) => {
      const callback = error => error ? reject(error) : resolve({ success: true });
      if (operation === 'mkdir') sftp.mkdir(remoteTarget, callback);
      else if (operation === 'delete-file') sftp.unlink(remoteTarget, callback);
      else if (operation === 'delete-directory') sftp.rmdir(remoteTarget, callback);
      else if (operation === 'rename') sftp.rename(remoteTarget, normalizeRemote(destination), callback);
      else if (operation === 'chmod') sftp.chmod(remoteTarget, Number.parseInt(String(destination), 8), callback);
      else reject(new Error('Invalid remote operation'));
    }));
  }

  async startTunnel(input, options = {}) {
    const remoteHost = String(options.remoteHost || '127.0.0.1').slice(0, 255);
    const remotePort = Math.max(1, Math.min(65535, Number(options.remotePort)));
    const localHost = ['127.0.0.1', '::1'].includes(options.localHost) ? options.localHost : '127.0.0.1';
    const localPort = Math.max(0, Math.min(65535, Number(options.localPort) || 0));
    if (!remotePort) throw new Error('Remote port is required');
    const { client, session, release } = await this.lease(input, 'tunnel');
    const id = crypto.randomUUID();
    const server = net.createServer(socket => {
      client.forwardOut(socket.remoteAddress || localHost, socket.remotePort || 0, remoteHost, remotePort, (error, stream) => {
        if (error) { socket.destroy(error); return; }
        socket.pipe(stream).pipe(socket);
      });
    });
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(localPort, localHost, resolve); }); }
    catch (error) { release(); throw error; }
    const address = server.address();
    const tunnel = { id, sessionId: session.id, sessionName: session.name, localHost, localPort: address.port, remoteHost, remotePort, createdAt: new Date().toISOString() };
    this.tunnels.set(id, { ...tunnel, server, client, release });
    const stop = () => this.stopTunnel(id); client.once('close', stop); client.once('error', stop);
    return tunnel;
  }

  listTunnels() { return [...this.tunnels.values()].map(({ server, client, release, ...tunnel }) => tunnel); }

  stopTunnel(id) {
    const tunnel = this.tunnels.get(id); if (!tunnel) return { success: false };
    this.tunnels.delete(id); try { tunnel.server.close(); } catch {} try { tunnel.release(); } catch {}
    return { success: true };
  }

  mountSftp(input, drive = 'K:') {
    if (process.platform !== 'win32') throw new Error('SFTP drive mounting currently requires Windows and SSHFS-Win');
    const session = this.resolve(input); const letter = String(drive || '').toUpperCase(); if (!/^[D-Z]:$/.test(letter)) throw new Error('Choose an unused drive letter from D: to Z:');
    if (session.auth !== 'key' && !(session.useAgent && process.env.SSH_AUTH_SOCK)) throw new Error('SFTP mounting requires a private key or SSH agent; passwords are never exposed to SSHFS arguments');
    let executable = ['C:\\Program Files\\SSHFS-Win\\bin\\sshfs.exe', 'C:\\Program Files\\SSHFS-Win\\bin\\sshfs-win.exe'].find(fs.existsSync);
    if (!executable) { try { executable = execFileSync('where.exe', ['sshfs.exe'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch {} } if (!executable) throw new Error('Install WinFsp and SSHFS-Win to mount SFTP drives');
    const remote = `${session.username ? `${session.username}@` : ''}${session.host}:${session.remotePath || '/'}`; const args = [remote, letter, '-p', String(session.port || 22), '-o', 'reconnect', '-o', 'ServerAliveInterval=15']; if (session.privateKeyPath) args.push('-o', `IdentityFile=${path.resolve(session.privateKeyPath)}`);
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true }); const id = crypto.randomUUID(); const mount = { id, sessionId: session.id, sessionName: session.name, drive: letter, remotePath: session.remotePath || '/', createdAt: new Date().toISOString() }; this.mounts.set(id, { ...mount, child }); child.once('exit', () => this.mounts.delete(id)); child.once('error', () => this.mounts.delete(id)); return mount;
  }

  listMounts() { return [...this.mounts.values()].map(({ child, ...mount }) => mount); }
  unmountSftp(id) { const mount = this.mounts.get(id); if (!mount) return { success: false }; this.mounts.delete(id); try { mount.child.kill(); } catch {} return { success: true }; }

  stopAll() { for (const id of [...this.tunnels.keys()]) this.stopTunnel(id); for (const id of [...this.mounts.keys()]) this.unmountSftp(id); for (const entry of this.connectionPool.values()) { if (entry.idleTimer) clearTimeout(entry.idleTimer); try { entry.connection?.client.end(); } catch {} } this.connectionPool.clear(); }
}

module.exports = RemoteAccessManager;
