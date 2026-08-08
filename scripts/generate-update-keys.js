'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'release-keys'));
const privatePath = path.join(output, 'kitsuneserv-update-private.pem');
const publicPath = path.join(output, 'kitsuneserv-update-public.pem');
if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw new Error(`Refusing to overwrite an existing key in ${output}`);
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 });
console.log(`Created Ed25519 release keys in ${output}`);
console.log('Keep the private key offline. Distribute only the public key.');
