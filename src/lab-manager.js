'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn, execFile } = require('child_process');

const LAB_RECIPES = Object.freeze([
  { id: 'wordpress-plugin', name: 'WordPress plugin lab', category: 'CMS', kind: 'wordpress', description: 'Clean WordPress, isolated database, automatic administrator and live-mounted local plugins.', defaultPort: 80 },
  { id: 'node-api', name: 'Node.js API sidecar', category: 'API', kind: 'sidecar', description: 'Run an npm/pnpm/yarn API server next to the main project.', defaultCommand: 'npm run dev', defaultSetupCommand: 'npm install', defaultPort: 3001 },
  { id: 'php-api', name: 'PHP API sidecar', category: 'API', kind: 'sidecar', description: 'Run a PHP application with the built-in development server.', defaultCommand: 'php -S 127.0.0.1:%PORT% -t public', defaultSetupCommand: 'composer install', defaultPort: 8081 },
  { id: 'python-api', name: 'Python API sidecar', category: 'API', kind: 'sidecar', description: 'Run FastAPI, Django, Flask or another Python service.', defaultCommand: 'python -m uvicorn app:app --reload --port %PORT%', defaultSetupCommand: 'python -m pip install -r requirements.txt', defaultPort: 8001 },
  { id: 'go-api', name: 'Go API sidecar', category: 'API', kind: 'sidecar', description: 'Run a Go service with KitsuneServ environment and health monitoring.', defaultCommand: 'go run .', defaultSetupCommand: 'go mod download', defaultPort: 8082 },
  { id: 'bun-api', name: 'Bun API sidecar', category: 'API', kind: 'sidecar', description: 'Run a Bun service from its source directory.', defaultCommand: 'bun run dev', defaultSetupCommand: 'bun install', defaultPort: 3002 },
  { id: 'deno-api', name: 'Deno API sidecar', category: 'API', kind: 'sidecar', description: 'Run a Deno application with explicit local networking.', defaultCommand: 'deno task dev', defaultPort: 8002 },
  { id: 'compose-stack', name: 'Docker Compose stack', category: 'Containers', kind: 'sidecar', description: 'Optional adapter for an externally installed Docker-compatible Compose runtime.', defaultCommand: 'docker compose up', defaultSetupCommand: 'docker compose pull', defaultPort: 8080, externalRequirement: 'Docker-compatible Compose CLI' },
  { id: 'custom-sidecar', name: 'Custom command sidecar', category: 'Universal', kind: 'sidecar', description: 'Run any explicitly configured development server in parallel.', defaultCommand: '', defaultPort: 9001 }
]);
const LAB_DEPENDENCIES = Object.freeze(['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'minio']);

function clone(value) { return structuredClone(value); }
function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.copyFileSync(temporary, file); fs.unlinkSync(temporary);
  }
}

class LabManager {
  constructor(appRoot, dependencies = {}, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.configPath = path.join(this.appRoot, 'config', 'labs.json');
    this.appStoreManager = dependencies.appStoreManager;
    this.serviceManager = dependencies.serviceManager;
    this.configManager = dependencies.configManager;
    this.downloadManager = dependencies.downloadManager;
    this.pathManager = dependencies.pathManager || null;
    this.secretStore = dependencies.secretStore || null;
    this.activityManager = dependencies.activityManager || null;
    this.platform = options.platform || process.platform;
    this._spawn = options.spawn || spawn;
    this._execFile = options.execFile || execFile;
    this.processes = new Map();
    this.onChanged = null;
  }

  recipes() { return clone(LAB_RECIPES); }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return { schemaVersion: 1, labs: Array.isArray(payload.labs) ? payload.labs : [] };
    } catch { return { schemaVersion: 1, labs: [] }; }
  }

  _write(labs) { atomicWrite(this.configPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), labs }); }

  _normalize(input, previous = null) {
    if (!input || typeof input !== 'object') throw new Error('Invalid lab configuration');
    const recipe = LAB_RECIPES.find(item => item.id === input.recipeId) || LAB_RECIPES.find(item => item.id === previous?.recipeId);
    if (!recipe) throw new Error('Choose a supported lab recipe');
    const name = String(input.name || previous?.name || recipe.name).trim().slice(0, 100);
    if (!name) throw new Error('Lab name is required');
    const rootValue = input.root ?? previous?.root ?? '';
    const root = rootValue ? path.resolve(String(rootValue)) : '';
    const port = Math.max(1, Math.min(65535, Number(input.port ?? previous?.port ?? recipe.defaultPort) || recipe.defaultPort));
    const pluginPaths = [...new Set((Array.isArray(input.pluginPaths) ? input.pluginPaths : previous?.pluginPaths || [])
      .map(value => path.resolve(String(value || ''))).filter(Boolean))].slice(0, 30);
    const services = [...new Set((Array.isArray(input.services) ? input.services : previous?.services || [])
      .map(value => String(value || '').trim()).filter(value => LAB_DEPENDENCIES.includes(value)))];
    const layout = {};
    for (const [key, value] of Object.entries(input.layout || previous?.layout || {}).slice(0, 100)) {
      if (!/^[A-Za-z0-9:_.-]{1,160}$/.test(key) || !value || typeof value !== 'object') continue;
      layout[key] = { x: Math.max(0, Math.min(5000, Number(value.x) || 0)), y: Math.max(0, Math.min(5000, Number(value.y) || 0)) };
    }
    const env = {};
    for (const [key, value] of Object.entries(input.env || previous?.env || {}).slice(0, 200)) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key)) env[key] = String(value).slice(0, 8192);
    }
    const id = previous?.id || (typeof input.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(input.id) ? input.id : crypto.randomUUID());
    return {
      id,
      name,
      slug: slugify(input.slug || previous?.slug || name) || `lab-${id.slice(0, 8)}`,
      recipeId: recipe.id,
      kind: recipe.kind,
      projectId: String(input.projectId ?? previous?.projectId ?? '').slice(0, 100),
      root,
      command: String(input.command ?? previous?.command ?? recipe.defaultCommand ?? '').slice(0, 4000),
      setupCommand: String(input.setupCommand ?? previous?.setupCommand ?? recipe.defaultSetupCommand ?? '').slice(0, 4000),
      port,
      healthPath: String(input.healthPath ?? previous?.healthPath ?? '/').trim().slice(0, 500) || '/',
      env,
      autoStart: Boolean(input.autoStart ?? previous?.autoStart),
      services,
      pluginPaths,
      layout,
      wordpress: {
        webService: ['apache', 'nginx', 'caddy'].includes(input.wordpress?.webService ?? previous?.wordpress?.webService) ? (input.wordpress?.webService ?? previous.wordpress.webService) : 'apache',
        databaseService: ['mysql', 'mariadb'].includes(input.wordpress?.databaseService ?? previous?.wordpress?.databaseService) ? (input.wordpress?.databaseService ?? previous.wordpress.databaseService) : 'mysql',
        adminUser: String(input.wordpress?.adminUser ?? previous?.wordpress?.adminUser ?? 'admin').trim().slice(0, 60) || 'admin',
        adminEmail: String(input.wordpress?.adminEmail ?? previous?.wordpress?.adminEmail ?? 'admin@example.test').trim().slice(0, 200),
        siteTitle: String(input.wordpress?.siteTitle ?? previous?.wordpress?.siteTitle ?? name).trim().slice(0, 200) || name,
        instanceName: previous?.wordpress?.instanceName || `kitlab-${slugify(name).slice(0, 28)}-${id.slice(0, 8)}`
      },
      mounts: Array.isArray(previous?.mounts) ? previous.mounts : [],
      provisionedAt: previous?.provisionedAt || null,
      lastStartedAt: previous?.lastStartedAt || null,
      lastStoppedAt: previous?.lastStoppedAt || null,
      lastError: previous?.lastError || '',
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  _public(lab) {
    const processState = this.processes.get(lab.id);
    const status = processState ? 'running' : lab.kind === 'wordpress' && lab.provisionedAt ? 'ready' : lab.provisionedAt ? 'stopped' : 'unprovisioned';
    const url = lab.kind === 'wordpress'
      ? (this.appStoreManager?.getAppUrl(lab.wordpress.instanceName) || '')
      : `http://127.0.0.1:${lab.port}${lab.healthPath === '/' ? '/' : ''}`;
    return { ...clone(lab), status, url, pid: processState?.process?.pid || null, output: processState?.output || '', hasAdminPassword: Boolean(this.secretStore?.has(`lab:${lab.id}:adminPassword`)) };
  }

  list() { return this._read().labs.map(lab => this._public(lab)); }
  get(id) {
    const lab = this._read().labs.find(item => item.id === id);
    if (!lab) throw new Error('Test lab not found');
    return this._public(lab);
  }

  _serviceReadiness(service) {
    const config = this.configManager?.getConfig?.() || {};
    const profile = this.configManager?.getActiveProfile?.(config, service);
    const installed = Boolean(profile && this.downloadManager?.isInstalled?.(service, profile.version));
    const running = Boolean(this.serviceManager?.getServiceStatus?.(service)?.running);
    return {
      service,
      profile: profile?.name || profile?.version || '',
      version: profile?.version || '',
      installed,
      running,
      status: running ? 'running' : installed ? 'ready' : 'missing'
    };
  }

  preview(input = {}) {
    const lab = this._normalize(input);
    const recipe = LAB_RECIPES.find(item => item.id === lab.recipeId);
    const checks = [];
    const nodes = [];
    const connections = [];
    const addNode = (id, type, label, detail, status = 'ready', icon = '•') => nodes.push({ id, type, label, detail, status, icon, position: lab.layout[id] || null });
    const addCheck = (id, label, status, detail) => checks.push({ id, label, status, detail });

    if (lab.kind === 'wordpress') {
      const php = this._serviceReadiness('php');
      const web = this._serviceReadiness(lab.wordpress.webService);
      const database = this._serviceReadiness(lab.wordpress.databaseService);
      for (const item of [php, web, database]) addCheck(`service:${item.service}`, item.service, item.installed ? 'ok' : 'error', item.installed ? `${item.version}${item.running ? ' · running' : ' · ready to start'}` : 'Install and select a version in Version Manager');
      addNode('php', 'runtime', 'PHP', php.version || 'No installed version', php.status, '🐘');
      addNode('web', 'webserver', lab.wordpress.webService, web.version || 'No installed version', web.status, '🌐');
      addNode('database', 'database', lab.wordpress.databaseService, database.version || 'No installed version', database.status, '🗄️');
      addNode('wordpress', 'wordpress', 'Clean WordPress', lab.wordpress.siteTitle, 'managed', 'ⓦ');
      addNode('browser', 'health', 'Test & wp-admin', 'Automatic health check', 'ready', '🩺');
      connections.push({ from: 'php', to: 'web' }, { from: 'web', to: 'wordpress' }, { from: 'database', to: 'wordpress' }, { from: 'wordpress', to: 'browser' });
      if (!lab.pluginPaths.length) addCheck('plugins', 'WordPress plugins', 'error', 'Add at least one plugin block');
      lab.pluginPaths.forEach((pluginPath, index) => {
        let status = 'ok'; let detail = path.basename(pluginPath);
        try { detail = this._pluginMainFile(pluginPath); } catch (error) { status = 'error'; detail = error.message; }
        addCheck(`plugin:${index}`, path.basename(pluginPath) || `Plugin ${index + 1}`, status, detail);
        addNode(`plugin:${index}`, 'plugin', path.basename(pluginPath) || `Plugin ${index + 1}`, detail, status === 'ok' ? 'live' : 'missing', '🧩');
        connections.push({ from: `plugin:${index}`, to: 'wordpress' });
      });
    } else {
      const rootReady = Boolean(lab.root && fs.existsSync(lab.root) && fs.statSync(lab.root).isDirectory());
      addCheck('source', 'Source project', rootReady ? 'ok' : 'error', rootReady ? lab.root : 'Choose a project or source directory');
      addCheck('command', 'Start action', lab.command ? 'ok' : 'error', lab.command || 'No generated start action');
      addNode('source', 'source', path.basename(lab.root) || 'Choose project', lab.root || 'No source selected', rootReady ? 'ready' : 'missing', '📁');
      addNode('runtime', 'runtime', recipe?.name || lab.recipeId, 'Managed by KitsuneServ', lab.command ? 'ready' : 'missing', recipe?.id === 'compose-stack' ? '🐳' : '⚡');
      connections.push({ from: 'source', to: 'runtime' });
      for (const service of lab.services) {
        const readiness = this._serviceReadiness(service);
        addCheck(`service:${service}`, service, readiness.installed ? 'ok' : 'error', readiness.installed ? `${readiness.version}${readiness.running ? ' · running' : ''}` : 'Install and select a version in Version Manager');
        addNode(`service:${service}`, 'database', service, readiness.version || 'No installed version', readiness.status, ['redis', 'memcached'].includes(service) ? '⚡' : '🗄️');
        connections.push({ from: `service:${service}`, to: 'runtime' });
      }
      addNode('endpoint', 'health', `127.0.0.1:${lab.port}`, lab.healthPath, 'ready', '🩺');
      connections.push({ from: 'runtime', to: 'endpoint' });
      if (recipe?.externalRequirement) addCheck('external', recipe.externalRequirement, 'warning', 'This recipe uses a tool installed outside KitsuneServ');
    }

    const errors = checks.filter(item => item.status === 'error');
    return {
      success: true,
      valid: errors.length === 0,
      recipe: clone(recipe),
      lab: { ...clone(lab), id: input.id || '', mounts: [], lastError: '' },
      nodes,
      connections,
      checks,
      actions: lab.kind === 'wordpress'
        ? ['Start database, PHP and web server', 'Install an isolated WordPress copy', 'Create the test database and administrator', 'Live-mount and activate selected plugins', 'Open wp-admin']
        : [...(lab.services.length ? [`Start ${lab.services.join(', ')}`] : []), ...(lab.setupCommand ? ['Install project dependencies'] : []), 'Start the API sidecar', `Check http://127.0.0.1:${lab.port}${lab.healthPath}`]
    };
  }

  create(input = {}, secrets = {}) {
    const lab = this._normalize(input);
    const labs = this._read().labs;
    if (labs.some(item => item.slug === lab.slug)) throw new Error('A test lab with this name already exists');
    if (lab.kind === 'sidecar' && (!lab.root || !fs.existsSync(lab.root))) throw new Error('Sidecar source directory does not exist');
    if (secrets.adminPassword) this.secretStore?.set(`lab:${lab.id}:adminPassword`, String(secrets.adminPassword));
    labs.push(lab); this._write(labs); this._emit(lab.id);
    return this._public(lab);
  }

  update(id, patch = {}, secrets = {}) {
    if (this.processes.has(id)) throw new Error('Stop the lab before changing its configuration');
    const labs = this._read().labs;
    const index = labs.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Test lab not found');
    const lab = this._normalize({ ...labs[index], ...patch }, labs[index]);
    if (labs.some((item, itemIndex) => itemIndex !== index && item.slug === lab.slug)) throw new Error('A test lab with this name already exists');
    if (secrets.adminPassword) this.secretStore?.set(`lab:${lab.id}:adminPassword`, String(secrets.adminPassword));
    if (secrets.clearAdminPassword) this.secretStore?.remove(`lab:${lab.id}:adminPassword`);
    labs[index] = lab; this._write(labs); this._emit(id);
    return this._public(lab);
  }

  _replace(id, patch) {
    const payload = this._read();
    const index = payload.labs.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Test lab not found');
    payload.labs[index] = { ...payload.labs[index], ...patch, updatedAt: new Date().toISOString() };
    this._write(payload.labs); this._emit(id);
    return payload.labs[index];
  }

  _emit(id) { try { this.onChanged?.(this.get(id)); } catch {} }

  async provision(id, onProgress = null) {
    const lab = this.get(id);
    const activity = this.activityManager?.begin?.('lab-provision', `Provision ${lab.name}`, { labId: id });
    const progress = (stage, percent, message = stage) => {
      onProgress?.({ labId: id, stage, percent, message });
      if (activity?.id) this.activityManager.update(activity.id, { stage, progress: percent, message });
    };
    try {
      const details = lab.kind === 'wordpress'
        ? await this._provisionWordPress(lab, progress)
        : await this._provisionSidecar(lab, progress);
      const saved = this._replace(id, { provisionedAt: new Date().toISOString(), lastError: '' });
      if (activity?.id) this.activityManager.finish(activity.id, 'completed', { message: 'Test lab is ready' });
      return { success: true, lab: this._public(saved), ...(details || {}) };
    } catch (error) {
      this._replace(id, { lastError: error.message });
      if (activity?.id) this.activityManager.finish(activity.id, 'failed', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async _provisionSidecar(lab, progress) {
    if (!lab.root || !fs.existsSync(lab.root)) throw new Error('Sidecar source directory does not exist');
    if (!lab.command) throw new Error('Sidecar start command is required');
    for (const service of lab.services || []) await this._ensureService(service, progress);
    if (lab.setupCommand) {
      progress('setup', 30, 'Running setup command');
      const result = await this._runShell(lab.setupCommand, lab.root, { ...lab.env, PORT: String(lab.port) }, 15 * 60 * 1000);
      if (!result.success) throw new Error(`Setup failed: ${result.output.slice(-2000)}`);
    }
    progress('ready', 100, 'Sidecar recipe is ready');
  }

  async _ensureService(service, progress) {
    const status = this.serviceManager?.getServiceStatus(service);
    if (status?.running) return;
    progress(`service:${service}`, 10, `Starting ${service}`);
    const result = await this.serviceManager?.startService(service);
    if (!result || result.success === false) throw new Error(result?.error || `Could not start ${service}`);
  }

  _phpExecutable() {
    const config = this.configManager.getConfig();
    const profile = this.configManager.getActiveProfile(config, 'php');
    if (!profile) return '';
    const root = this.downloadManager.getInstallPath('php', profile.version);
    const candidates = this.platform === 'win32'
      ? [path.join(root, 'php.exe'), path.join(root, 'bin', 'php.exe')]
      : [path.join(root, 'bin', 'php'), path.join(root, 'php')];
    return candidates.find(file => fs.existsSync(file)) || '';
  }

  _pluginMainFile(source) {
    const candidates = fs.readdirSync(source, { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.php')).slice(0, 100);
    for (const item of candidates) {
      const file = path.join(source, item.name);
      try {
        if (/^[\s\S]{0,8192}Plugin Name\s*:/im.test(fs.readFileSync(file, 'utf8').slice(0, 8192))) return item.name;
      } catch {}
    }
    throw new Error(`No WordPress plugin entry file found in ${source}`);
  }

  _mountPlugin(wordpressRoot, source) {
    if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`Plugin directory does not exist: ${source}`);
    const slug = slugify(path.basename(source));
    if (!slug) throw new Error(`Invalid plugin directory name: ${source}`);
    const pluginsRoot = path.join(wordpressRoot, 'wp-content', 'plugins');
    fs.mkdirSync(pluginsRoot, { recursive: true });
    const target = path.join(pluginsRoot, slug);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isSymbolicLink()) throw new Error(`WordPress plugin target already exists and is not a live mount: ${slug}`);
      fs.unlinkSync(target);
    }
    fs.symlinkSync(source, target, this.platform === 'win32' ? 'junction' : 'dir');
    return { source, target, slug, entry: `${slug}/${this._pluginMainFile(source)}`, mode: 'live-link' };
  }

  async _provisionWordPress(lab, progress) {
    if (!this.appStoreManager) throw new Error('Application installer is unavailable');
    if (!lab.pluginPaths.length) throw new Error('Choose at least one local WordPress plugin directory');
    await this._ensureService(lab.wordpress.databaseService, progress);
    await this._ensureService('php', progress);
    await this._ensureService(lab.wordpress.webService, progress);
    progress('wordpress', 35, 'Installing clean WordPress');
    const installed = await this.appStoreManager.install('wordpress', payload => progress(`wordpress:${payload.stage}`, Math.max(35, Number(payload.percent) || 35), payload.stage), lab.wordpress.instanceName);
    if (!installed.success) throw new Error(installed.error || 'WordPress installation failed');
    const wordpressRoot = installed.path;
    const mounts = [];
    progress('mounts', 75, 'Mounting local plugins in live mode');
    for (const pluginPath of lab.pluginPaths) mounts.push(this._mountPlugin(wordpressRoot, pluginPath));
    const php = this._phpExecutable();
    if (!php) throw new Error('Managed PHP executable is not installed');
    let adminPassword = this.secretStore?.get(`lab:${lab.id}:adminPassword`);
    let generatedPassword = '';
    if (!adminPassword) {
      generatedPassword = crypto.randomBytes(18).toString('base64url');
      adminPassword = generatedPassword;
      this.secretStore?.set(`lab:${lab.id}:adminPassword`, adminPassword);
    }
    progress('bootstrap', 85, 'Installing WordPress core and activating plugins');
    const bootstrap = [
      '$root=getenv("KITSUNE_WP_ROOT"); chdir($root);',
      '$_SERVER["HTTP_HOST"]=getenv("KITSUNE_WP_HOST") ?: "localhost";',
      '$_SERVER["REQUEST_URI"]="/"; $_SERVER["HTTPS"]="";',
      'define("WP_INSTALLING", true); require $root . "/wp-load.php";',
      'require_once ABSPATH . "wp-admin/includes/upgrade.php";',
      'if (!is_blog_installed()) { wp_install(getenv("KITSUNE_WP_TITLE"), getenv("KITSUNE_WP_USER"), getenv("KITSUNE_WP_EMAIL"), true, "", getenv("KITSUNE_WP_PASSWORD"), ""); }',
      'require_once ABSPATH . "wp-admin/includes/plugin.php";',
      '$plugins=json_decode(getenv("KITSUNE_WP_PLUGINS"), true) ?: [];',
      'foreach ($plugins as $plugin) { $result=activate_plugin($plugin); if (is_wp_error($result)) { fwrite(STDERR, $result->get_error_message()); exit(12); } }',
      'echo "KITSUNE_WORDPRESS_READY";'
    ].join(' ');
    const siteUrl = this.appStoreManager.getAppUrl(lab.wordpress.instanceName) || 'http://localhost/';
    const host = (() => { try { return new URL(siteUrl).host; } catch { return 'localhost'; } })();
    const result = await this._runExecutable(php, ['-d', 'display_errors=1', '-r', bootstrap], wordpressRoot, {
      KITSUNE_WP_ROOT: wordpressRoot,
      KITSUNE_WP_HOST: host,
      KITSUNE_WP_TITLE: lab.wordpress.siteTitle,
      KITSUNE_WP_USER: lab.wordpress.adminUser,
      KITSUNE_WP_EMAIL: lab.wordpress.adminEmail,
      KITSUNE_WP_PASSWORD: adminPassword,
      KITSUNE_WP_PLUGINS: JSON.stringify(mounts.map(item => item.entry))
    }, 120000);
    if (!result.success) throw new Error(`WordPress bootstrap failed: ${result.output.slice(-3000)}`);
    this._replace(lab.id, { mounts });
    progress('ready', 100, 'WordPress plugin lab is ready');
    return { generatedPassword };
  }

  _runExecutable(executable, args, cwd, extraEnv, timeoutMs) {
    return new Promise(resolve => {
      this._execFile(executable, args, { cwd, env: { ...(this.pathManager?.buildEnvironment(process.env) || process.env), ...extraEnv }, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolve({ success: !error, output: `${stdout || ''}${stderr || ''}`, error: error?.message || '' });
      });
    });
  }

  _runShell(command, cwd, extraEnv, timeoutMs) {
    const executable = this.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
    const args = this.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    return this._runExecutable(executable, args, cwd, extraEnv, timeoutMs);
  }

  async start(id) {
    let lab = this.get(id);
    if (!lab.provisionedAt) {
      const provisioned = await this.provision(id);
      if (!provisioned.success) return provisioned;
      lab = this.get(id);
    }
    if (lab.kind === 'wordpress') {
      try {
        await this._ensureService(lab.wordpress.databaseService, () => {});
        await this._ensureService('php', () => {});
        await this._ensureService(lab.wordpress.webService, () => {});
        const saved = this._replace(id, { lastStartedAt: new Date().toISOString(), lastError: '' });
        return { success: true, lab: this._public(saved) };
      } catch (error) { return { success: false, error: error.message }; }
    }
    if (this.processes.has(id)) return { success: true, alreadyRunning: true, lab: this.get(id) };
    for (const service of lab.services || []) {
      try { await this._ensureService(service, () => {}); }
      catch (error) { return { success: false, error: error.message }; }
    }
    const command = lab.command.replaceAll('%PORT%', String(lab.port));
    const executable = this.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
    const args = this.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-lc', command];
    try {
      const child = this._spawn(executable, args, {
        cwd: lab.root,
        env: { ...(this.pathManager?.buildEnvironment(process.env) || process.env), ...lab.env, PORT: String(lab.port), KITSUNE_LAB_ID: id },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
      });
      const state = { process: child, output: '', startedAt: new Date().toISOString() };
      const append = chunk => { state.output = `${state.output}${String(chunk)}`.slice(-1024 * 1024); this._emit(id); };
      this.processes.set(id, state);
      child.stdout?.on('data', append); child.stderr?.on('data', append);
      child.on('error', error => { append(`[KitsuneServ] ${error.message}\n`); this.processes.delete(id); this._replace(id, { lastError: error.message }); });
      child.on('exit', code => { this.processes.delete(id); this._replace(id, { lastStoppedAt: new Date().toISOString(), lastError: code === 0 ? '' : `Sidecar exited with code ${code}` }); });
      const saved = this._replace(id, { lastStartedAt: state.startedAt, lastError: '' });
      return { success: true, lab: this._public(saved) };
    } catch (error) { return { success: false, error: error.message }; }
  }

  stop(id) {
    const state = this.processes.get(id);
    if (state?.process) {
      try {
        if (this.platform === 'win32' && state.process.pid) spawn('taskkill.exe', ['/pid', String(state.process.pid), '/t', '/f'], { windowsHide: true });
        else state.process.kill('SIGTERM');
      } catch (error) { return { success: false, error: error.message }; }
      this.processes.delete(id);
    }
    const saved = this._replace(id, { lastStoppedAt: new Date().toISOString() });
    return { success: true, lab: this._public(saved) };
  }

  async health(id) {
    const lab = this.get(id);
    if (lab.kind === 'wordpress' && !lab.provisionedAt) return { healthy: false, error: 'Lab is not provisioned' };
    if (lab.kind === 'sidecar' && !this.processes.has(id)) return { healthy: false, error: 'Sidecar is not running' };
    const base = lab.kind === 'wordpress' ? lab.url : `http://127.0.0.1:${lab.port}`;
    let target;
    try { target = new URL(lab.healthPath || '/', base); } catch { return { healthy: false, error: 'Invalid health URL' }; }
    const client = target.protocol === 'https:' ? https : http;
    const started = Date.now();
    return new Promise(resolve => {
      const request = client.get(target, { timeout: 3000, rejectUnauthorized: false }, response => {
        response.resume();
        resolve({ healthy: response.statusCode < 500, statusCode: response.statusCode, responseTime: Date.now() - started, url: target.toString() });
      });
      request.on('error', error => resolve({ healthy: false, error: error.message, responseTime: Date.now() - started }));
      request.on('timeout', () => { request.destroy(); resolve({ healthy: false, error: 'Health check timed out', responseTime: Date.now() - started }); });
    });
  }

  async remove(id, options = {}) {
    const lab = this.get(id);
    this.stop(id);
    if (lab.kind === 'wordpress') {
      for (const mount of lab.mounts || []) {
        try {
          const stat = fs.lstatSync(mount.target);
          if (stat.isSymbolicLink()) fs.unlinkSync(mount.target);
        } catch {}
      }
      if (options.deleteInstance) {
        const result = await this.appStoreManager.remove(lab.wordpress.instanceName);
        if (result.success === false && result.error !== 'App not installed') return result;
      }
    }
    const payload = this._read();
    payload.labs = payload.labs.filter(item => item.id !== id);
    this._write(payload.labs);
    this.secretStore?.remove(`lab:${id}:adminPassword`);
    try { this.onChanged?.({ id, removed: true }); } catch {}
    return { success: true, instanceRemoved: Boolean(options.deleteInstance) };
  }

  stopAll() { return this.list().map(lab => this.stop(lab.id)); }
}

LabManager.LAB_RECIPES = LAB_RECIPES;
module.exports = LabManager;
