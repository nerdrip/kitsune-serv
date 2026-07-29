'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SecretStore = require('../src/secret-store');

test('secret store encrypts values at rest and can remove them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-secrets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SecretStore(root, { externalKey: 'unit-test-master-key' });
  store.set('database:test', 'super-secret-password');
  assert.equal(store.get('database:test'), 'super-secret-password');
  assert.equal(store.has('database:test'), true);
  const contents = fs.readFileSync(path.join(root, 'config', 'secrets.json'), 'utf8');
  assert.doesNotMatch(contents, /super-secret-password/);
  assert.equal(store.remove('database:test').removed, true);
  assert.equal(store.get('database:test'), '');
});

test('secret store supports a platform encryption adapter', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-secrets-platform-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = {
    encrypt: value => Buffer.from(`wrapped:${value}`).toString('base64'),
    decrypt: value => Buffer.from(value, 'base64').toString('utf8').slice('wrapped:'.length)
  };
  const store = new SecretStore(root, adapter);
  store.set('token:one', 'value');
  assert.equal(store.get('token:one'), 'value');
  assert.match(fs.readFileSync(store.storePath, 'utf8'), /platform/);
});
