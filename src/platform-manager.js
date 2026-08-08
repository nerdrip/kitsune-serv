'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const PACKAGE_MANAGERS = Object.freeze([
  { id: 'winget', platforms: ['win32'], command: 'winget' },
  { id: 'choco', platforms: ['win32'], command: 'choco' },
  { id: 'scoop', platforms: ['win32'], command: 'scoop' },
  { id: 'apt', platforms: ['linux'], command: 'apt-get' },
  { id: 'dnf', platforms: ['linux'], command: 'dnf' },
  { id: 'pacman', platforms: ['linux'], command: 'pacman' },
  { id: 'zypper', platforms: ['linux'], command: 'zypper' },
  { id: 'brew', platforms: ['linux', 'darwin'], command: 'brew' }
]);

class PlatformManager {
  constructor(appRoot, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.serverEntry = options.serverEntry || path.join(__dirname, 'server.js');
    this.nodePath = options.nodePath || process.execPath;
  }

  _find(command) {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(finder, [command], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? String(result.stdout || '').split(/\r?\n/).map(item => item.trim()).find(Boolean) || command : '';
  }

  packageManagers() {
    return PACKAGE_MANAGERS.filter(item => item.platforms.includes(process.platform)).map(item => {
      const executable = this._find(item.command);
      return { ...item, path: executable, installed: Boolean(executable) };
    });
  }

  wsl() {
    if (process.platform !== 'win32') return { supported: false, distributions: [] };
    const executable = this._find('wsl.exe');
    if (!executable) return { supported: false, distributions: [] };
    const result = spawnSync(executable, ['--list', '--quiet'], { encoding: 'utf16le', windowsHide: true, timeout: 10000 });
    const fallback = result.status === 0 ? result.stdout : spawnSync(executable, ['--list', '--quiet'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).stdout;
    const distributions = String(fallback || '').replace(/\0/g, '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    return { supported: true, executable, distributions };
  }

  toWslPath(windowsPath, distribution = '') {
    if (process.platform !== 'win32') return { success: false, error: 'WSL path conversion is only available on Windows' };
    const status = this.wsl();
    if (!status.supported) return { success: false, error: 'WSL is not available' };
    if (distribution && !status.distributions.includes(distribution)) return { success: false, error: 'Unknown WSL distribution' };
    const args = [...(distribution ? ['--distribution', distribution] : []), '--exec', 'wslpath', '-a', path.resolve(windowsPath)];
    const result = spawnSync(status.executable, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    return result.status === 0 ? { success: true, path: String(result.stdout).trim(), distribution: distribution || null } : { success: false, error: String(result.stderr || 'WSL path conversion failed').trim() };
  }

  systemdStatus() {
    if (process.platform !== 'linux') return { supported: false, installed: false };
    const systemctl = this._find('systemctl');
    if (!systemctl) return { supported: false, installed: false };
    const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'kitsuneserv.service');
    const envFile = path.join(os.homedir(), '.config', 'kitsuneserv', 'server.env');
    const result = spawnSync(systemctl, ['--user', 'is-active', 'kitsuneserv.service'], { encoding: 'utf8', timeout: 10000 });
    return { supported: true, installed: fs.existsSync(unit), active: result.status === 0, unit, envFile, credentialsConfigured: fs.existsSync(envFile), systemctl };
  }

  installSystemdUserService(options = {}) {
    if (process.platform !== 'linux') return { success: false, error: 'systemd integration is only available on Linux' };
    const status = this.systemdStatus();
    if (!status.supported) return { success: false, error: 'systemctl is not available' };
    const port = Number(options.port || process.env.KITSUNE_PORT || 10000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { success: false, error: 'Invalid server port' };
    fs.mkdirSync(path.dirname(status.unit), { recursive: true });
    fs.mkdirSync(path.dirname(status.envFile), { recursive: true });
    const username = String(options.username || process.env.KITSUNE_USER || 'admin');
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(username)) return { success: false, error: 'Invalid server username' };
    let generatedPassword = '';
    if (!fs.existsSync(status.envFile)) {
      const password = String(options.password || process.env.KITSUNE_PASS || crypto.randomBytes(18).toString('base64url'));
      if (!password || password.length > 512 || /[\r\n]/.test(password)) return { success: false, error: 'Invalid server password' };
      fs.writeFileSync(status.envFile, `KITSUNE_USER=${JSON.stringify(username)}\nKITSUNE_PASS=${JSON.stringify(password)}\n`, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(status.envFile, 0o600); } catch {}
      if (!options.password && !process.env.KITSUNE_PASS) generatedPassword = password;
    }
    const environment = [`KITSUNE_PORT=${port}`, `KITSUNE_HOST=${options.host || '127.0.0.1'}`, `KITSUNE_DATA_DIR=${this.appRoot}`];
    if (process.versions.electron) environment.push('ELECTRON_RUN_AS_NODE=1');
    const unit = `[Unit]\nDescription=KitsuneServ development environment manager\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${JSON.stringify(this.nodePath)} ${JSON.stringify(this.serverEntry)}\nRestart=on-failure\nRestartSec=3\nEnvironmentFile=-${JSON.stringify(status.envFile)}\n${environment.map(value => `Environment=${JSON.stringify(value)}`).join('\n')}\n\n[Install]\nWantedBy=default.target\n`;
    fs.writeFileSync(status.unit, unit, 'utf8');
    try {
      execFileSync(status.systemctl, ['--user', 'daemon-reload'], { timeout: 10000 });
      execFileSync(status.systemctl, ['--user', 'enable', '--now', 'kitsuneserv.service'], { timeout: 30000 });
      return { success: true, ...this.systemdStatus(), credentialsCreated: Boolean(generatedPassword), username, generatedPassword };
    } catch (error) { return { success: false, error: String(error.stderr || error.message).trim(), unit: status.unit }; }
  }

  removeSystemdUserService() {
    const status = this.systemdStatus();
    if (!status.supported) return { success: false, error: 'systemd user services are unavailable' };
    try { execFileSync(status.systemctl, ['--user', 'disable', '--now', 'kitsuneserv.service'], { timeout: 30000 }); } catch {}
    try { if (fs.existsSync(status.unit)) fs.unlinkSync(status.unit); } catch (error) { return { success: false, error: error.message }; }
    try { execFileSync(status.systemctl, ['--user', 'daemon-reload'], { timeout: 10000 }); } catch {}
    return { success: true, credentialsPreserved: fs.existsSync(status.envFile), envFile: status.envFile };
  }

  inventory() {
    return { platform: process.platform, arch: process.arch, release: os.release(), packageManagers: this.packageManagers(), wsl: this.wsl(), systemd: this.systemdStatus() };
  }
}

module.exports = PlatformManager;
