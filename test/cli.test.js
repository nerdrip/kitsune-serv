'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProjectManifest } = require('../src/cli');

test('CLI parses the declarative kitsune.yml format', () => {
  const manifest = parseProjectManifest(`# KitsuneServ\nschemaVersion: 1\nname: "API"\ndomain: "api.test"\ntemplate: "node-postgresql"\npublicDir: "."\nhttps: false\nservices:\n  - postgresql\n  - node\nversions:\n  node: "24.18.0"\ncommands:\n  dev: "npm run dev"\n`);
  assert.equal(manifest.name, 'API');
  assert.deepEqual(manifest.services, ['postgresql', 'node']);
  assert.equal(manifest.runtimeVersions.node, '24.18.0');
  assert.equal(manifest.commands.dev, 'npm run dev');
});
