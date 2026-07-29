'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

function waitForReady(child, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), timeout);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('KitsuneServ — Server Mode')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
  });
}

test('web mode authenticates and exposes a desktop-parity API', { timeout: 30000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-web-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['src/server.js', '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      KITSUNE_HOST: '127.0.0.1',
      KITSUNE_USER: 'admin',
      KITSUNE_PASS: 'secret+word',
      KITSUNE_DATA_DIR: dataRoot,
      KITSUNE_DISABLE_SYSTEM_INTEGRATION: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let serverStderr = '';
  child.stderr.on('data', chunk => { serverStderr += chunk; });
  t.after(() => { if (!child.killed) child.kill(); });
  await waitForReady(child);
  const base = `http://127.0.0.1:${port}`;

  const unauthorized = await fetch(`${base}/api/config/get`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(unauthorized.status, 401);

  const unicodeLogin = await fetch(`${base}/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=%F0%9F%A6%8A&password=wrong'
  });
  assert.equal(unicodeLogin.status, 200);

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=admin&password=secret%2Bword'
  });
  assert.equal(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';', 1)[0];
  const request = (endpoint, body = {}) => fetch(`${base}/api/${endpoint}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  const infoResponse = await request('app/getInfo');
  assert.equal(infoResponse.status, 200);
  const info = await infoResponse.json();
  assert.equal(path.resolve(info.dataRoot), path.resolve(dataRoot));
  assert.equal(info.platform, process.platform);
  assert.equal(info.mode, 'server');

  const templates = await (await request('workspace/templates')).json();
  assert.ok(Array.isArray(templates) && templates.some(template => template.id === 'blank'));
  const security = await (await request('security/status')).json();
  assert.equal(security.mode, 'server');
  const update = await (await request('update/status')).json();
  assert.equal(update.configured, false);
  const tunnelProviders = await (await request('tunnel/providers')).json();
  assert.ok(Array.isArray(tunnelProviders));

  const directories = await (await request('shell/listDirectories', { path: dataRoot })).json();
  assert.equal(directories.success, true);
  assert.ok(directories.entries.some(entry => entry.name === 'www'));

  const invalid = await fetch(`${base}/api/config/get`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{'
  });
  assert.equal(invalid.status, 400);
  const missing = await request('does/not/exist');
  assert.equal(missing.status, 404);

  const preload = await (await fetch(`${base}/web-preload.js`, { headers: { cookie } })).text();
  assert.doesNotThrow(() => new Function(preload));
  assert.match(preload, /onPythonManagerStatus/);
  assert.match(preload, /_selectServerDirectory/);
  assert.match(preload, /input\.type = 'file'/);
  assert.match(preload, /tunnel\/providers/);
  assert.match(preload, /update\/status/);
  assert.match(preload, /support\/generate/);

  const home = await (await fetch(base, { headers: { cookie } })).text();
  assert.match(home, /web-preload\.js/);

  const terminal = await (await request('terminal/create')).json();
  assert.equal(typeof terminal.id, 'number');
  const oversizedInput = await (await request('terminal/write', { id: terminal.id, data: 'x'.repeat(65537) })).json();
  assert.equal(oversizedInput.success, false);

  const logout = await fetch(`${base}/auth/logout`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(logout.status, 302);
  assert.equal((await request('config/get')).status, 401);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill();
  const exit = await exited;
  if (process.platform === 'win32') assert.ok(exit.code === 0 || Boolean(exit.signal));
  else assert.equal(exit.code, 0);
  assert.doesNotMatch(serverStderr, /ERR_INVALID_ARG_TYPE|Uncaught|TypeError/);
});
