'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AuditManager = require('../src/audit-manager');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-audit-'));
}

test('audit log forms a verifiable hash chain and redacts credentials', () => {
  const root = temporaryRoot();
  try {
    const audit = new AuditManager(root);
    audit.record({
      actor: 'admin', source: 'test', action: 'integration.save', target: 'openai-compatible',
      details: { apiKey: 'top-secret', nested: { password: 'hunter2' }, message: 'token=also-secret', changed: 2 }
    });
    audit.record({ actor: 'admin', source: 'test', action: 'lab.start', target: 'wordpress-dev', success: true });

    const verification = audit.verify();
    assert.equal(verification.valid, true);
    assert.equal(verification.entries, 2);
    const entries = audit.list();
    assert.equal(entries[0].previousHash, entries[1].hash);

    const persisted = fs.readFileSync(path.join(root, 'config', 'audit.json'), 'utf8');
    assert.equal(persisted.includes('top-secret'), false);
    assert.equal(persisted.includes('hunter2'), false);
    assert.equal(persisted.includes('also-secret'), false);
    assert.match(persisted, /\[REDACTED\]/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('audit verification detects a modified persisted entry', () => {
  const root = temporaryRoot();
  try {
    const audit = new AuditManager(root);
    audit.record({ action: 'workspace.create', target: 'demo' });
    audit.record({ action: 'workspace.start', target: 'demo' });
    const file = path.join(root, 'config', 'audit.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    value.entries[0].target = 'tampered';
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');

    const reloaded = new AuditManager(root);
    const verification = reloaded.verify();
    assert.equal(verification.valid, false);
    assert.equal(verification.firstInvalidSequence, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
