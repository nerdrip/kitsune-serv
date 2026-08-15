'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

class PortableToolsManager {
  constructor(root) {
    this.root = path.resolve(root);
    this.manifest = JSON.parse(fs.readFileSync(path.join(this.root, 'manifest.json'), 'utf8'));
  }

  _tool(id) {
    const tool = this.manifest.tools.find(item => item.id === id);
    if (!tool) throw new Error('Unknown portable tool');
    return tool;
  }

  resolve(id) {
    const tool = this._tool(id); const file = path.resolve(this.root, tool.path);
    if (!file.startsWith(`${this.root}${path.sep}`) || !fs.existsSync(file)) throw new Error(`${tool.name} is missing from application resources`);
    return file;
  }

  verify(id) {
    const tool = this._tool(id); const file = this.resolve(id); const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
    return { ...tool, file, valid: actual === tool.sha256.toUpperCase(), actualSha256: actual };
  }

  list() {
    return this.manifest.tools.map(tool => { try { const verified = this.verify(tool.id); return { ...tool, available: true, verified: verified.valid }; } catch (error) { return { ...tool, available: false, verified: false, error: error.message }; } });
  }

  launch(id, args = [], options = {}) {
    const verified = this.verify(id); if (!verified.valid) throw new Error(`${verified.name} failed SHA-256 verification`);
    if (!Array.isArray(args) || args.some(value => typeof value !== 'string' || value.length > 4096)) throw new Error('Invalid portable tool arguments');
    const child = spawn(verified.file, args, { detached: true, stdio: 'ignore', windowsHide: options.visible === false }); child.unref();
    return { success: true, id, name: verified.name, version: verified.version };
  }
}

module.exports = PortableToolsManager;
