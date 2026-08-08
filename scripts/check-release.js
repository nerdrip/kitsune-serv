'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { throw new Error(`[release-check] ${message}`); };

const packageInfo = readJson('package.json');
const lock = readJson('package-lock.json');
const version = packageInfo.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail(`Invalid package version: ${version}`);
if (lock.version !== version || lock.packages?.['']?.version !== version) fail('package.json and package-lock.json versions differ');

const readme = read('README.md');
const services = read('SERVICES.md');
const expectedInstaller = `KitsuneServ-${version}-x64-setup.exe`;
if (!readme.includes(expectedInstaller)) fail(`README does not reference ${expectedInstaller}`);
if (!services.includes(`KitsuneServ ${version}`)) fail('SERVICES.md does not reference the current version');
if (/run \d+ tests/i.test(readme)) fail('README contains a brittle hard-coded test count');

const preload = read('src/preload.js');
const server = read('src/server.js');
for (const endpoint of ['diagnostics:preflight', 'diagnostics:repairAll']) {
  if (!preload.includes(endpoint)) fail(`Desktop preload is missing ${endpoint}`);
}
for (const endpoint of ['apiFlow:catalog', 'apiFlow:save', 'apiFlow:test', 'apiFlow:request', 'apiFlow:start', 'apiFlow:stop']) {
  if (!preload.includes(endpoint)) fail(`Desktop preload is missing ${endpoint}`);
}
for (const endpoint of ['hub:status', 'hub:publishLocal', 'hub:syncRemote', 'identity:users']) {
  if (!preload.includes(endpoint)) fail(`Desktop preload is missing ${endpoint}`);
}
for (const endpoint of ['diagnostics/preflight', 'diagnostics/repairAll']) {
  if (!server.includes(endpoint)) fail(`Server adapter is missing ${endpoint}`);
}
for (const endpoint of ['apiFlow/catalog', 'apiFlow/save', 'apiFlow/test', 'apiFlow/request', 'apiFlow/start', 'apiFlow/stop']) {
  if (!server.includes(endpoint)) fail(`Server adapter is missing ${endpoint}`);
}
for (const endpoint of ['hub/status', 'hub/publishLocal', 'hub/syncRemote', 'identity/users']) {
  if (!server.includes(endpoint)) fail(`Server adapter is missing ${endpoint}`);
}
const pleskMeta = read('plesk-extension/kitsuneserv-bridge/meta.xml');
if (!pleskMeta.includes(`<version>${version}</version>`)) fail('Plesk extension version differs from the application version');
const pleskRelease = pleskMeta.match(/<release>([^<]+)<\/release>/)?.[1];
if (!pleskRelease) fail('Plesk extension release is missing');
const expectedPleskArchive = `kitsuneserv-bridge-${version}-r${pleskRelease}.zip`;
if (!readme.includes(expectedPleskArchive)) fail(`README does not reference ${expectedPleskArchive}`);

const manifestPath = path.join(root, 'artifacts', 'release-manifest.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const currentPackages = (manifest.packages || []).filter(item => item.version === version);
  for (const item of currentPackages) {
    if (!['win32', 'linux', 'server', 'plesk'].includes(item.platform)) fail(`Unknown release channel for ${item.file}`);
    if (['win32', 'linux'].includes(item.platform) && !['x64', 'arm64'].includes(item.arch)) fail(`Missing desktop architecture for ${item.file}`);
    if (item.platform === 'server' && !String(item.file || '').startsWith('server/')) fail(`Server archive is in a desktop update channel: ${item.file}`);
    if (item.platform === 'plesk' && !String(item.file || '').startsWith('plesk/')) fail(`Plesk archive is in a desktop update channel: ${item.file}`);
    if (item.platform === 'plesk' && path.basename(item.file || '') !== expectedPleskArchive) fail(`Stale Plesk package in release manifest: ${item.file}`);
  }
}

const build = packageInfo.build || {};
if (!build.asar || !build.nsis || build.nsis.deleteAppDataOnUninstall !== false) fail('Windows release safety settings are incomplete');
console.log(`Release checks passed for KitsuneServ ${version}.`);
