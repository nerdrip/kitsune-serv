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
    'meta.xml', 'DESCRIPTION.md', 'CHANGES.md', 'htdocs/index.php', 'htdocs/public/auth.php', 'htdocs/css/kitsuneserv.css', 'htdocs/css/kitsune-platform.css', 'htdocs/js/kitsuneserv.js', 'htdocs/js/kitsune-platform.js',
    'plib/controllers/IndexController.php', 'plib/library/Config.php', 'plib/library/HubClient.php', 'plib/library/Suite.php', 'plib/library/Task/Operate.php',
    'plib/views/scripts/index/index.phtml', 'plib/views/scripts/index/sso.phtml', 'plib/hooks/CustomButtons.php', 'plib/hooks/Permissions.php',
    'plib/hooks/LongTasks.php', 'plib/hooks/WebServer.php', 'plib/scripts/post-install.php', 'plib/scripts/pre-uninstall.php', 'sbin/kitsuneserv-bridge-r20'
  ];
  for (const relative of required) assert.equal(fs.existsSync(path.join(extension, relative)), true, `missing ${relative}`);
  const meta = fs.readFileSync(path.join(extension, 'meta.xml'), 'utf8');
  assert.match(meta, /<id>kitsuneserv-bridge<\/id>/);
  assert.match(meta, new RegExp(`<version>${require('../package.json').version.replaceAll('.', '\\.')}<\\/version>`));
  assert.match(meta, /<release>20<\/release>/);
  assert.match(meta, /<plesk_min_version>18\.0\.41<\/plesk_min_version>/);
  assert.match(meta, /<os>unix<\/os>/);
  const entrypoint = fs.readFileSync(path.join(extension, 'htdocs/index.php'), 'utf8');
  assert.doesNotMatch(entrypoint, /pm\/bootstrap\.php/);
  assert.match(entrypoint, /pm_Context::init\('kitsuneserv-bridge'\)/);
  const buttons = fs.readFileSync(path.join(extension, 'plib/hooks/CustomButtons.php'), 'utf8');
  for (const placement of ['PLACE_ADMIN_NAVIGATION', 'PLACE_RESELLER_NAVIGATION', 'PLACE_HOSTING_PANEL_NAVIGATION', 'PLACE_ADMIN_TOOLS_AND_SETTINGS', 'PLACE_RESELLER_TOOLS_AND_SETTINGS']) {
    assert.match(buttons, new RegExp(`self::${placement}`), `missing ${placement}`);
  }
  assert.equal((buttons.match(/PLACE_HOSTING_PANEL_NAVIGATION/g) || []).length, 1);
  assert.match(buttons, /PLACE_HOSTING_PANEL_NAVIGATION\][\s\S]*?'section'\s*=>\s*self::SECTION_NAV_SERVER_MANAGEMENT[\s\S]*?'order'\s*=>\s*58/);
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
  assert.match(php, /autoEnroll/);
  assert.match(php, /X-Kitsune-Enrollment-Signature/);
  assert.match(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*true/);
  assert.match(php, /pm_Hook_Permissions/);
  assert.doesNotMatch(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*false/);
});

test('Plesk bridge exposes domain-driven automatic/manual deployment configuration', () => {
  const controller = fs.readFileSync(path.join(extension, 'plib/controllers/IndexController.php'), 'utf8');
  const view = fs.readFileSync(path.join(extension, 'plib/views/scripts/index/index.phtml'), 'utf8');
  const config = fs.readFileSync(path.join(extension, 'plib/library/Config.php'), 'utf8');
  const webServer = fs.readFileSync(path.join(extension, 'plib/hooks/WebServer.php'), 'utf8');
  assert.match(controller, /pm_Domain::getAllDomains\(\)/);
  for (const guard of ['hasHosting()', 'isActive()', 'isSuspended()', 'isDisabled()']) assert.ok(controller.includes(guard));
  for (const mode of ['deployment_mode', 'url_mode', 'proxy_mode', 'managed', 'external', 'automatic', 'manual']) assert.ok(config.includes(`'${mode}'`) || controller.includes(`'${mode}'`));
  for (const field of ['repository_url', 'repository_branch', 'repository_path', 'deploy_path', 'data_path', 'git_ssh_known_hosts', 'node_binary', 'npm_binary', 'hub_port', 'api_domains[]', 'update_manifest_url', 'update_public_key']) assert.ok(view.includes(`name="${field}"`), `missing field ${field}`);
  for (const tab of ['overview', 'deployment', 'plesk', 'configuration', 'access', 'manual', 'logs']) assert.ok(view.includes(`data-ks-panel="${tab}"`), `missing panel ${tab}`);
  assert.match(controller, /pm_LongTask_Manager/);
  assert.match(webServer, /extends pm_Hook_WebServer/);
  assert.match(webServer, /getDomainNginxProxyConfig/);
  assert.match(webServer, /rewrite \^\/\(\?!\\\\\.well-known/);
  assert.match(webServer, /location = \/__kitsuneserv_bridge_internal__/);
  assert.match(webServer, /server_name \*\./);
  assert.match(view, /Bazowe domeny automatycznej publikacji API/);
  assert.match(view, /orders\.api\./);
  assert.match(controller, /updateDomainConfiguration/);
  assert.match(controller, /pm_ApiCli::call\('dns'/);
  assert.match(controller, /'-cname', '\*\.' \./);
  assert.match(view, /Domena panelu z Pleska/);
  assert.match(view, /standardowy hook serwera WWW Pleska/);
  assert.match(view, /class="ks-domain-check"/);
  assert.match(view, /class="ks-hero-link"[\s\S]*?target="_blank"/);
  assert.match(view, /Brak źródła aktualizacji/);
  assert.match(view, /Wersja zainstalowana/);
  assert.match(view, /Wersja w repozytorium/);
  assert.match(view, /Pobierz repozytorium i sprawdź/);
  assert.match(view, /\$extensionCanUpdate[^\n]*disabled/);
  assert.match(config, /getVhostSystemPath\(\)/);
  assert.match(config, /proxy_vhost_paths/);
  assert.match(controller, /in_array\(\$action, \['extension-check', 'extension-update'\]/);
  assert.match(controller, /runImmediateOperation\(\$runtime\)/);
});

test('Kitsune Hub centralizes suite navigation and validates uploaded extension packages', () => {
  const controller = fs.readFileSync(path.join(extension, 'plib/controllers/IndexController.php'), 'utf8');
  const view = fs.readFileSync(path.join(extension, 'plib/views/scripts/index/index.phtml'), 'utf8');
  const suite = fs.readFileSync(path.join(extension, 'plib/library/Suite.php'), 'utf8');
  const script = fs.readFileSync(path.join(extension, 'htdocs/js/kitsuneserv.js'), 'utf8');
  for (const marker of ['pm_Extension::getExtensions()', 'getVersion()', 'getRelease()', 'isActive()', 'kitsunecolab-manager', 'wpkit']) assert.ok(suite.includes(marker), `missing suite marker ${marker}`);
  for (const marker of ['ZipArchive', "getFromName('meta.xml')", 'LIBXML_NONET', 'isSuiteExtension']) assert.ok(suite.includes(marker), `missing package validation marker ${marker}`);
  assert.match(controller, /extensionUploadAction/);
  assert.match(controller, /pm_Extension::installByFile\(\$path\)/);
  assert.match(view, /Kitsune Plesk Management/);
  assert.match(view, /name="extension_package"/);
  assert.match(view, /Otwórz konfigurację/);
  assert.match(script, /URLSearchParams[\s\S]*?requestedTab/);
});

test('suite template and aggregate update builder preserve one navigation contract', () => {
  const template = path.join(root, 'plesk-extension', 'template');
  const hook = fs.readFileSync(path.join(template, 'plib/hooks/CustomButtons.php'), 'utf8');
  const readme = fs.readFileSync(path.join(template, 'README.md'), 'utf8');
  const builder = fs.readFileSync(path.join(root, 'scripts/build-plesk-suite-update.js'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'update/install-all.sh'), 'utf8');
  for (const relative of ['meta.xml', 'htdocs/index.php', 'htdocs/css/kitsune-platform.css', 'htdocs/js/kitsune-platform.js', 'plib/controllers/IndexController.php', 'plib/views/scripts/index/index.phtml']) assert.equal(fs.existsSync(path.join(template, relative)), true, `missing template file ${relative}`);
  assert.match(hook, /pm_Extension::getById\('kitsuneserv-bridge'\)->isActive\(\)/);
  assert.match(readme, /Nie używaj ogólnego identyfikatora/);
  for (const id of ['kitsuneartifactory-manager', 'kitsuneirc-manager', 'kitsunecolab-manager', 'kitsunepaint-manager', 'kitsunepnc-manager', 'kitsunetab-manager', 'kitsunetest-manager', 'nailit-manager', 'kitsune-git', 'wpkit-parse-manager', 'nerd-apps-runtime-manager', 'kitsuneserv-bridge']) assert.ok(builder.includes(`'${id}'`), `missing aggregate package ${id}`);
  assert.match(builder, /checkSuiteContract/);
  assert.match(installer, /sha256sum -c SHA256SUMS/);
  assert.match(installer, /plesk bin extension -g/);
});

test('managed deployment protects credentials, data paths, service and Plesk-compatible proxy changes', () => {
  const manager = fs.readFileSync(path.join(extension, 'sbin/kitsuneserv-bridge-r20'), 'utf8');
  const webServer = fs.readFileSync(path.join(extension, 'plib/hooks/WebServer.php'), 'utf8');
  for (const marker of ['GIT_ASKPASS', 'GIT_TERMINAL_PROMPT', 'StrictHostKeyChecking=yes', 'operation.lock', 'kitsuneserv-hub.service', 'KITSUNE_PANEL_DOMAIN', 'KITSUNE_HUB_AUTH_MODE', 'refreshAuthenticationEnvironment', '--reconfigure-domain', 'Deployment rolled back', 'assertNoSymlinkComponents', 'plesk-webserver-hook']) assert.ok(manager.includes(marker), `missing ${marker}`);
  assert.match(manager, /chmod\(\$knownPath, 0600\)/);
  assert.match(manager, /writeAtomicFile\('\/etc\/kitsuneserv-hub\.env'.*0600\)/s);
  assert.match(webServer, /proxy_pass http:\/\/127\.0\.0\.1:/);
  assert.match(webServer, /internal;/);
  assert.match(manager, /removeLegacyProxyBlock/);
  assert.match(manager, /# BEGIN KITSUNESERV BRIDGE MANAGED/);
  assert.match(manager, /\.kitsuneserv-legacy-backup/);
  assert.match(manager, /validatedPleskVhostPath/);
  assert.doesNotMatch(manager, /managedProxyContents/);
  assert.doesNotMatch(manager, /status\.lock/);
  assert.ok(manager.indexOf('$this->state = $this->readState();', manager.indexOf('$this->acquireLock(')) > manager.indexOf('$this->acquireLock('), 'state must be reloaded after acquiring the shared lock');
  assert.match(manager, /if \(!\$isStatus\)[\s\S]*?\$this->state\['lastOperation'\] = \$action/);
  assert.match(manager, /normalizeExtensionUpdateState/);
  assert.match(manager, /writeAtomicFile\(\$this->statePath, \$json \. "\\n", 0644\)/);
  assert.doesNotMatch(manager, /nginx-proxy-mode|detectPleskProxyMode|setPleskProxyMode|pleskProxyModeBefore|location \^~ \/ \{/);
  assert.doesNotMatch(manager, /StrictHostKeyChecking=(?:no|accept-new)/);
  assert.doesNotMatch(manager, /git[^\n]*(?:password|token)[^\n]*@/i);
  for (const marker of ['scheduleExtensionUpdate', 'ZipArchive', 'systemd-run', "'--upgrade'", 'extension-check', 'extension-update']) assert.ok(manager.includes(marker), `missing self-update marker ${marker}`);
  assert.match(manager, /candidateRelease > \(int\) \$currentMatch\[2\]/);
  assert.ok(manager.indexOf('$this->synchronizeRepository();', manager.indexOf("case 'extension-check':")) < manager.indexOf('$this->scheduleExtensionUpdate(false);', manager.indexOf("case 'extension-check':")), 'extension check must update the managed checkout before reading meta.xml');
  assert.match(manager, /status' => 'failed'/);
});

test('all extension PHP sources and the privileged post-install self-check pass when PHP is available', { skip: spawnSync('php', ['-v'], { stdio: 'ignore' }).status !== 0 }, t => {
  const phpSources = walk(extension).filter(item => item.endsWith('.php') || item.endsWith('.phtml'));
  phpSources.push(path.join(extension, 'sbin/kitsuneserv-bridge-r20'));
  for (const file of phpSources) {
    const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const runtimeDirectory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kitsune-plesk-install-'));
  t.after(() => fs.rmSync(runtimeDirectory, { recursive: true, force: true }));
  const installer = path.join(extension, 'plib/scripts/post-install.php').replaceAll('\\', '/');
  const runtime = runtimeDirectory.replaceAll('\\', '/');
  const harness = `
class pm_Context { public static function init($id) {} public static function getVarDir() { return ${JSON.stringify(runtime)}; } }
class pm_Settings { private static $values = []; public static function get($key, $default = null) { return array_key_exists($key, self::$values) ? self::$values[$key] : $default; } public static function set($key, $value) { self::$values[$key] = $value; } }
class pm_ApiCli { const RESULT_FULL = 1; public static function callSbin($command, $arguments, $result) { if ($command !== 'kitsuneserv-bridge-r20' || $arguments !== ['--self-check']) throw new RuntimeException('Unexpected privileged call'); return ['code' => 0, 'stdout' => "3.1.2-r20\\n", 'stderr' => '']; } }
require ${JSON.stringify(installer)};
echo "post-install-self-check-ok\\n";
`;
  const installResult = spawnSync('php', ['-r', harness], { encoding: 'utf8' });
  assert.equal(installResult.status, 0, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /post-install-self-check-ok/);

  const canonicalPayload = { connectorId: 'plesk-test', timestamp: 1800000000000, nonce: '0123456789abcdef0123456789abcdef', device: { capabilities: ['inventory', 'plesk-sso'], name: 'Plesk Łódź', platform: 'Linux', version: '3.1.2-r20' } };
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : (value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value));
  const hubClient = path.join(extension, 'plib/library/HubClient.php').replaceAll('\\', '/');
  const canonicalHarness = `class pm_Exception extends Exception {} require ${JSON.stringify(hubClient)}; $client = new Modules_KitsuneservBridge_HubClient('http://127.0.0.1'); $method = (new ReflectionClass($client))->getMethod('stable'); @$method->setAccessible(true); echo $method->invoke($client, json_decode(base64_decode('${Buffer.from(JSON.stringify(canonicalPayload)).toString('base64')}'), true));`;
  const canonicalResult = spawnSync('php', ['-r', canonicalHarness], { encoding: 'utf8' });
  assert.equal(canonicalResult.status, 0, canonicalResult.stderr || canonicalResult.stdout);
  assert.equal(canonicalResult.stdout, stable(canonicalPayload), 'PHP and Node must sign the identical canonical enrollment payload');
});

test('managed deployment discovers and propagates a compatible Plesk Node.js runtime', () => {
  const manager = fs.readFileSync(path.join(extension, 'sbin/kitsuneserv-bridge-r20'), 'utf8');
  const config = fs.readFileSync(path.join(extension, 'plib/library/Config.php'), 'utf8');
  const view = fs.readFileSync(path.join(extension, 'plib/views/scripts/index/index.phtml'), 'utf8');
  const installer = fs.readFileSync(path.join(extension, 'plib/scripts/post-install.php'), 'utf8');
  for (const marker of ['resolveNodeRuntime', '/opt/plesk/node/*/bin/node', "version_compare($version, '22.19.0'", "dirname($node) . ':/usr/local/sbin", "systemctl', 'daemon-reload'"]) {
    assert.ok(manager.includes(marker), `missing ${marker}`);
  }
  assert.match(config, /'node_binary'\s*=>\s*'auto'/);
  assert.match(config, /'npm_binary'\s*=>\s*'auto'/);
  assert.match(view, /Node\.js ≥22\.19/);
  assert.match(view, /Runtime Node\.js/);
  assert.match(installer, /'node_binary'\s*=>\s*'\/usr\/bin\/node'/);
  assert.match(installer, /pm_Settings::set\(\$key, 'auto'\)/);
  assert.match(installer, /callSbin\('kitsuneserv-bridge-r20', \['--self-check'\]/);
  assert.match(installer, /chmod\(\$varDir \. '\/state\.json', 0644\)/);
  assert.match(installer, /createRuntimeConfig\('proxy'\)/);
  assert.doesNotMatch(installer, /file_get_contents\(\$utility\)|is_executable\(\$utility\)/);
  assert.match(manager, /KITSUNESERV_BRIDGE_EXECUTOR_RELEASE = '3\.1\.2-r20'/);
  assert.match(manager, /--self-check/);
  const operations = fs.readFileSync(path.join(extension, 'plib/library/Task/Operate.php'), 'utf8') + fs.readFileSync(path.join(extension, 'plib/controllers/IndexController.php'), 'utf8');
  assert.doesNotMatch(operations, /callSbin\('kitsuneserv-bridge'/);
  assert.match(operations, /callSbin\('kitsuneserv-bridge-r20'/);
  assert.doesNotMatch(operations, /kitsuneserv-bridge-r(?:9|10|11|12|13|14|15|16)/);
  assert.match(manager, /Node\.js support/);
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
