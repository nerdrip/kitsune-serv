'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLE_PERMISSIONS = Object.freeze({
  owner: ['*'],
  admin: ['users.manage', 'teams.manage', 'nodes.*', 'projects.*', 'labs.*', 'api-flows.*', 'routes.*', 'deployments.*', 'audit.read', 'settings.manage'],
  operator: ['nodes.read', 'nodes.operate', 'projects.read', 'projects.operate', 'labs.*', 'api-flows.*', 'routes.read', 'deployments.*', 'audit.read'],
  developer: ['nodes.read', 'projects.read', 'projects.sync', 'labs.read', 'labs.sync', 'labs.operate', 'api-flows.*', 'routes.read', 'deployments.create'],
  auditor: ['nodes.read', 'projects.read', 'labs.read', 'api-flows.read', 'routes.read', 'deployments.read', 'audit.read'],
  viewer: ['nodes.read', 'projects.read', 'labs.read', 'api-flows.read', 'routes.read', 'deployments.read']
});

const VALID_ROLES = new Set(Object.keys(ROLE_PERMISSIONS));
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{2,120}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function clone(value) { return value == null ? value : structuredClone(value); }
function sha256(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function safeEqual(left, right) {
  const a = Buffer.from(String(left)); const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function base32Encode(buffer) {
  let bits = 0; let value = 0; let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { output += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  let bits = 0; let value = 0; const bytes = [];
  for (const character of String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const index = BASE32.indexOf(character); if (index < 0) continue;
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function totp(secret, timestamp = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timestamp / 1000 / step);
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(number).padStart(digits, '0');
}

function verifyTotp(secret, code, timestamp = Date.now()) {
  const normalized = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized) || !secret) return false;
  return [-1, 0, 1].some(offset => safeEqual(totp(secret, timestamp + offset * 30000), normalized));
}

class IdentityManager {
  constructor(appRoot, secretStore, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.secretStore = secretStore;
    this.configPath = path.join(this.appRoot, 'config', 'identity.json');
    this.now = options.now || (() => Date.now());
    this.sessionMaxAge = Number(options.sessionMaxAge) || 24 * 60 * 60 * 1000;
    this.fetch = options.fetchImpl || global.fetch;
  }

  _default() {
    return { schemaVersion: 1, users: [], sessions: [], tokens: [], invitations: [], externalIdentities: [], webauthnChallenges: [], updatedAt: new Date(this.now()).toISOString() };
  }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      if (!payload || payload.schemaVersion !== 1) return this._default();
      return {
        ...this._default(), ...payload,
        users: Array.isArray(payload.users) ? payload.users : [], sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
        tokens: Array.isArray(payload.tokens) ? payload.tokens : [], invitations: Array.isArray(payload.invitations) ? payload.invitations : [],
        externalIdentities: Array.isArray(payload.externalIdentities) ? payload.externalIdentities : [], webauthnChallenges: Array.isArray(payload.webauthnChallenges) ? payload.webauthnChallenges : []
      };
    } catch { return this._default(); }
  }

  _write(payload) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const normalized = { ...payload, schemaVersion: 1, updatedAt: new Date(this.now()).toISOString() };
    const temp = `${this.configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.configPath); }
    catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temp, this.configPath); fs.unlinkSync(temp); }
  }

  _id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
  _passwordKey(userId) { return `identity:${userId}:password`; }
  _totpKey(userId) { return `identity:${userId}:totp`; }

  _hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
    const value = String(password || '').normalize('NFKC');
    const hash = crypto.scryptSync(value, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64url');
    return { algorithm: 'scrypt', salt, hash, N: 16384, r: 8, p: 1 };
  }

  _verifyPassword(password, record) {
    if (!record || record.algorithm !== 'scrypt') return false;
    const actual = this._hashPassword(password, record.salt).hash;
    return safeEqual(actual, record.hash);
  }

  _normalizeRoles(roles, fallback = ['viewer']) {
    const values = [...new Set((Array.isArray(roles) ? roles : fallback).map(value => String(value).toLowerCase()).filter(value => VALID_ROLES.has(value)))];
    return values.length ? values : fallback;
  }

  _publicUser(user) {
    return {
      id: user.id, username: user.username, displayName: user.displayName, email: user.email, roles: [...user.roles], memberships: clone(user.memberships || []),
      active: user.active !== false, mfaEnabled: Boolean(user.mfaEnabled), passkeyCount: (user.passkeys || []).length,
      createdAt: user.createdAt, updatedAt: user.updatedAt, lastLoginAt: user.lastLoginAt || null
    };
  }

  bootstrap(username, password) {
    const payload = this._read();
    if (payload.users.length) return { created: false, user: this._publicUser(payload.users[0]) };
    const normalized = USERNAME_PATTERN.test(String(username || '')) ? String(username) : 'admin';
    const user = this._createUserRecord({ username: normalized, displayName: 'KitsuneServ Owner', roles: ['owner'], password }, { allowWeakPassword: true });
    payload.users.push(user); this._write(payload);
    return { created: true, user: this._publicUser(user) };
  }

  _createUserRecord(input, options = {}) {
    const username = String(input.username || '').trim();
    if (!USERNAME_PATTERN.test(username)) throw new Error('Username must contain 2-64 letters, numbers, dots, dashes or underscores');
    const password = String(input.password || '');
    if (!options.allowWeakPassword && (password.length < 12 || password.length > 1024)) throw new Error('Password must contain at least 12 characters');
    if (!password) throw new Error('Password is required');
    const now = new Date(this.now()).toISOString();
    return {
      id: this._id('usr'), username, usernameKey: username.toLowerCase(), displayName: String(input.displayName || username).trim().slice(0, 100),
      email: String(input.email || '').trim().toLowerCase().slice(0, 254), roles: this._normalizeRoles(input.roles), memberships: [],
      password: this._hashPassword(password), active: input.active !== false, mfaEnabled: false, recoveryCodeHashes: [], passkeys: [], createdAt: now, updatedAt: now, lastLoginAt: null
    };
  }

  listUsers() { return this._read().users.map(user => this._publicUser(user)); }
  getUser(id) { const user = this._read().users.find(item => item.id === id); if (!user) throw new Error('User not found'); return this._publicUser(user); }
  findUserByUsername(username) {
    const usernameKey = String(username || '').trim().toLowerCase();
    const user = this._read().users.find(item => item.usernameKey === usernameKey && item.active !== false);
    return user ? this._publicUser(user) : null;
  }

  createUser(input = {}) {
    const payload = this._read(); const record = this._createUserRecord(input);
    if (payload.users.some(user => user.usernameKey === record.usernameKey)) throw new Error('Username already exists');
    if (record.email && payload.users.some(user => user.email === record.email)) throw new Error('Email already exists');
    payload.users.push(record); this._write(payload); return this._publicUser(record);
  }

  updateUser(id, patch = {}) {
    const payload = this._read(); const index = payload.users.findIndex(user => user.id === id); if (index < 0) throw new Error('User not found');
    const current = payload.users[index]; const next = { ...current };
    if (patch.username != null) {
      const username = String(patch.username).trim(); if (!USERNAME_PATTERN.test(username)) throw new Error('Invalid username');
      if (payload.users.some((user, userIndex) => userIndex !== index && user.usernameKey === username.toLowerCase())) throw new Error('Username already exists');
      next.username = username; next.usernameKey = username.toLowerCase();
    }
    if (patch.displayName != null) next.displayName = String(patch.displayName).trim().slice(0, 100);
    if (patch.email != null) next.email = String(patch.email).trim().toLowerCase().slice(0, 254);
    if (patch.roles != null) next.roles = this._normalizeRoles(patch.roles);
    if (patch.memberships != null) next.memberships = this._normalizeMemberships(patch.memberships);
    if (patch.active != null) next.active = Boolean(patch.active);
    if (patch.password != null) {
      if (String(patch.password).length < 12) throw new Error('Password must contain at least 12 characters');
      next.password = this._hashPassword(patch.password); payload.sessions = payload.sessions.filter(session => session.userId !== id);
    }
    next.updatedAt = new Date(this.now()).toISOString(); payload.users[index] = next; this._write(payload); return this._publicUser(next);
  }

  _normalizeMemberships(input) {
    return (Array.isArray(input) ? input : []).slice(0, 200).map(item => ({
      scopeType: ['team', 'node', 'project', 'lab', 'api-flow'].includes(item?.scopeType) ? item.scopeType : 'team',
      scopeId: String(item?.scopeId || '').slice(0, 120), roles: this._normalizeRoles(item?.roles)
    })).filter(item => item.scopeId);
  }

  removeUser(id) {
    const payload = this._read(); const user = payload.users.find(item => item.id === id); if (!user) throw new Error('User not found');
    const owners = payload.users.filter(item => item.active !== false && item.roles.includes('owner'));
    if (user.roles.includes('owner') && owners.length <= 1) throw new Error('Cannot remove the last owner');
    payload.users = payload.users.filter(item => item.id !== id); payload.sessions = payload.sessions.filter(item => item.userId !== id);
    payload.tokens = payload.tokens.filter(item => item.userId !== id); payload.externalIdentities = payload.externalIdentities.filter(item => item.userId !== id);
    this.secretStore?.remove(this._totpKey(id)); this._write(payload); return { success: true };
  }

  enableTotp(id, secret = base32Encode(crypto.randomBytes(20))) {
    const payload = this._read(); const user = payload.users.find(item => item.id === id); if (!user) throw new Error('User not found');
    const normalized = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, ''); if (base32Decode(normalized).length < 16) throw new Error('Invalid TOTP secret');
    const recoveryCodes = Array.from({ length: 8 }, () => `${crypto.randomBytes(4).toString('hex').slice(0, 4)}-${crypto.randomBytes(4).toString('hex').slice(0, 4)}`);
    this.secretStore?.set(this._totpKey(id), normalized); user.mfaEnabled = true; user.recoveryCodeHashes = recoveryCodes.map(sha256); user.updatedAt = new Date(this.now()).toISOString();
    this._write(payload); return { success: true, secret: normalized, recoveryCodes, otpauth: `otpauth://totp/KitsuneServ:${encodeURIComponent(user.username)}?secret=${normalized}&issuer=KitsuneServ` };
  }

  disableTotp(id) {
    const payload = this._read(); const user = payload.users.find(item => item.id === id); if (!user) throw new Error('User not found');
    user.mfaEnabled = false; user.recoveryCodeHashes = []; user.updatedAt = new Date(this.now()).toISOString(); this.secretStore?.remove(this._totpKey(id)); this._write(payload); return { success: true };
  }

  authenticate(username, password, secondFactor = '') {
    const payload = this._read(); const user = payload.users.find(item => item.usernameKey === String(username || '').trim().toLowerCase());
    if (!user || user.active === false || !this._verifyPassword(password, user.password)) return { success: false, error: 'Invalid username, password or authenticator code' };
    return this._completeAuthentication(payload, user, secondFactor);
  }

  authenticateExternal(userId, secondFactor = '') {
    const payload = this._read(); const user = payload.users.find(item => item.id === String(userId || '') && item.active !== false);
    if (!user) return { success: false, error: 'Invalid username, password or authenticator code' };
    return this._completeAuthentication(payload, user, secondFactor);
  }

  _completeAuthentication(payload, user, secondFactor = '') {
    if (user.mfaEnabled) {
      const secret = this.secretStore?.get(this._totpKey(user.id)) || '';
      const validTotp = verifyTotp(secret, secondFactor, this.now()); const recoveryHash = sha256(String(secondFactor || '').toLowerCase());
      const recoveryIndex = (user.recoveryCodeHashes || []).findIndex(hash => safeEqual(hash, recoveryHash));
      if (!validTotp && recoveryIndex < 0) return { success: false, error: 'Invalid username, password or authenticator code', mfaRequired: true };
      if (recoveryIndex >= 0) user.recoveryCodeHashes.splice(recoveryIndex, 1);
    }
    user.lastLoginAt = new Date(this.now()).toISOString(); this._write(payload); return { success: true, user: this._publicUser(user), principal: this.principal(user) };
  }

  principal(user, extra = {}) {
    const permissions = new Set(); for (const role of user.roles || []) for (const permission of ROLE_PERMISSIONS[role] || []) permissions.add(permission);
    return { type: 'user', userId: user.id, username: user.username, roles: [...(user.roles || [])], permissions: [...permissions], memberships: clone(user.memberships || []), ...extra };
  }

  hasPermission(principal, permission, resource = null) {
    if (!principal) return false; const requested = String(permission);
    const matches = value => value === '*' || value === requested || (value.endsWith('.*') && requested.startsWith(value.slice(0, -1)));
    if ((principal.permissions || []).some(matches)) return true;
    // Device/API tokens are an upper permission boundary. A scoped membership
    // must never silently widen a deliberately narrowed token.
    if (principal.restrictedPermissions) return false;
    if (!resource?.type || !resource?.id) return false;
    for (const membership of principal.memberships || []) {
      if (membership.scopeType !== resource.type || membership.scopeId !== resource.id) continue;
      if ((membership.roles || []).flatMap(role => ROLE_PERMISSIONS[role] || []).some(matches)) return true;
    }
    return false;
  }

  createSession(userId, metadata = {}) {
    const payload = this._read(); const user = payload.users.find(item => item.id === userId && item.active !== false); if (!user) throw new Error('User not found');
    const token = crypto.randomBytes(32).toString('hex'); const now = this.now();
    const session = { id: this._id('ses'), userId, tokenHash: sha256(token), createdAt: now, lastSeenAt: now, expiresAt: now + this.sessionMaxAge, address: String(metadata.address || '').slice(0, 100), userAgent: String(metadata.userAgent || '').slice(0, 300), provider: String(metadata.provider || 'local').slice(0, 50) };
    payload.sessions.push(session); this._cleanup(payload); this._write(payload); return { id: session.id, token, expiresAt: session.expiresAt, user: this._publicUser(user) };
  }

  validateSession(token) {
    if (!token) return null; const payload = this._read(); const now = this.now(); this._cleanup(payload);
    const session = payload.sessions.find(item => safeEqual(item.tokenHash, sha256(token)) && item.expiresAt > now); if (!session) { this._write(payload); return null; }
    const user = payload.users.find(item => item.id === session.userId && item.active !== false); if (!user) return null;
    if (now - session.lastSeenAt > 30000) { session.lastSeenAt = now; this._write(payload); }
    return { sessionId: session.id, session: clone(session), user: this._publicUser(user), principal: this.principal(user, { sessionId: session.id, provider: session.provider }) };
  }

  _cleanup(payload) {
    const now = this.now(); payload.sessions = payload.sessions.filter(item => item.expiresAt > now);
    payload.tokens = payload.tokens.filter(item => !item.expiresAt || item.expiresAt > now);
    payload.invitations = payload.invitations.filter(item => !item.acceptedAt && item.expiresAt > now);
    payload.webauthnChallenges = payload.webauthnChallenges.filter(item => item.expiresAt > now);
  }

  listSessions(currentSessionId = '') {
    const payload = this._read(); this._cleanup(payload); const users = new Map(payload.users.map(user => [user.id, user])); this._write(payload);
    return payload.sessions.map(session => ({ id: session.id, userId: session.userId, username: users.get(session.userId)?.username || 'removed', createdAt: session.createdAt, lastSeenAt: session.lastSeenAt, expiresAt: session.expiresAt, address: session.address, userAgent: session.userAgent, provider: session.provider, current: session.id === currentSessionId }));
  }

  revokeSession(id) { const payload = this._read(); const before = payload.sessions.length; payload.sessions = payload.sessions.filter(item => item.id !== id); this._write(payload); return { success: before !== payload.sessions.length, revokedCurrent: false }; }
  revokeOtherSessions(currentId) { const payload = this._read(); const before = payload.sessions.length; payload.sessions = payload.sessions.filter(item => item.id === currentId); this._write(payload); return { success: true, removed: before - payload.sessions.length }; }

  createToken(input = {}) {
    const payload = this._read(); const user = payload.users.find(item => item.id === input.userId && item.active !== false); if (!user) throw new Error('User not found');
    const raw = `ks_${crypto.randomBytes(32).toString('base64url')}`; const now = this.now();
    const token = { id: this._id('tok'), userId: user.id, name: String(input.name || 'API token').slice(0, 100), kind: ['api', 'device', 'agent', 'plesk'].includes(input.kind) ? input.kind : 'api', tokenHash: sha256(raw), permissions: [...new Set((input.permissions || []).map(String))].slice(0, 100), nodeId: String(input.nodeId || '').slice(0, 120), createdAt: now, lastUsedAt: null, expiresAt: input.expiresAt ? Number(input.expiresAt) : now + 90 * 24 * 60 * 60 * 1000 };
    payload.tokens.push(token); this._write(payload); return { ...this._publicToken(token), token: raw };
  }

  _publicToken(token) { const { tokenHash: _hash, ...result } = token; return clone(result); }
  listTokens() { const payload = this._read(); this._cleanup(payload); this._write(payload); return payload.tokens.map(token => this._publicToken(token)); }
  revokeToken(id) { const payload = this._read(); const before = payload.tokens.length; payload.tokens = payload.tokens.filter(item => item.id !== id); this._write(payload); return { success: before !== payload.tokens.length }; }

  validateToken(raw) {
    if (!raw) return null; const payload = this._read(); const now = this.now(); this._cleanup(payload);
    const token = payload.tokens.find(item => safeEqual(item.tokenHash, sha256(raw)) && (!item.expiresAt || item.expiresAt > now)); if (!token) return null;
    const user = payload.users.find(item => item.id === token.userId && item.active !== false); if (!user) return null;
    token.lastUsedAt = now; this._write(payload); const principal = this.principal(user, { tokenId: token.id, tokenKind: token.kind, nodeId: token.nodeId });
    if (token.permissions.length) {
      principal.permissions = token.permissions.filter(permission => this.hasPermission(principal, permission));
      principal.restrictedPermissions = true;
    }
    return { token: this._publicToken(token), user: this._publicUser(user), principal };
  }

  createInvitation(input = {}) {
    const payload = this._read(); const code = crypto.randomBytes(24).toString('base64url'); const now = this.now();
    const invitation = { id: this._id('inv'), email: String(input.email || '').trim().toLowerCase().slice(0, 254), roles: this._normalizeRoles(input.roles), memberships: this._normalizeMemberships(input.memberships), codeHash: sha256(code), createdBy: String(input.createdBy || ''), createdAt: now, expiresAt: now + Math.max(5 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, Number(input.ttlMs) || 24 * 60 * 60 * 1000)), acceptedAt: null };
    payload.invitations.push(invitation); this._write(payload); return { ...clone(invitation), codeHash: undefined, code };
  }

  listInvitations() {
    const payload = this._read(); this._cleanup(payload); this._write(payload);
    return payload.invitations.map(({ codeHash: _hash, ...invitation }) => clone(invitation));
  }

  removeInvitation(id) {
    const payload = this._read(); const before = payload.invitations.length;
    payload.invitations = payload.invitations.filter(item => item.id !== id); this._write(payload);
    return { success: before !== payload.invitations.length };
  }

  listExternalIdentities(userId = '') {
    return this._read().externalIdentities.filter(item => !userId || item.userId === userId).map(clone);
  }

  unlinkExternalIdentity(id) {
    const payload = this._read(); const before = payload.externalIdentities.length;
    payload.externalIdentities = payload.externalIdentities.filter(item => item.id !== id); this._write(payload);
    return { success: before !== payload.externalIdentities.length };
  }

  acceptInvitation(code, input = {}) {
    const payload = this._read(); this._cleanup(payload); const invitation = payload.invitations.find(item => safeEqual(item.codeHash, sha256(code))); if (!invitation) throw new Error('Invitation is invalid or expired');
    const user = this._createUserRecord({ ...input, email: invitation.email || input.email, roles: invitation.roles }); user.memberships = clone(invitation.memberships || []);
    if (payload.users.some(item => item.usernameKey === user.usernameKey)) throw new Error('Username already exists');
    invitation.acceptedAt = this.now(); payload.users.push(user); this._write(payload); return this._publicUser(user);
  }

  linkExternalIdentity(input = {}) {
    const provider = String(input.provider || '').toLowerCase(); const connectorId = String(input.connectorId || ''); const subject = String(input.subject || ''); const userId = String(input.userId || '');
    if (!['plesk', 'oidc', 'github', 'google', 'microsoft'].includes(provider) || !ID_PATTERN.test(connectorId) || !subject || subject.length > 255) throw new Error('Invalid external identity');
    const payload = this._read(); if (!payload.users.some(user => user.id === userId)) throw new Error('User not found');
    const existing = payload.externalIdentities.find(item => item.provider === provider && item.connectorId === connectorId && item.subject === subject);
    const record = { id: existing?.id || this._id('ext'), provider, connectorId, subject, userId, metadata: clone(input.metadata || {}), updatedAt: new Date(this.now()).toISOString() };
    if (existing) Object.assign(existing, record); else payload.externalIdentities.push(record); this._write(payload); return clone(record);
  }

  resolveExternalIdentity(provider, connectorId, subject) {
    const payload = this._read(); const identity = payload.externalIdentities.find(item => item.provider === provider && item.connectorId === connectorId && item.subject === String(subject)); if (!identity) return null;
    const user = payload.users.find(item => item.id === identity.userId && item.active !== false); return user ? { identity: clone(identity), user: this._publicUser(user), principal: this.principal(user, { provider, connectorId }) } : null;
  }

  roles() { return clone(ROLE_PERMISSIONS); }
  static totp(secret, timestamp) { return totp(secret, timestamp); }
  static verifyTotp(secret, code, timestamp) { return verifyTotp(secret, code, timestamp); }
}

IdentityManager.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
module.exports = IdentityManager;
