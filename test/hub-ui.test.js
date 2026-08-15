'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

test('Hub UI separates this server configuration from outgoing Hub connections', () => {
  const connectionsView = html.indexOf('data-hub-view="connections"');
  const settingsView = html.indexOf('data-hub-view="settings"');
  const remoteForm = html.indexOf('id="hub-remote-form"');
  const localDomain = html.indexOf('id="hub-panel-domain"');

  assert.ok(connectionsView > 0 && settingsView > connectionsView);
  assert.ok(remoteForm > connectionsView && remoteForm < settingsView, 'remote form must live only in Connections');
  assert.ok(localDomain > settingsView, 'local domain must live only in this Hub settings');
  for (const text of ['Połączenia Hub', 'Ustawienia tego Huba', 'TA INSTALACJA JAKO KLIENT', 'TEN KOMPUTER JAKO SERWER', 'Nie służy do logowania się do innego Huba']) assert.ok(html.includes(text), `missing explanation: ${text}`);
  assert.equal((html.match(/id="hub-remote-form"/g) || []).length, 1);
  assert.equal((html.match(/id="hub-panel-domain"/g) || []).length, 1);
});

test('Hub UI renders independent local and remote status and responsive guidance', () => {
  for (const marker of ['hub-local-config-status', 'hub-remote-summary', "selectHubTab('connections')", 'Ustawienia tego Huba zapisane']) assert.ok(app.includes(marker), `missing UI state: ${marker}`);
  for (const marker of ['.hub-context-banner', '.hub-connection-flow', '.hub-settings-next', '.hub-remote-form']) assert.ok(styles.includes(marker), `missing Hub UI style: ${marker}`);
});
