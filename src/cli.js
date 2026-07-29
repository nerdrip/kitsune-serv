#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { initializeServerDataRoot } = require('./runtime-paths');
const ConfigManager = require('./config-manager');
const DownloadManager = require('./download-manager');
const ServiceManager = require('./service-manager');
const { PathManager } = require('./path-manager');
const ActivityManager = require('./activity-manager');
const DomainManager = require('./domain-manager');
const ProjectManager = require('./project-manager');
const DiagnosticsManager = require('./diagnostics-manager');

function parseYamlScalar(value) {
  const trimmed = String(value || '').trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try { return JSON.parse(trimmed); } catch { return trimmed; }
}

function parseProjectManifest(contents) {
  const result = { services: [], runtimeVersions: {}, commands: {} };
  let section = '';
  for (const rawLine of String(contents).replace(/\r\n/g, '\n').split('\n')) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    if (indent === 0) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
      if (!match) continue;
      const [, key, value] = match;
      if (!value) { section = key; continue; }
      section = '';
      const map = { template: 'templateId', versions: 'runtimeVersions' };
      result[map[key] || key] = parseYamlScalar(value);
      continue;
    }
    if (section === 'services' && line.startsWith('- ')) result.services.push(line.slice(2).trim());
    if (['versions', 'commands'].includes(section)) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (match) result[section === 'versions' ? 'runtimeVersions' : 'commands'][match[1]] = parseYamlScalar(match[2]);
    }
  }
  if (result.schemaVersion !== 1 || !result.name) throw new Error('Invalid or unsupported kitsune.yml');
  return result;
}

function createRuntime() {
  const codeRoot = path.resolve(__dirname, '..');
  const { dataRoot, defaultsRoot } = initializeServerDataRoot(codeRoot);
  process.chdir(dataRoot);
  const config = new ConfigManager(dataRoot);
  const downloads = new DownloadManager({ appRoot: dataRoot, catalogRoot: defaultsRoot });
  const services = new ServiceManager(downloads, config);
  const pathManager = new PathManager(downloads, config);
  const activities = new ActivityManager(dataRoot);
  const domains = new DomainManager(dataRoot);
  const projects = new ProjectManager(dataRoot, config, downloads, services, activities, domains);
  const diagnostics = new DiagnosticsManager(dataRoot, config, downloads, services, pathManager);
  return { dataRoot, defaultsRoot, config, downloads, services, pathManager, activities, domains, projects, diagnostics };
}

function usage() {
  return `KitsuneServ CLI

Usage:
  kitsune doctor [--json]
  kitsune status [--json]
  kitsune project list
  kitsune project create <name> [template]
  kitsune project export <id> [file]
  kitsune project import <file>
  kitsune up [project-id] [--no-wait]
  kitsune install <service> <version>
  kitsune use <service> <version>
  kitsune service <start|stop|restart|status> <service>
  kitsune path <add|remove|apply> <service...|all>
  kitsune port free [start]
  kitsune domains <status|sync>
  kitsune cache <status|clear|export|import> [directory]
  kitsune templates
`;
}

function print(value, json = false) {
  if (json || typeof value !== 'string') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${value}\n`);
}

async function resolveCurrentProject(runtime, requestedId, invocationRoot = process.cwd()) {
  if (requestedId) return runtime.projects.get(requestedId);
  const cwd = path.resolve(invocationRoot);
  const registered = runtime.projects.list().find(project => path.resolve(project.root) === cwd);
  if (registered) return registered;
  const manifestPath = path.join(cwd, 'kitsune.yml');
  if (!fs.existsSync(manifestPath)) throw new Error('No registered project or kitsune.yml found in the current directory');
  const manifest = parseProjectManifest(fs.readFileSync(manifestPath, 'utf8'));
  return runtime.projects.create({ ...manifest, root: cwd, createDirectory: false });
}

async function main(argv = process.argv.slice(2)) {
  const invocationRoot = process.cwd();
  const json = argv.includes('--json');
  argv = argv.filter(arg => arg !== '--json');
  const [command, subcommand, ...rest] = argv;
  if (!command || ['help', '--help', '-h'].includes(command)) { print(usage()); return 0; }
  const runtime = createRuntime();
  if (command === 'doctor') {
    const report = await runtime.diagnostics.doctor();
    if (json) print(report, true);
    else {
      print(report.healthy ? '✓ KitsuneServ environment is healthy' : `✕ ${report.counts.error} error(s), ${report.counts.warning} warning(s)`);
      for (const issue of report.issues) print(`  [${issue.severity}] ${issue.message}`);
    }
    return report.healthy ? 0 : 2;
  }
  if (command === 'status') {
    const payload = { dataRoot: runtime.dataRoot, services: runtime.services.getAllStatuses(), projects: runtime.projects.list(), path: runtime.pathManager.getStatus() };
    print(payload, true);
    return 0;
  }
  if (command === 'templates') { print(runtime.projects.templates(), true); return 0; }
  if (command === 'project') {
    if (subcommand === 'list') { print(runtime.projects.list(), true); return 0; }
    if (subcommand === 'create') {
      if (!rest[0]) throw new Error('Project name is required');
      print(runtime.projects.create({ name: rest[0], templateId: rest[1] || 'blank' }), true); return 0;
    }
    if (subcommand === 'export') {
      if (!rest[0]) throw new Error('Project id is required');
      const manifest = runtime.projects.exportManifest(rest[0]);
      const output = rest[1] ? path.resolve(invocationRoot, rest[1]) : path.resolve(invocationRoot, `${manifest.project.slug}.kitsune.json`);
      fs.writeFileSync(output, JSON.stringify(manifest, null, 2), 'utf8');
      print(output); return 0;
    }
    if (subcommand === 'import') {
      if (!rest[0]) throw new Error('Manifest file is required');
      const payload = JSON.parse(fs.readFileSync(path.resolve(invocationRoot, rest[0]), 'utf8'));
      print(runtime.projects.importManifest(payload, { createDirectory: true }), true); return 0;
    }
    throw new Error('Unknown project command');
  }
  if (command === 'up') {
    const projectId = subcommand && !subcommand.startsWith('--') ? subcommand : null;
    const noWait = argv.includes('--no-wait');
    const project = await resolveCurrentProject(runtime, projectId, invocationRoot);
    const result = await runtime.projects.start(project.id);
    print(result, true);
    if (!result.success) return 2;
    if (noWait) {
      print('Warning: --no-wait releases process ownership; use the desktop or web manager for persistent detached orchestration.');
      return 0;
    }
    print(`Project ${project.name} is running. Press Ctrl+C to stop its managed services.`);
    await new Promise(resolve => {
      const stop = async () => { await runtime.projects.stop(project.id); resolve(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
    });
    return 0;
  }
  if (command === 'install') {
    if (!subcommand || !rest[0]) throw new Error('Service and version are required');
    const result = await runtime.downloads.download(subcommand, rest[0], progress => {
      if (progress?.percent != null) process.stderr.write(`\r${subcommand} ${rest[0]}: ${Math.round(progress.percent)}%`);
    });
    process.stderr.write('\n'); print(result, true); return result.success ? 0 : 2;
  }
  if (command === 'use') {
    if (!subcommand || !rest[0]) throw new Error('Service and version are required');
    const result = await runtime.services.switchVersion(subcommand, rest[0]);
    if (result.success) runtime.pathManager.syncIfSelected(subcommand);
    print(result, true); return result.success ? 0 : 2;
  }
  if (command === 'service') {
    const action = subcommand; const service = rest[0];
    if (!service) throw new Error('Service name is required');
    let result;
    if (action === 'start') result = await runtime.services.startService(service);
    else if (action === 'stop') result = await runtime.services.stopService(service);
    else if (action === 'restart') { await runtime.services.stopService(service); result = await runtime.services.startService(service); }
    else if (action === 'status') result = runtime.services.getServiceStatus(service);
    else throw new Error('Unknown service action');
    print(result, true); return result.success === false ? 2 : 0;
  }
  if (command === 'path') {
    const action = subcommand;
    const selected = rest.includes('all') ? undefined : rest;
    const result = action === 'add' ? runtime.pathManager.add(selected) : action === 'remove' ? runtime.pathManager.remove(selected) : action === 'apply' ? runtime.pathManager.apply(selected || []) : runtime.pathManager.getStatus();
    print(result, true); return result.success === false ? 2 : 0;
  }
  if (command === 'port' && subcommand === 'free') {
    const result = await runtime.diagnostics.findFreePort(rest[0] || 3000);
    print(result, true); return result.success ? 0 : 2;
  }
  if (command === 'domains') {
    const projects = runtime.projects.list();
    const result = subcommand === 'sync' ? runtime.domains.apply(projects, { elevate: true }) : runtime.domains.status(projects);
    print(result, true); return result.success ? 0 : 2;
  }
  if (command === 'cache') {
    let result;
    if (!subcommand || subcommand === 'status') result = runtime.downloads.cacheStatus();
    else if (subcommand === 'clear') result = runtime.downloads.clearCache();
    else if (subcommand === 'export') {
      if (!rest[0]) throw new Error('Cache export directory is required');
      result = runtime.downloads.exportCache(path.resolve(invocationRoot, rest[0]));
    } else if (subcommand === 'import') {
      if (!rest[0]) throw new Error('Cache import directory is required');
      result = runtime.downloads.importCache(path.resolve(invocationRoot, rest[0]));
    }
    else throw new Error('Unknown cache command');
    print(result, true); return result.success === false ? 2 : 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`KitsuneServ: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseProjectManifest, createRuntime };
