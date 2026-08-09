'use strict';

const fs = require('fs');

function normalizeUnixTextFile(file, executable = false) {
  if (!fs.existsSync(file)) return false;
  const source = fs.readFileSync(file, 'utf8');
  const normalized = source.replace(/\r\n?/g, '\n');
  fs.writeFileSync(file, normalized, { encoding: 'utf8', mode: executable ? 0o755 : 0o644 });
  if (executable && process.platform !== 'win32') fs.chmodSync(file, 0o755);
  return source !== normalized;
}

module.exports = { normalizeUnixTextFile };
