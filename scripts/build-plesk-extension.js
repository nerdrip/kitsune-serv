'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'plesk-extension', 'kitsuneserv-bridge');
const stage = path.join(root, 'artifacts', '.plesk-stage');
const output = path.join(root, 'artifacts', 'plesk', `kitsuneserv-bridge-${require('../package.json').version}.zip`);
fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true }); fs.cpSync(source, stage, { recursive: true });
for (const relative of ['htdocs/images/icon.png', '_meta/icons/64x64.png']) { const target = path.join(stage, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, 'assets', 'icon.png'), target); }
fs.mkdirSync(path.dirname(output), { recursive: true }); if (fs.existsSync(output)) fs.unlinkSync(output);
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage.replaceAll("'", "''")}\\*' -DestinationPath '${output.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`], { stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true }); console.log(output);
