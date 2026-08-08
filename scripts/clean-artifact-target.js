'use strict';

const fs = require('fs');
const path = require('path');

const allowed = new Set(['windows', 'linux', 'server', 'plesk']);
const targetName = process.argv[2];
if (!allowed.has(targetName)) {
  console.error('Usage: node scripts/clean-artifact-target.js <windows|linux|server|plesk>');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const artifactsRoot = path.join(root, 'artifacts');
const target = path.join(artifactsRoot, targetName);
if (path.dirname(target) !== artifactsRoot) throw new Error(`Unsafe artifact target: ${target}`);

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
console.log(`Prepared artifacts/${targetName}`);
