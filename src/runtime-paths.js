'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIRS = [
  'config', 'servers', 'data', 'temp', 'www', 'www/apps', 'utils',
  'projects/node', 'projects/go', 'projects/bun', 'projects/python', 'projects/deno'
];

const SEED_PATHS = [
  'config/instances.json',
  'www/index.html',
  'utils/adminer'
];

function copyIfMissing(source, destination) {
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stat = fs.statSync(source);
  if (stat.isDirectory()) fs.cpSync(source, destination, { recursive: true, errorOnExist: false });
  else fs.copyFileSync(source, destination);
}

function initializeDesktopDataRoot(electronApp) {
  const explicitRoot = process.env.KITSUNE_DATA_DIR;
  const dataRoot = explicitRoot
    ? path.resolve(explicitRoot)
    : electronApp.isPackaged
      ? electronApp.getPath('userData')
      : electronApp.getAppPath();
  const defaultsRoot = electronApp.isPackaged
    ? path.join(process.resourcesPath, 'defaults')
    : electronApp.getAppPath();

  for (const relative of DATA_DIRS) {
    fs.mkdirSync(path.join(dataRoot, relative), { recursive: true });
  }
  if (electronApp.isPackaged) {
    for (const relative of SEED_PATHS) {
      copyIfMissing(path.join(defaultsRoot, relative), path.join(dataRoot, relative));
    }
  }

  return { dataRoot, defaultsRoot };
}

function defaultServerDataRoot(codeRoot, env = process.env, platform = process.platform) {
  if (env.KITSUNE_DATA_DIR) return path.resolve(env.KITSUNE_DATA_DIR);
  if (env.KITSUNE_PORTABLE === '1') return path.resolve(codeRoot);

  if (platform === 'win32') {
    const base = env.APPDATA || path.join(env.USERPROFILE || env.HOME || codeRoot, 'AppData', 'Roaming');
    return path.join(base, 'kitsuneserv');
  }

  const base = env.XDG_CONFIG_HOME || path.join(env.HOME || codeRoot, '.config');
  return path.join(base, 'kitsuneserv');
}

/**
 * Keep mutable web/server data out of the application directory. This mirrors
 * Electron's userData behaviour and lets the same package run read-only from
 * Program Files, /opt, a container image or an extracted archive.
 */
function initializeServerDataRoot(codeRoot, options = {}) {
  const resolvedCodeRoot = path.resolve(codeRoot);
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const dataRoot = options.dataRoot
    ? path.resolve(options.dataRoot)
    : defaultServerDataRoot(resolvedCodeRoot, env, platform);

  for (const relative of DATA_DIRS) {
    fs.mkdirSync(path.join(dataRoot, relative), { recursive: true });
  }
  for (const relative of SEED_PATHS) {
    copyIfMissing(path.join(resolvedCodeRoot, relative), path.join(dataRoot, relative));
  }

  return { dataRoot, defaultsRoot: resolvedCodeRoot, codeRoot: resolvedCodeRoot };
}

module.exports = {
  initializeDesktopDataRoot,
  initializeServerDataRoot,
  defaultServerDataRoot
};
