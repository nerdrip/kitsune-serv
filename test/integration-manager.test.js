'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SecretStore = require('../src/secret-store');
const IntegrationManager = require('../src/integration-manager');

test('integration manager persists public configuration without leaking secrets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-integrations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const manager = new IntegrationManager(root, new SecretStore(root, { externalKey: 'test-key' }), {
    request: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, body: { id: 1 } }; }
  });
  const saved = manager.save('github', {
    enabled: true, apiBase: 'https://api.github.test/', owner: 'kitsune', repository: 'serv'
  }, { token: 'top-secret-token' });
  assert.equal(saved.success, true);
  assert.equal(saved.integration.configured, true);
  assert.equal(saved.integration.secrets.token, true);
  const raw = fs.readFileSync(manager.configPath, 'utf8');
  assert.doesNotMatch(raw, /top-secret-token/);
  const tested = await manager.test('github');
  assert.equal(tested.success, true);
  assert.equal(requests[0].url, 'https://api.github.test/repos/kitsune/serv');
  assert.equal(requests[0].options.headers.authorization, 'Bearer top-secret-token');
  assert.equal(manager.remove('github').success, true);
  assert.equal(manager.list().find(item => item.id === 'github').secrets.token, false);
});

test('integration manager rejects insecure remote endpoints', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-integrations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manager = new IntegrationManager(root, new SecretStore(root, { externalKey: 'test-key' }));
  const result = manager.save('grafana', { enabled: true, baseUrl: 'http://example.com' });
  assert.equal(result.success, false);
  assert.match(result.error, /HTTPS or loopback HTTP/);
});

test('AI operations assistant is opt-in and redacts diagnostic secrets before sending', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-ai-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let sent = null;
  const manager = new IntegrationManager(root, new SecretStore(root, { externalKey: 'test-key' }), {
    request: async (url, options) => {
      sent = { url, options, body: JSON.parse(options.body) };
      return { ok: true, status: 200, body: { choices: [{ message: { content: 'Check the database health first.' } }] } };
    }
  });
  assert.equal((await manager.assistant('Help', {})).success, false);
  manager.save('ai-openai-compatible', { enabled: true, baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-ops' }, { apiKey: 'assistant-api-key' });
  const result = await manager.assistant('Diagnose this failure', {
    database: { host: 'localhost', password: 'database-secret' },
    log: 'Authorization: Bearer visible-token?token=url-secret'
  });
  assert.equal(result.success, true);
  assert.equal(result.contextRedacted, true);
  assert.equal(sent.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(sent.options.headers.authorization, 'Bearer assistant-api-key');
  const serialized = JSON.stringify(sent.body);
  assert.doesNotMatch(serialized, /database-secret|visible-token|url-secret/);
  assert.match(serialized, /REDACTED/);
  assert.ok(manager.readiness('Publishing').every(item => item.category === 'Publishing'));
});
