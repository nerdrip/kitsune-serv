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

test('server mode refuses to open desktop IDEs', t => {
  const { project } = fixture(t);
  const manager = new CommandManager({ get: () => project }, null, null, { allowDesktopIntegration: false });
  assert.equal(manager.openIDE(project.id, 'vscode').success, false);
});
