'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

if (process.platform !== 'win32') {
  console.log('Packaged Windows smoke test skipped on non-Windows platform.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const executable = path.join(root, 'artifacts', 'windows', 'win-unpacked', 'KitsuneServ.exe');
if (!fs.existsSync(executable)) throw new Error(`Packaged executable not found: ${executable}`);
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-packaged-smoke-'));
const childEnv = { ...process.env, KITSUNE_DATA_DIR: dataRoot, KITSUNE_SMOKE_TEST: '1', KITSUNE_SAFE_MODE: '1' };
// Codex/npm can itself run under Electron's Node compatibility mode. Never leak it into the packaged GUI probe.
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, ['--smoke-test', '--safe-mode'], {
  cwd: path.dirname(executable),
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
const timer = setTimeout(() => {
  try { child.kill(); } catch {}
  console.error('Packaged application smoke test timed out.');
  process.exitCode = 1;
}, 20000);
timer.unref?.();
child.once('error', error => {
  clearTimeout(timer);
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
  throw error;
});
child.once('exit', code => {
  clearTimeout(timer);
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
  if (code !== 0) {
    console.error(`Packaged application smoke test failed with exit code ${code}.${output ? `\n${output.trim()}` : ''}`);
    process.exitCode = 1;
    return;
  }
  console.log('Packaged application smoke test passed.');
});
