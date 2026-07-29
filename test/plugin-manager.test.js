'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PluginManager = require('../src/plugin-manager');

test('installs integrity-checked declarative plugins and exposes templates', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-plugins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'kitsune-plugin.json'), JSON.stringify({
    schemaVersion: 1, id: 'example.stack', name: 'Example Stack', version: '1.0.0', platforms: [process.platform],
    contributes: { projectTemplates: [{ id: 'api', name: 'Example API', services: ['node'], publicDir: '.', commands: { dev: 'npm run dev' } }] }
  }));
  const manager = new PluginManager(root);
  const installed = manager.install(source);
  assert.equal(installed.success, true);
  assert.equal(manager.list()[0].integrity, true);
  assert.equal(manager.projectTemplates()[0].id, 'example.stack:api');
  fs.appendFileSync(path.join(manager.pluginRoot, 'example.stack', 'kitsune-plugin.json'), ' ');
  assert.equal(manager.list()[0].integrity, false);
  assert.equal(manager.projectTemplates().length, 0);
});

test('rejects executable plugin manifests and unsafe identifiers', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-plugin-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'kitsune-plugin.json'), JSON.stringify({ schemaVersion: 1, id: '../escape', name: 'Bad', version: '1.0.0' }));
  assert.equal(new PluginManager(root).install(source).success, false);
});
