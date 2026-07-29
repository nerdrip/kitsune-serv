const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVICE_IDS } = require('./path-utils');

// Support both Electron and standalone Node.js (server mode)
let electronApp = null;
try { electronApp = require('electron').app; } catch {}

class ConfigManager {
  constructor(appRootOverride) {
    if (appRootOverride) {
      this.appRoot = appRootOverride;
    } else if (electronApp) {
      this.appRoot = electronApp.isPackaged ? path.dirname(process.execPath) : electronApp.getAppPath();
    } else {
      this.appRoot = process.cwd();
    }
    this.configDir = path.join(this.appRoot, 'config');
    this.configPath = path.join(this.configDir, 'kitsuneserv.json');
    this._ensureDir(this.configDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ===== Default profile factories =====

  defaultApacheProfile(version = '2.4.66') {
    return {
      id: this._uid(), name: `Apache ${version}`, version,
      port: 80, host: '127.0.0.1', sslPort: 443, sslEnabled: false, documentRoot: './www',
      serverName: 'localhost', directoryIndex: 'index.html index.htm index.php',
      sslCertificate: '', sslCertificateKey: '',
      modRewrite: true, modSsl: false, modProxy: false, modProxyHttp: false,
      modProxyFcgi: true, modHeaders: true, modDeflate: true, modExpires: false,
      modSecurity: false, modPhp: false,
      maxRequestWorkers: 150, serverLimit: 16, keepaliveTimeout: 5,
      maxKeepAliveRequests: 100, timeout: 300, keepAlive: true,
      accessLog: false, errorLog: true, logLevel: 'warn', autoStart: false, autoRestart: false, startAllGroup: false, customConfig: ''
    };
  }

  defaultNginxProfile(version = '1.30.4') {
    return {
      id: this._uid(), name: `Nginx ${version}`, version,
      port: 8080, host: '127.0.0.1', sslPort: 443, sslEnabled: false, documentRoot: './www',
      serverName: 'localhost', phpEnabled: true, autoStart: false, autoRestart: false,
      sslCertificate: '', sslCertificateKey: '',
      // Reverse proxy settings
      reverseProxy: false, upstreamName: 'backend', upstreamServer: '127.0.0.1', upstreamPort: 3000,
      loadBalancing: 'round_robin',
      proxyPass: '', proxyConnectTimeout: 60, proxyReadTimeout: 60, proxySendTimeout: 60,
      proxyBuffering: true, proxyBufferSize: '4k',
      headerRealIp: true, headerForwardedFor: true, headerForwardedProto: true,
      headerHost: true, websocket: false, corsEnabled: false,
      // Performance — optimized for local dev
      workerProcesses: 'auto', workerConnections: 1024, keepaliveTimeout: 30,
      clientMaxBodySize: '128m', gzip: true, sendfile: true,
      // Rate limiting
      rateLimitEnabled: false, rateLimitRate: '10r/s', rateLimitBurst: 20,
      // Caching
      proxyCacheEnabled: false, proxyCacheValid: '60m', proxyCachePath: '',
      accessLog: false, errorLog: true, startAllGroup: false, customConfig: ''
    };
  }

  defaultDbProfile(type = 'postgresql', version = '16.2') {
    const portMap = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017, sqlite: 0 };
    const userMap = { postgresql: 'kitsuneserv', mysql: 'root', mariadb: 'root' };
    const base = {
      id: this._uid(), name: `${type} ${version}`, type, version,
      port: portMap[type] || 5432, host: '127.0.0.1', username: userMap[type] || 'root',
      password: '',
      dataDir: `./data/${type}-${version}`, maxConnections: 100,
      autoStart: false, autoRestart: false, startAllGroup: false,
      logging: true, logLevel: 'warning', customConfig: ''
    };
    if (type === 'postgresql') {
      base.sharedBuffers = '256MB';
      base.workMem = '8MB';
      base.maintenanceWorkMem = '128MB';
      base.walLevel = 'replica';
      base.effectiveCacheSize = '512MB';
    } else {
      // MySQL / MariaDB specific
      base.innodbBufferPoolSize = '256M';
      base.innodbLogFileSize = '64M';
      base.keyBufferSize = '32M';
      base.sortBufferSize = '4M';
      if (type === 'mariadb') base.queryCache = true;
    }
    return base;
  }

  defaultPostgresqlProfile(version = '18.4') {
    return this.defaultDbProfile('postgresql', version);
  }

  defaultMysqlProfile(version = '8.4.10') {
    return this.defaultDbProfile('mysql', version);
  }

  defaultMongodbProfile(version = '8.0.6') {
    return {
      id: this._uid(), name: `mongodb ${version}`, type: 'mongodb', version,
      port: 27017, host: '127.0.0.1',
      dataDir: `./data/mongodb-${version}`, maxConnections: 100, auth: false,
      wiredTigerCacheSizeGB: '',
      autoStart: false, autoRestart: false, startAllGroup: false,
      logging: true, logLevel: 'warning', customConfig: ''
    };
  }

  defaultMariadbProfile(version = '12.3.2') {
    return this.defaultDbProfile('mariadb', version);
  }

  defaultPhpProfile(version = '8.5.9') {
    return {
      id: this._uid(), name: `PHP ${version}`, version,
      port: 9000, autoStart: false, autoRestart: false,
      maxExecutionTime: 120, memoryLimit: '512M',
      uploadMaxFilesize: '128M', postMaxSize: '128M', displayErrors: true,
      errorReporting: 'E_ALL', timezone: 'UTC', opcache: true, opcacheMemory: 256,
      fpmMaxChildren: 5, fpmStartServers: 2, fpmMinSpare: 1, fpmMaxSpare: 3,
      extensions: [
        { name: 'bcmath', enabled: true }, { name: 'ctype', enabled: true },
        { name: 'curl', enabled: true }, { name: 'dom', enabled: true },
        { name: 'fileinfo', enabled: true }, { name: 'filter', enabled: true },
        { name: 'gd', enabled: true }, { name: 'hash', enabled: true },
        { name: 'json', enabled: true }, { name: 'mbstring', enabled: true },
        { name: 'openssl', enabled: true }, { name: 'pcre', enabled: true },
        { name: 'mysqli', enabled: true }, { name: 'pdo_mysql', enabled: true },
        { name: 'pgsql', enabled: true }, { name: 'pdo_pgsql', enabled: true },
        { name: 'pdo_sqlite', enabled: true }, { name: 'sqlite3', enabled: true }, { name: 'phar', enabled: true },
        { name: 'session', enabled: true }, { name: 'simplexml', enabled: true },
        { name: 'tokenizer', enabled: true }, { name: 'xml', enabled: true },
        { name: 'zip', enabled: true }, { name: 'zlib', enabled: true },
        { name: 'intl', enabled: true }, { name: 'opcache', enabled: true },
        { name: 'sodium', enabled: true }, { name: 'exif', enabled: false },
        { name: 'redis', enabled: false }, { name: 'imagick', enabled: false },
        { name: 'xdebug', enabled: false }
      ],
      xdebug: { mode: 'debug', startWithRequest: 'yes', clientPort: 9003, clientHost: '127.0.0.1' },
      startAllGroup: false, customIni: ''
    };
  }

  defaultNodeProfile(version = '24.18.0') {
    return {
      id: this._uid(), name: `Node ${version}`, version,
      port: 3000, entryPoint: 'server.js', project: '', env: 'development',
      autoStart: false, autoRestart: true, startAllGroup: false, watchMode: true, inspectPort: 9229, inspectEnabled: false, envVars: []
    };
  }

  defaultGoProfile(version = '1.26.5') {
    return {
      id: this._uid(), name: `Go ${version}`, version,
      port: 8080, entryPoint: 'main.go', project: '', buildFlags: '', env: 'development',
      autoStart: false, autoRestart: false, startAllGroup: false, envVars: []
    };
  }

  defaultBunProfile(version = '1.3.14') {
    return {
      id: this._uid(), name: `Bun ${version}`, version,
      port: 3001, entryPoint: 'server.ts', project: '', env: 'development',
      autoStart: false, autoRestart: true, startAllGroup: false, watchMode: true, envVars: []
    };
  }

  defaultRedisProfile(version = '8.8.1') {
    return {
      id: this._uid(), name: `Redis ${version}`, version,
      port: 6379, host: '127.0.0.1', maxMemory: '256mb', maxMemoryPolicy: 'allkeys-lru',
      databases: 16, appendOnly: false, save: '3600 1 300 100 60 10000',
      logLevel: 'notice', autoStart: false, autoRestart: false, startAllGroup: false, requirePass: '', customConfig: ''
    };
  }

  defaultMemcachedProfile(version = '1.6.8') {
    return {
      id: this._uid(), name: `Memcached ${version}`, version,
      port: 11211, host: '127.0.0.1', maxMemory: 64, threads: 4,
      maxConnections: 1024, verboseLogging: false, autoStart: false, autoRestart: false, startAllGroup: false, customConfig: ''
    };
  }

  defaultPythonProfile(version = '3.14.3') {
    return {
      id: this._uid(), name: `Python ${version}`, version,
      port: 8000, entryPoint: 'app.py', project: '', env: 'development',
      autoStart: false, autoRestart: false, startAllGroup: false, envVars: []
    };
  }

  defaultDenoProfile(version = '2.9.4') {
    return {
      id: this._uid(), name: `Deno ${version}`, version,
      port: 8000, entryPoint: 'main.ts', project: '', env: 'development',
      allowNet: true, allowRead: true, allowWrite: false, allowEnv: true, allowRun: false,
      allowSys: false, allowFfi: false,
      autoStart: false, autoRestart: false, startAllGroup: false, watchMode: true, envVars: []
    };
  }

  defaultCaddyProfile(version = '2.11.4') {
    return {
      id: this._uid(), name: `Caddy ${version}`, version,
      port: 8443, httpPort: 8080, documentRoot: './www',
      serverName: 'localhost', autoHttps: false, phpEnabled: true,
      sslCertificate: '', sslCertificateKey: '',
      reverseProxy: '', reverseProxyTarget: '',
      fileServer: true, encode: true,
      accessLog: false, corsEnabled: false, logLevel: 'INFO',
      autoStart: false, autoRestart: false, startAllGroup: false, customConfig: ''
    };
  }

  defaultMinioProfile(version = 'latest') {
    return {
      id: this._uid(), name: `MinIO ${version}`, version,
      port: 9000, consolePort: 9001, host: '127.0.0.1',
      dataDir: `./data/minio-${version}`,
      rootUser: 'kitsune', rootPassword: crypto.randomBytes(18).toString('base64url'),
      browserEnabled: true,
      autoStart: false, autoRestart: false, startAllGroup: false
    };
  }

  getDefaults() {
    const apache = this.defaultApacheProfile();
    const nginx = this.defaultNginxProfile();
    const pg = this.defaultPostgresqlProfile();
    const mysql = this.defaultMysqlProfile();
    const mariadb = this.defaultMariadbProfile();
    const mongodb = this.defaultMongodbProfile();
    const php = this.defaultPhpProfile();
    const node = this.defaultNodeProfile();
    const go = this.defaultGoProfile();
    const bun = this.defaultBunProfile();
    const redis = this.defaultRedisProfile();
    const memcached = this.defaultMemcachedProfile();
    const python = this.defaultPythonProfile();
    const deno = this.defaultDenoProfile();
    const caddy = this.defaultCaddyProfile();
    const minio = this.defaultMinioProfile();

    return {
      apache:      { enabled: true, activeProfileId: apache.id, profiles: [apache] },
      nginx:       { enabled: true, activeProfileId: nginx.id, profiles: [nginx] },
      caddy:       { enabled: true, activeProfileId: caddy.id, profiles: [caddy] },
      postgresql:  { enabled: true, activeProfileId: pg.id, profiles: [pg] },
      mysql:       { enabled: true, activeProfileId: mysql.id, profiles: [mysql] },
      mariadb:     { enabled: true, activeProfileId: mariadb.id, profiles: [mariadb] },
      mongodb:     { enabled: true, activeProfileId: mongodb.id, profiles: [mongodb] },
      php:         { enabled: true, activeProfileId: php.id,  profiles: [php] },
      node:        { enabled: true, activeProfileId: node.id, profiles: [node] },
      go:          { enabled: true, activeProfileId: go.id,   profiles: [go] },
      bun:         { enabled: true, activeProfileId: bun.id,  profiles: [bun] },
      redis:       { enabled: true, activeProfileId: redis.id, profiles: [redis] },
      memcached:   { enabled: true, activeProfileId: memcached.id, profiles: [memcached] },
      minio:       { enabled: true, activeProfileId: minio.id, profiles: [minio] },
      python:      { enabled: true, activeProfileId: python.id, profiles: [python] },
      deno:        { enabled: true, activeProfileId: deno.id, profiles: [deno] },
      databaseManager: { connections: [] },
      general: {
        autoStartOnBoot: false, startMinimized: false,
        theme: 'dark', language: 'en', checkUpdates: true, logLevel: 'info',
        stopTimeout: 5000, pathServices: [], pathSelectionInitialized: false,
        forceGlobalDocumentRoot: false, globalDocumentRoot: './www', offlineCache: true
      }
    };
  }

  getActiveProfile(config, section) {
    const svc = config[section];
    if (!svc || !svc.profiles) return null;
    return svc.profiles.find(p => p.id === svc.activeProfileId) || svc.profiles[0] || null;
  }

  getConfig() {
    const candidates = [this.configPath, `${this.configPath}.bak`];
    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) continue;
        const config = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (!config || typeof config !== 'object' || Array.isArray(config)) continue;
        if ((config.httpServer && !config.httpServer.profiles) || (config.database && !config.postgresql) || (config.httpServer && config.httpServer.profiles)) {
          return this._migrateOldConfig(config);
        }
        const normalized = this._mergeWithDefaults(config);
        if (candidate.endsWith('.bak')) this.saveConfig(normalized);
        return normalized;
      } catch {
        // Try the backup before falling back to a fresh configuration.
      }
    }
    const defaults = this.getDefaults();
    this.saveConfig(defaults);
    return defaults;
  }

  _mergeWithDefaults(config) {
    const defaults = this.getDefaults();
    const factories = {
      apache: 'defaultApacheProfile', nginx: 'defaultNginxProfile', caddy: 'defaultCaddyProfile',
      postgresql: 'defaultPostgresqlProfile', mysql: 'defaultMysqlProfile', mariadb: 'defaultMariadbProfile', mongodb: 'defaultMongodbProfile',
      php: 'defaultPhpProfile', node: 'defaultNodeProfile', go: 'defaultGoProfile', bun: 'defaultBunProfile',
      redis: 'defaultRedisProfile', memcached: 'defaultMemcachedProfile', minio: 'defaultMinioProfile',
      python: 'defaultPythonProfile', deno: 'defaultDenoProfile'
    };

    const merged = { ...config };
    for (const section of SERVICE_IDS) {
      const source = config[section];
      if (!source || typeof source !== 'object' || !Array.isArray(source.profiles) || source.profiles.length === 0) {
        merged[section] = defaults[section];
        continue;
      }
      const factory = factories[section];
      const profiles = source.profiles
        .filter(profile => profile && typeof profile === 'object' && !Array.isArray(profile))
        .map(profile => {
          const base = this[factory](profile.version);
          const result = { ...base, ...profile };
          if (base.xdebug || profile.xdebug) result.xdebug = { ...(base.xdebug || {}), ...(profile.xdebug || {}) };
          return result;
        });
      if (!profiles.length) {
        merged[section] = defaults[section];
        continue;
      }
      const activeProfileId = profiles.some(profile => profile.id === source.activeProfileId)
        ? source.activeProfileId
        : profiles[0].id;
      merged[section] = { ...defaults[section], ...source, profiles, activeProfileId, enabled: source.enabled !== false };
    }
    merged.general = { ...defaults.general, ...(config.general && typeof config.general === 'object' ? config.general : {}) };
    merged.databaseManager = {
      ...defaults.databaseManager,
      ...(config.databaseManager && typeof config.databaseManager === 'object' ? config.databaseManager : {}),
      connections: Array.isArray(config.databaseManager?.connections) ? config.databaseManager.connections : []
    };
    return merged;
  }

  _migrateOldConfig(old) {
    const defaults = this.getDefaults();
    const sections = ['apache', 'nginx', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'redis'];
    for (const section of sections) {
      if (old[section] && !old[section].profiles) {
        const oldSvc = { ...old[section] };
        const enabled = oldSvc.enabled;
        delete oldSvc.enabled;
        const profile = { id: this._uid(), name: `${section} (migrated)`, ...oldSvc };
        defaults[section] = {
          enabled: enabled !== undefined ? enabled : defaults[section].enabled,
          activeProfileId: profile.id,
          profiles: [profile]
        };
      } else if (old[section] && old[section].profiles) {
        defaults[section] = old[section];
      }
    }

    // Migrate old httpServer section to apache + nginx
    if (old.httpServer && old.httpServer.profiles) {
      for (const profile of old.httpServer.profiles) {
        if (profile.type === 'apache') {
          defaults.apache.profiles.push({ ...profile, id: this._uid(), name: profile.name || `Apache ${profile.version}` });
        } else if (profile.type === 'nginx') {
          defaults.nginx.profiles.push({ ...profile, id: this._uid(), name: profile.name || `Nginx ${profile.version}` });
        }
      }
      // Set active profile from the migrated data
      const activeProfile = old.httpServer.profiles.find(p => p.id === old.httpServer.activeProfileId);
      if (activeProfile?.type === 'apache' && defaults.apache.profiles.length > 1) {
        defaults.apache.activeProfileId = defaults.apache.profiles[defaults.apache.profiles.length - 1].id;
      } else if (activeProfile?.type === 'nginx' && defaults.nginx.profiles.length > 1) {
        defaults.nginx.activeProfileId = defaults.nginx.profiles[defaults.nginx.profiles.length - 1].id;
      }
    } else if (old.httpServer && !old.httpServer.profiles) {
      const oldSvc = { ...old.httpServer };
      delete oldSvc.enabled;
      if (oldSvc.type === 'apache') {
        const profile = { id: this._uid(), name: 'Apache (migrated)', ...oldSvc };
        defaults.apache = { enabled: true, activeProfileId: profile.id, profiles: [profile] };
      } else {
        const profile = { id: this._uid(), name: 'Nginx (migrated)', ...oldSvc };
        defaults.nginx = { enabled: true, activeProfileId: profile.id, profiles: [profile] };
      }
    }

    // Migrate old combined "database" section to postgresql
    if (old.database && !old.postgresql) {
      if (old.database.profiles) {
        defaults.postgresql = old.database;
      } else {
        const oldSvc = { ...old.database };
        const enabled = oldSvc.enabled;
        delete oldSvc.enabled;
        const profile = { id: this._uid(), name: 'database (migrated)', ...oldSvc };
        defaults.postgresql = {
          enabled: enabled !== undefined ? enabled : true,
          activeProfileId: profile.id,
          profiles: [profile]
        };
      }
    }
    if (old.general) defaults.general = old.general;
    this.saveConfig(defaults);
    return defaults;
  }

  saveConfig(config) {
    try {
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid configuration');
      const normalized = this._mergeWithDefaults(config);
      this._ensureDir(this.configDir);
      // Backup current config before overwriting
      if (fs.existsSync(this.configPath)) {
        const backupPath = this.configPath + '.bak';
        fs.copyFileSync(this.configPath, backupPath);
      }
      const tempPath = `${this.configPath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempPath, this.configPath);
      this._ensureDataDirs(normalized);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _ensureDataDirs(config) {
    try {
      const globalDocumentRoot = config.general?.forceGlobalDocumentRoot
        ? config.general.globalDocumentRoot
        : null;
      for (const httpSection of ['apache', 'nginx', 'caddy']) {
        const httpProfile = this.getActiveProfile(config, httpSection);
        const documentRoot = globalDocumentRoot || httpProfile?.documentRoot;
        if (documentRoot) this._ensureDir(path.resolve(documentRoot));
      }
      for (const dbSection of ['postgresql', 'mysql', 'mariadb', 'mongodb', 'minio']) {
        const dbProfile = this.getActiveProfile(config, dbSection);
        if (dbProfile?.dataDir) this._ensureDir(path.resolve(dbProfile.dataDir));
      }
    } catch { }
  }

  resetConfig() {
    const defaults = this.getDefaults();
    return this.saveConfig(defaults);
  }
}

module.exports = ConfigManager;
