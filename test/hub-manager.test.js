'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const HubManager = require('../src/hub-manager');
const IdentityManager = require('../src/identity-manager');
const SecretStore = require('../src/secret-store');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-hub-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = 1_800_000_000_000;
  const now = () => time;
  const secrets = new SecretStore(root, { externalKey: 'hub-test-key' });
  const identity = new IdentityManager(root, secrets, { now });
  const owner = identity.bootstrap('owner', 'bootstrap-password').user;
  const hub = new HubManager(root, { identityManager: identity, secretStore: secrets, now });
  return { root, secrets, identity, owner, hub, tick: (milliseconds = 1) => { time += milliseconds; } };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

test('hub configures a flat wildcard domain and validates gateway routes', t => {
  const { hub } = fixture(t);
  const result = hub.configure({ enabled: true, panelDomain: 'panel.example.test', authMode: 'hybrid', policies: { requireDeploymentApproval: true } });
  assert.equal(result.wildcardDomain, '*.panel.example.test');
  assert.equal(hub.hostname('project', 'Mój sklep'), 'project-moj-sklep.panel.example.test');

  const route = hub.saveRoute({ kind: 'project', name: 'Mój sklep', target: 'http://127.0.0.1:8080', authPolicy: 'session' });
  assert.equal(route.hostname, 'project-moj-sklep.panel.example.test');
  assert.equal(hub.resolveRoute(`${route.hostname}:443`).target, 'http://127.0.0.1:8080');
  assert.throws(() => hub.saveRoute({ hostname: 'too.deep.panel.example.test', target: 'http://127.0.0.1:8081' }), /direct subdomain/);
  assert.throws(() => hub.saveRoute({ name: 'remote', target: 'http://198.51.100.5:8080' }), /require HTTPS/);
  assert.equal(hub.status().routeCount, 1);
});

test('Plesk API domains act as namespaces and API Flow routes are created below them', t => {
  const { hub, owner } = fixture(t);
  hub.configure({ enabled: true, panelDomain: 'serv.example.test' });
  const pairing = hub.createPairing({ kind: 'plesk', name: 'Plesk' }, { userId: owner.id });
  const node = hub.completePairing(pairing.code).node;
  hub.heartbeat(node.id, { inventory: { apiDomains: ['api.serv.example.test'] } });

  assert.deepEqual(hub.status().apiDomains, ['api.serv.example.test']);
  assert.equal(hub.hostname('api-flow', 'Nowe API'), 'nowe-api.api.serv.example.test');
  const route = hub.ensureApiFlowRoute({ resourceId: 'orders', name: 'Nowe API', target: 'http://127.0.0.1:9393' });
  assert.equal(route.hostname, 'nowe-api.api.serv.example.test');
  assert.equal(hub.apiNamespaceForHost(route.hostname), 'api.serv.example.test');
  assert.equal(hub.apiNamespaceForHost('api.serv.example.test'), 'api.serv.example.test');
  assert.throws(() => hub.saveRoute({ kind: 'api-flow', resourceId: 'base', hostname: 'api.serv.example.test', target: 'http://127.0.0.1:9494' }), /synchronized Plesk API domain/);
  assert.throws(() => hub.saveRoute({ kind: 'api-flow', resourceId: 'bad', hostname: 'too.deep.api.serv.example.test', target: 'http://127.0.0.1:9494' }), /synchronized Plesk API domain/);

  const updated = hub.ensureApiFlowRoute({ resourceId: 'orders', name: 'Zmieniona nazwa', target: 'http://127.0.0.1:9494' });
  assert.equal(updated.id, route.id);
  assert.equal(updated.hostname, route.hostname, 'renaming a project does not break its published URL');
  assert.equal(updated.target, 'http://127.0.0.1:9494');
});

test('short-lived pairing enrolls, monitors and revokes a node with its device token', t => {
  const { hub, identity, owner, tick } = fixture(t);
  hub.configure({ panelDomain: 'hub.example.test' });
  const pairing = hub.createPairing({ kind: 'desktop', name: 'Studio', capabilities: ['projects'] }, { userId: owner.id });
  const enrolled = hub.completePairing(pairing.code, { version: '3.0.0', platform: 'win32' });
  assert.equal(enrolled.node.status, 'online');
  assert.equal(identity.validateToken(enrolled.token).principal.nodeId, enrolled.node.id);

  const heartbeat = hub.heartbeat(enrolled.node.id, { version: '3.0.1', inventory: { services: 12, accessToken: 'must-not-leak' } });
  assert.equal(heartbeat.inventory.accessToken, '[configured]');
  tick(91_000);
  assert.equal(hub.listNodes()[0].status, 'offline');
  assert.equal(hub.revokeNode(enrolled.node.id).success, true);
  assert.equal(identity.validateToken(enrolled.token), null);
  assert.throws(() => hub.completePairing(pairing.code), /invalid or expired/);
});

test('managed Plesk connector enrolls automatically with a replay-protected signature', t => {
  const { hub, identity, tick } = fixture(t);
  const secret = 'automatic-plesk-enrollment-secret-123456';
  const connector = hub.saveConnector({ id: 'plesk-managed', baseUrl: 'https://plesk.example.test', authMode: 'hybrid' }, secret);
  const request = {
    connectorId: connector.id, timestamp: 1_800_000_000_000, nonce: crypto.randomBytes(16).toString('hex'),
    device: { name: 'Plesk production', platform: 'Linux', version: '3.1.2-r18', capabilities: ['plesk-sso', 'inventory'] }
  };
  const signature = crypto.createHmac('sha256', secret).update(stable(request)).digest('base64url');
  const enrolled = hub.enrollPleskConnector(request, signature);
  assert.equal(enrolled.automatic, true);
  assert.equal(enrolled.node.connectorId, connector.id);
  assert.equal(identity.validateToken(enrolled.token).principal.nodeId, enrolled.node.id);
  assert.throws(() => hub.enrollPleskConnector(request, signature), /already used/);

  tick(91_000);
  assert.equal(hub.listNodes()[0].status, 'offline');
  assert.equal(hub.touchConnectorNodes(connector.id), 1);
  assert.equal(hub.listNodes()[0].status, 'online');

  const replacementRequest = { ...request, timestamp: 1_800_000_091_000, nonce: crypto.randomBytes(16).toString('hex') };
  const replacementSignature = crypto.createHmac('sha256', secret).update(stable(replacementRequest)).digest('base64url');
  const replaced = hub.enrollPleskConnector(replacementRequest, replacementSignature);
  assert.equal(replaced.node.id, enrolled.node.id);
  assert.equal(identity.validateToken(enrolled.token), null);
  assert.equal(identity.validateToken(replaced.token).principal.nodeId, enrolled.node.id);
  assert.equal(hub.listNodes().filter(node => node.connectorId === connector.id).length, 1);
});

test('versioned synchronization reports conflicts, redacts secrets and supports rollback', t => {
  const { hub, owner, tick } = fixture(t);
  const first = hub.publish({ kind: 'api-flow', resourceId: 'orders', name: 'Orders', data: { name: 'Orders', port: 9393, password: 'hidden' } }, { userId: owner.id, nodeId: 'desktop-a' });
  assert.equal(first.object.revision, 1);
  assert.equal(first.object.data.password, '[configured]');

  tick();
  const second = hub.publish({ kind: 'api-flow', resourceId: 'orders', data: { name: 'Orders API', port: 9494 }, baseRevision: 1 }, { userId: owner.id, nodeId: 'desktop-b' });
  assert.equal(second.object.revision, 2);
  const conflict = hub.publish({ kind: 'api-flow', resourceId: 'orders', data: { name: 'stale', port: 9595 }, baseRevision: 1 });
  assert.equal(conflict.conflict, true);
  assert.ok(conflict.diff.some(change => change.path === '/port'));

  tick();
  const rollback = hub.rollback('api-flow:orders', 1, { userId: owner.id });
  assert.equal(rollback.object.revision, 3);
  assert.equal(rollback.object.data.port, 9393);
  assert.equal(hub.history('api-flow:orders').length, 3);
  assert.equal(hub.removeObject('api-flow:orders', 2).conflict, true);
  assert.equal(hub.removeObject('api-flow:orders', 3).success, true);
  assert.equal(hub.inventory().length, 0);
});

test('Plesk assertions auto-provision mapped users, create sessions and reject replay', t => {
  const { hub, identity, secrets } = fixture(t);
  const connector = hub.saveConnector({ baseUrl: 'https://plesk.example.test', authMode: 'plesk', roleMap: { customer: 'developer' } }, 'shared-connector-secret');
  assert.equal(connector.sharedSecret, 'shared-connector-secret');
  const signed = hub.signPleskAssertion(connector.id, { subject: 'customer-42', username: 'alice', displayName: 'Alice', email: 'alice@example.test', role: 'customer', domains: ['shop.example.test'] });
  const login = hub.loginWithPlesk(signed.assertion, signed.signature, { address: '127.0.0.1' });
  assert.deepEqual(login.user.roles, ['developer']);
  assert.equal(identity.validateSession(login.token).user.username, 'alice');
  assert.equal(identity.resolveExternalIdentity('plesk', connector.id, 'customer-42').user.id, login.user.id);
  assert.throws(() => hub.loginWithPlesk(signed.assertion, signed.signature), /already used/);
  assert.equal(secrets.get(`hub:connector:${connector.id}:secret`), 'shared-connector-secret');
  assert.doesNotMatch(fs.readFileSync(path.join(hub.appRoot, 'config', 'hub.json'), 'utf8'), /shared-connector-secret/);
});

test('hybrid login checks Plesk first and links a matching local Hub account without replacing it', async t => {
  const { hub, identity } = fixture(t);
  hub.configure({ enabled: true, panelDomain: 'hub.example.test', authMode: 'hybrid' });
  const local = identity.createUser({ username: 'boberski', displayName: 'Local Boberski', password: 'hub-password-b', roles: ['operator'] });
  const secret = 'plesk-password-check-secret-123456';
  const connector = hub.saveConnector({ id: 'plesk-main', baseUrl: 'https://plesk.example.test', authMode: 'hybrid' }, secret);
  hub.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/modules/kitsuneserv-bridge/public/auth.php');
    const body = JSON.parse(options.body); const digest = crypto.createHash('sha256').update(options.body).digest('hex');
    const expected = crypto.createHmac('sha256', secret).update(`${body.timestamp}\n${body.nonce}\n${digest}`).digest('base64url');
    assert.equal(options.headers['x-kitsune-connector'], connector.id);
    assert.equal(options.headers['x-kitsune-signature'], expected);
    const normalizedUsername = body.username.toLowerCase(); const known = ['boberski', 'unlinked'].includes(normalizedUsername);
    const result = known
      ? (body.password === 'plesk-password-a'
          ? { valid: true, accountExists: true, subject: normalizedUsername === 'boberski' ? 'plesk-client-42' : 'plesk-client-99', username: normalizedUsername, displayName: 'Plesk User', email: `${normalizedUsername}@example.test`, role: 'admin' }
          : { valid: false, accountExists: true })
      : { valid: false, accountExists: false };
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };

  const login = await hub.authenticateWithPlesk('boberski', 'plesk-password-a', '', { address: '127.0.0.1' });
  assert.equal(login.success, true);
  assert.equal(login.user.id, local.id, 'the local Hub record wins a username collision');
  assert.deepEqual(login.user.roles, ['operator'], 'Plesk role does not overwrite local authorization');
  assert.equal(identity.listUsers().filter(user => user.username.toLowerCase() === 'boberski').length, 1);
  assert.equal(identity.resolveExternalIdentity('plesk', connector.id, 'plesk-client-42').user.id, local.id);
  assert.equal(identity.validateSession(login.token).session.provider, `plesk-password:${connector.id}`);

  const rejected = await hub.authenticateWithPlesk('boberski', 'hub-password-b');
  assert.equal(rejected.success, false);
  assert.equal(rejected.accountExists, true, 'a known Plesk account must not fall through to its local password');
  assert.equal(hub.allowsLocalPassword('boberski'), false);

  const unlinkedConnector = hub.saveConnector({ id: connector.id, baseUrl: connector.baseUrl, authMode: 'hybrid', autoProvisionUsers: false }, secret);
  assert.equal(unlinkedConnector.autoProvisionUsers, false);
  const blockedProvision = await hub.authenticateWithPlesk('boberski', 'plesk-password-a');
  assert.equal(blockedProvision.success, true, 'an already linked user is unaffected when automatic provisioning is disabled');
  const unlinked = await hub.authenticateWithPlesk('unlinked', 'plesk-password-a');
  assert.equal(unlinked.success, false);
  assert.equal(unlinked.accountExists, true, 'a valid but unlinked Plesk user must not fall through to local login');
  assert.equal(unlinked.unavailable, false);

  hub.configure({ authMode: 'independent' });
  assert.equal((await hub.authenticateWithPlesk('boberski', 'plesk-password-a')).disabled, true);
  assert.equal(hub.allowsLocalPassword('boberski'), true);
  assert.equal(identity.authenticate('boberski', 'hub-password-b').success, true);
});

test('deployment workflow enforces approval and valid state transitions', t => {
  const { hub, owner } = fixture(t);
  hub.configure({ panelDomain: 'hub.example.test', policies: { requireDeploymentApproval: true } });
  const pairing = hub.createPairing({ kind: 'server', name: 'Plesk node' }, { userId: owner.id });
  const node = hub.completePairing(pairing.code).node;
  const object = hub.publish({ kind: 'project', resourceId: 'shop', data: { name: 'Shop' } }, { userId: owner.id }).object;
  const deployment = hub.createDeployment({ objectId: object.id, targetNodeId: node.id, strategy: 'blue-green' }, { userId: owner.id });
  assert.equal(deployment.status, 'pending');
  assert.throws(() => hub.updateDeployment(deployment.id, { status: 'running' }), /Invalid deployment transition/);
  hub.approveDeployment(deployment.id, { userId: owner.id });
  hub.updateDeployment(deployment.id, { status: 'running' });
  const completed = hub.updateDeployment(deployment.id, { status: 'succeeded', health: { status: 'ok', token: 'nope' } });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.health.token, '[configured]');
});

test('two-way remote sync is idempotent and preserves divergent edits as conflicts', async t => {
  const localFixture = fixture(t); const remoteFixture = fixture(t);
  const remotePrincipal = { userId: remoteFixture.owner.id, username: remoteFixture.owner.username, nodeId: 'remote-test' };
  const fetchImpl = async (url, options) => {
    const endpoint = new URL(url).pathname.replace(/^\/api\//, ''); const body = JSON.parse(options.body || '{}'); let result;
    if (endpoint === 'hub/inventory') result = remoteFixture.hub.inventory(body.filters || {});
    else if (endpoint === 'hub/sync/publish') result = remoteFixture.hub.publish(body.input || {}, remotePrincipal);
    else throw new Error(`Unexpected endpoint ${endpoint}`);
    return { ok: true, status: 200, text: async () => JSON.stringify(result) };
  };
  localFixture.hub.fetch = fetchImpl;
  const remote = localFixture.hub.saveRemote({ url: 'http://127.0.0.1:45678', name: 'Test Hub' }, 'remote-test-token');
  localFixture.hub.publish({ kind: 'project', resourceId: 'shop', data: { name: 'Shop', branch: 'main' } }, { userId: localFixture.owner.id });

  const first = await localFixture.hub.syncRemote(remote.id, { kinds: ['project'] }, { userId: localFixture.owner.id });
  assert.equal(first.success, true);
  assert.equal(remoteFixture.hub.getObject('project:shop').data.branch, 'main');
  const unchanged = await localFixture.hub.syncRemote(remote.id, { kinds: ['project'] }, { userId: localFixture.owner.id });
  assert.equal(unchanged.conflicts, 0);

  localFixture.hub.publish({ kind: 'project', resourceId: 'shop', data: { name: 'Shop', branch: 'desktop' }, baseRevision: 1 }, { userId: localFixture.owner.id });
  remoteFixture.hub.publish({ kind: 'project', resourceId: 'shop', data: { name: 'Shop', branch: 'server' }, baseRevision: 1 }, remotePrincipal);
  const conflict = await localFixture.hub.syncRemote(remote.id, { kinds: ['project'] }, { userId: localFixture.owner.id });
  assert.equal(conflict.success, false);
  assert.ok(conflict.conflicts >= 1);
  assert.equal(localFixture.hub.getObject('project:shop').data.branch, 'desktop');
  assert.equal(remoteFixture.hub.getObject('project:shop').data.branch, 'server');
});
