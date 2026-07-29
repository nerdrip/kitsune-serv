'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

for (const filePath of walk(path.join(root, 'src')).filter(file => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf-8' });
  if (result.status !== 0) failures.push(result.stderr || `${filePath}: syntax check failed`);
}

const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf-8');
const appJs = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf-8');
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = [...new Set(htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index))];
if (duplicateIds.length) failures.push(`Duplicate HTML IDs: ${duplicateIds.join(', ')}`);

const idSet = new Set(htmlIds);
const staticIdReferences = [...new Set([...appJs.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]))];
const missingIds = staticIdReferences.filter(id => !idSet.has(id));
if (missingIds.length) failures.push(`Renderer references missing HTML IDs: ${missingIds.join(', ')}`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Project checks passed (${staticIdReferences.length} DOM references, ${htmlIds.length} unique IDs).`);
