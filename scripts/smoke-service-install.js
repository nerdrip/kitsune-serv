'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const DownloadManager = require('../src/download-manager');

async function main() {
  if (process.platform !== 'win32') {
    console.log('Service download smoke test is Windows-only.');
    return;
  }

  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsuneserv-service-smoke-'));
  try {
    const manager = new DownloadManager({ appRoot, catalogRoot: path.resolve(__dirname, '..') });
    await manager._refreshPythonCatalog();
    const service = manager.getCatalog().find(item => item.id === 'python');
    const selected = service.versions.find(item => item.recommended);
    assert.ok(selected, 'Python catalog has no recommended release');

    const result = await manager.download('python', selected.version, progress => {
      if (progress.stage === 'done') console.log(`Downloaded Python ${selected.version}.`);
    });
    assert.equal(result.success, true, result.error);

    const executable = path.join(result.path, 'python.exe');
    assert.ok(fs.existsSync(executable), 'Downloaded Python executable is missing');
    const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 30000 }).trim();
    assert.match(output, new RegExp(selected.version.replace(/\./g, '\\.')));
    console.log(`Service smoke test passed: ${output}.`);

  } finally {
    // The target is a unique directory created above inside the operating-system temp root.
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
