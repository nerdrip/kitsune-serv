'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }

function rewriteManifest(root) {
  const manifestFile = path.join(root, 'manifest.json'); if (!fs.existsSync(manifestFile)) return { updated: 0 };
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); let updated = 0;
  manifest.tools = manifest.tools.map(tool => {
    const file = path.resolve(root, tool.path); if (!file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) return tool;
    updated++; return { ...tool, upstreamSha256: tool.upstreamSha256 || tool.sha256, sha256: sha256(file), packagedSignatureApplied: true };
  });
  manifest.packagedAt = new Date().toISOString(); fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); return { updated };
}

async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  rewriteManifest(path.join(context.appOutDir, 'resources', 'portable-tools', 'windows'));
}

module.exports = afterSign;
module.exports.rewriteManifest = rewriteManifest;
