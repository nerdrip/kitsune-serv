'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const tls = require('tls');
const path = require('path');

const KINDS = new Set(['project', 'lab', 'api-flow', 'environment', 'snapshot', 'deployment-profile', 'policy']);
const NODE_KINDS = new Set(['desktop', 'server', 'plesk', 'agent', 'ci']);
const AUTH_MODES = new Set(['independent', 'plesk', 'hybrid']);
const SECRET_KEY = /(password|secret|token|private.?key|authorization|cookie|database_url)/i;
const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function clone(value) { return value == null ? value : structuredClone(value); }
function hash(value) { return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex'); }
function hmac(secret, value) { return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url'); }
function safeEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'resource';
}
function redact(value, key = '', seen = new WeakSet()) {
  if (SECRET_KEY.test(key)) return value == null || value === '' ? value : '[configured]';
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => redact(item, key, seen));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 1024 * 1024 ? `${value.slice(0, 1024 * 1024)}…` : value;
  if (seen.has(value)) return '[circular]'; seen.add(value);
  return Object.fromEntries(Object.entries(value).slice(0, 2000).map(([childKey, child]) => [childKey, redact(child, childKey, seen)]));
}

class HubManager {
  constructor(appRoot, dependencies = {}) {
    this.appRoot = path.resolve(appRoot);
    this.identityManager = dependencies.identityManager;
    this.secretStore = dependencies.secretStore;
    this.projectManager = dependencies.projectManager;
    this.labManager = dependencies.labManager;
    this.apiFlowManager = dependencies.apiFlowManager;
    this.environmentManager = dependencies.environmentManager;
    this.fetch = dependencies.fetchImpl || global.fetch;
    this.now = dependencies.now || (() => Date.now());
    this.configPath = path.join(this.appRoot, 'config', 'hub.json');
    this.assertionNonces = new Map();
    this.onChanged = null;
  }

  _default() {
    return {
      schemaVersion: 1,
      settings: {
        enabled: false, panelDomain: '', authMode: 'hybrid', gatewayEnabled: true, tlsMode: 'managed',
        autoProvisionPleskUsers: true, routePrefix: { project: 'project', lab: 'lab', 'api-flow': 'api', preview: 'preview', share: 'share' },
        policies: { publicApiRequiresAuth: true, backupBeforeDeploy: true, requireDeploymentApproval: false, maxLabsPerUser: 20, maxApiFlowsPerUser: 50 }
      },
      teams: [], nodes: [], routes: [], objects: [], deployments: [], pairings: [], connectors: [], remotes: [], updatedAt: new Date(this.now()).toISOString()
    };
  }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); if (!payload || payload.schemaVersion !== 1) return this._default();
      const initial = this._default();
      return { ...initial, ...payload, settings: { ...initial.settings, ...(payload.settings || {}), policies: { ...initial.settings.policies, ...(payload.settings?.policies || {}) } }, teams: Array.isArray(payload.teams) ? payload.teams : [], nodes: Array.isArray(payload.nodes) ? payload.nodes : [], routes: Array.isArray(payload.routes) ? payload.routes : [], objects: Array.isArray(payload.objects) ? payload.objects : [], deployments: Array.isArray(payload.deployments) ? payload.deployments : [], pairings: Array.isArray(payload.pairings) ? payload.pairings : [], connectors: Array.isArray(payload.connectors) ? payload.connectors : [], remotes: Array.isArray(payload.remotes) ? payload.remotes : [] };
    } catch { return this._default(); }
  }

  _write(payload, event = null) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true }); this._cleanup(payload);
    const normalized = { ...payload, schemaVersion: 1, updatedAt: new Date(this.now()).toISOString() }; const temp = `${this.configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.configPath); }
    catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temp, this.configPath); fs.unlinkSync(temp); }
    if (event) { try { this.onChanged?.(clone(event)); } catch {} }
  }

  _cleanup(payload) {
    const now = this.now(); payload.pairings = payload.pairings.filter(item => !item.usedAt && item.expiresAt > now);
    for (const [nonce, expiresAt] of this.assertionNonces) if (expiresAt <= now) this.assertionNonces.delete(nonce);
    for (const node of payload.nodes) if (node.lastSeenAt && now - node.lastSeenAt > 90_000 && node.status === 'online') node.status = 'offline';
  }

  _id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
  _connectorSecretKey(id) { return `hub:connector:${id}:secret`; }
  _remoteTokenKey(id) { return `hub:remote:${id}:token`; }

  status() {
    const payload = this._read(); this._cleanup(payload);
    return {
      enabled: Boolean(payload.settings.enabled), panelDomain: payload.settings.panelDomain, wildcardDomain: payload.settings.panelDomain ? `*.${payload.settings.panelDomain}` : '',
      apiDomains: this._apiNamespaces(payload),
      authMode: payload.settings.authMode, gatewayEnabled: payload.settings.gatewayEnabled !== false,
      nodeCount: payload.nodes.length, onlineNodes: payload.nodes.filter(node => node.status === 'online').length,
      routeCount: payload.routes.filter(route => route.enabled !== false).length, objectCount: payload.objects.filter(object => !object.deletedAt).length,
      pendingDeployments: payload.deployments.filter(item => ['pending', 'approved', 'running'].includes(item.status)).length,
      connectorCount: payload.connectors.length, remoteCount: payload.remotes.length, policies: clone(payload.settings.policies)
    };
  }

  settings() { return clone(this._read().settings); }

  configure(input = {}) {
    const payload = this._read(); const current = payload.settings; const next = { ...current };
    if (input.enabled != null) next.enabled = Boolean(input.enabled);
    if (input.panelDomain != null) {
      const domain = String(input.panelDomain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
      if (domain && !DOMAIN_PATTERN.test(domain)) throw new Error('Panel domain must be a fully-qualified DNS name'); next.panelDomain = domain;
    }
    if (input.authMode != null) { if (!AUTH_MODES.has(input.authMode)) throw new Error('Invalid authentication mode'); next.authMode = input.authMode; }
    if (input.gatewayEnabled != null) next.gatewayEnabled = Boolean(input.gatewayEnabled);
    if (input.tlsMode != null) { if (!['managed', 'external', 'disabled'].includes(input.tlsMode)) throw new Error('Invalid TLS mode'); next.tlsMode = input.tlsMode; }
    if (input.autoProvisionPleskUsers != null) next.autoProvisionPleskUsers = Boolean(input.autoProvisionPleskUsers);
    if (input.policies) next.policies = this._normalizePolicies({ ...current.policies, ...input.policies });
    payload.settings = next; this._write(payload, { type: 'settings', settings: next }); return { success: true, settings: clone(next), wildcardDomain: next.panelDomain ? `*.${next.panelDomain}` : '' };
  }

  _normalizePolicies(input = {}) {
    return {
      publicApiRequiresAuth: input.publicApiRequiresAuth !== false, backupBeforeDeploy: input.backupBeforeDeploy !== false,
      requireDeploymentApproval: Boolean(input.requireDeploymentApproval),
      maxLabsPerUser: Math.max(0, Math.min(1000, Number(input.maxLabsPerUser) || 0)), maxApiFlowsPerUser: Math.max(0, Math.min(5000, Number(input.maxApiFlowsPerUser) || 0))
    };
  }

  hostname(kind, value) {
    const payload = this._read(); const settings = payload.settings; if (!settings.panelDomain) throw new Error('Configure the panel domain first');
    if (kind === 'api-flow') {
      const namespace = this._apiNamespaces(payload)[0];
      if (namespace) return `${slugify(value)}.${namespace}`;
    }
    const prefixes = settings.routePrefix || {}; const prefix = prefixes[kind] || slugify(kind); const slug = slugify(value);
    const label = `${prefix}-${slug}`.slice(0, 63).replace(/-$/, ''); if (!SLUG_PATTERN.test(label)) throw new Error('Could not generate a valid hostname'); return `${label}.${settings.panelDomain}`;
  }

  _apiNamespaces(payload = this._read()) {
    const panelDomain = String(payload.settings?.panelDomain || '').toLowerCase();
    if (!panelDomain) return [];
    const directDepth = panelDomain.split('.').length + 1;
    return [...new Set((payload.nodes || [])
      .filter(node => node.kind === 'plesk')
      .flatMap(node => Array.isArray(node.inventory?.apiDomains) ? node.inventory.apiDomains : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => DOMAIN_PATTERN.test(value) && value.endsWith(`.${panelDomain}`) && value.split('.').length === directDepth))]
      .sort();
  }

  apiNamespaces() { return clone(this._apiNamespaces()); }

  apiNamespaceForHost(host) {
    const hostname = String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
    return this._apiNamespaces().find(namespace => hostname === namespace || (hostname.endsWith(`.${namespace}`) && hostname.split('.').length === namespace.split('.').length + 1)) || null;
  }

  ensureApiFlowRoute(input = {}) {
    const payload = this._read(); const namespace = this._apiNamespaces(payload)[0];
    if (!namespace) return null;
    const resourceId = String(input.resourceId || '').slice(0, 120); if (!resourceId) throw new Error('API Flow resource ID is required');
    const existing = payload.routes.find(route => route.kind === 'api-flow' && route.resourceId === resourceId);
    const existingNamespace = existing ? this.apiNamespaceForHost(existing.hostname) : null;
    let hostname = existingNamespace && existing.hostname !== existingNamespace ? existing.hostname : `${slugify(input.slug || input.name || resourceId)}.${namespace}`;
    const occupied = payload.routes.find(route => route.id !== existing?.id && route.hostname === hostname);
    if (occupied) {
      const suffix = hash(resourceId).slice(0, 6); const label = `${slugify(input.slug || input.name || resourceId).slice(0, 56)}-${suffix}`;
      hostname = `${label}.${namespace}`;
    }
    const route = this.saveRoute({
      id: existing?.id, kind: 'api-flow', resourceId, name: input.name, hostname,
      target: input.target, authPolicy: input.authPolicy || 'public', websocket: false,
      ownerNodeId: input.ownerNodeId || existing?.ownerNodeId || ''
    });
    return this._routeView(route, this._read());
  }

  listTeams() { return clone(this._read().teams); }
  saveTeam(input = {}, principal = null) {
    const payload = this._read(); const id = String(input.id || this._id('team')); const index = payload.teams.findIndex(item => item.id === id);
    const name = String(input.name || '').trim().slice(0, 100); if (!name) throw new Error('Team name is required');
    const slug = slugify(input.slug || name); if (payload.teams.some((item, itemIndex) => itemIndex !== index && item.slug === slug)) throw new Error('Team slug is already used');
    const now = this.now(); const team = { id, name, slug, description: String(input.description || '').trim().slice(0, 500), createdBy: index >= 0 ? payload.teams[index].createdBy : principal?.userId || 'system', createdAt: index >= 0 ? payload.teams[index].createdAt : now, updatedAt: now };
    if (index >= 0) payload.teams[index] = team; else payload.teams.push(team); this._write(payload, { type: 'team-saved', team }); return clone(team);
  }
  removeTeam(id) {
    const payload = this._read(); const before = payload.teams.length; payload.teams = payload.teams.filter(item => item.id !== id);
    this._write(payload, { type: 'team-removed', teamId: id }); return { success: before !== payload.teams.length };
  }

  _normalizeTarget(target) {
    const parsed = new URL(String(target));
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Route target must be an HTTP(S) origin');
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname); if (!loopback && parsed.protocol !== 'https:') throw new Error('Remote route targets require HTTPS');
    return parsed.origin;
  }

  _routeView(route, payload = this._read()) {
    if (route.kind !== 'api-flow') return clone(route);
    const namespace = this._apiNamespaces(payload).find(value => route.hostname.endsWith(`.${value}`) && route.hostname.split('.').length === value.split('.').length + 1) || '';
    const label = namespace ? route.hostname.slice(0, -(namespace.length + 1)) : '';
    return clone({ ...route, namespace, pathPrefix: label ? `/${label}` : '' });
  }

  listRoutes() { const payload = this._read(); return payload.routes.map(route => this._routeView(route, payload)); }
  saveRoute(input = {}) {
    const payload = this._read(); if (!payload.settings.panelDomain) throw new Error('Configure the panel domain first');
    const id = String(input.id || this._id('route')); const kind = String(input.kind || 'project');
    const hostname = String(input.hostname || this.hostname(kind, input.slug || input.name)).trim().toLowerCase();
    const direct = hostname.endsWith(`.${payload.settings.panelDomain}`) && hostname.split('.').length === payload.settings.panelDomain.split('.').length + 1;
    const apiNamespace = kind === 'api-flow' ? this._apiNamespaces(payload).find(namespace => hostname.endsWith(`.${namespace}`) && hostname.split('.').length === namespace.split('.').length + 1) : null;
    const validPlacement = kind === 'api-flow' ? Boolean(apiNamespace) : direct;
    if (!DOMAIN_PATTERN.test(hostname) || !validPlacement) throw new Error(kind === 'api-flow' ? 'API route must use one name below a synchronized Plesk API domain' : 'Route must use one direct subdomain of the panel domain');
    const target = this._normalizeTarget(input.target); const index = payload.routes.findIndex(route => route.id === id);
    if (payload.routes.some((route, routeIndex) => routeIndex !== index && route.hostname === hostname)) throw new Error('Hostname is already assigned');
    const now = new Date(this.now()).toISOString(); const route = { id, kind, resourceId: String(input.resourceId || '').slice(0, 120), hostname, target, websocket: input.websocket !== false, enabled: input.enabled !== false, authPolicy: ['public', 'session', 'token'].includes(input.authPolicy) ? input.authPolicy : 'session', ownerNodeId: String(input.ownerNodeId || '').slice(0, 120), createdAt: index >= 0 ? payload.routes[index].createdAt : now, updatedAt: now };
    if (index >= 0) payload.routes[index] = route; else payload.routes.push(route); this._write(payload, { type: 'route-saved', route }); return this._routeView(route, payload);
  }

  removeRoute(id) { const payload = this._read(); const before = payload.routes.length; payload.routes = payload.routes.filter(route => route.id !== id); this._write(payload, { type: 'route-removed', routeId: id }); return { success: before !== payload.routes.length }; }
  resolveRoute(host) { const hostname = String(host || '').toLowerCase().replace(/:\d+$/, ''); return clone(this._read().routes.find(route => route.enabled !== false && route.hostname === hostname) || null); }

  resolveApiFlowPathRoute(host, pathname) {
    const payload = this._read();
    const hostname = String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
    const namespace = this._apiNamespaces(payload).find(value => value === hostname);
    if (!namespace) return null;
    const match = String(pathname || '/').match(/^\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\/.*|$)/);
    if (!match) return null;
    const route = payload.routes.find(item => item.enabled !== false && item.kind === 'api-flow' && item.hostname === `${match[1]}.${namespace}`);
    if (!route) return null;
    return { ...this._routeView(route, payload), upstreamPath: match[2] || '/' };
  }

  createPairing(input = {}, principal = null) {
    const payload = this._read(); const kind = NODE_KINDS.has(input.kind) ? input.kind : 'desktop'; const code = `${crypto.randomBytes(3).toString('hex')}-${crypto.randomBytes(3).toString('hex')}`;
    const pairing = { id: this._id('pair'), codeHash: hash(code), kind, name: String(input.name || `New ${kind}`).slice(0, 100), requestedBy: principal?.userId || '', capabilities: [...new Set((input.capabilities || []).map(String))].slice(0, 100), createdAt: this.now(), expiresAt: this.now() + Math.max(60_000, Math.min(30 * 60_000, Number(input.ttlMs) || 10 * 60_000)), usedAt: null };
    payload.pairings.push(pairing); this._write(payload, { type: 'pairing-created', pairingId: pairing.id }); return { id: pairing.id, code, kind, name: pairing.name, expiresAt: pairing.expiresAt, panelDomain: payload.settings.panelDomain };
  }

  completePairing(code, input = {}) {
    const payload = this._read(); this._cleanup(payload); const pairing = payload.pairings.find(item => safeEqual(item.codeHash, hash(String(code).toLowerCase()))); if (!pairing) throw new Error('Pairing code is invalid or expired');
    const user = this.identityManager?.listUsers().find(item => item.id === pairing.requestedBy) || this.identityManager?.listUsers().find(item => item.roles.includes('owner')); if (!user) throw new Error('No owner account is available for device enrollment');
    const node = { id: this._id('node'), kind: pairing.kind, name: String(input.name || pairing.name).slice(0, 100), platform: String(input.platform || '').slice(0, 100), version: String(input.version || '').slice(0, 50), capabilities: [...new Set([...(pairing.capabilities || []), ...(input.capabilities || []).map(String)])].slice(0, 100), status: 'online', enrolledAt: this.now(), lastSeenAt: this.now(), address: String(input.address || '').slice(0, 255), inventory: {}, tokenId: '' };
    const token = this.identityManager.createToken({ userId: user.id, name: `${node.name} device`, kind: pairing.kind === 'plesk' ? 'plesk' : 'device', nodeId: node.id, permissions: ['nodes.read', 'projects.read', 'projects.sync', 'labs.read', 'labs.sync', 'api-flows.read', 'api-flows.sync', 'routes.read', 'deployments.read', 'deployments.update'], expiresAt: this.now() + 365 * 24 * 60 * 60 * 1000 });
    node.tokenId = token.id; payload.nodes.push(node); pairing.usedAt = this.now(); this._write(payload, { type: 'node-enrolled', node });
    return { success: true, node: clone(node), token: token.token, hub: { panelDomain: payload.settings.panelDomain, authMode: payload.settings.authMode } };
  }

  enrollPleskConnector(input = {}, signature = '') {
    const connectorId = String(input.connectorId || '').trim();
    const timestamp = Number(input.timestamp);
    const nonce = String(input.nonce || '').trim().toLowerCase();
    const device = input.device && typeof input.device === 'object' && !Array.isArray(input.device) ? input.device : {};
    if (!connectorId || connectorId.length > 160) throw new Error('Connector ID is invalid');
    if (!Number.isSafeInteger(timestamp) || Math.abs(this.now() - timestamp) > 120_000) throw new Error('Enrollment request expired');
    if (!/^[a-f0-9]{32}$/.test(nonce)) throw new Error('Enrollment nonce is invalid');

    const payload = this._read();
    const connector = payload.connectors.find(item => item.id === connectorId && this._connectorReady(item));
    if (!connector) throw new Error('Plesk connector is not configured');
    const secret = this.secretStore?.get(this._connectorSecretKey(connectorId));
    if (!secret) throw new Error('Plesk connector secret is unavailable');
    const replayKey = `plesk-enroll:${connectorId}:${nonce}`;
    if (this.assertionNonces.has(replayKey)) throw new Error('Enrollment request was already used');
    if (!safeEqual(hmac(secret, stable(input)), signature)) throw new Error('Enrollment signature is invalid');
    this.assertionNonces.set(replayKey, this.now() + 5 * 60_000);

    const user = this.identityManager?.listUsers().find(item => item.roles.includes('owner'))
      || this.identityManager?.listUsers().find(item => item.roles.includes('admin'));
    if (!user) throw new Error('No owner account is available for device enrollment');
    const capabilities = [...new Set((Array.isArray(device.capabilities) ? device.capabilities : []).map(String))].sort().slice(0, 100);
    const existing = payload.nodes.find(item => item.kind === 'plesk' && item.connectorId === connectorId);
    const node = {
      id: existing?.id || this._id('node'), connectorId, kind: 'plesk',
      name: String(device.name || connector.name || 'Plesk').slice(0, 100),
      platform: String(device.platform || '').slice(0, 100), version: String(device.version || '').slice(0, 50),
      capabilities, status: 'online', enrolledAt: existing?.enrolledAt || this.now(), lastSeenAt: this.now(),
      address: String(device.address || connector.baseUrl || '').slice(0, 255), inventory: existing?.inventory || {}, tokenId: ''
    };
    if (existing?.tokenId) this.identityManager?.revokeToken(existing.tokenId);
    const token = this.identityManager.createToken({
      userId: user.id, name: `${node.name} automatic Plesk bridge`, kind: 'plesk', nodeId: node.id,
      permissions: ['nodes.read', 'projects.read', 'projects.sync', 'labs.read', 'labs.sync', 'api-flows.read', 'api-flows.sync', 'routes.read', 'deployments.read', 'deployments.update'],
      expiresAt: this.now() + 365 * 24 * 60 * 60 * 1000
    });
    node.tokenId = token.id;
    if (existing) payload.nodes[payload.nodes.indexOf(existing)] = node; else payload.nodes.push(node);
    connector.status = 'connected'; connector.lastSeenAt = this.now(); connector.updatedAt = this.now();
    this._write(payload, { type: existing ? 'node-reenrolled' : 'node-enrolled', node });
    return { success: true, automatic: true, node: clone(node), token: token.token, hub: { panelDomain: payload.settings.panelDomain, authMode: payload.settings.authMode } };
  }

  touchConnectorNodes(connectorId) {
    const payload = this._read(); const now = this.now(); let touched = 0;
    for (const node of payload.nodes) {
      if (node.kind !== 'plesk' || node.connectorId !== connectorId) continue;
      node.status = 'online'; node.lastSeenAt = now; touched++;
    }
    if (touched) this._write(payload, { type: 'connector-heartbeat', connectorId, nodes: touched });
    return touched;
  }

  listNodes() { const payload = this._read(); this._cleanup(payload); this._write(payload); return clone(payload.nodes); }
  heartbeat(nodeId, input = {}) {
    const payload = this._read(); const node = payload.nodes.find(item => item.id === nodeId); if (!node) throw new Error('Node not found');
    node.status = 'online'; node.lastSeenAt = this.now(); node.version = String(input.version || node.version || '').slice(0, 50); node.address = String(input.address || node.address || '').slice(0, 255);
    if (input.inventory && typeof input.inventory === 'object') node.inventory = redact(input.inventory); if (Array.isArray(input.capabilities)) node.capabilities = [...new Set(input.capabilities.map(String))].slice(0, 100);
    this._write(payload, { type: 'node-heartbeat', nodeId }); return clone(node);
  }

  revokeNode(id) {
    const payload = this._read(); const node = payload.nodes.find(item => item.id === id); if (!node) return { success: false, error: 'Node not found' };
    if (node.tokenId) this.identityManager?.revokeToken(node.tokenId); payload.nodes = payload.nodes.filter(item => item.id !== id); payload.routes = payload.routes.filter(route => route.ownerNodeId !== id); this._write(payload, { type: 'node-revoked', nodeId: id }); return { success: true };
  }

  _normalizeObject(input) {
    const kind = String(input.kind || ''); if (!KINDS.has(kind)) throw new Error('Unsupported synchronized object kind');
    const resourceId = String(input.resourceId || input.id || ''); if (!resourceId || resourceId.length > 160) throw new Error('Synchronized object requires a resource id');
    const data = redact(clone(input.data || {})); const serialized = stable(data); if (Buffer.byteLength(serialized) > 5 * 1024 * 1024) throw new Error('Synchronized object exceeds 5 MB');
    return { kind, resourceId, data, contentHash: hash(serialized) };
  }

  publish(input = {}, principal = null) {
    const payload = this._read(); const normalized = this._normalizeObject(input); const objectId = `${normalized.kind}:${normalized.resourceId}`; const index = payload.objects.findIndex(item => item.id === objectId); const current = index >= 0 ? payload.objects[index] : null; const baseRevision = Number(input.baseRevision || 0);
    if (current?.contentHash === normalized.contentHash && !current.deletedAt) return { success: true, unchanged: true, object: this._publicObject(current) };
    if (current && baseRevision !== current.revision && input.force !== true) return { success: false, conflict: true, current: this._publicObject(current), incoming: { ...normalized, baseRevision }, diff: this.diffValues(current.data, normalized.data) };
    if (!current && baseRevision !== 0 && input.force !== true) return { success: false, conflict: true, current: null, incoming: { ...normalized, baseRevision }, diff: [] };
    const now = new Date(this.now()).toISOString(); const revision = (current?.revision || 0) + 1;
    const history = [...(current?.history || []), ...(current ? [{ revision: current.revision, contentHash: current.contentHash, data: current.data, updatedAt: current.updatedAt, updatedBy: current.updatedBy, sourceNodeId: current.sourceNodeId }] : [])].slice(-50);
    const object = { id: objectId, kind: normalized.kind, resourceId: normalized.resourceId, name: String(input.name || normalized.data.name || normalized.resourceId).slice(0, 120), revision, contentHash: normalized.contentHash, data: normalized.data, history, sourceNodeId: String(input.sourceNodeId || principal?.nodeId || 'local').slice(0, 120), targets: [...new Set((input.targets || []).map(String))].slice(0, 100), updatedBy: principal?.userId || principal?.username || 'system', createdAt: current?.createdAt || now, updatedAt: now, deletedAt: null };
    if (index >= 0) payload.objects[index] = object; else payload.objects.push(object); this._write(payload, { type: 'object-published', object: this._publicObject(object) }); return { success: true, object: this._publicObject(object) };
  }

  _publicObject(object, includeData = true) {
    const { history: _history, ...result } = object; if (!includeData) delete result.data; return clone(result);
  }

  inventory(filters = {}) {
    return this._read().objects.filter(item => (filters.deleted || !item.deletedAt) && (!filters.kind || item.kind === filters.kind) && (!filters.sourceNodeId || item.sourceNodeId === filters.sourceNodeId)).map(item => this._publicObject(item, filters.includeData !== false));
  }
  getObject(id) { const item = this._read().objects.find(object => object.id === id); if (!item) throw new Error('Synchronized object not found'); return this._publicObject(item); }
  history(id) { const item = this._read().objects.find(object => object.id === id); if (!item) throw new Error('Synchronized object not found'); return clone([...(item.history || []), { revision: item.revision, contentHash: item.contentHash, data: item.data, updatedAt: item.updatedAt, updatedBy: item.updatedBy, sourceNodeId: item.sourceNodeId }].reverse()); }

  rollback(id, revision, principal = null) {
    const payload = this._read(); const object = payload.objects.find(item => item.id === id); if (!object) throw new Error('Synchronized object not found'); const target = (object.history || []).find(item => item.revision === Number(revision)); if (!target) throw new Error('Revision not found');
    return this.publish({ kind: object.kind, resourceId: object.resourceId, name: object.name, data: target.data, baseRevision: object.revision, sourceNodeId: 'rollback' }, principal);
  }

  removeObject(id, baseRevision, principal = null) {
    const payload = this._read(); const object = payload.objects.find(item => item.id === id); if (!object) return { success: false, error: 'Synchronized object not found' }; if (Number(baseRevision) !== object.revision) return { success: false, conflict: true, current: this._publicObject(object) };
    object.history = [...(object.history || []), { revision: object.revision, contentHash: object.contentHash, data: object.data, updatedAt: object.updatedAt, updatedBy: object.updatedBy, sourceNodeId: object.sourceNodeId }].slice(-50); object.revision += 1; object.deletedAt = new Date(this.now()).toISOString(); object.updatedAt = object.deletedAt; object.updatedBy = principal?.userId || 'system'; this._write(payload, { type: 'object-removed', objectId: id }); return { success: true, object: this._publicObject(object) };
  }

  diffValues(left, right, base = '') {
    const changes = []; const walk = (a, b, pointer) => {
      if (stable(a) === stable(b)) return;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) { changes.push({ path: pointer || '/', before: clone(a), after: clone(b) }); return; }
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${pointer}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`);
    }; walk(left, right, base); return changes.slice(0, 1000);
  }

  async publishLocal(options = {}, principal = null) {
    const results = []; const kinds = new Set(options.kinds || ['project', 'lab', 'api-flow']); const nodeId = String(options.nodeId || 'local');
    if (kinds.has('project') && this.projectManager) for (const project of this.projectManager.list()) results.push(this.publish({ kind: 'project', resourceId: project.id, name: project.name, data: this.projectManager.exportManifest(project.id), baseRevision: this._revision('project', project.id), sourceNodeId: nodeId }, principal));
    if (kinds.has('lab') && this.labManager) for (const lab of this.labManager.list()) { const { output: _output, pid: _pid, ...definition } = lab; results.push(this.publish({ kind: 'lab', resourceId: lab.id, name: lab.name, data: definition, baseRevision: this._revision('lab', lab.id), sourceNodeId: nodeId }, principal)); }
    if (kinds.has('api-flow') && this.apiFlowManager) for (const flow of this.apiFlowManager.list()) { const { runtime: _runtime, running: _running, url: _url, ...definition } = flow; results.push(this.publish({ kind: 'api-flow', resourceId: flow.id, name: flow.name, data: definition, baseRevision: this._revision('api-flow', flow.id), sourceNodeId: nodeId }, principal)); }
    return { success: results.every(result => result.success), results };
  }

  _revision(kind, id) { return this._read().objects.find(item => item.id === `${kind}:${id}`)?.revision || 0; }

  async applyObject(id, options = {}) {
    const object = this.getObject(id); if (object.deletedAt) throw new Error('Cannot apply a deleted object');
    if (object.kind === 'project') return this.projectManager.importManifest(object.data, options);
    if (object.kind === 'lab') { const existing = this.labManager.list().find(item => item.id === object.resourceId || item.slug === object.data.slug); return existing ? this.labManager.update(existing.id, object.data, {}) : this.labManager.create({ ...object.data, id: undefined }, {}); }
    if (object.kind === 'api-flow') {
      const existing = this.apiFlowManager.list().find(item => item.id === object.resourceId || item.slug === object.data.slug); if (existing?.running) await this.apiFlowManager.stop(existing.id);
      return this.apiFlowManager.save({ ...object.data, id: existing?.id || object.data.id });
    }
    if (object.kind === 'environment') return this.environmentManager.apply(object.data, options);
    throw new Error(`Applying ${object.kind} is not supported on this node`);
  }

  createDeployment(input = {}, principal = null) {
    const payload = this._read(); const object = payload.objects.find(item => item.id === input.objectId && !item.deletedAt); if (!object) throw new Error('Synchronized object not found'); const node = payload.nodes.find(item => item.id === input.targetNodeId); if (!node) throw new Error('Target node not found');
    const approval = input.requiresApproval != null ? Boolean(input.requiresApproval) : Boolean(payload.settings.policies.requireDeploymentApproval); const now = this.now();
    const deployment = { id: this._id('dep'), objectId: object.id, objectRevision: object.revision, targetNodeId: node.id, strategy: ['replace', 'blue-green', 'canary', 'preview'].includes(input.strategy) ? input.strategy : 'replace', status: approval ? 'pending' : 'approved', requiresApproval: approval, createdBy: principal?.userId || 'system', approvedBy: approval ? '' : principal?.userId || 'system', createdAt: now, updatedAt: now, startedAt: null, completedAt: null, message: String(input.message || '').slice(0, 500), health: null, rollbackRevision: null };
    payload.deployments.unshift(deployment); this._write(payload, { type: 'deployment-created', deployment }); return clone(deployment);
  }

  listDeployments(filters = {}) { return clone(this._read().deployments.filter(item => (!filters.status || item.status === filters.status) && (!filters.targetNodeId || item.targetNodeId === filters.targetNodeId)).slice(0, 500)); }
  approveDeployment(id, principal = null) { return this._transitionDeployment(id, ['pending'], 'approved', { approvedBy: principal?.userId || 'system' }); }
  updateDeployment(id, input = {}) {
    const transitions = { approved: ['running', 'cancelled'], running: ['succeeded', 'failed', 'rolling-back'], failed: ['rolling-back'], 'rolling-back': ['rolled-back', 'failed'] };
    const payload = this._read(); const current = payload.deployments.find(item => item.id === id); if (!current) throw new Error('Deployment not found'); const next = String(input.status || current.status); if (next !== current.status && !(transitions[current.status] || []).includes(next)) throw new Error(`Invalid deployment transition ${current.status} -> ${next}`);
    current.status = next; current.updatedAt = this.now(); current.message = String(input.message || current.message || '').slice(0, 500); if (next === 'running') current.startedAt = this.now(); if (['succeeded', 'failed', 'rolled-back', 'cancelled'].includes(next)) current.completedAt = this.now(); if (input.health) current.health = redact(input.health); if (input.rollbackRevision) current.rollbackRevision = Number(input.rollbackRevision); this._write(payload, { type: 'deployment-updated', deployment: current }); return clone(current);
  }
  _transitionDeployment(id, from, status, patch = {}) { const payload = this._read(); const deployment = payload.deployments.find(item => item.id === id); if (!deployment) throw new Error('Deployment not found'); if (!from.includes(deployment.status)) throw new Error(`Deployment is ${deployment.status}`); Object.assign(deployment, patch, { status, updatedAt: this.now() }); this._write(payload, { type: 'deployment-updated', deployment }); return clone(deployment); }

  listConnectors() { return this._read().connectors.map(item => ({ ...clone(item), configured: Boolean(this.secretStore?.has(this._connectorSecretKey(item.id))) })); }
  saveConnector(input = {}, secret = '') {
    const payload = this._read(); const id = String(input.id || this._id('plesk')); const index = payload.connectors.findIndex(item => item.id === id); const baseUrl = new URL(String(input.baseUrl || ''));
    if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)) throw new Error('Plesk connector requires HTTPS'); const authMode = AUTH_MODES.has(input.authMode) ? input.authMode : 'hybrid';
    const connector = { id, name: String(input.name || baseUrl.hostname).slice(0, 100), baseUrl: baseUrl.origin, authMode, enabled: input.enabled !== false, autoProvisionUsers: input.autoProvisionUsers !== false, roleMap: { admin: 'admin', reseller: 'operator', customer: 'developer', user: 'viewer', ...(input.roleMap || {}) }, allowedDomains: [...new Set((input.allowedDomains || []).map(value => String(value).toLowerCase()).filter(value => DOMAIN_PATTERN.test(value)))].slice(0, 500), status: index >= 0 ? payload.connectors[index].status : 'configured', lastSeenAt: index >= 0 ? payload.connectors[index].lastSeenAt : null, createdAt: index >= 0 ? payload.connectors[index].createdAt : this.now(), updatedAt: this.now() };
    if (secret) this.secretStore?.set(this._connectorSecretKey(id), String(secret)); else if (index < 0) this.secretStore?.set(this._connectorSecretKey(id), crypto.randomBytes(32).toString('base64url'));
    if (index >= 0) payload.connectors[index] = connector; else payload.connectors.push(connector); this._write(payload, { type: 'connector-saved', connectorId: id }); return { ...clone(connector), sharedSecret: index < 0 ? this.secretStore?.get(this._connectorSecretKey(id)) : undefined };
  }

  removeConnector(id) { const payload = this._read(); const before = payload.connectors.length; payload.connectors = payload.connectors.filter(item => item.id !== id); this.secretStore?.remove(this._connectorSecretKey(id)); this._write(payload, { type: 'connector-removed', connectorId: id }); return { success: before !== payload.connectors.length }; }

  signPleskAssertion(connectorId, claims = {}) {
    const secret = this.secretStore?.get(this._connectorSecretKey(connectorId)); if (!secret) throw new Error('Connector secret is unavailable'); const now = this.now(); const payload = { ...claims, connectorId, iat: claims.iat || now, exp: claims.exp || now + 60_000, nonce: claims.nonce || crypto.randomBytes(16).toString('hex') }; const encoded = Buffer.from(stable(payload)).toString('base64url'); return { assertion: encoded, signature: hmac(secret, encoded) };
  }

  loginOptions() {
    const payload = this._read(); const authMode = AUTH_MODES.has(payload.settings.authMode) ? payload.settings.authMode : 'hybrid';
    const connector = payload.connectors.find(item => this._connectorReady(item));
    let pleskLoginUrl = '';
    if (authMode !== 'independent' && connector) {
      pleskLoginUrl = new URL('/modules/kitsuneserv-bridge/index.php/index/sso', connector.baseUrl).toString();
    }
    return { authMode, localEnabled: authMode !== 'plesk', pleskEnabled: authMode !== 'independent' && Boolean(connector), pleskLoginUrl };
  }

  allowsLocalPassword(username) {
    const payload = this._read(); const authMode = AUTH_MODES.has(payload.settings.authMode) ? payload.settings.authMode : 'hybrid';
    if (authMode === 'independent') return true;
    if (authMode === 'plesk') return false;
    const user = this.identityManager.findUserByUsername(username); if (!user) return false;
    const enabledIds = new Set(payload.connectors.filter(item => this._connectorReady(item)).map(item => item.id));
    return !this.identityManager.listExternalIdentities(user.id).some(identity => identity.provider === 'plesk' && enabledIds.has(identity.connectorId));
  }

  _connectorReady(connector) {
    return Boolean(connector && connector.enabled !== false && connector.authMode !== 'independent' && this.secretStore?.has(this._connectorSecretKey(connector.id)));
  }

  _resolvePleskUser(connector, claims = {}) {
    const subject = String(claims.subject || claims.clientId || ''); if (!subject || subject.length > 255) throw new Error('Plesk identity has no valid subject');
    let resolved = this.identityManager.resolveExternalIdentity('plesk', connector.id, subject);
    if (resolved) return resolved;
    if (!connector.autoProvisionUsers) throw new Error('Plesk user is not linked to KitsuneServ');

    const claimedUsername = String(claims.username || '').trim();
    let user = claimedUsername ? this.identityManager.findUserByUsername(claimedUsername) : null;
    if (!user) {
      const role = connector.roleMap[String(claims.role || 'user')] || 'viewer'; let username = slugify(claimedUsername || `plesk-${subject}`).replace(/-/g, '.').slice(0, 60); if (username.length < 2) username = `p.${subject}`;
      const existingNames = new Set(this.identityManager.listUsers().map(item => item.username.toLowerCase())); let suffix = 1; const base = username; while (existingNames.has(username.toLowerCase())) username = `${base}.${suffix++}`.slice(0, 64);
      user = this.identityManager.createUser({ username, displayName: claims.displayName || claimedUsername || username, email: claims.email || '', roles: [role], password: crypto.randomBytes(32).toString('base64url') });
    }
    this.identityManager.linkExternalIdentity({ provider: 'plesk', connectorId: connector.id, subject, userId: user.id, metadata: { username: claimedUsername, role: claims.role, domains: claims.domains || [] } });
    return this.identityManager.resolveExternalIdentity('plesk', connector.id, subject);
  }

  loginWithPlesk(assertion, signature, metadata = {}) {
    let claims; try { claims = JSON.parse(Buffer.from(String(assertion), 'base64url').toString('utf8')); } catch { throw new Error('Invalid Plesk assertion'); }
    const payload = this._read(); if (payload.settings.authMode === 'independent') throw new Error('Plesk authentication is disabled');
    const connector = payload.connectors.find(item => item.id === claims.connectorId && this._connectorReady(item)); if (!connector) throw new Error('Plesk authentication is disabled'); const secret = this.secretStore?.get(this._connectorSecretKey(connector.id)); if (!secret || !safeEqual(hmac(secret, assertion), signature)) throw new Error('Invalid Plesk assertion signature');
    const now = this.now(); if (!claims.nonce || claims.iat > now + 30_000 || claims.exp < now || claims.exp - claims.iat > 120_000 || this.assertionNonces.has(claims.nonce)) throw new Error('Plesk assertion is expired or was already used'); this.assertionNonces.set(claims.nonce, claims.exp);
    const resolved = this._resolvePleskUser(connector, claims);
    const session = this.identityManager.createSession(resolved.user.id, { ...metadata, provider: `plesk:${connector.id}` }); connector.lastSeenAt = now; connector.status = 'online'; this._write(payload, { type: 'plesk-login', connectorId: connector.id, userId: resolved.user.id }); return { success: true, ...session, user: resolved.user };
  }

  async authenticateWithPlesk(username, password, secondFactor = '', metadata = {}) {
    const payload = this._read();
    if (payload.settings.authMode === 'independent') return { success: false, accountExists: false, unavailable: false, disabled: true };
    const connectors = payload.connectors.filter(item => this._connectorReady(item));
    let unavailable = false;
    for (const connector of connectors) {
      const secret = this.secretStore?.get(this._connectorSecretKey(connector.id));
      const requestBody = { username: String(username || ''), password: String(password || ''), timestamp: this.now(), nonce: crypto.randomBytes(16).toString('hex') };
      const raw = JSON.stringify(requestBody); const signed = `${requestBody.timestamp}\n${requestBody.nonce}\n${hash(raw)}`;
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8_000); timeout.unref?.();
      try {
        const endpoint = new URL('/modules/kitsuneserv-bridge/public/auth.php', connector.baseUrl);
        const response = await this.fetch(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', 'content-type': 'application/json', 'x-kitsune-connector': connector.id, 'x-kitsune-signature': hmac(secret, signed) }, body: raw });
        const text = await response.text(); if (text.length > 64 * 1024) throw new Error('Plesk authentication response is too large');
        let result; try { result = JSON.parse(text); } catch { result = null; }
        if (!response.ok || !result || typeof result !== 'object') throw new Error(`Plesk authentication returned HTTP ${response.status}`);
        if (result.valid === true) {
          try {
            const resolved = this._resolvePleskUser(connector, result); const authentication = this.identityManager.authenticateExternal(resolved.user.id, secondFactor);
            if (!authentication.success) return { ...authentication, accountExists: true, provider: 'plesk' };
            const session = this.identityManager.createSession(resolved.user.id, { ...metadata, provider: `plesk-password:${connector.id}` });
            connector.lastSeenAt = this.now(); connector.status = 'online'; this._write(payload, { type: 'plesk-password-login', connectorId: connector.id, userId: resolved.user.id });
            return { success: true, accountExists: true, provider: 'plesk', ...session, user: resolved.user };
          } catch (error) {
            return { success: false, accountExists: true, unavailable: false, provider: 'plesk', error: error.message };
          }
        }
        connector.lastSeenAt = this.now(); connector.status = 'online'; this._write(payload, { type: 'plesk-password-check', connectorId: connector.id });
        if (result.accountExists === true) return { success: false, accountExists: true, unavailable: false, provider: 'plesk', error: 'Invalid username, password or authenticator code' };
      } catch {
        unavailable = true; connector.status = 'error'; this._write(payload, { type: 'connector-status', connectorId: connector.id, status: 'error' });
      } finally { clearTimeout(timeout); }
    }
    return { success: false, accountExists: false, unavailable };
  }

  listRemotes() { return this._read().remotes.map(item => ({ ...clone(item), configured: Boolean(this.secretStore?.has(this._remoteTokenKey(item.id))) })); }
  saveRemote(input = {}, token = '') {
    const payload = this._read(); const id = String(input.id || this._id('remote')); const index = payload.remotes.findIndex(item => item.id === id); const url = new URL(String(input.url || ''));
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Remote Hub requires HTTPS or loopback HTTP'); const fingerprint = String(input.certificateFingerprint || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase(); if (fingerprint && fingerprint.length !== 64) throw new Error('Certificate fingerprint must be a SHA-256 fingerprint'); const remote = { id, name: String(input.name || url.hostname).slice(0, 100), url: url.origin, certificateFingerprint: fingerprint, status: index >= 0 ? payload.remotes[index].status : 'unknown', lastCheckedAt: index >= 0 ? payload.remotes[index].lastCheckedAt : null, syncState: index >= 0 ? payload.remotes[index].syncState || {} : {}, createdAt: index >= 0 ? payload.remotes[index].createdAt : this.now(), updatedAt: this.now() };
    if (token) this.secretStore?.set(this._remoteTokenKey(id), String(token)); if (index >= 0) payload.remotes[index] = remote; else payload.remotes.push(remote); this._write(payload, { type: 'remote-saved', remoteId: id }); return clone(remote);
  }

  removeRemote(id) { const payload = this._read(); const before = payload.remotes.length; payload.remotes = payload.remotes.filter(item => item.id !== id); this.secretStore?.remove(this._remoteTokenKey(id)); this._write(payload, { type: 'remote-removed', remoteId: id }); return { success: before !== payload.remotes.length }; }
  async callRemote(id, endpoint, body = {}) {
    const payload = this._read(); const remote = payload.remotes.find(item => item.id === id); if (!remote) throw new Error('Remote Hub not found'); const token = this.secretStore?.get(this._remoteTokenKey(id)); if (!token) throw new Error('Remote Hub token is not configured');
    const url = `${remote.url}/api/${String(endpoint).replace(/^\/+/, '')}`; let response;
    if (remote.certificateFingerprint && url.startsWith('https:')) response = await this._pinnedRequest(url, token, body, remote.certificateFingerprint);
    else {
      const fetched = await this.fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const text = await fetched.text(); response = { ok: fetched.ok, status: fetched.status, text };
    }
    let result; try { result = response.text ? JSON.parse(response.text) : null; } catch { result = response.text; }
    remote.lastCheckedAt = this.now(); remote.status = response.ok ? 'online' : 'error'; this._write(payload, { type: 'remote-status', remoteId: id, status: remote.status }); if (!response.ok) throw new Error(result?.error || `Remote Hub returned HTTP ${response.status}`); return result;
  }

  _pinnedRequest(url, token, body, expectedFingerprint) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url); const request = https.request(parsed, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, rejectUnauthorized: true,
        checkServerIdentity: (hostname, certificate) => {
          const defaultError = tls.checkServerIdentity(hostname, certificate); if (defaultError) return defaultError;
          const actual = String(certificate.fingerprint256 || '').replace(/:/g, '').toLowerCase();
          if (!actual || !safeEqual(actual, expectedFingerprint)) return new Error('Remote Hub certificate fingerprint mismatch');
          return undefined;
        }
      }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 10 * 1024 * 1024) request.destroy(new Error('Remote Hub response exceeds 10 MB')); else chunks.push(chunk); });
        response.on('end', () => resolve({ ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, status: response.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
      });
      request.setTimeout(15_000, () => request.destroy(new Error('Remote Hub request timed out'))); request.on('error', reject); request.end(JSON.stringify(body));
    });
  }

  async pushToRemote(remoteId, options = {}, principal = null) {
    await this.publishLocal(options, principal); const objects = this.inventory({ includeData: true }).filter(item => !options.kinds || options.kinds.includes(item.kind)); const results = [];
    for (const object of objects) {
      const remote = this._read().remotes.find(item => item.id === remoteId); const known = remote?.syncState?.[object.id];
      const result = await this.callRemote(remoteId, 'hub/sync/publish', { input: { kind: object.kind, resourceId: object.resourceId, name: object.name, data: object.data, baseRevision: Number(options.baseRevisions?.[object.id] ?? known?.remoteRevision ?? 0), sourceNodeId: options.nodeId || 'desktop' } });
      results.push(result); if (result.success && result.object) this._recordRemoteSync(remoteId, object.id, result.object.revision, object.contentHash);
    }
    return { success: results.every(item => item.success), count: results.filter(item => item.success).length, conflicts: results.filter(item => item.conflict).length, results };
  }

  _recordRemoteSync(remoteId, objectId, remoteRevision, contentHash) {
    const payload = this._read(); const remote = payload.remotes.find(item => item.id === remoteId); if (!remote) return;
    remote.syncState ||= {}; remote.syncState[objectId] = { remoteRevision: Number(remoteRevision) || 0, contentHash, syncedAt: this.now() };
    const entries = Object.entries(remote.syncState).sort((a, b) => b[1].syncedAt - a[1].syncedAt).slice(0, 2000); remote.syncState = Object.fromEntries(entries); this._write(payload);
  }

  async pullFromRemote(remoteId, options = {}, principal = null) {
    const remoteObjects = await this.callRemote(remoteId, 'hub/inventory', { filters: { includeData: true } }); if (!Array.isArray(remoteObjects)) throw new Error('Remote Hub inventory is invalid');
    const remote = this._read().remotes.find(item => item.id === remoteId); const state = remote?.syncState || {}; const local = new Map(this.inventory({ includeData: true }).map(item => [item.id, item])); const results = [];
    for (const object of remoteObjects.filter(item => !options.kinds || options.kinds.includes(item.kind))) {
      const current = local.get(object.id); const known = state[object.id];
      if (current?.contentHash === object.contentHash) { this._recordRemoteSync(remoteId, object.id, object.revision, object.contentHash); results.push({ success: true, unchanged: true, objectId: object.id }); continue; }
      const diverged = current && (!known || (current.contentHash !== known.contentHash && object.contentHash !== known.contentHash));
      if (diverged && options.forceRemote !== true) { results.push({ success: false, conflict: true, objectId: object.id, local: current, remote: object, diff: this.diffValues(current.data, object.data) }); continue; }
      const published = this.publish({ kind: object.kind, resourceId: object.resourceId, name: object.name, data: object.data, baseRevision: current?.revision || 0, sourceNodeId: `remote:${remoteId}`, force: options.forceRemote === true }, principal);
      results.push(published); if (published.success) { this._recordRemoteSync(remoteId, object.id, object.revision, object.contentHash); if (options.apply) await this.applyObject(object.id, options.applyOptions || {}); }
    }
    return { success: results.every(item => item.success), count: results.filter(item => item.success).length, conflicts: results.filter(item => item.conflict).length, results };
  }

  async syncRemote(remoteId, options = {}, principal = null) {
    const pulled = await this.pullFromRemote(remoteId, options, principal); const pushed = await this.pushToRemote(remoteId, options, principal);
    return { success: pulled.success && pushed.success, pulled, pushed, conflicts: pulled.conflicts + pushed.conflicts };
  }

  reconcile() {
    const payload = this._read(); this._cleanup(payload); const routeHosts = new Set(); const issues = [];
    for (const route of payload.routes) { if (routeHosts.has(route.hostname)) issues.push({ type: 'duplicate-route', routeId: route.id, hostname: route.hostname }); routeHosts.add(route.hostname); if (route.ownerNodeId && !payload.nodes.some(node => node.id === route.ownerNodeId)) issues.push({ type: 'orphan-route', routeId: route.id, hostname: route.hostname }); }
    for (const node of payload.nodes) if (node.status !== 'online') issues.push({ type: 'offline-node', nodeId: node.id, name: node.name, lastSeenAt: node.lastSeenAt }); this._write(payload); return { success: issues.length === 0, issues, checkedAt: this.now() };
  }
}

HubManager.KINDS = KINDS;
HubManager.AUTH_MODES = AUTH_MODES;
HubManager.redact = redact;
module.exports = HubManager;
