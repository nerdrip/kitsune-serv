'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const IdentityManager = require('../src/identity-manager');
const SecretStore = require('../src/secret-store');

function fixture(t, now = 1_800_000_000_000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new SecretStore(root, { externalKey: 'identity-test-key' });
  return { root, store, manager: new IdentityManager(root, store, { now: () => now, sessionMaxAge: 60_000 }) };
}

test('identity manager bootstraps the legacy owner and persists revocable sessions', t => {
  const { root, store, manager } = fixture(t);
  const bootstrap = manager.bootstrap('admin', 'legacy-secret');
  assert.equal(bootstrap.created, true);
  assert.deepEqual(bootstrap.user.roles, ['owner']);
  assert.equal(manager.bootstrap('ignored', 'ignored').created, false);

  const auth = manager.authenticate('admin', 'legacy-secret');
  assert.equal(auth.success, true);
  assert.equal(manager.hasPermission(auth.principal, 'users.manage'), true);
  const session = manager.createSession(auth.user.id, { address: '127.0.0.1', userAgent: 'test' });
  const afterRestart = new IdentityManager(root, store, { now: () => 1_800_000_000_000, sessionMaxAge: 60_000 });
  assert.equal(afterRestart.validateSession(session.token).user.username, 'admin');
  assert.equal(afterRestart.listSessions(session.id)[0].current, true);
  assert.equal(afterRestart.revokeSession(session.id).success, true);
  assert.equal(afterRestart.validateSession(session.token), null);
  assert.throws(() => afterRestart.removeUser(auth.user.id), /last owner/);
});

test('roles, scoped memberships, invitations and narrowed API tokens are enforced', t => {
  const { manager } = fixture(t);
  manager.bootstrap('owner', 'bootstrap-password');
  const developer = manager.createUser({ username: 'mika', password: 'a-very-long-password', roles: ['viewer'] });
  manager.updateUser(developer.id, { memberships: [{ scopeType: 'project', scopeId: 'project-a', roles: ['developer'] }] });
  const auth = manager.authenticate('mika', 'a-very-long-password');
  assert.equal(manager.hasPermission(auth.principal, 'projects.sync'), false);
  assert.equal(manager.hasPermission(auth.principal, 'projects.sync', { type: 'project', id: 'project-a' }), true);
  assert.equal(manager.hasPermission(auth.principal, 'projects.sync', { type: 'project', id: 'project-b' }), false);

  const token = manager.createToken({ userId: developer.id, name: 'read only', permissions: ['projects.read'], kind: 'device' });
  const tokenAuth = manager.validateToken(token.token);
  assert.deepEqual(tokenAuth.principal.permissions, ['projects.read']);
  assert.equal(manager.hasPermission(tokenAuth.principal, 'projects.sync', { type: 'project', id: 'project-a' }), false, 'token permissions remain an upper boundary');
  assert.equal(manager.revokeToken(token.id).success, true);
  assert.equal(manager.validateToken(token.token), null);

  const invitation = manager.createInvitation({ email: 'new@example.test', roles: ['auditor'] });
  const invited = manager.acceptInvitation(invitation.code, { username: 'audit-user', password: 'another-long-password' });
  assert.deepEqual(invited.roles, ['auditor']);
  assert.throws(() => manager.acceptInvitation(invitation.code, { username: 'twice', password: 'another-long-password' }), /invalid or expired/);
});

test('per-user TOTP, one-use recovery codes and Plesk identities work without storing secrets in plain text', t => {
  const now = 1_800_000_000_000; const { root, manager } = fixture(t, now);
  manager.bootstrap('owner', 'bootstrap-password');
  const user = manager.createUser({ username: 'plesk-user', password: 'independent-password', roles: ['operator'] });
  const mfa = manager.enableTotp(user.id, 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  assert.equal(manager.authenticate('plesk-user', 'independent-password').mfaRequired, true);
  const code = IdentityManager.totp(mfa.secret, now);
  assert.equal(manager.authenticate('plesk-user', 'independent-password', code).success, true);
  assert.equal(manager.authenticate('plesk-user', 'independent-password', mfa.recoveryCodes[0]).success, true);
  assert.equal(manager.authenticate('plesk-user', 'independent-password', mfa.recoveryCodes[0]).success, false);

  const identity = manager.linkExternalIdentity({ provider: 'plesk', connectorId: 'plesk-main', subject: '42', userId: user.id, metadata: { role: 'customer' } });
  assert.equal(identity.subject, '42');
  assert.equal(manager.resolveExternalIdentity('plesk', 'plesk-main', '42').user.id, user.id);
  const plain = fs.readFileSync(path.join(root, 'config', 'identity.json'), 'utf8') + fs.readFileSync(path.join(root, 'config', 'secrets.json'), 'utf8');
  assert.doesNotMatch(plain, /independent-password|JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP/);
});
