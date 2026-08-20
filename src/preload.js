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
    listObjectsFor: (connection, database) => ipcRenderer.invoke('db:listObjectsFor', connection, database),
    describeObjectFor: (connection, database, schema, objectName) => ipcRenderer.invoke('db:describeObjectFor', connection, database, schema, objectName),
    tableDataFor: (connection, database, table, limit, offset, schema) => ipcRenderer.invoke('db:tableDataFor', connection, database, table, limit, offset, schema),
    executeQueryFor: (connection, database, query) => ipcRenderer.invoke('db:executeQueryFor', connection, database, query),
    executeWorkbench: (connection, database, query, options) => ipcRenderer.invoke('db:executeWorkbench', connection, database, query, options),
    cancelQuery: (id) => ipcRenderer.invoke('db:cancelQuery', id),
    activeQueries: () => ipcRenderer.invoke('db:activeQueries'),
    queryHistory: (limit) => ipcRenderer.invoke('db:queryHistory', limit),
    clearQueryHistory: () => ipcRenderer.invoke('db:clearQueryHistory'),
    savedQueries: () => ipcRenderer.invoke('db:savedQueries'),
    saveQuery: (input) => ipcRenderer.invoke('db:saveQuery', input),
    removeSavedQuery: (id) => ipcRenderer.invoke('db:removeSavedQuery', id),
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
    create: (connection) => ipcRenderer.invoke('terminal:create', connection),
    attach: () => Promise.resolve({ success: true, data: '' }),
    profiles: () => ipcRenderer.invoke('terminal:profiles'),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    onData: (callback) => {
      ipcRenderer.on('terminal:data', (_event, data) => callback(data));
    },
    onExit: (callback) => {
      ipcRenderer.on('terminal:exit', (_event, data) => callback(data));
    },
    recordStart: (id, metadata) => ipcRenderer.invoke('terminal:record-start', id, metadata), recordStop: (id) => ipcRenderer.invoke('terminal:record-stop', id), recordList: () => ipcRenderer.invoke('terminal:record-list'), recordExport: (id, format) => ipcRenderer.invoke('terminal:record-export', id, format)
  },
  remote: {
    list: () => ipcRenderer.invoke('remote:list'),
    save: (input, secrets) => ipcRenderer.invoke('remote:save', input, secrets),
    remove: (id) => ipcRenderer.invoke('remote:remove', id),
    duplicate: (id) => ipcRenderer.invoke('remote:duplicate', id),
    importProfiles: () => ipcRenderer.invoke('remote:importProfiles'),
    exportProfiles: () => ipcRenderer.invoke('remote:exportProfiles'),
    mountSftp: (input, drive) => ipcRenderer.invoke('remote:mountSftp', input, drive), listMounts: () => ipcRenderer.invoke('remote:listMounts'), unmountSftp: (id) => ipcRenderer.invoke('remote:unmountSftp', id),
    resetHostKey: (id) => ipcRenderer.invoke('remote:resetHostKey', id),
    test: (input) => ipcRenderer.invoke('remote:test', input),
    diagnose: (input) => ipcRenderer.invoke('remote:diagnose', input),
    inspect: (input, kind) => ipcRenderer.invoke('remote:inspect', input, kind),
    docker: (input, action, target) => ipcRenderer.invoke('remote:docker', input, action, target),
    systemd: (input, action, unit) => ipcRenderer.invoke('remote:systemd', input, action, unit),
    signal: (input, pid, signal) => ipcRenderer.invoke('remote:signal', input, pid, signal),
    archive: (input, action, source, destination) => ipcRenderer.invoke('remote:archive', input, action, source, destination),
    wake: (mac, address, port) => ipcRenderer.invoke('remote:wake', mac, address, port),
    deploy: (connection, options) => ipcRenderer.invoke('remote:deploy', connection, options),
    onDeployProgress: (callback) => ipcRenderer.on('remote:deploy-progress', (_event, data) => callback(data)),
    openRdp: (input) => ipcRenderer.invoke('remote:openRdp', input),
    openVnc: (input) => ipcRenderer.invoke('remote:openVnc', input),
    openWinScp: (input) => ipcRenderer.invoke('remote:openWinScp', input), openPuTTY: (input) => ipcRenderer.invoke('remote:openPuTTY', input),
    onOpenPanel: (callback) => ipcRenderer.on('app:open-panel', (_event, panel) => callback(panel))
  },
  files: {
    localList: (directory) => ipcRenderer.invoke('files:localList', directory),
    localMutate: (operation, target, destination) => ipcRenderer.invoke('files:localMutate', operation, target, destination),
    remoteList: (connection, directory) => ipcRenderer.invoke('files:remoteList', connection, directory),
    transfer: (connection, direction, localPath, remotePath) => ipcRenderer.invoke('files:transfer', connection, direction, localPath, remotePath),
    transferResumable: (connection, direction, localPath, remotePath, transferId) => ipcRenderer.invoke('files:transferResumable', connection, direction, localPath, remotePath, transferId),
    transferRecursive: (connection, direction, localPath, remotePath, transferId) => ipcRenderer.invoke('files:transferRecursive', connection, direction, localPath, remotePath, transferId),
    remoteMutate: (connection, operation, target, destination) => ipcRenderer.invoke('files:remoteMutate', connection, operation, target, destination),
    readLocal: (target) => ipcRenderer.invoke('files:readLocal', target), writeLocal: (target, content) => ipcRenderer.invoke('files:writeLocal', target, content),
    previewLocal: (target) => ipcRenderer.invoke('files:previewLocal', target),
    readRemote: (connection, target) => ipcRenderer.invoke('files:readRemote', connection, target), writeRemote: (connection, target, content) => ipcRenderer.invoke('files:writeRemote', connection, target, content),
    previewRemote: (connection, target) => ipcRenderer.invoke('files:previewRemote', connection, target),
    searchLocal: (directory, query) => ipcRenderer.invoke('files:searchLocal', directory, query), searchRemote: (connection, directory, query) => ipcRenderer.invoke('files:searchRemote', connection, directory, query),
    diff: (connection, localPath, remotePath) => ipcRenderer.invoke('files:diff', connection, localPath, remotePath), syncPreview: (connection, localPath, remotePath, options) => ipcRenderer.invoke('files:syncPreview', connection, localPath, remotePath, options), syncApply: (connection, preview, direction, selected) => ipcRenderer.invoke('files:syncApply', connection, preview, direction, selected),
    serverTransfer: (source, sourcePath, destination, destinationPath, transferId) => ipcRenderer.invoke('files:serverTransfer', source, sourcePath, destination, destinationPath, transferId),
    onTransferProgress: (callback) => ipcRenderer.on('files:transfer-progress', (_event, data) => callback(data))
  },
  storage: {
    list: () => ipcRenderer.invoke('storage:list'), save: (input, secrets) => ipcRenderer.invoke('storage:save', input, secrets), remove: (id) => ipcRenderer.invoke('storage:remove', id), test: (input) => ipcRenderer.invoke('storage:test', input), listFiles: (input, directory) => ipcRenderer.invoke('storage:listFiles', input, directory), transfer: (input, direction, localPath, remotePath) => ipcRenderer.invoke('storage:transfer', input, direction, localPath, remotePath), transferRecursive: (input, direction, localPath, remotePath, transferId) => ipcRenderer.invoke('storage:transferRecursive', input, direction, localPath, remotePath, transferId), mutate: (input, operation, target, destination) => ipcRenderer.invoke('storage:mutate', input, operation, target, destination), read: (input, remotePath) => ipcRenderer.invoke('storage:read', input, remotePath), write: (input, remotePath, content) => ipcRenderer.invoke('storage:write', input, remotePath, content)
  },
  sshTunnel: {
    list: () => ipcRenderer.invoke('sshTunnel:list'), start: (connection, options) => ipcRenderer.invoke('sshTunnel:start', connection, options), stop: (id) => ipcRenderer.invoke('sshTunnel:stop', id)
  },
  runbook: {
    list: () => ipcRenderer.invoke('runbook:list'), save: (input) => ipcRenderer.invoke('runbook:save', input), remove: (id) => ipcRenderer.invoke('runbook:remove', id), run: (connection, id, parameters) => ipcRenderer.invoke('runbook:run', connection, id, parameters), onProgress: (callback) => ipcRenderer.on('runbook:progress', (_event, data) => callback(data))
  },
  devops: {
    git: (connection, repository, action, options) => ipcRenderer.invoke('devops:git', connection, repository, action, options),
    compose: (connection, directory, action, service) => ipcRenderer.invoke('devops:compose', connection, directory, action, service),
    kubernetes: (connection, action, options) => ipcRenderer.invoke('devops:kubernetes', connection, action, options),
    metrics: (connection) => ipcRenderer.invoke('devops:metrics', connection), alerts: (connection, thresholds) => ipcRenderer.invoke('devops:alerts', connection, thresholds),
    http: (request) => ipcRenderer.invoke('devops:http', request)
  },
  suite: {
    capabilities: () => ipcRenderer.invoke('suite:capabilities'), vaultImport: (provider, reference, sessionId, options) => ipcRenderer.invoke('suite:vault-import', provider, reference, sessionId, options), keys: () => ipcRenderer.invoke('suite:keys'), keyGenerate: (input) => ipcRenderer.invoke('suite:key-generate', input), keyRemove: (id) => ipcRenderer.invoke('suite:key-remove', id), keyInstall: (connection, id) => ipcRenderer.invoke('suite:key-install', connection, id), keyRotate: (connection, id, passphrase) => ipcRenderer.invoke('suite:key-rotate', connection, id, passphrase),
    snapshot: (file) => ipcRenderer.invoke('suite:snapshot', file), snapshots: () => ipcRenderer.invoke('suite:snapshots'), snapshotRestore: (id) => ipcRenderer.invoke('suite:snapshot-restore', id), merge3: (base, local, remote) => ipcRenderer.invoke('suite:merge3', base, local, remote),
    state: () => ipcRenderer.invoke('suite:state'), runDue: () => ipcRenderer.invoke('suite:run-due'), saveItem: (collection, input) => ipcRenderer.invoke('suite:item-save', collection, input), removeItem: (collection, id) => ipcRenderer.invoke('suite:item-remove', collection, id), handoffCreate: (sessionId, recipient, ttl) => ipcRenderer.invoke('suite:handoff-create', sessionId, recipient, ttl), handoffConsume: (id, token) => ipcRenderer.invoke('suite:handoff-consume', id, token)
  },
  advanced: {
    graph: () => ipcRenderer.invoke('advanced:graph'), commands: () => ipcRenderer.invoke('advanced:commands'), configuration: () => ipcRenderer.invoke('advanced:configuration'), workspaces: () => ipcRenderer.invoke('advanced:workspaces'), workspaceSave: input => ipcRenderer.invoke('advanced:workspace-save', input),
    search: (query, options) => ipcRenderer.invoke('advanced:search', query, options), replacePreview: (query, replacement, options) => ipcRenderer.invoke('advanced:replace-preview', query, replacement, options), replaceApply: (preview, approved) => ipcRenderer.invoke('advanced:replace-apply', preview, approved), replaceRollback: id => ipcRenderer.invoke('advanced:replace-rollback', id), secretScan: (content, label) => ipcRenderer.invoke('advanced:secret-scan', content, label), preflight: (input, options) => ipcRenderer.invoke('advanced:preflight', input, options),
    captureInfrastructure: input => ipcRenderer.invoke('advanced:infrastructure-capture', input), diffInfrastructure: (left, right) => ipcRenderer.invoke('advanced:infrastructure-diff', left, right), setBaseline: input => ipcRenderer.invoke('advanced:baseline-set', input), drift: input => ipcRenderer.invoke('advanced:drift', input), blastRadius: input => ipcRenderer.invoke('advanced:blast-radius', input), digitalTwin: (capture, operation) => ipcRenderer.invoke('advanced:digital-twin', capture, operation),
    timeline: sessionId => ipcRenderer.invoke('advanced:timeline', sessionId), timelineRecord: input => ipcRenderer.invoke('advanced:timeline-record', input), timeMachineCapture: (input, options) => ipcRenderer.invoke('advanced:time-machine-capture', input, options), timeMachineList: sessionId => ipcRenderer.invoke('advanced:time-machine-list', sessionId), timeMachineRestore: (id, input, paths) => ipcRenderer.invoke('advanced:time-machine-restore', id, input, paths), shadowDeploy: (input, options) => ipcRenderer.invoke('advanced:shadow-deploy', input, options), shadowPromote: (input, shadow) => ipcRenderer.invoke('advanced:shadow-promote', input, shadow), replaySave: input => ipcRenderer.invoke('advanced:replay-save', input), replayRun: (id, input) => ipcRenderer.invoke('advanced:replay-run', id, input),
    correlateLogs: sources => ipcRenderer.invoke('advanced:logs-correlate', sources), anomaly: samples => ipcRenderer.invoke('advanced:anomaly', samples), recordMetric: (sessionId, metrics) => ipcRenderer.invoke('advanced:metric-record', sessionId, metrics), anomalyBaseline: sessionId => ipcRenderer.invoke('advanced:anomaly-baseline', sessionId), explain: value => ipcRenderer.invoke('advanced:explain', value), safeCommand: (kind, input) => ipcRenderer.invoke('advanced:safe-command', kind, input), healthSave: input => ipcRenderer.invoke('advanced:health-save', input), healthEvaluate: id => ipcRenderer.invoke('advanced:health-evaluate', id), maintenanceSave: input => ipcRenderer.invoke('advanced:maintenance-save', input), maintenanceCheck: (sessionId, operation, at) => ipcRenderer.invoke('advanced:maintenance-check', sessionId, operation, at), dns: hostname => ipcRenderer.invoke('advanced:dns', hostname), dnsPropagation: (hostname, type) => ipcRenderer.invoke('advanced:dns-propagation', hostname, type), certificate: (hostname, port) => ipcRenderer.invoke('advanced:certificate', hostname, port)
  },
  incident: {
    list: () => ipcRenderer.invoke('incident:list'), start: input => ipcRenderer.invoke('incident:start', input), update: (id, patch) => ipcRenderer.invoke('incident:update', id, patch), collect: (id, input) => ipcRenderer.invoke('incident:collect', id, input), capsule: id => ipcRenderer.invoke('incident:capsule', id), suggestRunbook: id => ipcRenderer.invoke('incident:suggest-runbook', id)
  },
  collaboration: {
    start: input => ipcRenderer.invoke('collab:start', input), join: (id, participant) => ipcRenderer.invoke('collab:join', id, participant), transferControl: (id, participantId, actorId) => ipcRenderer.invoke('collab:control', id, participantId, actorId), lockFile: (sessionId, filePath, participantId) => ipcRenderer.invoke('collab:lock', sessionId, filePath, participantId), event: (id, participantId, value) => ipcRenderer.invoke('collab:event', id, participantId, value), events: (id, since) => ipcRenderer.invoke('collab:events', id, since)
  },
  resilience: {
    capabilities: () => ipcRenderer.invoke('resilience:capabilities'), createSshCa: (name, passphrase) => ipcRenderer.invoke('resilience:ssh-ca-create', name, passphrase), signSshKey: (caId, publicKeyPath, identity, principals, validity) => ipcRenderer.invoke('resilience:ssh-sign', caId, publicKeyPath, identity, principals, validity), installSshCa: (input, caId) => ipcRenderer.invoke('resilience:ssh-ca-install', input, caId), openMosh: input => ipcRenderer.invoke('resilience:mosh', input), ports: input => ipcRenderer.invoke('resilience:ports', input), databaseTunnel: (input, options) => ipcRenderer.invoke('resilience:db-tunnel', input, options), cron: (input, action, options) => ipcRenderer.invoke('resilience:cron', input, action, options), timer: (input, action, options) => ipcRenderer.invoke('resilience:timer', input, action, options), firewall: (input, action, rule, execute) => ipcRenderer.invoke('resilience:firewall', input, action, rule, execute), certificateRenew: (input, provider, domain) => ipcRenderer.invoke('resilience:certificate-renew', input, provider, domain), cachePut: file => ipcRenderer.invoke('resilience:cache-put', file), cacheRestore: (hash, target) => ipcRenderer.invoke('resilience:cache-restore', hash, target), transferLimited: (input, direction, local, remote, rate) => ipcRenderer.invoke('resilience:transfer-limited', input, direction, local, remote, rate), backup: (source, name) => ipcRenderer.invoke('resilience:backup', source, name), backupRestore: (id, target) => ipcRenderer.invoke('resilience:backup-restore', id, target), offlineVault: input => ipcRenderer.invoke('resilience:offline-vault', input), breakGlassCreate: input => ipcRenderer.invoke('resilience:break-glass-create', input), breakGlassConsume: (id, code, authentication) => ipcRenderer.invoke('resilience:break-glass-consume', id, code, authentication)
  },
  fabric: {
    summary: () => ipcRenderer.invoke('fabric:summary'), policySave: input => ipcRenderer.invoke('fabric:policy-save', input), policyEvaluate: context => ipcRenderer.invoke('fabric:policy-evaluate', context), accessRequest: input => ipcRenderer.invoke('fabric:access-request', input), accessBegin: input => ipcRenderer.invoke('fabric:access-begin', input), accessApprove: (id, authentication) => ipcRenderer.invoke('fabric:access-approve', id, authentication), accessConsume: (token, scope) => ipcRenderer.invoke('fabric:access-consume', token, scope),
    secretLeaseCreate: input => ipcRenderer.invoke('fabric:secret-lease-create', input), secretLeaseUse: (id, session, environmentName, command) => ipcRenderer.invoke('fabric:secret-lease-use', id, session, environmentName, command), clipboardWrite: (value, options) => ipcRenderer.invoke('fabric:clipboard-write', value, options), clipboardClear: () => ipcRenderer.invoke('fabric:clipboard-clear'),
    serviceMap: input => ipcRenderer.invoke('fabric:service-map', input), gitOpsExport: (capture, format, target) => ipcRenderer.invoke('fabric:gitops-export', capture, format, target), gitOpsPlan: (observed, desired) => ipcRenderer.invoke('fabric:gitops-plan', observed, desired), fleetRun: (sessionIds, template, parameters, options) => ipcRenderer.invoke('fabric:fleet-run', sessionIds, template, parameters, options), networkRecord: (input, options) => ipcRenderer.invoke('fabric:network-record', input, options),
    syntheticSave: input => ipcRenderer.invoke('fabric:synthetic-save', input), syntheticRun: id => ipcRenderer.invoke('fabric:synthetic-run', id), syntheticRunDue: () => ipcRenderer.invoke('fabric:synthetic-run-due'), canarySave: input => ipcRenderer.invoke('fabric:canary-save', input), canaryAdvance: (id, metrics) => ipcRenderer.invoke('fabric:canary-advance', id, metrics),
    offlineMountSave: input => ipcRenderer.invoke('fabric:offline-mount-save', input), offlineStage: (id, relativePath, content, baseHash) => ipcRenderer.invoke('fabric:offline-stage', id, relativePath, content, baseHash), offlineReconcile: id => ipcRenderer.invoke('fabric:offline-reconcile', id),
    databaseSchemaDiff: (left, right) => ipcRenderer.invoke('fabric:db-schema-diff', left, right), databaseErd: schema => ipcRenderer.invoke('fabric:db-erd', schema), databaseMask: (rows, rules) => ipcRenderer.invoke('fabric:db-mask', rows, rules), databaseSchemaCapture: (connection, database) => ipcRenderer.invoke('fabric:db-schema-capture', connection, database), databaseMaskedExport: (connection, database, target, limit) => ipcRenderer.invoke('fabric:db-masked-export', connection, database, target, limit), disasterSimulate: backupId => ipcRenderer.invoke('fabric:dr-simulate', backupId),
    ephemeralSave: input => ipcRenderer.invoke('fabric:ephemeral-save', input), ephemeralCleanup: () => ipcRenderer.invoke('fabric:ephemeral-cleanup'), remoteDesktopSave: input => ipcRenderer.invoke('fabric:remote-desktop-save', input), rescueCreate: input => ipcRenderer.invoke('fabric:rescue-create', input),
    evidenceSeal: payload => ipcRenderer.invoke('fabric:evidence-seal', payload), evidenceVerify: id => ipcRenderer.invoke('fabric:evidence-verify', id), copilot: context => ipcRenderer.invoke('fabric:copilot', context), replayCreate: file => ipcRenderer.invoke('fabric:replay-create', file), replaySimulate: (id, action) => ipcRenderer.invoke('fabric:replay-simulate', id, action)
  },
  enterprise: {
    summary: () => ipcRenderer.invoke('enterprise:summary'), configuration: () => ipcRenderer.invoke('enterprise:configuration'), agents: () => ipcRenderer.invoke('enterprise:agent-list'), agentEnroll: input => ipcRenderer.invoke('enterprise:agent-enroll', input), agentRemove: id => ipcRenderer.invoke('enterprise:agent-remove', id), agentProbe: id => ipcRenderer.invoke('enterprise:agent-probe', id), agentBootstrap: input => ipcRenderer.invoke('enterprise:agent-bootstrap', input),
    sloSave: input => ipcRenderer.invoke('enterprise:slo-save', input), sloRecord: (id, sample) => ipcRenderer.invoke('enterprise:slo-record', id, sample), sloEvaluate: () => ipcRenderer.invoke('enterprise:slo-evaluate'), capacityRecord: (resource, value, at) => ipcRenderer.invoke('enterprise:capacity-record', resource, value, at), capacityForecast: (resource, limit) => ipcRenderer.invoke('enterprise:capacity-forecast', resource, limit),
    patchSave: input => ipcRenderer.invoke('enterprise:patch-save', input), patchRun: (id, options) => ipcRenderer.invoke('enterprise:patch-run', id, options), rebootPlan: input => ipcRenderer.invoke('enterprise:reboot-plan', input), rebootRun: (id, options) => ipcRenderer.invoke('enterprise:reboot-run', id, options),
    complianceSave: input => ipcRenderer.invoke('enterprise:compliance-save', input), complianceScan: (id, sessions) => ipcRenderer.invoke('enterprise:compliance-scan', id, sessions), supplyChainScan: input => ipcRenderer.invoke('enterprise:supply-chain-scan', input), imagePromote: input => ipcRenderer.invoke('enterprise:image-promote', input),
    airgapCreate: input => ipcRenderer.invoke('enterprise:airgap-create', input), airgapVerify: id => ipcRenderer.invoke('enterprise:airgap-verify', id), oidcSave: input => ipcRenderer.invoke('enterprise:oidc-save', input), oidcLogin: id => ipcRenderer.invoke('enterprise:oidc-login', id),
    chaosSave: input => ipcRenderer.invoke('enterprise:chaos-save', input), chaosRun: (id, options) => ipcRenderer.invoke('enterprise:chaos-run', id, options), remediationSave: input => ipcRenderer.invoke('enterprise:remediation-save', input), autonomousSandbox: context => ipcRenderer.invoke('enterprise:autonomous-sandbox', context), migrationRehearse: (connection, database, sql) => ipcRenderer.invoke('enterprise:migration-rehearse', connection, database, sql),
    configValidate: input => ipcRenderer.invoke('enterprise:config-validate', input), cloudInit: input => ipcRenderer.invoke('enterprise:cloud-init', input), regionSave: input => ipcRenderer.invoke('enterprise:region-save', input), failoverPlan: (fromId, toId) => ipcRenderer.invoke('enterprise:failover-plan', fromId, toId), marketplaceInstall: input => ipcRenderer.invoke('enterprise:marketplace-install', input)
  },
  nextgen: {
    summary: () => ipcRenderer.invoke('nextgen:summary'), configuration: () => ipcRenderer.invoke('nextgen:configuration'),
    relaySave: input => ipcRenderer.invoke('nextgen:relay-save', input), relayRoute: (fromId, toId) => ipcRenderer.invoke('nextgen:relay-route', fromId, toId), relayBootstrap: input => ipcRenderer.invoke('nextgen:relay-bootstrap', input),
    capabilityIssue: input => ipcRenderer.invoke('nextgen:capability-issue', input), capabilityUse: (id, parameters) => ipcRenderer.invoke('nextgen:capability-use', id, parameters), shellParse: transcript => ipcRenderer.invoke('nextgen:shell-parse', transcript),
    deltaSignature: (file, blockSize) => ipcRenderer.invoke('nextgen:delta-signature', file, blockSize), deltaPlan: (file, signature) => ipcRenderer.invoke('nextgen:delta-plan', file, signature), deltaApply: (source, destination, plan) => ipcRenderer.invoke('nextgen:delta-apply', source, destination, plan),
    snapshotCreate: input => ipcRenderer.invoke('nextgen:snapshot-create', input), snapshotBrowse: (id, prefix) => ipcRenderer.invoke('nextgen:snapshot-browse', id, prefix), snapshotRestore: (id, relative, target) => ipcRenderer.invoke('nextgen:snapshot-restore', id, relative, target),
    ransomwareBaseline: root => ipcRenderer.invoke('nextgen:ransomware-baseline', root), ransomwareScan: (root, thresholds) => ipcRenderer.invoke('nextgen:ransomware-scan', root, thresholds), desktopSave: input => ipcRenderer.invoke('nextgen:desktop-save', input),
    sshPolicySave: input => ipcRenderer.invoke('nextgen:ssh-policy-save', input), sshCertificateIssue: (policyId, publicKey, identity, authentication) => ipcRenderer.invoke('nextgen:ssh-certificate-issue', policyId, publicKey, identity, authentication), ebpf: (input, kind) => ipcRenderer.invoke('nextgen:ebpf', input, kind), networkTwin: input => ipcRenderer.invoke('nextgen:network-twin', input), transaction: (input, steps, options) => ipcRenderer.invoke('nextgen:transaction', input, steps, options),
    pairCreate: input => ipcRenderer.invoke('nextgen:pair-create', input), pairPropose: (id, action, actor) => ipcRenderer.invoke('nextgen:pair-propose', id, action, actor), pairApprove: (id, actor) => ipcRenderer.invoke('nextgen:pair-approve', id, actor), mobileCreate: input => ipcRenderer.invoke('nextgen:mobile-create', input), mobileResolve: (id, challenge, decision, authentication) => ipcRenderer.invoke('nextgen:mobile-resolve', id, challenge, decision, authentication),
    wasmRun: input => ipcRenderer.invoke('nextgen:wasm-run', input), blackBoxRecord: event => ipcRenderer.invoke('nextgen:blackbox-record', event), blackBoxExport: minutes => ipcRenderer.invoke('nextgen:blackbox-export', minutes), dnaCapture: input => ipcRenderer.invoke('nextgen:dna-capture', input), dnaCompare: (left, right) => ipcRenderer.invoke('nextgen:dna-compare', left, right), connectivityHeal: input => ipcRenderer.invoke('nextgen:connectivity-heal', input), intentPlan: input => ipcRenderer.invoke('nextgen:intent-plan', input), simulatorCreate: input => ipcRenderer.invoke('nextgen:simulator-create', input), simulatorRun: (id, response) => ipcRenderer.invoke('nextgen:simulator-run', id, response)
  },
  opsWorkspace: {
    summary: () => ipcRenderer.invoke('opsWorkspace:summary'), configuration: () => ipcRenderer.invoke('opsWorkspace:configuration'), save: input => ipcRenderer.invoke('opsWorkspace:save', input), resume: id => ipcRenderer.invoke('opsWorkspace:resume', id),
    timelineRecord: input => ipcRenderer.invoke('opsWorkspace:timelineRecord', input), timeline: (sessionId, options) => ipcRenderer.invoke('opsWorkspace:timeline', sessionId, options), undoPlan: id => ipcRenderer.invoke('opsWorkspace:undoPlan', id), undoExecute: (id, approved) => ipcRenderer.invoke('opsWorkspace:undoExecute', id, approved),
    connectionDoctor: id => ipcRenderer.invoke('opsWorkspace:connectionDoctor', id), smartTransfer: input => ipcRenderer.invoke('opsWorkspace:smartTransfer', input), fleetPreview: (ids, template, parameters, options) => ipcRenderer.invoke('opsWorkspace:fleetPreview', ids, template, parameters, options), fleetExecute: (preview, approved) => ipcRenderer.invoke('opsWorkspace:fleetExecute', preview, approved),
    environmentDiff: (left, right) => ipcRenderer.invoke('opsWorkspace:environmentDiff', left, right), disposableRescue: input => ipcRenderer.invoke('opsWorkspace:disposableRescue', input), portableRescue: input => ipcRenderer.invoke('opsWorkspace:portableRescue', input), memoryRecord: input => ipcRenderer.invoke('opsWorkspace:memoryRecord', input), memorySearch: (query, sessionId) => ipcRenderer.invoke('opsWorkspace:memorySearch', query, sessionId),
    multiplexerSave: input => ipcRenderer.invoke('opsWorkspace:multiplexerSave', input), autocomplete: input => ipcRenderer.invoke('opsWorkspace:autocomplete', input), incidentRoom: input => ipcRenderer.invoke('opsWorkspace:incidentRoom', input), collaborativeChange: input => ipcRenderer.invoke('opsWorkspace:collaborativeChange', input), movie: (sessionId, options) => ipcRenderer.invoke('opsWorkspace:movie', sessionId, options), blastRadius: (sessionId, operation) => ipcRenderer.invoke('opsWorkspace:blastRadius', sessionId, operation),
    networkReplayCreate: input => ipcRenderer.invoke('opsWorkspace:networkReplayCreate', input), networkReplayRun: (id, response) => ipcRenderer.invoke('opsWorkspace:networkReplayRun', id, response), palettePlan: input => ipcRenderer.invoke('opsWorkspace:palettePlan', input), secretless: sessionId => ipcRenderer.invoke('opsWorkspace:secretless', sessionId)
  },
  terminalFilePro: {
    summary: () => ipcRenderer.invoke('terminalFilePro:summary'), configuration: () => ipcRenderer.invoke('terminalFilePro:configuration'), notebookSave: input => ipcRenderer.invoke('terminalFilePro:notebookSave', input), notebook: id => ipcRenderer.invoke('terminalFilePro:notebook', id), pasteAnalyze: value => ipcRenderer.invoke('terminalFilePro:pasteAnalyze', value), translate: input => ipcRenderer.invoke('terminalFilePro:translate', input), sidecar: sessionId => ipcRenderer.invoke('terminalFilePro:sidecar', sessionId), shadow: (sessionId, template, parameters, options) => ipcRenderer.invoke('terminalFilePro:shadow', sessionId, template, parameters, options), checkpointSave: input => ipcRenderer.invoke('terminalFilePro:checkpointSave', input), checkpointRestore: id => ipcRenderer.invoke('terminalFilePro:checkpointRestore', id), resultMatrix: results => ipcRenderer.invoke('terminalFilePro:resultMatrix', results), outputActions: output => ipcRenderer.invoke('terminalFilePro:outputActions', output), recordingStudio: input => ipcRenderer.invoke('terminalFilePro:recordingStudio', input), protocolSave: input => ipcRenderer.invoke('terminalFilePro:protocolSave', input),
    multiFilePreview: (sessionId, changes) => ipcRenderer.invoke('terminalFilePro:multiFilePreview', sessionId, changes), multiFileApply: (preview, approved) => ipcRenderer.invoke('terminalFilePro:multiFileApply', preview, approved), containerFiles: (sessionId, input) => ipcRenderer.invoke('terminalFilePro:containerFiles', sessionId, input), gitFiles: (sessionId, input) => ipcRenderer.invoke('terminalFilePro:gitFiles', sessionId, input), archiveFiles: (sessionId, input) => ipcRenderer.invoke('terminalFilePro:archiveFiles', sessionId, input), hugeFile: (sessionId, input) => ipcRenderer.invoke('terminalFilePro:hugeFile', sessionId, input), indexBuild: (sessionId, root, options) => ipcRenderer.invoke('terminalFilePro:indexBuild', sessionId, root, options), indexSearch: (id, query) => ipcRenderer.invoke('terminalFilePro:indexSearch', id, query), provenanceRecord: input => ipcRenderer.invoke('terminalFilePro:provenanceRecord', input), provenance: sha256 => ipcRenderer.invoke('terminalFilePro:provenance', sha256), crossProtocolPlan: input => ipcRenderer.invoke('terminalFilePro:crossProtocolPlan', input), duplicates: (sessionId, root) => ipcRenderer.invoke('terminalFilePro:duplicates', sessionId, root), heatmap: (sessionId, root) => ipcRenderer.invoke('terminalFilePro:heatmap', sessionId, root), causality: (sessionId, file) => ipcRenderer.invoke('terminalFilePro:causality', sessionId, file), splitContext: input => ipcRenderer.invoke('terminalFilePro:splitContext', input),
    pipelineSave: input => ipcRenderer.invoke('terminalFilePro:pipelineSave', input), pipelinePlan: (id, context) => ipcRenderer.invoke('terminalFilePro:pipelinePlan', id, context), dropZoneCreate: input => ipcRenderer.invoke('terminalFilePro:dropZoneCreate', input), dropZoneInspect: id => ipcRenderer.invoke('terminalFilePro:dropZoneInspect', id), capsuleCreate: input => ipcRenderer.invoke('terminalFilePro:capsuleCreate', input), capsuleOpen: (target, passphrase) => ipcRenderer.invoke('terminalFilePro:capsuleOpen', target, passphrase), airDropCreate: input => ipcRenderer.invoke('terminalFilePro:airDropCreate', input), airDropConsume: (id, code, destination) => ipcRenderer.invoke('terminalFilePro:airDropConsume', id, code, destination), clipboardPut: input => ipcRenderer.invoke('terminalFilePro:clipboardPut', input), clipboardTake: (id, sessionId) => ipcRenderer.invoke('terminalFilePro:clipboardTake', id, sessionId), filesystemWatch: input => ipcRenderer.invoke('terminalFilePro:filesystemWatch', input)
  },
  terminalFileVision: {
    summary: () => ipcRenderer.invoke('terminalFileVision:summary'),
    configuration: () => ipcRenderer.invoke('terminalFileVision:configuration'),
    execute: (feature, input) => ipcRenderer.invoke('terminalFileVision:execute', feature, input)
  },
  terminalFileRuntime: {
    summary: () => ipcRenderer.invoke('terminalFileRuntime:summary'),
    audit: input => ipcRenderer.invoke('terminalFileRuntime:audit', input),
    execute: (capability, input) => ipcRenderer.invoke('terminalFileRuntime:execute', capability, input)
  },
  terminalFileDeep: {
    summary: () => ipcRenderer.invoke('terminalFileDeep:summary'),
    execute: (capability, input) => ipcRenderer.invoke('terminalFileDeep:execute', capability, input)
  },
  portable: {
    list: () => ipcRenderer.invoke('portable:list'), launch: (id) => ipcRenderer.invoke('portable:launch', id)
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
    detect: (directory) => ipcRenderer.invoke('workspace:detect', directory),
    inspectCompose: (file) => ipcRenderer.invoke('workspace:inspectCompose', file),
    inspectDevcontainer: (file) => ipcRenderer.invoke('workspace:inspectDevcontainer', file),
    secretKeys: (id) => ipcRenderer.invoke('workspace:secretKeys', id),
    setSecrets: (id, secrets) => ipcRenderer.invoke('workspace:setSecrets', id, secrets),
    environment: (id) => ipcRenderer.invoke('workspace:environment', id),
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
    preflight: (projectId) => ipcRenderer.invoke('diagnostics:preflight', projectId),
    ports: () => ipcRenderer.invoke('diagnostics:ports'),
    findFreePort: (start, end) => ipcRenderer.invoke('diagnostics:findFreePort', start, end),
    repair: (issue) => ipcRenderer.invoke('diagnostics:repair', issue),
    repairAll: (projectId) => ipcRenderer.invoke('diagnostics:repairAll', projectId)
  },
  integration: {
    list: () => ipcRenderer.invoke('integration:list'),
    save: (id, config, secrets) => ipcRenderer.invoke('integration:save', id, config, secrets),
    remove: (id) => ipcRenderer.invoke('integration:remove', id),
    test: (id) => ipcRenderer.invoke('integration:test', id),
    readiness: (category) => ipcRenderer.invoke('integration:readiness', category),
    assistant: (prompt, context) => ipcRenderer.invoke('integration:assistant', prompt, context)
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
  toolchain: {
    list: () => ipcRenderer.invoke('toolchain:list'),
    repair: (id) => ipcRenderer.invoke('toolchain:repair', id)
  },
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
    install: () => ipcRenderer.invoke('update:install'),
    rollback: () => ipcRenderer.invoke('update:rollback')
  },
  support: { generate: () => ipcRenderer.invoke('support:generate') },
  identity: {
    roles: () => ipcRenderer.invoke('identity:roles'),
    users: () => ipcRenderer.invoke('identity:users'),
    createUser: (input) => ipcRenderer.invoke('identity:createUser', input),
    updateUser: (id, patch) => ipcRenderer.invoke('identity:updateUser', id, patch),
    removeUser: (id) => ipcRenderer.invoke('identity:removeUser', id),
    enableTotp: (id) => ipcRenderer.invoke('identity:enableTotp', id),
    disableTotp: (id) => ipcRenderer.invoke('identity:disableTotp', id),
    tokens: () => ipcRenderer.invoke('identity:tokens'),
    createToken: (input) => ipcRenderer.invoke('identity:createToken', input),
    revokeToken: (id) => ipcRenderer.invoke('identity:revokeToken', id),
    invitations: () => ipcRenderer.invoke('identity:invitations'),
    createInvitation: (input) => ipcRenderer.invoke('identity:createInvitation', input),
    removeInvitation: (id) => ipcRenderer.invoke('identity:removeInvitation', id)
  },
  hub: {
    status: () => ipcRenderer.invoke('hub:status'), settings: () => ipcRenderer.invoke('hub:settings'),
    configure: (input) => ipcRenderer.invoke('hub:configure', input),
    teams: () => ipcRenderer.invoke('hub:teams'), saveTeam: (input) => ipcRenderer.invoke('hub:saveTeam', input), removeTeam: (id) => ipcRenderer.invoke('hub:removeTeam', id),
    nodes: () => ipcRenderer.invoke('hub:nodes'), createPairing: (input) => ipcRenderer.invoke('hub:createPairing', input), revokeNode: (id) => ipcRenderer.invoke('hub:revokeNode', id),
    routes: () => ipcRenderer.invoke('hub:routes'), saveRoute: (input) => ipcRenderer.invoke('hub:saveRoute', input), removeRoute: (id) => ipcRenderer.invoke('hub:removeRoute', id),
    inventory: (filters) => ipcRenderer.invoke('hub:inventory', filters), publishLocal: (options) => ipcRenderer.invoke('hub:publishLocal', options), publish: (input) => ipcRenderer.invoke('hub:publish', input),
    history: (id) => ipcRenderer.invoke('hub:history', id), rollback: (id, revision) => ipcRenderer.invoke('hub:rollback', id, revision), applyObject: (id, options) => ipcRenderer.invoke('hub:applyObject', id, options),
    deployments: (filters) => ipcRenderer.invoke('hub:deployments', filters), createDeployment: (input) => ipcRenderer.invoke('hub:createDeployment', input), approveDeployment: (id) => ipcRenderer.invoke('hub:approveDeployment', id), updateDeployment: (id, input) => ipcRenderer.invoke('hub:updateDeployment', id, input),
    connectors: () => ipcRenderer.invoke('hub:connectors'), saveConnector: (input, secret) => ipcRenderer.invoke('hub:saveConnector', input, secret), removeConnector: (id) => ipcRenderer.invoke('hub:removeConnector', id),
    remotes: () => ipcRenderer.invoke('hub:remotes'), saveRemote: (input, token) => ipcRenderer.invoke('hub:saveRemote', input, token), removeRemote: (id) => ipcRenderer.invoke('hub:removeRemote', id), pushRemote: (id, options) => ipcRenderer.invoke('hub:pushRemote', id, options), pullRemote: (id, options) => ipcRenderer.invoke('hub:pullRemote', id, options), syncRemote: (id, options) => ipcRenderer.invoke('hub:syncRemote', id, options), compareRemote: (id, options) => ipcRenderer.invoke('hub:compareRemote', id, options), applyRemotePlan: (id, selections, options) => ipcRenderer.invoke('hub:applyRemotePlan', id, selections, options),
    reconcile: () => ipcRenderer.invoke('hub:reconcile'),
    onChanged: (callback) => ipcRenderer.on('hub:changed', (_event, data) => callback(data))
  },
  security: {
    status: () => ipcRenderer.invoke('security:status'),
    sessions: () => ipcRenderer.invoke('security:sessions'),
    revokeSession: (id) => ipcRenderer.invoke('security:revokeSession', id),
    revokeOtherSessions: () => ipcRenderer.invoke('security:revokeOtherSessions'),
    audit: (options) => ipcRenderer.invoke('audit:list', options),
    verifyAudit: () => ipcRenderer.invoke('audit:verify')
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
  lab: {
    recipes: () => ipcRenderer.invoke('lab:recipes'),
    preview: (input) => ipcRenderer.invoke('lab:preview', input),
    list: () => ipcRenderer.invoke('lab:list'),
    get: (id) => ipcRenderer.invoke('lab:get', id),
    create: (input, secrets) => ipcRenderer.invoke('lab:create', input, secrets),
    update: (id, patch, secrets) => ipcRenderer.invoke('lab:update', id, patch, secrets),
    provision: (id) => ipcRenderer.invoke('lab:provision', id),
    start: (id) => ipcRenderer.invoke('lab:start', id),
    stop: (id) => ipcRenderer.invoke('lab:stop', id),
    health: (id) => ipcRenderer.invoke('lab:health', id),
    remove: (id, options) => ipcRenderer.invoke('lab:remove', id, options),
    onChanged: (callback) => ipcRenderer.on('lab:changed', (_event, data) => callback(data)),
    onProgress: (callback) => ipcRenderer.on('lab:progress', (_event, data) => callback(data))
  },
  apiFlow: {
    catalog: () => ipcRenderer.invoke('apiFlow:catalog'),
    list: () => ipcRenderer.invoke('apiFlow:list'),
    get: (id) => ipcRenderer.invoke('apiFlow:get', id),
    validate: (input) => ipcRenderer.invoke('apiFlow:validate', input),
    save: (input) => ipcRenderer.invoke('apiFlow:save', input),
    remove: (id) => ipcRenderer.invoke('apiFlow:remove', id),
    start: (id) => ipcRenderer.invoke('apiFlow:start', id),
    stop: (id) => ipcRenderer.invoke('apiFlow:stop', id),
    status: (id) => ipcRenderer.invoke('apiFlow:status', id),
    test: (projectId, endpointId, request) => ipcRenderer.invoke('apiFlow:test', projectId, endpointId, request),
    request: (projectId, endpointId, request) => ipcRenderer.invoke('apiFlow:request', projectId, endpointId, request),
    logs: (projectId, limit) => ipcRenderer.invoke('apiFlow:logs', projectId, limit),
    clearLogs: (projectId) => ipcRenderer.invoke('apiFlow:clearLogs', projectId),
    onChanged: (callback) => ipcRenderer.on('apiFlow:changed', (_event, data) => callback(data))
  },
  observability: {
    overview: () => ipcRenderer.invoke('observability:overview'),
    collect: () => ipcRenderer.invoke('observability:collect'),
    history: (options) => ipcRenderer.invoke('observability:history', options),
    alerts: () => ipcRenderer.invoke('observability:alerts'),
    acknowledge: (id) => ipcRenderer.invoke('observability:acknowledge', id),
    rules: () => ipcRenderer.invoke('observability:rules'),
    saveRule: (input) => ipcRenderer.invoke('observability:saveRule', input),
    removeRule: (id) => ipcRenderer.invoke('observability:removeRule', id),
    prometheus: () => ipcRenderer.invoke('observability:prometheus'),
    onChanged: (callback) => ipcRenderer.on('observability:changed', (_event, data) => callback(data))
  },
  automation: {
    list: () => ipcRenderer.invoke('automation:list'),
    history: (limit) => ipcRenderer.invoke('automation:history', limit),
    save: (input) => ipcRenderer.invoke('automation:save', input),
    remove: (id) => ipcRenderer.invoke('automation:remove', id),
    run: (id) => ipcRenderer.invoke('automation:run', id),
    runDue: () => ipcRenderer.invoke('automation:runDue'),
    onChanged: (callback) => ipcRenderer.on('automation:changed', (_event, data) => callback(data))
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
    const allowed = ['download:progress', 'service:exited', 'terminal:data', 'terminal:exit', 'files:transfer-progress', 'runbook:progress', 'remote:deploy-progress', 'app:open-panel', 'appStore:progress', 'tray:start-all', 'path:pythonManagerStatus', 'activity:changed', 'command:output', 'command:exit', 'tunnel:changed', 'lab:changed', 'lab:progress', 'apiFlow:changed', 'hub:changed'];
    if (allowed.includes(channel)) ipcRenderer.removeAllListeners(channel);
  }
});
