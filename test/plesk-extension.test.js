'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeUnixTextFile } = require('../scripts/package-text-utils');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'plesk-extension', 'kitsuneserv-bridge');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

test('Plesk extension has an installable SDK structure and release metadata', () => {
  const required = [
    'meta.xml', 'DESCRIPTION.md', 'CHANGES.md', 'htdocs/index.php', 'htdocs/public/auth.php', 'htdocs/css/kitsuneserv.css', 'htdocs/js/kitsuneserv.js',
    'plib/controllers/IndexController.php', 'plib/library/Config.php', 'plib/library/HubClient.php', 'plib/library/Task/Operate.php',
    'plib/views/scripts/index/index.phtml', 'plib/views/scripts/index/sso.phtml', 'plib/hooks/CustomButtons.php', 'plib/hooks/Permissions.php',
    'plib/hooks/LongTasks.php', 'plib/scripts/post-install.php', 'plib/scripts/pre-uninstall.php', 'sbin/kitsuneserv-bridge'
  ];
  for (const relative of required) assert.equal(fs.existsSync(path.join(extension, relative)), true, `missing ${relative}`);
  const meta = fs.readFileSync(path.join(extension, 'meta.xml'), 'utf8');
  assert.match(meta, /<id>kitsuneserv-bridge<\/id>/);
  assert.match(meta, new RegExp(`<version>${require('../package.json').version.replaceAll('.', '\\.')}<\\/version>`));
  assert.match(meta, /<release>5<\/release>/);
  assert.match(meta, /<plesk_min_version>18\.0\.41<\/plesk_min_version>/);
  assert.match(meta, /<os>unix<\/os>/);
  const entrypoint = fs.readFileSync(path.join(extension, 'htdocs/index.php'), 'utf8');
  assert.doesNotMatch(entrypoint, /pm\/bootstrap\.php/);
  assert.match(entrypoint, /pm_Context::init\('kitsuneserv-bridge'\)/);
  const buttons = fs.readFileSync(path.join(extension, 'plib/hooks/CustomButtons.php'), 'utf8');
  for (const placement of ['PLACE_ADMIN_NAVIGATION', 'PLACE_RESELLER_NAVIGATION', 'PLACE_HOSTING_PANEL_NAVIGATION', 'PLACE_ADMIN_TOOLS_AND_SETTINGS', 'PLACE_RESELLER_TOOLS_AND_SETTINGS']) {
    assert.match(buttons, new RegExp(`self::${placement}`), `missing ${placement}`);
  }
});

test('Plesk bridge uses encrypted settings, signed SSO and strict TLS verification', () => {
  const php = walk(extension).filter(file => file.endsWith('.php')).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const config = fs.readFileSync(path.join(extension, 'plib/library/Config.php'), 'utf8');
  for (const secret of ['git_token', 'git_ssh_private_key', 'bootstrap_password', 'secret_key', 'api_token', 'shared_secret', 'device_token']) assert.match(config, new RegExp(`'${secret}'`));
  assert.match(config, /pm_Settings::setEncrypted\(\$setting/);
  assert.match(php, /hash_hmac\('sha256'/);
  assert.match(php, /pm_Auth::isValidCredentials/);
  assert.match(php, /pm_Client::getByLogin/);
  assert.match(php, /password-auth-nonces\.json/);
  assert.match(config, /ensureSsoConfiguration/);
  assert.match(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*true/);
  assert.match(php, /pm_Hook_Permissions/);
  assert.doesNotMatch(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*false/);
});

test('Plesk bridge exposes domain-driven automatic/manual deployment configuration', () => {
  const controller = fs.readFileSync(path.join(extension, 'plib/controllers/IndexController.php'), 'utf8');
  const view = fs.readFileSync(path.join(extension, 'plib/views/scripts/index/index.phtml'), 'utf8');
  const config = fs.readFileSync(path.join(extension, 'plib/library/Config.php'), 'utf8');
  assert.match(controller, /pm_Domain::getAllDomains\(\)/);
  for (const guard of ['hasHosting()', 'isActive()', 'isSuspended()', 'isDisabled()']) assert.ok(controller.includes(guard));
  for (const mode of ['deployment_mode', 'url_mode', 'proxy_mode', 'managed', 'external', 'automatic', 'manual']) assert.ok(config.includes(`'${mode}'`) || controller.includes(`'${mode}'`));
  for (const field of ['repository_url', 'repository_branch', 'repository_path', 'deploy_path', 'data_path', 'git_ssh_known_hosts', 'node_binary', 'npm_binary', 'hub_port', 'update_manifest_url', 'update_public_key']) assert.ok(view.includes(`name="${field}"`), `missing field ${field}`);
  for (const tab of ['overview', 'deployment', 'configuration', 'access', 'manual', 'logs']) assert.ok(view.includes(`data-ks-panel="${tab}"`), `missing panel ${tab}`);
  assert.match(controller, /pm_LongTask_Manager/);
  assert.match(view, /Domena panelu z Pleska/);
});

test('managed deployment protects credentials, data paths, service and Plesk proxy changes', () => {
  const manager = fs.readFileSync(path.join(extension, 'sbin/kitsuneserv-bridge'), 'utf8');
  for (const marker of ['GIT_ASKPASS', 'GIT_TERMINAL_PROMPT', 'StrictHostKeyChecking=yes', 'operation.lock', 'kitsuneserv-hub.service', 'KITSUNE_PANEL_DOMAIN', 'KITSUNE_HUB_AUTH_MODE', 'refreshAuthenticationEnvironment', '# BEGIN KITSUNESERV BRIDGE MANAGED', '--reconfigure-domain', 'Deployment rolled back', 'assertNoSymlinkComponents']) assert.ok(manager.includes(marker), `missing ${marker}`);
  assert.match(manager, /chmod\(\$knownPath, 0600\)/);
  assert.match(manager, /writeAtomicFile\('\/etc\/kitsuneserv-hub\.env'.*0600\)/s);
  assert.doesNotMatch(manager, /StrictHostKeyChecking=(?:no|accept-new)/);
  assert.doesNotMatch(manager, /git[^\n]*(?:password|token)[^\n]*@/i);
});

test('all extension PHP sources pass a local syntax check when PHP is available', { skip: spawnSync('php', ['-v'], { stdio: 'ignore' }).status !== 0 }, () => {
  const phpSources = walk(extension).filter(item => item.endsWith('.php') || item.endsWith('.phtml'));
  phpSources.push(path.join(extension, 'sbin/kitsuneserv-bridge'));
  for (const file of phpSources) {
    const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test('Plesk packaging normalizes the executable entry point to Unix LF', t => {
  const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kitsune-plesk-lf-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'kitsuneserv-bridge');
  fs.writeFileSync(executable, '#!/usr/bin/env php\r\n<?php\r\necho "ok";\r\n', 'utf8');
  normalizeUnixTextFile(executable, true);
  const bytes = fs.readFileSync(executable);
  assert.equal(bytes.includes(Buffer.from('\r')), false);
  assert.equal(bytes.subarray(0, 19).toString('utf8'), '#!/usr/bin/env php\n');
});
