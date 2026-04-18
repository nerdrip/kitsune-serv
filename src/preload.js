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
    renameProfile: (section, profileId, newName) => ipcRenderer.invoke('config:renameProfile', section, profileId, newName),
    exportConfig: () => ipcRenderer.invoke('config:export'),
    importConfig: () => ipcRenderer.invoke('config:import')
  },
  download: {
    getVersions: () => ipcRenderer.invoke('download:getVersions'),
    status: () => ipcRenderer.invoke('download:status'),
    isInstalled: (service, version) => ipcRenderer.invoke('download:isInstalled', service, version),
    installedVersions: (service) => ipcRenderer.invoke('download:installedVersions', service),
    install: (service, version) => ipcRenderer.invoke('download:install', service, version),
    remove: (service, version) => ipcRenderer.invoke('download:remove', service, version),
    diskUsage: () => ipcRenderer.invoke('download:diskUsage'),
    onProgress: (callback) => {
      ipcRenderer.on('download:progress', (_event, data) => callback(data));
    }
  },
  db: {
    listDatabases: (section) => ipcRenderer.invoke('db:listDatabases', section),
    listTables: (section, database) => ipcRenderer.invoke('db:listTables', section, database),
    tableData: (section, database, table, limit, offset) => ipcRenderer.invoke('db:tableData', section, database, table, limit, offset),
    executeQuery: (section, database, query) => ipcRenderer.invoke('db:executeQuery', section, database, query),
    createDatabase: (section, name) => ipcRenderer.invoke('db:createDatabase', section, name),
    dropDatabase: (section, name) => ipcRenderer.invoke('db:dropDatabase', section, name),
    getToolUrl: (section, database) => ipcRenderer.invoke('db:getToolUrl', section, database)
  },
  service: {
    start: (service) => ipcRenderer.invoke('service:start', service),
    stop: (service) => ipcRenderer.invoke('service:stop', service),
    restart: (service) => ipcRenderer.invoke('service:restart', service),
    status: (service) => ipcRenderer.invoke('service:status', service),
    allStatuses: () => ipcRenderer.invoke('service:allStatuses'),
    logs: (service, lines) => ipcRenderer.invoke('service:logs', service, lines),
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
    add: () => ipcRenderer.invoke('path:add'),
    remove: () => ipcRenderer.invoke('path:remove')
  },
  composer: {
    getStatus: () => ipcRenderer.invoke('composer:getStatus'),
    install: () => ipcRenderer.invoke('composer:install'),
    run: (command, cwd) => ipcRenderer.invoke('composer:run', command, cwd)
  },
  shell: {
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  projects: {
    list: (section) => ipcRenderer.invoke('projects:list', section),
    create: (section, name) => ipcRenderer.invoke('projects:create', section, name),
    delete: (section, name) => ipcRenderer.invoke('projects:delete', section, name)
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
    const allowed = ['download:progress', 'service:exited', 'terminal:data', 'terminal:exit', 'appStore:progress', 'tray:start-all'];
    if (allowed.includes(channel)) ipcRenderer.removeAllListeners(channel);
  }
});
