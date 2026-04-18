const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

// Support both Electron and standalone Node.js (server mode)
let electronApp = null;
try { electronApp = require('electron').app; } catch {}

class DownloadManager {
  constructor(appRootOverride) {
    if (appRootOverride) {
      this.appRoot = appRootOverride;
    } else if (electronApp) {
      this.appRoot = electronApp.isPackaged ? path.dirname(process.execPath) : electronApp.getAppPath();
    } else {
      this.appRoot = process.cwd();
    }
    this.dataDir = path.join(this.appRoot, 'servers');
    this.tempDir = path.join(this.appRoot, 'temp');
    this._ensureDir(this.dataDir);
    this._ensureDir(this.tempDir);
    this.activeDownloads = new Map();
    this.downloadUrls = this._loadDownloadUrls();
    this.maxRetries = 3;
    this._platform = process.platform === 'win32' ? 'win' : 'linux';
  }

  _loadDownloadUrls() {
    const jsonPath = path.join(this.appRoot, 'config', 'downloads.json');
    try {
      if (fs.existsSync(jsonPath)) {
        return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      }
    } catch { }
    return {};
  }

  reloadUrls() {
    this.downloadUrls = this._loadDownloadUrls();
  }

  getVersionMap() {
    const map = {};
    for (const [service, versions] of Object.entries(this.downloadUrls)) {
      const available = [];
      for (const [ver, urlData] of Object.entries(versions)) {
        const url = this._resolveUrl(urlData);
        if (url) available.push(ver);
      }
      if (available.length) map[service] = available;
    }
    return map;
  }

  // Resolve URL from either new {win,linux} object or legacy plain string
  _resolveUrl(urlData) {
    if (!urlData) return null;
    if (typeof urlData === 'string') return urlData;
    return urlData[this._platform] || null;
  }

  getAppRoot() {
    return this.appRoot;
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getInstallPath(service, version) {
    return path.join(this.dataDir, service, version);
  }

  isInstalled(service, version) {
    const installPath = this.getInstallPath(service, version);
    return fs.existsSync(installPath) && fs.readdirSync(installPath).length > 0;
  }

  getInstalledVersions(service) {
    const serviceDir = path.join(this.dataDir, service);
    if (!fs.existsSync(serviceDir)) return [];
    return fs.readdirSync(serviceDir).filter(v => {
      const vPath = path.join(serviceDir, v);
      return fs.statSync(vPath).isDirectory() && fs.readdirSync(vPath).length > 0;
    });
  }

  getDownloadUrl(service, version) {
    const urlData = this.downloadUrls[service]?.[version];
    return this._resolveUrl(urlData);
  }

  async download(service, version, onProgress) {
    const key = `${service}-${version}`;
    if (this.activeDownloads.has(key)) {
      return { success: false, error: 'Download already in progress' };
    }

    const url = this.getDownloadUrl(service, version);
    if (!url) {
      return { success: false, error: `No download URL for ${service} ${version}` };
    }

    const installPath = this.getInstallPath(service, version);
    if (this.isInstalled(service, version)) {
      return { success: true, path: installPath, alreadyInstalled: true };
    }

    this._ensureDir(installPath);
    // Derive temp file extension from actual URL
    const ext = this._urlExtension(url);
    const zipPath = path.join(this.tempDir, `${service}-${version}${ext}`);

    this.activeDownloads.set(key, true);

    try {
      if (onProgress) onProgress({ stage: 'downloading', percent: 0, service, version });

      // Retry download with exponential backoff
      let lastErr;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          await this._downloadFile(url, zipPath, (percent) => {
            if (onProgress) onProgress({ stage: 'downloading', percent, service, version });
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < this.maxRetries) {
            const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
            if (onProgress) onProgress({ stage: 'retrying', percent: 0, service, version, attempt, maxRetries: this.maxRetries });
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      if (lastErr) throw lastErr;

      if (onProgress) onProgress({ stage: 'extracting', percent: 100, service, version });

      // If URL points to a single binary (not an archive), move it directly
      if (url.endsWith('.exe') || (!ext || ext === '')) {
        const exeName = path.basename(new URL(url).pathname);
        const destFile = path.join(installPath, exeName);
        fs.renameSync(zipPath, destFile);
        // Make executable on Linux
        if (this._platform !== 'win') {
          fs.chmodSync(destFile, 0o755);
        }
      } else {
        await this._extractZip(zipPath, installPath);
        // Make binaries executable on Linux
        if (this._platform !== 'win') this._chmodBinaries(installPath);
      }

      // Clean up temp zip
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

      if (onProgress) onProgress({ stage: 'done', percent: 100, service, version });
      return { success: true, path: installPath };
    } catch (err) {
      // Clean up on failure
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(installPath)) {
        fs.rmSync(installPath, { recursive: true, force: true });
      }
      return { success: false, error: err.message };
    } finally {
      this.activeDownloads.delete(key);
    }
  }

  _downloadFile(url, dest, onProgress, redirectCount = 0) {
    if (redirectCount > 5) {
      return Promise.reject(new Error('Too many redirects'));
    }
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.get(url, { headers: { 'User-Agent': 'KitsuneServ/1.0' } }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const parsed = new URL(url);
            redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
          }
          res.resume();
          return this._downloadFile(redirectUrl, dest, onProgress, redirectCount + 1).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastProgressTime = 0;
        const file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalSize > 0 && onProgress) {
            const now = Date.now();
            if (now - lastProgressTime >= 200 || downloaded >= totalSize) {
              lastProgressTime = now;
              onProgress(Math.round((downloaded / totalSize) * 100));
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });
    });
  }

  _extractZip(zipPath, destPath) {
    return new Promise((resolve, reject) => {
      // Use tar (available on Linux natively, on Windows since Win10 1803)
      let args;
      if (zipPath.endsWith('.tar.gz') || zipPath.endsWith('.tgz')) {
        args = ['-xzf', zipPath, '-C', destPath];
      } else if (zipPath.endsWith('.tar.xz')) {
        args = ['-xJf', zipPath, '-C', destPath];
      } else {
        args = ['-xf', zipPath, '-C', destPath];
      }
      execFile('tar', args, { timeout: 600000 }, (err) => {
        if (err) return reject(new Error(`Extract failed: ${err.message}`));

        // Flatten if archive contains single root folder
        this._flattenSingleDir(destPath);
        resolve();
      });
    });
  }

  // Derive archive extension from URL (.zip, .tar.gz, .tar.xz, .tgz, .exe, etc.)
  _urlExtension(url) {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('.tar.gz'))  return '.tar.gz';
    if (pathname.endsWith('.tar.xz'))  return '.tar.xz';
    if (pathname.endsWith('.tgz'))     return '.tgz';
    if (pathname.endsWith('.zip'))     return '.zip';
    if (pathname.endsWith('.exe'))     return '.exe';
    return '';
  }

  // Recursively chmod +x common binary locations after extraction (Linux only)
  _chmodBinaries(dir) {
    const binDirs = ['bin', 'sbin', 'usr/bin', 'usr/sbin'];
    for (const rel of binDirs) {
      const full = path.join(dir, rel);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        for (const f of fs.readdirSync(full)) {
          const fp = path.join(full, f);
          try { if (fs.statSync(fp).isFile()) fs.chmodSync(fp, 0o755); } catch {}
        }
      }
    }
    // Also chmod top-level executables (e.g. bun, deno, caddy)
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        if (fs.statSync(fp).isFile() && !f.includes('.')) fs.chmodSync(fp, 0o755);
      } catch {}
    }
  }

  _flattenSingleDir(dir) {
    const entries = fs.readdirSync(dir);
    if (entries.length === 1) {
      const singleChild = path.join(dir, entries[0]);
      if (fs.statSync(singleChild).isDirectory()) {
        const childEntries = fs.readdirSync(singleChild);
        for (const entry of childEntries) {
          const src = path.join(singleChild, entry);
          const dest = path.join(dir, entry);
          fs.renameSync(src, dest);
        }
        fs.rmSync(singleChild, { recursive: true, force: true });
      }
    }
  }

  removeVersion(service, version) {
    const installPath = this.getInstallPath(service, version);
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
      return { success: true };
    }
    return { success: false, error: 'Not installed' };
  }

  getStatus() {
    const status = {};
    for (const [service, versions] of Object.entries(this.downloadUrls)) {
      status[service] = {};
      for (const [version, urlData] of Object.entries(versions)) {
        const url = this._resolveUrl(urlData);
        if (url) status[service][version] = this.isInstalled(service, version);
      }
    }
    return status;
  }
}

module.exports = DownloadManager;
