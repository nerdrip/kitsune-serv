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

test('Test Lab and API publication use domains synchronized from the Plesk bridge', () => {
  for (const marker of ['chooseHubPublicationDomain', 'inventory?.apiDomains', 'publish-domain-overlay', 'Bazowa domena API z Plesk Bridge', 'Działający adres awaryjny zostanie pokazany']) assert.ok(app.includes(marker), `missing publication flow: ${marker}`);
  for (const marker of ['.publish-domain-overlay', '.publish-domain-dialog', '.publish-domain-warning']) assert.ok(styles.includes(marker), `missing publication style: ${marker}`);
});

test('API Flow hides web ports, exposes readable public actions and exact block result placeholders', () => {
  for (const marker of ['api-flow-settings-dialog', 'W webie warstwa uruchomieniowa jest obsługiwana automatycznie', 'Kopiuj adres', 'Otwórz API', 'apiFlowLaunchUrl', 'route?.subdomainReady', 'autoPort: runtimeMode === \'server\'', 'rememberApiFlowPublication', 'renderApiFlowResultHelp', 'Wynik tego bloku', '{steps.${escapeHtml(node.id)}}']) assert.ok(html.includes(marker) || app.includes(marker), `missing API Flow guidance: ${marker}`);
  for (const marker of ['.api-flow-result-help', '.api-flow-node-result', '.api-flow-dialog-backdrop', '.api-flow-inspector-scrim', '@container']) assert.ok(styles.includes(marker), `missing API Flow result style: ${marker}`);
});
