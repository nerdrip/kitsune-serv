'use strict';

function classifyReleaseArtifact(relativePath) {
  const relative = String(relativePath || '').replace(/\\/g, '/');
  const platform = relative.startsWith('windows/')
    ? 'win32'
    : relative.startsWith('linux/')
      ? 'linux'
      : relative.startsWith('server/')
        ? 'server'
        : relative.startsWith('plesk/')
          ? 'plesk'
          : 'artifact';
  const arch = /(?:^|[-_.])arm64(?:[-_.]|$)/i.test(relative)
    ? 'arm64'
    : /(?:^|[-_.])(x64|amd64|x86_64|x86-64)(?:[-_.]|$)/i.test(relative)
      ? 'x64'
      : '';
  return { platform, arch };
}

module.exports = { classifyReleaseArtifact };
