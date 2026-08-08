'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DomainManager = require('../src/domain-manager');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-domains-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hostsPath = path.join(root, 'hosts');
  fs.writeFileSync(hostsPath, '127.0.0.1 localhost\n10.0.0.2 custom.internal\n');
  return { root, hostsPath, manager: new DomainManager(root, { hostsPath }) };
}

test('domain synchronization preserves user entries and owns one marked block', t => {
  const { manager, hostsPath } = fixture(t);
  const projects = [{ domain: 'api.test' }, { domain: 'site.test' }];
  assert.equal(manager.status(projects).synchronized, false);
  const result = manager.apply(projects);
  assert.equal(result.success, true);
  const contents = fs.readFileSync(hostsPath, 'utf8');
  assert.match(contents, /10\.0\.0\.2 custom\.internal/);
  assert.match(contents, /127\.0\.0\.1\s+api\.test/);
  assert.equal(manager.status(projects).synchronized, true);
  assert.equal(manager.apply(projects).unchanged, true);
});

test('domain synchronization removes stale managed domains only', t => {
  const { manager, hostsPath } = fixture(t);
  manager.apply([{ domain: 'old.test' }]);
  manager.apply([{ domain: 'new.test' }]);
  const contents = fs.readFileSync(hostsPath, 'utf8');
  assert.doesNotMatch(contents, /old\.test/);
  assert.match(contents, /new\.test/);
  assert.match(contents, /custom\.internal/);
});

test('certificate paths cannot escape the certificate directory', t => {
  const { manager } = fixture(t);
  assert.throws(() => manager.certificatePaths('../escape'), /Invalid local domain/);
  const status = manager.certificateStatus('safe.test');
  assert.equal(status.exists, false);
  assert.ok(status.cert.endsWith(path.join('certificates', 'safe.test.pem')));
});
