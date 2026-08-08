'use strict';

const fs = require('fs');
const path = require('path');

const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function readText(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_METADATA_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

function readJson(file) {
  try { return JSON.parse(readText(file)); } catch { return null; }
}

function stripJsonComments(source) {
  let result = '';
  let quoted = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') { lineComment = false; result += character; }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') { blockComment = false; index += 1; }
      else if (character === '\n' || character === '\r') result += character;
      continue;
    }
    if (!quoted && character === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (!quoted && character === '/' && next === '*') { blockComment = true; index += 1; continue; }
    result += character;
    if (character === '"' && !escaped) quoted = !quoted;
    escaped = quoted && character === '\\' && !escaped;
    if (character !== '\\') escaped = false;
  }
  return result;
}

function readJsonc(file) {
  const source = readText(file);
  if (!source) return null;
  try {
    return JSON.parse(stripJsonComments(source).replace(/,\s*([}\]])/g, '$1'));
  } catch { return null; }
}

function unique(items) { return [...new Set(items.filter(Boolean))]; }

function detectWordPressPlugin(root) {
  let files = [];
  try { files = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.php')).slice(0, 200); } catch {}
  for (const entry of files) {
    const source = readText(path.join(root, entry.name)).slice(0, 16384);
    const name = source.match(/^[ \t/*#@]*Plugin Name\s*:\s*(.+)$/im)?.[1]?.trim();
    if (!name) continue;
    return {
      detected: true,
      name: name.slice(0, 200),
      entryFile: entry.name,
      version: (source.match(/^[ \t/*#@]*Version\s*:\s*(.+)$/im)?.[1]?.trim() || '').slice(0, 80),
      textDomain: (source.match(/^[ \t/*#@]*Text Domain\s*:\s*(.+)$/im)?.[1]?.trim() || '').slice(0, 120)
    };
  }
  return { detected: false };
}

class ProjectDetector {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
  }

  _assertDirectory(directory) {
    const root = path.resolve(String(directory || ''));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('Project directory does not exist');
    return root;
  }

  detect(directory) {
    const root = this._assertDirectory(directory);
    const evidence = [];
    const services = [];
    const commands = {};
    let templateId = 'blank';
    let publicDir = '.';
    let confidence = 0.2;
    const packageInfo = readJson(path.join(root, 'package.json'));
    const packageManager = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn'
        : (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) ? 'bun' : 'npm';
    const composer = readJson(path.join(root, 'composer.json'));
    const requirements = readText(path.join(root, 'requirements.txt'));
    const pyproject = readText(path.join(root, 'pyproject.toml'));
    const composeFile = ['compose.yml', 'compose.yaml', 'docker-compose.yml', 'docker-compose.yaml'].map(name => path.join(root, name)).find(fs.existsSync);
    const devcontainerFile = path.join(root, '.devcontainer', 'devcontainer.json');
    const wordpressPlugin = detectWordPressPlugin(root);

    if (composer) {
      const packages = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
      services.push('php'); evidence.push('composer.json'); confidence = 0.75;
      commands.install = 'composer install'; commands.test = composer.scripts?.test || 'composer test';
      if (packages['laravel/framework']) { templateId = 'laravel'; services.push('nginx', 'postgresql', 'redis'); publicDir = 'public'; confidence = 0.98; evidence.push('laravel/framework'); }
      else if (Object.keys(packages).some(name => name.startsWith('symfony/'))) { templateId = 'symfony'; services.push('nginx', 'postgresql', 'redis'); publicDir = 'public'; confidence = 0.95; evidence.push('Symfony packages'); }
      else { templateId = 'php-nginx-postgresql'; services.push('nginx', 'postgresql'); publicDir = fs.existsSync(path.join(root, 'public')) ? 'public' : '.'; }
    }
    if (fs.existsSync(path.join(root, 'wp-config.php')) || fs.existsSync(path.join(root, 'wp-content'))) {
      templateId = 'wordpress'; services.push('php', 'apache', 'mysql'); publicDir = '.'; confidence = 0.99; evidence.push('WordPress files');
    }
    if (wordpressPlugin.detected) {
      services.push('php', 'apache', 'mysql');
      confidence = Math.max(confidence, 0.99);
      evidence.push(`WordPress plugin: ${wordpressPlugin.name} (${wordpressPlugin.entryFile})`);
    }
    if (packageInfo) {
      const packages = { ...(packageInfo.dependencies || {}), ...(packageInfo.devDependencies || {}) };
      services.push('node'); evidence.push('package.json'); confidence = Math.max(confidence, 0.72);
      if (packageInfo.scripts?.install) commands.install = `${packageManager} run install`; else commands.install ||= `${packageManager} install`;
      for (const name of ['dev', 'build', 'test', 'start']) if (packageInfo.scripts?.[name]) commands[name] = `${packageManager} run ${name}`;
      if (packages.next) { templateId = 'nextjs'; services.push('postgresql', 'redis'); confidence = 0.98; evidence.push('Next.js'); }
      else if (packages.vite) { templateId = 'vite'; confidence = 0.96; evidence.push('Vite'); }
      else if (packages.mongodb || packages.mongoose) { templateId = 'mongodb-node'; services.push('mongodb'); confidence = 0.9; evidence.push('MongoDB driver'); }
      else if (!composer) templateId = 'node-postgresql';
    }
    if (fs.existsSync(path.join(root, 'manage.py')) || /\bdjango\b/i.test(`${requirements}\n${pyproject}`)) {
      templateId = 'django'; services.push('python', 'postgresql', 'redis'); confidence = 0.98; evidence.push('Django');
      commands.install = 'python -m pip install -r requirements.txt'; commands.dev = 'python manage.py runserver'; commands.test = 'python manage.py test'; commands.migrate = 'python manage.py migrate';
    } else if (/\bfastapi\b/i.test(`${requirements}\n${pyproject}`)) {
      templateId = 'fastapi'; services.push('python', 'postgresql', 'redis'); confidence = 0.96; evidence.push('FastAPI');
      commands.install = 'python -m pip install -r requirements.txt'; commands.dev = 'python -m uvicorn app:app --reload'; commands.test = 'python -m pytest';
    } else if ((requirements || pyproject) && !packageInfo && !composer) {
      services.push('python'); templateId = 'blank'; confidence = 0.7; evidence.push(requirements ? 'requirements.txt' : 'pyproject.toml');
    }
    if (fs.existsSync(path.join(root, 'go.mod'))) { services.push('go'); templateId = 'blank'; confidence = Math.max(confidence, 0.9); evidence.push('go.mod'); commands.dev = 'go run .'; commands.build = 'go build ./...'; commands.test = 'go test ./...'; }
    if (fs.existsSync(path.join(root, 'deno.json')) || fs.existsSync(path.join(root, 'deno.jsonc'))) { services.push('deno'); templateId = 'blank'; confidence = Math.max(confidence, 0.9); evidence.push('Deno configuration'); commands.dev = 'deno task dev'; commands.test = 'deno task test'; }
    if (fs.existsSync(path.join(root, 'Cargo.toml'))) { evidence.push('Cargo.toml (Rust toolchain required)'); confidence = Math.max(confidence, 0.85); commands.build = 'cargo build'; commands.test = 'cargo test'; }
    if (fs.existsSync(path.join(root, 'index.html')) && !packageInfo && !composer) { templateId = 'static'; services.push('caddy'); confidence = Math.max(confidence, 0.85); evidence.push('index.html'); }

    let compose = null;
    if (composeFile) {
      compose = this.inspectCompose(composeFile);
      services.push(...compose.services);
      evidence.push(`${path.basename(composeFile)}: ${compose.containers.length} service(s)`);
      confidence = Math.max(confidence, 0.8);
    }
    let devcontainer = null;
    if (fs.existsSync(devcontainerFile)) {
      devcontainer = this.inspectDevcontainer(devcontainerFile);
      evidence.push('.devcontainer/devcontainer.json');
      confidence = Math.max(confidence, 0.8);
    }
    const git = fs.existsSync(path.join(root, '.git'));
    if (git) evidence.push('Git repository');
    return {
      success: true,
      root,
      name: path.basename(root),
      templateId,
      publicDir,
      services: unique(services),
      commands,
      packageManager: packageInfo ? packageManager : null,
      confidence,
      evidence,
      compose,
      devcontainer,
      wordpressPlugin,
      git,
      detectedAt: new Date().toISOString()
    };
  }

  inspectCompose(file) {
    const source = readText(path.resolve(file));
    if (!source) throw new Error('Compose file is empty or too large');
    const lines = source.replace(/\t/g, '  ').split(/\r?\n/);
    const containers = [];
    let inServices = false; let servicesIndent = -1; let serviceEntryIndent = null; let current = null;
    for (const raw of lines) {
      const line = raw.replace(/\s+#.*$/, '');
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (/^services\s*:\s*$/.test(line.trim())) { inServices = true; servicesIndent = indent; serviceEntryIndent = null; continue; }
      if (inServices && indent <= servicesIndent) { inServices = false; serviceEntryIndent = null; current = null; }
      if (!inServices) continue;
      const serviceMatch = line.match(/^\s{2,}([A-Za-z0-9_.-]+)\s*:\s*$/);
      if (serviceMatch && (serviceEntryIndent === null || indent === serviceEntryIndent)) {
        serviceEntryIndent ??= indent;
        current = { name: serviceMatch[1], image: '', ports: [] };
        containers.push(current);
        continue;
      }
      if (!current) continue;
      const image = line.match(/^\s*image\s*:\s*["']?([^"'\s]+)["']?/);
      if (image) current.image = image[1];
      const port = line.match(/^\s*-\s*["']?(\d+)(?::(\d+))?(?:\/\w+)?["']?/);
      if (port) current.ports.push({ host: Number(port[2] ? port[1] : port[1]), container: Number(port[2] || port[1]) });
    }
    const managed = [];
    for (const container of containers) {
      const value = `${container.name} ${container.image}`.toLowerCase();
      if (/postgres/.test(value)) managed.push('postgresql');
      else if (/mariadb/.test(value)) managed.push('mariadb');
      else if (/mysql/.test(value)) managed.push('mysql');
      else if (/mongo/.test(value)) managed.push('mongodb');
      else if (/redis/.test(value)) managed.push('redis');
      else if (/memcached/.test(value)) managed.push('memcached');
      else if (/minio/.test(value)) managed.push('minio');
      else if (/nginx/.test(value)) managed.push('nginx');
      else if (/caddy/.test(value)) managed.push('caddy');
      else if (/apache|httpd/.test(value)) managed.push('apache');
      else if (/node/.test(value)) managed.push('node');
      else if (/python/.test(value)) managed.push('python');
      else if (/php/.test(value)) managed.push('php');
    }
    return { file: path.resolve(file), containers, services: unique(managed), parser: 'safe-compose-subset' };
  }

  inspectDevcontainer(file) {
    const config = readJsonc(path.resolve(file));
    if (!config) throw new Error('Invalid devcontainer JSON');
    return {
      file: path.resolve(file),
      name: String(config.name || ''),
      image: String(config.image || ''),
      dockerComposeFile: config.dockerComposeFile || null,
      service: String(config.service || ''),
      workspaceFolder: String(config.workspaceFolder || ''),
      forwardedPorts: Array.isArray(config.forwardPorts) ? config.forwardPorts.filter(port => Number.isInteger(Number(port))).map(Number) : [],
      features: config.features && typeof config.features === 'object' ? Object.keys(config.features) : []
    };
  }
}

module.exports = ProjectDetector;
