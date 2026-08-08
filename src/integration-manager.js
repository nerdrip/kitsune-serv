'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const INTEGRATIONS = Object.freeze([
  {
    id: 'authenticode', name: 'Windows Authenticode', category: 'Publishing', icon: '🛡️',
    description: 'Code-sign Windows executables through electron-builder when a trusted certificate is available.',
    fields: [
      { id: 'certificatePath', label: 'Certificate file or CSC_LINK', required: true, placeholder: 'D:\\certificates\\codesign.pfx' },
      { id: 'timestampUrl', label: 'RFC 3161 timestamp URL', required: true, default: 'http://timestamp.digicert.com' },
      { id: 'certificatePassword', label: 'Certificate password', secret: true, required: true }
    ]
  },
  {
    id: 'github', name: 'GitHub Releases', category: 'Publishing', icon: '🐙',
    description: 'Publish release assets and inspect repository metadata through the GitHub API.',
    fields: [
      { id: 'apiBase', label: 'API base URL', default: 'https://api.github.com', required: true },
      { id: 'owner', label: 'Repository owner', required: true }, { id: 'repository', label: 'Repository', required: true },
      { id: 'token', label: 'Fine-grained access token', secret: true, required: true }
    ]
  },
  {
    id: 'gitlab', name: 'GitLab Releases', category: 'Publishing', icon: '🦊',
    description: 'Publish packages and releases to GitLab.com or a self-hosted GitLab instance.',
    fields: [
      { id: 'apiBase', label: 'API base URL', default: 'https://gitlab.com/api/v4', required: true },
      { id: 'projectId', label: 'Project ID or URL-encoded path', required: true },
      { id: 'token', label: 'Project or personal access token', secret: true, required: true }
    ]
  },
  {
    id: 'winget', name: 'Windows Package Manager', category: 'Publishing', icon: '📦',
    description: 'Prepare manifests for a local winget-pkgs checkout. Submission remains an explicit user action.',
    fields: [{ id: 'repositoryPath', label: 'winget-pkgs checkout', required: true, placeholder: 'D:\\src\\winget-pkgs' }]
  },
  {
    id: 'chocolatey', name: 'Chocolatey', category: 'Publishing', icon: '🍫',
    description: 'Configure a Chocolatey push source and API key.',
    fields: [
      { id: 'sourceUrl', label: 'Push source URL', default: 'https://push.chocolatey.org/', required: true },
      { id: 'apiKey', label: 'API key', secret: true, required: true }
    ]
  },
  {
    id: 'scoop', name: 'Scoop Bucket', category: 'Publishing', icon: '🥄',
    description: 'Write an updated Scoop manifest into a checked-out bucket repository.',
    fields: [{ id: 'bucketPath', label: 'Bucket checkout', required: true }, { id: 'manifestName', label: 'Manifest name', default: 'kitsuneserv', required: true }]
  },
  {
    id: 'oauth-github', name: 'GitHub OAuth', category: 'Authentication', icon: '🔑',
    description: 'Authenticate server-mode users through a GitHub OAuth application.',
    fields: [
      { id: 'clientId', label: 'Client ID', required: true }, { id: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { id: 'callbackUrl', label: 'Callback URL', required: true, placeholder: 'https://server.example/auth/oauth/github/callback' },
      { id: 'allowedOrganizations', label: 'Allowed organizations (comma separated)' }
    ]
  },
  {
    id: 'oauth-google', name: 'Google OpenID Connect', category: 'Authentication', icon: '🔐',
    description: 'Authenticate through Google OpenID Connect with optional hosted-domain restriction.',
    fields: [
      { id: 'clientId', label: 'Client ID', required: true }, { id: 'clientSecret', label: 'Client secret', secret: true, required: true },
      { id: 'callbackUrl', label: 'Callback URL', required: true }, { id: 'hostedDomain', label: 'Allowed hosted domain' }
    ]
  },
  {
    id: 'oauth-microsoft', name: 'Microsoft Entra ID', category: 'Authentication', icon: '🪟',
    description: 'Authenticate through a Microsoft Entra tenant using OpenID Connect.',
    fields: [
      { id: 'tenantId', label: 'Tenant ID', required: true, default: 'common' }, { id: 'clientId', label: 'Client ID', required: true },
      { id: 'clientSecret', label: 'Client secret', secret: true, required: true }, { id: 'callbackUrl', label: 'Callback URL', required: true }
    ]
  },
  {
    id: 'sentry', name: 'Sentry', category: 'Observability', icon: '🚨',
    description: 'Send explicitly enabled application errors to a Sentry project.',
    fields: [{ id: 'dsn', label: 'DSN', secret: true, required: true }, { id: 'environment', label: 'Environment', default: 'production' }]
  },
  {
    id: 'opentelemetry', name: 'OpenTelemetry', category: 'Observability', icon: '🔭',
    description: 'Export local traces and metrics to an OTLP HTTP collector.',
    fields: [
      { id: 'endpoint', label: 'OTLP HTTP endpoint', required: true, placeholder: 'http://127.0.0.1:4318' },
      { id: 'authorization', label: 'Authorization header', secret: true }, { id: 'serviceName', label: 'Service name', default: 'kitsuneserv' }
    ]
  },
  {
    id: 'grafana', name: 'Grafana', category: 'Observability', icon: '📈',
    description: 'Link dashboards and validate access to a Grafana instance.',
    fields: [{ id: 'baseUrl', label: 'Grafana URL', required: true }, { id: 'token', label: 'Service account token', secret: true }]
  },
  {
    id: 'ai-openai-compatible', name: 'AI Operations Assistant', category: 'Automation', icon: '🧠',
    description: 'Use an OpenAI-compatible endpoint for opt-in log and configuration analysis. No data is sent until invoked.',
    fields: [
      { id: 'baseUrl', label: 'API base URL', required: true, default: 'http://127.0.0.1:11434/v1' },
      { id: 'model', label: 'Model', required: true }, { id: 'apiKey', label: 'API key', secret: true }
    ]
  },
  {
    id: 'remote-agent', name: 'KitsuneServ Remote Agent', category: 'Team', icon: '🛰️',
    description: 'Connect a future remote machine through a mutually authenticated agent endpoint.',
    fields: [
      { id: 'endpoint', label: 'Agent HTTPS URL', required: true }, { id: 'token', label: 'Enrollment token', secret: true, required: true },
      { id: 'certificateFingerprint', label: 'Pinned SHA-256 certificate fingerprint', required: true }
    ]
  },
  {
    id: 'onepassword', name: '1Password CLI', category: 'Secrets', icon: '🔒',
    description: 'Resolve project secrets through an installed and authenticated 1Password CLI.',
    fields: [{ id: 'account', label: 'Account shorthand or sign-in address' }]
  },
  {
    id: 'bitwarden', name: 'Bitwarden CLI', category: 'Secrets', icon: '🛡️',
    description: 'Resolve project secrets through an installed Bitwarden CLI.',
    fields: [{ id: 'serverUrl', label: 'Server URL', default: 'https://vault.bitwarden.com' }, { id: 'session', label: 'CLI session', secret: true }]
  }
]);

const byId = new Map(INTEGRATIONS.map(item => [item.id, item]));

class IntegrationManager {
  constructor(appRoot, secretStore, options = {}) {
    this.appRoot = path.resolve(appRoot);
    this.secretStore = secretStore;
    this.configPath = path.join(this.appRoot, 'config', 'integrations.json');
    this.request = options.request || this._request.bind(this);
    this.spawnSync = options.spawnSync || spawnSync;
  }

  definitions() { return structuredClone(INTEGRATIONS); }

  _read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return parsed && typeof parsed.integrations === 'object' ? parsed : { schemaVersion: 1, integrations: {} };
    } catch { return { schemaVersion: 1, integrations: {} }; }
  }

  _write(payload) {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temp = `${this.configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.renameSync(temp, this.configPath); }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.copyFileSync(temp, this.configPath); fs.unlinkSync(temp);
    }
  }

  _secretKey(id, field) { return `integration:${id}:${field}`; }

  _normalizeUrl(value, field) {
    const parsed = new URL(String(value));
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback) && field !== 'timestampUrl') {
      throw new Error(`${field} must use HTTPS or loopback HTTP`);
    }
    return parsed.toString().replace(/\/$/, '');
  }

  _normalize(id, input = {}) {
    const definition = byId.get(id);
    if (!definition) throw new Error('Unknown integration');
    const config = { enabled: Boolean(input.enabled) };
    for (const field of definition.fields.filter(item => !item.secret)) {
      let value = input[field.id] == null || input[field.id] === '' ? field.default || '' : String(input[field.id]).trim();
      if (value.length > 2048) throw new Error(`${field.label} is too long`);
      if (/url|endpoint|apiBase|baseUrl/i.test(field.id) && value) value = this._normalizeUrl(value, field.id);
      config[field.id] = value;
    }
    return config;
  }

  list() {
    const stored = this._read().integrations;
    return INTEGRATIONS.map(definition => {
      const config = { ...(stored[definition.id] || {}) };
      const secretFields = definition.fields.filter(field => field.secret);
      const secrets = Object.fromEntries(secretFields.map(field => [field.id, this.secretStore.has(this._secretKey(definition.id, field.id))]));
      const missing = definition.fields.filter(field => field.required && (field.secret ? !secrets[field.id] : !config[field.id])).map(field => field.id);
      return { ...structuredClone(definition), config, secrets, configured: missing.length === 0, missing };
    });
  }

  save(id, input = {}, secrets = {}) {
    const definition = byId.get(id);
    if (!definition) return { success: false, error: 'Unknown integration' };
    try {
      const payload = this._read();
      payload.integrations[id] = { ...this._normalize(id, input), updatedAt: new Date().toISOString() };
      for (const field of definition.fields.filter(item => item.secret)) {
        if (!Object.hasOwn(secrets, field.id)) continue;
        const value = secrets[field.id];
        if (value === null) this.secretStore.remove(this._secretKey(id, field.id));
        else if (typeof value === 'string' && value) this.secretStore.set(this._secretKey(id, field.id), value);
      }
      this._write(payload);
      return { success: true, integration: this.list().find(item => item.id === id) };
    } catch (error) { return { success: false, error: error.message }; }
  }

  remove(id) {
    const definition = byId.get(id);
    if (!definition) return { success: false, error: 'Unknown integration' };
    const payload = this._read();
    delete payload.integrations[id];
    this._write(payload);
    for (const field of definition.fields.filter(item => item.secret)) this.secretStore.remove(this._secretKey(id, field.id));
    return { success: true };
  }

  _credentials(item) {
    return Object.fromEntries(item.fields.filter(field => field.secret).map(field => [field.id, this.secretStore.get(this._secretKey(item.id, field.id))]));
  }

  async _request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'error' });
      const text = (await response.text()).slice(0, 1024 * 1024);
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { ok: response.ok, status: response.status, body };
    } finally { clearTimeout(timer); }
  }

  _toolVersion(command) {
    const result = this.spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return { success: false, error: `${command} is not installed or not available in PATH` };
    const executable = String(result.stdout || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || command;
    const version = this.spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    return version.status === 0
      ? { success: true, executable, message: String(version.stdout || version.stderr || '').trim().slice(0, 500) }
      : { success: false, executable, error: String(version.stderr || version.stdout || 'Version probe failed').trim() };
  }

  async test(id) {
    const item = this.list().find(integration => integration.id === id);
    if (!item) return { success: false, error: 'Unknown integration' };
    if (!item.configured) return { success: false, error: `Missing required settings: ${item.missing.join(', ')}`, missing: item.missing };
    const config = item.config;
    const secret = this._credentials(item);
    try {
      let result;
      if (id === 'authenticode') {
        const certificateExists = /^(https?:|base64:)/i.test(config.certificatePath) || fs.existsSync(path.resolve(config.certificatePath));
        result = certificateExists ? this._toolVersion('signtool.exe') : { success: false, error: 'Certificate file does not exist' };
      } else if (id === 'winget') {
        const target = path.resolve(config.repositoryPath);
        result = fs.existsSync(target) && fs.statSync(target).isDirectory() ? { success: true, message: `Repository available at ${target}` } : { success: false, error: 'winget-pkgs checkout does not exist' };
      } else if (id === 'scoop') {
        const target = path.resolve(config.bucketPath);
        result = fs.existsSync(target) && fs.statSync(target).isDirectory() ? { success: true, message: `Bucket available at ${target}` } : { success: false, error: 'Scoop bucket checkout does not exist' };
      } else if (id === 'onepassword') result = this._toolVersion('op');
      else if (id === 'bitwarden') result = this._toolVersion('bw');
      else {
        let url; let headers = { accept: 'application/json', 'user-agent': 'KitsuneServ/2.0' };
        if (id === 'github') { url = `${config.apiBase}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}`; headers.authorization = `Bearer ${secret.token}`; }
        else if (id === 'gitlab') { url = `${config.apiBase}/projects/${encodeURIComponent(config.projectId)}`; headers['private-token'] = secret.token; }
        else if (id === 'chocolatey') { url = config.sourceUrl; headers['x-nuget-apikey'] = secret.apiKey; }
        else if (id === 'oauth-github') url = 'https://github.com/.well-known/openid-configuration';
        else if (id === 'oauth-google') url = 'https://accounts.google.com/.well-known/openid-configuration';
        else if (id === 'oauth-microsoft') url = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/v2.0/.well-known/openid-configuration`;
        else if (id === 'sentry') {
          const parsed = new URL(secret.dsn); result = parsed.protocol === 'https:' && parsed.username ? { success: true, message: `Sentry DSN configured for ${parsed.host}` } : { success: false, error: 'Invalid Sentry DSN' };
        }
        else if (id === 'opentelemetry') { url = config.endpoint; if (secret.authorization) headers.authorization = secret.authorization; }
        else if (id === 'grafana') { url = `${config.baseUrl}/api/health`; if (secret.token) headers.authorization = `Bearer ${secret.token}`; }
        else if (id === 'ai-openai-compatible') { url = `${config.baseUrl}/models`; if (secret.apiKey) headers.authorization = `Bearer ${secret.apiKey}`; }
        else if (id === 'remote-agent') { url = `${config.endpoint}/api/agent/status`; headers.authorization = `Bearer ${secret.token}`; }
        if (!result) {
          const response = await this.request(url, { headers });
          result = response.ok ? { success: true, message: `Endpoint responded with HTTP ${response.status}`, status: response.status } : { success: false, error: `Endpoint responded with HTTP ${response.status}`, status: response.status };
        }
      }
      const payload = this._read();
      payload.integrations[id] = { ...(payload.integrations[id] || {}), lastTest: { success: Boolean(result.success), message: result.message || result.error || '', testedAt: new Date().toISOString() } };
      this._write(payload);
      return { ...result, testedAt: payload.integrations[id].lastTest.testedAt };
    } catch (error) { return { success: false, error: error.name === 'AbortError' ? 'Integration test timed out' : error.message }; }
  }

  readiness(category = '') {
    return this.list().filter(item => !category || item.category === category).map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      enabled: Boolean(item.config.enabled),
      configured: item.configured,
      verified: Boolean(item.config.lastTest?.success),
      missing: item.missing,
      lastTest: item.config.lastTest || null
    }));
  }

  _redactAssistantContext(value, depth = 0) {
    if (depth > 8) return '[depth-limited]';
    if (Array.isArray(value)) return value.slice(0, 200).map(item => this._redactAssistantContext(item, depth + 1));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).slice(0, 500).map(([key, item]) => [key,
        /(password|passwd|secret|token|authorization|cookie|private.?key|api.?key|dsn)/i.test(key)
          ? '[REDACTED]'
          : this._redactAssistantContext(item, depth + 1)
      ]));
    }
    if (typeof value !== 'string') return value;
    return value
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [REDACTED]')
      .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/:\/\/([^/@\s:]+):([^/@\s]+)@/g, '://[REDACTED]@')
      .slice(0, 20000);
  }

  async assistant(prompt, context = {}) {
    const item = this.list().find(integration => integration.id === 'ai-openai-compatible');
    if (!item?.config.enabled) return { success: false, error: 'AI Operations Assistant is disabled' };
    if (!item.configured) return { success: false, error: `Missing required settings: ${item.missing.join(', ')}` };
    const question = String(prompt || '').trim().slice(0, 12000);
    if (!question) return { success: false, error: 'Assistant prompt is empty' };
    const sanitized = this._redactAssistantContext(context);
    let serialized = JSON.stringify(sanitized);
    if (Buffer.byteLength(serialized) > 64000) serialized = serialized.slice(0, 64000);
    const credentials = this._credentials(item);
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    if (credentials.apiKey) headers.authorization = `Bearer ${credentials.apiKey}`;
    try {
      const response = await this.request(`${item.config.baseUrl}/chat/completions`, {
        method: 'POST', headers,
        body: JSON.stringify({
          model: item.config.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'You are a local development operations assistant. Diagnose conservatively. Never claim to have changed the system. Prefer concrete checks and explicitly label uncertainty.' },
            { role: 'user', content: `${question}\n\nSanitized KitsuneServ context:\n${serialized}` }
          ]
        })
      });
      if (!response.ok) return { success: false, error: `Assistant endpoint returned HTTP ${response.status}` };
      const content = response.body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) return { success: false, error: 'Assistant endpoint returned no message' };
      return { success: true, content: content.slice(0, 100000), model: item.config.model, contextRedacted: true };
    } catch (error) { return { success: false, error: error.name === 'AbortError' ? 'Assistant request timed out' : error.message }; }
  }

  buildEnvironment() {
    const item = this.list().find(integration => integration.id === 'authenticode');
    if (!item?.config.enabled || !item.configured) return {};
    const secret = this._credentials(item);
    return { CSC_LINK: item.config.certificatePath, CSC_KEY_PASSWORD: secret.certificatePassword };
  }
}

IntegrationManager.INTEGRATIONS = INTEGRATIONS;

module.exports = IntegrationManager;
