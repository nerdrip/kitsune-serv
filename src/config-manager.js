const fs = require('fs');
const path = require('path');

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
      port: 80, host: '0.0.0.0', sslPort: 443, sslEnabled: false, documentRoot: './www',
      serverName: 'localhost', directoryIndex: 'index.html index.htm index.php',
      modRewrite: true, modSsl: false, modProxy: false, modProxyHttp: false,
      modProxyFcgi: true, modHeaders: true, modDeflate: true, modExpires: false,
      modSecurity: false, modPhp: false,
      maxRequestWorkers: 150, serverLimit: 16, keepaliveTimeout: 5,
      maxKeepAliveRequests: 100, timeout: 300, keepAlive: true,
      accessLog: false, errorLog: true, logLevel: 'warn', autoStart: false, autoRestart: false, startAllGroup: false, customConfig: ''
    };
  }

  defaultNginxProfile(version = '1.27.4') {
    return {
      id: this._uid(), name: `Nginx ${version}`, version,
      port: 8080, host: '0.0.0.0', sslPort: 443, sslEnabled: false, documentRoot: './www',
      serverName: 'localhost', autoStart: false, autoRestart: false,
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

  defaultPostgresqlProfile(version = '17.4') {
    return this.defaultDbProfile('postgresql', version);
  }

  defaultMysqlProfile(version = '8.4.4') {
    return this.defaultDbProfile('mysql', version);
  }

  defaultMongodbProfile(version = '7.0.20') {
    return {
      id: this._uid(), name: `mongodb ${version}`, type: 'mongodb', version,
      port: 27017, host: '127.0.0.1',
      dataDir: `./data/mongodb-${version}`, maxConnections: 100, auth: false,
      wiredTigerCacheSizeGB: '',
      autoStart: false, autoRestart: false, startAllGroup: false,
      logging: true, logLevel: 'warning', customConfig: ''
    };
  }

  defaultMariadbProfile(version = '11.4.5') {
    return this.defaultDbProfile('mariadb', version);
  }

  defaultPhpProfile(version = '8.4.20') {
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

  defaultNodeProfile(version = '20.19.0') {
    return {
      id: this._uid(), name: `Node ${version}`, version,
      port: 3000, entryPoint: 'server.js', project: '', env: 'development',
      autoStart: false, autoRestart: true, startAllGroup: false, watchMode: true, inspectPort: 9229, inspectEnabled: false, envVars: []
    };
  }

  defaultGoProfile(version = '1.24.2') {
    return {
      id: this._uid(), name: `Go ${version}`, version,
      port: 8080, entryPoint: 'main.go', project: '', buildFlags: '', env: 'development',
      autoStart: false, autoRestart: false, startAllGroup: false, envVars: []
    };
  }

  defaultBunProfile(version = '1.2.17') {
    return {
      id: this._uid(), name: `Bun ${version}`, version,
      port: 3001, entryPoint: 'server.ts', project: '', env: 'development',
      autoStart: false, autoRestart: true, startAllGroup: false, watchMode: true, envVars: []
    };
  }

  defaultRedisProfile(version = '7.4.8') {
    return {
      id: this._uid(), name: `Redis ${version}`, version,
      port: 6379, host: '127.0.0.1', maxMemory: '256mb', maxMemoryPolicy: 'allkeys-lru',
      databases: 16, appendOnly: false, save: '3600 1 300 100 60 10000',
      logLevel: 'notice', autoStart: false, autoRestart: false, startAllGroup: false, requirePass: '', customConfig: ''
    };
  }

  defaultMemcachedProfile(version = '1.6.32') {
    return {
      id: this._uid(), name: `Memcached ${version}`, version,
      port: 11211, host: '127.0.0.1', maxMemory: 64, threads: 4,
      maxConnections: 1024, verboseLogging: false, autoStart: false, autoRestart: false, startAllGroup: false, customConfig: ''
    };
  }

  defaultPythonProfile(version = '3.13.5') {
    return {
      id: this._uid(), name: `Python ${version}`, version,
      port: 8000, entryPoint: 'app.py', project: '', env: 'development',
      autoStart: false, autoRestart: false, startAllGroup: false, envVars: []
    };
  }

  defaultDenoProfile(version = '2.4.1') {
    return {
      id: this._uid(), name: `Deno ${version}`, version,
      port: 8000, entryPoint: 'main.ts', project: '', env: 'development',
      allowNet: true, allowRead: true, allowWrite: false, allowEnv: true, allowRun: false,
      allowSys: false, allowFfi: false,
      autoStart: false, autoRestart: false, startAllGroup: false, watchMode: true, envVars: []
    };
  }

  defaultCaddyProfile(version = '2.9.1') {
    return {
      id: this._uid(), name: `Caddy ${version}`, version,
      port: 8443, httpPort: 8080, documentRoot: './www',
      serverName: 'localhost', autoHttps: false,
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
      rootUser: 'minioadmin', rootPassword: 'minioadmin',
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
      general: {
        autoStartOnBoot: false, startMinimized: false,
        theme: 'dark', language: 'en', checkUpdates: true, logLevel: 'info',
        stopTimeout: 5000
      }
    };
  }

  getActiveProfile(config, section) {
    const svc = config[section];
    if (!svc || !svc.profiles) return null;
    return svc.profiles.find(p => p.id === svc.activeProfileId) || svc.profiles[0] || null;
  }

  getConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(raw);
        if ((config.httpServer && !config.httpServer.profiles) || (config.database && !config.postgresql) || (config.httpServer && config.httpServer.profiles)) {
          return this._migrateOldConfig(config);
        }
        // Merge defaults for any missing sections (e.g. newly added services)
        const defaults = this.getDefaults();
        for (const key of Object.keys(defaults)) {
          if (!(key in config)) {
            config[key] = defaults[key];
          }
        }
        return config;
      }
    } catch { }
    return this.getDefaults();
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
      this._ensureDir(this.configDir);
      // Backup current config before overwriting
      if (fs.existsSync(this.configPath)) {
        const backupPath = this.configPath + '.bak';
        fs.copyFileSync(this.configPath, backupPath);
      }
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      this._ensureDataDirs(config);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _ensureDataDirs(config) {
    try {
      for (const httpSection of ['apache', 'nginx', 'caddy']) {
        const httpProfile = this.getActiveProfile(config, httpSection);
        if (httpProfile?.documentRoot) this._ensureDir(path.resolve(httpProfile.documentRoot));
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
