'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultServerDataRoot, initializeServerDataRoot } = require('../src/runtime-paths');

test('server data root follows native Windows and Linux user-data conventions', () => {
  const codeRoot = path.join('D:', 'apps', 'kitsuneserv');
  assert.equal(
    defaultServerDataRoot(codeRoot, { APPDATA: path.join('D:', 'Profiles', 'Ada', 'Roaming') }, 'win32'),
    path.join('D:', 'Profiles', 'Ada', 'Roaming', 'kitsuneserv')
  );
  assert.equal(
    defaultServerDataRoot('/opt/kitsuneserv', { HOME: '/home/ada' }, 'linux'),
    path.join('/home/ada', '.config', 'kitsuneserv')
  );
  assert.equal(
    defaultServerDataRoot('/opt/kitsuneserv', { XDG_CONFIG_HOME: '/data/config' }, 'linux'),
    path.join('/data/config', 'kitsuneserv')
  );
});

test('server data root is initialized and seeded without mutating the code directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-runtime-'));
  const codeRoot = path.join(temp, 'code');
  const dataRoot = path.join(temp, 'state');
  fs.mkdirSync(path.join(codeRoot, 'config'), { recursive: true });
  fs.mkdirSync(path.join(codeRoot, 'www'), { recursive: true });
  fs.writeFileSync(path.join(codeRoot, 'config', 'instances.json'), '{"instances":[]}');
  fs.writeFileSync(path.join(codeRoot, 'www', 'index.html'), '<h1>seed</h1>');

  const result = initializeServerDataRoot(codeRoot, { dataRoot, platform: 'linux', env: {} });
  assert.equal(result.dataRoot, path.resolve(dataRoot));
  assert.equal(fs.readFileSync(path.join(dataRoot, 'www', 'index.html'), 'utf8'), '<h1>seed</h1>');
  assert.ok(fs.statSync(path.join(dataRoot, 'servers')).isDirectory());

  fs.writeFileSync(path.join(dataRoot, 'www', 'index.html'), '<h1>user</h1>');
  initializeServerDataRoot(codeRoot, { dataRoot, platform: 'linux', env: {} });
  assert.equal(fs.readFileSync(path.join(dataRoot, 'www', 'index.html'), 'utf8'), '<h1>user</h1>');
});
