'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { ApiFlowExecutor, safeClone } = require('./api-flow-executor');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

const BLOCK_CATALOG = [
  { type: 'input', name: 'Input', icon: '⇥', group: 'Podstawowe', color: 'green', description: 'Punkt wejścia: body, query, nagłówki i parametry ścieżki.', fields: [] },
  { type: 'output', name: 'Output', icon: '⇤', group: 'Podstawowe', color: 'purple', description: 'Kończy przepływ i zwraca odpowiedź HTTP.', fields: [field('status', 'Status HTTP', 'number', { default: 200, min: 100, max: 599 }), field('body', 'Body / szablon JSON', 'code', { placeholder: '{last}' }), field('headers', 'Nagłówki JSON', 'json', { default: '{}' })] },
  { type: 'validate', name: 'Walidacja', icon: '✓', group: 'Bezpieczeństwo', color: 'blue', description: 'Waliduje pola wymagane, typy i ograniczenia.', fields: [field('value', 'Źródło', 'text', { default: '{body}' }), field('rules', 'Reguły JSON', 'json', { default: '[{"field":"email","required":true,"type":"email"}]' })] },
  { type: 'auth', name: 'Autoryzacja', icon: '🔐', group: 'Bezpieczeństwo', color: 'red', description: 'Bearer token, API key albo Basic Auth. Sekret jest szyfrowany.', fields: [field('mode', 'Tryb', 'select', { options: ['bearer', 'api-key', 'basic'], default: 'bearer' }), field('header', 'Nagłówek API key', 'text', { default: 'x-api-key' }), field('query', 'Parametr query', 'text', { default: 'api_key' }), field('secret', 'Sekret', 'secret')] },
  { type: 'rate-limit', name: 'Rate limit', icon: '⏱', group: 'Bezpieczeństwo', color: 'red', description: 'Ogranicza liczbę żądań dla IP, użytkownika lub klucza.', fields: [field('key', 'Klucz klienta', 'text', { default: '{request.ip}' }), field('limit', 'Limit', 'number', { default: 60 }), field('windowMs', 'Okno (ms)', 'number', { default: 60000 })] },
  { type: 'assert', name: 'Assert', icon: '!', group: 'Bezpieczeństwo', color: 'red', description: 'Przerywa przepływ, gdy warunek nie jest spełniony.', fields: [field('value', 'Wartość', 'text', { default: '{last}' }), field('operator', 'Operator', 'select', { options: ['exists', 'empty', 'equals', 'not-equals', 'contains', 'matches'], default: 'exists' }), field('expected', 'Oczekiwana wartość'), field('message', 'Komunikat błędu', 'text', { default: 'Assertion failed' })] },
  { type: 'database-query', name: 'Zapytanie do bazy', icon: 'DB', group: 'Dane', color: 'cyan', description: 'Wykonuje SQL lub operację MongoDB przez Database Manager.', fields: [field('connectionId', 'Połączenie', 'database'), field('database', 'Baza', 'text'), field('query', 'Zapytanie', 'code'), field('readOnly', 'Tylko odczyt', 'checkbox', { default: true }), field('transaction', 'Transakcja', 'checkbox'), field('maxRows', 'Maks. wierszy', 'number', { default: 500 }), field('timeoutMs', 'Timeout (ms)', 'number', { default: 10000 })] },
  { type: 'http-request', name: 'HTTP Request', icon: '↗', group: 'Integracje', color: 'orange', description: 'Wywołuje zewnętrzne API HTTP/HTTPS.', fields: [field('method', 'Metoda', 'select', { options: METHODS, default: 'GET' }), field('url', 'URL', 'text', { placeholder: 'https://api.example.com/users/{params.id}' }), field('headers', 'Nagłówki JSON', 'json', { default: '{}' }), field('body', 'Body / szablon JSON', 'code'), field('timeoutMs', 'Timeout (ms)', 'number', { default: 10000 }), field('failOnError', 'Błąd dla HTTP 4xx/5xx', 'checkbox', { default: true })] },
  { type: 'webhook', name: 'Webhook', icon: '⚡', group: 'Integracje', color: 'orange', description: 'Wysyła webhook, domyślnie metodą POST.', fields: [field('url', 'URL'), field('method', 'Metoda', 'select', { options: ['POST', 'PUT', 'PATCH'], default: 'POST' }), field('headers', 'Nagłówki JSON', 'json', { default: '{}' }), field('body', 'Body', 'code', { default: '{last}' })] },
  { type: 'set-variable', name: 'Ustaw zmienną', icon: 'x=', group: 'Dane', color: 'cyan', description: 'Zapisuje wartość jako {var.nazwa}.', fields: [field('name', 'Nazwa', 'text', { default: 'result' }), field('value', 'Wartość', 'code', { default: '{last}' })] },
  { type: 'transform', name: 'Transformacja JSON', icon: '{}', group: 'Transformacje', color: 'purple', description: 'Buduje nowy obiekt z danych poprzednich bloków.', fields: [field('template', 'Szablon JSON', 'code', { default: '{"data":"{last}"}' })] },
  { type: 'pick', name: 'Wybierz pola', icon: '⊙', group: 'Transformacje', color: 'purple', description: 'Zostawia tylko wskazane pola obiektu.', fields: [field('source', 'Źródło', 'text', { default: '{last}' }), field('keys', 'Pola po przecinku', 'text', { placeholder: 'id,name,email' })] },
  { type: 'merge', name: 'Połącz dane', icon: '∪', group: 'Transformacje', color: 'purple', description: 'Łączy obiekty lub tablice.', fields: [field('sources', 'Źródła JSON', 'json', { default: '["{steps.first}","{steps.second}"]' })] },
  { type: 'condition', name: 'Warunek', icon: '◇', group: 'Sterowanie', color: 'yellow', description: 'Rozdziela wykonanie na wyjście TAK i NIE.', outputs: ['true', 'false', 'error'], fields: [field('left', 'Lewa wartość', 'text', { default: '{last}' }), field('operator', 'Operator', 'select', { options: ['equals', 'not-equals', 'contains', 'not-contains', 'starts-with', 'ends-with', 'greater', 'greater-equal', 'less', 'less-equal', 'exists', 'empty', 'matches'], default: 'equals' }), field('right', 'Prawa wartość')] },
  { type: 'switch', name: 'Switch', icon: '⑂', group: 'Sterowanie', color: 'yellow', description: 'Wybiera gałąź spośród wielu przypadków.', outputs: ['cases', 'default', 'error'], fields: [field('value', 'Wartość', 'text', { default: '{last}' }), field('cases', 'Przypadki JSON', 'json', { default: '[{"value":"example"}]', help: 'Dodaj wartości; każdy przypadek dostanie osobny port na diagramie.' })] },
  { type: 'filter', name: 'Filtruj tablicę', icon: '▽', group: 'Kolekcje', color: 'green', description: 'Zostawia elementy spełniające warunek.', fields: [field('source', 'Tablica', 'text', { default: '{last}' }), field('left', 'Pole / wartość', 'text', { default: '{item}' }), field('operator', 'Operator', 'select', { options: ['equals', 'not-equals', 'contains', 'greater', 'less', 'exists'], default: 'equals' }), field('right', 'Porównaj z')] },
  { type: 'map', name: 'Mapuj tablicę', icon: '↦', group: 'Kolekcje', color: 'green', description: 'Przekształca każdy element tablicy szablonem.', fields: [field('source', 'Tablica', 'text', { default: '{last}' }), field('template', 'Szablon elementu', 'code', { default: '{item}' })] },
  { type: 'sort', name: 'Sortuj', icon: '↕', group: 'Kolekcje', color: 'green', description: 'Sortuje tablicę po wskazanym polu.', fields: [field('source', 'Tablica', 'text', { default: '{last}' }), field('key', 'Pole'), field('direction', 'Kierunek', 'select', { options: ['asc', 'desc'], default: 'asc' })] },
  { type: 'paginate', name: 'Paginacja', icon: '#', group: 'Kolekcje', color: 'green', description: 'Dzieli tablicę na strony i zwraca metadane.', fields: [field('source', 'Tablica', 'text', { default: '{last}' }), field('page', 'Numer strony', 'text', { default: '{query.page}' }), field('pageSize', 'Rozmiar strony', 'text', { default: '{query.limit}' })] },
  { type: 'cache', name: 'Cache', icon: '▣', group: 'Wydajność', color: 'blue', description: 'Pobiera, zapisuje lub usuwa wartość z pamięci TTL.', outputs: ['hit', 'miss', 'error'], fields: [field('mode', 'Operacja', 'select', { options: ['get', 'set', 'delete'], default: 'get' }), field('key', 'Klucz', 'text', { default: '{query.id}' }), field('value', 'Wartość', 'code', { default: '{last}' }), field('default', 'Wartość domyślna'), field('ttlMs', 'TTL (ms)', 'number', { default: 60000 })] },
  { type: 'json-parse', name: 'JSON Parse', icon: '{→', group: 'Formatowanie', color: 'blue', description: 'Zamienia tekst JSON na obiekt.', fields: [field('value', 'Wartość', 'text', { default: '{last}' })] },
  { type: 'json-stringify', name: 'JSON Stringify', icon: '→}', group: 'Formatowanie', color: 'blue', description: 'Zamienia wartość na tekst JSON.', fields: [field('value', 'Wartość', 'text', { default: '{last}' }), field('pretty', 'Czytelne formatowanie', 'checkbox')] },
  { type: 'text-template', name: 'Szablon tekstu', icon: 'T', group: 'Formatowanie', color: 'blue', description: 'Składa tekst z placeholderów.', fields: [field('template', 'Szablon', 'code', { default: 'Cześć {body.name}!' })] },
  { type: 'hash', name: 'Hash / HMAC', icon: '#', group: 'Narzędzia', color: 'red', description: 'Liczy SHA-256/384/512 lub podpis HMAC.', fields: [field('value', 'Wartość', 'text', { default: '{last}' }), field('algorithm', 'Algorytm', 'select', { options: ['sha256', 'sha384', 'sha512'], default: 'sha256' }), field('encoding', 'Format', 'select', { options: ['hex', 'base64'], default: 'hex' }), field('hmac', 'HMAC', 'checkbox'), field('secret', 'Sekret HMAC', 'secret')] },
  { type: 'base64', name: 'Base64', icon: '64', group: 'Narzędzia', color: 'blue', description: 'Koduje lub dekoduje Base64.', fields: [field('value', 'Wartość', 'text', { default: '{last}' }), field('mode', 'Tryb', 'select', { options: ['encode', 'decode'], default: 'encode' })] },
  { type: 'uuid', name: 'UUID', icon: 'ID', group: 'Narzędzia', color: 'cyan', description: 'Generuje bezpieczny identyfikator UUID v4.', fields: [] },
  { type: 'timestamp', name: 'Czas', icon: '◷', group: 'Narzędzia', color: 'cyan', description: 'Zwraca aktualny czas ISO albo Unix.', fields: [field('format', 'Format', 'select', { options: ['iso', 'unix'], default: 'iso' })] },
  { type: 'delay', name: 'Opóźnienie', icon: '…', group: 'Sterowanie', color: 'yellow', description: 'Czeka maksymalnie 5 sekund.', fields: [field('ms', 'Milisekundy', 'number', { default: 250, max: 5000 })] },
  { type: 'secret', name: 'Sekret', icon: '●', group: 'Bezpieczeństwo', color: 'red', description: 'Udostępnia zaszyfrowany sekret następnym blokom.', fields: [field('secret', 'Wartość sekretu', 'secret')] },
  { type: 'log', name: 'Log', icon: '☰', group: 'Diagnostyka', color: 'gray', description: 'Dodaje kontrolny krok do śladu wykonania.', fields: [field('level', 'Poziom', 'select', { options: ['debug', 'info', 'warn', 'error'], default: 'info' }), field('value', 'Wartość', 'code', { default: '{last}' })] },
  { type: 'response-header', name: 'Nagłówek odpowiedzi', icon: 'H', group: 'Podstawowe', color: 'purple', description: 'Dodaje nagłówek HTTP do końcowej odpowiedzi.', fields: [field('name', 'Nazwa', 'text', { default: 'X-Kitsune-Flow' }), field('value', 'Wartość', 'text', { default: 'active' })] }
];

const CATALOG_MAP = new Map(BLOCK_CATALOG.map(item => [item.type, item]));
const BLOCK_RESULTS = {
  input: { description: 'Odczytane żądanie HTTP.', fields: ['body', 'query', 'headers', 'params'] },
  output: { description: 'Body końcowej odpowiedzi HTTP.', fields: [] },
  validate: { description: 'Sprawdzona wartość źródłowa.', fields: [] },
  auth: { description: 'Potwierdzenie autoryzacji.', fields: ['authenticated'] },
  'rate-limit': { description: 'Pozostały limit i czas resetu.', fields: ['remaining', 'resetAt'] },
  'database-query': { description: 'Pełny wynik zapytania oraz wiersze jako obiekty.', fields: ['objects', 'columns', 'rows'] },
  'http-request': { description: 'Odpowiedź wywołanego API.', fields: ['data', 'status', 'ok', 'headers'] },
  webhook: { description: 'Odpowiedź serwera webhooka.', fields: ['data', 'status', 'ok', 'headers'] },
  'set-variable': { description: 'Zapisana wartość; dodatkowo dostępna pod nazwą zmiennej.', fields: [] },
  condition: { description: 'Wynik warunku true albo false.', fields: [] },
  paginate: { description: 'Bieżąca strona wraz z metadanymi.', fields: ['items', 'page', 'pageSize', 'total', 'pages'] },
  cache: { description: 'Wartość cache albo informacja o usunięciu.', fields: [] },
  'response-header': { description: 'Niezmieniony ostatni wynik; nagłówek trafia do odpowiedzi HTTP.', fields: [] },
  secret: { description: 'Wartość tajna (ukrywana w śladzie wykonania).', fields: [] }
};

function slugify(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function normalizeBasePath(value) {
  const clean = `/${String(value || 'api').replace(/^\/+|\/+$/g, '')}`;
  if (!/^\/[A-Za-z0-9/_-]*$/.test(clean)) throw new Error('Invalid API base path');
  return clean === '/' ? '' : clean;
}

function normalizeEndpointPath(value) {
  let clean = `/${String(value || '').replace(/^\/+|\/+$/g, '')}`;
  if (clean.length > 300 || !/^\/(?:[A-Za-z0-9._~-]+|:[A-Za-z_][A-Za-z0-9_]*)(?:\/(?:[A-Za-z0-9._~-]+|:[A-Za-z_][A-Za-z0-9_]*))*$/.test(clean)) throw new Error(`Invalid endpoint path: ${clean}`);
  return clean;
}

function routeMatch(pattern, pathname) {
  const expected = pattern.split('/').filter(Boolean); const actual = pathname.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;
  const params = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index].startsWith(':')) params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    else if (expected[index] !== actual[index]) return null;
  }
  return params;
}

class ApiFlowManager {
  constructor(appRoot, dependencies = {}) {
    this.appRoot = path.resolve(appRoot);
    this.configDir = path.join(this.appRoot, 'config');
    this.storePath = path.join(this.configDir, 'api-flows.json');
    this.logsPath = path.join(this.configDir, 'api-flow-logs.json');
    this.dbViewer = dependencies.dbViewer || null;
    this.secretStore = dependencies.secretStore || null;
    this.fetch = dependencies.fetchImpl || global.fetch;
    this.executor = dependencies.executor || new ApiFlowExecutor({ dbViewer: this.dbViewer, secretStore: this.secretStore, fetchImpl: this.fetch });
    this.servers = new Map();
    this.debugRequests = new Map();
    this.onChanged = null;
  }

  catalog() {
    return structuredClone(BLOCK_CATALOG.map(block => ({
      ...block,
      result: BLOCK_RESULTS[block.type] || { description: 'Wartość zwracana przez ten blok.', fields: [] }
    })));
  }

  _read() {
    try {
      const payload = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      return { schemaVersion: 1, projects: Array.isArray(payload.projects) ? payload.projects : [] };
    } catch { return { schemaVersion: 1, projects: [] }; }
  }

  _write(projects) {
    fs.mkdirSync(this.configDir, { recursive: true });
    const temp = `${this.storePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ schemaVersion: 1, projects }, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.storePath); }
    catch (error) { if (!['EEXIST', 'EPERM'].includes(error.code)) throw error; fs.copyFileSync(temp, this.storePath); fs.unlinkSync(temp); }
  }

  _readLogs() {
    try { const data = JSON.parse(fs.readFileSync(this.logsPath, 'utf8')); return Array.isArray(data.logs) ? data.logs : []; } catch { return []; }
  }

  _writeLogs(logs) {
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(this.logsPath, JSON.stringify({ schemaVersion: 1, logs: logs.slice(0, 500) }, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  _log(entry) {
    const log = { id: crypto.randomUUID(), at: new Date().toISOString(), ...safeClone(entry) };
    this._writeLogs([log, ...this._readLogs()].slice(0, 500));
    const runtime = this.servers.get(entry.projectId);
    if (runtime && entry.source === 'http') {
      runtime.requestCount += 1;
      if (entry.success === false || Number(entry.status) >= 400) runtime.errorCount += 1;
      runtime.lastRequestAt = log.at; runtime.lastStatus = Number(entry.status) || 0; runtime.lastDurationMs = Number(entry.durationMs) || 0;
    }
    try { this.onChanged?.({ type: 'request', projectId: log.projectId, log }); } catch {}
    return log;
  }

  logs(projectId, limit = 100) { return this._readLogs().filter(item => !projectId || item.projectId === projectId).slice(0, Math.max(1, Math.min(500, Number(limit) || 100))); }
  clearLogs(projectId) { const logs = projectId ? this._readLogs().filter(item => item.projectId !== projectId) : []; this._writeLogs(logs); return { success: true }; }

  list() { return this._read().projects.map(project => this._public(project)); }

  get(id) {
    const project = this._read().projects.find(item => item.id === id);
    if (!project) throw new Error('API Flow project not found');
    return this._public(project);
  }

  _public(project) {
    const runtime = this.servers.get(project.id);
    return structuredClone({
      ...project, running: Boolean(runtime), url: runtime ? `http://${project.host}:${project.port}${project.basePath}` : null,
      runtime: runtime ? {
        startedAt: runtime.startedAt, uptimeMs: Math.max(0, Date.now() - Date.parse(runtime.startedAt)),
        requestCount: runtime.requestCount, errorCount: runtime.errorCount,
        lastRequestAt: runtime.lastRequestAt, lastStatus: runtime.lastStatus, lastDurationMs: runtime.lastDurationMs
      } : null
    });
  }

  _normalizeNode(raw, previous = null) {
    const type = String(raw?.type || '');
    if (!CATALOG_MAP.has(type)) throw new Error(`Unknown block type: ${type}`);
    const id = String(raw.id || previous?.id || `node-${crypto.randomUUID()}`);
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) throw new Error('Invalid block id');
    const config = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? structuredClone(raw.config) : {};
    return {
      id, type, name: String(raw.name || CATALOG_MAP.get(type).name).slice(0, 100),
      x: Math.max(0, Math.min(5000, Number(raw.x) || 0)), y: Math.max(0, Math.min(5000, Number(raw.y) || 0)), config,
      next: raw.next || null, nextTrue: raw.nextTrue || null, nextFalse: raw.nextFalse || null, nextError: raw.nextError || null
    };
  }

  _normalizeEndpoint(raw, previous = null) {
    const id = String(raw.id || previous?.id || `endpoint-${crypto.randomUUID()}`);
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) throw new Error('Invalid endpoint id');
    const method = String(raw.method || previous?.method || 'GET').toUpperCase();
    if (!METHODS.includes(method)) throw new Error(`Unsupported HTTP method: ${method}`);
    const nodes = (Array.isArray(raw.nodes) ? raw.nodes : previous?.nodes || []).map(node => this._normalizeNode(node));
    return { id, name: String(raw.name || previous?.name || 'Endpoint').trim().slice(0, 100), method, path: normalizeEndpointPath(raw.path || previous?.path || '/hello'), enabled: raw.enabled !== false, nodes };
  }

  _normalizeProject(input, previous = null) {
    const id = String(input.id || previous?.id || `flow-${crypto.randomUUID()}`);
    if (!/^[A-Za-z0-9_-]{2,100}$/.test(id)) throw new Error('Invalid API project id');
    const name = String(input.name || previous?.name || 'Nowe API').trim().slice(0, 100);
    if (!name) throw new Error('API project name is required');
    const port = Number(input.port ?? previous?.port ?? 9393);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('API port must be between 1024 and 65535');
    const host = String(input.host || previous?.host || '127.0.0.1');
    if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('API host must be 127.0.0.1 or 0.0.0.0');
    const endpoints = (Array.isArray(input.endpoints) ? input.endpoints : previous?.endpoints || []).map(endpoint => this._normalizeEndpoint(endpoint));
    return {
      id, name, slug: slugify(input.slug || previous?.slug || name) || id.slice(0, 20), port, host,
      basePath: normalizeBasePath(input.basePath ?? previous?.basePath ?? '/api'), cors: input.cors !== false,
      endpoints, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }

  validate(input) {
    try {
      const previous = input?.id ? this._read().projects.find(item => item.id === input.id) : null;
      const project = this._normalizeProject(input || {}, previous);
      const errors = []; const warnings = [];
      if (!project.endpoints.length) errors.push('Dodaj co najmniej jeden endpoint');
      if (project.host === '0.0.0.0' && project.endpoints.some(endpoint => !endpoint.nodes.some(node => node.type === 'auth'))) warnings.push('API jest dostępne w sieci LAN, a część endpointów nie ma bloku Autoryzacja');
      const routeKeys = new Set();
      for (const endpoint of project.endpoints) {
        const routeKey = `${endpoint.method} ${endpoint.path}`;
        if (routeKeys.has(routeKey)) errors.push(`Powielona trasa ${routeKey}`); routeKeys.add(routeKey);
        const ids = new Set(endpoint.nodes.map(node => node.id));
        if (ids.size !== endpoint.nodes.length) errors.push(`${endpoint.name}: identyfikatory bloków muszą być unikalne`);
        if (endpoint.nodes.length > 150) errors.push(`${endpoint.name}: maksymalnie 150 bloków`);
        const inputs = endpoint.nodes.filter(node => node.type === 'input');
        const outputs = endpoint.nodes.filter(node => node.type === 'output');
        if (inputs.length !== 1) errors.push(`${endpoint.name}: wymagany jest dokładnie jeden blok Input`);
        if (!outputs.length) errors.push(`${endpoint.name}: wymagany jest co najmniej jeden blok Output`);
        const switchLinks = node => {
          if (node.type !== 'switch') return [];
          const cases = Array.isArray(node.config.cases) ? node.config.cases : (() => { try { return JSON.parse(node.config.cases || '[]'); } catch { return []; } })();
          return cases.map(item => item?.next).filter(Boolean);
        };
        const nodeLinks = node => [node.next, node.nextTrue, node.nextFalse, node.nextError, ...switchLinks(node)].filter(Boolean);
        for (const node of endpoint.nodes) {
          const links = nodeLinks(node);
          for (const next of links) if (!ids.has(next)) errors.push(`${endpoint.name}: blok ${node.name} wskazuje nieistniejący blok`);
          if (node.type === 'condition' && (!node.nextTrue || !node.nextFalse)) errors.push(`${endpoint.name}: warunek ${node.name} wymaga wyjścia TAK i NIE`);
          else if (node.type === 'cache' && node.config.mode === 'get' && (!node.nextTrue || !node.nextFalse)) errors.push(`${endpoint.name}: Cache w trybie get wymaga wyjścia HIT i MISS`);
          else if (node.type === 'switch' && (!switchLinks(node).length || !node.nextFalse)) errors.push(`${endpoint.name}: Switch wymaga co najmniej jednego podłączonego przypadku i wyjścia domyślnego`);
          else if (node.type !== 'output' && node.type !== 'switch' && node.type !== 'condition' && !(node.type === 'cache' && node.config.mode === 'get') && !node.next) warnings.push(`${endpoint.name}: blok ${node.name} nie ma zwykłego wyjścia`);
          if (node.type === 'database-query' && node.config.readOnly === false) warnings.push(`${endpoint.name}: zapytanie do bazy ma włączony zapis`);
          if (node.type === 'database-query' && (!node.config.connectionId || !String(node.config.query || '').trim())) errors.push(`${endpoint.name}: blok ${node.name} wymaga połączenia i zapytania`);
          if ((node.type === 'http-request' || node.type === 'webhook') && !node.config.url) errors.push(`${endpoint.name}: blok ${node.name} wymaga URL`);
          if (['auth', 'secret'].includes(node.type) && !node.config.hasSecret && !node.config.secret) errors.push(`${endpoint.name}: blok ${node.name} wymaga sekretu`);
          if (node.type === 'hash' && node.config.hmac && !node.config.hasSecret && !node.config.secret) errors.push(`${endpoint.name}: blok ${node.name} wymaga sekretu HMAC`);
          if (node.type === 'set-variable' && !/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(String(node.config.name || ''))) errors.push(`${endpoint.name}: blok ${node.name} ma niepoprawną nazwę zmiennej`);
        }
        if (inputs.length === 1) {
          const visiting = new Set(); const visited = new Set(); let cycle = false;
          const walk = id => {
            if (!id || cycle || !ids.has(id)) return;
            if (visiting.has(id)) { cycle = true; return; }
            if (visited.has(id)) return;
            visiting.add(id); const node = endpoint.nodes.find(item => item.id === id);
            nodeLinks(node).forEach(walk);
            visiting.delete(id); visited.add(id);
          };
          walk(inputs[0].id);
          if (cycle) errors.push(`${endpoint.name}: graf zawiera cykl; użyj bloku Map dla kolekcji`);
          const unreachable = endpoint.nodes.filter(node => !visited.has(node.id));
          if (unreachable.length) warnings.push(`${endpoint.name}: ${unreachable.length} niepodłączonych bloków`);
          if (!outputs.some(node => visited.has(node.id))) errors.push(`${endpoint.name}: żaden Output nie jest osiągalny z Input`);
          const byId = new Map(endpoint.nodes.map(node => [node.id, node]));
          const terminates = (id, stack = new Set()) => {
            const current = byId.get(id); if (!current || stack.has(id)) return false;
            if (current.type === 'output') return true;
            const normalLinks = current.type === 'condition' ? [current.nextTrue, current.nextFalse]
              : current.type === 'cache' && current.config.mode === 'get' ? [current.nextTrue, current.nextFalse]
                : current.type === 'switch' ? [...switchLinks(current), current.nextFalse] : [current.next];
            const required = normalLinks.filter(Boolean); if (!required.length) return false;
            const nextStack = new Set(stack).add(id);
            if (!required.every(next => terminates(next, nextStack))) return false;
            return !current.nextError || terminates(current.nextError, nextStack);
          };
          if (!cycle && !terminates(inputs[0].id)) errors.push(`${endpoint.name}: każda normalna i podłączona błędna gałąź musi kończyć się blokiem Output`);
        }
      }
      return { valid: errors.length === 0, errors, warnings, project };
    } catch (error) { return { valid: false, errors: [error.message], warnings: [] }; }
  }

  _persistSecrets(project, rawInput) {
    const rawEndpoints = new Map((rawInput.endpoints || []).map(endpoint => [endpoint.id, endpoint]));
    for (const endpoint of project.endpoints) {
      const rawNodes = new Map((rawEndpoints.get(endpoint.id)?.nodes || []).map(node => [node.id, node]));
      for (const node of endpoint.nodes) {
        const rawConfig = rawNodes.get(node.id)?.config || {};
        const key = `api-flow:${project.id}:${endpoint.id}:${node.id}:secret`;
        if (typeof rawConfig.secret === 'string' && rawConfig.secret) this.secretStore?.set(key, rawConfig.secret);
        if (rawConfig.clearSecret) this.secretStore?.remove(key);
        delete node.config.secret; delete node.config.clearSecret;
        node.config.hasSecret = Boolean(this.secretStore?.has(key));
      }
    }
  }

  save(input) {
    const validation = this.validate(input);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const payload = this._read(); const index = payload.projects.findIndex(item => item.id === validation.project.id);
    this._persistSecrets(validation.project, input || {});
    if (index >= 0) {
      if (this.servers.has(validation.project.id)) throw new Error('Stop the API server before changing its flow');
      payload.projects[index] = validation.project;
    } else payload.projects.unshift(validation.project);
    this._write(payload.projects);
    try { this.onChanged?.({ type: 'saved', projectId: validation.project.id }); } catch {}
    return { success: true, project: this._public(validation.project), warnings: validation.warnings };
  }

  async remove(id) {
    await this.stop(id);
    const payload = this._read(); const project = payload.projects.find(item => item.id === id);
    payload.projects = payload.projects.filter(item => item.id !== id); this._write(payload.projects);
    for (const endpoint of project?.endpoints || []) for (const node of endpoint.nodes || []) this.secretStore?.remove(`api-flow:${id}:${endpoint.id}:${node.id}:secret`);
    this.clearLogs(id); try { this.onChanged?.({ type: 'removed', projectId: id }); } catch {}
    return { success: true };
  }

  status(id) {
    if (id) { const project = this.get(id); return { projectId: id, running: project.running, url: project.url, host: project.host, port: project.port, basePath: project.basePath, endpointCount: project.endpoints.length, runtime: project.runtime }; }
    return this.list().map(project => ({ projectId: project.id, running: project.running, url: project.url, endpointCount: project.endpoints.length, runtime: project.runtime }));
  }

  async start(id) {
    if (this.servers.has(id)) return { success: true, ...this.status(id) };
    const project = this.get(id); const validation = this.validate(project);
    if (!validation.valid) throw new Error(validation.errors.join('; '));
    const server = http.createServer((request, response) => this._serve(project, request, response).catch(error => this._sendError(response, error)));
    server.requestTimeout = 35_000; server.headersTimeout = 10_000;
    await new Promise((resolve, reject) => {
      const onError = error => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError); server.once('listening', onListening); server.listen(project.port, project.host);
    });
    this.servers.set(id, { server, startedAt: new Date().toISOString(), requestCount: 0, errorCount: 0, lastRequestAt: null, lastStatus: 0, lastDurationMs: 0 });
    try { this.onChanged?.({ type: 'started', projectId: id, url: this.get(id).url }); } catch {}
    return { success: true, ...this.status(id) };
  }

  async stop(id) {
    const runtime = this.servers.get(id);
    if (!runtime) return { success: true, running: false, projectId: id };
    this.servers.delete(id);
    await new Promise(resolve => {
      const force = setTimeout(() => runtime.server.closeAllConnections?.(), 750); force.unref?.();
      runtime.server.close(() => { clearTimeout(force); resolve(); });
    });
    try { this.onChanged?.({ type: 'stopped', projectId: id }); } catch {}
    return { success: true, running: false, projectId: id };
  }

  async stopAll() { await Promise.all([...this.servers.keys()].map(id => this.stop(id))); return { success: true }; }

  async test(projectId, endpointId, request = {}) {
    const project = this.get(projectId); const endpoint = project.endpoints.find(item => item.id === endpointId);
    if (!endpoint) throw new Error('Endpoint not found');
    const started = Date.now();
    try {
      const result = await this.executor.execute(project, endpoint, { method: endpoint.method, path: endpoint.path, ...request }, { includeContext: true });
      this._log({ projectId, endpointId, method: endpoint.method, path: endpoint.path, status: result.status, durationMs: Date.now() - started, source: 'tester', success: true });
      return { success: true, ...result };
    } catch (error) {
      this._log({ projectId, endpointId, method: endpoint.method, path: endpoint.path, status: error.status || 500, durationMs: Date.now() - started, source: 'tester', success: false, error: error.message });
      return { success: false, status: error.status || 500, error: error.message, trace: error.trace || [], durationMs: Date.now() - started };
    }
  }

  async request(projectId, endpointId, request = {}) {
    if (!this.servers.has(projectId)) throw new Error('API server is not running');
    if (typeof this.fetch !== 'function') throw new Error('REST client is unavailable');
    const project = this.get(projectId); const endpoint = project.endpoints.find(item => item.id === endpointId);
    if (!endpoint || !endpoint.enabled) throw new Error('Enabled endpoint not found');
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    const endpointPath = endpoint.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key) => {
      if (params[key] == null || params[key] === '') throw new Error(`Missing path parameter: ${key}`);
      return encodeURIComponent(String(params[key]));
    });
    const target = new URL(`${project.url}${endpointPath}`);
    for (const [key, value] of Object.entries(request.query || {})) {
      if (Array.isArray(value)) value.forEach(item => target.searchParams.append(key, String(item)));
      else if (value != null) target.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([key, value]) => [String(key), String(value)]));
    const debugId = crypto.randomUUID(); this.debugRequests.set(debugId, { createdAt: Date.now(), result: null }); headers['x-kitsune-flow-debug'] = debugId;
    const hasBody = !['GET', 'HEAD'].includes(endpoint.method) && request.body != null;
    let body = hasBody ? request.body : undefined;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    }
    const started = Date.now();
    try {
      const response = await this.fetch(target, { method: endpoint.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(35_000) });
      const text = await response.text(); let responseBody = text; try { responseBody = text ? JSON.parse(text) : null; } catch {}
      const debug = this.debugRequests.get(debugId)?.result;
      return {
        success: debug?.flowSuccess !== false, live: true, method: endpoint.method, url: target.toString(),
        status: response.status, headers: Object.fromEntries(response.headers.entries()), body: responseBody,
        durationMs: Date.now() - started, trace: debug?.trace || [], error: debug?.error || ''
      };
    } finally { this.debugRequests.delete(debugId); }
  }

  async _serve(project, request, response) {
    const started = Date.now(); const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (project.cors) {
      response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key'); response.setHeader('Access-Control-Allow-Methods', METHODS.join(', '));
    }
    if (request.method === 'OPTIONS' && request.headers['access-control-request-method']) { response.writeHead(204); response.end(); return; }
    let selected = null; let params = null;
    for (const endpoint of project.endpoints.filter(item => item.enabled && item.method === request.method)) {
      const match = routeMatch(`${project.basePath}${endpoint.path}`, url.pathname);
      if (match) { selected = endpoint; params = match; break; }
    }
    if (!selected) {
      this._send(response, 404, {}, { error: 'Endpoint not found' });
      this._log({ projectId: project.id, endpointId: '', method: request.method, path: url.pathname, status: 404, durationMs: Date.now() - started, source: 'http', success: false, error: 'Endpoint not found' });
      return;
    }
    let body = {};
    if (!['GET', 'HEAD'].includes(request.method)) body = await this._readBody(request);
    const debugId = String(request.headers['x-kitsune-flow-debug'] || ''); const debug = this.debugRequests.get(debugId);
    const flowHeaders = { ...request.headers }; delete flowHeaders['x-kitsune-flow-debug'];
    const requestData = { method: request.method, path: url.pathname, params, query: Object.fromEntries(url.searchParams.entries()), headers: flowHeaders, body, ip: request.socket.remoteAddress || '' };
    try {
      const result = await this.executor.execute(project, selected, requestData);
      if (debug) debug.result = { flowSuccess: true, trace: result.trace };
      this._send(response, result.status, result.headers, result.body);
      this._log({ projectId: project.id, endpointId: selected.id, method: selected.method, path: url.pathname, status: result.status, durationMs: Date.now() - started, source: 'http', success: true });
    } catch (error) {
      if (debug) debug.result = { flowSuccess: false, trace: error.trace || [], error: error.message };
      this._log({ projectId: project.id, endpointId: selected.id, method: selected.method, path: url.pathname, status: error.status || 500, durationMs: Date.now() - started, source: 'http', success: false, error: error.message });
      this._sendError(response, error);
    }
  }

  _readBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = []; let size = 0;
      request.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) { reject(Object.assign(new Error('Request body exceeds 1 MB'), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
      request.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return resolve({});
        const contentType = String(request.headers['content-type'] || '').split(';')[0];
        try {
          if (contentType === 'application/json') resolve(JSON.parse(raw));
          else if (contentType === 'application/x-www-form-urlencoded') resolve(Object.fromEntries(new URLSearchParams(raw).entries()));
          else resolve(raw);
        } catch { reject(Object.assign(new Error('Invalid JSON request body'), { status: 400 })); }
      });
      request.on('error', reject);
    });
  }

  _send(response, status, headers, body) {
    if (response.writableEnded) return;
    for (const [key, value] of Object.entries(headers || {})) if (!/[\r\n]/.test(String(key) + String(value))) response.setHeader(key, String(value));
    if (body == null) { response.writeHead(status); response.end(); return; }
    const output = typeof body === 'string' ? body : JSON.stringify(body);
    if (!response.hasHeader('Content-Type')) response.setHeader('Content-Type', typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(output)); response.writeHead(status); response.end(output);
  }

  _sendError(response, error) { this._send(response, error.status || 500, {}, { error: error.message || 'Internal API Flow error' }); }
}

ApiFlowManager.BLOCK_CATALOG = BLOCK_CATALOG;
ApiFlowManager.routeMatch = routeMatch;
module.exports = ApiFlowManager;
