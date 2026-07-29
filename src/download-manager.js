const fs = require('fs');
const path = require('path');
require('./tls-trust');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { resolveInside, assertSafeSegment, isPathInside } = require('./path-utils');

const SERVICE_INFO = Object.freeze({
  apache: { name: 'Apache HTTP Server', icon: '🪶', category: 'Web servers', description: 'Classic, module-based HTTP server.' },
  nginx: { name: 'Nginx', icon: '🟢', category: 'Web servers', description: 'High-performance HTTP server and reverse proxy.' },
  caddy: { name: 'Caddy', icon: '🧊', category: 'Web servers', description: 'Modern web server with automatic HTTPS.' },
  postgresql: { name: 'PostgreSQL', icon: '🐘', category: 'Databases', description: 'Advanced relational database.' },
  mysql: { name: 'MySQL', icon: '🐬', category: 'Databases', description: 'Popular relational database.' },
  mariadb: { name: 'MariaDB', icon: '🦭', category: 'Databases', description: 'Community MySQL-compatible database.' },
  mongodb: { name: 'MongoDB', icon: '🍃', category: 'Databases', description: 'Document-oriented database.' },
  php: { name: 'PHP', icon: '🐘', category: 'Languages', description: 'PHP runtime with FastCGI support.' },
  node: { name: 'Node.js', icon: '⬢', category: 'Languages', description: 'JavaScript runtime; official releases can be synchronized.' },
  go: { name: 'Go', icon: '🐹', category: 'Languages', description: 'Go compiler and toolchain.' },
  bun: { name: 'Bun', icon: '🥟', category: 'Languages', description: 'Fast JavaScript runtime and toolkit.' },
  python: { name: 'Python', icon: '🐍', category: 'Languages', description: 'Python runtime; official Windows builds can be synchronized.' },
  deno: { name: 'Deno', icon: '🦕', category: 'Languages', description: 'Secure JavaScript and TypeScript runtime.' },
  redis: { name: 'Redis', icon: '🔴', category: 'Cache & storage', description: 'In-memory data store and cache.' },
  memcached: { name: 'Memcached', icon: '🧠', category: 'Cache & storage', description: 'Distributed in-memory cache.' },
  minio: { name: 'MinIO', icon: '🪣', category: 'Cache & storage', description: 'S3-compatible object storage.' }
});

// Support both Electron and standalone Node.js (server mode)
let electronApp = null;
try { electronApp = require('electron').app; } catch {}

class DownloadManager {
  constructor(options) {
    if (typeof options === 'string') options = { appRoot: options };
    options = options || {};
    if (options.appRoot) {
      this.appRoot = path.resolve(options.appRoot);
    } else if (electronApp) {
      this.appRoot = electronApp.isPackaged ? path.dirname(process.execPath) : electronApp.getAppPath();
    } else {
      this.appRoot = process.cwd();
    }
    this.catalogRoot = path.resolve(options.catalogRoot || this.appRoot);
    this.dataDir = path.join(this.appRoot, 'servers');
    this.tempDir = path.join(this.appRoot, 'temp');
    this.cacheDir = path.join(this.appRoot, 'cache', 'downloads');
    this._ensureDir(this.dataDir);
    this._ensureDir(this.tempDir);
    this._ensureDir(this.cacheDir);
    this.activeDownloads = new Map();
    this.downloadUrls = this._loadDownloadUrls();
    this.versionMetadata = {
      mysql: {
        '8.4.10': { lts: 'LTS', prerelease: false },
        '8.4.4': { lts: 'LTS', prerelease: false }
      }
    };
    this.maxRetries = 3;
    this._platform = process.platform === 'win32' ? 'win' : 'linux';
  }

  _loadDownloadUrls() {
    const result = {};
    const catalogPaths = [
      path.join(this.catalogRoot, 'config', 'downloads.json'),
      path.join(this.appRoot, 'config', 'downloads.json')
    ];
    for (const jsonPath of [...new Set(catalogPaths)]) {
      try {
        if (!fs.existsSync(jsonPath)) continue;
        const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        for (const [service, versions] of Object.entries(parsed)) {
          if (!versions || typeof versions !== 'object' || Array.isArray(versions)) continue;
          result[service] = { ...(result[service] || {}), ...versions };
        }
      } catch {
        // Keep any valid catalog already loaded and ignore a malformed override.
      }
    }
    return result;
  }

  reloadUrls() {
    this.downloadUrls = this._loadDownloadUrls();
  }

  getVersionMap() {
    const map = {};
    for (const [service, versions] of Object.entries(this.downloadUrls)) {
      const available = [];
      for (const [ver, urlData] of Object.entries(versions)) {
        const entry = this._resolveEntry(urlData);
        if (entry?.url) available.push(ver);
      }
      if (available.length) map[service] = available;
    }
    return map;
  }

  getCatalog() {
    return Object.entries(SERVICE_INFO).map(([id, info]) => {
      const versions = Object.keys(this.downloadUrls[id] || {})
        .filter(version => this._resolveEntry(this.downloadUrls[id][version])?.url)
        .sort((a, b) => this._compareVersions(b, a))
        .map(version => ({
          version,
          installed: this.isInstalled(id, version),
          ...(this.versionMetadata[id]?.[version] || {})
        }));
      // Prefer the production-oriented channel when the upstream catalog exposes it.
      // For Node.js that means LTS; for Nginx it means the stable branch.
      const recommended = versions.find(item => item.lts && !item.prerelease)
        || (id === 'nginx' && versions.find(item => item.channel === 'stable'))
        || versions.find(item => !item.prerelease)
        || versions[0];
      if (recommended) recommended.recommended = true;
      return {
        id,
        ...info,
        installedVersions: this.getInstalledVersions(id),
        versions
      };
    });
  }

  _compareVersions(a, b) {
    if (a === b) return 0;
    if (a === 'latest') return 1;
    if (b === 'latest') return -1;
    const tokenize = value => String(value).match(/\d+|[A-Za-z]+/g) || [];
    const left = tokenize(a);
    const right = tokenize(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i] == null) return -1;
      if (right[i] == null) return 1;
      const leftNum = Number(left[i]);
      const rightNum = Number(right[i]);
      const comparison = Number.isNaN(leftNum) || Number.isNaN(rightNum)
        ? String(left[i]).localeCompare(String(right[i]))
        : leftNum - rightNum;
      if (comparison) return comparison;
    }
    return 0;
  }

  async refreshCatalog() {
    const providers = [
      ['Node.js', () => this._refreshNodeCatalog()],
      ['Python', () => this._refreshPythonCatalog()],
      ['PHP', () => this._refreshPhpCatalog()],
      ['Nginx', () => this._refreshNginxCatalog()],
      ['Go', () => this._refreshGoCatalog()],
      ['MariaDB', () => this._refreshMariaDbCatalog()],
      ['Bun', () => this._refreshGitHubCatalog({
        service: 'bun', repo: 'oven-sh/bun',
        versionFromTag: tag => tag.replace(/^bun-v/, ''),
        assetName: platform => platform === 'win' ? 'bun-windows-x64.zip' : 'bun-linux-x64.zip',
        checksumName: () => 'SHASUMS256.txt'
      })],
      ['Deno', () => this._refreshGitHubCatalog({
        service: 'deno', repo: 'denoland/deno',
        versionFromTag: tag => tag.replace(/^v/, ''),
        assetName: platform => platform === 'win' ? 'deno-x86_64-pc-windows-msvc.zip' : 'deno-x86_64-unknown-linux-gnu.zip',
        checksumName: (platform, fileName) => `${fileName}.sha256sum`
      })],
      ['Caddy', () => this._refreshGitHubCatalog({
        service: 'caddy', repo: 'caddyserver/caddy',
        versionFromTag: tag => tag.replace(/^v/, ''),
        assetName: (platform, version) => platform === 'win'
          ? `caddy_${version}_windows_amd64.zip`
          : `caddy_${version}_linux_amd64.tar.gz`,
        checksumName: (platform, fileName, version) => `caddy_${version}_checksums.txt`
      })],
      ['Redis for Windows', () => this._refreshGitHubCatalog({
        service: 'redis', repo: 'redis-windows/redis-windows', winOnly: true,
        versionFromTag: tag => tag.replace(/^v/, ''),
        assetName: (platform, version) => `Redis-${version}-Windows-x64-msys2.zip`
      })],
      ['Memcached for Windows', () => this._refreshGitHubCatalog({
        service: 'memcached', repo: 'jefyt/memcached-windows', winOnly: true,
        versionFromTag: tag => tag.split('_')[0].replace(/^v/, ''),
        assetName: (platform, version) => `memcached-${version}-win64-mingw.zip`,
        checksumName: () => 'hashes.txt'
      })]
    ];
    const results = await Promise.allSettled(providers.map(([, run]) => run()));
    const refreshed = [];
    const errors = [];
    results.forEach((result, index) => {
      const name = providers[index][0];
      if (result.status === 'fulfilled') refreshed.push({ name, versions: result.value });
      else errors.push({ name, error: result.reason?.message || String(result.reason) });
    });
    return { success: refreshed.length > 0, refreshed, errors, catalog: this.getCatalog() };
  }

  async _refreshNodeCatalog() {
    const releases = await this._fetchJson('https://nodejs.org/dist/index.json');
    const entries = {};
    const metadata = {};
    const wantedFile = this._platform === 'win' ? 'win-x64-zip' : 'linux-x64';
    for (const release of Array.isArray(releases) ? releases : []) {
      if (!release?.version || !release.files?.includes(wantedFile)) continue;
      const version = release.version.replace(/^v/, '');
      const fileName = this._platform === 'win'
        ? `node-v${version}-win-x64.zip`
        : `node-v${version}-linux-x64.tar.xz`;
      entries[version] = {
        [this._platform]: {
          url: `https://nodejs.org/dist/v${version}/${fileName}`,
          checksumUrl: `https://nodejs.org/dist/v${version}/SHASUMS256.txt`,
          fileName
        }
      };
      metadata[version] = { date: release.date || '', lts: release.lts || false, security: Boolean(release.security), prerelease: false };
    }
    this.downloadUrls.node = { ...(this.downloadUrls.node || {}), ...entries };
    this.versionMetadata.node = { ...(this.versionMetadata.node || {}), ...metadata };
    return Object.keys(entries).length;
  }

  async _refreshPythonCatalog() {
    if (this._platform !== 'win') return 0;
    const payload = await this._fetchJson('https://www.python.org/ftp/python/index-windows-recent.json');
    const entries = {};
    const metadata = {};
    for (const release of Array.isArray(payload?.versions) ? payload.versions : []) {
      if (release?.company !== 'PythonEmbed' || !String(release.id || '').endsWith('-64')) continue;
      const version = release['sort-version'];
      if (!version || !release.url || entries[version]) continue;
      entries[version] = { win: { url: release.url, sha256: release.hash?.sha256 || null } };
      metadata[version] = { prerelease: /[a-z]/i.test(version), date: '' };
    }
    this.downloadUrls.python = { ...(this.downloadUrls.python || {}), ...entries };
    this.versionMetadata.python = { ...(this.versionMetadata.python || {}), ...metadata };
    return Object.keys(entries).length;
  }

  async _refreshPhpCatalog() {
    if (this._platform !== 'win') return 0;
    const payload = await this._fetchJson('https://downloads.php.net/~windows/releases/releases.json');
    const entries = {};
    for (const branch of Object.values(payload || {})) {
      const version = branch?.version;
      if (!version) continue;
      const buildKey = Object.keys(branch).find(key => /^nts-(?:vs|vc)\d+-x64$/.test(key) && branch[key]?.zip?.path);
      if (!buildKey) continue;
      const artifact = branch[buildKey].zip;
      entries[version] = { win: { url: `https://downloads.php.net/~windows/releases/${artifact.path}`, sha256: artifact.sha256 || null } };
    }
    this.downloadUrls.php = { ...(this.downloadUrls.php || {}), ...entries };
    return Object.keys(entries).length;
  }

  async _refreshNginxCatalog() {
    if (this._platform !== 'win') return 0;
    const html = await this._fetchText('https://nginx.org/en/download.html');
    const versions = [...html.matchAll(/nginx\/Windows-(\d+\.\d+\.\d+)/g)].map(match => match[1]);
    const entries = {};
    const metadata = {};
    const stableVersion = html.match(/Stable version[\s\S]{0,2000}?nginx\/Windows-(\d+\.\d+\.\d+)/i)?.[1];
    const mainlineVersion = html.match(/Mainline version[\s\S]{0,2000}?nginx\/Windows-(\d+\.\d+\.\d+)/i)?.[1];
    for (const version of [...new Set(versions)]) {
      entries[version] = { win: `https://nginx.org/download/nginx-${version}.zip`, linux: null };
      metadata[version] = {
        channel: version === stableVersion ? 'stable' : (version === mainlineVersion ? 'mainline' : 'legacy'),
        prerelease: false
      };
    }
    this.downloadUrls.nginx = { ...(this.downloadUrls.nginx || {}), ...entries };
    this.versionMetadata.nginx = { ...(this.versionMetadata.nginx || {}), ...metadata };
    return Object.keys(entries).length;
  }

  async _refreshGoCatalog() {
    const releases = await this._fetchJson('https://go.dev/dl/?mode=json&include=all');
    const entries = {};
    const metadata = {};
    const os = this._platform === 'win' ? 'windows' : 'linux';
    for (const release of Array.isArray(releases) ? releases : []) {
      const file = release?.files?.find(item => item.os === os && item.arch === 'amd64' && item.kind === 'archive');
      const version = String(release?.version || '').replace(/^go/, '');
      if (!file || !version) continue;
      entries[version] = { [this._platform]: { url: `https://go.dev/dl/${file.filename}`, sha256: file.sha256 || null } };
      metadata[version] = { prerelease: release.stable === false };
    }
    this.downloadUrls.go = { ...(this.downloadUrls.go || {}), ...entries };
    this.versionMetadata.go = { ...(this.versionMetadata.go || {}), ...metadata };
    return Object.keys(entries).length;
  }

  async _refreshMariaDbCatalog() {
    const catalog = await this._fetchJson('https://downloads.mariadb.org/rest-api/mariadb/');
    const supported = (Array.isArray(catalog?.major_releases) ? catalog.major_releases : [])
      .filter(release => release.release_status === 'Stable');
    const responses = await Promise.allSettled(supported.map(release =>
      this._fetchJson(`https://downloads.mariadb.org/rest-api/mariadb/${release.release_id}/latest/`)
        .then(payload => ({ release, payload }))
    ));
    const entries = {};
    const metadata = {};
    for (const response of responses) {
      if (response.status !== 'fulfilled') continue;
      const { release, payload } = response.value;
      for (const item of Object.values(payload?.releases || {})) {
        const version = item?.release_id;
        const file = item?.files?.find(candidate => this._platform === 'win'
          ? candidate.os === 'Windows' && candidate.cpu === 'x86_64' && /-winx64\.zip$/i.test(candidate.file_name || '')
          : candidate.os === 'Linux' && candidate.cpu === 'x86_64' && /linux-systemd-x86_64\.tar\.gz$/i.test(candidate.file_name || ''));
        if (!version || !file?.file_download_url) continue;
        entries[version] = {
          [this._platform]: {
            url: file.file_download_url.replace(/^http:/, 'https:'),
            sha256: file.checksum?.sha256sum || null
          }
        };
        metadata[version] = {
          date: item.date_of_release || '',
          lts: release.release_support_type === 'Long Term Support' ? 'LTS' : false,
          prerelease: false
        };
      }
    }
    this.downloadUrls.mariadb = { ...(this.downloadUrls.mariadb || {}), ...entries };
    this.versionMetadata.mariadb = { ...(this.versionMetadata.mariadb || {}), ...metadata };
    return Object.keys(entries).length;
  }

  async _refreshGitHubCatalog({ service, repo, versionFromTag, assetName, checksumName, winOnly = false }) {
    if (winOnly && this._platform !== 'win') return 0;
    const releases = await this._fetchJson(`https://api.github.com/repos/${repo}/releases?per_page=100`);
    const entries = {};
    const metadata = {};
    for (const release of Array.isArray(releases) ? releases : []) {
      if (!release?.tag_name || release.draft) continue;
      const version = versionFromTag(String(release.tag_name));
      if (!version || entries[version]) continue;
      const fileName = assetName(this._platform, version);
      const asset = release.assets?.find(item => item.name === fileName && item.browser_download_url);
      if (!asset) continue;
      const checksumFile = checksumName?.(this._platform, fileName, version);
      const checksumAsset = checksumFile && release.assets?.find(item => item.name === checksumFile && item.browser_download_url);
      entries[version] = {
        [this._platform]: {
          url: asset.browser_download_url,
          ...(checksumAsset ? { checksumUrl: checksumAsset.browser_download_url, fileName } : {})
        }
      };
      metadata[version] = {
        date: release.published_at || '',
        prerelease: Boolean(release.prerelease)
      };
    }
    this.downloadUrls[service] = { ...(this.downloadUrls[service] || {}), ...entries };
    this.versionMetadata[service] = { ...(this.versionMetadata[service] || {}), ...metadata };
    return Object.keys(entries).length;
  }

  // Resolve URL from either new {win,linux} object or legacy plain string
  _resolveEntry(urlData) {
    if (!urlData) return null;
    if (typeof urlData === 'string') return { url: urlData };
    const platformData = urlData[this._platform];
    if (typeof platformData === 'string') {
      return { url: platformData, sha256: urlData[`${this._platform}Sha256`] || null };
    }
    if (platformData && typeof platformData === 'object' && typeof platformData.url === 'string') {
      return {
        url: platformData.url,
        sha256: platformData.sha256 || null,
        checksumUrl: platformData.checksumUrl || null,
        fileName: platformData.fileName || null
      };
    }
    return null;
  }

  _resolveUrl(urlData) {
    return this._resolveEntry(urlData)?.url || null;
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
    assertSafeSegment(service, 'service');
    assertSafeSegment(version, 'version');
    return resolveInside(this.dataDir, service, version);
  }

  isInstalled(service, version) {
    try {
      const installPath = this.getInstallPath(service, version);
      return fs.existsSync(installPath) && fs.readdirSync(installPath).length > 0;
    } catch {
      return false;
    }
  }

  getInstalledVersions(service) {
    try { assertSafeSegment(service, 'service'); } catch { return []; }
    const serviceDir = resolveInside(this.dataDir, service);
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

  _cachePaths(service, version, extension) {
    assertSafeSegment(service, 'service');
    assertSafeSegment(version, 'version');
    const ext = /^\.[A-Za-z0-9.]{0,12}$/.test(extension || '') ? extension : '.bin';
    const directory = resolveInside(this.cacheDir, service);
    return { directory, archive: resolveInside(directory, `${version}${ext}`), metadata: resolveInside(directory, `${version}${ext}.json`) };
  }

  _restoreFromCache(service, version, extension, destination) {
    try {
      const paths = this._cachePaths(service, version, extension);
      if (!fs.existsSync(paths.archive) || !fs.existsSync(paths.metadata)) return null;
      const metadata = JSON.parse(fs.readFileSync(paths.metadata, 'utf8'));
      const actual = crypto.createHash('sha256').update(fs.readFileSync(paths.archive)).digest('hex');
      if (!metadata.sha256 || actual.toLowerCase() !== String(metadata.sha256).toLowerCase()) {
        try { fs.unlinkSync(paths.archive); } catch {}
        try { fs.unlinkSync(paths.metadata); } catch {}
        return null;
      }
      fs.copyFileSync(paths.archive, destination);
      return { ...metadata, path: paths.archive, sha256: actual };
    } catch {
      return null;
    }
  }

  _storeInCache(service, version, extension, source, sourceUrl) {
    const paths = this._cachePaths(service, version, extension);
    this._ensureDir(paths.directory);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    fs.copyFileSync(source, paths.archive);
    fs.writeFileSync(paths.metadata, JSON.stringify({ service, version, sha256, sourceUrl, cachedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { path: paths.archive, sha256 };
  }

  cacheStatus() {
    const entries = [];
    let totalSize = 0;
    if (!fs.existsSync(this.cacheDir)) return { entries, totalSize, cacheDir: this.cacheDir };
    for (const service of fs.readdirSync(this.cacheDir)) {
      const serviceDir = path.join(this.cacheDir, service);
      if (!fs.statSync(serviceDir).isDirectory()) continue;
      for (const file of fs.readdirSync(serviceDir).filter(name => !name.endsWith('.json'))) {
        const archive = path.join(serviceDir, file);
        const stat = fs.statSync(archive);
        let metadata = {};
        try { metadata = JSON.parse(fs.readFileSync(`${archive}.json`, 'utf8')); } catch {}
        totalSize += stat.size;
        entries.push({ service, file, path: archive, size: stat.size, ...metadata });
      }
    }
    return { entries, totalSize, cacheDir: this.cacheDir };
  }

  clearCache(service = null, version = null) {
    const status = this.cacheStatus();
    let removed = 0;
    for (const entry of status.entries) {
      if (service && entry.service !== service) continue;
      if (version && entry.version !== version) continue;
      for (const file of [entry.path, `${entry.path}.json`]) try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      removed += 1;
    }
    return { success: true, removed };
  }

  exportCache(directory) {
    const target = path.resolve(String(directory || ''));
    if (!directory || target === path.parse(target).root || isPathInside(this.cacheDir, target)) return { success: false, error: 'Choose a safe export directory outside the cache' };
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(this.cacheDir, path.join(target, 'kitsuneserv-download-cache'), { recursive: true, force: true });
    return { success: true, path: path.join(target, 'kitsuneserv-download-cache'), ...this.cacheStatus() };
  }

  importCache(directory) {
    const source = path.resolve(String(directory || ''));
    if (isPathInside(this.cacheDir, source) || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) return { success: false, error: 'Choose an external cache directory' };
    fs.cpSync(source, this.cacheDir, { recursive: true, force: true });
    return { success: true, ...this.cacheStatus() };
  }

  async download(service, version, onProgress) {
    const key = `${service}-${version}`;
    if (this.activeDownloads.has(key)) {
      return { success: false, error: 'Download already in progress' };
    }

    let installPath;
    try {
      assertSafeSegment(service, 'service');
      assertSafeSegment(version, 'version');
      installPath = this.getInstallPath(service, version);
    } catch (err) {
      return { success: false, error: err.message };
    }

    const entry = this._resolveEntry(this.downloadUrls[service]?.[version]);
    const url = entry?.url;
    if (!url) {
      return { success: false, error: `No download URL for ${service} ${version}` };
    }

    const installingMarker = `${installPath}.installing`;
    if (fs.existsSync(installingMarker)) {
      try {
        await this._removeWithRetry(installPath);
        await this._removeWithRetry(installingMarker);
      } catch (err) {
        return { success: false, error: `Could not clean an interrupted installation: ${err.message}` };
      }
    }
    if (this.isInstalled(service, version)) {
      return { success: true, path: installPath, alreadyInstalled: true };
    }

    // Derive temp file extension from actual URL
    const ext = this._urlExtension(url);
    const zipPath = path.join(this.tempDir, `${service}-${version}${ext}`);

    this.activeDownloads.set(key, true);
    let completed = false;

    try {
      // A marker survives a terminated process. Remove its partial tree before
      // retrying so a half-extracted archive is never reported as installed.
      this._ensureDir(installPath);
      fs.writeFileSync(installingMarker, JSON.stringify({ service, version, startedAt: new Date().toISOString() }), 'utf8');
      if (onProgress) onProgress({ stage: 'downloading', percent: 0, service, version });

      const cached = this._restoreFromCache(service, version, ext, zipPath);
      if (cached && onProgress) onProgress({ stage: 'cache', percent: 100, service, version });

      // Retry download with exponential backoff
      let lastErr;
      for (let attempt = 1; !cached && attempt <= this.maxRetries; attempt++) {
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

      let expectedHash = entry.sha256 || cached?.sha256;
      if (!expectedHash && entry.checksumUrl && entry.fileName) {
        const sums = await this._fetchText(entry.checksumUrl, 5 * 1024 * 1024);
        const line = sums.split(/\r?\n/).find(item => item.trim().endsWith(entry.fileName));
        const match = line?.match(/^([a-fA-F0-9]{64})\s+/);
        if (match) {
          expectedHash = match[1];
        } else {
          const escapedFileName = entry.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const bsdMatch = sums.match(new RegExp(`SHA(?:2-)?256\\(${escapedFileName}\\)\\s*=\\s*([a-fA-F0-9]{64})`, 'i'));
          // Some projects publish a checksum file dedicated to one artifact (for
          // example Deno's PowerShell-style "Hash : ..." files).
          const checksumFile = path.basename(new URL(entry.checksumUrl).pathname);
          const isDedicatedChecksum = checksumFile.startsWith(`${entry.fileName}.`);
          const dedicatedMatch = isDedicatedChecksum && sums.match(/(?:^|\n)\s*(?:Hash\s*:\s*)?([a-fA-F0-9]{64})(?:\s|$)/im);
          if (!bsdMatch && !dedicatedMatch) throw new Error('Could not verify the official SHA-256 checksum');
          expectedHash = (bsdMatch || dedicatedMatch)[1];
        }
      }
      if (expectedHash) {
        if (onProgress) onProgress({ stage: 'verifying', percent: 100, service, version });
        const actualHash = await this._sha256File(zipPath);
        if (actualHash.toLowerCase() !== String(expectedHash).toLowerCase()) {
          throw new Error('Downloaded file failed SHA-256 verification');
        }
      }

      if (!cached) this._storeInCache(service, version, ext, zipPath, url);

      if (onProgress) onProgress({ stage: 'extracting', percent: 100, service, version });

      // If URL points to a single binary (not an archive), move it directly
      if (ext === '.exe' || !ext) {
        const exeName = path.basename(new URL(url).pathname);
        const destFile = path.join(installPath, exeName);
        await this._moveWithRetry(zipPath, destFile);
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
      try { await this._removeWithRetry(zipPath); } catch {}
      fs.writeFileSync(path.join(installPath, '.kitsuneserv-installed.json'), JSON.stringify({
        service, version, installedAt: new Date().toISOString()
      }), 'utf8');

      if (onProgress) onProgress({ stage: 'done', percent: 100, service, version });
      completed = true;
      return { success: true, path: installPath };
    } catch (err) {
      // Clean up on failure
      try { await this._removeWithRetry(zipPath); } catch {}
      let cleanupError = '';
      try { await this._removeWithRetry(installPath); }
      catch (cleanupErr) { cleanupError = ` Partial files could not be removed: ${cleanupErr.message}`; }
      const message = `${err.message}${cleanupError}`;
      if (onProgress) onProgress({ stage: 'failed', percent: 0, service, version, error: message });
      return { success: false, error: message };
    } finally {
      if (completed || !fs.existsSync(installPath)) {
        try { await this._removeWithRetry(installingMarker); } catch {}
      }
      this.activeDownloads.delete(key);
    }
  }

  _downloadFile(url, dest, onProgress, redirectCount = 0) {
    if (redirectCount > 5) {
      return Promise.reject(new Error('Too many redirects'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let file = null;
      const succeed = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        if (file && !file.destroyed) file.destroy();
        fs.rm(dest, { force: true }, () => reject(error instanceof Error ? error : new Error(String(error))));
      };
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
        const localHttp = parsedUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
        if (parsedUrl.protocol !== 'https:' && !localHttp) throw new Error('Only HTTPS download URLs are allowed');
      } catch (err) {
        fail(new Error(`Invalid download URL: ${err.message}`));
        return;
      }
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const req = protocol.get(parsedUrl, { headers: { 'User-Agent': 'KitsuneServ/1.0' } }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, parsedUrl).toString();
          res.resume();
          return this._downloadFile(redirectUrl, dest, onProgress, redirectCount + 1).then(succeed, fail);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error(`HTTP ${res.statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        const maxSize = 5 * 1024 * 1024 * 1024;
        if (totalSize > maxSize) {
          res.resume();
          return fail(new Error('Download is larger than the 5 GB safety limit'));
        }
        let downloaded = 0;
        let lastProgressTime = 0;
        file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (downloaded > maxSize) {
            res.destroy(new Error('Download exceeded the 5 GB safety limit'));
            fail(new Error('Download exceeded the 5 GB safety limit'));
            return;
          }
          if (totalSize > 0 && onProgress) {
            const now = Date.now();
            if (now - lastProgressTime >= 200 || downloaded >= totalSize) {
              lastProgressTime = now;
              onProgress(Math.round((downloaded / totalSize) * 100));
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => file.close(succeed));
        file.on('error', fail);
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('Download was interrupted')));
      });

      req.on('error', fail);
      req.setTimeout(30000, () => {
        req.destroy(new Error('Download timeout'));
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
      execFile('tar', ['-tf', zipPath], { timeout: 60000, maxBuffer: 20 * 1024 * 1024 }, (listErr, stdout) => {
        if (listErr) return reject(new Error(`Archive validation failed: ${listErr.message}`));
        const unsafe = stdout.split(/\r?\n/).filter(Boolean).find(entry => {
          const normalized = entry.replace(/\\/g, '/');
          return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..');
        });
        if (unsafe) return reject(new Error(`Archive contains an unsafe path: ${unsafe}`));

        execFile('tar', args, { timeout: 600000 }, async (err) => {
          if (err) return reject(new Error(`Extract failed: ${err.message}`));
          try {
            await this._flattenSingleDir(destPath);
            resolve();
          } catch (flattenError) {
            reject(new Error(`Archive finalization failed: ${flattenError.message}`));
          }
        });
      });
    });
  }

  _fetchJson(url) {
    return this._fetchText(url).then(text => {
      try { return JSON.parse(text); }
      catch { throw new Error('The remote catalog returned invalid JSON'); }
    });
  }

  _fetchText(url, maxSize = 20 * 1024 * 1024, redirectCount = 0) {
    if (redirectCount > 5) return Promise.reject(new Error('Too many catalog redirects'));
    return new Promise((resolve, reject) => {
      let parsedUrl;
      try {
        parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'https:') throw new Error('Catalog URLs must use HTTPS');
      } catch (err) {
        reject(err);
        return;
      }
      const req = https.get(parsedUrl, { headers: { 'User-Agent': 'KitsuneServ/1.0', Accept: 'application/json,text/html;q=0.9,*/*;q=0.1' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          this._fetchText(new URL(res.headers.location, parsedUrl).toString(), maxSize, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Catalog HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxSize) req.destroy(new Error('Remote catalog is too large'));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('aborted', () => reject(new Error('Catalog request was interrupted')));
      });
      req.setTimeout(30000, () => req.destroy(new Error('Catalog request timed out')));
      req.on('error', reject);
    });
  }

  _sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
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

  async _retryFileOperation(operation, retries = 6) {
    const retryable = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try { return await operation(); }
      catch (err) {
        lastError = err;
        if (!retryable.has(err?.code) || attempt === retries) throw err;
        await new Promise(resolve => setTimeout(resolve, Math.min(1600, 100 * (2 ** attempt))));
      }
    }
    throw lastError;
  }

  async _removeWithRetry(target) {
    if (!target) return;
    await this._retryFileOperation(() => fs.promises.rm(target, {
      recursive: true, force: true, maxRetries: 3, retryDelay: 100
    }));
  }

  async _moveWithRetry(src, dest) {
    try {
      await this._retryFileOperation(() => fs.promises.rename(src, dest));
      return;
    } catch (renameError) {
      const canCopy = ['EPERM', 'EBUSY', 'EACCES', 'EEXIST', 'ENOTEMPTY'].includes(renameError?.code);
      if (!canCopy) throw renameError;
    }
    // Antivirus/indexing can temporarily block directory renames on Windows.
    // Copying and then deleting is slower, but safely handles those locks and
    // also merges a destination left by an interrupted finalization.
    await this._retryFileOperation(() => fs.promises.cp(src, dest, {
      recursive: true, force: true, errorOnExist: false
    }));
    await this._removeWithRetry(src);
  }

  async _flattenSingleDir(dir) {
    const entries = await fs.promises.readdir(dir);
    if (entries.length === 1) {
      const singleChild = path.join(dir, entries[0]);
      if ((await fs.promises.stat(singleChild)).isDirectory()) {
        const childEntries = await fs.promises.readdir(singleChild);
        for (const entry of childEntries) {
          const src = path.join(singleChild, entry);
          const dest = path.join(dir, entry);
          await this._moveWithRetry(src, dest);
        }
        await this._removeWithRetry(singleChild);
      }
    }
  }

  removeVersion(service, version) {
    let installPath;
    try {
      installPath = this.getInstallPath(service, version);
    } catch (err) {
      return { success: false, error: err.message };
    }
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
