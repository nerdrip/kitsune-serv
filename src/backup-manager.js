'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawnSync } = require('child_process');
const { assertSafeSegment, isPathInside } = require('./path-utils');

const DATABASE_SERVICES = Object.freeze(['postgresql', 'mysql', 'mariadb', 'mongodb']);

class BackupManager {
  constructor(appRoot, configManager, downloadManager, dbViewer, activityManager, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.configManager = configManager;
    this.downloadManager = downloadManager;
    this.dbViewer = dbViewer;
    this.activityManager = activityManager;
    this.backupRoot = path.join(this.appRoot, 'backups', 'databases');
    this.metadataPath = path.join(this.appRoot, 'config', 'backups.json');
    this.schedulePath = path.join(this.appRoot, 'config', 'backup-schedules.json');
    this._runner = options.runner || this._runTool.bind(this);
    fs.mkdirSync(this.backupRoot, { recursive: true });
  }

  _readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  _writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, file); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, file); fs.unlinkSync(temp);
    }
  }

  _databaseName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128 || value.includes('\0') || /[\\/]/.test(value)) throw new Error('Invalid database name');
    return value.trim();
  }

  _connection(input) {
    const connection = this.dbViewer._resolveConnection(input);
    if (!DATABASE_SERVICES.includes(connection.type)) throw new Error('Unsupported database type');
    return connection;
  }

  _systemTool(name) {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const result = spawnSync(command, [name], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return '';
    return String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  }

  _tool(connection, purpose) {
    const names = {
      postgresql: purpose === 'backup' ? 'pg_dump' : 'pg_restore',
      mysql: purpose === 'backup' ? 'mysqldump' : 'mysql',
      mariadb: purpose === 'backup' ? 'mariadb-dump' : 'mariadb',
      mongodb: purpose === 'backup' ? 'mongodump' : 'mongorestore'
    };
    const baseName = names[connection.type];
    const executableName = process.platform === 'win32' ? `${baseName}.exe` : baseName;
    const version = connection.version || this.configManager.getActiveProfile(this.configManager.getConfig(), connection.type)?.version;
    if (version && this.downloadManager.isInstalled(connection.type, version)) {
      const root = this.downloadManager.getInstallPath(connection.type, version);
      const candidates = [path.join(root, 'bin', executableName), path.join(root, 'pgsql', 'bin', executableName), path.join(root, executableName)];
      const match = candidates.find(file => fs.existsSync(file));
      if (match) return match;
    }
    const system = this._systemTool(baseName);
    if (system) return system;
    throw new Error(`${baseName} is not available. Install the matching database tools or a managed ${connection.type} version.`);
  }

  _runTool(tool, args, env, options = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile(tool, args, { env, windowsHide: true, timeout: options.timeout || 30 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          error.message = String(stderr || stdout || error.message).trim();
          reject(error);
        } else resolve({ stdout, stderr });
      });
      if (options.stdinFile) {
        const input = fs.createReadStream(options.stdinFile);
        input.on('error', reject);
        input.pipe(child.stdin);
      }
    });
  }

  _spec(connection, database, destination, purpose = 'backup') {
    const tool = this._tool(connection, purpose);
    const common = ['--host', connection.host, '--port', String(connection.port)];
    const env = { ...process.env };
    if (connection.type === 'postgresql') {
      env.PGPASSWORD = connection.password || '';
      if (purpose === 'backup') return { tool, args: [...common, '--username', connection.username || 'postgres', '--format=custom', '--file', destination, database], env, extension: 'dump' };
      return { tool, args: [...common, '--username', connection.username || 'postgres', '--dbname', database, '--clean', '--if-exists', '--no-owner', destination], env };
    }
    if (connection.type === 'mysql' || connection.type === 'mariadb') {
      env.MYSQL_PWD = connection.password || '';
      const user = ['--user', connection.username || 'root'];
      if (purpose === 'backup') return { tool, args: [...common, ...user, '--single-transaction', '--routines', '--events', `--result-file=${destination}`, database], env, extension: 'sql' };
      return { tool, args: [...common, ...user, database], env, stdinFile: destination };
    }
    let cleanupFile = '';
    const auth = connection.username ? ['--username', connection.username, '--authenticationDatabase', 'admin'] : [];
    if (connection.username && connection.password) {
      const privateRoot = path.join(this.appRoot, 'temp', 'database-tools');
      fs.mkdirSync(privateRoot, { recursive: true });
      cleanupFile = path.join(privateRoot, `mongo-auth-${crypto.randomUUID()}.yml`);
      fs.writeFileSync(cleanupFile, `password: ${JSON.stringify(String(connection.password))}\n`, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(cleanupFile, 0o600); } catch {}
      auth.push('--config', cleanupFile);
    }
    const tls = connection.ssl ? ['--tls', ...(connection.rejectUnauthorized === false ? ['--tlsInsecure'] : [])] : [];
    if (purpose === 'backup') return { tool, args: [...common, ...auth, ...tls, '--db', database, `--archive=${destination}`, '--gzip'], env, extension: 'archive.gz', cleanupFile };
    return { tool, args: [...common, ...auth, ...tls, '--db', database, `--archive=${destination}`, '--gzip', '--drop'], env, cleanupFile };
  }

  _metadata() {
    const payload = this._readJson(this.metadataPath, { schemaVersion: 1, backups: [] });
    return { schemaVersion: 1, backups: Array.isArray(payload.backups) ? payload.backups : [] };
  }

  _saveMetadata(payload) {
    payload.backups = payload.backups.slice(-2000);
    this._writeJson(this.metadataPath, payload);
  }

  async create(connectionInput, databaseInput, options = {}) {
    const connection = this._connection(connectionInput);
    const database = this._databaseName(databaseInput);
    const operation = async activity => {
      activity.update({ stage: 'preparing', progress: 5, message: `Preparing ${connection.type} backup` });
      const safeDatabase = database.replace(/[^A-Za-z0-9_.-]+/g, '_');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const directory = path.join(this.backupRoot, connection.type, safeDatabase);
      fs.mkdirSync(directory, { recursive: true });
      const extension = { postgresql: 'dump', mysql: 'sql', mariadb: 'sql', mongodb: 'archive.gz' }[connection.type];
      const destination = path.join(directory, `${safeDatabase}-${stamp}.${extension}`);
      const spec = this._spec(connection, database, destination, 'backup');
      activity.update({ stage: 'dumping', progress: 20, message: `Exporting ${database}` });
      try { await this._runner(spec.tool, spec.args, spec.env, spec); }
      finally { try { if (spec.cleanupFile && fs.existsSync(spec.cleanupFile)) fs.unlinkSync(spec.cleanupFile); } catch {} }
      if (!fs.existsSync(destination)) throw new Error('Database tool finished without creating a backup file');
      const stat = fs.statSync(destination);
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
      const record = {
        id: crypto.randomUUID(), type: connection.type, database,
        connectionName: connection.name, path: destination, size: stat.size, checksum,
        createdAt: new Date().toISOString(), label: String(options.label || '').slice(0, 100), verifiedAt: null
      };
      const metadata = this._metadata(); metadata.backups.push(record); this._saveMetadata(metadata);
      activity.update({ stage: 'verifying', progress: 90, message: 'Verifying checksum' });
      if (options.keep) this.rotate(connection.type, database, Number(options.keep));
      return { success: true, backup: record };
    };
    return this.activityManager.run('database:backup', `Back up ${database}`, { type: connection.type, database }, operation);
  }

  list(filters = {}) {
    let backups = this._metadata().backups.filter(record => record && typeof record.path === 'string');
    if (filters.type) backups = backups.filter(record => record.type === filters.type);
    if (filters.database) backups = backups.filter(record => record.database === filters.database);
    return backups.map(record => ({ ...record, exists: fs.existsSync(record.path) })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  verify(id) {
    const metadata = this._metadata();
    const record = metadata.backups.find(item => item.id === id);
    if (!record || !isPathInside(this.backupRoot, record.path)) return { success: false, error: 'Backup not found' };
    if (!fs.existsSync(record.path)) return { success: false, error: 'Backup file is missing' };
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(record.path)).digest('hex');
    const success = checksum === record.checksum;
    if (success) { record.verifiedAt = new Date().toISOString(); this._saveMetadata(metadata); }
    return { success, checksum, error: success ? undefined : 'Backup checksum does not match' };
  }

  async restore(id, connectionInput, targetDatabase) {
    const metadata = this._metadata();
    const record = metadata.backups.find(item => item.id === id);
    if (!record || !isPathInside(this.backupRoot, record.path) || !fs.existsSync(record.path)) return { success: false, error: 'Backup not found' };
    const verification = this.verify(id);
    if (!verification.success) return verification;
    const connection = this._connection(connectionInput);
    if (connection.type !== record.type) return { success: false, error: 'Backup engine does not match the target connection' };
    const database = this._databaseName(targetDatabase || record.database);
    return this.activityManager.run('database:restore', `Restore ${database}`, { backupId: id, type: connection.type }, async activity => {
      activity.update({ stage: 'restoring', progress: 15, message: `Restoring into ${database}` });
      const spec = this._spec(connection, database, record.path, 'restore');
      try { await this._runner(spec.tool, spec.args, spec.env, spec); }
      finally { try { if (spec.cleanupFile && fs.existsSync(spec.cleanupFile)) fs.unlinkSync(spec.cleanupFile); } catch {} }
      activity.update({ stage: 'checking', progress: 90, message: 'Restore command completed' });
      return { success: true, database, backup: record };
    });
  }

  remove(id) {
    const metadata = this._metadata();
    const index = metadata.backups.findIndex(item => item.id === id);
    if (index < 0) return { success: false, error: 'Backup not found' };
    const [record] = metadata.backups.splice(index, 1);
    if (!isPathInside(this.backupRoot, record.path)) return { success: false, error: 'Unsafe backup path' };
    if (fs.existsSync(record.path)) fs.unlinkSync(record.path);
    this._saveMetadata(metadata);
    return { success: true };
  }

  rotate(type, database, keep = 10) {
    assertSafeSegment(type, 'database type');
    const maximum = Math.max(1, Math.min(1000, Number(keep) || 10));
    const records = this.list({ type, database }).slice(maximum);
    for (const record of records) this.remove(record.id);
    return { success: true, removed: records.length };
  }

  schedules() {
    const data = this._readJson(this.schedulePath, { schemaVersion: 1, schedules: [] });
    return Array.isArray(data.schedules) ? data.schedules : [];
  }

  saveSchedule(input) {
    if (!input || !DATABASE_SERVICES.includes(input.type)) throw new Error('Invalid backup schedule');
    const schedule = {
      id: typeof input.id === 'string' ? input.id : crypto.randomUUID(),
      name: String(input.name || `${input.database} backup`).slice(0, 100),
      type: input.type,
      connectionId: String(input.connectionId || `managed:${input.type}`).slice(0, 200),
      database: this._databaseName(input.database),
      intervalHours: Math.max(1, Math.min(24 * 365, Number(input.intervalHours) || 24)),
      keep: Math.max(1, Math.min(1000, Number(input.keep) || 10)),
      enabled: input.enabled !== false,
      lastRunAt: input.lastRunAt || null,
      nextRunAt: input.nextRunAt || new Date(Date.now() + (Number(input.intervalHours) || 24) * 3600000).toISOString()
    };
    const schedules = this.schedules();
    const index = schedules.findIndex(item => item.id === schedule.id);
    if (index >= 0) schedules[index] = schedule; else schedules.push(schedule);
    this._writeJson(this.schedulePath, { schemaVersion: 1, schedules });
    return schedule;
  }

  removeSchedule(id) {
    const schedules = this.schedules();
    const next = schedules.filter(item => item.id !== id);
    this._writeJson(this.schedulePath, { schemaVersion: 1, schedules: next });
    return { success: true, removed: schedules.length - next.length };
  }

  async runDue() {
    const schedules = this.schedules();
    const results = [];
    for (const schedule of schedules.filter(item => item.enabled && Date.parse(item.nextRunAt) <= Date.now())) {
      try {
        const result = await this.create(schedule.connectionId, schedule.database, { keep: schedule.keep, label: 'scheduled' });
        schedule.lastRunAt = new Date().toISOString();
        schedule.nextRunAt = new Date(Date.now() + schedule.intervalHours * 3600000).toISOString();
        results.push({ id: schedule.id, ...result });
      } catch (error) {
        schedule.lastError = error.message;
        schedule.nextRunAt = new Date(Date.now() + Math.min(schedule.intervalHours, 1) * 3600000).toISOString();
        results.push({ id: schedule.id, success: false, error: error.message });
      }
    }
    this._writeJson(this.schedulePath, { schemaVersion: 1, schedules });
    return results;
  }
}

module.exports = BackupManager;
