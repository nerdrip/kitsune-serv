'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CommandManager = require('../src/command-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-commands-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = { id: 'project-one', name: 'One', root, env: { KITSUNE_TEST_VALUE: 'works' }, commands: { test: 'node -p process.env.KITSUNE_TEST_VALUE' } };
  const manager = new CommandManager({ get: () => project }, { buildEnvironment: env => ({ ...env }) }, null);
  t.after(() => manager.stopAll());
  return { manager, project };
}

test('runs only named project commands and captures output', async t => {
  const { manager } = fixture(t);
  assert.equal(manager.start('project-one', 'missing').success, false);
  const started = manager.start('project-one', 'test');
  assert.equal(started.success, true);
  await new Promise(resolve => {
    manager.onExit = resolve;
  });
  const task = manager.get(started.task.id);
  assert.equal(task.status, 'completed');
  assert.equal(task.output.trim(), 'works');
});

test('waits for lifecycle commands and merges project and integration environments', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-command-wait-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = { id: 'project-env', name: 'Env', root, activeEnvironment: 'testing', commands: { verify: 'node -p process.env.PROJECT_VALUE+process.env.INTEGRATION_VALUE' } };
  const projectManager = {
    get: () => project,
    resolveEnvironment: () => ({ PROJECT_VALUE: 'project-' })
  };
  const manager = new CommandManager(projectManager, { buildEnvironment: env => ({ ...env }) }, null);
  manager.setIntegrationEnvironmentProvider(() => ({ INTEGRATION_VALUE: 'integration' }));
  const result = await manager.runAndWait(project.id, 'verify', { timeoutMs: 5000 });
  assert.equal(result.success, true);
  assert.equal(result.task.output.trim(), 'project-integration');
});

test('server mode refuses to open desktop IDEs', async t => {
  const { project } = fixture(t);
  const manager = new CommandManager({ get: () => project }, null, null, { allowDesktopIntegration: false });
  assert.equal((await manager.openIDE(project.id, 'vscode')).success, false);
});

test('Windows IDE launcher prefers Code.exe over the code.cmd shim', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-vscode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const shim = path.join(bin, 'code.cmd');
  const executable = path.join(root, 'Code.exe');
  fs.writeFileSync(shim, '@echo off');
  fs.writeFileSync(executable, '');
  const calls = [];
  const fakeChild = new (require('node:events').EventEmitter)();
  fakeChild.unref = () => {};
  const manager = new CommandManager({ get: () => ({ id: 'one', root, env: {} }) }, { buildEnvironment: env => env }, null, {
    platform: 'win32',
    spawnSync: (command, args) => command === 'where.exe' && args[0] === 'code'
      ? { status: 0, stdout: `${shim}\r\n`, stderr: '' }
      : { status: 1, stdout: '', stderr: '' },
    spawn: (command, args) => {
      calls.push({ command, args });
      queueMicrotask(() => fakeChild.emit('spawn'));
      return fakeChild;
    }
  });
  const result = await manager.openIDE('one', 'vscode');
  assert.equal(result.success, true);
  assert.equal(calls[0].command, executable);
  assert.deepEqual(calls[0].args, [root]);
});

test('IDE launcher returns a controlled error when spawning fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-ide-error-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'Code.exe');
  fs.writeFileSync(executable, '');
  const fakeChild = new (require('node:events').EventEmitter)();
  const manager = new CommandManager({ get: () => ({ id: 'one', root, env: {} }) }, null, null, {
    platform: 'win32',
    spawnSync: (command, args) => command === 'where.exe' && args[0] === 'code'
      ? { status: 0, stdout: `${executable}\r\n`, stderr: '' }
      : { status: 1, stdout: '', stderr: '' },
    spawn: () => {
      queueMicrotask(() => fakeChild.emit('error', new Error('launch denied')));
      return fakeChild;
    }
  });
  const result = await manager.openIDE('one', 'vscode');
  assert.equal(result.success, false);
  assert.match(result.error, /launch denied/);
});

test('Windows toolchain scan resolves and executes cmd and bat shims', () => {
  const calls = [];
  const spawnSync = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'where.exe' && args[0] === 'npm') {
      return { status: 0, stdout: 'C:\\Tools\\npm\r\nC:\\Tools\\npm.cmd\r\n', stderr: '' };
    }
    if (command === 'where.exe' && args[0] === 'pip') {
      return { status: 0, stdout: 'C:\\Python\\Scripts\\pip.bat\r\n', stderr: '' };
    }
    if (command === 'cmd.exe' && args.includes('C:\\Tools\\npm.cmd')) return { status: 0, stdout: '11.16.0\r\n', stderr: '' };
    if (command === 'cmd.exe' && args.includes('C:\\Python\\Scripts\\pip.bat')) return { status: 0, stdout: 'pip 26.1.2\r\n', stderr: '' };
    return { status: 1, stdout: '', stderr: '' };
  };
  const pathManager = {
    buildEnvironment: env => ({ ...env, PATH: 'C:\\Tools;C:\\Python\\Scripts' }),
    isManagedEntry: () => false,
    configManager: { getConfig: () => ({}), getActiveProfile: () => null }
  };
  const manager = new CommandManager(null, pathManager, null, { platform: 'win32', comspec: 'cmd.exe', spawnSync });
  const tools = manager.toolchains();
  assert.equal(tools.find(tool => tool.id === 'npm').installed, true);
  assert.equal(tools.find(tool => tool.id === 'npm').version, '11.16.0');
  assert.equal(tools.find(tool => tool.id === 'pip').installed, true);
  assert.ok(calls.some(call => call[0] === 'cmd.exe' && call.includes('C:\\Tools\\npm.cmd')));
});
