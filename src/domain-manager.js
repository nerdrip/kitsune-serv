'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const BLOCK_START = '# >>> KitsuneServ managed domains >>>';
const BLOCK_END = '# <<< KitsuneServ managed domains <<<';

function safeDomain(domain) {
  const value = String(domain || '').trim().toLowerCase();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) throw new Error('Invalid local domain');
  return value;
}

class DomainManager {
  constructor(appRoot, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.hostsPath = options.hostsPath || (process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
      : '/etc/hosts');
    this.certRoot = path.join(this.appRoot, 'certificates');
    this.backupRoot = path.join(this.appRoot, 'backups', 'system');
    fs.mkdirSync(this.certRoot, { recursive: true });
  }

  _domains(projects) {
    return [...new Set((projects || []).map(project => safeDomain(project.domain)).sort())];
  }

  _readHosts() {
    return fs.readFileSync(this.hostsPath, 'utf8');
  }

  _renderHosts(original, domains) {
    const normalized = String(original || '').replace(/\r\n/g, '\n');
    const start = normalized.indexOf(BLOCK_START);
    const end = normalized.indexOf(BLOCK_END);
    let clean = normalized;
    if (start >= 0 && end >= start) clean = `${normalized.slice(0, start)}${normalized.slice(end + BLOCK_END.length)}`;
    clean = clean.replace(/\s+$/g, '');
    if (!domains.length) return `${clean}\n`;
    const rows = domains.map(domain => `127.0.0.1\t${domain}`).join('\n');
    return `${clean}\n\n${BLOCK_START}\n${rows}\n${BLOCK_END}\n`;
  }

  status(projects) {
    const domains = this._domains(projects);
    try {
      const current = this._readHosts();
      const missing = domains.filter(domain => !new RegExp(`^\\s*127\\.0\\.0\\.1\\s+[^#\\n]*\\b${domain.replace(/\./g, '\\.')}\\b`, 'mi').test(current));
      const managedMatch = current.match(new RegExp(`${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      const managed = managedMatch ? managedMatch[1].split(/\r?\n/).map(line => line.trim().split(/\s+/)[1]).filter(Boolean) : [];
      const stale = managed.filter(domain => !domains.includes(domain));
      return { success: true, hostsPath: this.hostsPath, domains, missing, stale, synchronized: !missing.length && !stale.length };
    } catch (error) {
      return { success: false, hostsPath: this.hostsPath, domains, error: error.message };
    }
  }

  _backup(original) {
    fs.mkdirSync(this.backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(this.backupRoot, `hosts-${stamp}.bak`);
    fs.writeFileSync(backup, original, { encoding: 'utf8', mode: 0o600 });
    return backup;
  }

  _writeElevated(content) {
    const tempDir = path.join(this.appRoot, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempSource = path.join(tempDir, `hosts-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(tempSource, content, { encoding: 'utf8', mode: 0o600 });
    try {
      if (process.platform === 'win32') {
        const scriptPath = path.join(tempDir, `hosts-${crypto.randomUUID()}.ps1`);
        const escapedSource = tempSource.replace(/'/g, "''");
        const escapedTarget = this.hostsPath.replace(/'/g, "''");
        fs.writeFileSync(scriptPath, `$ErrorActionPreference='Stop'\nCopy-Item -LiteralPath '${escapedSource}' -Destination '${escapedTarget}' -Force\n`, 'utf8');
        const escapedScript = scriptPath.replace(/'/g, "''");
        const command = `$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedScript}'); exit $process.ExitCode`;
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120000 });
        try { fs.unlinkSync(scriptPath); } catch {}
      } else {
        const probe = spawnSync('which', ['pkexec'], { encoding: 'utf8' });
        if (probe.status !== 0) throw new Error('Writing /etc/hosts requires administrator access. Install pkexec or run the sync command as root.');
        execFileSync('pkexec', ['cp', tempSource, this.hostsPath], { timeout: 120000, stdio: 'ignore' });
      }
    } finally {
      try { fs.unlinkSync(tempSource); } catch {}
    }
  }

  apply(projects, options = {}) {
    const domains = this._domains(projects);
    let original;
    try { original = this._readHosts(); }
    catch (error) { return { success: false, error: error.message, hostsPath: this.hostsPath }; }
    const content = this._renderHosts(original, domains);
    if (content.replace(/\r\n/g, '\n') === original.replace(/\r\n/g, '\n')) return { success: true, unchanged: true, ...this.status(projects) };
    const backup = this._backup(original);
    try {
      fs.writeFileSync(this.hostsPath, content, 'utf8');
    } catch (error) {
      if (!['EACCES', 'EPERM'].includes(error.code) || options.elevate === false) {
        return { success: false, error: error.message, requiresElevation: ['EACCES', 'EPERM'].includes(error.code), backup };
      }
      try { this._writeElevated(content); }
      catch (elevatedError) { return { success: false, error: elevatedError.message, requiresElevation: true, backup }; }
    }
    const status = this.status(projects);
    return status.synchronized ? { success: true, backup, ...status } : { success: false, error: 'Hosts file was written but verification failed', backup, ...status };
  }

  _findMkcert() {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(command, ['mkcert'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return '';
    return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  }

  certificatePaths(domain) {
    const name = safeDomain(domain);
    return { cert: path.join(this.certRoot, `${name}.pem`), key: path.join(this.certRoot, `${name}-key.pem`) };
  }

  certificateStatus(domain) {
    const name = safeDomain(domain);
    const mkcert = this._findMkcert();
    const paths = this.certificatePaths(name);
    const exists = fs.existsSync(paths.cert) && fs.existsSync(paths.key);
    let expiresAt = null;
    if (exists) {
      try {
        const certificate = new crypto.X509Certificate(fs.readFileSync(paths.cert));
        expiresAt = new Date(certificate.validTo).toISOString();
      } catch {}
    }
    return { domain: name, mkcertInstalled: Boolean(mkcert), mkcertPath: mkcert, exists, expiresAt, ...paths };
  }

  installCertificateAuthority() {
    const mkcert = this._findMkcert();
    if (!mkcert) return { success: false, error: 'mkcert is not installed. Install it with winget, Chocolatey, Scoop or your Linux package manager.', needsInstall: true };
    try {
      execFileSync(mkcert, ['-install'], { encoding: 'utf8', timeout: 120000, windowsHide: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.stderr || error.message };
    }
  }

  issueCertificate(domain) {
    const name = safeDomain(domain);
    const mkcert = this._findMkcert();
    if (!mkcert) return { success: false, error: 'mkcert is not installed', needsInstall: true };
    const paths = this.certificatePaths(name);
    try {
      execFileSync(mkcert, ['-cert-file', paths.cert, '-key-file', paths.key, name, `*.${name}`], { encoding: 'utf8', timeout: 120000, windowsHide: true });
      try { fs.chmodSync(paths.key, 0o600); } catch {}
      return { success: true, ...this.certificateStatus(name) };
    } catch (error) {
      return { success: false, error: error.stderr || error.message };
    }
  }
}

DomainManager.BLOCK_START = BLOCK_START;
DomainManager.BLOCK_END = BLOCK_END;

module.exports = DomainManager;
