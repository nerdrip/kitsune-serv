'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SecretStore {
  constructor(appRoot, options = {}) {
    this.configDir = path.join(path.resolve(appRoot), 'config');
    this.storePath = path.join(this.configDir, 'secrets.json');
    this.keyPath = path.join(this.configDir, 'secret.key');
    this.externalKey = options.externalKey || process.env.KITSUNE_SECRET_KEY || '';
    this.platformEncrypt = typeof options.encrypt === 'function' ? options.encrypt : null;
    this.platformDecrypt = typeof options.decrypt === 'function' ? options.decrypt : null;
  }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return payload && typeof payload.items === 'object' ? payload : { schemaVersion: 1, items: {} };
    } catch {
      return { schemaVersion: 1, items: {} };
    }
  }

  _write(payload) {
    fs.mkdirSync(this.configDir, { recursive: true });
    const temp = `${this.storePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.storePath); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, this.storePath); fs.unlinkSync(temp);
    }
  }

  _key() {
    if (this.externalKey) return crypto.createHash('sha256').update(this.externalKey, 'utf8').digest();
    fs.mkdirSync(this.configDir, { recursive: true });
    try {
      const existing = Buffer.from(fs.readFileSync(this.keyPath, 'utf8').trim(), 'base64');
      if (existing.length === 32) return existing;
    } catch {}
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try { fs.chmodSync(this.keyPath, 0o600); } catch {}
    return key;
  }

  _encrypt(value) {
    if (this.platformEncrypt) {
      try { return { backend: 'platform', value: this.platformEncrypt(value) }; } catch {}
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { backend: 'aes-256-gcm', value: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64') };
  }

  _decrypt(record) {
    if (!record || typeof record.value !== 'string') return '';
    if (record.backend === 'platform' && this.platformDecrypt) return this.platformDecrypt(record.value);
    if (record.backend !== 'aes-256-gcm') return '';
    const payload = Buffer.from(record.value, 'base64');
    if (payload.length < 29) throw new Error('Encrypted secret is corrupt');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  }

  set(key, value) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9:._-]{1,300}$/.test(key)) throw new Error('Invalid secret key');
    if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid secret value');
    const payload = this._read();
    payload.items[key] = { ...this._encrypt(value), updatedAt: new Date().toISOString() };
    this._write(payload);
    return { success: true };
  }

  get(key) {
    try { return this._decrypt(this._read().items[key]); } catch { return ''; }
  }

  has(key) {
    return Boolean(this._read().items[key]);
  }

  remove(key) {
    const payload = this._read();
    const existed = Boolean(payload.items[key]);
    delete payload.items[key];
    this._write(payload);
    return { success: true, removed: existed };
  }
}

module.exports = SecretStore;
