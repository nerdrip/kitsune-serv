'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ftp = require('basic-ftp');
const { createClient } = require('webdav');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { BlobServiceClient } = require('@azure/storage-blob');

const TYPES = new Set(['ftp', 'ftps', 'webdav', 's3', 'azure']);
const SECRET_FIELDS = ['password', 'accessKeyId', 'secretAccessKey', 'sessionToken', 'connectionString'];

function endpoint(value, allowFtp = false) {
  const parsed = new URL(String(value || ''));
  const protocols = allowFtp ? ['ftp:', 'ftps:'] : ['https:'];
  if (!protocols.includes(parsed.protocol) && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname))) throw new Error('Storage endpoint must use HTTPS (HTTP is allowed only for loopback)');
  return parsed.toString().replace(/\/$/, '');
}

function objectPath(value, leadingSlash = true) {
  const normalized = String(value || '/').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (normalized.includes('\0')) throw new Error('Invalid storage path');
  return leadingSlash ? `/${normalized.replace(/^\/+/, '')}` : normalized.replace(/^\/+/, '');
}

class CloudStorageManager {
  constructor(appRoot, secretStore) { this.file = path.join(path.resolve(appRoot), 'config', 'storage-profiles.json'); this.secretStore = secretStore; }
  _read() { try { const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(parsed.profiles) ? parsed.profiles : []; } catch { return []; } }
  _write(profiles) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temporary = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, profiles }, null, 2), { mode: 0o600 }); try { fs.renameSync(temporary, this.file); } catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temporary, this.file); fs.unlinkSync(temporary); } }
  list() { return this._read(); }
  save(input = {}, secrets = {}) {
    if (!TYPES.has(input.type)) throw new Error('Unsupported storage protocol'); const profiles = this._read(); const id = String(input.id || crypto.randomUUID()); const index = profiles.findIndex(item => item.id === id); const previous = index >= 0 ? profiles[index] : {};
    const profile = { id, type: input.type, name: String(input.name || input.type.toUpperCase()).trim().slice(0, 100), host: String(input.host || previous.host || '').trim().slice(0, 500), port: Math.max(1, Math.min(65535, Number(input.port) || (input.type === 'ftps' ? 21 : 21))), username: String(input.username || '').slice(0, 200), endpoint: String(input.endpoint || previous.endpoint || '').trim().slice(0, 2000), region: String(input.region || previous.region || 'us-east-1').slice(0, 80), bucket: String(input.bucket || previous.bucket || '').slice(0, 255), container: String(input.container || previous.container || '').slice(0, 255), rootPath: objectPath(input.rootPath || previous.rootPath || '/', !['s3', 'azure'].includes(input.type)), production: Boolean(input.production), createdAt: previous.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (['ftp', 'ftps'].includes(profile.type) && !profile.host) throw new Error('FTP host is required'); if (profile.type === 'webdav') profile.endpoint = endpoint(profile.endpoint); if (profile.type === 's3' && profile.endpoint) profile.endpoint = endpoint(profile.endpoint); if (profile.type === 's3' && !profile.bucket) throw new Error('S3 bucket is required'); if (profile.type === 'azure' && !profile.container) throw new Error('Azure container is required');
    if (index >= 0) profiles[index] = profile; else profiles.push(profile); this._write(profiles); for (const field of SECRET_FIELDS) if (typeof secrets[field] === 'string' && secrets[field]) this.secretStore.set(`storage:${id}:${field}`, secrets[field]); return { success: true, profile };
  }
  remove(id) { const before = this._read(); this._write(before.filter(item => item.id !== id)); for (const field of SECRET_FIELDS) this.secretStore.remove(`storage:${id}:${field}`); return { success: true, removed: before.some(item => item.id === id) }; }
  resolve(input) { const saved = input?.id ? this._read().find(item => item.id === input.id) : null; const profile = { ...(saved || {}), ...(input || {}) }; if (!TYPES.has(profile.type)) throw new Error('Unknown storage profile'); return profile; }
  secret(profile, field) { return String(this.secretStore.get(`storage:${profile.id}:${field}`) || ''); }
  async _ftp(profile, action) { const client = new ftp.Client(30000); try { await client.access({ host: profile.host, port: profile.port || 21, user: profile.username || 'anonymous', password: this.secret(profile, 'password'), secure: profile.type === 'ftps' }); return await action(client); } finally { client.close(); } }
  _webdav(profile) { return createClient(profile.endpoint, { username: profile.username, password: this.secret(profile, 'password') }); }
  _s3(profile) { return new S3Client({ region: profile.region || 'us-east-1', endpoint: profile.endpoint || undefined, forcePathStyle: Boolean(profile.endpoint), credentials: this.secret(profile, 'accessKeyId') ? { accessKeyId: this.secret(profile, 'accessKeyId'), secretAccessKey: this.secret(profile, 'secretAccessKey'), sessionToken: this.secret(profile, 'sessionToken') || undefined } : undefined }); }
  _azure(profile) { const value = this.secret(profile, 'connectionString'); if (!value) throw new Error('Azure connection string is required'); return BlobServiceClient.fromConnectionString(value).getContainerClient(profile.container); }
  async test(input) { const profile = this.resolve(input); if (['ftp', 'ftps'].includes(profile.type)) await this._ftp(profile, client => client.pwd()); else if (profile.type === 'webdav') await this._webdav(profile).getDirectoryContents(profile.rootPath || '/'); else if (profile.type === 's3') { const client = this._s3(profile); await client.send(new HeadBucketCommand({ Bucket: profile.bucket })); client.destroy(); } else { await this._azure(profile).getProperties(); } return { success: true }; }
  async listFiles(input, directory = '') {
    const profile = this.resolve(input); const requested = directory || profile.rootPath || (['s3', 'azure'].includes(profile.type) ? '' : '/');
    if (['ftp', 'ftps'].includes(profile.type)) return this._ftp(profile, async client => { const target = objectPath(requested); return { path: target, parent: target === '/' ? '' : path.posix.dirname(target), entries: (await client.list(target)).map(item => ({ name: item.name, path: `${target.replace(/\/$/, '')}/${item.name}`, directory: item.isDirectory, size: item.size || 0, modifiedAt: item.modifiedAt?.toISOString() || '' })) }; });
    if (profile.type === 'webdav') { const target = objectPath(requested); const items = await this._webdav(profile).getDirectoryContents(target); return { path: target, parent: target === '/' ? '' : path.posix.dirname(target), entries: items.map(item => ({ name: item.basename, path: item.filename, directory: item.type === 'directory', size: item.size || 0, modifiedAt: item.lastmod || '' })) }; }
    if (profile.type === 's3') { const prefix = objectPath(requested, false).replace(/\/?$/, requested ? '/' : ''); const parent = prefix ? prefix.replace(/\/$/, '').split('/').slice(0, -1).join('/') : ''; const client = this._s3(profile); try { const result = await client.send(new ListObjectsV2Command({ Bucket: profile.bucket, Prefix: prefix, Delimiter: '/' })); return { path: prefix, parent, entries: [...(result.CommonPrefixes || []).map(item => ({ name: item.Prefix.slice(prefix.length).replace(/\/$/, ''), path: item.Prefix, directory: true, size: 0, modifiedAt: '' })), ...(result.Contents || []).filter(item => item.Key !== prefix).map(item => ({ name: item.Key.slice(prefix.length), path: item.Key, directory: false, size: item.Size || 0, modifiedAt: item.LastModified?.toISOString() || '' }))] }; } finally { client.destroy(); } }
    const prefix = objectPath(requested, false).replace(/\/?$/, requested ? '/' : ''); const parent = prefix ? prefix.replace(/\/$/, '').split('/').slice(0, -1).join('/') : ''; const entries = []; for await (const item of this._azure(profile).listBlobsByHierarchy('/', { prefix })) { if (item.kind === 'prefix') entries.push({ name: item.name.slice(prefix.length).replace(/\/$/, ''), path: item.name, directory: true, size: 0, modifiedAt: '' }); else entries.push({ name: item.name.slice(prefix.length), path: item.name, directory: false, size: item.properties.contentLength || 0, modifiedAt: item.properties.lastModified?.toISOString() || '' }); } return { path: prefix, parent, entries };
  }

  async transferLocal(input, direction, localPath, remotePath) {
    const profile = this.resolve(input); const local = path.resolve(String(localPath)); const remote = objectPath(remotePath, !['s3', 'azure'].includes(profile.type));
    if (direction === 'upload' && !fs.statSync(local).isFile()) throw new Error('Cloud upload currently requires a file'); if (direction === 'download') fs.mkdirSync(path.dirname(local), { recursive: true });
    if (['ftp', 'ftps'].includes(profile.type)) return this._ftp(profile, async client => { if (direction === 'upload') await client.uploadFrom(local, remote); else await client.downloadTo(local, remote); return { success: true, files: 1, bytes: fs.statSync(local).size }; });
    if (profile.type === 'webdav') { const client = this._webdav(profile); if (direction === 'upload') await client.putFileContents(remote, fs.createReadStream(local), { overwrite: true }); else fs.writeFileSync(local, Buffer.from(await client.getFileContents(remote, { format: 'binary' }))); return { success: true, files: 1, bytes: fs.statSync(local).size }; }
    if (profile.type === 's3') { const client = this._s3(profile); try { if (direction === 'upload') await client.send(new PutObjectCommand({ Bucket: profile.bucket, Key: remote, Body: fs.createReadStream(local) })); else { const result = await client.send(new GetObjectCommand({ Bucket: profile.bucket, Key: remote })); fs.writeFileSync(local, Buffer.from(await result.Body.transformToByteArray())); } return { success: true, files: 1, bytes: fs.statSync(local).size }; } finally { client.destroy(); } }
    const blob = this._azure(profile).getBlockBlobClient(remote); if (direction === 'upload') await blob.uploadFile(local); else await blob.downloadToFile(local); return { success: true, files: 1, bytes: fs.statSync(local).size };
  }
  async transferRecursive(input, direction, localPath, remotePath, onProgress = () => {}) {
    const local = path.resolve(String(localPath)); let files = 0; let bytes = 0;
    if (direction === 'upload') { const walk = async (source, target) => { const stat = fs.statSync(source); if (stat.isDirectory()) { for (const item of fs.readdirSync(source)) await walk(path.join(source, item), `${String(target).replace(/\/$/, '')}/${item}`); } else { const result = await this.transferLocal(input, 'upload', source, target); files += 1; bytes += result.bytes; onProgress({ name: path.basename(source), files, bytes, transferred: result.bytes, total: result.bytes }); } }; await walk(local, remotePath); }
    else if (direction === 'download') { const walk = async (source, target) => { const listing = await this.listFiles(input, source); fs.mkdirSync(target, { recursive: true }); for (const item of listing.entries) { const destination = path.join(target, item.name); if (item.directory) await walk(item.path, destination); else { const result = await this.transferLocal(input, 'download', destination, item.path); files += 1; bytes += result.bytes; onProgress({ name: item.name, files, bytes, transferred: result.bytes, total: result.bytes }); } } }; await walk(remotePath, local); }
    else throw new Error('Invalid transfer direction'); return { success: true, files, bytes };
  }
  async read(input, remotePath, limit = 8 * 1024 * 1024) {
    const profile = this.resolve(input); const remote = objectPath(remotePath, !['s3', 'azure'].includes(profile.type)); let buffer;
    if (['ftp', 'ftps'].includes(profile.type)) buffer = await this._ftp(profile, async client => { const chunks = []; const sink = new (require('stream').Writable)({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } }); await client.downloadTo(sink, remote); return Buffer.concat(chunks); });
    else if (profile.type === 'webdav') buffer = Buffer.from(await this._webdav(profile).getFileContents(remote, { format: 'binary' }));
    else if (profile.type === 's3') { const client = this._s3(profile); try { const result = await client.send(new GetObjectCommand({ Bucket: profile.bucket, Key: remote })); buffer = Buffer.from(await result.Body.transformToByteArray()); } finally { client.destroy(); } }
    else { const response = await this._azure(profile).getBlobClient(remote).download(); const chunks = []; for await (const chunk of response.readableStreamBody) chunks.push(Buffer.from(chunk)); buffer = Buffer.concat(chunks); }
    if (buffer.length > limit) throw new Error(`Remote file exceeds the ${Math.round(limit / 1024 / 1024)} MB editor limit`);
    return { content: buffer.toString('utf8'), base64: buffer.toString('base64'), size: buffer.length };
  }
  async write(input, remotePath, content) {
    const profile = this.resolve(input); const remote = objectPath(remotePath, !['s3', 'azure'].includes(profile.type)); const buffer = Buffer.from(String(content), 'utf8');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Remote editor limit is 8 MB');
    if (['ftp', 'ftps'].includes(profile.type)) await this._ftp(profile, client => client.uploadFrom(require('stream').Readable.from(buffer), remote));
    else if (profile.type === 'webdav') await this._webdav(profile).putFileContents(remote, buffer, { overwrite: true });
    else if (profile.type === 's3') { const client = this._s3(profile); try { await client.send(new PutObjectCommand({ Bucket: profile.bucket, Key: remote, Body: buffer })); } finally { client.destroy(); } }
    else await this._azure(profile).getBlockBlobClient(remote).uploadData(buffer);
    return { success: true, size: buffer.length };
  }
  async mutate(input, operation, target, destination = '') {
    const profile = this.resolve(input); const remote = objectPath(target, !['s3', 'azure'].includes(profile.type));
    const destinationPath = destination ? objectPath(destination, !['s3', 'azure'].includes(profile.type)) : '';
    if (['ftp', 'ftps'].includes(profile.type)) return this._ftp(profile, async client => { if (operation === 'mkdir') await client.ensureDir(remote); else if (operation === 'delete-file') await client.remove(remote); else if (operation === 'delete-directory') await client.removeDir(remote); else if (operation === 'rename') await client.rename(remote, destinationPath); else throw new Error('Unsupported cloud operation'); return { success: true }; });
    if (profile.type === 'webdav') { const client = this._webdav(profile); if (operation === 'mkdir') await client.createDirectory(remote, { recursive: true }); else if (['delete-file', 'delete-directory'].includes(operation)) await client.deleteFile(remote); else if (operation === 'rename') await client.moveFile(remote, destinationPath); else throw new Error('Unsupported cloud operation'); return { success: true }; }
    if (operation === 'mkdir') return { success: true, virtual: true }; if (profile.type === 's3') { const client = this._s3(profile); try { if (operation === 'rename') { await client.send(new CopyObjectCommand({ Bucket: profile.bucket, CopySource: `${profile.bucket}/${encodeURIComponent(remote).replace(/%2F/g, '/')}`, Key: destinationPath })); await client.send(new DeleteObjectCommand({ Bucket: profile.bucket, Key: remote })); } else if (operation === 'delete-file') await client.send(new DeleteObjectCommand({ Bucket: profile.bucket, Key: remote })); else if (operation === 'delete-directory') { let token; do { const listed = await client.send(new ListObjectsV2Command({ Bucket: profile.bucket, Prefix: `${remote.replace(/\/$/, '')}/`, ContinuationToken: token })); for (const item of listed.Contents || []) await client.send(new DeleteObjectCommand({ Bucket: profile.bucket, Key: item.Key })); token = listed.IsTruncated ? listed.NextContinuationToken : undefined; } while (token); } else throw new Error('Unsupported cloud operation'); } finally { client.destroy(); } }
    else { const container = this._azure(profile); if (operation === 'rename') { const source = container.getBlobClient(remote); const destinationBlob = container.getBlockBlobClient(destinationPath); await destinationBlob.uploadData(await source.downloadToBuffer()); await source.delete(); } else if (operation === 'delete-file') await container.deleteBlob(remote); else if (operation === 'delete-directory') { for await (const item of container.listBlobsFlat({ prefix: `${remote.replace(/\/$/, '')}/` })) await container.deleteBlob(item.name); } else throw new Error('Unsupported cloud operation'); } return { success: true };
  }
}

module.exports = CloudStorageManager;
