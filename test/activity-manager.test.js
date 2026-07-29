'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ActivityManager = require('../src/activity-manager');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-activity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('activity manager persists progress and completion history', async t => {
  const root = tempRoot(t);
  const manager = new ActivityManager(root);
  const events = [];
  manager.on('changed', entry => events.push(entry));
  const result = await manager.run('test', 'Test operation', { scope: 'unit' }, async operation => {
    operation.update({ stage: 'halfway', progress: 50 });
    return { success: true };
  });
  assert.equal(result.success, true);
  assert.equal(manager.list()[0].status, 'completed');
  assert.equal(manager.list()[0].progress, 100);
  assert.ok(events.length >= 3);
  assert.equal(new ActivityManager(root).list()[0].status, 'completed');
});

test('activity manager supports cooperative cancellation', async t => {
  const manager = new ActivityManager(tempRoot(t));
  const operation = manager.begin('download', 'Download');
  assert.equal(manager.cancel(operation.id).success, true);
  assert.equal(manager.isCancelled(operation.id), true);
  manager.finish(operation.id, 'cancelled', { error: 'cancelled' });
  assert.equal(manager.list()[0].status, 'cancelled');
});
