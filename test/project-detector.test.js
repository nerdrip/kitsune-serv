'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ProjectDetector = require('../src/project-detector');

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('detects an existing Next.js workspace without modifying it', t => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'detected-app',
    scripts: { dev: 'next dev', build: 'next build' },
    dependencies: { next: '^16.0.0' }
  }));
  const detected = new ProjectDetector().detect(root);
  assert.equal(detected.templateId, 'nextjs');
  assert.ok(detected.services.includes('node'));
  assert.equal(detected.commands.dev, 'npm run dev');
  assert.equal(fs.existsSync(path.join(root, 'kitsune.yml')), false);
});

test('reads compose services with non-standard indentation', t => {
  const root = directory(t);
  const file = path.join(root, 'compose.yml');
  fs.writeFileSync(file, 'services:\n    database:\n      image: postgres:18\n      ports:\n        - "5544:5432"\n    cache:\n      image: redis:8\n');
  const compose = new ProjectDetector().inspectCompose(file);
  assert.deepEqual(compose.services, ['postgresql', 'redis']);
  assert.equal(compose.containers[0].ports[0].host, 5544);
});

test('parses JSONC devcontainer metadata safely', t => {
  const root = directory(t);
  const file = path.join(root, 'devcontainer.json');
  fs.writeFileSync(file, '{ // comment\n "name": "Dev", "image": "node:24", "forwardPorts": [3000, 5432,],\n}');
  const result = new ProjectDetector().inspectDevcontainer(file);
  assert.equal(result.name, 'Dev');
  assert.deepEqual(result.forwardedPorts, [3000, 5432]);
});

test('recognizes a WordPress plugin folder for the visual Test Lab', t => {
  const root = directory(t);
  fs.writeFileSync(path.join(root, 'endpoint-builder.php'), '<?php\n/*\nPlugin Name: Visual Endpoint Builder\nVersion: 2.4.0\nText Domain: veb\n*/\n');
  const detected = new ProjectDetector().detect(root);
  assert.equal(detected.wordpressPlugin.detected, true);
  assert.equal(detected.wordpressPlugin.name, 'Visual Endpoint Builder');
  assert.equal(detected.wordpressPlugin.entryFile, 'endpoint-builder.php');
  assert.ok(detected.services.includes('php'));
});
