'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeUnixTextFile } = require('./package-text-utils');

const root = path.resolve(__dirname, '..');
const packageInfo = require(path.join(root, 'package.json'));
const outputRoot = path.join(root, 'artifacts', 'server');
const packageName = `KitsuneServ-server-${packageInfo.version}`;
const stage = path.join(outputRoot, packageName);

function assertOutputPath(target) {
  const relative = path.relative(outputRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean an unsafe package path: ${target}`);
  }
}

function copy(relative, destination = relative) {
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) return;
  fs.cpSync(source, path.join(stage, destination), { recursive: true });
}

fs.mkdirSync(outputRoot, { recursive: true });
assertOutputPath(stage);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

for (const relative of [
  'src', 'assets', 'config/downloads.json', 'config/instances.json',
  'www/index.html', 'utils/adminer', 'package.json', 'package-lock.json',
  'README.md', 'SERVICES.md', 'AUDIT.md', 'LICENSE'
]) copy(relative);

copy('tools/server', 'bin');
copy('deploy/docker', 'deploy/docker');
copy('.dockerignore');
for (const name of ['install-server.sh', 'start-server.sh', 'kitsune.sh']) normalizeUnixTextFile(path.join(stage, 'bin', name), true);

const archiveBase = path.join(outputRoot, packageName);
const archives = [
  { file: `${archiveBase}.zip`, args: ['-a', '-cf', `${archiveBase}.zip`, '-C', outputRoot, packageName] },
  { file: `${archiveBase}.tar.gz`, args: ['-czf', `${archiveBase}.tar.gz`, '-C', outputRoot, packageName] }
];

for (const archive of archives) {
  if (fs.existsSync(archive.file)) fs.rmSync(archive.file, { force: true });
  const result = spawnSync('tar', archive.args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Could not create ${path.basename(archive.file)}. Ensure tar is available.`);
}

console.log(`Server packages created in ${outputRoot}`);
