'use strict';

const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PROVIDERS = Object.freeze([
  { id: 'cloudflared', name: 'Cloudflare Quick Tunnel', command: 'cloudflared' },
  { id: 'ngrok', name: 'ngrok', command: 'ngrok' }
]);

class TunnelManager {
  constructor(projectManager, options = {}) {
    this.projectManager = projectManager;
    this.tunnels = new Map();
    this._spawn = options.spawn || spawn;
    this.onChanged = null;
  }

  _find(command) {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? String(result.stdout || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || command : '';
  }

  providers() {
    return PROVIDERS.map(provider => ({ ...provider, executable: this._find(provider.command), installed: Boolean(this._find(provider.command)) }));
  }

  _public(tunnel) {
    const { process: _process, ...result } = tunnel;
    return structuredClone(result);
  }

  _publish(tunnel) {
    const payload = this._public(tunnel);
    try { this.onChanged?.(payload); } catch {}
    return payload;
  }

  start(projectId, providerId = 'cloudflared') {
    const project = this.projectManager.get(projectId);
    const existing = [...this.tunnels.values()].find(tunnel => tunnel.projectId === project.id && ['starting', 'running'].includes(tunnel.status));
    if (existing) return { success: false, error: 'This project already has an active tunnel', tunnel: this._public(existing) };
    const provider = this.providers().find(item => item.id === providerId);
    if (!provider?.installed) return { success: false, error: `${providerId} is not installed or not available in PATH`, needsInstall: true };
    const localUrl = this.projectManager.getUrl(project.id);
    if (!localUrl) return { success: false, error: 'Project has no HTTP endpoint' };
    const args = providerId === 'cloudflared'
      ? ['tunnel', '--url', localUrl, '--no-autoupdate']
      : ['http', localUrl, '--log=stdout', '--log-format=json'];
    const child = this._spawn(provider.executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env } });
    const tunnel = {
      id: crypto.randomUUID(), projectId: project.id, projectName: project.name, provider: providerId,
      localUrl, publicUrl: '', status: 'starting', output: '', pid: child.pid || null,
      startedAt: new Date().toISOString(), finishedAt: null, process: child
    };
    this.tunnels.set(tunnel.id, tunnel);
    const ingest = chunk => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      tunnel.output = `${tunnel.output}${text}`.slice(-100000);
      const urlMatch = text.match(/https:\/\/[A-Za-z0-9.-]+(?:trycloudflare\.com|ngrok(?:-free)?\.app|ngrok\.io)/i);
      if (urlMatch) { tunnel.publicUrl = urlMatch[0]; tunnel.status = 'running'; }
      if (providerId === 'ngrok') {
        for (const line of text.split(/\r?\n/)) try {
          const event = JSON.parse(line);
          const match = String(event.url || event.msg || '').match(/https:\/\/[^\s"']+/);
          if (match && /ngrok/.test(match[0])) { tunnel.publicUrl = match[0]; tunnel.status = 'running'; }
        } catch {}
      }
      this._publish(tunnel);
    };
    child.stdout.on('data', ingest); child.stderr.on('data', ingest);
    child.on('error', error => { tunnel.status = 'failed'; tunnel.output += `\n${error.message}`; tunnel.finishedAt = new Date().toISOString(); this._publish(tunnel); });
    child.on('exit', code => { tunnel.status = tunnel.status === 'stopping' ? 'stopped' : code === 0 ? 'stopped' : 'failed'; tunnel.exitCode = code; tunnel.finishedAt = new Date().toISOString(); tunnel.process = null; this._publish(tunnel); });
    this._publish(tunnel);
    return { success: true, tunnel: this._public(tunnel) };
  }

  stop(id) {
    const tunnel = this.tunnels.get(id);
    if (!tunnel?.process || !['starting', 'running'].includes(tunnel.status)) return { success: false, error: 'Active tunnel not found' };
    tunnel.status = 'stopping';
    try {
      if (process.platform === 'win32' && tunnel.pid) spawnSync('taskkill.exe', ['/pid', String(tunnel.pid), '/t', '/f'], { windowsHide: true });
      else tunnel.process.kill('SIGTERM');
      this._publish(tunnel);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  }

  list(projectId = null) {
    return [...this.tunnels.values()].filter(tunnel => !projectId || tunnel.projectId === projectId).map(tunnel => this._public(tunnel)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  stopAll() {
    for (const tunnel of this.tunnels.values()) if (['starting', 'running'].includes(tunnel.status)) this.stop(tunnel.id);
  }
}

module.exports = TunnelManager;
