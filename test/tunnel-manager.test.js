'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const TunnelManager = require('../src/tunnel-manager');

test('tunnel manager rejects unavailable providers without spawning arbitrary tools', () => {
  const manager = new TunnelManager({ get: () => ({ id: 'p', name: 'Project' }), getUrl: () => 'http://project.test' });
  manager.providers = () => [{ id: 'cloudflared', installed: false }];
  const result = manager.start('p', 'cloudflared');
  assert.equal(result.success, false);
  assert.equal(result.needsInstall, true);
});

test('tunnel manager captures a provider public URL', async () => {
  class FakeProcess extends EventEmitter {
    constructor() { super(); this.pid = 123; this.stdout = new EventEmitter(); this.stderr = new EventEmitter(); }
    kill() { this.emit('exit', 0); }
  }
  let processRef;
  const manager = new TunnelManager(
    { get: () => ({ id: 'p', name: 'Project' }), getUrl: () => 'http://project.test' },
    { spawn: () => { processRef = new FakeProcess(); return processRef; } }
  );
  manager.providers = () => [{ id: 'cloudflared', installed: true, executable: 'cloudflared' }];
  const started = manager.start('p', 'cloudflared');
  processRef.stderr.emit('data', 'Your quick Tunnel has been created! https://bright-fox.trycloudflare.com');
  const tunnel = manager.list()[0];
  assert.equal(started.success, true);
  assert.equal(tunnel.status, 'running');
  assert.equal(tunnel.publicUrl, 'https://bright-fox.trycloudflare.com');
  manager.stop(tunnel.id);
});
