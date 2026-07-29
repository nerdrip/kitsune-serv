'use strict';

const path = require('path');

const SERVICE_IDS = Object.freeze([
  'apache', 'nginx', 'caddy',
  'postgresql', 'mysql', 'mariadb', 'mongodb',
  'php', 'node', 'go', 'bun', 'python', 'deno',
  'redis', 'memcached', 'minio'
]);

const PROJECT_SECTIONS = Object.freeze(['node', 'go', 'bun', 'python', 'deno']);

function isPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveInside(root, ...segments) {
  const resolved = path.resolve(root, ...segments);
  if (!isPathInside(root, resolved)) {
    throw new Error('Path is outside the allowed data directory');
  }
  return resolved;
}

function assertSafeSegment(value, label = 'value') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw new Error(`Invalid ${label}`);
  }
  if (value === '.' || value === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function assertServiceId(value) {
  if (!SERVICE_IDS.includes(value)) throw new Error('Unknown service');
  return value;
}

function assertProjectSection(value) {
  if (!PROJECT_SECTIONS.includes(value)) throw new Error('Unknown project type');
  return value;
}

function assertProjectName(value) {
  if (typeof value !== 'string') throw new Error('Invalid project name');
  const name = value.trim();
  if (!name || name.length > 100 || name === '.' || name === '..' || !/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(name)) {
    throw new Error('Invalid project name');
  }
  return name;
}

module.exports = {
  SERVICE_IDS,
  PROJECT_SECTIONS,
  isPathInside,
  resolveInside,
  assertSafeSegment,
  assertServiceId,
  assertProjectSection,
  assertProjectName
};
