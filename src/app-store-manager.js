const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');
const crypto = require('crypto');
const { resolveInside, assertSafeSegment } = require('./path-utils');

/**
 * App Store Manager — installs and manages web applications
 * (phpMyAdmin, Adminer, WordPress, etc.) into the www/ directory.
 * Supports: zip, tar.gz, single-file, single-exe, composer, git clone.
 */
class AppStoreManager {
  constructor(downloadManager, configManager, dbViewer, serviceManager) {
    this.downloadManager = downloadManager;
    this.configManager = configManager;
    this.dbViewer = dbViewer;
    this.serviceManager = serviceManager;
    this.appRoot = downloadManager?.getAppRoot?.() || process.cwd();
    this.wwwDir = path.join(this.appRoot, 'www');
    this.appsDir = path.join(this.wwwDir, 'apps');
    this.customAppsFile = path.join(this.appRoot, 'config', 'custom-apps.json');
    this.instancesFile = path.join(this.appRoot, 'config', 'instances.json');
    this.adminerDir = path.join(this.appRoot, 'utils', 'adminer');
    this._ensureDir(this.appsDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _resolveAppDir(instanceName) {
    assertSafeSegment(instanceName, 'instance name');
    return resolveInside(this.appsDir, instanceName);
  }

  // ===== Instance tracking =====

  _loadInstances() {
    try {
      if (fs.existsSync(this.instancesFile)) {
        return JSON.parse(fs.readFileSync(this.instancesFile, 'utf-8'));
      }
    } catch {}
    return {};
  }

  _saveInstances(instances) {
    fs.writeFileSync(this.instancesFile, JSON.stringify(instances, null, 2), 'utf-8');
  }

  _addInstance(instanceName, appId, dbName) {
    const instances = this._loadInstances();
    instances[instanceName] = { appId, dbName: dbName || '', createdAt: new Date().toISOString() };
    this._saveInstances(instances);
  }

  _removeInstance(instanceName) {
    const instances = this._loadInstances();
    delete instances[instanceName];
    this._saveInstances(instances);
  }

  _getInstancesForApp(appId) {
    const instances = this._loadInstances();
    return Object.entries(instances)
      .filter(([, v]) => v.appId === appId)
      .map(([name, v]) => ({ instanceName: name, ...v }));
  }

  // ===== Built-in DB tools =====

  /**
   * Ensures Adminer is available in www/adminer/.
   * Downloads it automatically if not present.
   */
  async ensureAdminer() {
    this._ensureDir(this.adminerDir);
    const adminerPhp = path.join(this.adminerDir, 'adminer.php');
    const indexPhp = path.join(this.adminerDir, 'index.php');

    const wrapper = [
      '<?php',
      'error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE & ~E_DEPRECATED);',
      'function adminer_object() {',
      '    class KitsuneAdminer extends Adminer {',
      '        function login($login, $password) { return true; }',
      '    }',
      '    return new KitsuneAdminer;',
      '}',
      "require __DIR__ . '/adminer.php';",
    ].join('\n');

    // Always ensure index.php has the passwordless wrapper
    if (fs.existsSync(indexPhp)) {
      const current = fs.readFileSync(indexPhp, 'utf-8');
      if (!current.includes('error_reporting')) {
        fs.writeFileSync(indexPhp, wrapper, 'utf-8');
      }
    }

    if (fs.existsSync(adminerPhp)) return true;

    try {
      const url = 'https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php';
      await this.downloadManager._downloadFile(url, adminerPhp);
      fs.writeFileSync(indexPhp, wrapper, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if Adminer is installed.
   */
  isAdminerInstalled() {
    return fs.existsSync(path.join(this.adminerDir, 'adminer.php'));
  }

  /**
   * Returns URL to open a database management tool for a specific DB section and database.
   * Prefers phpMyAdmin for MySQL/MariaDB if installed; falls back to Adminer.
   * For PostgreSQL/MongoDB, always uses Adminer.
   */
  getDbToolUrl(section, database) {
    const config = this.configManager.getConfig();
    let webPort = 80;
    // Use the port of whichever web server is actually running
    for (const svc of ['nginx', 'apache', 'caddy']) {
      const status = this.serviceManager.getServiceStatus(svc);
      if (status?.running) {
        const profile = this.configManager.getActiveProfile(config, svc);
        if (profile && profile.port) { webPort = profile.port; break; }
      }
    }

    const dbProfile = this.configManager.getActiveProfile(config, section);
    const dbHost = dbProfile?.host || '127.0.0.1';
    const dbPort = dbProfile?.port || (section === 'postgresql' ? 5432 : section === 'mongodb' ? 27017 : 3306);
    const dbUser = dbProfile?.username || (section === 'postgresql' ? 'postgres' : 'root');

    // Check if phpMyAdmin is installed (any instance) for MySQL/MariaDB
    if (section === 'mysql' || section === 'mariadb') {
      const instances = this._loadInstances();
      const pmaInstance = Object.entries(instances).find(([, v]) => v.appId === 'phpmyadmin');
      if (pmaInstance) {
        const [instName] = pmaInstance;
        const dbParam = database ? `&db=${encodeURIComponent(database)}` : '';
        return {
          tool: 'phpMyAdmin',
          url: `http://localhost:${webPort}/apps/${instName}/index.php?server=1${dbParam}`
        };
      }
    }

    // Fallback: Adminer (works for all DB types)
    if (!this.isAdminerInstalled()) return null;

    const driverMap = {
      mysql: 'server',
      mariadb: 'server',
      postgresql: 'pgsql',
      mongodb: 'mongo'
    };
    const driver = driverMap[section] || 'server';
    const dbParam = database ? `&db=${encodeURIComponent(database)}` : '';
    return {
      tool: 'Adminer',
      url: `http://localhost:${webPort}/adminer/index.php?${driver}=${dbHost}%3A${dbPort}&username=${encodeURIComponent(dbUser)}${dbParam}`
    };
  }

  /**
   * Returns the full catalog of installable apps (built-in + custom).
   */
  getCatalog() {
    const builtIn = [
      // --- Database Tools ---
      {
        id: 'phpmyadmin',
        name: 'phpMyAdmin',
        description: 'Web-based MySQL/MariaDB administration tool',
        icon: '🗄️',
        category: 'Database Tools',
        version: '5.2.2',
        url: 'https://files.phpmyadmin.net/phpMyAdmin/5.2.2/phpMyAdmin-5.2.2-all-languages.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb'],
        database: 'phpmyadmin',
        entryPoint: 'index.php',
        configFiles: [{ template: 'phpmyadmin-config', dest: 'config.inc.php' }]
      },
      {
        id: 'adminer',
        name: 'Adminer',
        description: 'Lightweight database manager in a single PHP file (MySQL, PostgreSQL, SQLite, MongoDB)',
        icon: '🔧',
        category: 'Database Tools',
        version: '4.8.1',
        url: 'https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php',
        type: 'single-file',
        requires: ['php'],
        entryPoint: 'adminer-4.8.1.php',
        configFiles: []
      },
      // --- CMS ---
      {
        id: 'wordpress',
        name: 'WordPress',
        description: 'The world\'s most popular content management system',
        icon: '📝',
        category: 'CMS',
        version: '6.7',
        url: 'https://wordpress.org/latest.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb'],
        database: 'wordpress',
        entryPoint: 'index.php',
        configFiles: [{ template: 'wordpress-config', dest: 'wp-config.php' }]
      },
      {
        id: 'drupal',
        name: 'Drupal',
        description: 'Enterprise-level CMS and digital experience platform',
        icon: '💧',
        category: 'CMS',
        version: '11.1',
        url: 'https://ftp.drupal.org/files/projects/drupal-11.1.1.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb|postgresql'],
        database: 'drupal',
        entryPoint: 'index.php',
        configFiles: []
      },
      {
        id: 'joomla',
        name: 'Joomla',
        description: 'Flexible CMS for building websites and applications',
        icon: '🟠',
        category: 'CMS',
        version: '5.2',
        url: 'https://downloads.joomla.org/cms/joomla5/5-2-4/Joomla_5-2-4-Stable-Full_Package.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb'],
        database: 'joomla',
        entryPoint: 'index.php',
        configFiles: []
      },
      {
        id: 'prestashop',
        name: 'PrestaShop',
        description: 'Open-source e-commerce platform for online stores',
        icon: '🛒',
        category: 'CMS',
        version: '8.2.0',
        url: 'https://github.com/PrestaShop/PrestaShop/releases/download/8.2.0/prestashop_8.2.0.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb'],
        database: 'prestashop',
        entryPoint: 'index.php',
        configFiles: []
      },
      // --- Frameworks ---
      {
        id: 'laravel',
        name: 'Laravel',
        description: 'PHP framework for web artisans (via create-project)',
        icon: '🔺',
        category: 'Frameworks',
        version: 'latest',
        url: '',
        type: 'composer',
        composerPackage: 'laravel/laravel',
        requires: ['php'],
        database: 'laravel',
        entryPoint: 'public/index.php',
        configFiles: [{ template: 'laravel-env', dest: '.env' }]
      },
      {
        id: 'symfony',
        name: 'Symfony',
        description: 'Professional PHP framework for web applications',
        icon: '⚫',
        category: 'Frameworks',
        version: 'latest',
        url: '',
        type: 'composer',
        composerPackage: 'symfony/skeleton',
        requires: ['php'],
        entryPoint: 'public/index.php',
        configFiles: []
      },
      // --- Tools ---
      {
        id: 'filebrowser',
        name: 'File Browser',
        description: 'Web-based file manager with upload, download, and editing',
        icon: '📂',
        category: 'Tools',
        version: '2.31.2',
        url: 'https://github.com/filebrowser/filebrowser/releases/download/v2.31.2/windows-amd64-filebrowser.zip',
        type: 'zip-exe',
        requires: [],
        entryPoint: '',
        port: 8090,
        configFiles: []
      },
      {
        id: 'mailpit',
        name: 'Mailpit',
        description: 'Email testing tool — catches all outgoing SMTP mail',
        icon: '📧',
        category: 'Tools',
        version: '1.21.8',
        url: 'https://github.com/axllent/mailpit/releases/download/v1.21.8/mailpit-windows-amd64.zip',
        type: 'zip-exe',
        requires: [],
        entryPoint: '',
        port: 8025,
        smtpPort: 1025,
        configFiles: []
      },
      // --- Analytics ---
      {
        id: 'matomo',
        name: 'Matomo',
        description: 'Open-source web analytics platform (Google Analytics alternative)',
        icon: '📊',
        category: 'Analytics',
        version: '5.2.1',
        url: 'https://builds.matomo.org/matomo-5.2.1.zip',
        type: 'zip',
        requires: ['php', 'mysql|mariadb'],
        database: 'matomo',
        entryPoint: 'index.php',
        configFiles: []
      },
      // --- Email ---
      {
        id: 'roundcube',
        name: 'Roundcube',
        description: 'Web-based IMAP email client with modern interface',
        icon: '✉️',
        category: 'Email',
        version: '1.6.9',
        url: 'https://github.com/roundcube/roundcubemail/releases/download/1.6.9/roundcubemail-1.6.9-complete.tar.gz',
        type: 'tar.gz',
        requires: ['php', 'mysql|mariadb|postgresql'],
        database: 'roundcube',
        entryPoint: 'index.php',
        configFiles: []
      },
      // --- DevOps ---
      {
        id: 'gitea',
        name: 'Gitea',
        description: 'Lightweight self-hosted Git service',
        icon: '🍵',
        category: 'DevOps',
        version: '1.22.6',
        url: 'https://dl.gitea.com/gitea/1.22.6/gitea-1.22.6-windows-4.0-amd64.exe',
        type: 'single-exe',
        requires: [],
        entryPoint: '',
        port: 3000,
        configFiles: []
      }
    ];

    // Merge custom (user-added) apps
    const custom = this._loadCustomApps();
    return [...builtIn, ...custom];
  }

  // ===== Custom Apps (Git repos added by user) =====

  _loadCustomApps() {
    try {
      if (fs.existsSync(this.customAppsFile)) {
        return JSON.parse(fs.readFileSync(this.customAppsFile, 'utf-8'));
      }
    } catch {}
    return [];
  }

  _saveCustomApps(apps) {
    fs.writeFileSync(this.customAppsFile, JSON.stringify(apps, null, 2), 'utf-8');
  }

  /**
   * Add a custom app from a Git URL
   * @param {object} opts - { name, gitUrl, branch, requires, database, entryPoint, category }
   */
  addCustomApp(opts) {
    const id = opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!id) return { success: false, error: 'Invalid app name' };

    const catalog = this.getCatalog();
    if (catalog.find(a => a.id === id)) return { success: false, error: 'An app with this name already exists' };

    const appDef = {
      id,
      name: opts.name,
      description: opts.description || `Custom app from ${opts.gitUrl}`,
      icon: '🔗',
      category: opts.category || 'Custom',
      version: opts.branch || 'main',
      url: opts.gitUrl,
      type: 'git',
      gitUrl: opts.gitUrl,
      gitBranch: opts.branch || 'main',
      requires: opts.requires || [],
      database: opts.database || '',
      entryPoint: opts.entryPoint || 'index.php',
      configFiles: [],
      custom: true
    };

    const custom = this._loadCustomApps();
    custom.push(appDef);
    this._saveCustomApps(custom);
    return { success: true, app: appDef };
  }

  removeCustomApp(appId) {
    const custom = this._loadCustomApps();
    const idx = custom.findIndex(a => a.id === appId);
    if (idx === -1) return { success: false, error: 'Custom app not found' };
    custom.splice(idx, 1);
    this._saveCustomApps(custom);
    return { success: true };
  }

  // ===== Status queries =====

  getInstalledApps() {
    const catalog = this.getCatalog();
    const instances = this._loadInstances();
    const installed = [];

    // Return installed instances with catalog data
    for (const [instanceName, info] of Object.entries(instances)) {
      const appDef = catalog.find(a => a.id === info.appId);
      if (!appDef) continue;
      let appDir;
      try { appDir = this._resolveAppDir(instanceName); } catch { continue; }
      if (fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0) {
        installed.push({
          ...appDef,
          instanceName,
          dbName: info.dbName,
          installed: true,
          path: appDir,
          size: this._dirSizeMB(appDir)
        });
      }
    }

    // Also detect legacy installs (folders matching appId without instance record)
    for (const appDef of catalog) {
      const appDir = this._resolveAppDir(appDef.id);
      if (fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0) {
        if (!instances[appDef.id]) {
          // Migrate: register as instance
          this._addInstance(appDef.id, appDef.id, appDef.database || '');
          installed.push({
            ...appDef,
            instanceName: appDef.id,
            dbName: appDef.database || '',
            installed: true,
            path: appDir,
            size: this._dirSizeMB(appDir)
          });
        }
      }
    }
    return installed;
  }

  getCatalogWithStatus() {
    const catalog = this.getCatalog();
    const instances = this._loadInstances();
    return catalog.map(app => {
      const appInstances = Object.entries(instances)
        .filter(([, value]) => value?.appId === app.id)
        .map(([instanceName, value]) => ({ instanceName, dbName: value.dbName }));
      if (appInstances.length === 0 && this.isInstalled(app.id)) {
        appInstances.push({ instanceName: app.id, dbName: app.database || '' });
      }
      return { ...app, installed: appInstances.length > 0, instances: appInstances };
    });
  }

  checkRequirementsById(appId) {
    const appDef = this.getCatalog().find(app => app.id === appId);
    if (!appDef) return { ok: false, missing: [], error: 'App not found in catalog' };
    return this.checkRequirements(appDef);
  }

  isInstalled(instanceName) {
    try {
      const appDir = this._resolveAppDir(instanceName);
      return fs.existsSync(appDir) && fs.readdirSync(appDir).length > 0;
    } catch {
      return false;
    }
  }

  // ===== Pre-flight checks =====

  /**
   * Verify all required services are installed (binaries downloaded).
   * Returns { ok, missing[] } — missing is list of human-readable labels.
   */
  checkRequirements(appDef) {
    const config = this.configManager.getConfig();
    const missing = [];

    for (const req of (appDef.requires || [])) {
      const alternatives = req.split('|');
      const anyInstalled = alternatives.some(svc => {
        const profile = this.configManager.getActiveProfile(config, svc);
        if (!profile) return false;
        return this.downloadManager.isInstalled(svc, profile.version);
      });
      if (!anyInstalled) {
        missing.push(alternatives.join(' or '));
      }
    }
    return { ok: missing.length === 0, missing };
  }

  // ===== Install =====

  async install(appId, onProgress, instanceName) {
    const catalog = this.getCatalog();
    const appDef = catalog.find(a => a.id === appId);
    if (!appDef) return { success: false, error: 'App not found in catalog' };

    // Sanitize instance name: lowercase, alphanumeric + dashes
    const instName = (instanceName || appDef.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!instName) return { success: false, error: 'Invalid instance name' };

    const appDir = this._resolveAppDir(instName);
    if (this.isInstalled(instName)) {
      return { success: true, path: appDir, alreadyInstalled: true };
    }

    // Pre-flight: check required services
    const reqs = this.checkRequirements(appDef);
    if (!reqs.ok) {
      return { success: false, error: `Missing required services: ${reqs.missing.join(', ')}. Install them first.`, missingServices: reqs.missing };
    }

    this._ensureDir(appDir);

    // Database name derived from instance name
    const dbName = appDef.database ? instName.replace(/-/g, '_') : '';
    // Build an appDef copy with overridden database name for config generation
    const instDef = { ...appDef, database: dbName, _instanceName: instName };

    try {
      switch (appDef.type) {
        case 'single-file':
          await this._installSingleFile(appDef, appDir, onProgress);
          break;
        case 'single-exe':
          await this._installSingleExe(appDef, appDir, onProgress);
          break;
        case 'zip':
        case 'zip-exe':
        case 'tar.gz':
          await this._installArchive(appDef, appDir, onProgress);
          break;
        case 'composer':
          await this._installComposer(appDef, appDir, onProgress);
          break;
        case 'git':
          await this._installGit(appDef, appDir, onProgress);
          break;
        default:
          throw new Error(`Unknown install type: ${appDef.type}`);
      }

      // Generate config files from templates (use instDef for DB name override)
      for (const cf of (appDef.configFiles || [])) {
        const content = this._generateConfig(cf.template, instDef);
        if (content) fs.writeFileSync(path.join(appDir, cf.dest), content, 'utf-8');
      }

      // Auto-create database if app needs one
      if (dbName) {
        await this._autoCreateDatabase(instDef);
      }

      // Register instance
      this._addInstance(instName, appDef.id, dbName);

      if (onProgress) onProgress({ stage: 'done', percent: 100 });
      return { success: true, path: appDir, instanceName: instName };
    } catch (err) {
      // Cleanup on failure
      if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
      return { success: false, error: err.message };
    }
  }

  // --- Install by type ---

  async _installSingleFile(appDef, appDir, onProgress) {
    if (onProgress) onProgress({ stage: 'downloading', percent: 0 });
    const destFile = path.join(appDir, path.basename(appDef.url));
    await this.downloadManager._downloadFile(appDef.url, destFile, (pct) => {
      if (onProgress) onProgress({ stage: 'downloading', percent: pct });
    });
    const baseName = path.basename(appDef.url);
    fs.writeFileSync(path.join(appDir, 'index.php'),
      `<?php require __DIR__ . '/${baseName}';`, 'utf-8');
  }

  async _installSingleExe(appDef, appDir, onProgress) {
    if (onProgress) onProgress({ stage: 'downloading', percent: 0 });
    const destFile = path.join(appDir, path.basename(appDef.url));
    await this.downloadManager._downloadFile(appDef.url, destFile, (pct) => {
      if (onProgress) onProgress({ stage: 'downloading', percent: pct });
    });
  }

  async _installArchive(appDef, appDir, onProgress) {
    if (onProgress) onProgress({ stage: 'downloading', percent: 0 });
    // Determine proper temp file extension
    const isTarGz = appDef.type === 'tar.gz' || appDef.url.endsWith('.tar.gz') || appDef.url.endsWith('.tgz');
    const ext = isTarGz ? '.tar.gz' : '.zip';
    const dirName = path.basename(appDir);
    const tempFile = path.join(this.downloadManager.tempDir, `app-${dirName}${ext}`);
    await this.downloadManager._downloadFile(appDef.url, tempFile, (pct) => {
      if (onProgress) onProgress({ stage: 'downloading', percent: pct });
    });
    if (onProgress) onProgress({ stage: 'extracting', percent: 100 });
    await this.downloadManager._extractZip(tempFile, appDir);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }

  async _installComposer(appDef, appDir, onProgress) {
    if (onProgress) onProgress({ stage: 'installing', percent: 30 });
    const result = await this._composerCreateProject(appDef, appDir);
    if (!result.success) throw new Error(result.error);
  }

  async _installGit(appDef, appDir, onProgress) {
    if (onProgress) onProgress({ stage: 'cloning', percent: 10 });

    // Validate git URL format
    const gitUrl = appDef.gitUrl || appDef.url;
    if (!gitUrl) throw new Error('No Git URL specified');

    // Check git is available
    const gitExe = this._findGit();
    if (!gitExe) throw new Error('Git is not installed on this system. Install Git for Windows first.');

    // Remove directory for a clean clone
    if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });

    const branch = appDef.gitBranch || 'main';
    await new Promise((resolve, reject) => {
      execFile(gitExe, ['clone', '--depth', '1', '--branch', branch, gitUrl, appDir], {
        timeout: 300000,
        env: { ...process.env }
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(`Git clone failed: ${stderr || err.message}`));
        else resolve();
      });
    });

    if (onProgress) onProgress({ stage: 'cloning', percent: 70 });

    // If project has composer.json, run composer install
    const composerJson = path.join(appDir, 'composer.json');
    if (fs.existsSync(composerJson)) {
      if (onProgress) onProgress({ stage: 'dependencies', percent: 80 });
      await this._runComposerInstall(appDir);
    }

    // If project has package.json, try npm install
    const packageJson = path.join(appDir, 'package.json');
    if (fs.existsSync(packageJson)) {
      if (onProgress) onProgress({ stage: 'dependencies', percent: 85 });
      await this._runNpmInstall(appDir);
    }
  }

  _findGit() {
    const candidates = ['git'];
    if (process.platform === 'win32') {
      candidates.push('C:\\Program Files\\Git\\bin\\git.exe');
      candidates.push('C:\\Program Files (x86)\\Git\\bin\\git.exe');
    } else {
      candidates.push('/usr/bin/git', '/usr/local/bin/git');
    }
    for (const cmd of candidates) {
      try {
        execFileSync(cmd === 'git' ? 'git' : cmd, ['--version'], { timeout: 5000, stdio: 'pipe' });
        return cmd;
      } catch {}
    }
    return null;
  }

  _composerPhar(config, phpDir) {
    const composerProfile = this.configManager.getActiveProfile(config, 'composer');
    if (composerProfile && this.downloadManager.isInstalled('composer', composerProfile.version)) {
      const managed = path.join(this.downloadManager.getInstallPath('composer', composerProfile.version), 'composer.phar');
      if (fs.existsSync(managed)) return managed;
    }
    return path.join(phpDir, 'composer.phar');
  }

  async _runComposerInstall(appDir) {
    const config = this.configManager.getConfig();
    const phpProfile = this.configManager.getActiveProfile(config, 'php');
    if (!phpProfile) return; // Skip silently if no PHP

    const phpDir = path.join(this.downloadManager.dataDir, 'php', phpProfile.version);
    const phpExe = path.join(phpDir, process.platform === 'win32' ? 'php.exe' : 'bin/php');
    const composerPhar = this._composerPhar(config, phpDir);
    if (!fs.existsSync(phpExe) || !fs.existsSync(composerPhar)) return;

    return new Promise((resolve) => {
      execFile(phpExe, [composerPhar, 'install', '--prefer-dist', '--no-interaction', '--no-dev'], {
        timeout: 300000, cwd: appDir,
        env: { ...process.env, COMPOSER_HOME: path.join(this.downloadManager.tempDir, 'composer') }
      }, () => resolve()); // Resolve regardless — non-critical
    });
  }

  async _runNpmInstall(appDir) {
    const config = this.configManager.getConfig();
    const nodeProfile = this.configManager.getActiveProfile(config, 'node');
    if (!nodeProfile) return;

    const nodeDir = path.join(this.downloadManager.dataDir, 'node', nodeProfile.version);
    const npmCmd = path.join(nodeDir, 'npm.cmd');
    if (!fs.existsSync(npmCmd)) return;

    return new Promise((resolve) => {
      execFile(npmCmd, ['install', '--production'], {
        timeout: 300000, cwd: appDir,
        env: { ...process.env, PATH: nodeDir + ';' + (process.env.PATH || '') }
      }, () => resolve()); // Resolve regardless — non-critical
    });
  }

  // ===== Auto-create database =====

  async _autoCreateDatabase(appDef) {
    if (!appDef.database || !this.dbViewer) return;

    // Determine which DB service to use based on requirements
    const dbServices = [];
    for (const req of (appDef.requires || [])) {
      for (const alt of req.split('|')) {
        if (['mysql', 'mariadb', 'postgresql', 'mongodb'].includes(alt)) {
          dbServices.push(alt);
        }
      }
    }
    if (dbServices.length === 0) return;

    // Try each DB service — use whichever is running
    for (const svc of dbServices) {
      const status = this.serviceManager.getServiceStatus(svc);
      if (!status.running) continue;
      try {
        await this.dbViewer.createDatabase(svc, appDef.database);
        return; // Success — done
      } catch (err) {
        // Database might already exist — that's OK
        if (err.message && (err.message.includes('already exists') || err.message.includes('database exists'))) return;
        // Otherwise try next service
      }
    }
    // If no DB service is running, skip — user will need to create it manually
  }

  // ===== Remove =====

  async remove(instanceName) {
    let appDir;
    try { appDir = this._resolveAppDir(instanceName); } catch (err) { return { success: false, error: err.message }; }
    if (!fs.existsSync(appDir)) return { success: false, error: 'App not installed' };

    // Drop associated database if one was created
    const instances = this._loadInstances();
    const instInfo = instances[instanceName];
    if (instInfo?.dbName && this.dbViewer) {
      try {
        const appDef = this.getCatalog().find(a => a.id === instInfo.appId);
        const dbServices = [];
        for (const req of (appDef?.requires || [])) {
          for (const alt of req.split('|')) {
            if (['mysql', 'mariadb', 'postgresql', 'mongodb'].includes(alt)) dbServices.push(alt);
          }
        }
        for (const svc of dbServices) {
          const status = this.serviceManager.getServiceStatus(svc);
          if (status?.running) {
            await this.dbViewer.dropDatabase(svc, instInfo.dbName);
            break;
          }
        }
      } catch {}
    }

    try {
      fs.rmSync(appDir, { recursive: true, force: true });
      // Remove instance record
      this._removeInstance(instanceName);
      // Also remove from custom apps if it's a custom app
      const custom = this._loadCustomApps();
      if (custom.find(a => a.id === instanceName)) {
        this.removeCustomApp(instanceName);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ===== URL generation =====

  getAppUrl(instanceName) {
    // Look up the catalog entry via instances or directly by appId
    const instances = this._loadInstances();
    const instInfo = instances[instanceName];
    const catalog = this.getCatalog();
    const appDef = instInfo
      ? catalog.find(a => a.id === instInfo.appId)
      : catalog.find(a => a.id === instanceName);
    if (!appDef) return null;

    if (appDef.type === 'single-exe' || appDef.type === 'zip-exe') {
      return `http://localhost:${appDef.port || 8080}`;
    }

    const config = this.configManager.getConfig();
    let port = 80;
    for (const svc of ['nginx', 'apache', 'caddy']) {
      const status = this.serviceManager.getServiceStatus(svc);
      if (status?.running) {
        const profile = this.configManager.getActiveProfile(config, svc);
        if (profile && profile.port) { port = profile.port; break; }
      }
    }
    return `http://localhost:${port}/apps/${instanceName}/`;
  }

  getExePath(instanceName) {
    let appDir;
    try { appDir = this._resolveAppDir(instanceName); } catch { return null; }
    if (!fs.existsSync(appDir)) return null;
    const files = fs.readdirSync(appDir);
    const isWin = process.platform === 'win32';
    const exe = isWin
      ? files.find(f => f.endsWith('.exe'))
      : files.find(f => { try { fs.accessSync(path.join(appDir, f), fs.constants.X_OK); return !f.includes('.'); } catch { return false; } });
    return exe ? path.join(appDir, exe) : null;
  }

  // ===== Config template generators =====

  _generateConfig(template, appDef) {
    const config = this.configManager.getConfig();

    switch (template) {
      case 'phpmyadmin-config': {
        const mp = this.configManager.getActiveProfile(config, 'mysql')
          || this.configManager.getActiveProfile(config, 'mariadb');
        const host = mp?.host || '127.0.0.1';
        const port = mp?.port || 3306;
        const blowfish = this._randomString(32);
        return `<?php
$cfg['blowfish_secret'] = '${blowfish}';
$i = 0;
$i++;
$cfg['Servers'][$i]['host'] = '${host}';
$cfg['Servers'][$i]['port'] = '${port}';
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['compress'] = false;
$cfg['Servers'][$i]['AllowNoPassword'] = true;
$cfg['TempDir'] = './tmp/';
`;
      }

      case 'wordpress-config': {
        const mp = this.configManager.getActiveProfile(config, 'mysql')
          || this.configManager.getActiveProfile(config, 'mariadb');
        const host = mp?.host || '127.0.0.1';
        const port = mp?.port || 3306;
        const user = mp?.username || 'root';
        const dbName = appDef.database || 'wordpress';
        const instName = appDef._instanceName || dbName;
        return `<?php
define( 'DB_NAME', '${dbName}' );
define( 'DB_USER', '${user}' );
define( 'DB_PASSWORD', '' );
define( 'DB_HOST', '${host}:${port}' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
$table_prefix = 'wp_';

/* Auto-detect site URL for subdirectory install */
$_kit_scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$_kit_host = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';
define( 'WP_HOME', $_kit_scheme . '://' . $_kit_host . '/apps/${instName}' );
define( 'WP_SITEURL', $_kit_scheme . '://' . $_kit_host . '/apps/${instName}' );

define( 'WP_DEBUG', true );
define( 'WP_DEBUG_LOG', true );
define( 'AUTH_KEY',         '${this._randomString(64)}' );
define( 'SECURE_AUTH_KEY',  '${this._randomString(64)}' );
define( 'LOGGED_IN_KEY',    '${this._randomString(64)}' );
define( 'NONCE_KEY',        '${this._randomString(64)}' );
define( 'AUTH_SALT',        '${this._randomString(64)}' );
define( 'SECURE_AUTH_SALT', '${this._randomString(64)}' );
define( 'LOGGED_IN_SALT',   '${this._randomString(64)}' );
define( 'NONCE_SALT',       '${this._randomString(64)}' );
if ( ! defined( 'ABSPATH' ) ) {
  define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`;
      }

      case 'laravel-env': {
        const mp = this.configManager.getActiveProfile(config, 'mysql')
          || this.configManager.getActiveProfile(config, 'mariadb');
        const rp = this.configManager.getActiveProfile(config, 'redis');
        const dbName = appDef.database || 'laravel';
        return `APP_NAME=Laravel
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_URL=http://localhost

DB_CONNECTION=mysql
DB_HOST=${mp?.host || '127.0.0.1'}
DB_PORT=${mp?.port || 3306}
DB_DATABASE=${dbName}
DB_USERNAME=${mp?.username || 'root'}
DB_PASSWORD=

REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=${rp?.port || 6379}

MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
`;
      }

      default:
        return null;
    }
  }

  async _composerCreateProject(appDef, appDir) {
    const config = this.configManager.getConfig();
    const phpProfile = this.configManager.getActiveProfile(config, 'php');
    if (!phpProfile) return { success: false, error: 'PHP is not configured. Install PHP first.' };

    const phpDir = path.join(this.downloadManager.dataDir, 'php', phpProfile.version);
    const phpExe = path.join(phpDir, process.platform === 'win32' ? 'php.exe' : 'bin/php');
    if (!fs.existsSync(phpExe)) return { success: false, error: `PHP ${phpProfile.version} is not installed` };

    const composerPhar = this._composerPhar(config, phpDir);
    if (!fs.existsSync(composerPhar)) return { success: false, error: 'Composer is not installed. Install it from Version Manager or the PHP panel first.' };

    if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });

    return new Promise((resolve) => {
      execFile(phpExe, [composerPhar, 'create-project', '--prefer-dist', '--no-interaction',
        appDef.composerPackage, appDir], {
        timeout: 300000,
        env: { ...process.env, COMPOSER_HOME: path.join(this.downloadManager.tempDir, 'composer') }
      }, (err, stdout, stderr) => {
        if (err) resolve({ success: false, error: `Composer failed: ${stderr || err.message}` });
        else resolve({ success: true });
      });
    });
  }

  _randomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(length);
    let result = '';
    for (let i = 0; i < length; i++) result += chars[bytes[i] % chars.length];
    return result;
  }

  _dirSizeMB(dir) {
    let total = 0;
    const walk = (d) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else try { total += fs.statSync(full).size; } catch {}
        }
      } catch {}
    };
    walk(dir);
    return Math.round(total / 1024 / 1024 * 10) / 10;
  }
}

module.exports = AppStoreManager;
