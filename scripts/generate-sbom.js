'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const packageInfo = require(path.join(root, 'package.json'));
const lock = require(path.join(root, 'package-lock.json'));
const packages = lock.packages || {};

function purl(name, version) {
  return `pkg:npm/${encodeURIComponent(name).replace('%40', '@')}@${encodeURIComponent(version)}`;
}

const components = Object.entries(packages)
  .filter(([location, item]) => location && location.startsWith('node_modules/') && item?.version)
  .map(([location, item]) => {
    const name = item.name || location.replace(/^node_modules\//, '');
    return { type: 'library', 'bom-ref': purl(name, item.version), name, version: item.version, purl: purl(name, item.version), scope: item.dev ? 'optional' : 'required' };
  })
  .filter((item, index, all) => all.findIndex(other => other['bom-ref'] === item['bom-ref']) === index)
  .sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref']));

const direct = { ...(packageInfo.dependencies || {}), ...(packageInfo.devDependencies || {}) };
const dependencies = [{
  ref: purl(packageInfo.name, packageInfo.version),
  dependsOn: Object.keys(direct).map(name => components.find(item => item.name === name)?.['bom-ref']).filter(Boolean).sort()
}];

const bom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${crypto.randomUUID()}`, version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'KitsuneServ SBOM generator', version: '1' }] },
    component: { type: 'application', 'bom-ref': purl(packageInfo.name, packageInfo.version), name: packageInfo.name, version: packageInfo.version, purl: purl(packageInfo.name, packageInfo.version) }
  },
  components,
  dependencies
};

const output = path.join(root, 'artifacts', 'SBOM.cdx.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
console.log(`Wrote CycloneDX SBOM with ${components.length} components to ${path.relative(root, output)}`);
