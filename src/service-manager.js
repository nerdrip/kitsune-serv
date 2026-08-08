const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { SERVICE_IDS, MANAGED_IDS, resolveInside, assertProjectName, assertSafeSegment } = require('./path-utils');

const WEB_SERVICES = Object.freeze(['apache', 'nginx', 'caddy']);
const PHP_BUILTIN_EXTENSIONS = new Set([
  'bcmath', 'calendar', 'ctype', 'dom', 'filter', 'hash', 'json', 'pcre',
  'phar', 'session', 'simplexml', 'spl', 'tokenizer', 'xml', 'xmlreader',
  'xmlwriter', 'zlib'
]);

class ServiceManager {
  constructor(downloadManager, configManager) {
    this.downloadManager = downloadManager;
    this.configManager = configManager;
    this.processes = new Map(); // key: section (apache, nginx, postgresql, etc.)
    this.logs = new Map();
  }

  _pushLog(logArr, message) {
    if (!logArr || message === undefined || message === null) return;
    logArr.push(String(message));
    if (logArr.length > 500) logArr.splice(0, logArr.length - 500);
  }

  _createLogTracker(logFiles = []) {
    const files = [...new Set(logFiles.filter(Boolean).map(file => path.resolve(file)))].map(file => {
      let offset = 0;
      try { offset = fs.statSync(file).size; } catch {}
      return { file, offset, remainder: '' };
    });
    return { files, timer: null, stopped: false };
  }

  _pollLogTracker(logArr, tracker, flush = false) {
    if (!tracker || tracker.stopped) return;
    for (const state of tracker.files) {
      try {
        const stat = fs.statSync(state.file);
        if (!stat.isFile()) continue;
        if (stat.size < state.offset) {
          state.offset = 0;
          state.remainder = '';
          this._pushLog(logArr, `[KitsuneServ] Log rotated: ${path.basename(state.file)}\n`);
        }
        if (stat.size > state.offset) {
          const maxRead = 1024 * 1024;
          let start = state.offset;
          if (stat.size - start > maxRead) {
            start = stat.size - maxRead;
            state.remainder = '';
            this._pushLog(logArr, `[KitsuneServ] Skipped older output from ${path.basename(state.file)}.\n`);
          }
          const length = stat.size - start;
          const buffer = Buffer.alloc(length);
          const fd = fs.openSync(state.file, 'r');
          try { fs.readSync(fd, buffer, 0, length, start); } finally { fs.closeSync(fd); }
          state.offset = stat.size;
          const parts = (state.remainder + buffer.toString('utf8')).split(/\r?\n/);
          state.remainder = parts.pop() || '';
          const name = path.basename(state.file);
          const prefix = /error/i.test(name) ? `[ERR][${name}] ` : `[${name}] `;
          for (const line of parts) this._pushLog(logArr, `${prefix}${line}\n`);
        }
        if (flush && state.remainder) {
          const name = path.basename(state.file);
          const prefix = /error/i.test(name) ? `[ERR][${name}] ` : `[${name}] `;
          this._pushLog(logArr, `${prefix}${state.remainder}\n`);
          state.remainder = '';
        }
      } catch (err) {
        if (err.code !== 'ENOENT') this._pushLog(logArr, `[KitsuneServ] Could not read ${path.basename(state.file)}: ${err.message}\n`);
      }
    }
  }

  _startLogTracker(logArr, tracker) {
    if (!tracker?.files.length) return;
    const poll = () => this._pollLogTracker(logArr, tracker);
    tracker.timer = setInterval(poll, 750);
    tracker.timer.unref?.();
    poll();
  }

  _stopLogTracker(logArr, tracker) {
    if (!tracker || tracker.stopped) return;
    if (tracker.timer) clearInterval(tracker.timer);
    this._pollLogTracker(logArr, tracker, true);
    tracker.stopped = true;
  }

  // Resolve which download key to use from a profile
  _resolveDownloadKey(profile, section) {
    return section;
  }

  _isWindows() {
    return process.platform === 'win32';
  }

  _projectDir(section, projectName) {
    return resolveInside(path.resolve('projects'), section, assertProjectName(projectName));
  }

  _projectEntry(section, projectName, entryPoint) {
    const projectDir = this._projectDir(section, projectName);
    return { projectDir, entryPoint: resolveInside(projectDir, entryPoint) };
  }

  _mergeEnvVars(target, envVars) {
    for (const item of Array.isArray(envVars) ? envVars : []) {
      if (item && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.key || '')) target[item.key] = String(item.value || '');
    }
  }

  _resolveDocumentRoot(profile, config = this.configManager.getConfig()) {
    const configured = config.general?.forceGlobalDocumentRoot
      ? config.general.globalDocumentRoot
      : profile?.documentRoot;
    return path.resolve(configured || './www');
  }

  _validateDocumentRoot(directory) {
    if (typeof directory !== 'string' || !directory.trim()) throw new Error('Choose a document root directory');
    const resolved = path.resolve(directory.trim());
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('The selected document root does not exist');
    }
    return resolved;
  }

  async _applyWebRootChange(mutateConfig, affectedSections = WEB_SERVICES) {
    const previousConfig = this.configManager.getConfig();
    const nextConfig = JSON.parse(JSON.stringify(previousConfig));
    const mutation = mutateConfig(nextConfig);
    if (mutation?.success === false) return mutation;
    const runningWebServers = affectedSections.filter(section => this.processes.has(section));
    const stopped = [];
    const started = [];

    try {
      for (const section of runningWebServers) {
        const result = await this.stopService(section, { keepPhp: true });
        if (!result.success) throw new Error(`Could not stop ${section}: ${result.error}`);
        stopped.push(section);
      }
      const saved = this.configManager.saveConfig(nextConfig);
      if (!saved.success) throw new Error(saved.error || 'Could not save the document root');
      for (const section of runningWebServers) {
        const result = await this.startService(section);
        if (!result.success) throw new Error(`Could not restart ${section}: ${result.error}`);
        started.push(section);
      }
      return { success: true, config: this.configManager.getConfig(), restarted: started, ...mutation };
    } catch (err) {
      for (const section of [...started].reverse()) {
        if (this.processes.has(section)) await this.stopService(section, { keepPhp: true });
      }
      this.configManager.saveConfig(previousConfig);
      const rollbackErrors = [];
      for (const section of runningWebServers) {
        if (this.processes.has(section)) continue;
        const result = await this.startService(section);
        if (!result.success) rollbackErrors.push(`${section}: ${result.error}`);
      }
      return {
        success: false,
        error: `${err.message}. Previous configuration restored.${rollbackErrors.length ? ` Rollback errors: ${rollbackErrors.join('; ')}` : ''}`,
        rolledBack: true,
        config: this.configManager.getConfig()
      };
    }
  }

  async setDocumentRoot(section, directory) {
    if (!WEB_SERVICES.includes(section)) return { success: false, error: 'Document root is supported only for web servers' };
    try {
      const resolved = this._validateDocumentRoot(directory);
      const result = await this._applyWebRootChange(config => {
        if (config.general?.forceGlobalDocumentRoot) {
          return { success: false, error: 'The global document root is enforced. Change it in General settings.' };
        }
        const profile = this.configManager.getActiveProfile(config, section);
        if (!profile) return { success: false, error: `No active profile for ${section}` };
        profile.documentRoot = resolved;
        return { success: true, documentRoot: resolved };
      }, [section]);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async setGlobalDocumentRoot(enabled, directory) {
    try {
      const current = this.configManager.getConfig();
      const resolved = this._validateDocumentRoot(directory || current.general?.globalDocumentRoot || './www');
      const affectsRunningServers = Boolean(current.general?.forceGlobalDocumentRoot) || Boolean(enabled);
      return this._applyWebRootChange(config => {
        config.general = config.general || {};
        config.general.forceGlobalDocumentRoot = Boolean(enabled);
        config.general.globalDocumentRoot = resolved;
        return { success: true, enabled: Boolean(enabled), documentRoot: resolved };
      }, affectsRunningServers ? WEB_SERVICES : []);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  _findExecutable(installPath, dlKey) {
    const isWin = this._isWindows();
    const checks = {
      nginx: isWin ? ['nginx.exe'] : ['sbin/nginx', 'nginx'],
      apache: isWin ? ['bin/httpd.exe', 'Apache24/bin/httpd.exe'] : ['bin/httpd', 'sbin/httpd', 'usr/sbin/httpd'],
      php: isWin ? ['php-cgi.exe', 'php.exe'] : ['sbin/php-fpm', 'bin/php-cgi', 'bin/php'],
      node: isWin ? ['node.exe'] : ['bin/node', 'node'],
      go: isWin ? ['bin/go.exe', 'go.exe'] : ['bin/go', 'go'],
      postgresql: isWin ? ['bin/pg_ctl.exe', 'pgsql/bin/pg_ctl.exe'] : ['bin/pg_ctl', 'pgsql/bin/pg_ctl'],
      mysql: isWin ? ['bin/mysqld.exe'] : ['bin/mysqld'],
      mariadb: isWin ? ['bin/mariadbd.exe', 'bin/mysqld.exe'] : ['bin/mariadbd', 'bin/mysqld'],
      mongodb: isWin ? ['bin/mongod.exe'] : ['bin/mongod'],
      redis: isWin ? ['redis-server.exe'] : ['bin/redis-server', 'redis-server'],
      bun: isWin ? ['bun.exe'] : ['bun'],
      memcached: isWin ? ['memcached.exe', 'bin/memcached.exe'] : ['bin/memcached', 'memcached'],
      python: isWin ? ['python.exe', 'python3.exe'] : ['bin/python3', 'bin/python', 'python3', 'python'],
      deno: isWin ? ['deno.exe'] : ['deno', 'bin/deno'],
      caddy: isWin ? ['caddy.exe'] : ['caddy', 'bin/caddy'],
      minio: isWin ? ['minio.exe'] : ['minio', 'bin/minio']
    };
    const candidates = checks[dlKey] || [];
    for (const rel of candidates) {
      const full = path.join(installPath, rel);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  _resolveServiceHome(installPath, dlKey) {
    const wrappers = {
      apache: ['Apache24'],
      postgresql: ['pgsql']
    };
    for (const wrapper of wrappers[dlKey] || []) {
      const candidate = path.join(installPath, wrapper);
      if (fs.existsSync(candidate) && this._findExecutable(candidate, dlKey)) return candidate;
    }
    return installPath;
  }

  _webServerNeedsPhp(section, config = this.configManager.getConfig()) {
    if (!WEB_SERVICES.includes(section) || config.php?.enabled === false) return false;
    const profile = this.configManager.getActiveProfile(config, section);
    if (!profile || config[section]?.enabled === false) return false;
    if (section === 'apache') return profile.modProxyFcgi === true;
    return profile.phpEnabled !== false && (section !== 'caddy' || profile.fileServer !== false);
  }

  _phpExtensionDirectives(profile, installPath) {
    const directives = [];
    const enabled = new Set((Array.isArray(profile.extensions) ? profile.extensions : [])
      .filter(extension => extension?.enabled && typeof extension.name === 'string')
      .map(extension => extension.name.toLowerCase()));
    const extDir = path.join(installPath, 'ext');
    const files = fs.existsSync(extDir)
      ? fs.readdirSync(extDir).reduce((map, file) => map.set(file.toLowerCase(), file), new Map())
      : new Map();

    for (const name of enabled) {
      if (!/^[a-z0-9_]+$/.test(name) || PHP_BUILTIN_EXTENSIONS.has(name)) continue;
      if (name === 'opcache') {
        const opcache = files.get(this._isWindows() ? 'php_opcache.dll' : 'opcache.so');
        if (opcache) directives.push(`zend_extension=${opcache}`);
        continue;
      }
      if (name === 'xdebug') {
        const xdebug = [...files.entries()].find(([file]) => /^php_xdebug(?:-[a-z0-9._-]+)?\.dll$/.test(file) || /^xdebug(?:-[a-z0-9._-]+)?\.so$/.test(file));
        if (xdebug) directives.push(`zend_extension=${xdebug[1]}`);
        continue;
      }
      const candidate = this._isWindows() ? `php_${name}.dll` : `${name}.so`;
      const actual = files.get(candidate.toLowerCase());
      if (actual) directives.push(`extension=${actual}`);
    }
    return directives;
  }

  _buildArgs(section, profile, installPath) {
    const dlKey = this._resolveDownloadKey(profile, section);

    switch (dlKey) {
      case 'apache': {
        const confDir = path.join(installPath, 'conf');
        if (!fs.existsSync(confDir)) fs.mkdirSync(confDir, { recursive: true });
        const logsDir = path.join(installPath, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        const docRoot = this._resolveDocumentRoot(profile);
        const sslCertificate = path.resolve(profile.sslCertificate || path.join(confDir, 'server.crt')).replace(/\\/g, '/');
        const sslCertificateKey = path.resolve(profile.sslCertificateKey || path.join(confDir, 'server.key')).replace(/\\/g, '/');
        if (!fs.existsSync(docRoot)) fs.mkdirSync(docRoot, { recursive: true });

        // PHP integration via mod_proxy_fcgi
        let phpHandler = '';
        let adminerAlias = '';
        const currentConfig = this.configManager.getConfig();
        const phpSection = currentConfig.php;
        if (phpSection?.enabled !== false && profile.modProxyFcgi) {
          const phpProfile = this.configManager.getActiveProfile(currentConfig, 'php');
          if (phpProfile) {
            const phpPort = phpProfile.port || 9000;
            const scriptFilenameFix = this._isWindows()
              ? `ProxyFCGISetEnvIf "reqenv('SCRIPT_FILENAME') =~ m#^proxy:fcgi://[^/]+/(.*)$#" SCRIPT_FILENAME "$1"
ProxyFCGISetEnvIf "reqenv('SCRIPT_FILENAME') =~ m#^/([A-Za-z]:/.*)$#" SCRIPT_FILENAME "$1"`
              : `ProxyFCGISetEnvIf "reqenv('SCRIPT_FILENAME') =~ m#^proxy:fcgi://[^/]+(/.*)$#" SCRIPT_FILENAME "$1"`;
            phpHandler = `
<FilesMatch "\\.php$">
    SetHandler "proxy:fcgi://127.0.0.1:${phpPort}/"
</FilesMatch>
ProxyFCGIBackendType GENERIC
${scriptFilenameFix}`;
            // Adminer alias
            const adminerDir = path.resolve('./utils/adminer').replace(/\\/g, '/');
            adminerAlias = `
Alias /adminer "${adminerDir}"
<Directory "${adminerDir}">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>`;
          }
        }

        const modules = [];
        if (profile.modRewrite) modules.push('LoadModule rewrite_module modules/mod_rewrite.so');
        if (profile.modSsl) modules.push('LoadModule ssl_module modules/mod_ssl.so');
        // Auto-include mod_proxy when any proxy sub-module is enabled
        if (profile.modProxy || profile.modProxyHttp || profile.modProxyFcgi) modules.push('LoadModule proxy_module modules/mod_proxy.so');
        if (profile.modProxyHttp) modules.push('LoadModule proxy_http_module modules/mod_proxy_http.so');
        if (profile.modProxyFcgi) modules.push('LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so');
        if (profile.modHeaders) modules.push('LoadModule headers_module modules/mod_headers.so');
        if (profile.modDeflate) modules.push('LoadModule deflate_module modules/mod_deflate.so');
        if (profile.modExpires) modules.push('LoadModule expires_module modules/mod_expires.so');
        if (profile.modSecurity) modules.push('LoadModule security2_module modules/mod_security2.so');
        if (profile.modPhp) modules.push('LoadModule php_module modules/libphp.so');
        if (adminerAlias) modules.push('LoadModule alias_module modules/mod_alias.so');

        // Apache Lounge compiles the Windows MPM statically. Other builds may
        // ship it as a module, so load an MPM only when the file exists.
        const mpmCandidates = this._isWindows()
          ? [['mpm_winnt_module', 'mod_mpm_winnt.so']]
          : [['mpm_event_module', 'mod_mpm_event.so'], ['mpm_worker_module', 'mod_mpm_worker.so']];
        const platformModule = mpmCandidates.find(([, file]) => fs.existsSync(path.join(installPath, 'modules', file)));
        const platformModules = platformModule ? `LoadModule ${platformModule[0]} modules/${platformModule[1]}` : '';

        const apacheConf = `
ServerRoot "${installPath.replace(/\\/g, '/')}"
Listen ${profile.host ? profile.host + ':' : ''}${profile.port || 80}
ServerName ${profile.serverName || 'localhost'}:${profile.port || 80}

${platformModules}
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule mime_module modules/mod_mime.so
${modules.join('\n')}

LogFormat "%h %l %u %t \\"%r\\" %>s %b \\"%{Referer}i\\" \\"%{User-Agent}i\\"" combined

DocumentRoot "${docRoot.replace(/\\/g, '/')}"
DirectoryIndex ${profile.directoryIndex || 'index.html index.htm index.php'}

<Directory "${docRoot.replace(/\\/g, '/')}">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

${phpHandler}
${adminerAlias}

${profile.accessLog ? `CustomLog "logs/access.log" combined` : ''}
${profile.errorLog ? `ErrorLog "logs/error.log"` : ''}
LogLevel ${profile.logLevel || 'warn'}

Timeout ${profile.timeout || 300}
KeepAlive ${profile.keepAlive ? 'On' : 'Off'}
KeepAliveTimeout ${profile.keepaliveTimeout || 5}
MaxKeepAliveRequests ${profile.maxKeepAliveRequests || 100}

TypesConfig conf/mime.types

<IfModule mpm_winnt_module>
    ThreadsPerChild ${profile.maxRequestWorkers || 150}
</IfModule>
<IfModule mpm_event_module>
    MaxRequestWorkers ${profile.maxRequestWorkers || 150}
    ServerLimit ${profile.serverLimit || 16}
</IfModule>
${profile.sslEnabled && profile.modSsl ? `
Listen ${profile.host ? profile.host + ':' : ''}${profile.sslPort || 443}
<VirtualHost ${profile.host || '*'}:${profile.sslPort || 443}>
    SSLEngine on
    SSLCertificateFile "${sslCertificate}"
    SSLCertificateKeyFile "${sslCertificateKey}"
    DocumentRoot "${docRoot.replace(/\\/g, '/')}"
    <Directory "${docRoot.replace(/\\/g, '/')}">
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
` : ''}

${profile.customConfig || ''}
`;
        fs.writeFileSync(path.join(confDir, 'httpd.conf'), apacheConf, 'utf-8');
        return {
          args: ['-d', installPath, '-f', path.join(confDir, 'httpd.conf')],
          env: {},
          logFiles: [path.join(installPath, 'logs', 'error.log'), profile.accessLog ? path.join(installPath, 'logs', 'access.log') : null]
        };
      }
      case 'nginx': {
        const confDir = path.join(installPath, 'conf');
        if (!fs.existsSync(confDir)) fs.mkdirSync(confDir, { recursive: true });
        const logsDir = path.join(installPath, 'logs');
        if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
        const docRoot = this._resolveDocumentRoot(profile);
        const sslCertificate = path.resolve(profile.sslCertificate || path.join(confDir, 'server.crt')).replace(/\\/g, '/');
        const sslCertificateKey = path.resolve(profile.sslCertificateKey || path.join(confDir, 'server.key')).replace(/\\/g, '/');
        if (!fs.existsSync(docRoot)) fs.mkdirSync(docRoot, { recursive: true });

        // PHP integration via FastCGI
        let phpLocation = '';
        let phpAppsLocations = '';
        const currentConfig = this.configManager.getConfig();
        const phpSection = currentConfig.php;
        if (phpSection?.enabled !== false && profile.phpEnabled !== false) {
          const phpProfile = this.configManager.getActiveProfile(currentConfig, 'php');
          if (phpProfile) {
            const phpPort = phpProfile.port || 9000;
            phpLocation = `
        location ~ \\.php(/|$) {
            fastcgi_split_path_info ^(.+\\.php)(/.+)$;
            fastcgi_pass   127.0.0.1:${phpPort};
            fastcgi_index  index.php;
            fastcgi_param  SCRIPT_FILENAME $document_root$fastcgi_script_name;
            fastcgi_param  PATH_INFO $fastcgi_path_info;
            include        fastcgi_params;
        }`;

            // Adminer location (always available if PHP is configured)
            const adminerDir = path.resolve('./utils/adminer').replace(/\\/g, '/');
            const appsDir = path.resolve('./www/apps').replace(/\\/g, '/');
            phpAppsLocations = `
        location /adminer/ {
            alias ${adminerDir}/;
            index index.php;
            location ~ \\.php$ {
                fastcgi_pass   127.0.0.1:${phpPort};
                fastcgi_index  index.php;
                fastcgi_param  SCRIPT_FILENAME $request_filename;
                include        fastcgi_params;
            }
        }

        location /apps/ {
            alias ${appsDir}/;
            index index.php index.html;
            try_files $uri $uri/ @apps_fallback;
            location ~ \\.php(/|$) {
                fastcgi_split_path_info ^(.+\\.php)(/.+)$;
                fastcgi_pass   127.0.0.1:${phpPort};
                fastcgi_index  index.php;
                fastcgi_param  SCRIPT_FILENAME $request_filename;
                fastcgi_param  PATH_INFO $fastcgi_path_info;
                include        fastcgi_params;
            }
        }

        location @apps_fallback {
            rewrite ^/apps/([^/]+)/(.*)$ /apps/$1/index.php last;
        }`;
          }
        }

        // Reverse proxy / upstream block
        let upstreamBlock = '';
        let proxyLocation = '';
        if (profile.reverseProxy && (profile.proxyPass || profile.upstreamServer)) {
          const upName = profile.upstreamName || 'backend';
          const upHost = profile.upstreamServer || '127.0.0.1';
          const upPort = profile.upstreamPort || 3000;
          const lbMethod = profile.loadBalancing === 'least_conn' ? '    least_conn;\n' :
                           profile.loadBalancing === 'ip_hash' ? '    ip_hash;\n' : '';

          upstreamBlock = `
upstream ${upName} {
${lbMethod}    server ${upHost}:${upPort};
}`;

          const proxyTarget = profile.proxyPass || `http://${upName}`;
          const headers = [];
          if (profile.headerHost) headers.push('        proxy_set_header Host $host;');
          if (profile.headerRealIp) headers.push('        proxy_set_header X-Real-IP $remote_addr;');
          if (profile.headerForwardedFor) headers.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
          if (profile.headerForwardedProto) headers.push('        proxy_set_header X-Forwarded-Proto $scheme;');
          if (profile.websocket) {
            headers.push('        proxy_http_version 1.1;');
            headers.push('        proxy_set_header Upgrade $http_upgrade;');
            headers.push('        proxy_set_header Connection "upgrade";');
          }

          proxyLocation = `
        location / {
            proxy_pass ${proxyTarget};
${headers.join('\n')}
            proxy_connect_timeout ${profile.proxyConnectTimeout || 60};
            proxy_read_timeout ${profile.proxyReadTimeout || 60};
            proxy_send_timeout ${profile.proxySendTimeout || 60};
            proxy_buffering ${profile.proxyBuffering ? 'on' : 'off'};
            ${profile.proxyBufferSize ? `proxy_buffer_size ${profile.proxyBufferSize};` : ''}
        }`;
        }

        // Rate limiting
        let rateLimitZone = '';
        let rateLimitDirective = '';
        if (profile.rateLimitEnabled) {
          rateLimitZone = `    limit_req_zone $binary_remote_addr zone=ratelimit:10m rate=${profile.rateLimitRate || '10r/s'};`;
          rateLimitDirective = `        limit_req zone=ratelimit burst=${profile.rateLimitBurst || 20} nodelay;`;
        }

        // Proxy cache
        let cacheConfig = '';
        if (profile.proxyCacheEnabled) {
          const cachePath = profile.proxyCachePath || path.join(installPath, 'cache');
          cacheConfig = `    proxy_cache_path ${cachePath.replace(/\\/g, '/')} levels=1:2 keys_zone=kitcache:10m max_size=1g;`;
        }

        const nginxConf = `
worker_processes ${profile.workerProcesses || 'auto'};
events {
    worker_connections ${profile.workerConnections || 1024};
    multi_accept on;
}
http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile        ${profile.sendfile !== false ? 'on' : 'off'};
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout  ${profile.keepaliveTimeout || 30};
    types_hash_max_size 2048;
    ${profile.clientMaxBodySize ? `client_max_body_size ${profile.clientMaxBodySize};` : ''}
    ${profile.gzip ? 'gzip on;\n    gzip_vary on;\n    gzip_min_length 256;\n    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;' : ''}
${rateLimitZone}
${cacheConfig}
${upstreamBlock}
    server {
        listen       ${profile.host && profile.host !== '0.0.0.0' ? profile.host + ':' : ''}${profile.port || 80};
        server_name  ${profile.serverName || 'localhost'};
        root "${docRoot.replace(/\\/g, '/')}";
        index index.html index.htm index.php;
${profile.accessLog ? `        access_log logs/access.log;` : '        access_log off;'}
${profile.errorLog ? `        error_log logs/error.log;` : ''}
${rateLimitDirective}
${proxyLocation || '        location / { try_files $uri $uri/ =404; }'}
${phpAppsLocations}
${phpLocation}
${profile.corsEnabled ? `
        # CORS headers
        add_header Access-Control-Allow-Origin * always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;
        add_header Access-Control-Max-Age 86400 always;
` : ''}
${profile.customConfig || ''}
    }
${profile.sslEnabled ? `
    server {
        listen       ${profile.host && profile.host !== '0.0.0.0' ? profile.host + ':' : ''}${profile.sslPort || 443} ssl;
        server_name  ${profile.serverName || 'localhost'};
        root "${docRoot.replace(/\\/g, '/')}";
        index index.html index.htm index.php;
        ssl_certificate     "${sslCertificate}";
        ssl_certificate_key "${sslCertificateKey}";
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
${profile.accessLog ? '        access_log logs/ssl_access.log;' : '        access_log off;'}
${profile.errorLog ? '        error_log logs/ssl_error.log;' : ''}
${rateLimitDirective}
${proxyLocation || '        location / { try_files $uri $uri/ =404; }'}
${phpAppsLocations}
${phpLocation}
${profile.corsEnabled ? '\n        # CORS headers\n        add_header Access-Control-Allow-Origin * always;\n        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;\n        add_header Access-Control-Allow-Headers "Authorization, Content-Type, Accept" always;\n        add_header Access-Control-Max-Age 86400 always;' : ''}
    }
` : ''}
}`;
        fs.writeFileSync(path.join(confDir, 'nginx.conf'), nginxConf, 'utf-8');
        return {
          args: ['-p', installPath, '-c', 'conf/nginx.conf'],
          env: {},
          logFiles: [
            path.join(installPath, 'logs', 'error.log'),
            profile.accessLog ? path.join(installPath, 'logs', 'access.log') : null,
            profile.sslEnabled && profile.errorLog ? path.join(installPath, 'logs', 'ssl_error.log') : null,
            profile.sslEnabled && profile.accessLog ? path.join(installPath, 'logs', 'ssl_access.log') : null
          ]
        };
      }
      case 'php': {
        // Only load extension files that are actually shipped by the selected
        // PHP build. Core extensions must not be loaded as DLLs.
        const extLines = this._phpExtensionDirectives(profile, installPath);

        // Build Xdebug config if xdebug is enabled
        let xdebugConfig = '';
        if (profile.xdebug && profile.extensions?.some(e => e.name === 'xdebug' && e.enabled)) {
          xdebugConfig = `
[xdebug]
xdebug.mode = ${profile.xdebug.mode || 'debug'}
xdebug.start_with_request = ${profile.xdebug.startWithRequest || 'yes'}
xdebug.client_port = ${profile.xdebug.clientPort || 9003}
xdebug.client_host = ${profile.xdebug.clientHost || '127.0.0.1'}`;
        }

        const extDir = path.join(installPath, 'ext').replace(/\\/g, '/');
        const phpIni = `[PHP]
extension_dir = "${extDir}"
max_execution_time = ${profile.maxExecutionTime || 30}
memory_limit = ${profile.memoryLimit || '256M'}
upload_max_filesize = ${profile.uploadMaxFilesize || '64M'}
post_max_size = ${profile.postMaxSize || '64M'}
display_errors = ${profile.displayErrors ? 'On' : 'Off'}
error_reporting = ${profile.errorReporting || 'E_ALL'}
date.timezone = ${profile.timezone || 'UTC'}
cgi.force_redirect = 0
cgi.fix_pathinfo = 1
fastcgi.logging = 0
${this._isWindows() ? 'fastcgi.impersonate = 1' : ''}
${profile.opcache ? '[opcache]\nopcache.enable=1\nopcache.enable_cli=0\nopcache.memory_consumption=' + (profile.opcacheMemory || 128) : ''}
${extLines.length ? '\n; Extensions\n' + extLines.join('\n') : ''}${xdebugConfig}
${profile.customIni || ''}`;
        fs.writeFileSync(path.join(installPath, 'php.ini'), phpIni, 'utf-8');

        if (this._isWindows()) {
          return {
            args: ['-b', `127.0.0.1:${profile.port || 9000}`, '-c', path.join(installPath, 'php.ini')],
            exe: 'php-cgi.exe',
            env: {
              PHP_FCGI_CHILDREN: String(Math.max(1, Number(profile.fpmMaxChildren) || 5)),
              PHP_FCGI_MAX_REQUESTS: '1000'
            }
          };
        }
        // Linux: prefer php-cgi (same -b flag), fall back to php-fpm with generated config
        const hasCgi = fs.existsSync(path.join(installPath, 'bin/php-cgi'));
        if (hasCgi) {
          return { args: ['-b', `127.0.0.1:${profile.port || 9000}`, '-c', path.join(installPath, 'php.ini')], exe: 'bin/php-cgi', env: {} };
        }
        // php-fpm needs a pool config file
        const fpmConf = `[global]
pid = ${path.join(installPath, 'php-fpm.pid')}
error_log = ${path.join(installPath, 'php-fpm.log')}
daemonize = no
[www]
listen = 127.0.0.1:${profile.port || 9000}
pm = dynamic
pm.max_children = ${profile.fpmMaxChildren || 5}
pm.start_servers = ${profile.fpmStartServers || 2}
pm.min_spare_servers = ${profile.fpmMinSpare || 1}
pm.max_spare_servers = ${profile.fpmMaxSpare || 3}
`;
        fs.writeFileSync(path.join(installPath, 'php-fpm-kitsune.conf'), fpmConf, 'utf-8');
        return { args: ['--fpm-config', path.join(installPath, 'php-fpm-kitsune.conf'), '-c', path.join(installPath, 'php.ini'), '--nodaemonize'], exe: 'sbin/php-fpm', env: {}, logFiles: [path.join(installPath, 'php-fpm.log')] };
      }
      case 'node': {
        const project = profile.project ? this._projectEntry('node', profile.project, profile.entryPoint || 'server.js') : null;
        const projectDir = project?.projectDir || null;
        const entryPoint = project?.entryPoint || path.resolve(profile.entryPoint || 'server.js');
        const envVars = { NODE_ENV: profile.env || 'development', PORT: String(profile.port || 3000) };
        this._mergeEnvVars(envVars, profile.envVars);
        const args = [entryPoint];
        if (profile.watchMode) args.unshift('--watch');
        if (profile.inspectEnabled) args.unshift(`--inspect=${profile.inspectPort || 9229}`);
        return { args, env: envVars, cwd: projectDir || path.dirname(entryPoint) };
      }
      case 'postgresql': {
        const dataDir = path.resolve(profile.dataDir || `./data/postgresql-${profile.version}`);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const pgVersionFile = path.join(dataDir, 'PG_VERSION');
        if (!fs.existsSync(pgVersionFile)) {
          return { initdb: true, dataDir, username: profile.username || 'kitsuneserv', args: ['start', '-D', dataDir, '-l', path.join(dataDir, 'log.txt'), '-o', `-p ${profile.port || 5432}`], env: {}, logFiles: [path.join(dataDir, 'log.txt')],
            postInit: () => this._writePostgresqlConf(dataDir, profile) };
        }
        this._writePostgresqlConf(dataDir, profile);
        return { args: ['start', '-D', dataDir, '-l', path.join(dataDir, 'log.txt'), '-o', `-p ${profile.port || 5432}`], env: {}, logFiles: [path.join(dataDir, 'log.txt')] };
      }
      case 'redis': {
        // Write redis.conf so customConfig is applied
        const redisConfDir = path.join(installPath, 'conf');
        if (!fs.existsSync(redisConfDir)) fs.mkdirSync(redisConfDir, { recursive: true });
        let redisConf = `bind ${profile.host || '127.0.0.1'}\nport ${profile.port || 6379}\n`;
        if (profile.maxMemory) redisConf += `maxmemory ${profile.maxMemory}\n`;
        if (profile.maxMemoryPolicy) redisConf += `maxmemory-policy ${profile.maxMemoryPolicy}\n`;
        if (profile.databases) redisConf += `databases ${profile.databases}\n`;
        if (profile.appendOnly) redisConf += `appendonly yes\n`;
        if (profile.save) redisConf += `save ${profile.save}\n`;
        if (profile.requirePass) redisConf += `requirepass ${profile.requirePass}\n`;
        redisConf += `loglevel ${profile.logLevel || 'notice'}\n`;
        if (profile.customConfig) redisConf += `\n# Custom config\n${profile.customConfig}\n`;
        const redisConfPath = path.join(redisConfDir, 'redis.conf');
        fs.writeFileSync(redisConfPath, redisConf, 'utf-8');
        return { args: [redisConfPath], env: {} };
      }
      case 'mongodb': {
        const dataDir = path.resolve(profile.dataDir || `./data/mongodb-${profile.version}`);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (profile.customConfig) {
          // Write mongod.conf YAML file with custom config appended
          let mongodConf = `storage:\n  dbPath: "${dataDir.replace(/\\/g, '/')}"\n`;
          if (profile.wiredTigerCacheSizeGB) mongodConf += `  wiredTiger:\n    engineConfig:\n      cacheSizeGB: ${profile.wiredTigerCacheSizeGB}\n`;
          mongodConf += `net:\n  port: ${profile.port || 27017}\n  bindIp: ${profile.host || '127.0.0.1'}\n`;
          if (profile.maxConnections) mongodConf += `  maxIncomingConnections: ${profile.maxConnections}\n`;
          if (profile.auth) mongodConf += `security:\n  authorization: enabled\n`;
          if (profile.logging) {
            mongodConf += `systemLog:\n  destination: file\n  path: "${path.join(dataDir, 'mongod.log').replace(/\\/g, '/')}"\n  logAppend: true\n`;
            if (profile.logLevel) {
              const mongoVerbosity = { debug: 2, info: 1, warning: 0, error: 0 };
              mongodConf += `  verbosity: ${mongoVerbosity[profile.logLevel] ?? 0}\n`;
            }
          }
          mongodConf += `\n# Custom config\n${profile.customConfig}\n`;
          const confPath = path.join(dataDir, 'mongod.conf');
          fs.writeFileSync(confPath, mongodConf, 'utf-8');
          return { args: ['--config', confPath], env: {}, logFiles: profile.logging ? [path.join(dataDir, 'mongod.log')] : [] };
        }
        // Fallback to CLI args when no custom config
        const args = ['--dbpath', dataDir, '--port', String(profile.port || 27017), '--bind_ip', profile.host || '127.0.0.1'];
        if (profile.maxConnections) args.push('--maxConns', String(profile.maxConnections));
        if (profile.auth) args.push('--auth');
        if (profile.wiredTigerCacheSizeGB) args.push('--wiredTigerCacheSizeGB', String(profile.wiredTigerCacheSizeGB));
        if (profile.logging) {
          args.push('--logpath', path.join(dataDir, 'mongod.log'));
          if (profile.logLevel === 'debug') args.push('-vv');
          else if (profile.logLevel === 'info') args.push('-v');
        }
        return { args, env: {}, logFiles: profile.logging ? [path.join(dataDir, 'mongod.log')] : [] };
      }
      case 'mysql': {
        const dataDir = path.resolve(profile.dataDir || `./data/mysql-${profile.version}`);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const needsInit = !fs.existsSync(path.join(dataDir, 'mysql'));
        const myCnfName = this._isWindows() ? 'my.ini' : 'my.cnf';

        // Generate config file
        const myIni = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${profile.port || 3306}
bind-address=${profile.host || '127.0.0.1'}
max_connections=${profile.maxConnections || 100}
innodb_buffer_pool_size=${profile.innodbBufferPoolSize || '128M'}
innodb_log_file_size=${profile.innodbLogFileSize || '48M'}
key_buffer_size=${profile.keyBufferSize || '16M'}
sort_buffer_size=${profile.sortBufferSize || '2M'}
${profile.logging ? 'general_log=1' : 'general_log=0'}
${profile.logLevel === 'debug' ? 'log_error_verbosity=3' : profile.logLevel === 'info' ? 'log_error_verbosity=3' : profile.logLevel === 'warning' ? 'log_error_verbosity=2' : profile.logLevel === 'error' ? 'log_error_verbosity=1' : ''}
${profile.customConfig || ''}
`;
        fs.writeFileSync(path.join(installPath, myCnfName), myIni, 'utf-8');

        const args = [`--defaults-file=${path.join(installPath, myCnfName)}`];
        return { initMysql: needsInit, dataDir, args, env: {} };
      }
      case 'mariadb': {
        const dataDir = path.resolve(profile.dataDir || `./data/mariadb-${profile.version}`);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const needsInit = !fs.existsSync(path.join(dataDir, 'mysql'));
        const myCnfName = this._isWindows() ? 'my.ini' : 'my.cnf';

        // Generate config file
        const myIni = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${profile.port || 3306}
bind-address=${profile.host || '127.0.0.1'}
max_connections=${profile.maxConnections || 100}
innodb_buffer_pool_size=${profile.innodbBufferPoolSize || '128M'}
innodb_log_file_size=${profile.innodbLogFileSize || '48M'}
key_buffer_size=${profile.keyBufferSize || '16M'}
sort_buffer_size=${profile.sortBufferSize || '2M'}
${profile.logging ? 'general_log=1' : 'general_log=0'}
${profile.logLevel === 'debug' ? 'log_warnings=9' : profile.logLevel === 'info' ? 'log_warnings=3' : profile.logLevel === 'warning' ? 'log_warnings=2' : profile.logLevel === 'error' ? 'log_warnings=1' : ''}
${profile.queryCache ? 'query_cache_type=1\nquery_cache_size=32M' : ''}
${profile.customConfig || ''}
`;
        fs.writeFileSync(path.join(installPath, myCnfName), myIni, 'utf-8');

        const args = [`--defaults-file=${path.join(installPath, myCnfName)}`];
        return { initMariadb: needsInit, dataDir, args, env: {} };
      }
      case 'go': {
        const project = profile.project ? this._projectEntry('go', profile.project, profile.entryPoint || 'main.go') : null;
        const projectDir = project?.projectDir || null;
        const entryPoint = project?.entryPoint || path.resolve(profile.entryPoint || 'main.go');
        const envVars = { PORT: String(profile.port || 8080) };
        this._mergeEnvVars(envVars, profile.envVars);
        const goArgs = ['run'];
        if (profile.buildFlags) {
          const flags = profile.buildFlags.trim().split(/\s+/).filter(Boolean);
          goArgs.push(...flags);
        }
        goArgs.push(entryPoint);
        return { args: goArgs, env: envVars, cwd: projectDir || path.dirname(entryPoint) };
      }
      case 'bun': {
        const project = profile.project ? this._projectEntry('bun', profile.project, profile.entryPoint || 'server.ts') : null;
        const projectDir = project?.projectDir || null;
        const entryPoint = project?.entryPoint || path.resolve(profile.entryPoint || 'server.ts');
        const envVars = { NODE_ENV: profile.env || 'development', PORT: String(profile.port || 3001) };
        this._mergeEnvVars(envVars, profile.envVars);
        const args = ['run'];
        if (profile.watchMode) args.push('--watch');
        args.push(entryPoint);
        return { args, env: envVars, cwd: projectDir || path.dirname(entryPoint) };
      }
      case 'memcached': {
        const args = ['-p', String(profile.port || 11211), '-l', profile.host || '127.0.0.1',
          '-m', String(profile.maxMemory || 64), '-t', String(profile.threads || 4),
          '-c', String(profile.maxConnections || 1024)];
        if (profile.verboseLogging) args.push('-vv');
        // Append extra args from customConfig (space-separated flags)
        if (profile.customConfig) {
          const extra = profile.customConfig.trim().split(/\s+/).filter(Boolean);
          args.push(...extra);
        }
        return { args, env: {} };
      }
      case 'python': {
        const project = profile.project ? this._projectEntry('python', profile.project, profile.entryPoint || 'app.py') : null;
        const projectDir = project?.projectDir || null;
        const entryPoint = project?.entryPoint || path.resolve(profile.entryPoint || 'app.py');
        const envVars = { PORT: String(profile.port || 8000) };
        this._mergeEnvVars(envVars, profile.envVars);
        return { args: [entryPoint], env: envVars, cwd: projectDir || path.dirname(entryPoint) };
      }
      case 'deno': {
        const project = profile.project ? this._projectEntry('deno', profile.project, profile.entryPoint || 'main.ts') : null;
        const projectDir = project?.projectDir || null;
        const entryPoint = project?.entryPoint || path.resolve(profile.entryPoint || 'main.ts');
        const envVars = { PORT: String(profile.port || 8000) };
        this._mergeEnvVars(envVars, profile.envVars);
        const args = ['run'];
        if (profile.allowNet) args.push('--allow-net');
        if (profile.allowRead) args.push('--allow-read');
        if (profile.allowWrite) args.push('--allow-write');
        if (profile.allowEnv) args.push('--allow-env');
        if (profile.allowRun) args.push('--allow-run');
        if (profile.allowSys) args.push('--allow-sys');
        if (profile.allowFfi) args.push('--allow-ffi');
        if (profile.watchMode) args.push('--watch');
        args.push(entryPoint);
        return { args, env: envVars, cwd: projectDir || path.dirname(entryPoint) };
      }
      case 'caddy': {
        const confDir = path.join(installPath, 'conf');
        if (!fs.existsSync(confDir)) fs.mkdirSync(confDir, { recursive: true });
        const docRoot = this._resolveDocumentRoot(profile);
        if (!fs.existsSync(docRoot)) fs.mkdirSync(docRoot, { recursive: true });

        let globalBlock = '';
        const addr = profile.serverName || 'localhost';
        const port = profile.port || 8443;

        // Global log level
        if (profile.logLevel && profile.logLevel !== 'INFO') {
          globalBlock = `{\n    log {\n        level ${profile.logLevel}\n    }\n}\n`;
        }

        let caddyfile = globalBlock;

        if (profile.autoHttps) {
          caddyfile += `${addr} {\n`;
        } else if (!profile.autoHttps && profile.httpPort && profile.httpPort !== port) {
          caddyfile += `:${profile.httpPort}, :${port} {\n`;
        } else {
          caddyfile += `:${port} {\n`;
        }

        if (profile.encode) caddyfile += '    encode gzip zstd\n';
        if (profile.sslCertificate && profile.sslCertificateKey) {
          caddyfile += `    tls "${path.resolve(profile.sslCertificate).replace(/\\/g, '/')}" "${path.resolve(profile.sslCertificateKey).replace(/\\/g, '/')}"\n`;
        }

        // PHP support for the main document root, /adminer/ and /apps/
        const caddyConfig = this.configManager.getConfig();
        const phpSectionCaddy = caddyConfig.php;
        let phpPortCaddy = null;
        if (phpSectionCaddy?.enabled !== false && profile.phpEnabled !== false) {
          const phpProfileCaddy = this.configManager.getActiveProfile(caddyConfig, 'php');
          if (phpProfileCaddy) phpPortCaddy = phpProfileCaddy.port || 9000;
        }

        if (profile.fileServer) {
          caddyfile += `    root * "${docRoot.replace(/\\/g, '/')}"\n`;
          if (phpPortCaddy) {
            caddyfile += `    php_fastcgi 127.0.0.1:${phpPortCaddy}\n`;
          }
          caddyfile += `    file_server\n`;
        }
        if (profile.reverseProxyTarget) {
          if (profile.reverseProxy) {
            caddyfile += `    handle_path ${profile.reverseProxy} {\n        reverse_proxy ${profile.reverseProxyTarget}\n    }\n`;
          } else {
            caddyfile += `    reverse_proxy ${profile.reverseProxyTarget}\n`;
          }
        }

        if (phpPortCaddy) {
          const adminerDirCaddy = path.resolve('./utils/adminer').replace(/\\/g, '/');
          const appsDirCaddy = path.resolve('./www/apps').replace(/\\/g, '/');
          caddyfile += `    handle_path /adminer/* {\n`;
          caddyfile += `        root * "${adminerDirCaddy}"\n`;
          caddyfile += `        php_fastcgi 127.0.0.1:${phpPortCaddy}\n`;
          caddyfile += `        file_server\n`;
          caddyfile += `    }\n`;
          caddyfile += `    handle_path /apps/* {\n`;
          caddyfile += `        root * "${appsDirCaddy}"\n`;
          caddyfile += `        php_fastcgi 127.0.0.1:${phpPortCaddy}\n`;
          caddyfile += `        file_server\n`;
          caddyfile += `    }\n`;
        }

        if (profile.accessLog) caddyfile += '    log {\n        output file conf/access.log\n    }\n';
        if (profile.corsEnabled) {
          caddyfile += '    header {\n';
          caddyfile += '        Access-Control-Allow-Origin *\n';
          caddyfile += '        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"\n';
          caddyfile += '        Access-Control-Allow-Headers "Authorization, Content-Type, Accept"\n';
          caddyfile += '        Access-Control-Max-Age 86400\n';
          caddyfile += '    }\n';
        }
        if (profile.customConfig) caddyfile += '    ' + profile.customConfig.replace(/\n/g, '\n    ') + '\n';
        caddyfile += '}\n';

        fs.writeFileSync(path.join(confDir, 'Caddyfile'), caddyfile, 'utf-8');
        return {
          args: ['run', '--config', path.join(confDir, 'Caddyfile'), '--adapter', 'caddyfile'],
          env: {},
          logFiles: profile.accessLog ? [path.join(confDir, 'access.log')] : []
        };
      }
      case 'minio': {
        const dataDir = path.resolve(profile.dataDir || `./data/minio-${profile.version}`);
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        const envVars = {
          MINIO_ROOT_USER: profile.rootUser || 'minioadmin',
          MINIO_ROOT_PASSWORD: profile.rootPassword || 'minioadmin'
        };
        if (profile.browserEnabled === false) envVars.MINIO_BROWSER = 'off';
        const args = ['server', dataDir, '--address', `${profile.host || '0.0.0.0'}:${profile.port || 9000}`, '--console-address', `${profile.host || '0.0.0.0'}:${profile.consolePort || 9001}`];
        return { args, env: envVars };
      }
      default: return { args: [], env: {} };
    }
  }

  _checkDependencies(section, config) {
    const warnings = [];
    // Web servers need PHP if mod_proxy_fcgi or php is configured
    if (WEB_SERVICES.includes(section) && this._webServerNeedsPhp(section, config)) {
      const phpSection = config.php;
      if (phpSection?.enabled !== false) {
        const phpProfile = this.configManager.getActiveProfile(config, 'php');
        if (phpProfile && !this.downloadManager.isInstalled('php', phpProfile.version)) {
          warnings.push(`PHP ${phpProfile.version} is not installed — PHP integration will not work`);
        }
      }
    }
    // Runtime services need their binary installed
    if (['node', 'go', 'bun', 'python', 'deno'].includes(section)) {
      const profile = this.configManager.getActiveProfile(config, section);
      if (profile && profile.project) {
        try {
          const projectDir = this._projectDir(section, profile.project);
          if (!fs.existsSync(projectDir)) warnings.push(`Project directory "${profile.project}" does not exist — create it first`);
        } catch {
          warnings.push('The configured project path is invalid');
        }
      }
    }
    // Database services: warn about data dir on first start
    if (['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(section)) {
      const profile = this.configManager.getActiveProfile(config, section);
      if (profile) {
        const dataDir = path.resolve(profile.dataDir || `./data/${section}-${profile.version}`);
        if (!fs.existsSync(dataDir)) {
          warnings.push(`Data directory will be initialized on first start`);
        }
      }
    }
    return warnings;
  }

  /**
   * Auto-start PHP FastCGI if Apache (modProxyFcgi) or Nginx needs it.
   */
  async _autoStartPhpIfNeeded(section, config) {
    if (!this._webServerNeedsPhp(section, config)) return { required: false, success: true };
    if (this.processes.has('php')) return { required: true, success: true };
    const result = await this.startService('php');
    if (result.success) return { required: true, success: true, message: 'PHP FastCGI auto-started' };
    return { required: true, success: false, error: result.error || 'PHP FastCGI could not be started' };
  }

  async _stopPhpIfOrphaned() {
    if (!this.processes.has('php')) return;
    const config = this.configManager.getConfig();
    const hasDependentWeb = WEB_SERVICES.some(service => this.processes.has(service) && this._webServerNeedsPhp(service, config));
    if (!hasDependentWeb) await this.stopService('php', { keepPhp: true });
  }

  validateConfigChange(proposedConfig) {
    if (!proposedConfig || typeof proposedConfig !== 'object') return { success: false, error: 'Invalid configuration' };
    const current = this.configManager.getConfig();
    for (const section of SERVICE_IDS) {
      const currentProfile = this.configManager.getActiveProfile(current, section);
      const proposedProfile = this.configManager.getActiveProfile(proposedConfig, section);
      const affectsRunningStack = this.processes.has(section)
        || (section === 'php' && WEB_SERVICES.some(web => this.processes.has(web) && this._webServerNeedsPhp(web, current)));
      if (!affectsRunningStack || !currentProfile) continue;
      if (!proposedProfile) return { success: false, error: `The active ${section} configuration cannot be removed while it is running` };
      if (currentProfile.id !== proposedProfile.id || currentProfile.version !== proposedProfile.version) {
        return { success: false, error: `Use the profile/version switch action while ${section} is running` };
      }
      if (section === 'php' && Number(currentProfile.port || 9000) !== Number(proposedProfile.port || 9000)) {
        return { success: false, error: 'Stop the web stack before changing the PHP FastCGI port' };
      }
    }
    return { success: true };
  }

  async _restorePreviousStack(config, section, sectionWasRunning, dependentWebs) {
    const errors = [];
    this.configManager.saveConfig(config);
    if (section === 'php') {
      if ((sectionWasRunning || dependentWebs.length) && !this.processes.has('php')) {
        const phpResult = await this.startService('php');
        if (!phpResult.success) errors.push(`PHP rollback start failed: ${phpResult.error}`);
      }
      for (const web of dependentWebs) {
        if (this.processes.has(web)) continue;
        const result = await this.startService(web);
        if (!result.success) errors.push(`${web} rollback start failed: ${result.error}`);
      }
    } else if (sectionWasRunning && !this.processes.has(section)) {
      const result = await this.startService(section);
      if (!result.success) errors.push(`${section} rollback start failed: ${result.error}`);
    }
    return errors;
  }

  async _applyActiveRuntimeChange(section, mutateConfig) {
    if (!MANAGED_IDS.includes(section)) return { success: false, error: 'Unknown managed component' };
    const previousConfig = this.configManager.getConfig();
    const nextConfig = JSON.parse(JSON.stringify(previousConfig));
    const previousProfile = this.configManager.getActiveProfile(previousConfig, section);
    if (!previousProfile) return { success: false, error: `No active profile for ${section}` };

    const mutation = mutateConfig(nextConfig);
    if (mutation?.success === false) return mutation;
    const nextProfile = this.configManager.getActiveProfile(nextConfig, section);
    if (!nextProfile) return { success: false, error: `No target profile for ${section}` };
    if (previousProfile.id === nextProfile.id && previousProfile.version === nextProfile.version) {
      return { success: true, config: previousConfig, restarted: [], previousVersion: previousProfile.version, version: nextProfile.version };
    }

    const dependentWebs = section === 'php'
      ? WEB_SERVICES.filter(web => this.processes.has(web) && this._webServerNeedsPhp(web, previousConfig))
      : [];
    const sectionWasRunning = this.processes.has(section);
    const needsRestart = sectionWasRunning || dependentWebs.length > 0;
    if (needsRestart && !this.downloadManager.isInstalled(section, nextProfile.version)) {
      return { success: false, error: `${section} ${nextProfile.version} is not installed. Download it first.`, needsDownload: true };
    }

    const stopped = [];
    const started = [];
    try {
      for (const web of dependentWebs) {
        const result = await this.stopService(web, { keepPhp: true });
        if (!result.success) throw new Error(`Could not stop ${web}: ${result.error}`);
        stopped.push(web);
      }
      if (sectionWasRunning) {
        const result = await this.stopService(section, { keepPhp: true });
        if (!result.success) throw new Error(`Could not stop ${section}: ${result.error}`);
        stopped.push(section);
      }

      const saved = this.configManager.saveConfig(nextConfig);
      if (!saved.success) throw new Error(saved.error || 'Could not save the new configuration');

      if (section === 'php') {
        if (needsRestart) {
          const phpResult = await this.startService('php');
          if (!phpResult.success) throw new Error(`PHP ${nextProfile.version} failed to start: ${phpResult.error}`);
          started.push('php');
        }
        for (const web of dependentWebs) {
          const result = await this.startService(web);
          if (!result.success) throw new Error(`${web} failed after the PHP switch: ${result.error}`);
          started.push(web);
        }
      } else if (sectionWasRunning) {
        const result = await this.startService(section);
        if (!result.success) throw new Error(`${section} ${nextProfile.version} failed to start: ${result.error}`);
        started.push(section);
      }

      return {
        success: true,
        config: this.configManager.getConfig(),
        restarted: started,
        previousVersion: previousProfile.version,
        version: nextProfile.version
      };
    } catch (err) {
      for (const service of [...started].reverse()) {
        if (this.processes.has(service)) await this.stopService(service, { keepPhp: true });
      }
      const rollbackErrors = await this._restorePreviousStack(previousConfig, section, sectionWasRunning, dependentWebs);
      return {
        success: false,
        error: `${err.message}. Previous configuration restored.${rollbackErrors.length ? ` ${rollbackErrors.join('; ')}` : ''}`,
        rolledBack: true,
        config: this.configManager.getConfig()
      };
    }
  }

  async switchVersion(section, version) {
    try { assertSafeSegment(version, 'version'); }
    catch (err) { return { success: false, error: err.message }; }
    if (!this.downloadManager.isInstalled(section, version)) {
      return { success: false, error: `${section} ${version} is not installed. Download it first.`, needsDownload: true };
    }
    return this._applyActiveRuntimeChange(section, config => {
      const profile = this.configManager.getActiveProfile(config, section);
      if (!profile) return { success: false, error: `No active profile for ${section}` };
      const previousVersion = profile.version;
      if (typeof profile.name === 'string' && profile.name.endsWith(` ${previousVersion}`)) {
        profile.name = `${profile.name.slice(0, -previousVersion.length)}${version}`;
      }
      if (profile.dataDir === `./data/${section}-${previousVersion}`) {
        profile.dataDir = `./data/${section}-${version}`;
      }
      profile.version = version;
      return { success: true };
    });
  }

  async switchProfile(section, profileId) {
    try { assertSafeSegment(profileId, 'profile id'); }
    catch (err) { return { success: false, error: err.message }; }
    return this._applyActiveRuntimeChange(section, config => {
      const service = config[section];
      if (!service) return { success: false, error: 'Unknown service' };
      if (!service.profiles.some(profile => profile.id === profileId)) return { success: false, error: 'Profile not found' };
      service.activeProfileId = profileId;
      return { success: true };
    });
  }

  _checkPortConflict(section, port) {
    if (!port) return null;
    const config = this.configManager.getConfig();
    const allSections = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
    for (const other of allSections) {
      if (other === section) continue;
      if (!this.processes.has(other)) continue;
      const otherProfile = this.configManager.getActiveProfile(config, other);
      if (otherProfile) {
        const otherPorts = [otherProfile.port, otherProfile.sslPort, otherProfile.consolePort, otherProfile.httpPort].filter(Boolean).map(Number);
        if (otherPorts.includes(Number(port))) {
          return other;
        }
      }
    }
    return null;
  }

  _isSystemPortInUse(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      server.once('error', () => resolve(true));
      server.once('listening', () => { server.close(); resolve(false); });
      server.listen(port, '127.0.0.1');
    });
  }

  async startService(section) {
    if (!SERVICE_IDS.includes(section)) return { success: false, error: 'Unknown service' };
    if (this.processes.has(section)) return { success: false, error: `${section} is already running` };

    const config = this.configManager.getConfig();
    const svcSection = config[section];
    if (!svcSection) return { success: false, error: `${section} is not configured` };

    const profile = this.configManager.getActiveProfile(config, section);
    if (!profile) return { success: false, error: `No active profile for ${section}` };

    // Service dependency checks
    const depWarnings = this._checkDependencies(section, config);

    // MinIO default credentials warning
    if (section === 'minio' && profile.rootUser === 'minioadmin' && profile.rootPassword === 'minioadmin') {
      depWarnings.push('MinIO is using default credentials (minioadmin/minioadmin). Change them in the MinIO profile.');
    }

    // Validate before probing the port to avoid invalid listen() calls.
    const port = Number(profile.port);
    if (profile.port && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      return { success: false, error: `Invalid port ${profile.port}. Must be between 1 and 65535.` };
    }

    // Check for port conflict with running services
    const conflict = this._checkPortConflict(section, profile.port);
    if (conflict) {
      return { success: false, error: `Port ${profile.port} is already in use by ${conflict}. Change the port or stop ${conflict} first.` };
    }

    // Check if port is in use by the system (outside KitsuneServ)
    if (profile.port) {
      const systemBusy = await this._isSystemPortInUse(profile.port);
      if (systemBusy) {
        return { success: false, error: `Port ${profile.port} is already in use by another application on your system.` };
      }
    }

    const dlKey = this._resolveDownloadKey(profile, section);
    const version = profile.version;

    if (!this.downloadManager.isInstalled(dlKey, version)) {
      return { success: false, error: `${dlKey} ${version} is not installed. Download it first.`, needsDownload: true };
    }

    let installPath;
    let buildInfo;
    try {
      installPath = this.downloadManager.getInstallPath(dlKey, version);
      installPath = this._resolveServiceHome(installPath, dlKey);
      buildInfo = this._buildArgs(section, profile, installPath);
    } catch (err) {
      return { success: false, error: err.message };
    }

    let exePath = this._findExecutable(installPath, dlKey);
    if (buildInfo.exe) {
      const alt = path.join(installPath, buildInfo.exe);
      if (fs.existsSync(alt)) exePath = alt;
    }
    if (!exePath) return { success: false, error: `Could not find executable for ${dlKey} in ${installPath}` };

    // Start PHP only after the web server itself has passed validation. A PHP
    // failure is fatal here; starting a server that can only return 502 is not
    // a successful stack start.
    const phpDependency = await this._autoStartPhpIfNeeded(section, config);
    if (!phpDependency.success) {
      return { success: false, error: `Cannot start ${section}: ${phpDependency.error}`, dependency: 'php' };
    }
    if (phpDependency.message) depWarnings.push(phpDependency.message);
    const phpStartedForService = Boolean(phpDependency.message);

    // PostgreSQL initdb
    if (buildInfo.initdb) {
      const initdbExe = this._findFile(installPath, this._isWindows() ? ['bin/initdb.exe', 'pgsql/bin/initdb.exe'] : ['bin/initdb', 'pgsql/bin/initdb']);
      if (initdbExe) {
        try {
          await this._runCommand(initdbExe, ['-D', buildInfo.dataDir, '-U', buildInfo.username, '-E', 'UTF8']);
          if (buildInfo.postInit) buildInfo.postInit();
        } catch (err) {
          return { success: false, error: `initdb failed: ${err.message}` };
        }
      }
    }

    // MySQL initialize data directory
    if (buildInfo.initMysql) {
      try {
        await this._runCommand(exePath, ['--initialize-insecure', `--datadir=${buildInfo.dataDir}`, `--basedir=${installPath}`]);
      } catch (err) {
        return { success: false, error: `MySQL init failed: ${err.message}` };
      }
    }

    // MariaDB initialize data directory
    if (buildInfo.initMariadb) {
      const installDb = this._findFile(installPath, this._isWindows() ? ['bin/mysql_install_db.exe', 'bin/mariadb-install-db.exe'] : ['bin/mysql_install_db', 'bin/mariadb-install-db', 'scripts/mysql_install_db']);
      if (installDb) {
        try {
          await this._runCommand(installDb, [`--datadir=${buildInfo.dataDir}`]);
        } catch (err) {
          return { success: false, error: `MariaDB init failed: ${err.message}` };
        }
      } else {
        // Fallback: use mysqld/mariadbd --initialize-insecure
        try {
          await this._runCommand(exePath, ['--initialize-insecure', `--datadir=${buildInfo.dataDir}`, `--basedir=${installPath}`]);
        } catch (err) {
          return { success: false, error: `MariaDB init failed: ${err.message}` };
        }
      }
    }

    try {
      const env = { ...process.env, ...buildInfo.env };
      const spawnCwd = buildInfo.cwd || buildInfo.dataDir || installPath;
      const spawnOpts = { env, cwd: spawnCwd, stdio: ['ignore', 'pipe', 'pipe'] };
      if (this._isWindows()) spawnOpts.windowsHide = true;
      const logTracker = this._createLogTracker(buildInfo.logFiles);
      const child = spawn(exePath, buildInfo.args, spawnOpts);

      this.processes.set(section, { process: child, pid: child.pid, startedAt: Date.now(), profileId: profile.id, logTracker });
      this.logs.set(section, []);
      const logArr = this.logs.get(section);
      this._pushLog(logArr, `[KitsuneServ] Started ${section} ${profile.version} (PID ${child.pid}).\n`);
      this._startLogTracker(logArr, logTracker);

      child.stdout.on('data', (data) => this._pushLog(logArr, data.toString()));
      child.stderr.on('data', (data) => this._pushLog(logArr, '[ERR] ' + data.toString()));
      child.on('exit', (code) => {
        this._stopLogTracker(logArr, logTracker);
        this.processes.delete(section);
        this._pushLog(logArr, `[KitsuneServ] Process exited with code ${code}\n`);
        // Auto-restart if enabled and not intentionally stopped
        // Skip if watchMode is active on runtimes that handle their own restart (--watch)
        const watchModeActive = profile.watchMode && ['node', 'bun', 'deno'].includes(section);
        if (code !== 0 && profile.autoRestart && !watchModeActive && !this._stoppingAll && !this._stoppingSections?.has(section)) {
          this._pushLog(logArr, `[KitsuneServ] Auto-restarting ${section}...\n`);
          setTimeout(() => this.startService(section), 2000);
        }
        // Emit exit event for crash notification
        if (this._onServiceExit) this._onServiceExit(section, code);
      });
      child.on('error', (err) => {
        this._stopLogTracker(logArr, logTracker);
        this.processes.delete(section);
        this._pushLog(logArr, `[KitsuneServ] Process error: ${err.message}\n`);
        if (this._onServiceExit) this._onServiceExit(section, -1);
      });

      // Wait briefly to detect immediate crash (bad config, missing DLL, etc.)
      const crashed = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), 1500);
        child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
        child.once('error', () => { clearTimeout(timer); resolve(-1); });
      });
      if (crashed !== false) {
        const lastLogs = logArr.slice(-5).join('').trim();
        if (phpStartedForService) await this._stopPhpIfOrphaned();
        return { success: false, error: `${section} exited immediately (code ${crashed}). ${lastLogs}` };
      }

      return { success: true, pid: child.pid, warnings: depWarnings };
    } catch (err) {
      if (phpStartedForService) await this._stopPhpIfOrphaned();
      return { success: false, error: err.message };
    }
  }

  stopService(section, options = {}) {
    const info = this.processes.get(section);
    if (!info) return Promise.resolve({ success: false, error: `${section} is not running` });

    // Mark as intentionally stopping to prevent auto-restart
    if (!this._stoppingSections) this._stoppingSections = new Set();
    this._stoppingSections.add(section);

    const config = this.configManager.getConfig();
    const stopTimeout = config.general?.stopTimeout || 5000;

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = async (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        info.process.removeListener('exit', onExit);
        this._stopLogTracker(this.logs.get(section), info.logTracker);
        this.processes.delete(section);
        setTimeout(() => this._stoppingSections?.delete(section), 2000);
        if (WEB_SERVICES.includes(section) && !options.keepPhp && !this._stoppingAll) {
          await this._stopPhpIfOrphaned();
        }
        resolve(result);
      };
      const onExit = () => { void finish({ success: true }); };
      timer = setTimeout(async () => {
        info.process.removeListener('exit', onExit);
        await this._forceKill(info.process);
        void finish({ success: true });
      }, stopTimeout);
      info.process.once('exit', onExit);

      try {
        const profile = this.configManager.getActiveProfile(config, section);
        const dlKey = profile ? this._resolveDownloadKey(profile, section) : section;

        const _spawnOpts = this._isWindows() ? { windowsHide: true } : {};
        if (dlKey === 'nginx' && profile) {
          const installPath = this.downloadManager.getInstallPath(dlKey, profile.version);
          const nginxExe = this._findExecutable(installPath, dlKey);
          if (nginxExe) spawn(nginxExe, ['-p', installPath, '-s', 'quit'], _spawnOpts);
        } else if (dlKey === 'apache' && profile) {
          const installPath = this._resolveServiceHome(this.downloadManager.getInstallPath(dlKey, profile.version), dlKey);
          const httpdExe = this._findExecutable(installPath, dlKey);
          if (httpdExe) spawn(httpdExe, ['-k', 'stop', '-d', installPath, '-f', path.join(installPath, 'conf', 'httpd.conf')], _spawnOpts);
          else { info.process.kill('SIGTERM'); }
        } else if (dlKey === 'postgresql' && profile) {
          const installPath = this._resolveServiceHome(this.downloadManager.getInstallPath(dlKey, profile.version), dlKey);
          const pgCtl = this._findFile(installPath, this._isWindows() ? ['bin/pg_ctl.exe', 'pgsql/bin/pg_ctl.exe'] : ['bin/pg_ctl', 'pgsql/bin/pg_ctl']);
          const dataDir = path.resolve(profile.dataDir || `./data/postgresql-${profile.version}`);
          if (pgCtl) spawn(pgCtl, ['stop', '-D', dataDir, '-m', 'fast'], _spawnOpts);
        } else if ((dlKey === 'mysql' || dlKey === 'mariadb') && profile) {
          const installPath = this.downloadManager.getInstallPath(dlKey, profile.version);
          const admin = this._findFile(installPath, this._isWindows() ? ['bin/mysqladmin.exe', 'bin/mariadb-admin.exe'] : ['bin/mysqladmin', 'bin/mariadb-admin']);
          const port = profile.port || 3306;
          const user = profile.username || 'root';
          if (admin) {
            const adminEnv = { ...process.env };
            if (profile.password) adminEnv.MYSQL_PWD = String(profile.password);
            spawn(admin, ['-u', user, `--port=${port}`, 'shutdown'], { ..._spawnOpts, env: adminEnv });
          } else {
            info.process.kill('SIGTERM');
            setTimeout(() => { try { info.process.kill('SIGKILL'); } catch { } }, stopTimeout);
          }
        } else {
          info.process.kill('SIGTERM');
          setTimeout(() => { try { info.process.kill('SIGKILL'); } catch { } }, stopTimeout);
        }
      } catch (err) {
        void (async () => {
          await this._forceKill(info.process);
          await finish({ success: false, error: err.message });
        })();
      }
    });
  }

  getServiceStatus(section) {
    const info = this.processes.get(section);
    if (!info) return { running: false };
    return { running: true, pid: info.pid, uptime: Date.now() - info.startedAt, profileId: info.profileId };
  }

  _forceKill(child) {
    if (!child || !child.pid) return Promise.resolve();
    return new Promise(resolve => {
      try {
        if (this._isWindows()) {
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
        } else {
          child.kill('SIGKILL');
          resolve();
        }
      } catch { resolve(); }
    });
  }

  getAllStatuses() {
    const statuses = {};
    for (const section of ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno']) {
      statuses[section] = this.getServiceStatus(section);
    }
    return statuses;
  }

  getLogs(section, lines = 100) {
    return (this.logs.get(section) || []).slice(-lines);
  }

  clearLogs(section) {
    const logs = this.logs.get(section);
    if (logs) logs.length = 0;
    else this.logs.set(section, []);
    return { success: true };
  }

  async stopAll() {
    this._stoppingAll = true;
    try {
      const promises = [];
      for (const section of [...this.processes.keys()]) {
        promises.push(this.stopService(section));
      }
      return await Promise.allSettled(promises);
    } finally {
      this._stoppingAll = false;
    }
  }

  _findFile(baseDir, candidates) {
    for (const rel of candidates) {
      const full = path.join(baseDir, rel);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  _writePostgresqlConf(dataDir, profile) {
    const confPath = path.join(dataDir, 'postgresql.conf');
    // Only append KitsuneServ-managed settings block
    const marker = '# --- KitsuneServ managed settings ---';
    const settings = `
${marker}
listen_addresses = '${profile.host || '127.0.0.1'}'
max_connections = ${profile.maxConnections || 100}
shared_buffers = ${profile.sharedBuffers || '128MB'}
work_mem = ${profile.workMem || '4MB'}
maintenance_work_mem = ${profile.maintenanceWorkMem || '64MB'}
effective_cache_size = ${profile.effectiveCacheSize || '512MB'}
wal_level = ${profile.walLevel || 'replica'}
logging_collector = ${profile.logging ? 'on' : 'off'}
log_min_messages = ${profile.logLevel || 'warning'}
${profile.customConfig || ''}
${marker} END
`;
    if (fs.existsSync(confPath)) {
      let content = fs.readFileSync(confPath, 'utf-8');
      const regex = new RegExp(`\\n?${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${(marker + ' END').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      content = content.replace(regex, '');
      content += settings;
      fs.writeFileSync(confPath, content, 'utf-8');
    } else {
      // File doesn't exist yet — create it with managed settings
      fs.writeFileSync(confPath, settings, 'utf-8');
    }
  }

  _runCommand(exe, args) {
    return new Promise((resolve, reject) => {
      const opts = { stdio: ['ignore', 'pipe', 'pipe'] };
      if (this._isWindows()) opts.windowsHide = true;
      const child = spawn(exe, args, opts);
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('exit', (code) => { if (code === 0) resolve(); else reject(new Error(stderr || `Exit code ${code}`)); });
      child.on('error', reject);
    });
  }
}

module.exports = ServiceManager;
