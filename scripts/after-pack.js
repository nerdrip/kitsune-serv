'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeUnixTextFile } = require('./package-text-utils');

module.exports = async context => {
  const cliDirectory = path.join(context.appOutDir, 'resources', 'cli');
  if (!fs.existsSync(cliDirectory)) return;
  for (const entry of fs.readdirSync(cliDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.sh')) normalizeUnixTextFile(path.join(cliDirectory, entry.name), true);
  }
};
