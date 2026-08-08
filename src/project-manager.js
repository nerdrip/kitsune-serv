'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVICE_IDS, isPathInside } = require('./path-utils');

const WEB_SERVICES = Object.freeze(['apache', 'nginx', 'caddy']);
const SECRET_ENV = /(pass(word)?|secret|token|private[_-]?key|api[_-]?key|database_url)/i;
const START_PRIORITY = Object.freeze([
  'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'minio',
  'php', 'apache', 'nginx', 'caddy', 'node', 'bun', 'deno', 'python', 'go'
]);

const STACK_TEMPLATES = Object.freeze([
  { id: 'blank', name: 'Empty project', description: 'Project without automatically managed services', services: [], runtime: null, publicDir: '.' },
  { id: 'php-apache-mysql', name: 'PHP + Apache + MySQL', description: 'Classic PHP development stack', services: ['mysql', 'php', 'apache'], runtime: 'php', publicDir: 'public' },
  { id: 'php-nginx-postgresql', name: 'PHP-FPM + Nginx + PostgreSQL', description: 'Modern PHP-FPM stack', services: ['postgresql', 'php', 'nginx'], runtime: 'php', publicDir: 'public' },
  { id: 'laravel', name: 'Laravel', description: 'Laravel with Nginx, PostgreSQL, Redis and Mail-ready environment', services: ['postgresql', 'redis', 'php', 'nginx'], runtime: 'php', publicDir: 'public', commands: { install: 'composer install', dev: 'php artisan serve', test: 'php artisan test', migrate: 'php artisan migrate' } },
  { id: 'wordpress', name: 'WordPress', description: 'WordPress with Apache and MySQL', services: ['mysql', 'php', 'apache'], runtime: 'php', publicDir: '.' },
  { id: 'symfony', name: 'Symfony', description: 'Symfony with Nginx, PostgreSQL and Redis', services: ['postgresql', 'redis', 'php', 'nginx'], runtime: 'php', publicDir: 'public', commands: { install: 'composer install', test: 'php bin/phpunit', migrate: 'php bin/console doctrine:migrations:migrate' } },
  { id: 'node-postgresql', name: 'Node.js + PostgreSQL', description: 'Node.js API backed by PostgreSQL', services: ['postgresql', 'node'], runtime: 'node', publicDir: '.', commands: { install: 'npm install', dev: 'npm run dev', build: 'npm run build', test: 'npm test' } },
  { id: 'nextjs', name: 'Next.js', description: 'Next.js application with PostgreSQL and Redis', services: ['postgresql', 'redis', 'node'], runtime: 'node', publicDir: '.', commands: { install: 'npm install', dev: 'npm run dev', build: 'npm run build', test: 'npm test' } },
  { id: 'vite', name: 'Vite frontend', description: 'Frontend project served by Node.js/Vite', services: ['node'], runtime: 'node', publicDir: '.', commands: { install: 'npm install', dev: 'npm run dev', build: 'npm run build' } },
  { id: 'django', name: 'Django', description: 'Django with PostgreSQL and Redis', services: ['postgresql', 'redis', 'python'], runtime: 'python', publicDir: '.', commands: { install: 'python -m pip install -r requirements.txt', dev: 'python manage.py runserver', test: 'python manage.py test', migrate: 'python manage.py migrate' } },
  { id: 'fastapi', name: 'FastAPI', description: 'FastAPI with PostgreSQL and Redis', services: ['postgresql', 'redis', 'python'], runtime: 'python', publicDir: '.', commands: { install: 'python -m pip install -r requirements.txt', dev: 'python -m uvicorn app:app --reload', test: 'python -m pytest' } },
  { id: 'mongodb-node', name: 'Node.js + MongoDB', description: 'Node.js service backed by MongoDB', services: ['mongodb', 'node'], runtime: 'node', publicDir: '.', commands: { install: 'npm install', dev: 'npm run dev', test: 'npm test' } },
  { id: 'static', name: 'Static website', description: 'Static files served by Caddy', services: ['caddy'], runtime: null, publicDir: '.' }
]);

function clone(value) {
  return structuredClone(value);
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function validDomain(value) {
  return typeof value === 'string'
    && value.length <= 253
    && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function uniqueStrings(value, limit = 20, maxLength = 40) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => String(item || '').trim())
    .filter(item => item && item.length <= maxLength))]
    .slice(0, limit);
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object') return null;
  const allowedTypes = new Set(['detected', 'compose', 'devcontainer', 'git', 'manual']);
  const result = {
    type: allowedTypes.has(value.type) ? value.type : 'detected',
    file: typeof value.file === 'string' ? value.file.slice(0, 1024) : '',
    evidence: uniqueStrings(value.evidence, 50, 200)
  };
  if (typeof value.repository === 'string') result.repository = value.repository.slice(0, 2048);
  if (typeof value.detectedAt === 'string' && !Number.isNaN(Date.parse(value.detectedAt))) result.detectedAt = value.detectedAt;
  return result;
}

class ProjectManager {
  constructor(appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager = null) {
    this.appRoot = path.resolve(appRoot);
    this.configManager = configManager;
    this.downloadManager = downloadManager;
    this.serviceManager = serviceManager;
    this.activityManager = activityManager;
    this.domainManager = domainManager;
    this.diagnosticsManager = null;
    this.secretStore = null;
    this.hookRunner = null;
    this.templateProvider = null;
    this.registryPath = path.join(this.appRoot, 'config', 'projects.json');
    this.statePath = path.join(this.appRoot, 'config', 'project-state.json');
    this.workspaceRoot = path.join(this.appRoot, 'projects', 'workspaces');
    const stateRegistry = this._loadStateRegistry();
    this.projectStates = stateRegistry.states;
    this.previousSessionClean = stateRegistry.cleanShutdown;
    this.sessionId = crypto.randomUUID();
    this.recoveryReport = null;
    this.serviceOwners = new Map();
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
    this._persistStateRegistry(false);
  }

  templates() {
    const contributed = this.templateProvider ? this.templateProvider() : [];
    return clone([...STACK_TEMPLATES, ...(Array.isArray(contributed) ? contributed : [])]);
  }

  setTemplateProvider(provider) {
    this.templateProvider = typeof provider === 'function' ? provider : null;
  }

  setDiagnosticsManager(manager) {
    this.diagnosticsManager = manager || null;
  }

  setSecretStore(store) {
    this.secretStore = store || null;
  }

  setHookRunner(runner) {
    this.hookRunner = typeof runner === 'function' ? runner : null;
  }

  _loadStateRegistry() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      const states = new Map();
      for (const item of Array.isArray(parsed.states) ? parsed.states : []) {
        if (!item || typeof item.projectId !== 'string' || !item.state || typeof item.state !== 'object') continue;
        states.set(item.projectId, item.state);
      }
      return { cleanShutdown: parsed.cleanShutdown === true, states };
    } catch {
      return { cleanShutdown: true, states: new Map() };
    }
  }

  _persistStateRegistry(cleanShutdown = false) {
    const dir = path.dirname(this.statePath);
    fs.mkdirSync(dir, { recursive: true });
    const payload = {
      schemaVersion: 1,
      sessionId: this.sessionId,
      cleanShutdown: Boolean(cleanShutdown),
      updatedAt: new Date().toISOString(),
      states: [...this.projectStates.entries()].map(([projectId, state]) => ({ projectId, state }))
    };
    const temp = `${this.statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temp, this.statePath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, this.statePath);
      fs.unlinkSync(temp);
    }
  }

  _setProjectState(projectId, state) {
    this.projectStates.set(projectId, { ...state, updatedAt: new Date().toISOString() });
    this._persistStateRegistry(false);
  }

  async recover(options = {}) {
    const enabled = options.enabled !== false;
    const safeMode = Boolean(options.safeMode);
    const interrupted = [];
    const restored = [];
    const stoppedServices = [];
    const warnings = [];
    const stoppedSet = new Set();
    this.serviceOwners.clear();
    for (const [projectId, state] of this.projectStates.entries()) {
      if (!['starting', 'running', 'stopping', 'recovery-pending'].includes(state?.status)) continue;
      interrupted.push(projectId);
      if (enabled && !safeMode) {
        for (const service of [...(state.services || [])].reverse()) {
          if (stoppedSet.has(service) || !this.serviceManager.getServiceStatus(service).running) continue;
          try {
            const result = await this.serviceManager.stopService(service, { keepPhp: false });
            if (result?.success !== false) { stoppedSet.add(service); stoppedServices.push(service); }
            else warnings.push(result?.error || `Could not stop interrupted service ${service}`);
          } catch (error) { warnings.push(error.message); }
        }
      }
      if (enabled && !safeMode && state.webRestore) {
        try {
          const result = await this._restoreWebProfile(state.webRestore);
          if (result?.success) restored.push(projectId);
          else warnings.push(result?.error || `Could not restore web configuration for ${projectId}`);
        } catch (error) {
          warnings.push(error.message);
        }
      }
      this.projectStates.set(projectId, {
        status: 'interrupted',
        services: [],
        error: safeMode
          ? 'The previous session did not finish cleanly. Recovery changes were skipped in safe mode.'
          : 'The previous session ended before the project was stopped cleanly.',
        interruptedAt: new Date().toISOString(),
        recoveredWebConfiguration: restored.includes(projectId),
        updatedAt: new Date().toISOString()
      });
    }
    this.recoveryReport = {
      success: warnings.length === 0,
      previousSessionClean: this.previousSessionClean,
      interrupted,
      restored,
      stoppedServices,
      warnings,
      safeMode,
      generatedAt: new Date().toISOString()
    };
    this._persistStateRegistry(false);
    return clone(this.recoveryReport);
  }

  getRecoveryReport() {
    return clone(this.recoveryReport || {
      success: true,
      previousSessionClean: this.previousSessionClean,
      interrupted: [],
      restored: [],
      stoppedServices: [],
      warnings: [],
      safeMode: false
    });
  }

  async stopAll() {
    const results = [];
    for (const [projectId, state] of [...this.projectStates.entries()]) {
      if (!['starting', 'running', 'stopping'].includes(state?.status)) continue;
      try { results.push({ projectId, ...(await this.stop(projectId)) }); }
      catch (error) { results.push({ projectId, success: false, error: error.message }); }
    }
    return { success: results.every(item => item.success !== false), results };
  }

  markCleanShutdown() {
    for (const [projectId, state] of this.projectStates.entries()) {
      if (!['starting', 'running', 'stopping'].includes(state?.status)) continue;
      this.projectStates.set(projectId, { status: 'stopped', services: [], stoppedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    }
    this._persistStateRegistry(true);
    return { success: true };
  }

  _read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Array.isArray(data.projects) ? data.projects.map(project => this._normalize(project)) : [];
    } catch {
      return [];
    }
  }

  _write(projects) {
    const dir = path.dirname(this.registryPath);
    fs.mkdirSync(dir, { recursive: true });
    const temp = `${this.registryPath}.${process.pid}.tmp`;
    const payload = { schemaVersion: 2, updatedAt: new Date().toISOString(), projects };
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.renameSync(temp, this.registryPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, this.registryPath);
      fs.unlinkSync(temp);
    }
  }

  _normalize(input) {
    if (!input || typeof input !== 'object') throw new Error('Invalid project');
    const name = String(input.name || '').trim().slice(0, 100);
    if (!name) throw new Error('Project name is required');
    const slug = slugify(input.slug || name);
    if (!slug) throw new Error('Project name must contain a letter or number');
    const root = path.resolve(String(input.root || path.join(this.workspaceRoot, slug)));
    const template = this.templates().find(item => item.id === input.templateId) || STACK_TEMPLATES[0];
    const services = [...new Set((Array.isArray(input.services) ? input.services : template.services).filter(id => SERVICE_IDS.includes(id)))];
    const publicDir = typeof input.publicDir === 'string' && input.publicDir.trim() ? input.publicDir.trim() : template.publicDir;
    if (path.isAbsolute(publicDir) || publicDir.split(/[\\/]/).includes('..')) throw new Error('Public directory must stay inside the project');
    const domain = String(input.domain || `${slug}.test`).toLowerCase();
    if (!validDomain(domain)) throw new Error('Invalid local domain');
    const runtimeVersions = {};
    for (const [service, version] of Object.entries(input.runtimeVersions || {})) {
      if (SERVICE_IDS.includes(service) && typeof version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(version)) runtimeVersions[service] = version;
    }
    const env = {};
    for (const [key, value] of Object.entries(input.env || {})) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key)) env[key] = String(value).slice(0, 8192);
    }
    const commands = {};
    for (const [key, value] of Object.entries(input.commands || template.commands || {})) {
      if (/^[a-z][a-z0-9_-]{0,40}$/i.test(key) && typeof value === 'string' && value.length <= 2000) commands[key] = value;
    }
    const environmentProfiles = {};
    const rawProfiles = input.environmentProfiles && typeof input.environmentProfiles === 'object' ? input.environmentProfiles : {};
    for (const [profileName, profile] of Object.entries(rawProfiles).slice(0, 20)) {
      if (!/^[a-z][a-z0-9_-]{0,30}$/i.test(profileName) || !profile || typeof profile !== 'object') continue;
      const profileEnv = {};
      for (const [key, value] of Object.entries(profile.env || {}).slice(0, 200)) {
        if (/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key)) profileEnv[key] = String(value).slice(0, 8192);
      }
      environmentProfiles[profileName] = { env: profileEnv, description: String(profile.description || '').slice(0, 300) };
    }
    if (!Object.keys(environmentProfiles).length) environmentProfiles.development = { env: {}, description: 'Local development' };
    const activeEnvironment = Object.hasOwn(environmentProfiles, input.activeEnvironment) ? input.activeEnvironment : Object.keys(environmentProfiles)[0];
    const hooks = {};
    for (const name of ['beforeStart', 'afterStart', 'beforeStop', 'afterStop']) {
      const commandName = String(input.hooks?.[name] || '');
      if (commandName && Object.hasOwn(commands, commandName)) hooks[name] = commandName;
    }
    const tags = uniqueStrings(input.tags, 20, 40);
    const resourceLimits = {
      memoryMB: Math.max(0, Math.min(131072, Number(input.resourceLimits?.memoryMB) || 0)),
      idleMinutes: Math.max(0, Math.min(10080, Number(input.resourceLimits?.idleMinutes) || 0))
    };
    return {
      id: typeof input.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(input.id) ? input.id : crypto.randomUUID(),
      name,
      slug,
      icon: String(input.icon || '🚀').slice(0, 8),
      templateId: template.id,
      root,
      publicDir,
      domain,
      https: Boolean(input.https),
      services,
      runtimeVersions,
      env,
      commands,
      environmentProfiles,
      activeEnvironment,
      hooks,
      tags,
      color: /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : '#e94560',
      resourceLimits,
      source: normalizeSource(input.source),
      databaseConnectionId: typeof input.databaseConnectionId === 'string' ? input.databaseConnectionId : '',
      autoOpen: input.autoOpen !== false,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
  }

  _writeIfMissing(file, contents) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, contents, 'utf8');
  }

  _manifestYaml(project) {
    const lines = [
      '# KitsuneServ project environment',
      'schemaVersion: 1',
      `name: ${JSON.stringify(project.name)}`,
      `domain: ${JSON.stringify(project.domain)}`,
      `template: ${JSON.stringify(project.templateId)}`,
      `publicDir: ${JSON.stringify(project.publicDir)}`,
      `https: ${project.https ? 'true' : 'false'}`,
      'services:'
    ];
    for (const service of project.services) lines.push(`  - ${service}`);
    const versions = Object.entries(project.runtimeVersions || {});
    if (versions.length) {
      lines.push('versions:');
      for (const [service, version] of versions) lines.push(`  ${service}: ${JSON.stringify(version)}`);
    }
    const commands = Object.entries(project.commands || {});
    if (commands.length) {
      lines.push('commands:');
      for (const [name, command] of commands) lines.push(`  ${name}: ${JSON.stringify(command)}`);
    }
    lines.push(`environment: ${JSON.stringify(project.activeEnvironment || 'development')}`);
    if (project.tags?.length) lines.push(`tags: ${JSON.stringify(project.tags)}`);
    const hooks = Object.entries(project.hooks || {});
    if (hooks.length) {
      lines.push('hooks:');
      for (const [name, command] of hooks) lines.push(`  ${name}: ${JSON.stringify(command)}`);
    }
    return `${lines.join('\n')}\n`;
  }

  _writeLock(project) {
    const payload = {
      schemaVersion: 1,
      kind: 'KitsuneServLock',
      projectId: project.id,
      services: project.services,
      runtimeVersions: project.runtimeVersions,
      environment: project.activeEnvironment,
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(project.root, 'kitsune.lock'), `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  _scaffold(project) {
    fs.mkdirSync(project.root, { recursive: true });
    const publicRoot = path.resolve(project.root, project.publicDir);
    fs.mkdirSync(publicRoot, { recursive: true });
    this._writeIfMissing(path.join(project.root, 'kitsune.yml'), this._manifestYaml(project));
    this._writeIfMissing(path.join(project.root, '.gitignore'), '.env\nnode_modules/\nvendor/\n.venv/\n__pycache__/\n');
    if (['php-apache-mysql', 'php-nginx-postgresql', 'laravel', 'wordpress', 'symfony'].includes(project.templateId)) {
      this._writeIfMissing(path.join(publicRoot, 'index.php'), `<?php\nheader('Content-Type: text/html; charset=utf-8');\n?><!doctype html><html><head><meta charset="utf-8"><title>${project.name.replace(/[<>&"']/g, '')}</title></head><body><h1>KitsuneServ: ${project.name.replace(/[<>&"']/g, '')}</h1><p>PHP environment is ready.</p></body></html>\n`);
    }
    if (['node-postgresql', 'nextjs', 'vite', 'mongodb-node'].includes(project.templateId)) {
      this._writeIfMissing(path.join(project.root, 'package.json'), JSON.stringify({
        name: project.slug, private: true, version: '0.1.0',
        scripts: { dev: 'node server.js', start: 'node server.js', test: 'node --test' }
      }, null, 2) + '\n');
      this._writeIfMissing(path.join(project.root, 'server.js'), `'use strict';\nconst http = require('http');\nconst port = Number(process.env.PORT || 3000);\nhttp.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ project: ${JSON.stringify(project.name)}, status: 'ok' })); }).listen(port, '127.0.0.1', () => console.log(\`Listening on http://127.0.0.1:\${port}\`));\n`);
    }
    if (['django', 'fastapi'].includes(project.templateId)) {
      this._writeIfMissing(path.join(project.root, 'requirements.txt'), project.templateId === 'django' ? 'Django>=5,<6\npsycopg[binary]>=3\nredis>=5\n' : 'fastapi>=0.115\nuvicorn[standard]>=0.34\npsycopg[binary]>=3\nredis>=5\n');
      this._writeIfMissing(path.join(project.root, 'app.py'), project.templateId === 'django'
        ? 'print("Run your Django project with: django-admin startproject config .")\n'
        : 'from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/")\ndef health():\n    return {"status": "ok"}\n');
    }
    if (project.templateId === 'static' || project.templateId === 'blank') {
      this._writeIfMissing(path.join(publicRoot, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${project.name.replace(/[<>&"']/g, '')}</title></head><body><h1>KitsuneServ: ${project.name.replace(/[<>&"']/g, '')}</h1></body></html>\n`);
    }
    this._writeLock(project);
  }

  list() {
    return this._read().map(project => ({
      ...project,
      documentRoot: path.resolve(project.root, project.publicDir),
      exists: fs.existsSync(project.root),
      state: this.projectStates.get(project.id) || { status: 'stopped', services: [] }
    }));
  }

  get(id) {
    const project = this._read().find(item => item.id === id || item.slug === id);
    if (!project) throw new Error('Project not found');
    return { ...project, documentRoot: path.resolve(project.root, project.publicDir), state: this.projectStates.get(project.id) || { status: 'stopped', services: [] } };
  }

  syncDomains(options = {}) {
    if (!this.domainManager) return { success: false, skipped: true, error: 'Local domain management is unavailable' };
    return this.domainManager.apply(this.list(), options);
  }

  create(input = {}) {
    const template = this.templates().find(item => item.id === input.templateId) || STACK_TEMPLATES[0];
    const project = this._normalize({ ...template, ...input, templateId: template.id, services: input.services || template.services, commands: input.commands || template.commands });
    const projects = this._read();
    if (projects.some(item => item.id === project.id || item.slug === project.slug)) throw new Error('A project with this name already exists');
    if (input.createDirectory !== false) {
      this._scaffold(project);
    } else if (!fs.existsSync(project.root)) {
      throw new Error('Selected project directory does not exist');
    }
    projects.push(project);
    this._write(projects);
    return this.get(project.id);
  }

  update(id, patch = {}) {
    const projects = this._read();
    const index = projects.findIndex(item => item.id === id || item.slug === id);
    if (index < 0) throw new Error('Project not found');
    const next = this._normalize({ ...projects[index], ...patch, id: projects[index].id, createdAt: projects[index].createdAt, updatedAt: new Date().toISOString() });
    if (projects.some((item, itemIndex) => itemIndex !== index && item.slug === next.slug)) throw new Error('A project with this name already exists');
    projects[index] = next;
    this._write(projects);
    if (fs.existsSync(next.root)) this._writeLock(next);
    return this.get(next.id);
  }

  remove(id, options = {}) {
    const projects = this._read();
    const index = projects.findIndex(item => item.id === id || item.slug === id);
    if (index < 0) return { success: false, error: 'Project not found' };
    const project = projects[index];
    if (this.projectStates.get(project.id)?.status === 'running') return { success: false, error: 'Stop the project before removing it' };
    const secretKeys = this.listSecretKeys(project.id);
    projects.splice(index, 1);
    this._write(projects);
    this.projectStates.delete(project.id);
    this._persistStateRegistry(false);
    if (this.secretStore) for (const key of secretKeys) this.secretStore.remove(this._projectSecretKey(project.id, key));
    let filesRemoved = false;
    if (options.deleteFiles) {
      if (!isPathInside(this.workspaceRoot, project.root) || path.resolve(project.root) === path.resolve(this.workspaceRoot)) {
        return { success: true, filesRemoved: false, warning: 'External project files were preserved' };
      }
      fs.rmSync(project.root, { recursive: true, force: false });
      filesRemoved = true;
    }
    return { success: true, filesRemoved };
  }

  _orderedServices(project, reverse = false) {
    const ordered = [...project.services].sort((a, b) => START_PRIORITY.indexOf(a) - START_PRIORITY.indexOf(b));
    return reverse ? ordered.reverse() : ordered;
  }

  _addOwner(service, projectId) {
    const owners = this.serviceOwners.get(service) || new Set();
    owners.add(projectId);
    this.serviceOwners.set(service, owners);
  }

  _removeOwner(service, projectId) {
    const owners = this.serviceOwners.get(service);
    if (!owners) return 0;
    owners.delete(projectId);
    if (!owners.size) this.serviceOwners.delete(service);
    return owners.size;
  }

  async start(id) {
    const project = this.get(id);
    if (this.projectStates.get(project.id)?.status === 'running') return { success: true, alreadyRunning: true, project };
    if (this.configManager.getConfig().general?.projectPreflight !== false && this.diagnosticsManager?.preflight) {
      const preflight = await this.diagnosticsManager.preflight(project);
      if (!preflight.ready) {
        return {
          success: false,
          errorCode: 'PROJECT_PREFLIGHT_FAILED',
          error: `Project preflight failed: ${preflight.counts.error} blocking issue(s)`,
          preflight
        };
      }
    }
    const requestedWeb = project.services.find(service => WEB_SERVICES.includes(service));
    if (requestedWeb) {
      const conflict = this.list().find(other => other.id !== project.id && ['starting', 'running'].includes(other.state?.status) && other.services.includes(requestedWeb));
      if (conflict) return { success: false, error: `${requestedWeb} is already assigned to running project ${conflict.name}. Stop it or use another web server.` };
    }
    return this.activityManager.run('project:start', `Start ${project.name}`, { projectId: project.id }, async activity => {
      this._setProjectState(project.id, { status: 'starting', services: [] });
      const newlyStarted = [];
      const attached = [];
      const switchedVersions = [];
      let webRestore = null;
      try {
        await this._runHook(project, 'beforeStart', activity);
        const config = this.configManager.getConfig();
        const web = project.services.find(service => WEB_SERVICES.includes(service));
        if (web) {
          const documentRoot = path.resolve(project.root, project.publicDir);
          if (!fs.existsSync(documentRoot)) fs.mkdirSync(documentRoot, { recursive: true });
          if (config.general?.forceGlobalDocumentRoot && path.resolve(config.general.globalDocumentRoot) !== documentRoot) {
            throw new Error(`Global WWW enforcement is enabled. Set it to ${documentRoot} or disable it for project-specific roots.`);
          }
          const webProfile = this.configManager.getActiveProfile(config, web);
          if (!webProfile) throw new Error(`No active ${web} profile`);
          webRestore = {
            service: web,
            profileId: webProfile.id,
            documentRoot: webProfile.documentRoot,
            serverName: webProfile.serverName,
            sslEnabled: webProfile.sslEnabled,
            modSsl: webProfile.modSsl,
            autoHttps: webProfile.autoHttps,
            sslCertificate: webProfile.sslCertificate,
            sslCertificateKey: webProfile.sslCertificateKey
          };
          this._setProjectState(project.id, { status: 'starting', services: [], webRestore });
          webProfile.serverName = project.domain;
          if (project.https) {
            const certificate = this.domainManager?.certificateStatus(project.domain);
            if (!certificate?.exists) {
              const error = new Error(`HTTPS certificate for ${project.domain} is missing. Provision it from the project card first.`);
              error.needsCertificate = true;
              throw error;
            }
            webProfile.sslCertificate = certificate.cert;
            webProfile.sslCertificateKey = certificate.key;
            if (web === 'apache') { webProfile.sslEnabled = true; webProfile.modSsl = true; }
            if (web === 'nginx') webProfile.sslEnabled = true;
            if (web === 'caddy') webProfile.autoHttps = true;
          }
          const configured = this.configManager.saveConfig(config);
          if (!configured.success) throw new Error(configured.error || `Could not configure ${web}`);
          if (!config.general?.forceGlobalDocumentRoot) {
            const rootResult = await this.serviceManager.setDocumentRoot(web, documentRoot);
            if (!rootResult.success) throw new Error(rootResult.error || `Could not configure ${web} document root`);
          }
        }
        const services = this._orderedServices(project);
        for (let index = 0; index < services.length; index += 1) {
          activity.throwIfCancelled();
          const service = services[index];
          activity.update({ stage: `starting:${service}`, progress: Math.round((index / Math.max(1, services.length)) * 90), message: `Starting ${service}` });
          const requestedVersion = project.runtimeVersions[service];
          const currentConfig = this.configManager.getConfig();
          const activeProfile = this.configManager.getActiveProfile(currentConfig, service);
          const existingOwners = this.serviceOwners.get(service);
          if (existingOwners?.size && requestedVersion && activeProfile?.version !== requestedVersion) {
            throw new Error(`${service} ${activeProfile?.version || ''} is in use by another project; ${project.name} requires ${requestedVersion}`);
          }
          if (requestedVersion && activeProfile?.version !== requestedVersion) {
            if (!this.downloadManager.isInstalled(service, requestedVersion)) {
              const error = new Error(`${service} ${requestedVersion} is required but not installed`);
              error.needsDownload = true;
              throw error;
            }
            const switched = await this.serviceManager.switchVersion(service, requestedVersion);
            if (!switched.success) throw new Error(switched.error || `Could not switch ${service}`);
            switchedVersions.push({ service, version: activeProfile.version });
          }
          const status = this.serviceManager.getServiceStatus(service);
          if (!status.running) {
            const result = await this.serviceManager.startService(service);
            if (!result.success) throw new Error(result.error || `Could not start ${service}`);
            newlyStarted.push(service);
          }
          this._addOwner(service, project.id);
          attached.push(service);
        }
        const state = { status: 'running', services: attached, startedAt: new Date().toISOString(), url: this.getUrl(project.id), webRestore };
        await this._runHook(project, 'afterStart', activity);
        this._setProjectState(project.id, state);
        activity.update({ stage: 'ready', progress: 95, message: `${project.name} is ready` });
        return { success: true, project: this.get(project.id), started: newlyStarted, attached, url: state.url };
      } catch (error) {
        for (const service of attached.reverse()) this._removeOwner(service, project.id);
        for (const service of newlyStarted.reverse()) await this.serviceManager.stopService(service, { keepPhp: false });
        for (const previous of switchedVersions.reverse()) {
          try { await this.serviceManager.switchVersion(previous.service, previous.version); } catch {}
        }
        await this._restoreWebProfile(webRestore);
        this._setProjectState(project.id, { status: 'failed', services: [], error: error.message });
        throw error;
      }
    });
  }

  async stop(id) {
    const project = this.get(id);
    const state = this.projectStates.get(project.id);
    if (!state || state.status === 'stopped') return { success: true, alreadyStopped: true };
    return this.activityManager.run('project:stop', `Stop ${project.name}`, { projectId: project.id }, async activity => {
      this._setProjectState(project.id, { ...state, status: 'stopping' });
      const stopped = [];
      const hookWarnings = [];
      try { await this._runHook(project, 'beforeStop', activity); } catch (error) { hookWarnings.push(error.message); }
      const services = this._orderedServices(project, true);
      for (let index = 0; index < services.length; index += 1) {
        const service = services[index];
        activity.update({ stage: `stopping:${service}`, progress: Math.round((index / Math.max(1, services.length)) * 95), message: `Stopping ${service}` });
        const remainingOwners = this._removeOwner(service, project.id);
        if (!remainingOwners && this.serviceManager.getServiceStatus(service).running) {
          const result = await this.serviceManager.stopService(service);
          if (result.success) stopped.push(service);
        }
      }
      await this._restoreWebProfile(state.webRestore);
      try { await this._runHook(project, 'afterStop', activity); } catch (error) { hookWarnings.push(error.message); }
      this._setProjectState(project.id, { status: 'stopped', services: [], stoppedAt: new Date().toISOString() });
      return { success: true, stopped, hookWarnings };
    });
  }

  async _restoreWebProfile(restore) {
    if (!restore?.service) return { success: true, skipped: true };
    const config = this.configManager.getConfig();
    const profile = config[restore.service]?.profiles?.find(item => item.id === restore.profileId);
    if (!profile) return { success: false, error: 'Previous web profile no longer exists' };
    for (const key of ['serverName', 'sslEnabled', 'modSsl', 'autoHttps', 'sslCertificate', 'sslCertificateKey']) {
      if (restore[key] === undefined) delete profile[key]; else profile[key] = restore[key];
    }
    const saved = this.configManager.saveConfig(config);
    if (!saved.success) return saved;
    if (!config.general?.forceGlobalDocumentRoot && restore.documentRoot && fs.existsSync(path.resolve(restore.documentRoot))) {
      return this.serviceManager.setDocumentRoot(restore.service, restore.documentRoot);
    }
    return { success: true };
  }

  getUrl(id) {
    const project = typeof id === 'object' ? id : this.get(id);
    const config = this.configManager.getConfig();
    const web = project.services.find(service => WEB_SERVICES.includes(service));
    const runtime = project.services.find(service => ['node', 'bun', 'deno', 'python', 'go'].includes(service));
    const service = web || runtime;
    const profile = service ? this.configManager.getActiveProfile(config, service) : null;
    if (web && project.domain) {
      const scheme = project.https ? 'https' : 'http';
      const port = project.https
        ? (web === 'caddy' && profile?.autoHttps ? 443 : Number(profile?.sslPort || 443))
        : Number(web === 'caddy' ? profile?.httpPort || profile?.port : profile?.port || 80);
      const suffix = (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80) ? '' : `:${port}`;
      return `${scheme}://${project.domain}${suffix}`;
    }
    return profile?.port ? `http://127.0.0.1:${profile.port}` : '';
  }

  async _runHook(project, hookName, activity) {
    const commandName = project.hooks?.[hookName];
    if (!commandName || !this.hookRunner) return { success: true, skipped: true };
    activity?.update({ stage: `hook:${hookName}`, message: `Running ${hookName}: ${commandName}` });
    const result = await this.hookRunner(project.id, commandName, { hookName });
    if (result?.success === false) throw new Error(`${hookName} hook failed: ${result.error || commandName}`);
    return result || { success: true };
  }

  _projectSecretKey(projectId, name) {
    return `project:${projectId}:env:${name}`;
  }

  listSecretKeys(id) {
    const project = this.get(id);
    if (!this.secretStore) return [];
    const prefix = this._projectSecretKey(project.id, '');
    return this.secretStore.keys(prefix).map(key => key.slice(prefix.length)).filter(Boolean).sort();
  }

  setSecrets(id, secrets = {}) {
    const project = this.get(id);
    if (!this.secretStore) return { success: false, error: 'Secret store is not available' };
    for (const [key, value] of Object.entries(secrets)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(key)) return { success: false, error: `Invalid environment key: ${key}` };
      if (value === null) this.secretStore.remove(this._projectSecretKey(project.id, key));
      else if (typeof value === 'string' && value.length <= 16384) this.secretStore.set(this._projectSecretKey(project.id, key), value);
      else return { success: false, error: `Invalid secret value for ${key}` };
    }
    return { success: true, keys: this.listSecretKeys(project.id) };
  }

  resolveEnvironment(id, options = {}) {
    const project = typeof id === 'object' ? id : this.get(id);
    const profile = project.environmentProfiles?.[project.activeEnvironment] || { env: {} };
    const result = { ...(project.env || {}), ...(profile.env || {}) };
    if (options.includeSecrets && this.secretStore) {
      const keys = new Set([...Object.keys(result), ...this.listSecretKeys(project.id)]);
      for (const key of keys) {
        const secret = this.secretStore.get(this._projectSecretKey(project.id, key));
        if (secret) result[key] = secret;
      }
    }
    return result;
  }

  exportManifest(id) {
    const project = this.get(id);
    const { state, documentRoot, ...manifest } = project;
    for (const key of Object.keys(manifest.env || {})) if (SECRET_ENV.test(key)) manifest.env[key] = '';
    manifest.secretKeys = this.listSecretKeys(project.id);
    return { schemaVersion: 2, kind: 'KitsuneServProject', project: manifest };
  }

  importManifest(payload, options = {}) {
    if (!payload || payload.kind !== 'KitsuneServProject' || ![1, 2].includes(payload.schemaVersion) || !payload.project) {
      throw new Error('Unsupported KitsuneServ project manifest');
    }
    const project = { ...payload.project, id: undefined, root: options.root || payload.project.root, createDirectory: options.createDirectory };
    return this.create(project);
  }
}

ProjectManager.STACK_TEMPLATES = STACK_TEMPLATES;
ProjectManager.slugify = slugify;

module.exports = ProjectManager;
