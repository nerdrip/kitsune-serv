'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonicalManifest } = require('../src/update-manager');
const { classifyReleaseArtifact } = require('./release-artifact-metadata');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts');
const packageInfo = require(path.join(root, 'package.json'));
const baseUrl = String(process.env.KITSUNE_RELEASE_BASE_URL || '').replace(/\/$/, '');
const keyValue = process.env.KITSUNE_UPDATE_PRIVATE_KEY || '';
let privateKey = null;
if (keyValue) {
  const pem = keyValue.includes('BEGIN ') ? keyValue.replace(/\\n/g, '\n') : fs.readFileSync(path.resolve(keyValue), 'utf8');
  privateKey = crypto.createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('KITSUNE_UPDATE_PRIVATE_KEY must be an Ed25519 private key');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name.endsWith('-unpacked') || /^KitsuneServ-server-/.test(entry.name) ? [] : walk(full);
    return /\.(exe|AppImage|deb|rpm|zip)$|\.tar\.gz$/.test(entry.name) ? [full] : [];
  });
}

function belongsToCurrentRelease(file) {
  const name = path.basename(file);
  return name.includes(`-${packageInfo.version}-`) || name.includes(`-${packageInfo.version}.`);
}

const packages = walk(artifacts).filter(belongsToCurrentRelease).sort().map(file => {
  const relative = path.relative(artifacts, file).replace(/\\/g, '/');
  const { platform, arch } = classifyReleaseArtifact(relative);
  const manifest = {
    version: packageInfo.version,
    url: baseUrl ? `${baseUrl}/${relative.split('/').map(encodeURIComponent).join('/')}` : relative,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    platform, arch
  };
  if (privateKey && baseUrl) manifest.signature = crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString('base64');
  return { ...manifest, file: relative, size: fs.statSync(file).size };
});

const result = { schemaVersion: 1, application: 'KitsuneServ', version: packageInfo.version, generatedAt: new Date().toISOString(), signed: Boolean(privateKey && baseUrl), packages };
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(path.join(artifacts, 'release-manifest.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`Wrote release manifest for ${packages.length} package(s)${result.signed ? ' with Ed25519 signatures' : ''}`);
