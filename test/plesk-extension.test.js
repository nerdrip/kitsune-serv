'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'plesk-extension', 'kitsuneserv-bridge');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}

test('Plesk extension has an installable SDK structure and release metadata', () => {
  const required = ['meta.xml', 'DESCRIPTION.md', 'CHANGES.md', 'htdocs/index.php', 'plib/controllers/IndexController.php', 'plib/library/HubClient.php', 'plib/views/scripts/index/index.phtml', 'plib/views/scripts/index/sso.phtml', 'plib/hooks/CustomButtons.php', 'plib/hooks/Permissions.php', 'plib/scripts/post-install.php'];
  for (const relative of required) assert.equal(fs.existsSync(path.join(extension, relative)), true, `missing ${relative}`);
  const meta = fs.readFileSync(path.join(extension, 'meta.xml'), 'utf8');
  assert.match(meta, /<id>kitsuneserv-bridge<\/id>/);
  assert.match(meta, new RegExp(`<version>${require('../package.json').version.replaceAll('.', '\\.')}<\\/version>`));
  assert.match(meta, /<plesk_min_version>18\.0\.30<\/plesk_min_version>/);
});

test('Plesk bridge uses encrypted settings, signed SSO and strict TLS verification', () => {
  const php = walk(extension).filter(file => file.endsWith('.php')).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.match(php, /pm_Settings::setEncrypted\('shared_secret'/);
  assert.match(php, /pm_Settings::setEncrypted\('device_token'/);
  assert.match(php, /hash_hmac\('sha256'/);
  assert.match(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*true/);
  assert.match(php, /pm_Hook_Permissions/);
  assert.doesNotMatch(php, /CURLOPT_SSL_VERIFYPEER\s*=>\s*false/);
});

test('all extension PHP sources pass a local syntax check when PHP is available', { skip: spawnSync('php', ['-v'], { stdio: 'ignore' }).status !== 0 }, () => {
  for (const file of walk(extension).filter(item => item.endsWith('.php'))) {
    const result = spawnSync('php', ['-l', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
