'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const ApiFlowManager = require('../src/api-flow-manager');
const SecretStore = require('../src/secret-store');
const { ApiFlowExecutor, templateValue, renderDatabaseQuery } = require('../src/api-flow-executor');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-api-flow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
  });
}

function project(port = 9393) {
  return {
    id: 'flow-test', name: 'Test API', port, host: '127.0.0.1', basePath: '/api', cors: true,
    endpoints: [{
      id: 'hello', name: 'Hello', method: 'POST', path: '/hello/:id', enabled: true,
      nodes: [
        { id: 'input', type: 'input', x: 20, y: 30, next: 'validate', config: {} },
        { id: 'validate', type: 'validate', x: 250, y: 30, next: 'transform', nextError: 'bad', config: { value: '{body}', rules: [{ field: 'name', required: true }] } },
        { id: 'transform', type: 'transform', x: 480, y: 30, next: 'condition', config: { template: { greeting: 'Cześć {body.name}', id: '{params.id}', source: '{query.source}' } } },
        { id: 'condition', type: 'condition', x: 710, y: 30, nextTrue: 'ok', nextFalse: 'denied', config: { left: '{query.allow}', operator: 'equals', right: 'yes' } },
        { id: 'ok', type: 'output', x: 940, y: 0, config: { status: 201, body: '{steps.transform}' } },
        { id: 'denied', type: 'output', x: 940, y: 130, config: { status: 403, body: { error: 'denied' } } },
        { id: 'bad', type: 'output', x: 480, y: 180, config: { status: 422, body: { error: '{error.message}' } } }
      ]
    }]
  };
}

test('API Flow catalog exposes executable blocks and nested placeholders preserve types', () => {
  const manager = new ApiFlowManager(process.cwd());
  assert.ok(manager.catalog().length >= 30);
  assert.deepEqual(templateValue({ body: '{body}', id: '{query.id}' }, { body: { ok: true }, query: { id: 7 } }), { body: { ok: true }, id: 7 });
});

test('API Flow validates branches, executes templates and follows error outputs', async t => {
  const root = temporary(t);
  const manager = new ApiFlowManager(root, { secretStore: new SecretStore(root, { externalKey: 'test-key' }) });
  const validation = manager.validate(project());
  assert.equal(validation.valid, true, validation.errors?.join('; '));
  manager.save(project());

  const allowed = await manager.test('flow-test', 'hello', { params: { id: '42' }, query: { allow: 'yes', source: 'unit' }, body: { name: 'Ada' } });
  assert.equal(allowed.success, true);
  assert.equal(allowed.status, 201);
  assert.deepEqual(allowed.body, { greeting: 'Cześć Ada', id: '42', source: 'unit' });
  assert.equal(allowed.trace.at(-1).nodeId, 'ok');

  const rejected = await manager.test('flow-test', 'hello', { params: { id: '42' }, query: { allow: 'yes' }, body: {} });
  assert.equal(rejected.success, true);
  assert.equal(rejected.status, 422);
  assert.match(rejected.body.error, /name is required/);
});

test('API Flow keeps authentication secrets outside the flow document', async t => {
  const root = temporary(t); const secretStore = new SecretStore(root, { externalKey: 'auth-key' });
  const manager = new ApiFlowManager(root, { secretStore });
  const definition = project();
  definition.endpoints[0].nodes = [
    { id: 'input', type: 'input', next: 'auth', config: {} },
    { id: 'auth', type: 'auth', next: 'out', nextError: 'unauthorized', config: { mode: 'bearer', secret: 'top-secret' } },
    { id: 'out', type: 'output', config: { body: { ok: true } } },
    { id: 'unauthorized', type: 'output', config: { status: 401, body: { ok: false } } }
  ];
  manager.save(definition);
  const raw = fs.readFileSync(path.join(root, 'config', 'api-flows.json'), 'utf8');
  assert.doesNotMatch(raw, /top-secret/);
  assert.equal(secretStore.get('api-flow:flow-test:hello:auth:secret'), 'top-secret');
  assert.equal((await manager.test('flow-test', 'hello', { headers: { authorization: 'Bearer top-secret' } })).status, 200);
  assert.equal((await manager.test('flow-test', 'hello', { headers: {} })).status, 401);
});

test('database block uses Database Manager in read-only mode and returns object rows', async () => {
  let call;
  const executor = new ApiFlowExecutor({ dbViewer: { executeWorkbench: async (...args) => { call = args; return { columns: ['id', 'name'], rows: [['7', 'Nori']] }; } } });
  const endpoint = { id: 'db-endpoint', method: 'GET', path: '/users', nodes: [
    { id: 'input', type: 'input', next: 'db', config: {} },
    { id: 'db', type: 'database-query', next: 'out', config: { connectionId: 'db-1', database: 'app', query: 'SELECT * FROM users', readOnly: true } },
    { id: 'out', type: 'output', config: { body: '{steps.db.objects}' } }
  ] };
  const result = await executor.execute({ id: 'flow-db' }, endpoint, {});
  assert.deepEqual(result.body, [{ id: '7', name: 'Nori' }]);
  assert.equal(call[0], 'db-1');
  assert.equal(call[3].readOnly, true);
});

test('database placeholders are rendered as escaped values instead of raw SQL fragments', () => {
  assert.equal(renderDatabaseQuery('SELECT * FROM users WHERE name={query.name}', { query: { name: "Ada' OR 1=1 --" } }), "SELECT * FROM users WHERE name='Ada'' OR 1=1 --'");
  assert.equal(renderDatabaseQuery('{"operation":"find","filter":{"id":"{query.id}"}}', { query: { id: 7 } }), '{"operation":"find","filter":{"id":7}}');
});

test('HTTP, cache and rate-limit blocks execute with bounded runtime state', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ remote: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const executor = new ApiFlowExecutor({ fetchImpl, now: (() => { let value = 1000; return () => value++; })() });
  const endpoint = { id: 'integration', method: 'POST', path: '/integration', nodes: [
    { id: 'input', type: 'input', next: 'limit', config: {} },
    { id: 'limit', type: 'rate-limit', next: 'http', config: { key: '{body.user}', limit: 1, windowMs: 60000 } },
    { id: 'http', type: 'http-request', next: 'cache', config: { method: 'POST', url: 'https://example.test/users/{body.user}', headers: { 'x-source': '{query.source}' }, body: { id: '{body.user}' } } },
    { id: 'cache', type: 'cache', next: 'out', config: { mode: 'set', key: '{body.user}', value: '{steps.http.data}', ttlMs: 5000 } },
    { id: 'out', type: 'output', config: { body: '{last}' } }
  ] };
  const result = await executor.execute({ id: 'flow-integrations' }, endpoint, { body: { user: 7 }, query: { source: 'test' }, ip: '127.0.0.1' });
  assert.deepEqual(result.body, { remote: true });
  assert.equal(captured.url, 'https://example.test/users/7');
  assert.equal(captured.options.headers['x-source'], 'test');
  await assert.rejects(() => executor.execute({ id: 'flow-integrations' }, endpoint, { body: { user: 7 }, query: {}, ip: '127.0.0.1' }), /Rate limit exceeded/);
});

test('started API Flow project serves a real REST endpoint', async t => {
  const root = temporary(t); const port = await freePort();
  const manager = new ApiFlowManager(root, { secretStore: new SecretStore(root, { externalKey: 'server-key' }) });
  const definition = project(port);
  definition.endpoints.push({ id: 'options', name: 'Custom OPTIONS', method: 'OPTIONS', path: '/probe', enabled: true, nodes: [
    { id: 'input', type: 'input', name: 'Input', next: 'output', config: {} },
    { id: 'output', type: 'output', name: 'Output', config: { status: 202, body: { kind: 'custom-options' } } }
  ] });
  manager.save(definition);
  await manager.start('flow-test');
  t.after(() => manager.stopAll());
  const response = await fetch(`http://127.0.0.1:${port}/api/hello/55?allow=yes&source=http`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mika' })
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { greeting: 'Cześć Mika', id: '55', source: 'http' });
  const clientResult = await manager.request('flow-test', 'hello', { params: { id: '77' }, query: { allow: 'yes', source: 'client' }, body: { name: 'Kitsu' } });
  assert.equal(clientResult.live, true);
  assert.equal(clientResult.status, 201);
  assert.deepEqual(clientResult.body, { greeting: 'Cześć Kitsu', id: '77', source: 'client' });
  assert.ok(clientResult.trace.some(step => step.nodeId === 'transform'));
  const customOptions = await fetch(`http://127.0.0.1:${port}/api/probe`, { method: 'OPTIONS' });
  assert.equal(customOptions.status, 202);
  assert.deepEqual(await customOptions.json(), { kind: 'custom-options' });
  const preflight = await fetch(`http://127.0.0.1:${port}/api/hello/55`, { method: 'OPTIONS', headers: { 'access-control-request-method': 'POST' } });
  assert.equal(preflight.status, 204);
  const missing = await fetch(`http://127.0.0.1:${port}/api/missing`);
  assert.equal(missing.status, 404);
  const status = manager.status('flow-test');
  assert.equal(status.running, true);
  assert.equal(status.runtime.requestCount, 4);
  assert.equal(status.runtime.errorCount, 1);
  assert.equal(status.runtime.lastStatus, 404);
  assert.equal(manager.logs('flow-test')[0].source, 'http');
});

test('API Flow validator rejects cycles and duplicate routes', () => {
  const manager = new ApiFlowManager(process.cwd()); const definition = project();
  definition.endpoints[0].nodes[4].next = 'input';
  definition.endpoints.push(structuredClone(definition.endpoints[0]));
  definition.endpoints[1].id = 'duplicate';
  const validation = manager.validate(definition);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /Powielona trasa|cykl/);
});
