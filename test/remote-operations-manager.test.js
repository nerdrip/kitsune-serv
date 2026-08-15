'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RemoteOperationsManager = require('../src/remote-operations-manager');

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-ops-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, manager: new RemoteOperationsManager(root, { connect: async () => { throw new Error('unused'); } }) }; }

test('runbooks persist bounded declarative steps', t => {
  const { manager } = fixture(t); const saved = manager.saveRunbook({ name: 'Deploy', parameters: ['service'], steps: [{ name: 'Restart', command: 'systemctl restart {{service}}' }] }).runbook;
  assert.equal(manager.listRunbooks()[0].id, saved.id); assert.equal(manager.listRunbooks()[0].steps[0].command, 'systemctl restart {{service}}');
  assert.throws(() => manager.saveRunbook({ name: 'Empty', steps: [] }), /at least one/i);
});

test('remote operations reject shell metacharacters and unsafe actions', t => {
  const { manager } = fixture(t);
  assert.throws(() => manager.docker({}, 'exec', 'container'), /unsupported/i);
  assert.throws(() => manager.systemd({}, 'restart', 'nginx; reboot'), /invalid/i);
  assert.throws(() => manager.signal({}, 1, 'KILL'), /invalid PID/i);
  assert.throws(() => manager.archive({}, 'tar', '../../etc', '/tmp/a.tgz'), /invalid source/i);
});

test('atomic deployment stages, backs up, activates and health-checks a release', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-deploy-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'index.js'), 'ok');
  const transfers = []; const manager = new RemoteOperationsManager(root, { transferRecursive: async (...args) => { transfers.push(args); return { success: true }; } });
  const commands = []; manager.exec = async (_input, command) => { commands.push(command); return { success: true, code: 0, stdout: '', stderr: '' }; };
  const stages = []; const result = await manager.deploy({ id: 'server' }, { localDirectory: source, remoteDirectory: '/var/www/app', healthCommand: 'curl -fsS localhost/health' }, stage => stages.push(stage));
  assert.equal(result.success, true); assert.equal(transfers.length, 1); assert.match(commands.join('\n'), /tar -czf/); assert.match(commands.join('\n'), /health/); assert.ok(stages.some(item => item.stage === 'activate' && item.status === 'success'));
  await assert.rejects(() => manager.deploy({}, { localDirectory: source, remoteDirectory: '/' }), /specific absolute/i);
});
