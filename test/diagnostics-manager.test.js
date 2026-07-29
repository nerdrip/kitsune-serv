'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DiagnosticsManager = require('../src/diagnostics-manager');

test('diagnostics reports missing versions, directories and duplicate ports', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingRoot = path.join(root, 'missing-www');
  const config = {
    general: { globalDocumentRoot: missingRoot },
    apache: { activeProfileId: 'a', profiles: [{ id: 'a', version: '2.4', port: 8080, documentRoot: missingRoot, modProxyFcgi: true }] },
    node: { activeProfileId: 'n', profiles: [{ id: 'n', version: '24', port: 8080 }] }
  };
  const configManager = {
    getConfig: () => config,
    getActiveProfile: (cfg, service) => cfg[service]?.profiles?.[0] || null
  };
  const diagnostics = new DiagnosticsManager(
    root,
    configManager,
    { isInstalled: () => false },
    { getServiceStatus: () => ({ running: false }) },
    { getStatus: () => ({ selected: [], services: [] }) }
  );
  const report = await diagnostics.doctor();
  assert.equal(report.healthy, false);
  assert.ok(report.issues.some(issue => issue.code === 'duplicate-port'));
  assert.ok(report.issues.some(issue => issue.code === 'missing-version'));
  const missing = report.issues.find(issue => issue.code === 'missing-directory');
  assert.equal(diagnostics.repair(missing).success, true);
  assert.equal(fs.existsSync(missingRoot), true);
});

test('free port finder returns an available local port', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-ports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configManager = { getConfig: () => ({}), getActiveProfile: () => null };
  const diagnostics = new DiagnosticsManager(root, configManager, { isInstalled: () => true }, { getServiceStatus: () => ({ running: false }) }, null);
  const result = await diagnostics.findFreePort(49152, 50152);
  assert.equal(result.success, true);
  assert.ok(result.port >= 49152);
});
