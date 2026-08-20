'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

test('remote suite exposes xterm PTY, server workspace and production guard controls', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'src', 'server.js'), 'utf8');
  assert.match(html, /@xterm\/xterm\/lib\/xterm\.js/);
  assert.match(html, /id="panel-server-workspace"/);
  assert.match(html, /id="remote-session-production"/);
  assert.match(html, /REMOTE OPERATIONS/);
  assert.match(html, /Parameterized runbooks/);
  assert.match(html, /id="fm-sync"/);
  assert.match(html, /Atomic remote deployment/);
  assert.match(html, /PORTABLE TOOLKIT/);
  assert.match(html, /Otwórz w WinSCP/);
  assert.match(renderer, /new Terminal\(/);
  assert.match(renderer, /Production Guard/);
  assert.match(main, /nodePty\.spawn/);
  assert.match(main, /terminal:profiles/);
  assert.match(renderer, /api\.terminal\.attach\(id\)/);
  assert.match(server, /case 'terminal\/attach'/);
  assert.match(server, /terminal\.backlog/);
  assert.match(server, /client\.shell/);
});

test('web mode removes native launchers and keeps cross-column drag independent of DataTransfer quirks', () => {
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(renderer, /runtimeMode === 'server'/);
  for (const id of ['fm-open-winscp', 'workspace-open-putty', 'workspace-open-winscp', 'workspace-mount-sftp']) assert.match(renderer, new RegExp(id));
  assert.match(renderer, /draggedFile: null/);
  assert.match(renderer, /remoteState\.draggedFile = \{ kind, path: entry\.path, entry \}/);
  assert.match(renderer, /Array\.from\(event\.dataTransfer\?\.types/);
});
