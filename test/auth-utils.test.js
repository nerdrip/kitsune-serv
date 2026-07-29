'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { totp, verifyTotp, normalizeIp, isIpAllowed } = require('../src/auth-utils');

test('TOTP follows the RFC 6238 SHA-1 test vector', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, 59_000, 30, 8), '94287082');
  const code = totp(secret, 1_700_000_000_000);
  assert.equal(verifyTotp(secret, code, 1_700_000_000_000), true);
  assert.equal(verifyTotp(secret, '000000', 1_700_000_000_000), false);
});

test('IP allowlist supports IPv4-mapped addresses and CIDR', () => {
  assert.equal(normalizeIp('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(isIpAllowed('192.168.1.25', ['192.168.1.0/24']), true);
  assert.equal(isIpAllowed('192.168.2.25', ['192.168.1.0/24']), false);
  assert.equal(isIpAllowed('::1', ['::1']), true);
});
