'use strict';

const crypto = require('crypto');

const MAX_VALUE_SIZE = 1024 * 1024;
const BLOCK_TIMEOUT_MS = 30_000;

function getPath(source, rawPath) {
  if (!rawPath) return source;
  const parts = String(rawPath).replace(/\[([0-9]+|["'][^"']+["'])\]/g, (_match, key) => `.${String(key).replace(/["']/g, '')}`)
    .split('.').filter(Boolean);
  let value = source;
  for (const part of parts) {
    if (value == null || !Object.prototype.hasOwnProperty.call(Object(value), part)) return undefined;
    value = value[part];
  }
  return value;
}

function templateValue(value, context) {
  if (Array.isArray(value)) return value.map(item => templateValue(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, templateValue(item, context)]));
  if (typeof value !== 'string') return value;
  const exact = value.match(/^\{([^{}]+)\}$/);
  if (exact) return getPath(context, exact[1]);
  return value.replace(/\{([^{}]+)\}/g, (_match, key) => {
    const resolved = getPath(context, key);
    if (resolved == null) return '';
    return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved);
  });
}

function parseTemplate(value, context, fallback = undefined) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return templateValue(value, context);
  const source = value.trim();
  if ((source.startsWith('{') && source.endsWith('}')) || (source.startsWith('[') && source.endsWith(']'))) {
    try { return templateValue(JSON.parse(source), context); } catch {}
  }
  const rendered = templateValue(value, context);
  if (typeof rendered !== 'string') return rendered;
  const trimmed = rendered.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.parse(trimmed); } catch {}
  }
  return rendered;
}

function safeClone(value, depth = 0) {
  if (depth > 8) return '[depth limit]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeClone(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /secret|password|token|authorization|api[-_]?key/i.test(key) ? '[redacted]' : safeClone(item, depth + 1)]));
  return String(value);
}

function compareValues(left, operator, right) {
  switch (operator) {
    case 'not-equals': return left !== right;
    case 'contains': return Array.isArray(left) ? left.includes(right) : String(left ?? '').includes(String(right ?? ''));
    case 'not-contains': return !compareValues(left, 'contains', right);
    case 'starts-with': return String(left ?? '').startsWith(String(right ?? ''));
    case 'ends-with': return String(left ?? '').endsWith(String(right ?? ''));
    case 'greater': return Number(left) > Number(right);
    case 'greater-equal': return Number(left) >= Number(right);
    case 'less': return Number(left) < Number(right);
    case 'less-equal': return Number(left) <= Number(right);
    case 'exists': return left !== undefined && left !== null && left !== '';
    case 'empty': return left == null || left === '' || (Array.isArray(left) && left.length === 0) || (typeof left === 'object' && Object.keys(left).length === 0);
    case 'matches': {
      const pattern = String(right || '');
      if (pattern.length > 300) throw new Error('Regular expression is too long');
      return new RegExp(pattern).test(String(left ?? '').slice(0, 10000));
    }
    case 'equals':
    default: return left === right || String(left ?? '') === String(right ?? '');
  }
}

function rowsToObjects(result) {
  if (!Array.isArray(result?.columns) || !Array.isArray(result?.rows)) return result;
  return result.rows.map(row => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

function databaseLiteral(value, jsonMode) {
  if (jsonMode) return JSON.stringify(value === undefined ? null : value);
  if (value == null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function renderDatabaseQuery(template, context) {
  const raw = String(template || ''); const trimmed = raw.trim(); const jsonMode = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (jsonMode) {
    try { return JSON.stringify(templateValue(JSON.parse(trimmed), context)); } catch {}
  }
  const quoted = raw.replace(/(["'])\{([^{}]+)\}\1/g, (_match, _quote, key) => databaseLiteral(getPath(context, key), jsonMode));
  return quoted.replace(/\{([^{}]+)\}/g, (_match, key) => databaseLiteral(getPath(context, key), jsonMode));
}

class ApiFlowExecutor {
  constructor({ dbViewer = null, secretStore = null, fetchImpl = global.fetch, now = () => Date.now() } = {}) {
    this.dbViewer = dbViewer;
    this.secretStore = secretStore;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map();
    this.rateLimits = new Map();
  }

  _secret(projectId, endpointId, nodeId) {
    return this.secretStore?.get(`api-flow:${projectId}:${endpointId}:${nodeId}:secret`) || '';
  }

  _context(project, endpoint, request = {}) {
    const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [String(key).toLowerCase(), value]));
    return {
      body: request.body ?? {}, query: request.query || {}, header: headers, headers,
      params: request.params || {}, method: request.method || endpoint.method,
      path: request.path || endpoint.path, endpoint_id: endpoint.id,
      endpoint_name: endpoint.name, endpoint_method: endpoint.method,
      project_id: project.id, vars: {}, var: {}, steps: {}, last: null,
      request: { ip: request.ip || '127.0.0.1', receivedAt: new Date(this.now()).toISOString() },
      error: null
    };
  }

  async execute(project, endpoint, request = {}, options = {}) {
    const started = this.now();
    const nodes = new Map((endpoint.nodes || []).map(node => [node.id, node]));
    let node = [...nodes.values()].find(item => item.type === 'input');
    if (!node) throw new Error('Endpoint has no Input block');
    const context = this._context(project, endpoint, request);
    const trace = [];
    const visited = new Map();
    let response = null;
    const maxSteps = Math.max(1, Math.min(500, Number(options.maxSteps) || 200));

    for (let step = 0; node && step < maxSteps; step += 1) {
      const count = (visited.get(node.id) || 0) + 1;
      visited.set(node.id, count);
      if (count > 5) throw new Error(`Flow loop limit exceeded at block ${node.name || node.id}`);
      const blockStarted = this.now();
      context.current_block_id = node.id;
      try {
        const timeoutMs = Math.min(BLOCK_TIMEOUT_MS, Number(node.config?.timeoutMs) || BLOCK_TIMEOUT_MS);
        let timeout;
        const timeoutPromise = new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Block timed out')), timeoutMs); timeout.unref?.(); });
        let outcome;
        try { outcome = await Promise.race([this._runBlock(project, endpoint, node, context), timeoutPromise]); }
        finally { clearTimeout(timeout); }
        if (outcome && Object.prototype.hasOwnProperty.call(outcome, 'value')) {
          context.last = outcome.value;
          context.steps[node.id] = outcome.value;
          if (node.type === 'input') { context.vars.input = outcome.value; context.var.input = outcome.value; }
        }
        trace.push({ nodeId: node.id, type: node.type, name: node.name || node.type, success: true, durationMs: this.now() - blockStarted, output: node.type === 'secret' ? '[redacted]' : safeClone(context.steps[node.id]) });
        if (outcome?.response) { response = outcome.response; break; }
        const nextId = outcome?.nextId || node.next || null;
        node = nextId ? nodes.get(nextId) : null;
        if (nextId && !node) throw new Error(`Block points to missing node ${nextId}`);
      } catch (error) {
        context.error = { message: error.message, nodeId: node.id, type: node.type };
        trace.push({ nodeId: node.id, type: node.type, name: node.name || node.type, success: false, durationMs: this.now() - blockStarted, error: error.message });
        if (node.nextError && nodes.has(node.nextError)) { node = nodes.get(node.nextError); continue; }
        error.trace = trace;
        throw error;
      }
    }
    if (!response) throw new Error('Flow ended without an Output block');
    return { ...response, durationMs: this.now() - started, trace, context: options.includeContext ? safeClone(context) : undefined };
  }

  async _runBlock(project, endpoint, node, context) {
    const config = node.config || {};
    switch (node.type) {
      case 'input': return { value: { body: context.body, query: context.query, headers: context.headers, params: context.params } };
      case 'validate': return this._validateBlock(config, context);
      case 'auth': return this._authBlock(project, endpoint, node, config, context);
      case 'rate-limit': return this._rateLimitBlock(endpoint, node, config, context);
      case 'database-query': return this._databaseBlock(config, context);
      case 'http-request': return this._httpBlock(config, context);
      case 'webhook': return this._httpBlock({ ...config, method: config.method || 'POST' }, context);
      case 'set-variable': {
        const name = String(config.name || '').trim();
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name)) throw new Error('Invalid variable name');
        const value = parseTemplate(config.value, context, context.last);
        context.vars[name] = value; context.var[name] = value;
        return { value };
      }
      case 'transform': return { value: parseTemplate(config.template, context, context.last) };
      case 'pick': {
        const source = parseTemplate(config.source || '{last}', context, context.last) || {};
        const keys = String(config.keys || '').split(',').map(key => key.trim()).filter(Boolean);
        return { value: Object.fromEntries(keys.map(key => [key, getPath(source, key)])) };
      }
      case 'merge': {
        const values = parseTemplate(config.sources || [], context, []);
        const list = Array.isArray(values) ? values : [values];
        if (list.every(item => item && typeof item === 'object' && !Array.isArray(item))) return { value: Object.assign({}, ...list) };
        return { value: list.flat() };
      }
      case 'condition': {
        const left = parseTemplate(config.left || '{last}', context, context.last);
        const right = parseTemplate(config.right, context);
        const matched = compareValues(left, config.operator || 'equals', right);
        return { value: matched, nextId: matched ? node.nextTrue : node.nextFalse };
      }
      case 'switch': {
        const value = parseTemplate(config.value || '{last}', context, context.last);
        const cases = Array.isArray(config.cases) ? config.cases : parseTemplate(config.cases, context, []);
        const match = cases.find(item => compareValues(value, item.operator || 'equals', parseTemplate(item.value, context)));
        return { value, nextId: match?.next || node.nextFalse || node.next };
      }
      case 'filter': {
        const source = parseTemplate(config.source || '{last}', context, context.last);
        if (!Array.isArray(source)) throw new Error('Filter source must be an array');
        const value = source.filter((item, index) => {
          const local = { ...context, item, index };
          return compareValues(parseTemplate(config.left || '{item}', local), config.operator || 'equals', parseTemplate(config.right, local));
        });
        return { value };
      }
      case 'map': {
        const source = parseTemplate(config.source || '{last}', context, context.last);
        if (!Array.isArray(source)) throw new Error('Map source must be an array');
        if (source.length > 1000) throw new Error('Map source exceeds 1000 items');
        return { value: source.map((item, index) => parseTemplate(config.template || '{item}', { ...context, item, index })) };
      }
      case 'sort': {
        const source = parseTemplate(config.source || '{last}', context, context.last);
        if (!Array.isArray(source)) throw new Error('Sort source must be an array');
        const key = String(config.key || ''); const direction = config.direction === 'desc' ? -1 : 1;
        return { value: [...source].sort((a, b) => String(getPath(a, key) ?? a).localeCompare(String(getPath(b, key) ?? b), undefined, { numeric: true }) * direction) };
      }
      case 'paginate': {
        const source = parseTemplate(config.source || '{last}', context, context.last);
        if (!Array.isArray(source)) throw new Error('Pagination source must be an array');
        const page = Math.max(1, Number(parseTemplate(config.page || '{query.page}', context)) || 1);
        const pageSize = Math.max(1, Math.min(500, Number(parseTemplate(config.pageSize || '{query.limit}', context)) || 20));
        return { value: { items: source.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: source.length, pages: Math.ceil(source.length / pageSize) } };
      }
      case 'json-parse': {
        const raw = parseTemplate(config.value || '{last}', context, context.last);
        if (typeof raw !== 'string') return { value: raw };
        if (raw.length > MAX_VALUE_SIZE) throw new Error('JSON value is too large');
        return { value: JSON.parse(raw) };
      }
      case 'json-stringify': return { value: JSON.stringify(parseTemplate(config.value || '{last}', context, context.last), null, config.pretty ? 2 : 0) };
      case 'text-template': return { value: templateValue(String(config.template || ''), context) };
      case 'hash': {
        const algorithm = ['sha256', 'sha384', 'sha512'].includes(config.algorithm) ? config.algorithm : 'sha256';
        const input = String(parseTemplate(config.value || '{last}', context, context.last) ?? '');
        const secret = this._secret(project.id, endpoint.id, node.id);
        return { value: config.hmac ? crypto.createHmac(algorithm, secret).update(input).digest(config.encoding || 'hex') : crypto.createHash(algorithm).update(input).digest(config.encoding || 'hex') };
      }
      case 'base64': {
        const value = String(parseTemplate(config.value || '{last}', context, context.last) ?? '');
        return { value: config.mode === 'decode' ? Buffer.from(value, 'base64').toString('utf8') : Buffer.from(value, 'utf8').toString('base64') };
      }
      case 'uuid': return { value: crypto.randomUUID() };
      case 'timestamp': return { value: config.format === 'unix' ? Math.floor(this.now() / 1000) : new Date(this.now()).toISOString() };
      case 'delay': {
        const ms = Math.max(0, Math.min(5000, Number(parseTemplate(config.ms, context)) || 0));
        await new Promise(resolve => setTimeout(resolve, ms)); return { value: context.last };
      }
      case 'cache': return this._cacheBlock(endpoint, node, config, context);
      case 'secret': return { value: this._secret(project.id, endpoint.id, node.id) };
      case 'assert': {
        const value = parseTemplate(config.value || '{last}', context, context.last);
        if (!compareValues(value, config.operator || 'exists', parseTemplate(config.expected, context))) throw new Error(String(config.message || 'Assertion failed'));
        return { value };
      }
      case 'log': {
        const value = parseTemplate(config.value || '{last}', context, context.last);
        return { value, log: { level: config.level || 'info', message: safeClone(value) } };
      }
      case 'response-header': {
        context.vars.responseHeaders = { ...(context.vars.responseHeaders || {}), [String(config.name || 'X-Kitsune-Flow')]: String(parseTemplate(config.value, context) ?? '') };
        context.var.responseHeaders = context.vars.responseHeaders;
        return { value: context.last };
      }
      case 'output': {
        const status = Math.max(100, Math.min(599, Number(parseTemplate(config.status, context)) || 200));
        const configuredHeaders = parseTemplate(config.headers, context, {});
        const headers = { ...(context.vars.responseHeaders || {}), ...(configuredHeaders && typeof configuredHeaders === 'object' ? configuredHeaders : {}) };
        const body = config.body == null || config.body === '' ? context.last : parseTemplate(config.body, context);
        return { value: body, response: { status, headers, body } };
      }
      default: throw new Error(`Unsupported block type: ${node.type}`);
    }
  }

  _validateBlock(config, context) {
    const value = parseTemplate(config.value || '{body}', context, context.body);
    const rules = Array.isArray(config.rules) ? config.rules : parseTemplate(config.rules, context, []);
    const errors = [];
    for (const rule of rules || []) {
      const fieldValue = getPath(value, rule.field || '');
      const label = rule.field || 'value';
      if (rule.required && (fieldValue == null || fieldValue === '')) errors.push(`${label} is required`);
      if (fieldValue == null || fieldValue === '') continue;
      if (rule.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fieldValue))) errors.push(`${label} must be an email`);
      if (rule.type === 'number' && !Number.isFinite(Number(fieldValue))) errors.push(`${label} must be numeric`);
      if (rule.type === 'integer' && !Number.isInteger(Number(fieldValue))) errors.push(`${label} must be an integer`);
      if (rule.type === 'url') { try { new URL(String(fieldValue)); } catch { errors.push(`${label} must be a URL`); } }
      if (rule.min != null && (typeof fieldValue === 'number' ? fieldValue : String(fieldValue).length) < Number(rule.min)) errors.push(`${label} is below minimum`);
      if (rule.max != null && (typeof fieldValue === 'number' ? fieldValue : String(fieldValue).length) > Number(rule.max)) errors.push(`${label} exceeds maximum`);
      if (rule.pattern) {
        if (String(rule.pattern).length > 300) throw new Error('Validation pattern is too long');
        if (!new RegExp(rule.pattern).test(String(fieldValue).slice(0, 10000))) errors.push(`${label} has invalid format`);
      }
    }
    if (errors.length) { const error = new Error(errors.join('; ')); error.status = 422; throw error; }
    return { value };
  }

  _authBlock(project, endpoint, node, config, context) {
    const expected = this._secret(project.id, endpoint.id, node.id);
    if (!expected) throw new Error('Authentication secret is not configured');
    let supplied = '';
    if (config.mode === 'api-key') supplied = String(context.headers[String(config.header || 'x-api-key').toLowerCase()] || context.query[config.query || 'api_key'] || '');
    else if (config.mode === 'basic') supplied = String(context.headers.authorization || '').replace(/^Basic\s+/i, '');
    else supplied = String(context.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const normalizedExpected = config.mode === 'basic' ? Buffer.from(expected).toString('base64') : expected;
    const valid = supplied.length === normalizedExpected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(normalizedExpected));
    if (!valid) { const error = new Error('Unauthorized'); error.status = 401; throw error; }
    return { value: { authenticated: true } };
  }

  _rateLimitBlock(endpoint, node, config, context) {
    const windowMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(config.windowMs) || 60_000));
    const limit = Math.max(1, Math.min(100000, Number(config.limit) || 60));
    const identity = String(parseTemplate(config.key || '{request.ip}', context, context.request.ip));
    const key = `${endpoint.id}:${node.id}:${identity}`; const now = this.now();
    const hits = (this.rateLimits.get(key) || []).filter(time => now - time < windowMs);
    if (hits.length >= limit) { const error = new Error('Rate limit exceeded'); error.status = 429; throw error; }
    hits.push(now); this.rateLimits.set(key, hits);
    return { value: { remaining: limit - hits.length, resetAt: new Date(hits[0] + windowMs).toISOString() } };
  }

  async _databaseBlock(config, context) {
    if (!this.dbViewer) throw new Error('Database manager is unavailable');
    const connectionId = String(config.connectionId || '').trim();
    if (!connectionId) throw new Error('Choose a database connection');
    const query = renderDatabaseQuery(config.query || '', context);
    const result = await this.dbViewer.executeWorkbench(connectionId, String(templateValue(config.database || '', context)), query, {
      readOnly: config.readOnly !== false, transaction: Boolean(config.transaction), timeoutMs: Math.min(30_000, Number(config.timeoutMs) || 10_000), maxRows: Math.min(5000, Number(config.maxRows) || 500)
    });
    return { value: { ...result, objects: rowsToObjects(result) } };
  }

  async _httpBlock(config, context) {
    if (typeof this.fetch !== 'function') throw new Error('HTTP client is unavailable');
    const rawUrl = String(templateValue(config.url || '', context));
    let url; try { url = new URL(rawUrl); } catch { throw new Error('Invalid HTTP URL'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed');
    if (url.hostname === '169.254.169.254' || url.hostname.toLowerCase() === 'metadata.google.internal') throw new Error('Cloud metadata endpoints are blocked');
    const method = String(config.method || 'GET').toUpperCase();
    const headers = parseTemplate(config.headers, context, {});
    const bodyValue = parseTemplate(config.body, context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(30_000, Number(config.timeoutMs) || 10_000)));
    try {
      const response = await this.fetch(url, {
        method, headers: headers && typeof headers === 'object' ? headers : {}, redirect: 'manual', signal: controller.signal,
        body: ['GET', 'HEAD'].includes(method) || bodyValue == null ? undefined : (typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue))
      });
      const text = await response.text();
      if (text.length > MAX_VALUE_SIZE) throw new Error('HTTP response exceeds 1 MB');
      let data = text; try { data = JSON.parse(text); } catch {}
      if (config.failOnError !== false && !response.ok) { const error = new Error(`HTTP ${response.status}: ${String(text).slice(0, 300)}`); error.status = 502; throw error; }
      return { value: { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()), data } };
    } finally { clearTimeout(timer); }
  }

  _cacheBlock(endpoint, node, config, context) {
    const key = `${endpoint.id}:${String(parseTemplate(config.key || '{last}', context, context.last))}`;
    const now = this.now(); const existing = this.cache.get(key);
    if (config.mode === 'delete') { this.cache.delete(key); return { value: { deleted: Boolean(existing) } }; }
    if (config.mode === 'get') {
      if (!existing || existing.expiresAt <= now) { this.cache.delete(key); return { value: config.default ?? null, nextId: node.nextFalse || node.next } ; }
      return { value: existing.value, nextId: node.nextTrue || node.next };
    }
    const ttlMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(config.ttlMs) || 60_000));
    const value = parseTemplate(config.value || '{last}', context, context.last);
    this.cache.set(key, { value, expiresAt: now + ttlMs }); return { value };
  }
}

module.exports = { ApiFlowExecutor, templateValue, parseTemplate, getPath, safeClone, compareValues, renderDatabaseQuery };
