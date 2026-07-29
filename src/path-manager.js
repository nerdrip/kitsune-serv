'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const { SERVICE_IDS, isPathInside } = require('./path-utils');

const BIN_CANDIDATES = Object.freeze({
  apache: ['bin', 'Apache24/bin'],
  nginx: ['.'],
  caddy: ['.'],
  postgresql: ['bin', 'pgsql/bin'],
  mysql: ['bin'],
  mariadb: ['bin'],
  mongodb: ['bin'],
  php: ['.'],
  node: { win32: ['.'], other: ['bin'] },
  go: ['bin'],
  bun: ['.'],
  redis: { win32: ['.'], other: ['bin'] },
  memcached: ['.', 'bin'],
  minio: ['.'],
  python: { win32: ['.'], other: ['bin'] },
  deno: ['.']
});

const WINDOWS_READ_PATH_SCRIPT = [
  "$value = [Environment]::GetEnvironmentVariable('Path', 'User')",
  'if ($null -ne $value) { [Console]::Out.Write($value) }'
].join('; ');

const WINDOWS_READ_MACHINE_PATH_SCRIPT = [
  "$value = [Environment]::GetEnvironmentVariable('Path', 'Machine')",
  'if ($null -ne $value) { [Console]::Out.Write($value) }'
].join('; ');

const WINDOWS_WRITE_PATH_SCRIPT = [
  "$value = [Environment]::GetEnvironmentVariable('KITSUNESERV_USER_PATH_VALUE', 'Process')",
  "[Environment]::SetEnvironmentVariable('Path', $value, 'User')"
].join('; ');

const WINDOWS_WRITE_PYTHON_MANAGER_DEFAULT_SCRIPT = [
  "$value = [Environment]::GetEnvironmentVariable('KITSUNESERV_PYTHON_MANAGER_DEFAULT', 'Process')",
  "[Environment]::SetEnvironmentVariable('PYTHON_MANAGER_DEFAULT', $value, 'User')"
].join('; ');

const WINDOWS_CLEAR_PYTHON_MANAGER_DEFAULT_SCRIPT = [
  "$value = [Environment]::GetEnvironmentVariable('PYTHON_MANAGER_DEFAULT', 'User')",
  "if ($value -like 'KitsuneServ/*') { [Environment]::SetEnvironmentVariable('PYTHON_MANAGER_DEFAULT', $null, 'User') }"
].join('; ');

const PYTHON_MANAGER_APPINSTALLER = 'https://www.python.org/ftp/python/pymanager/pymanager.appinstaller';
const PYTHON_REGISTRY_ROOT = 'HKCU\\Software\\Python\\KitsuneServ';
const KITSUNESERV_REGISTRY_ROOT = 'HKCU\\Software\\KitsuneServ';

const WINDOWS_BROADCAST_SCRIPT = `
$source = @'
using System;
using System.Runtime.InteropServices;
public static class KitsuneEnvironmentBroadcast {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint flags, uint timeout, out UIntPtr result);
}
'@
Add-Type -TypeDefinition $source
$result = [UIntPtr]::Zero
[void][KitsuneEnvironmentBroadcast]::SendMessageTimeout(
  [IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
`;

function normalizeEntry(entry, platform = process.platform) {
  let normalized = path.resolve(String(entry || '').trim()).replace(/[\\/]+$/, '');
  if (platform === 'win32') normalized = normalized.replace(/\\/g, '/').toLowerCase();
  return normalized;
}

const PY_LAUNCHER_SCRIPT = `@echo off
setlocal EnableExtensions
set "KITSUNE_PY_SELECTOR="
set "KITSUNE_PY_REQUEST=%~1"
if "%~1"=="" goto run
if /I "%KITSUNE_PY_REQUEST:~0,3%"=="-V:" set "KITSUNE_PY_SELECTOR=%KITSUNE_PY_REQUEST:~3%"
if defined KITSUNE_PY_SELECTOR goto versioned

:run
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0kitsune-py-launcher.ps1" %*
exit /b %ERRORLEVEL%

:versioned
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0kitsune-py-launcher.ps1" %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
`;

const PY_LAUNCHER_POWERSHELL_SCRIPT = `$LauncherArguments = @($args)

$runtimeRoot = Split-Path -Parent $PSScriptRoot
$runtimes = @(Get-ChildItem -LiteralPath $runtimeRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'python.exe') } |
  Sort-Object -Property @{ Expression = {
    try { [version]$_.Name } catch { [version]'0.0' }
  }} -Descending)

$request = if ($LauncherArguments.Count) { $LauncherArguments[0] } else { '' }
$listPaths = $request -in @('--list-paths', '-0p')
if ($request -in @('--list', '--list-paths', '-0', '-0p')) {
  Write-Output 'Installed KitsuneServ Python runtimes:'
  foreach ($runtime in $runtimes) {
    $executable = Join-Path $runtime.FullName 'python.exe'
    if ($listPaths) { Write-Output (' -V:{0,-12} {1}' -f $runtime.Name, $executable) }
    else { Write-Output (' -V:{0}' -f $runtime.Name) }
  }
  exit 0
}

$tag = $null
if ($env:KITSUNE_PY_SELECTOR) {
  $tag = $env:KITSUNE_PY_SELECTOR
  $remainingArguments = $LauncherArguments
}
elseif ($request -match '^-V:(.+)$') { $tag = $Matches[1] }
elseif ($request -match '^-(3(?:\\.\\d+)*)$') { $tag = $Matches[1] }

$python = Join-Path $PSScriptRoot 'python.exe'
if ($null -eq $remainingArguments) { $remainingArguments = $LauncherArguments }
if ($tag) {
  $runtime = $runtimes | Where-Object {
    $_.Name -eq $tag -or $_.Name.StartsWith("$tag.", [System.StringComparison]::OrdinalIgnoreCase)
  } | Select-Object -First 1
  if (-not $runtime) {
    [Console]::Error.WriteLine("[KitsuneServ] Python $tag is not installed.")
    exit 103
  }
  $python = Join-Path $runtime.FullName 'python.exe'
  if (-not $env:KITSUNE_PY_SELECTOR) {
    $remainingArguments = @($LauncherArguments | Select-Object -Skip 1)
  }
}

if (-not (Test-Path -LiteralPath $python)) {
  [Console]::Error.WriteLine('[KitsuneServ] The active Python runtime is unavailable.')
  exit 103
}

& $python @remainingArguments
exit $LASTEXITCODE
`;

const PYTHON3_LAUNCHER_SCRIPT = `@echo off
"%~dp0python.exe" %*
exit /b %ERRORLEVEL%
`;

class PathManager {
  constructor(downloadManager, configManager, options = {}) {
    this.downloadManager = downloadManager;
    this.configManager = configManager;
    this.platform = options.platform || process.platform;
    this.env = options.env || process.env;
    this.systemIntegrationDisabled = Boolean(options.systemIntegrationDisabled);
    this._readUserPathOverride = options.readUserPath;
    this._readMachinePathOverride = options.readMachinePath;
    this._writeUserPathOverride = options.writeUserPath;
    this._broadcastOverride = options.broadcast;
    this._registerPythonRuntimesOverride = options.registerPythonRuntimes;
    this._setPythonManagerDefaultOverride = options.setPythonManagerDefault;
    this._installPythonManagerOverride = options.installPythonManager;
    this._uninstallPythonManagerOverride = options.uninstallPythonManager;
    this._readPythonManagerOwnershipOverride = options.readPythonManagerOwnership;
    this._writePythonManagerOwnershipOverride = options.writePythonManagerOwnership;
    this._pythonIntegrationSignature = '';
    this._pythonManagerInstallPromise = null;
    this._pythonManagerLastError = '';
  }

  _candidateList(section) {
    const candidates = BIN_CANDIDATES[section] || ['.'];
    if (Array.isArray(candidates)) return candidates;
    return this.platform === 'win32' ? candidates.win32 : candidates.other;
  }

  getEntries(serviceIds = SERVICE_IDS) {
    const config = this.configManager.getConfig();
    const entries = [];
    const seen = new Set();
    const selected = new Set(Array.isArray(serviceIds) ? serviceIds : SERVICE_IDS);
    for (const section of SERVICE_IDS) {
      if (!selected.has(section)) continue;
      const profile = this.configManager.getActiveProfile(config, section);
      if (!profile || !this.downloadManager.isInstalled(section, profile.version)) continue;
      const installPath = this.downloadManager.getInstallPath(section, profile.version);
      for (const relative of this._candidateList(section)) {
        const candidate = path.resolve(installPath, relative);
        try {
          if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) continue;
        } catch { continue; }
        const key = normalizeEntry(candidate, this.platform);
        if (!seen.has(key)) {
          seen.add(key);
          entries.push(candidate);
        }
      }
    }
    return entries;
  }

  isManagedEntry(entry) {
    if (typeof entry !== 'string' || !entry.trim()) return false;
    try { return isPathInside(this.downloadManager.dataDir, path.resolve(entry.trim())); }
    catch { return false; }
  }

  split(value) {
    const separator = this.platform === 'win32' ? ';' : ':';
    return String(value || '').split(separator).map(entry => entry.trim()).filter(Boolean);
  }

  stripManaged(value) {
    return this.split(value).filter(entry => !this.isManagedEntry(entry));
  }

  merge(value) {
    const separator = this.platform === 'win32' ? ';' : ':';
    return [...this.getEntries(this.getSelectedServices()), ...this.stripManaged(value)].join(separator);
  }

  hasManagedEntries(value = this.readUserPath()) {
    return this.split(value).some(entry => this.isManagedEntry(entry));
  }

  _ensureSelectionInitialized() {
    const config = this.configManager.getConfig();
    if (config.general?.pathSelectionInitialized === true) return config;
    const inferred = [];
    if (this.platform === 'win32') {
      let current = '';
      try { current = this.readUserPath(); }
      catch { return config; }
      const currentParts = this.split(current);
      const currentSet = new Set(currentParts.map(entry => normalizeEntry(entry, this.platform)));
      for (const section of SERVICE_IDS) {
        const serviceRoot = path.join(this.downloadManager.dataDir, section);
        const hasCurrentEntry = this.getEntries([section]).some(entry => currentSet.has(normalizeEntry(entry, this.platform)));
        const hasPreviousVersionEntry = currentParts.some(entry => {
          try { return isPathInside(serviceRoot, path.resolve(entry)); } catch { return false; }
        });
        if (hasCurrentEntry || hasPreviousVersionEntry) inferred.push(section);
      }
    }
    config.general = { ...(config.general || {}), pathServices: inferred, pathSelectionInitialized: true };
    this.configManager.saveConfig(config);
    return config;
  }

  getSelectedServices() {
    const config = this._ensureSelectionInitialized();
    const selected = Array.isArray(config.general?.pathServices) ? config.general.pathServices : [];
    return SERVICE_IDS.filter(section => selected.includes(section));
  }

  _saveSelection(serviceIds) {
    const selected = SERVICE_IDS.filter(section => serviceIds.includes(section));
    const config = this.configManager.getConfig();
    config.general = { ...(config.general || {}), pathServices: selected, pathSelectionInitialized: true };
    const result = this.configManager.saveConfig(config);
    if (!result.success) throw new Error(result.error || 'Could not save PATH selection');
    return selected;
  }

  readUserPath() {
    if (this._readUserPathOverride) return String(this._readUserPathOverride() || '');
    if (this.platform !== 'win32') return '';
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ_PATH_SCRIPT], {
      encoding: 'utf8', windowsHide: true
    });
  }

  readMachinePath() {
    if (this._readMachinePathOverride) return String(this._readMachinePathOverride() || '');
    if (this.platform !== 'win32') return '';
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ_MACHINE_PATH_SCRIPT], {
      encoding: 'utf8', windowsHide: true
    });
  }

  _officialPythonManagerStatus() {
    const result = { installed: false, path: '', target: '' };
    if (this.platform !== 'win32' || !this.env.LOCALAPPDATA) return result;
    const managerPath = path.join(this.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'pymanager.exe');
    try {
      fs.lstatSync(managerPath);
      let target = '';
      try { target = fs.readlinkSync(managerPath); } catch {}
      if (target && !/PythonSoftwareFoundation\.PythonManager/i.test(target)) return result;
      return { installed: true, path: managerPath, target };
    } catch { return result; }
  }

  isOfficialPythonManagerInstalled() {
    return this._officialPythonManagerStatus().installed;
  }

  _ownsOfficialPythonManager() {
    if (this._readPythonManagerOwnershipOverride) return Boolean(this._readPythonManagerOwnershipOverride());
    if (this.platform !== 'win32') return false;
    try {
      const output = execFileSync('reg.exe', ['query', KITSUNESERV_REGISTRY_ROOT, '/v', 'PythonManagerOwned'], {
        encoding: 'utf8', windowsHide: true
      });
      return /PythonManagerOwned\s+REG_DWORD\s+0x1/i.test(output);
    } catch { return false; }
  }

  _setOfficialPythonManagerOwnership(owned) {
    if (this._writePythonManagerOwnershipOverride) {
      this._writePythonManagerOwnershipOverride(Boolean(owned));
      return;
    }
    if (this.platform !== 'win32') return;
    try {
      if (owned) {
        execFileSync('reg.exe', ['add', KITSUNESERV_REGISTRY_ROOT, '/v', 'PythonManagerOwned', '/t', 'REG_DWORD', '/d', '1', '/f'], {
          encoding: 'utf8', windowsHide: true
        });
      } else {
        execFileSync('reg.exe', ['delete', KITSUNESERV_REGISTRY_ROOT, '/v', 'PythonManagerOwned', '/f'], {
          encoding: 'utf8', windowsHide: true
        });
      }
    } catch (err) {
      if (owned) throw err;
    }
  }

  _isOfficialPythonManagerAlias(file) {
    try {
      const target = fs.readlinkSync(file);
      return /PythonSoftwareFoundation\.PythonManager/i.test(target);
    } catch { return false; }
  }

  _removeGeneratedPythonLaunchers(installPath) {
    const generated = [
      [path.join(installPath, 'py.cmd'), 'kitsune-py-launcher.ps1'],
      [path.join(installPath, 'kitsune-py-launcher.ps1'), 'Installed KitsuneServ Python runtimes:'],
      [path.join(installPath, 'py.ps1'), 'Installed KitsuneServ Python runtimes:']
    ];
    for (const [file, marker] of generated) {
      try {
        if (fs.readFileSync(file, 'utf8').includes(marker)) fs.unlinkSync(file);
      } catch {}
    }
  }

  _setPythonManagerDefault(version) {
    const value = `KitsuneServ/${version}`;
    if (this._setPythonManagerDefaultOverride) {
      if (this._setPythonManagerDefaultOverride(value) === false) throw new Error('Could not set Python manager default');
    } else {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WRITE_PYTHON_MANAGER_DEFAULT_SCRIPT], {
        encoding: 'utf8', windowsHide: true,
        env: { ...process.env, KITSUNESERV_PYTHON_MANAGER_DEFAULT: value }
      });
    }
    this.env.PYTHON_MANAGER_DEFAULT = value;
    return value;
  }

  _registerPythonRuntimes(activeVersion) {
    const versions = this.downloadManager.getInstalledVersions('python')
      .filter(version => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version))
      .filter(version => fs.existsSync(path.join(this.downloadManager.getInstallPath('python', version), 'python.exe')));
    const signature = `${versions.slice().sort().join('|')}::${activeVersion || ''}`;
    if (signature === this._pythonIntegrationSignature) {
      return {
        versions,
        defaultTag: activeVersion ? `KitsuneServ/${activeVersion}` : ''
      };
    }
    if (this._registerPythonRuntimesOverride) {
      const overrideResult = this._registerPythonRuntimesOverride(versions, activeVersion);
      if (overrideResult === false) throw new Error('Could not register KitsuneServ Python runtimes');
    } else {
      const regAdd = (key, name, value) => {
        const args = ['add', key, name === null ? '/ve' : '/v', name === null ? '' : name, '/t', 'REG_SZ', '/d', value, '/f']
          .filter((argument, index, all) => !(argument === '' && all[index - 1] === '/ve'));
        execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
      };
      regAdd(PYTHON_REGISTRY_ROOT, 'DisplayName', 'KitsuneServ');
      for (const version of versions) {
        const installPath = this.downloadManager.getInstallPath('python', version);
        const tagKey = `${PYTHON_REGISTRY_ROOT}\\${version}`;
        const installKey = `${tagKey}\\InstallPath`;
        const sysVersion = version.match(/^\d+\.\d+(?:\.\d+)?/)?.[0] || version;
        regAdd(tagKey, 'DisplayName', `KitsuneServ Python ${version}`);
        regAdd(tagKey, 'Version', version);
        regAdd(tagKey, 'SysVersion', sysVersion);
        regAdd(tagKey, 'SysArchitecture', process.arch === 'ia32' ? '32bit' : '64bit');
        regAdd(installKey, null, installPath);
        regAdd(installKey, 'ExecutablePath', path.join(installPath, 'python.exe'));
        const pythonw = path.join(installPath, 'pythonw.exe');
        if (fs.existsSync(pythonw)) regAdd(installKey, 'WindowedExecutablePath', pythonw);
      }
      try {
        const output = execFileSync('reg.exe', ['query', PYTHON_REGISTRY_ROOT], { encoding: 'utf8', windowsHide: true });
        const installed = new Set(versions.map(version => version.toLowerCase()));
        for (const line of output.split(/\r?\n/)) {
          const match = line.trim().match(/^HKEY_CURRENT_USER\\Software\\Python\\KitsuneServ\\([^\\]+)$/i);
          if (match && !installed.has(match[1].toLowerCase())) {
            execFileSync('reg.exe', ['delete', `${PYTHON_REGISTRY_ROOT}\\${match[1]}`, '/f'], { encoding: 'utf8', windowsHide: true });
          }
        }
      } catch {}
    }
    const defaultTag = activeVersion && this.downloadManager.isInstalled('python', String(activeVersion))
      ? this._setPythonManagerDefault(String(activeVersion))
      : '';
    this._pythonIntegrationSignature = signature;
    return { versions, defaultTag };
  }

  installOfficialPythonManager() {
    if (this.systemIntegrationDisabled) return Promise.resolve({ success: false, error: 'System integration is disabled for this application run' });
    if (this._pythonManagerInstallPromise) return this._pythonManagerInstallPromise;
    const wasInstalled = this._officialPythonManagerStatus().installed;
    this._pythonManagerLastError = '';
    this._pythonManagerInstallPromise = this._performOfficialPythonManagerInstall()
      .then(result => {
        if (!result?.success) {
          this._pythonManagerLastError = result?.error || 'Python Install Manager installation failed';
        } else if (!wasInstalled) {
          this._setOfficialPythonManagerOwnership(true);
        }
        return result;
      })
      .catch(err => {
        const error = err?.message || String(err);
        this._pythonManagerLastError = error;
        return { success: false, error };
      })
      .finally(() => { this._pythonManagerInstallPromise = null; });
    return this._pythonManagerInstallPromise;
  }

  _clearPythonManagerIntegration() {
    this._pythonIntegrationSignature = '';
    if (this._registerPythonRuntimesOverride) {
      this._registerPythonRuntimesOverride([], null);
    } else if (this.platform === 'win32') {
      try {
        execFileSync('reg.exe', ['delete', PYTHON_REGISTRY_ROOT, '/f'], { encoding: 'utf8', windowsHide: true });
      } catch {}
    }
    if (this._setPythonManagerDefaultOverride) {
      this._setPythonManagerDefaultOverride('');
    } else if (this.platform === 'win32') {
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_CLEAR_PYTHON_MANAGER_DEFAULT_SCRIPT], {
          encoding: 'utf8', windowsHide: true
        });
      } catch {}
    }
    if (String(this.env.PYTHON_MANAGER_DEFAULT || '').startsWith('KitsuneServ/')) delete this.env.PYTHON_MANAGER_DEFAULT;
  }

  uninstallOfficialPythonManagerIfUnused() {
    if (this.systemIntegrationDisabled) return Promise.resolve({ success: true, skipped: true, reason: 'system-integration-disabled' });
    if (this.platform !== 'win32') return Promise.resolve({ success: true, skipped: true, reason: 'not-windows' });
    if (this.downloadManager.getInstalledVersions('python').length > 0) {
      return Promise.resolve({ success: true, skipped: true, reason: 'python-runtimes-remain' });
    }
    this._clearPythonManagerIntegration();
    if (!this._officialPythonManagerStatus().installed) {
      this._setOfficialPythonManagerOwnership(false);
      return Promise.resolve({ success: true, skipped: true, reason: 'manager-not-installed' });
    }
    if (!this._ownsOfficialPythonManager()) {
      return Promise.resolve({ success: true, skipped: true, reason: 'manager-not-owned' });
    }
    const uninstall = this._uninstallPythonManagerOverride
      ? Promise.resolve(this._uninstallPythonManagerOverride())
      : new Promise(resolve => {
        const command = "Get-AppxPackage -Name 'PythonSoftwareFoundation.PythonManager' | Remove-AppxPackage -ErrorAction Stop";
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
          encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024
        }, (error, stdout, stderr) => {
          if (error) resolve({ success: false, error: String(stderr || stdout || error.message).trim() });
          else resolve({ success: true });
        });
      });
    return uninstall.then(result => {
      if (result === false || result?.success === false) return result || { success: false, error: 'Python Install Manager removal failed' };
      this._setOfficialPythonManagerOwnership(false);
      this._broadcastWindowsChange();
      return { success: true, removed: true };
    }).catch(err => ({ success: false, error: err?.message || String(err) }));
  }

  _performOfficialPythonManagerInstall() {
    if (this.platform !== 'win32') return Promise.resolve({ success: false, error: 'Python Install Manager is available on Windows only' });
    if (this._officialPythonManagerStatus().installed) {
      const python = this._ensurePythonLaunchers();
      return Promise.resolve({ success: true, alreadyInstalled: true, python });
    }
    if (this._installPythonManagerOverride) {
      return Promise.resolve(this._installPythonManagerOverride()).then(result => {
        if (result === false || result?.success === false) return result || { success: false, error: 'Installation failed' };
        return { success: true, python: this._ensurePythonLaunchers() };
      });
    }
    return new Promise(resolve => {
      const command = `Add-AppxPackage -AppInstallerFile '${PYTHON_MANAGER_APPINSTALLER}'`;
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 4 * 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) return resolve({ success: false, error: String(stderr || stdout || error.message).trim() });
        const manager = this._officialPythonManagerStatus();
        if (!manager.installed) return resolve({ success: false, error: 'Python Install Manager finished installing, but its command alias is unavailable' });
        try {
          const python = this._ensurePythonLaunchers();
          this._broadcastWindowsChange();
          resolve({ success: true, python });
        } catch (err) { resolve({ success: false, error: err.message }); }
      });
    });
  }

  _ensurePythonLaunchers() {
    const manager = this._officialPythonManagerStatus();
    const result = {
      available: false, version: '', path: '', python3Path: '',
      managerInstalled: manager.installed, managerPath: manager.path,
      launcherKind: manager.installed ? 'official' : 'fallback'
    };
    if (this.platform !== 'win32' || this.systemIntegrationDisabled) return result;
    try {
      const config = this.configManager.getConfig();
      const profile = this.configManager.getActiveProfile(config, 'python');
      const activeVersion = profile && this.downloadManager.isInstalled('python', profile.version)
        ? String(profile.version)
        : '';
      if (manager.installed) {
        const registration = this._registerPythonRuntimes(activeVersion || null);
        for (const version of this.downloadManager.getInstalledVersions('python')) {
          this._removeGeneratedPythonLaunchers(this.downloadManager.getInstallPath('python', version));
        }
        let python3Path = '';
        if (activeVersion) {
          const installPath = this.downloadManager.getInstallPath('python', activeVersion);
          python3Path = path.join(installPath, 'python3.cmd');
          let current = '';
          try { current = fs.readFileSync(python3Path, 'utf8'); } catch {}
          if (current !== PYTHON3_LAUNCHER_SCRIPT) fs.writeFileSync(python3Path, PYTHON3_LAUNCHER_SCRIPT, 'utf8');
        }
        return {
          ...result, available: registration.versions.length > 0,
          version: activeVersion || registration.versions[0] || '',
          path: path.join(this.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'py.exe'),
          python3Path, registeredVersions: registration.versions,
          defaultTag: registration.defaultTag
        };
      }
      if (!profile || !this.downloadManager.isInstalled('python', profile.version)) return result;
      const installPath = this.downloadManager.getInstallPath('python', profile.version);
      const pythonExe = path.join(installPath, 'python.exe');
      if (!fs.existsSync(pythonExe)) return result;
      const python3Path = path.join(installPath, 'python3.cmd');
      let python3Current = '';
      try { python3Current = fs.readFileSync(python3Path, 'utf8'); } catch {}
      if (python3Current !== PYTHON3_LAUNCHER_SCRIPT) fs.writeFileSync(python3Path, PYTHON3_LAUNCHER_SCRIPT, 'utf8');
      const launchers = [
        [path.join(installPath, 'py.cmd'), PY_LAUNCHER_SCRIPT],
        [path.join(installPath, 'kitsune-py-launcher.ps1'), PY_LAUNCHER_POWERSHELL_SCRIPT],
        [python3Path, PYTHON3_LAUNCHER_SCRIPT]
      ];
      const legacyLauncher = path.join(installPath, 'py.ps1');
      try {
        const legacyContent = fs.readFileSync(legacyLauncher, 'utf8');
        if (legacyContent.includes('Installed KitsuneServ Python runtimes:')) fs.unlinkSync(legacyLauncher);
      } catch {}
      for (const [file, content] of launchers) {
        let current = '';
        try { current = fs.readFileSync(file, 'utf8'); } catch {}
        if (current !== content) fs.writeFileSync(file, content, 'utf8');
      }
      return {
        available: true,
        version: String(profile.version),
        path: launchers[0][0],
        python3Path: launchers[2][0]
      };
    } catch (err) {
      return { ...result, error: err.message };
    }
  }

  _pythonAliasStatus(selected, launcher) {
    const status = {
      selected: selected.includes('python'),
      launcherAvailable: Boolean(launcher?.available),
      launcherPath: launcher?.path || '',
      launcherKind: launcher?.launcherKind || 'fallback',
      managerInstalled: Boolean(launcher?.managerInstalled),
      managerInstallInProgress: Boolean(this._pythonManagerInstallPromise),
      managerPath: launcher?.managerPath || '',
      defaultTag: launcher?.defaultTag || '',
      registeredVersions: launcher?.registeredVersions || [],
      integrationError: launcher?.error || this._pythonManagerLastError || '',
      version: launcher?.version || '',
      storeAliasConflict: false,
      storeAliases: []
    };
    if (this.platform !== 'win32' || !status.selected) return status;
    try {
      const localAppData = this.env.LOCALAPPDATA;
      if (!localAppData) return status;
      const windowsApps = path.join(localAppData, 'Microsoft', 'WindowsApps');
      status.storeAliases = ['python.exe', 'python3.exe']
        .map(name => path.join(windowsApps, name))
        // App Execution Aliases are special reparse points. existsSync() can
        // report false for them even though Windows resolves the command.
        .filter(file => {
          try { fs.lstatSync(file); return !this._isOfficialPythonManagerAlias(file); }
          catch { return false; }
        });
      const machineEntries = new Set(this.split(this.readMachinePath()).map(entry => normalizeEntry(entry, this.platform)));
      status.storeAliasConflict = status.storeAliases.length > 0
        && machineEntries.has(normalizeEntry(windowsApps, this.platform));
    } catch (err) {
      status.detectionError = err.message;
    }
    return status;
  }

  _broadcastWindowsChange() {
    try {
      if (this._broadcastOverride) this._broadcastOverride();
      else execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_BROADCAST_SCRIPT], {
        encoding: 'utf8', windowsHide: true, timeout: 10000
      });
      return true;
    } catch { return false; }
  }

  writeUserPath(value) {
    if (this._writeUserPathOverride) {
      return this._writeUserPathOverride(value) !== false;
    }
    if (this.platform !== 'win32') throw new Error('Windows PATH writer used on another platform');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WRITE_PATH_SCRIPT], {
      encoding: 'utf8', windowsHide: true,
      env: { ...process.env, KITSUNESERV_USER_PATH_VALUE: value }
    });
    return this._broadcastWindowsChange();
  }

  getStatus() {
    const selected = this.getSelectedServices();
    const pythonLauncher = this._ensurePythonLaunchers();
    const entries = this.getEntries(selected);
    const config = this.configManager.getConfig();
    const services = SERVICE_IDS.map(section => {
      const profile = this.configManager.getActiveProfile(config, section);
      const installed = Boolean(profile && this.downloadManager.isInstalled(section, profile.version));
      const serviceEntries = this.getEntries([section]);
      return {
        id: section,
        selected: selected.includes(section),
        installed,
        pathAvailable: serviceEntries.length > 0,
        version: profile?.version || '',
        entries: serviceEntries
      };
    });
    if (this.platform !== 'win32') {
      const shellRc = this._getShellRcPath();
      const added = Boolean(shellRc && fs.existsSync(shellRc) && fs.readFileSync(shellRc, 'utf8').includes('# KitsuneServ PATH'));
      return { added, enabled: selected.length > 0, entries, selected, services, integrationDisabled: this.systemIntegrationDisabled, python: this._pythonAliasStatus(selected, pythonLauncher) };
    }
    const current = this.readUserPath();
    const currentParts = this.split(current);
    const currentSet = new Set(currentParts.map(entry => normalizeEntry(entry, this.platform)));
    const activeSet = new Set(entries.map(entry => normalizeEntry(entry, this.platform)));
    const managedParts = currentParts.filter(entry => this.isManagedEntry(entry));
    const hasAllActive = entries.length > 0 && [...activeSet].every(entry => currentSet.has(entry));
    const hasOnlyActiveManaged = managedParts.every(entry => activeSet.has(normalizeEntry(entry, this.platform)));
    const synced = (entries.length === 0 ? managedParts.length === 0 : hasAllActive && hasOnlyActiveManaged);
    return { added: selected.length > 0 && synced, enabled: selected.length > 0, synced, entries, selected, services, integrationDisabled: this.systemIntegrationDisabled, python: this._pythonAliasStatus(selected, pythonLauncher) };
  }

  apply(serviceIds) {
    try {
      if (this.systemIntegrationDisabled) return { success: false, error: 'System PATH integration is disabled for this application run' };
      if (!Array.isArray(serviceIds) || serviceIds.some(section => !SERVICE_IDS.includes(section))) {
        return { success: false, error: 'Invalid PATH service selection' };
      }
      const selected = this._saveSelection([...new Set(serviceIds)]);
      return this.sync(selected);
    } catch (err) { return { success: false, error: err.message }; }
  }

  add(serviceIds = SERVICE_IDS) {
    if (!Array.isArray(serviceIds) || serviceIds.some(section => !SERVICE_IDS.includes(section))) {
      return { success: false, error: 'Invalid PATH service selection' };
    }
    return this.apply([...new Set([...this.getSelectedServices(), ...serviceIds])]);
  }

  sync(selected = this.getSelectedServices()) {
    try {
      if (this.systemIntegrationDisabled) return { success: true, skipped: true, reason: 'system-integration-disabled', selected, entries: this.getEntries(selected) };
      const pythonLauncher = this._ensurePythonLaunchers();
      const entries = this.getEntries(selected);
      if (this.platform === 'win32') {
        const separator = ';';
        const newPath = [...entries, ...this.stripManaged(this.readUserPath())].join(separator);
        const broadcast = this.writeUserPath(newPath);
        this.env.PATH = [...entries, ...this.stripManaged(this.env.PATH || '')].join(separator);
        return {
          success: true, entries, selected, broadcast,
          warning: broadcast ? undefined : 'PATH was saved, but Windows could not broadcast the environment change. Reopen Explorer or sign out to refresh inherited environments.',
          pending: selected.filter(section => this.getEntries([section]).length === 0),
          python: this._pythonAliasStatus(selected, pythonLauncher)
        };
      }
      const shellRc = this._getShellRcPath();
      if (!shellRc) return { success: false, error: 'Could not determine shell config file' };
      let content = fs.existsSync(shellRc) ? fs.readFileSync(shellRc, 'utf8') : '';
      content = this._removeShellBlock(content);
      if (selected.length) {
        const quoted = entries.map(entry => `'${entry.replace(/'/g, `'"'"'`)}'`).join(':');
        content += `\n# KitsuneServ PATH - START\nexport PATH=${quoted}${quoted ? ':' : ''}$PATH\n# KitsuneServ PATH - END\n`;
      }
      fs.writeFileSync(shellRc, content, 'utf8');
      this.env.PATH = [...entries, ...this.stripManaged(this.env.PATH || '')].join(':');
      return { success: true, entries, selected, pending: selected.filter(section => this.getEntries([section]).length === 0) };
    } catch (err) { return { success: false, error: err.message }; }
  }

  remove(serviceIds) {
    if (serviceIds !== undefined && (!Array.isArray(serviceIds) || serviceIds.some(section => !SERVICE_IDS.includes(section)))) {
      return { success: false, error: 'Invalid PATH service selection' };
    }
    const removing = serviceIds === undefined ? SERVICE_IDS : serviceIds;
    return this.apply(this.getSelectedServices().filter(section => !removing.includes(section)));
  }

  syncIfSelected(section) {
    const selected = this.getSelectedServices();
    if (section === 'python' && !selected.includes(section)) this._ensurePythonLaunchers();
    return selected.includes(section) ? this.sync(selected) : { success: true, skipped: true, selected };
  }

  syncForConfigTransition(previous, current) {
    const selected = SERVICE_IDS.filter(section => current?.general?.pathServices?.includes(section));
    const previousSelected = SERVICE_IDS.filter(section => previous?.general?.pathServices?.includes(section));
    const pythonVersionChanged = this.configManager.getActiveProfile(previous, 'python')?.version
      !== this.configManager.getActiveProfile(current, 'python')?.version;
    if (pythonVersionChanged) this._ensurePythonLaunchers();
    const selectionChanged = selected.join('|') !== previousSelected.join('|');
    const activeVersionChanged = SERVICE_IDS.some(section => {
      if (!selected.includes(section) && !previousSelected.includes(section)) return false;
      return this.configManager.getActiveProfile(previous, section)?.version
        !== this.configManager.getActiveProfile(current, section)?.version;
    });
    return selectionChanged || activeVersionChanged
      ? this.sync(selected)
      : { success: true, skipped: true, selected };
  }

  buildEnvironment(baseEnvironment = process.env) {
    this._ensurePythonLaunchers();
    const env = { ...baseEnvironment };
    if (this.env.PYTHON_MANAGER_DEFAULT) env.PYTHON_MANAGER_DEFAULT = this.env.PYTHON_MANAGER_DEFAULT;
    const separator = this.platform === 'win32' ? ';' : ':';
    // The built-in terminal intentionally exposes every installed active
    // runtime, independently from the optional Windows user PATH selection.
    const active = this.getEntries(SERVICE_IDS);
    env.PATH = [...active, ...this.stripManaged(env.PATH || '')].join(separator);
    return env;
  }

  _getShellRcPath() {
    if (this.env.KITSUNE_SHELL_RC) return path.resolve(this.env.KITSUNE_SHELL_RC);
    const home = this.env.HOME || '';
    if (!home) return null;
    const shell = this.env.SHELL || '';
    if (shell.includes('zsh')) return path.join(home, '.zshrc');
    return path.join(home, '.bashrc');
  }

  _removeShellBlock(content) {
    return content.replace(/\n?# KitsuneServ PATH - START[\s\S]*?# KitsuneServ PATH - END\n?/g, '\n');
  }
}

module.exports = { PathManager, BIN_CANDIDATES, normalizeEntry };
