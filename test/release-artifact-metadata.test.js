'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyReleaseArtifact } = require('../scripts/release-artifact-metadata');

test('release metadata keeps desktop, server and Plesk packages in separate channels', () => {
  assert.deepEqual(classifyReleaseArtifact('windows/KitsuneServ-3.0.0-x64-setup.exe'), { platform: 'win32', arch: 'x64' });
  assert.deepEqual(classifyReleaseArtifact('linux/KitsuneServ-3.0.0-x86_64.AppImage'), { platform: 'linux', arch: 'x64' });
  assert.deepEqual(classifyReleaseArtifact('linux/KitsuneServ-3.0.0-amd64.deb'), { platform: 'linux', arch: 'x64' });
  assert.deepEqual(classifyReleaseArtifact('server/KitsuneServ-server-3.0.0.tar.gz'), { platform: 'server', arch: '' });
  assert.deepEqual(classifyReleaseArtifact('plesk/kitsuneserv-bridge-3.0.0.zip'), { platform: 'plesk', arch: '' });
});
