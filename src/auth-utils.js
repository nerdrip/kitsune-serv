'use strict';

const crypto = require('crypto');
const net = require('net');

function timingSafeTextEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(right), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(value || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('Invalid TOTP secret');
  let bits = '';
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(value).padStart(digits, '0');
}

function verifyTotp(secret, code, timestamp = Date.now(), window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (let offset = -window; offset <= window; offset += 1) {
    if (timingSafeTextEqual(code, totp(secret, timestamp + offset * 30000))) return true;
  }
  return false;
}

function normalizeIp(value) {
  const input = String(value || '').trim().replace(/^\[|\]$/g, '');
  return input.startsWith('::ffff:') && net.isIP(input.slice(7)) === 4 ? input.slice(7) : input;
}

function ipv4Number(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((number, part) => ((number << 8) | part) >>> 0, 0) >>> 0;
}

function ipMatchesRule(address, rule) {
  const ip = normalizeIp(address);
  const value = String(rule || '').trim();
  if (!value) return false;
  if (!value.includes('/')) return normalizeIp(value) === ip;
  const [network, prefixText] = value.split('/');
  const prefix = Number(prefixText);
  const ipNumber = ipv4Number(ip); const networkNumber = ipv4Number(network);
  if (ipNumber == null || networkNumber == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (networkNumber & mask);
}

function isIpAllowed(address, rules) {
  if (!Array.isArray(rules) || !rules.length) return true;
  return rules.some(rule => ipMatchesRule(address, rule));
}

module.exports = { timingSafeTextEqual, decodeBase32, totp, verifyTotp, normalizeIp, ipMatchesRule, isIpAllowed };
