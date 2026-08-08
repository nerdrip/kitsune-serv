'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitize } = require('../src/support-manager');

test('support report redacts secret fields, inline credentials and local paths', () => {
  const value = sanitize({ password: 'hunter2', nested: { apiToken: 'abc', output: 'token=visible C:\\Users\\tester\\kitsune\\file.log' } }, { appRoot: 'C:\\Users\\tester\\kitsune', home: 'C:\\Users\\tester' });
  assert.equal(value.password, '[REDACTED]');
  assert.equal(value.nested.apiToken, '[REDACTED]');
  assert.doesNotMatch(value.nested.output, /visible|tester/);
  assert.match(value.nested.output, /REDACTED/);
});
