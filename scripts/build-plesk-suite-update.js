'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const projects = path.dirname(root);
const androidNerd = path.resolve(projects, '..', 'Android', 'Nerd');
const phpWordpressPlugins = path.resolve(projects, '..', 'PHP', 'wordpress', 'wordpress-plugins');
const allowedSourceRoots = [projects, androidNerd, phpWordpressPlugins];
const outputRoot = path.join(root, 'update');
const packagesRoot = path.join(outputRoot, 'packages');
const timestamp = new Date(Number(process.env.SOURCE_DATE_EPOCH || 315532800) * 1000);
const registry = [
  ['01', 'kitsuneartifactory-manager', 'KitsuneArtifactory/tools/plesk-extension/kitsuneartifactory-manager'],
  ['02', 'kitsuneirc-manager', 'kitsune-irc/tools/plesk-extension/kitsuneirc-manager'],
  ['03', 'kitsunecolab-manager', 'KitsuneColab/tools/plesk-extension/kitsunecolab-manager'],
  ['04', 'kitsunepaint-manager', 'KitsunePaint/tools/plesk-extension/kitsunepaint-manager'],
  ['05', 'kitsunepnc-manager', 'KitsunePNC/tools/plesk-extension/kitsunepnc-manager'],
  ['06', 'kitsunetab-manager', 'KitsuneTab/tools/plesk-extension/kitsunetab-manager'],
  ['07', 'kitsunetest-manager', 'KitsuneTest/tools/plesk-extension/kitsunetest-manager'],
  ['08', 'nailit-manager', 'NailIT/tools/plesk-extension/nailit-manager'],
  ['09', 'kitsune-git', 'kitsune-git/deploy/plesk'],
  ['10', 'wpkit-parse-manager', '../Android/Nerd/wpkit/tools/plesk-extension/wpkit-parse-manager'],
  ['11', 'nerd-apps-runtime-manager', '../Android/Nerd/dicex/tools/plesk-extension/nerd-apps-runtime-manager'],
  ['12', 'ultimate-tool', '../PHP/wordpress/wordpress-plugins/ultimate-tool/plesk-extension', '../tools/build-plesk-extension.ps1'],
  ['99', 'kitsuneserv-bridge', 'kitsune-serv/plesk-extension/kitsuneserv-bridge'],
];
const textExtensions = new Set(['.css', '.htaccess', '.js', '.json', '.md', '.php', '.phtml', '.sh', '.txt', '.xml', '.yaml', '.yml']);

let crcTable;

function walk(directory) {
  const out = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in a Plesk package: ${full}`);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function crc32(buffer) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let crc = 0xffffffff;
  for (const value of buffer) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(dateValue) {
  const date = new Date(Math.max(new Date('1980-01-01T00:00:00Z').getTime(), dateValue.getTime()));
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function createZip(directory, destination) {
  const files = walk(directory);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = path.relative(directory, file).split(path.sep).join('/');
    const nameBytes = Buffer.from(name, 'utf8');
    let content = fs.readFileSync(file);
    const executable = name.startsWith('sbin/');
    if (executable || textExtensions.has(path.extname(name).toLowerCase())) content = Buffer.from(content.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8');
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    const { date, time } = dosTimestamp(timestamp);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const header = Buffer.concat([local, nameBytes, compressed]);
    locals.push(header);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x0314, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(time, 12); entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(checksum, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(((executable ? 0o100755 : 0o100644) * 0x10000) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([entry, nameBytes]));
    offset += header.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(destination, Buffer.concat([...locals, centralBuffer, end]), { mode: 0o600 });
}

function createProjectZip(source, builderRelative, destination) {
  const projectRoot = path.dirname(source);
  const builder = path.resolve(source, builderRelative);
  const temporary = path.join(projectRoot, `.kitsune-suite-${process.pid}-${crypto.randomBytes(8).toString('hex')}.zip`);
  if (!fs.existsSync(builder)) throw new Error(`Missing project-specific Plesk builder: ${builder}`);
  try {
    const executable = process.platform === 'win32' ? 'powershell' : 'pwsh';
    const commandArguments = process.platform === 'win32'
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', builder, '-Output', temporary]
      : ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', builder, '-Output', temporary];
    const result = spawnSync(executable, commandArguments, { cwd: projectRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || !fs.existsSync(temporary)) throw new Error(`Project-specific Plesk build failed for ${source}:\n${result.stdout || ''}${result.stderr || ''}`);
    fs.copyFileSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function matchMetadata(xml, tag) {
  return xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]?.trim() || '';
}

function checkSource(source) {
  for (const file of walk(source)) {
    const relative = path.relative(source, file).split(path.sep).join('/');
    const command = file.endsWith('.js') ? [process.execPath, ['--check', file]] : ((file.endsWith('.php') || file.endsWith('.phtml') || relative.startsWith('sbin/')) ? ['php', ['-l', file]] : null);
    if (!command) continue;
    const result = spawnSync(command[0], command[1], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`Source validation failed for ${file}:\n${result.stdout || ''}${result.stderr || ''}`);
  }
}

function checkSuiteContract(source, id) {
  for (const relative of ['htdocs/css/kitsune-platform.css', 'htdocs/js/kitsune-platform.js']) {
    if (!fs.existsSync(path.join(source, relative))) throw new Error(`Missing shared Suite asset for ${id}: ${relative}`);
  }
  if (id === 'kitsuneserv-bridge') {
    for (const relative of ['htdocs/images/kitsune-hub-menu.svg', 'plib/library/Suite.php']) {
      if (!fs.existsSync(path.join(source, relative))) throw new Error(`Missing Hub Suite file for ${id}: ${relative}`);
    }
    return;
  }
  const hookPath = path.join(source, 'plib/hooks/CustomButtons.php');
  const controllerPath = path.join(source, 'plib/controllers/IndexController.php');
  const viewPath = path.join(source, 'plib/views/scripts/index/index.phtml');
  const selfUpdateLibrary = path.join(source, 'plib/library/SuiteSelfUpdate.php');
  const selfUpdateController = path.join(source, 'plib/controllers/SelfUpdateController.php');
  const selfUpdateView = path.join(source, 'plib/views/scripts/self-update/index.phtml');
  for (const required of [hookPath, controllerPath, viewPath, selfUpdateLibrary, selfUpdateController, selfUpdateView]) {
    if (!fs.existsSync(required)) throw new Error(`Missing Suite integration file for ${id}: ${path.relative(source, required)}`);
  }
  const hook = fs.readFileSync(hookPath, 'utf8');
  const controller = fs.readFileSync(controllerPath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');
  const updater = fs.readFileSync(selfUpdateLibrary, 'utf8') + fs.readFileSync(selfUpdateController, 'utf8');
  if (!hook.includes("pm_Extension::getById('kitsuneserv-bridge')->isActive()") || !hook.includes('return [];')) throw new Error(`Extension ${id} does not yield its menu to an active Kitsune Hub.`);
  if (!controller.includes('suiteHubActive') || !controller.includes('kitsune-platform')) throw new Error(`Extension ${id} does not load the shared Suite shell.`);
  if (!view.includes('data-kitsune-suite')) throw new Error(`Extension ${id} does not mount the shared Suite header.`);
  if (!updater.includes('update/manifest.json') || !updater.includes("hash_file('sha256'") || !updater.includes('pm_Extension::installByFile')) throw new Error(`Extension ${id} does not provide verified standalone self-update.`);
  const icon = hook.match(/'icon'\s*=>\s*pm_Context::getBaseUrl\(\)\s*\.\s*'images\/([^']+)'/)?.[1];
  if (!icon || !fs.existsSync(path.join(source, 'htdocs/images', icon))) throw new Error(`Extension ${id} does not provide its declared menu icon.`);
}

if (path.dirname(packagesRoot) !== outputRoot || path.dirname(outputRoot) !== root) throw new Error('Unsafe update output path.');
fs.rmSync(packagesRoot, { recursive: true, force: true });
fs.mkdirSync(packagesRoot, { recursive: true });
const manifest = [];
const sums = [];

for (const [order, expectedId, relative, packageBuilder] of registry) {
  const source = path.resolve(projects, relative);
  const sourceAllowed = allowedSourceRoots.some(allowedRoot => source === allowedRoot || source.startsWith(allowedRoot + path.sep));
  if (!sourceAllowed || !fs.existsSync(path.join(source, 'meta.xml'))) throw new Error(`Missing extension source: ${source}`);
  const xml = fs.readFileSync(path.join(source, 'meta.xml'), 'utf8');
  const id = matchMetadata(xml, 'id');
  const name = matchMetadata(xml, 'name');
  const version = matchMetadata(xml, 'version');
  const release = matchMetadata(xml, 'release');
  if (id !== expectedId) throw new Error(`Extension ID mismatch for ${relative}: expected ${expectedId}, received ${id}`);
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) || !/^\d+$/.test(release)) throw new Error(`Invalid version metadata for ${id}`);
  checkSuiteContract(source, id);
  checkSource(source);
  const fileName = `${order}-${id}-${version}-r${release}.zip`;
  const destination = path.join(packagesRoot, fileName);
  if (packageBuilder) createProjectZip(source, packageBuilder, destination);
  else createZip(source, destination);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  sums.push(`${digest}  packages/${fileName}`);
  manifest.push({ order: Number(order), id, name, version, release, file: `packages/${fileName}`, sha256: digest });
}

fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), packages: manifest }, null, 2) + '\n');
fs.writeFileSync(path.join(outputRoot, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(JSON.stringify({ outputRoot, packages: manifest.length }, null, 2));
