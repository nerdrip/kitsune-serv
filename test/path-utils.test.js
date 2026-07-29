'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  isPathInside,
  resolveInside,
  assertSafeSegment,
  assertProjectName,
  assertProjectSection
} = require('../src/path-utils');

test('path containment rejects traversal and sibling-prefix paths', () => {
  const root = path.resolve('C:/Kitsune/data');
  assert.equal(isPathInside(root, path.join(root, 'servers', 'node')), true);
  assert.equal(isPathInside(root, path.resolve(root, '..', 'data-evil')), false);
  assert.throws(() => resolveInside(root, '..', 'outside'), /outside/i);
});

test('safe identifiers reject separators and dot segments', () => {
  assert.equal(assertSafeSegment('24.18.0', 'version'), '24.18.0');
  assert.throws(() => assertSafeSegment('../24.18.0', 'version'), /invalid/i);
  assert.throws(() => assertSafeSegment('..', 'version'), /invalid/i);
});

test('project validation accepts known runtimes and safe names only', () => {
  assert.equal(assertProjectSection('node'), 'node');
  assert.equal(assertProjectName('my project-1'), 'my project-1');
  assert.throws(() => assertProjectSection('../../data'), /unknown/i);
  assert.throws(() => assertProjectName('../project'), /invalid/i);
});
