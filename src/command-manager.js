'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const TOOL_CATALOG = Object.freeze([
  { id: 'git', command: 'git', args: ['--version'], category: 'source' },
  { id: 'composer', command: 'composer', args: ['--version'], category: 'php' },
  { id: 'npm', command: 'npm', args: ['--version'], category: 'javascript' },
  { id: 'pnpm', command: 'pnpm', args: ['--version'], category: 'javascript' },
  { id: 'yarn', command: 'yarn', args: ['--version'], category: 'javascript' },
  { id: 'corepack', command: 'corepack', args: ['--version'], category: 'javascript' },
  { id: 'pip', command: 'pip', args: ['--version'], category: 'python' },
  { id: 'pipx', command: 'pipx', args: ['--version'], category: 'python' },
  { id: 'uv', command: 'uv', args: ['--version'], category: 'python' },
  { id: 'poetry', command: 'poetry', args: ['--version'], category: 'python' },
  { id: 'go', command: 'go', args: ['version'], category: 'go' },
  { id: 'cargo', command: 'cargo', args: ['--version'], category: 'rust' },
  { id: 'java', command: 'java', args: ['--version'], category: 'java' },
  { id: 'dotnet', command: 'dotnet', args: ['--version'], category: 'dotnet' }
]);

const IDE_CATALOG = Object.freeze([
  { id: 'vscode', name: 'Visual Studio Code', commands: ['code'], args: root => [root] },
  { id: 'phpstorm', name: 'PhpStorm', commands: process.platform === 'win32' ? ['phpstorm64.exe', 'phpstorm.exe'] : ['phpstorm'], args: root => [root] },
  { id: 'webstorm', name: 'WebStorm', commands: process.platform === 'win32' ? ['webstorm64.exe', 'webstorm.exe'] : ['webstorm'], args: root => [root] },
  { id: 'pycharm', name: 'PyCharm', commands: process.platform === 'win32' ? ['pycharm64.exe', 'pycharm.exe'] : ['pycharm'], args: root => [root] },
  { id: 'idea', name: 'IntelliJ IDEA', commands: process.platform === 'win32' ? ['idea64.exe', 'idea.exe'] : ['idea'], args: root => [root] },
  { id: 'rider', name: 'Rider', commands: process.platform === 'win32' ? ['rider64.exe', 'rider.exe'] : ['rider'], args: root => [root] },
  { id: 'zed', name: 'Zed', commands: ['zed'], args: root => [root] }
]);

class CommandManager {
  constructor(projectManager, pathManager, activityManager, options = {}) {
    this.projectManager = projectManager;
    this.pathManager = pathManager;
    this.activityManager = activityManager;
    this.allowDesktopIntegration = options.allowDesktopIntegration !== false;
    this.platformManager = options.platformManager || null;
    this._spawn = options.spawn || spawn;
    this.tasks = new Map();
    this.outputLimit = Math.max(64 * 1024, Number(options.outputLimit) || 2 * 1024 * 1024);
    this.onOutput = null;
    this.onExit = null;
    this.toolProvider = null;
  }

  setToolProvider(provider) {
    this.toolProvider = typeof provider === 'function' ? provider : null;
  }

  _environment(project) {
    const base = this.pathManager?.buildEnvironment(process.env) || { ...process.env };
    return { ...base, ...project.env, KITSUNE_PROJECT_ID: project.id, KITSUNE_PROJECT_ROOT: project.root };
  }

  _append(task, stream, chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    task.output += text;
    if (Buffer.byteLength(task.output) > this.outputLimit) task.output = task.output.slice(-this.outputLimit);
    const payload = { id: task.id, projectId: task.projectId, commandName: task.commandName, stream, data: text };
    try { this.onOutput?.(payload); } catch {}
  }

  start(projectId, commandName, execution = 'host', distribution = '') {
    const project = this.projectManager.get(projectId);
    if (typeof commandName !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(commandName)) return { success: false, error: 'Invalid project command name' };
    const command = project.commands?.[commandName];
    if (!command) return { success: false, error: `Project command "${commandName}" is not configured` };
    if (!fs.existsSync(project.root)) return { success: false, error: 'Project directory does not exist' };
    const duplicate = [...this.tasks.values()].find(task => task.projectId === project.id && task.commandName === commandName && task.status === 'running');
    if (duplicate) return { success: false, error: 'This project command is already running', task: this._public(duplicate) };
    const id = crypto.randomUUID();
    const isWindows = process.platform === 'win32';
    let executable = isWindows ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
    let args = isWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
    let taskRoot = project.root;
    if (execution === 'wsl') {
      const wsl = this.platformManager?.wsl?.();
      if (!isWindows || !wsl?.supported) return { success: false, error: 'WSL is not available' };
      if (distribution && !wsl.distributions.includes(distribution)) return { success: false, error: 'Unknown WSL distribution' };
      const converted = this.platformManager.toWslPath(project.root, distribution);
      if (!converted.success) return converted;
      executable = wsl.executable;
      args = [...(distribution ? ['--distribution', distribution] : []), '--cd', converted.path, '--exec', 'sh', '-lc', command];
    } else if (execution !== 'host') return { success: false, error: 'Unknown command execution environment' };
    const child = this._spawn(executable, args, {
      cwd: project.root,
      env: this._environment(project),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const task = {
      id, projectId: project.id, projectName: project.name, commandName, command, execution, distribution: execution === 'wsl' ? distribution || null : null, taskRoot,
      status: 'running', pid: child.pid || null, output: '', startedAt: new Date().toISOString(), finishedAt: null,
      exitCode: null, process: child
    };
    this.tasks.set(id, task);
    child.stdout.on('data', chunk => this._append(task, 'stdout', chunk));
    child.stderr.on('data', chunk => this._append(task, 'stderr', chunk));
    child.on('error', error => this._append(task, 'stderr', `[KitsuneServ] ${error.message}\n`));
    child.on('exit', code => {
      task.status = code === 0 ? 'completed' : task.status === 'stopping' ? 'cancelled' : 'failed';
      task.exitCode = code;
      task.finishedAt = new Date().toISOString();
      task.process = null;
      try { this.onExit?.(this._public(task)); } catch {}
    });
    return { success: true, task: this._public(task) };
  }

  stop(id) {
    const task = this.tasks.get(id);
    if (!task || !task.process || task.status !== 'running') return { success: false, error: 'Running task not found' };
    task.status = 'stopping';
    try {
      if (process.platform === 'win32' && task.pid) spawnSync('taskkill.exe', ['/pid', String(task.pid), '/t', '/f'], { windowsHide: true });
      else task.process.kill('SIGTERM');
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  }

  _public(task) {
    const { process: _process, ...result } = task;
    return structuredClone(result);
  }

  list(projectId = null) {
    return [...this.tasks.values()]
      .filter(task => !projectId || task.projectId === projectId)
      .map(task => this._public(task))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? this._public(task) : null;
  }

  clearFinished() {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (!['running', 'stopping'].includes(task.status)) { this.tasks.delete(id); removed += 1; }
    }
    return { success: true, removed };
  }

  toolchains() {
    const env = this.pathManager?.buildEnvironment(process.env) || process.env;
    const contributed = this.toolProvider ? this.toolProvider().map(tool => ({ ...tool, args: tool.versionArgs || ['--version'], category: 'plugin' })) : [];
    return [...TOOL_CATALOG, ...contributed].map(tool => {
      const result = spawnSync(tool.command, tool.args, { env, encoding: 'utf8', windowsHide: true, timeout: 5000 });
      const output = String(result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || '';
      return { ...tool, installed: result.status === 0, version: output.slice(0, 300) };
    });
  }

  ides() {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    return IDE_CATALOG.map(ide => {
      let executable = '';
      for (const candidate of ide.commands) {
        const result = spawnSync(command, [candidate], { encoding: 'utf8', windowsHide: true });
        if (result.status === 0) { executable = String(result.stdout || '').split(/\r?\n/).map(value => value.trim()).find(Boolean) || candidate; break; }
      }
      return { id: ide.id, name: ide.name, installed: Boolean(executable), executable };
    });
  }

  openIDE(projectId, ideId) {
    if (!this.allowDesktopIntegration) return { success: false, error: 'Opening a desktop IDE is disabled in server mode' };
    const project = this.projectManager.get(projectId);
    const ide = IDE_CATALOG.find(item => item.id === ideId);
    const status = this.ides().find(item => item.id === ideId);
    if (!ide || !status?.installed) return { success: false, error: 'Selected IDE is not installed or not available in PATH' };
    const child = spawn(status.executable, ide.args(project.root), { cwd: project.root, detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { success: true };
  }

  stopAll() {
    const results = [];
    for (const task of this.tasks.values()) if (task.status === 'running') results.push(this.stop(task.id));
    return results;
  }
}

CommandManager.TOOL_CATALOG = TOOL_CATALOG;
CommandManager.IDE_CATALOG = IDE_CATALOG;

module.exports = CommandManager;
