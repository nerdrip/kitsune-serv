'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const packageInfo = require(path.join(root, 'package.json'));
const extensions = new Set(['.exe', '.zip', '.gz', '.AppImage', '.deb', '.rpm']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith('-unpacked') || entry.name.startsWith('KitsuneServ-server-')) return [];
      return walk(full);
    }
    return [full];
  });
}

const files = walk(artifacts)
  .filter(file => extensions.has(path.extname(file)) || file.endsWith('.tar.gz') || ['SBOM.cdx.json', 'release-manifest.json'].includes(path.basename(file)))
  .filter(file => ['SBOM.cdx.json', 'release-manifest.json'].includes(path.basename(file)) || path.basename(file).includes(`-${packageInfo.version}-`) || path.basename(file).includes(`-${packageInfo.version}.`))
  .sort((a, b) => a.localeCompare(b));
const lines = files.map(file => {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${hash}  ${path.relative(artifacts, file).replace(/\\/g, '/')}`;
});
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} checksums to artifacts/SHA256SUMS.txt`);
