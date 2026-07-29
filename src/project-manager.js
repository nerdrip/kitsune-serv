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

class ProjectManager {
  constructor(appRoot, configManager, downloadManager, serviceManager, activityManager, domainManager = null) {
    this.appRoot = path.resolve(appRoot);
    this.configManager = configManager;
    this.downloadManager = downloadManager;
    this.serviceManager = serviceManager;
    this.activityManager = activityManager;
    this.domainManager = domainManager;
    this.templateProvider = null;
    this.registryPath = path.join(this.appRoot, 'config', 'projects.json');
    this.workspaceRoot = path.join(this.appRoot, 'projects', 'workspaces');
    this.projectStates = new Map();
    this.serviceOwners = new Map();
    fs.mkdirSync(this.workspaceRoot, { recursive: true });
  }

  templates() {
    const contributed = this.templateProvider ? this.templateProvider() : [];
    return clone([...STACK_TEMPLATES, ...(Array.isArray(contributed) ? contributed : [])]);
  }

  setTemplateProvider(provider) {
    this.templateProvider = typeof provider === 'function' ? provider : null;
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
    const payload = { schemaVersion: 1, updatedAt: new Date().toISOString(), projects };
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
    return `${lines.join('\n')}\n`;
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
    return this.get(next.id);
  }

  remove(id, options = {}) {
    const projects = this._read();
    const index = projects.findIndex(item => item.id === id || item.slug === id);
    if (index < 0) return { success: false, error: 'Project not found' };
    const project = projects[index];
    if (this.projectStates.get(project.id)?.status === 'running') return { success: false, error: 'Stop the project before removing it' };
    projects.splice(index, 1);
    this._write(projects);
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
    const requestedWeb = project.services.find(service => WEB_SERVICES.includes(service));
    if (requestedWeb) {
      const conflict = this.list().find(other => other.id !== project.id && ['starting', 'running'].includes(other.state?.status) && other.services.includes(requestedWeb));
      if (conflict) return { success: false, error: `${requestedWeb} is already assigned to running project ${conflict.name}. Stop it or use another web server.` };
    }
    return this.activityManager.run('project:start', `Start ${project.name}`, { projectId: project.id }, async activity => {
      this.projectStates.set(project.id, { status: 'starting', services: [] });
      const newlyStarted = [];
      const attached = [];
      const switchedVersions = [];
      let webRestore = null;
      try {
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
          this.projectStates.set(project.id, { status: 'starting', services: [], webRestore });
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
        this.projectStates.set(project.id, state);
        activity.update({ stage: 'ready', progress: 95, message: `${project.name} is ready` });
        return { success: true, project: this.get(project.id), started: newlyStarted, attached, url: state.url };
      } catch (error) {
        for (const service of attached.reverse()) this._removeOwner(service, project.id);
        for (const service of newlyStarted.reverse()) await this.serviceManager.stopService(service, { keepPhp: false });
        for (const previous of switchedVersions.reverse()) {
          try { await this.serviceManager.switchVersion(previous.service, previous.version); } catch {}
        }
        await this._restoreWebProfile(webRestore);
        this.projectStates.set(project.id, { status: 'failed', services: [], error: error.message });
        throw error;
      }
    });
  }

  async stop(id) {
    const project = this.get(id);
    const state = this.projectStates.get(project.id);
    if (!state || state.status === 'stopped') return { success: true, alreadyStopped: true };
    return this.activityManager.run('project:stop', `Stop ${project.name}`, { projectId: project.id }, async activity => {
      this.projectStates.set(project.id, { ...state, status: 'stopping' });
      const stopped = [];
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
      this.projectStates.set(project.id, { status: 'stopped', services: [], stoppedAt: new Date().toISOString() });
      return { success: true, stopped };
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

  exportManifest(id) {
    const project = this.get(id);
    const { state, documentRoot, ...manifest } = project;
    for (const key of Object.keys(manifest.env || {})) if (SECRET_ENV.test(key)) manifest.env[key] = '';
    return { schemaVersion: 1, kind: 'KitsuneServProject', project: manifest };
  }

  importManifest(payload, options = {}) {
    if (!payload || payload.kind !== 'KitsuneServProject' || payload.schemaVersion !== 1 || !payload.project) {
      throw new Error('Unsupported KitsuneServ project manifest');
    }
    const project = { ...payload.project, id: undefined, root: options.root || payload.project.root, createDirectory: options.createDirectory };
    return this.create(project);
  }
}

ProjectManager.STACK_TEMPLATES = STACK_TEMPLATES;
ProjectManager.slugify = slugify;

module.exports = ProjectManager;
