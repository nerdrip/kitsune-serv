'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const IncidentManager = require('../src/incident-manager');

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-incident-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); const session = { id: 's1', name: 'Server' }; const remote = { list: () => [session], diagnose: async () => ({ success: true }) }; return new IncidentManager(root, {}, remote, {}, {}, { listRecordings: () => [] }); }

test('incident mode freezes automation state and exports an integrity capsule', async t => {
  const manager = fixture(t); const started = await manager.start({ title: 'Outage', sessionIds: ['s1'] });
  assert.equal(manager.hasActive(), true); assert.equal(started.incident.evidence[0].type, 'diagnostics');
  const capsule = manager.capsule(started.incident.id); assert.match(fs.readFileSync(capsule.file, 'utf8'), new RegExp(capsule.integrity));
  manager.update(started.incident.id, { status: 'resolved' }); assert.equal(manager.hasActive(), false);
});

test('collaborative terminal control and editor locks are enforced', t => {
  const manager = fixture(t); const terminal = manager.collaborationStart({ kind: 'terminal', resourceId: 'term' }).session;
  const guest = manager.collaborationJoin(terminal.id, { name: 'Guest', role: 'editor' }).member;
  assert.throws(() => manager.collaborationEvent(terminal.id, guest.id, { kind: 'terminal-input', data: 'ls' }), /control/i);
  manager.transferControl(terminal.id, guest.id); assert.equal(manager.collaborationEvent(terminal.id, guest.id, { kind: 'terminal-input', data: 'ls' }).revision, 1);
  const editor = manager.collaborationStart({ kind: 'editor', resourceId: '/etc/app' }).session;
  assert.throws(() => manager.collaborationEvent(editor.id, 'owner', { kind: 'editor-change', filePath: '/etc/app', data: 'x' }), /lock/i);
  manager.lockFile(editor.id, '/etc/app', 'owner'); assert.equal(manager.collaborationEvent(editor.id, 'owner', { kind: 'editor-change', filePath: '/etc/app', data: 'x' }).revision, 1);
});
