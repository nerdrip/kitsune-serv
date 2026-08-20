'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
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

function requestWithHost(port, pathname, host) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: pathname, headers: { host } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject); request.end();
  });
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

test('web mode authenticates and exposes a desktop-parity API', { timeout: 30000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-web-'));
  const port = await freePort();
  const upstreamPort = await freePort();
  const apiFlowPort = await freePort();
  const managedConnectorSecret = 'managed-plesk-integration-secret-123456';
  const upstream = http.createServer((req, res) => {
    if (req.url === '/modules/kitsuneserv-bridge/public/auth.php' && req.method === 'POST') {
      const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8'); const body = JSON.parse(raw);
        const signed = `${body.timestamp}\n${body.nonce}\n${crypto.createHash('sha256').update(raw).digest('hex')}`;
        const expected = crypto.createHmac('sha256', managedConnectorSecret).update(signed).digest('base64url');
        if (req.headers['x-kitsune-connector'] !== 'managed-plesk' || req.headers['x-kitsune-signature'] !== expected) {
          res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Authentication failed.' })); return;
        }
        const known = String(body.username || '').toLowerCase() === 'boberski';
        const valid = known && body.password === 'plesk-password-a';
        const result = valid
          ? { valid: true, accountExists: true, subject: 'plesk-client-42', username: 'boberski', displayName: 'Plesk Boberski', email: 'plesk@example.test', role: 'admin' }
          : { valid: false, accountExists: known };
        res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result));
      });
      return;
    }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: req.url, route: req.headers['x-kitsune-route'] || '' }));
  });
  await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const child = spawn(process.execPath, ['src/server.js', '--port', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      KITSUNE_HOST: '127.0.0.1',
      KITSUNE_USER: 'admin',
      KITSUNE_PASS: 'secret+word',
      KITSUNE_DATA_DIR: dataRoot,
      KITSUNE_DISABLE_SYSTEM_INTEGRATION: '1',
      KITSUNE_SAFE_MODE: '1',
      KITSUNE_PANEL_DOMAIN: 'managed.example.test',
      KITSUNE_HUB_AUTH_MODE: 'hybrid',
      KITSUNE_HUB_AUTO_PROVISION: '1',
      KITSUNE_PLESK_URL: `http://127.0.0.1:${upstreamPort}`,
      KITSUNE_PLESK_CONNECTOR_ID: 'managed-plesk',
      KITSUNE_PLESK_CONNECTOR_SECRET: managedConnectorSecret
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
  const loginPage = await (await fetch(base)).text();
  assert.match(loginPage, /Zaloguj przez aktywną sesję Plesk/);
  assert.match(loginPage, /Najpierw sprawdzimy hasło w Plesku/);
  assert.match(loginPage, new RegExp(`http://127\\.0\\.0\\.1:${upstreamPort}/modules/kitsuneserv-bridge/index\\.php/index/sso`));

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
  assert.equal(info.safeMode, true);
  assert.equal(info.migration.to, 2);
  assert.equal(info.capabilities.hostTerminal, true);
  assert.equal(info.capabilities.remoteShell, true);
  assert.equal(info.capabilities.nativeLaunch, false);

  const templates = await (await request('workspace/templates')).json();
  assert.ok(Array.isArray(templates) && templates.some(template => template.id === 'blank'));
  const security = await (await request('security/status')).json();
  assert.equal(security.mode, 'server');
  assert.equal(security.user.username, 'admin');
  const managedHubSettings = await (await request('hub/settings')).json();
  assert.equal(managedHubSettings.enabled, true);
  assert.equal(managedHubSettings.panelDomain, 'managed.example.test');
  assert.equal(managedHubSettings.authMode, 'hybrid');
  assert.equal(managedHubSettings.tlsMode, 'external');
  assert.equal(managedHubSettings.autoProvisionPleskUsers, true);
  const managedConnectors = await (await request('hub/connectors')).json();
  assert.equal(managedConnectors.length, 1);
  assert.equal(managedConnectors[0].id, 'managed-plesk');
  assert.equal(managedConnectors[0].baseUrl, `http://127.0.0.1:${upstreamPort}`);
  assert.equal(managedConnectors[0].configured, true);
  const enrollmentRequest = { connectorId: 'managed-plesk', timestamp: Date.now(), nonce: crypto.randomBytes(16).toString('hex'), device: { name: 'Managed Plesk', platform: 'Linux', version: '3.1.3-r1', capabilities: ['plesk-sso', 'inventory'] } };
  const enrollmentSignature = crypto.createHmac('sha256', managedConnectorSecret).update(stable(enrollmentRequest)).digest('base64url');
  const enrollmentResponse = await fetch(`${base}/auth/plesk/enroll`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kitsune-enrollment-signature': enrollmentSignature }, body: JSON.stringify(enrollmentRequest) });
  assert.equal(enrollmentResponse.status, 200);
  const automaticEnrollment = await enrollmentResponse.json();
  assert.equal(automaticEnrollment.node.connectorId, 'managed-plesk');
  assert.match(automaticEnrollment.token, /^ks_/);
  const matchingLocal = await (await request('identity/createUser', { input: { username: 'boberski', displayName: 'Local Boberski', password: 'hub-password-b', roles: ['operator'] } })).json();
  const localPasswordRejected = await fetch(`${base}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=boberski&password=hub-password-b' });
  assert.equal(localPasswordRejected.status, 200, 'Plesk password has priority for a matching Plesk account');
  const pleskPasswordLogin = await fetch(`${base}/auth/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=boberski&password=plesk-password-a' });
  assert.equal(pleskPasswordLogin.status, 302);
  const pleskPasswordCookie = pleskPasswordLogin.headers.get('set-cookie').split(';', 1)[0];
  const pleskPasswordStatus = await fetch(`${base}/api/security/status`, { method: 'POST', headers: { cookie: pleskPasswordCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await pleskPasswordStatus.json()).user.id, matchingLocal.id);
  const usersAfterMerge = await (await request('identity/users')).json();
  assert.equal(usersAfterMerge.filter(user => user.username.toLowerCase() === 'boberski').length, 1);
  assert.deepEqual(usersAfterMerge.find(user => user.id === matchingLocal.id).roles, ['operator']);
  const hubConfiguration = await (await request('hub/configure', { input: { enabled: true, panelDomain: 'panel.example.test', authMode: 'hybrid' } })).json();
  assert.equal(hubConfiguration.wildcardDomain, '*.panel.example.test');
  const pleskInventory = await fetch(`${base}/api/hub/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${automaticEnrollment.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: automaticEnrollment.node.id, input: { inventory: { apiDomains: ['api.panel.example.test'] } } }) });
  assert.equal(pleskInventory.status, 200);
  const apiFlow = { id: 'flow-publication', name: 'Nowe API', port: apiFlowPort, host: '127.0.0.1', basePath: '/api', cors: true, endpoints: [{ id: 'hello', name: 'Hello', method: 'GET', path: '/hello', enabled: true, nodes: [{ id: 'input', type: 'input', name: 'Input', x: 20, y: 20, next: 'output', config: {} }, { id: 'output', type: 'output', name: 'Output', x: 300, y: 20, config: { status: 200, body: { published: true } } }] }] };
  const savedApiFlow = await (await request('apiFlow/save', { input: apiFlow })).json();
  assert.equal(savedApiFlow.project.id, apiFlow.id);
  const startedApiFlow = await (await request('apiFlow/start', { id: apiFlow.id })).json();
  assert.equal(startedApiFlow.publication.hostname, 'nowe-api.api.panel.example.test');
  const publicApi = await requestWithHost(port, '/api/hello', startedApiFlow.publication.hostname);
  assert.equal(publicApi.status, 200);
  assert.deepEqual(JSON.parse(publicApi.body), { published: true });
  const fallbackApi = await requestWithHost(port, '/nowe-api/api/hello?source=fallback', 'api.panel.example.test');
  assert.equal(fallbackApi.status, 200);
  assert.deepEqual(JSON.parse(fallbackApi.body), { published: true });
  const namespaceWithoutApi = await requestWithHost(port, '/', 'api.panel.example.test');
  assert.equal(namespaceWithoutApi.status, 404);
  assert.match(namespaceWithoutApi.body, /No published API matches this hostname/);
  const publicRoute = await (await request('hub/saveRoute', { input: { name: 'Echo', kind: 'project', target: `http://127.0.0.1:${upstreamPort}`, authPolicy: 'public' } })).json();
  const proxied = await requestWithHost(port, '/gateway-test?q=1', publicRoute.hostname);
  assert.equal(proxied.status, 200);
  assert.deepEqual(JSON.parse(proxied.body), { path: '/gateway-test?q=1', route: publicRoute.id });
  const privateRoute = await (await request('hub/saveRoute', { input: { name: 'Private', kind: 'project', target: `http://127.0.0.1:${upstreamPort}`, authPolicy: 'session' } })).json();
  const privateDenied = await requestWithHost(port, '/private', privateRoute.hostname);
  assert.equal(privateDenied.status, 401);
  const pairing = await (await request('hub/createPairing', { input: { kind: 'agent', name: 'Integration agent' } })).json();
  const pairedResponse = await fetch(`${base}/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code, device: { version: '3.0.0', platform: 'test' } }) });
  assert.equal(pairedResponse.status, 200);
  const paired = await pairedResponse.json();
  assert.match(paired.token, /^ks_/);
  const heartbeat = await fetch(`${base}/api/hub/heartbeat`, { method: 'POST', headers: { authorization: `Bearer ${paired.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: paired.node.id, input: { version: '3.0.1' } }) });
  assert.equal(heartbeat.status, 200);

  const connectorSecret = 'integration-connector-secret';
  const connector = await (await request('hub/saveConnector', { input: { baseUrl: 'https://plesk.example.test', authMode: 'plesk' }, secret: connectorSecret })).json();
  const now = Date.now(); const claims = { connectorId: connector.id, subject: 'plesk-customer-7', username: 'plesk.alice', displayName: 'Plesk Alice', email: 'alice@example.test', role: 'customer', domains: ['shop.example.test'], iat: now, exp: now + 60_000, nonce: crypto.randomBytes(16).toString('hex') };
  const assertion = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', connectorSecret).update(assertion).digest('base64url');
  const pleskLogin = await fetch(`${base}/auth/plesk`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ assertion, signature }) });
  assert.equal(pleskLogin.status, 302);
  const pleskCookie = pleskLogin.headers.get('set-cookie').split(';', 1)[0];
  const pleskStatus = await fetch(`${base}/api/hub/status`, { method: 'POST', headers: { cookie: pleskCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(pleskStatus.status, 200);
  const forbiddenUsers = await fetch(`${base}/api/identity/users`, { method: 'POST', headers: { cookie: pleskCookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(forbiddenUsers.status, 403);
  const update = await (await request('update/status')).json();
  assert.equal(update.configured, false);
  const tunnelProviders = await (await request('tunnel/providers')).json();
  assert.ok(Array.isArray(tunnelProviders));
  const apiFlowCatalog = await (await request('apiFlow/catalog')).json();
  assert.ok(Array.isArray(apiFlowCatalog) && apiFlowCatalog.some(block => block.type === 'database-query'));
  const incidents = await (await request('incident/list')).json();
  assert.ok(Array.isArray(incidents));
  const resilience = await (await request('resilience/capabilities')).json();
  assert.ok(resilience && typeof resilience === 'object');

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
  assert.match(preload, /apiFlow\/catalog/);
  assert.match(preload, /hub\/publishLocal/);
  assert.match(preload, /identity\/users/);
  assert.match(preload, /terminal\/attach/);
  assert.match(preload, /incident\/list/);
  assert.match(preload, /resilience\/capabilities/);

  const home = await (await fetch(base, { headers: { cookie } })).text();
  assert.match(home, /web-preload\.js/);
  assert.match(home, /Server Workspace/);
  const xtermScript = await fetch(`${base}/node_modules/@xterm/xterm/lib/xterm.js`, { headers: { cookie } });
  assert.equal(xtermScript.status, 200);
  assert.match(xtermScript.headers.get('content-type'), /javascript/);
  assert.match(await xtermScript.text(), /Terminal/);

  const terminal = await (await request('terminal/create')).json();
  assert.equal(typeof terminal.id, 'number');
  await new Promise(resolve => setTimeout(resolve, 150));
  const attachment = await (await request('terminal/attach', { id: terminal.id })).json();
  assert.equal(attachment.success, true);
  if (terminal.pty) assert.ok(typeof attachment.data === 'string' && attachment.data.length > 0, 'PTY startup output must be retained until the web terminal attaches');
  const oversizedInput = await (await request('terminal/write', { id: terminal.id, data: 'x'.repeat(65537) })).json();
  assert.equal(oversizedInput.success, false);
  assert.equal((await (await request('terminal/kill', { id: terminal.id })).json()).success, true);

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
