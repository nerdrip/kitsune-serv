const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kitsuneAPI', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    reset: () => ipcRenderer.invoke('config:reset'),
    getDefaults: () => ipcRenderer.invoke('config:getDefaults'),
    getAppRoot: () => ipcRenderer.invoke('config:getAppRoot'),
    newProfile: (section, type, version, name) => ipcRenderer.invoke('config:newProfile', section, type, version, name),
    deleteProfile: (section, profileId) => ipcRenderer.invoke('config:deleteProfile', section, profileId),
    duplicateProfile: (section, profileId) => ipcRenderer.invoke('config:duplicateProfile', section, profileId),
    setActiveProfile: (section, profileId) => ipcRenderer.invoke('config:setActiveProfile', section, profileId),
    setDocumentRoot: (section, directory) => ipcRenderer.invoke('config:setDocumentRoot', section, directory),
    setGlobalDocumentRoot: (enabled, directory) => ipcRenderer.invoke('config:setGlobalDocumentRoot', enabled, directory),
    renameProfile: (section, profileId, newName) => ipcRenderer.invoke('config:renameProfile', section, profileId, newName),
    exportConfig: () => ipcRenderer.invoke('config:export'),
    importConfig: () => ipcRenderer.invoke('config:import')
  },
  download: {
    getVersions: () => ipcRenderer.invoke('download:getVersions'),
    catalog: () => ipcRenderer.invoke('download:catalog'),
    refreshCatalog: () => ipcRenderer.invoke('download:refreshCatalog'),
    status: () => ipcRenderer.invoke('download:status'),
    isInstalled: (service, version) => ipcRenderer.invoke('download:isInstalled', service, version),
    installedVersions: (service) => ipcRenderer.invoke('download:installedVersions', service),
    install: (service, version) => ipcRenderer.invoke('download:install', service, version),
    remove: (service, version) => ipcRenderer.invoke('download:remove', service, version),
    diskUsage: () => ipcRenderer.invoke('download:diskUsage'),
    cacheStatus: () => ipcRenderer.invoke('download:cacheStatus'),
    clearCache: (service, version) => ipcRenderer.invoke('download:clearCache', service, version),
    exportCache: (directory) => ipcRenderer.invoke('download:exportCache', directory),
    importCache: (directory) => ipcRenderer.invoke('download:importCache', directory),
    onProgress: (callback) => {
      ipcRenderer.on('download:progress', (_event, data) => callback(data));
    }
  },
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo')
  },
  db: {
    listDatabases: (section) => ipcRenderer.invoke('db:listDatabases', section),
    listTables: (section, database) => ipcRenderer.invoke('db:listTables', section, database),
    tableData: (section, database, table, limit, offset) => ipcRenderer.invoke('db:tableData', section, database, table, limit, offset),
    executeQuery: (section, database, query) => ipcRenderer.invoke('db:executeQuery', section, database, query),
    createDatabase: (section, name) => ipcRenderer.invoke('db:createDatabase', section, name),
    dropDatabase: (section, name) => ipcRenderer.invoke('db:dropDatabase', section, name),
    getToolUrl: (section, database) => ipcRenderer.invoke('db:getToolUrl', section, database),
    connections: () => ipcRenderer.invoke('db:connections'),
    saveConnection: (connection) => ipcRenderer.invoke('db:saveConnection', connection),
    removeConnection: (id) => ipcRenderer.invoke('db:removeConnection', id),
    testConnection: (connection) => ipcRenderer.invoke('db:testConnection', connection),
    listDatabasesFor: (connection) => ipcRenderer.invoke('db:listDatabasesFor', connection),
    listTablesFor: (connection, database) => ipcRenderer.invoke('db:listTablesFor', connection, database),
    executeQueryFor: (connection, database, query) => ipcRenderer.invoke('db:executeQueryFor', connection, database, query),
    createDatabaseFor: (connection, name) => ipcRenderer.invoke('db:createDatabaseFor', connection, name),
    dropDatabaseFor: (connection, name) => ipcRenderer.invoke('db:dropDatabaseFor', connection, name)
  },
  backup: {
    list: (filters) => ipcRenderer.invoke('backup:list', filters),
    create: (connection, database, options) => ipcRenderer.invoke('backup:create', connection, database, options),
    verify: (id) => ipcRenderer.invoke('backup:verify', id),
    restore: (id, connection, database) => ipcRenderer.invoke('backup:restore', id, connection, database),
    remove: (id) => ipcRenderer.invoke('backup:remove', id),
    schedules: () => ipcRenderer.invoke('backup:schedules'),
    saveSchedule: (schedule) => ipcRenderer.invoke('backup:saveSchedule', schedule),
    removeSchedule: (id) => ipcRenderer.invoke('backup:removeSchedule', id),
    runDue: () => ipcRenderer.invoke('backup:runDue')
  },
  service: {
    start: (service) => ipcRenderer.invoke('service:start', service),
    stop: (service) => ipcRenderer.invoke('service:stop', service),
    restart: (service) => ipcRenderer.invoke('service:restart', service),
    switchVersion: (service, version) => ipcRenderer.invoke('service:switchVersion', service, version),
    status: (service) => ipcRenderer.invoke('service:status', service),
    allStatuses: () => ipcRenderer.invoke('service:allStatuses'),
    logs: (service, lines) => ipcRenderer.invoke('service:logs', service, lines),
    clearLogs: (service) => ipcRenderer.invoke('service:clearLogs', service),
    stopAll: () => ipcRenderer.invoke('service:stopAll'),
    healthCheck: (service) => ipcRenderer.invoke('service:healthCheck', service),
    autoStart: () => ipcRenderer.invoke('service:autoStart'),
    resourceUsage: () => ipcRenderer.invoke('service:resourceUsage'),
    onExited: (callback) => {
      ipcRenderer.on('service:exited', (_event, data) => callback(data));
    }
  },
  terminal: {
    create: () => ipcRenderer.invoke('terminal:create'),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    onData: (callback) => {
      ipcRenderer.on('terminal:data', (_event, data) => callback(data));
    },
    onExit: (callback) => {
      ipcRenderer.on('terminal:exit', (_event, data) => callback(data));
    }
  },
  path: {
    getStatus: () => ipcRenderer.invoke('path:getStatus'),
    apply: (services) => ipcRenderer.invoke('path:apply', services),
    add: (services) => ipcRenderer.invoke('path:add', services),
    remove: (services) => ipcRenderer.invoke('path:remove', services),
    installPythonManager: () => ipcRenderer.invoke('path:installPythonManager'),
    onPythonManagerStatus: (callback) => {
      ipcRenderer.on('path:pythonManagerStatus', (_event, data) => callback(data));
    }
  },
  composer: {
    getStatus: () => ipcRenderer.invoke('composer:getStatus'),
    install: () => ipcRenderer.invoke('composer:install'),
    run: (command, cwd) => ipcRenderer.invoke('composer:run', command, cwd)
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    selectDirectory: (initialPath) => ipcRenderer.invoke('shell:selectDirectory', initialPath),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openSystemSettings: (page) => ipcRenderer.invoke('shell:openSystemSettings', page)
  },
  projects: {
    list: (section) => ipcRenderer.invoke('projects:list', section),
    create: (section, name) => ipcRenderer.invoke('projects:create', section, name),
    delete: (section, name) => ipcRenderer.invoke('projects:delete', section, name)
  },
  workspace: {
    templates: () => ipcRenderer.invoke('workspace:templates'),
    list: () => ipcRenderer.invoke('workspace:list'),
    get: (id) => ipcRenderer.invoke('workspace:get', id),
    create: (options) => ipcRenderer.invoke('workspace:create', options),
    update: (id, patch) => ipcRenderer.invoke('workspace:update', id, patch),
    remove: (id, options) => ipcRenderer.invoke('workspace:remove', id, options),
    start: (id) => ipcRenderer.invoke('workspace:start', id),
    stop: (id) => ipcRenderer.invoke('workspace:stop', id),
    export: (id) => ipcRenderer.invoke('workspace:export', id),
    import: (manifest, options) => ipcRenderer.invoke('workspace:import', manifest, options),
    url: (id) => ipcRenderer.invoke('workspace:url', id),
    open: (id) => ipcRenderer.invoke('workspace:open', id)
  },
  activity: {
    list: (options) => ipcRenderer.invoke('activity:list', options),
    cancel: (id) => ipcRenderer.invoke('activity:cancel', id),
    clear: () => ipcRenderer.invoke('activity:clear'),
    onChanged: (callback) => ipcRenderer.on('activity:changed', (_event, data) => callback(data))
  },
  diagnostics: {
    doctor: (projectId) => ipcRenderer.invoke('diagnostics:doctor', projectId),
    compatibility: (projectId) => ipcRenderer.invoke('diagnostics:compatibility', projectId),
    ports: () => ipcRenderer.invoke('diagnostics:ports'),
    findFreePort: (start, end) => ipcRenderer.invoke('diagnostics:findFreePort', start, end),
    repair: (issue) => ipcRenderer.invoke('diagnostics:repair', issue)
  },
  domain: {
    status: () => ipcRenderer.invoke('domain:status'),
    apply: () => ipcRenderer.invoke('domain:apply'),
    certificateStatus: (domain) => ipcRenderer.invoke('domain:certificateStatus', domain),
    installCertificateAuthority: () => ipcRenderer.invoke('domain:installCertificateAuthority'),
    issueCertificate: (domain) => ipcRenderer.invoke('domain:issueCertificate', domain)
  },
  command: {
    start: (projectId, name, execution, distribution) => ipcRenderer.invoke('command:start', projectId, name, execution, distribution),
    stop: (id) => ipcRenderer.invoke('command:stop', id),
    list: (projectId) => ipcRenderer.invoke('command:list', projectId),
    get: (id) => ipcRenderer.invoke('command:get', id),
    clear: () => ipcRenderer.invoke('command:clear'),
    onOutput: (callback) => ipcRenderer.on('command:output', (_event, data) => callback(data)),
    onExit: (callback) => ipcRenderer.on('command:exit', (_event, data) => callback(data))
  },
  toolchain: { list: () => ipcRenderer.invoke('toolchain:list') },
  ide: {
    list: () => ipcRenderer.invoke('ide:list'),
    open: (projectId, ideId) => ipcRenderer.invoke('ide:open', projectId, ideId)
  },
  environment: {
    export: (label) => ipcRenderer.invoke('environment:export', label),
    inspect: (payload) => ipcRenderer.invoke('environment:inspect', payload),
    apply: (payload, options) => ipcRenderer.invoke('environment:apply', payload, options),
    createSnapshot: (label) => ipcRenderer.invoke('environment:createSnapshot', label),
    listSnapshots: () => ipcRenderer.invoke('environment:listSnapshots'),
    restoreSnapshot: (id, options) => ipcRenderer.invoke('environment:restoreSnapshot', id, options),
    removeSnapshot: (id) => ipcRenderer.invoke('environment:removeSnapshot', id)
  },
  plugin: {
    list: () => ipcRenderer.invoke('plugin:list'),
    install: (directory) => ipcRenderer.invoke('plugin:install', directory),
    setEnabled: (id, enabled) => ipcRenderer.invoke('plugin:setEnabled', id, enabled),
    remove: (id) => ipcRenderer.invoke('plugin:remove', id)
  },
  platform: {
    inventory: () => ipcRenderer.invoke('platform:inventory'),
    wslPath: (directory, distribution) => ipcRenderer.invoke('platform:wslPath', directory, distribution),
    installSystemd: (options) => ipcRenderer.invoke('platform:installSystemd', options),
    removeSystemd: () => ipcRenderer.invoke('platform:removeSystemd')
  },
  tunnel: {
    providers: () => ipcRenderer.invoke('tunnel:providers'),
    list: (projectId) => ipcRenderer.invoke('tunnel:list', projectId),
    start: (projectId, provider) => ipcRenderer.invoke('tunnel:start', projectId, provider),
    stop: (id) => ipcRenderer.invoke('tunnel:stop', id),
    onChanged: (callback) => ipcRenderer.on('tunnel:changed', (_event, data) => callback(data))
  },
  update: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install')
  },
  support: { generate: () => ipcRenderer.invoke('support:generate') },
  security: {
    status: () => ipcRenderer.invoke('security:status'),
    sessions: () => ipcRenderer.invoke('security:sessions'),
    revokeSession: (id) => ipcRenderer.invoke('security:revokeSession', id),
    revokeOtherSessions: () => ipcRenderer.invoke('security:revokeOtherSessions')
  },
  appStore: {
    catalog: () => ipcRenderer.invoke('appStore:catalog'),
    installed: () => ipcRenderer.invoke('appStore:installed'),
    install: (appId, instanceName) => ipcRenderer.invoke('appStore:install', appId, instanceName),
    remove: (instanceName) => ipcRenderer.invoke('appStore:remove', instanceName),
    getUrl: (instanceName) => ipcRenderer.invoke('appStore:getUrl', instanceName),
    getExePath: (instanceName) => ipcRenderer.invoke('appStore:getExePath', instanceName),
    addCustomApp: (opts) => ipcRenderer.invoke('appStore:addCustomApp', opts),
    removeCustomApp: (appId) => ipcRenderer.invoke('appStore:removeCustomApp', appId),
    checkRequirements: (appId) => ipcRenderer.invoke('appStore:checkRequirements', appId),
    onProgress: (callback) => {
      ipcRenderer.on('appStore:progress', (_event, data) => callback(data));
    }
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  tray: {
    onStartAll: (callback) => {
      ipcRenderer.on('tray:start-all', () => callback());
    }
  },
  // Cleanup to prevent memory leaks — call before re-subscribing
  removeAllListeners: (channel) => {
    const allowed = ['download:progress', 'service:exited', 'terminal:data', 'terminal:exit', 'appStore:progress', 'tray:start-all', 'path:pythonManagerStatus', 'activity:changed', 'command:output', 'command:exit', 'tunnel:changed'];
    if (allowed.includes(channel)) ipcRenderer.removeAllListeners(channel);
  }
});
