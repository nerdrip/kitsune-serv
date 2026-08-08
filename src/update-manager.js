'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ? match[4].split('.') : [] };
}

function compareVersions(left, right) {
  const a = parseVersion(left); const b = parseVersion(right);
  if (!a || !b) throw new Error('Invalid semantic version');
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1;
  if (!b.pre.length) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    if (a.pre[index] === undefined) return -1;
    if (b.pre[index] === undefined) return 1;
    if (a.pre[index] === b.pre[index]) continue;
    const aNumber = /^\d+$/.test(a.pre[index]); const bNumber = /^\d+$/.test(b.pre[index]);
    if (aNumber && bNumber) return Number(a.pre[index]) > Number(b.pre[index]) ? 1 : -1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a.pre[index].localeCompare(b.pre[index]) > 0 ? 1 : -1;
  }
  return 0;
}

function canonicalManifest(manifest) {
  return `${manifest.version}\n${manifest.url}\n${String(manifest.sha256).toLowerCase()}\n${manifest.platform || ''}\n${manifest.arch || ''}`;
}

function verifyManifest(manifest, publicKey) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Invalid update manifest');
  if (!parseVersion(manifest.version) || typeof manifest.url !== 'string' || !/^[a-f0-9]{64}$/i.test(manifest.sha256 || '') || typeof manifest.signature !== 'string') {
    throw new Error('Update manifest is incomplete');
  }
  let key = publicKey;
  if (!(key && typeof key === 'object' && key.type === 'public')) {
    let value = String(publicKey || '');
    if (!value.includes('BEGIN ') && fs.existsSync(path.resolve(value))) value = fs.readFileSync(path.resolve(value), 'utf8');
    if (!value.includes('BEGIN ') && /^[A-Za-z0-9+/=\s]+$/.test(value)) key = crypto.createPublicKey({ key: Buffer.from(value.replace(/\s+/g, ''), 'base64'), format: 'der', type: 'spki' });
    else key = crypto.createPublicKey(value);
  }
  const valid = crypto.verify(null, Buffer.from(canonicalManifest(manifest)), key, Buffer.from(manifest.signature, 'base64'));
  if (!valid) throw new Error('Update manifest signature is invalid');
  return true;
}

class UpdateManager {
  constructor(appRoot, currentVersion, activityManager, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.currentVersion = currentVersion;
    this.activityManager = activityManager;
    this.manifestUrl = options.manifestUrl || process.env.KITSUNE_UPDATE_MANIFEST_URL || '';
    this.publicKey = options.publicKey || process.env.KITSUNE_UPDATE_PUBLIC_KEY || '';
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.allowInstall = options.allowInstall !== false;
    this.updatesRoot = path.join(this.appRoot, 'updates');
    this.lastManifest = null;
  }

  status() {
    let manifestOrigin = '';
    try { if (this.manifestUrl) manifestOrigin = new URL(this.manifestUrl).origin; } catch {}
    return { configured: Boolean(this.manifestUrl && this.publicKey && manifestOrigin), currentVersion: this.currentVersion, manifestUrl: manifestOrigin, platform: this.platform, arch: this.arch, downloaded: this._downloaded() };
  }

  _assertUrl(value, purpose) {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(`${purpose} must use HTTPS`);
    if (url.username || url.password) throw new Error(`${purpose} URL must not contain credentials`);
    return url;
  }

  _request(url, options = {}, redirects = 0) {
    const parsed = this._assertUrl(url, options.purpose || 'Update');
    if (redirects > 3) return Promise.reject(new Error('Too many update redirects'));
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.get(parsed, { headers: { 'User-Agent': `KitsuneServ/${this.currentVersion}`, Accept: options.accept || 'application/octet-stream' }, timeout: 30_000 }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
          response.resume();
          try { resolve(this._request(new URL(response.headers.location, parsed).toString(), options, redirects + 1)); } catch (error) { reject(error); }
          return;
        }
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`Update server returned HTTP ${response.statusCode}`)); return; }
        resolve(response);
      });
      request.on('timeout', () => request.destroy(new Error('Update request timed out')));
      request.on('error', reject);
    });
  }

  async _json(url) {
    const response = await this._request(url, { purpose: 'Update manifest', accept: 'application/json' });
    const chunks = []; let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > MAX_MANIFEST_BYTES) { response.destroy(); throw new Error('Update manifest is too large'); }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  async check() {
    if (!this.manifestUrl || !this.publicKey) return { success: false, configured: false, error: 'Signed update channel is not configured' };
    const payload = await this._json(this.manifestUrl);
    let manifest = payload;
    if (Array.isArray(payload?.packages)) {
      const candidates = payload.packages.filter(item => (!item.platform || item.platform === this.platform) && (!item.arch || item.arch === this.arch));
      candidates.sort((a, b) => {
        const score = item => this.platform === 'win32' && /setup\.exe$/i.test(item.file || item.url) ? 3 : /\.AppImage$/i.test(item.file || item.url) ? 2 : 1;
        return score(b) - score(a);
      });
      if (!candidates.length) throw new Error('Signed release manifest has no package for this platform');
      manifest = { ...candidates[0], version: candidates[0].version || payload.version, notes: candidates[0].notes || payload.notes || '' };
    }
    verifyManifest(manifest, this.publicKey);
    if (manifest.platform && manifest.platform !== this.platform) throw new Error('Update is intended for another platform');
    if (manifest.arch && manifest.arch !== this.arch) throw new Error('Update is intended for another architecture');
    this._assertUrl(manifest.url, 'Update package');
    this.lastManifest = structuredClone(manifest);
    return { success: true, available: compareVersions(manifest.version, this.currentVersion) > 0, currentVersion: this.currentVersion, manifest: this._publicManifest(manifest) };
  }

  _publicManifest(manifest) {
    if (!manifest) return null;
    return { version: manifest.version, url: manifest.url, sha256: manifest.sha256.toLowerCase(), platform: manifest.platform || '', arch: manifest.arch || '', notes: String(manifest.notes || '').slice(0, 5000) };
  }

  _target(manifest) {
    const extension = path.extname(new URL(manifest.url).pathname).toLowerCase() || (this.platform === 'win32' ? '.exe' : '.bin');
    return path.join(this.updatesRoot, `KitsuneServ-${manifest.version}-${this.arch}${extension}`);
  }

  _downloaded() {
    if (!this.lastManifest) return null;
    const target = this._target(this.lastManifest);
    if (!fs.existsSync(target)) return null;
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    return actual === this.lastManifest.sha256.toLowerCase() ? { path: target, version: this.lastManifest.version, size: fs.statSync(target).size, sha256: actual } : null;
  }

  async download() {
    if (!this.lastManifest) {
      const check = await this.check();
      if (!check.success || !check.available) return { success: false, error: check.error || 'No newer update is available' };
    }
    const manifest = this.lastManifest;
    return this.activityManager.run('update', `Download KitsuneServ ${manifest.version}`, { version: manifest.version }, async operation => {
      fs.mkdirSync(this.updatesRoot, { recursive: true });
      const target = this._target(manifest); const partial = `${target}.${process.pid}.partial`;
      let output = null;
      try {
        const response = await this._request(manifest.url, { purpose: 'Update package' });
        const total = Number(response.headers['content-length'] || 0);
        if (total > MAX_PACKAGE_BYTES) throw new Error('Update package is too large');
        const hash = crypto.createHash('sha256'); let received = 0;
        output = fs.createWriteStream(partial, { mode: 0o600 });
        for await (const chunk of response) {
          operation.throwIfCancelled(); received += chunk.length;
          if (received > MAX_PACKAGE_BYTES) throw new Error('Update package is too large');
          hash.update(chunk);
          if (!output.write(chunk)) await new Promise(resolve => output.once('drain', resolve));
          operation.update({ stage: 'downloading', progress: total ? Math.min(99, received / total * 100) : 0, message: `${Math.round(received / 1024 / 1024)} MB` });
        }
        await new Promise((resolve, reject) => output.end(error => error ? reject(error) : resolve()));
        const actual = hash.digest('hex');
        if (actual !== manifest.sha256.toLowerCase()) throw new Error('Downloaded update checksum does not match the signed manifest');
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        fs.renameSync(partial, target);
        return { success: true, path: target, version: manifest.version, sha256: actual };
      } finally {
        try { output?.destroy(); } catch {}
        try { if (fs.existsSync(partial)) fs.unlinkSync(partial); } catch {}
      }
    });
  }

  install() {
    const downloaded = this._downloaded();
    if (!downloaded) return { success: false, error: 'No verified update has been downloaded' };
    if (!this.allowInstall) return { success: false, manual: true, path: downloaded.path, error: 'Automatic installation is disabled in server mode' };
    try {
      if (this.platform === 'win32' && path.extname(downloaded.path).toLowerCase() === '.exe') {
        const child = spawn(downloaded.path, [], { detached: true, stdio: 'ignore', windowsHide: false }); child.unref();
      } else {
        return { success: false, manual: true, path: downloaded.path, error: 'Install this verified package with your platform package manager' };
      }
      return { success: true, launched: true, path: downloaded.path };
    } catch (error) { return { success: false, error: error.message }; }
  }
}

module.exports = UpdateManager;
module.exports.compareVersions = compareVersions;
module.exports.canonicalManifest = canonicalManifest;
module.exports.verifyManifest = verifyManifest;
