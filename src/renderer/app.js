/* ===== KitsuneServ – Renderer (profile-aware) ===== */
'use strict';

const api = window.kitsuneAPI;

// Sections that have profiles (not general)
const SERVICE_SECTIONS = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
const MANAGED_TOOL_SECTIONS = ['composer', 'java'];
const PATH_SECTIONS = [...SERVICE_SECTIONS, ...MANAGED_TOOL_SECTIONS];
const WEB_SERVER_SECTIONS = ['apache', 'nginx', 'caddy'];

// Version map loaded from backend (downloads.json)
let VERSION_MAP = {};
let versionCatalog = [];

// Dashboard card icons
const SECTION_ICONS = {
  apache: '🪶', nginx: '🔄', caddy: '🔒', postgresql: '🐘', mysql: '🐬', mariadb: '🦭', mongodb: '🍃',
  php: '🐘', node: '💚', go: '🔵', bun: '🧅', redis: '🔴',
  memcached: '⚡', minio: '📦', python: '🐍', deno: '🦕', composer: '🎼', java: '☕'
};

// Services that cannot be started/stopped independently (managed by other services)
const AUTO_MANAGED_SECTIONS = ['php'];

const PHP_EXTENSIONS = {
  'Core': ['bcmath', 'calendar', 'ctype', 'dom', 'fileinfo', 'filter', 'hash', 'json', 'mbstring', 'openssl', 'pcre', 'phar', 'session', 'simplexml', 'spl', 'tokenizer', 'xml', 'xmlreader', 'xmlwriter', 'zip', 'zlib'],
  'Database': ['pdo_mysql', 'pdo_pgsql', 'pdo_sqlite', 'pdo_oci', 'pdo_sqlsrv', 'mysqli', 'pgsql', 'sqlite3', 'sqlsrv', 'oci8', 'dba'],
  'Cache & Session': ['redis', 'memcached', 'memcache', 'apcu', 'opcache', 'igbinary', 'msgpack'],
  'Image & Media': ['gd', 'imagick', 'exif', 'gmagick'],
  'Network & Web': ['curl', 'ftp', 'ldap', 'soap', 'sockets', 'ssh2', 'imap', 'snmp'],
  'Text & Encoding': ['intl', 'gettext', 'iconv', 'readline', 'enchant'],
  'Math & Crypto': ['gmp', 'sodium', 'mcrypt'],
  'Compression': ['bz2', 'lzf', 'zstd'],
  'Debug & Dev': ['xdebug', 'xhprof', 'ast', 'pcov'],
  'Other': ['tidy', 'yaml', 'uuid', 'decimal', 'ds', 'ev', 'event', 'parallel', 'grpc', 'protobuf', 'swoole', 'mongodb', 'amqp', 'rdkafka']
};

const PHP_ALL_EXTENSIONS = Object.values(PHP_EXTENSIONS).flat();

/* ===== State ===== */
let config = {};
let dirty = false;
let _saveTimer = null;
let statuses = {};
let statusInterval = null;
let resourceUsage = {};
let installedMap = {};
let installedVersionsMap = {};
let diskUsageMap = {};
let runtimePlatform = 'unknown';
let runtimeMode = window.__KITSUNE_WEB_MODE__ ? 'server' : 'desktop';
let runtimeSafeMode = false;
let startupPanel = '';
const DB_SECTIONS = ['postgresql', 'mysql', 'mariadb', 'mongodb'];
const dbState = {}; // { section: { currentDb, currentTable, loaded } }
const dbQueryHistory = {}; // { section: [query1, query2, ...] }
const serviceUptime = {}; // { section: startTimestamp }

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('button[title]:not([aria-label])').forEach(button => {
    button.setAttribute('aria-label', button.getAttribute('title'));
  });
  // Load version map from backend (downloads.json)
  try { VERSION_MAP = await api.download.getVersions(); } catch { VERSION_MAP = {}; }
  await refreshInstalledVersionsMap();
  config = await api.config.get();
  try {
    const info = await api.app.getInfo();
    runtimePlatform = info.platform || 'unknown';
    runtimeMode = info.mode || runtimeMode;
    runtimeSafeMode = Boolean(info.safeMode);
    startupPanel = info.initialPanel || '';
    const versionLabel = document.querySelector('.titlebar-version');
    if (versionLabel) versionLabel.textContent = `v${info.version}`;
    const dataRootLabel = document.getElementById('app-data-root');
    if (dataRootLabel) dataRootLabel.textContent = info.dataRoot;
    document.getElementById('safe-mode-badge')?.classList.toggle('hidden', !runtimeSafeMode);
    if (runtimeSafeMode) showToast('Safe mode is active: automatic starts, scheduled backups and system integration are paused', 'warning');
    if (info.migration?.migrated) showToast(`Configuration migrated from schema ${info.migration.from} to ${info.migration.to}`, 'success');
    if (info.recovery?.interrupted?.length) showToast(`Recovered ${info.recovery.interrupted.length} interrupted project state(s)`, info.recovery.success ? 'warning' : 'error');
    applyPlatformLabels();
  } catch {}
  bindWindowControls();
  bindNavigation();
  bindSidebarServiceControls();
  bindWebServerOpenButtons();
  bindSaveBarButtons();
  bindProfileModal();
  bindEnvVarButtons();
  bindStopAllAndReset();
  bindSidebarGroupChecks();
  bindDashboardToolbar();
  initSubTabs();
  initDbViewers();
  initDatabaseManager();
  initWorkspaceCenter();
  initTestLab();
  initHubPanel();
  initMonitoringCenter();
  initLogViewers();
  initProjectManagers();
  bindFolderButtons();
  initTerminal();
  initRemoteAccess();
  initServerWorkspace();
  initOperationsCenter();
  initCommandPalette();
  initComposer();
  initAppStore();
  initVersionManager();
  initSecurityPanel();
  initUpdatePanel();
  initSupportReport();
  initIntegrations();
  initCollapsibleGroups();
  bindShortcutsModal();
  if (startupPanel) switchToPanel(startupPanel);
  populateUI();
  startStatusPolling();
  api.path.onPythonManagerStatus?.(async ({ stage, automatic, alreadyInstalled, skipped, error }) => {
    await refreshPathManagement();
    if (!automatic) return;
    if (stage === 'installing') showToast('Installing the official Python Manager automatically…', 'warning');
    else if (stage === 'removing') showToast('Removing the KitsuneServ-managed Python Manager…', 'warning');
    else if (stage === 'removed') showToast('Python Manager removed because no KitsuneServ Python runtimes remain', 'success');
    else if (stage === 'complete' && !alreadyInstalled && !skipped) showToast('Official Python Manager installed and connected to KitsuneServ', 'success');
    else if (stage === 'failed') showToast(`Automatic Python Manager installation failed: ${error}. The fallback launcher remains available.`, 'error');
  });
  initPathManagement();
  autoStartServices();

  // Listen for download progress
  api.download.onProgress(handleDownloadProgress);

  // Listen for App Store install progress
  api.appStore.onProgress(handleAppStoreProgress);

  // Listen for service crash/exit notifications
  api.service.onExited(({ section, code }) => {
    if (code !== 0 && code !== null) {
      showToast(`${sectionLabel(section)} exited unexpectedly (code ${code})`, 'error');
    }
    refreshStatuses();
  });

  // Listen for tray Start All command
  api.tray.onStartAll(() => {
    document.getElementById('btn-start-all')?.click();
  });
  api.remote?.onOpenPanel?.(panel => switchToPanel(panel));

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape closes modals, command palette, shortcuts
    if (e.key === 'Escape') {
      const palette = document.getElementById('command-palette');
      if (palette && !palette.classList.contains('hidden')) {
        palette.classList.add('hidden');
        return;
      }
      const shortcuts = document.getElementById('shortcuts-modal');
      if (shortcuts && !shortcuts.classList.contains('hidden')) {
        shortcuts.classList.add('hidden');
        return;
      }
      const modal = document.getElementById('profile-modal');
      if (modal && !modal.classList.contains('hidden')) {
        closeProfileModal();
        return;
      }
    }
    // Ctrl+/ — keyboard shortcuts overlay
    if (e.ctrlKey && e.key === '/') {
      e.preventDefault();
      const sm = document.getElementById('shortcuts-modal');
      if (sm) sm.classList.toggle('hidden');
      return;
    }
    // Ctrl+D — dashboard
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      switchToPanel('dashboard');
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault(); switchToPanel('terminal'); createTerminal(); return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); switchToPanel('file-manager'); return;
    }
    // Ctrl+1-9 — switch service panels
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const idx = parseInt(e.key) - 1;
      if (idx < SERVICE_SECTIONS.length) switchToPanel(SERVICE_SECTIONS[idx]);
      return;
    }
  });
});

/* ===== Window Controls ===== */
function bindWindowControls() {
  // In web/server mode, hide Electron-specific titlebar buttons
  if (window.__KITSUNE_WEB_MODE__) {
    const controls = document.querySelector('.titlebar-controls');
    if (controls) controls.style.display = 'none';
    const titlebar = document.getElementById('titlebar');
    if (titlebar) titlebar.style.webkitAppRegion = 'none';
    return;
  }
  document.getElementById('btn-minimize').addEventListener('click', () => api.window.minimize());
  document.getElementById('btn-maximize').addEventListener('click', () => api.window.maximize());
  document.getElementById('btn-close').addEventListener('click', () => api.window.close());
}

/* ===== Navigation ===== */
function switchToPanel(panelId) {
  const navItems = document.querySelectorAll('.nav-item[data-panel]');
  navItems.forEach(n => n.classList.remove('active'));
  const target = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('panel-' + panelId);
  if (panel) panel.classList.add('active');
  document.querySelector('.content')?.classList.toggle('terminal-mode', panelId === 'terminal');
  if (panelId === 'appstore') refreshAppStore();
  if (panelId === 'versions') refreshVersionManager();
  if (panelId === 'database-manager') refreshDatabaseConnections();
  if (panelId === 'file-manager') refreshFileManager();
  if (panelId === 'server-workspace') refreshServerWorkspace();
  if (panelId === 'operations-center') refreshOperationsCenter();
  if (panelId === 'workspaces') refreshWorkspaceCenter();
  if (panelId === 'test-lab') refreshTestLabs();
  if (panelId === 'hub') refreshHubPanel();
  if (panelId === 'monitoring') refreshMonitoringCenter(true);
  if (panelId === 'dashboard') {
    refreshDashboard();
    void refreshDashboardProjects(true);
  }
  if (panelId === 'general') {
    refreshSecurityPanel();
    refreshIntegrations();
  }
}

function bindNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-panel]');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't switch panel if click was on a nav-btn
      if (e.target.closest('.nav-controls')) return;
      switchToPanel(item.dataset.panel);
    });
  });
}

/* ===== Sidebar Start / Stop Controls ===== */
function bindSidebarServiceControls() {
  for (const section of SERVICE_SECTIONS) {
    const controls = document.querySelector(`.nav-controls[data-service="${section}"]`);
    if (!controls) continue;

    const startBtn = controls.querySelector('.nav-btn-start');
    const stopBtn = controls.querySelector('.nav-btn-stop');
    const restartBtn = controls.querySelector('.nav-btn-restart');
    if (!startBtn) continue;

    startBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      startBtn.classList.add('loading');
      const result = await api.service.start(section);
      startBtn.classList.remove('loading');
      if (!result.success) {
        if (result.needsDownload) {
          const profile = getActiveProfile(section);
          showToast(`${sectionLabel(section)} ${profile?.version || ''} is not installed. Install it in Version Manager.`, 'error');
          openVersionManager(section);
        } else {
          showToast(result.error, 'error');
          openLogViewer(section);
        }
      } else {
        if (result.warnings?.length) {
          for (const w of result.warnings) showToast(w, 'error');
        }
        openLogViewer(section);
      }
      refreshStatuses();
    });

    stopBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      stopBtn.classList.add('loading');
      const result = await api.service.stop(section);
      stopBtn.classList.remove('loading');
      if (!result.success) showToast(result.error, 'error');
      setTimeout(() => refreshLogs(section), 500);
      refreshStatuses();
    });

    restartBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      showToast(`Restarting ${sectionLabel(section)}...`, 'success');
      const result = await api.service.restart(section);
      if (!result.success) showToast(result.error, 'error');
      else showToast(`${sectionLabel(section)} restarted`, 'success');
      setTimeout(() => refreshLogs(section), 500);
      refreshStatuses();
    });
  }
}

function resolveDownloadKey(profile, section) {
  return section;
}

function applyPlatformLabels() {
  const isWindows = runtimePlatform === 'win32';
  const pathDescription = document.getElementById('path-platform-description');
  const pathHint = document.getElementById('path-platform-hint');
  if (pathDescription) {
    pathDescription.textContent = isWindows
      ? 'Choose which active service versions are available from every Windows terminal. A selected entry is replaced automatically whenever you switch its active version.'
      : 'Choose which active service versions are exported by the KitsuneServ block in your shell profile. Entries follow active version changes automatically.';
  }
  if (pathHint) {
    pathHint.textContent = isWindows
      ? 'Changes are applied immediately to your Windows user PATH. New terminals see them at once; the built-in terminal always includes every installed active runtime.'
      : 'Changes are applied to your user shell profile. Open a new shell or source the profile; the built-in terminal always includes every installed active runtime.';
  }
  if (!isWindows) {
    document.getElementById('python-launcher-status')?.classList.add('hidden');
    document.getElementById('python-alias-warning')?.classList.add('hidden');
  }
  if (runtimeMode === 'server') {
    for (const id of ['general-autoStartOnBoot', 'general-startMinimized']) {
      const control = document.getElementById(id);
      control?.closest('.form-group')?.classList.add('hidden');
    }
  }
}

async function refreshInstalledVersionsMap(catalog = null) {
  try {
    if (Array.isArray(catalog)) {
      installedVersionsMap = Object.fromEntries(SERVICE_SECTIONS.map(section => {
        const service = catalog.find(item => item.id === section);
        const versions = service?.installedVersions || service?.versions?.filter(item => item.installed).map(item => item.version) || [];
        return [section, [...new Set(versions.map(String))]];
      }));
      return installedVersionsMap;
    }
    const entries = await Promise.all(SERVICE_SECTIONS.map(async section => {
      try { return [section, await api.download.installedVersions(section)]; }
      catch { return [section, []]; }
    }));
    installedVersionsMap = Object.fromEntries(entries.map(([section, versions]) => [section, [...new Set((versions || []).map(String))]]));
  } catch {
    installedVersionsMap = {};
  }
  return installedVersionsMap;
}

function installedVersionsFor(section) {
  const installed = installedVersionsMap[section] || [];
  const installedSet = new Set(installed);
  const catalogOrder = (VERSION_MAP[section] || []).filter(version => installedSet.has(version));
  return [...catalogOrder, ...installed.filter(version => !catalogOrder.includes(version))];
}

function openVersionManager(section = '') {
  const search = document.getElementById('version-manager-search');
  if (search && section) search.value = sectionLabel(section);
  switchToPanel('versions');
}

function localBrowserHost(rawHost) {
  let host = String(rawHost || 'localhost').trim();
  const localNames = ['', '0.0.0.0', '::', '[::]', '*', '127.0.0.1', 'localhost'];
  if (window.__KITSUNE_WEB_MODE__ && localNames.includes(host.toLowerCase())) host = window.location.hostname;
  else if (!host || ['0.0.0.0', '::', '[::]', '*'].includes(host)) host = '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
  return host;
}

function webServiceUrl(section, profile = getActiveProfile(section)) {
  if (!profile || !WEB_SERVER_SECTIONS.includes(section)) return null;
  if (section === 'caddy' && profile.autoHttps) {
    return `https://${localBrowserHost(profile.serverName || 'localhost')}/`;
  }
  const port = section === 'caddy' ? Number(profile.httpPort || profile.port || 80) : Number(profile.port || 80);
  const host = localBrowserHost(profile.host);
  return `http://${host}${port === 80 ? '' : `:${port}`}/`;
}

async function openWebService(section) {
  if (!statuses[section]?.running) {
    showToast(`Start ${sectionLabel(section)} before opening the site`, 'error');
    return;
  }
  const url = webServiceUrl(section);
  if (!url) return showToast('Could not determine the server URL', 'error');
  const result = await api.shell.openExternal(url);
  if (!result?.success) showToast(result?.error || 'Could not open the browser', 'error');
}

function bindWebServerOpenButtons() {
  document.querySelectorAll('[data-open-service]').forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      void openWebService(button.dataset.openService);
    });
  });
}

/* ===== Profile Tab Strips ===== */
let modalSection = null;

function renderProfileStrip(section) {
  const strip = document.getElementById('profile-strip-' + section);
  if (!strip) return;
  const svc = config[section];
  if (!svc || !svc.profiles) return;

  strip.innerHTML = '';

  for (const p of svc.profiles) {
    const tab = document.createElement('div');
    tab.className = 'profile-tab' + (p.id === svc.activeProfileId ? ' active' : '');
    tab.dataset.profileId = p.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'profile-tab-name';
    nameSpan.textContent = p.name;

    const versionSpan = document.createElement('span');
    versionSpan.className = 'profile-tab-version';
    versionSpan.textContent = p.version;

    tab.appendChild(nameSpan);
    tab.appendChild(versionSpan);

    // Delete button (only if more than 1 profile)
    if (svc.profiles.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'profile-tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Delete profile';
      closeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete profile "${p.name}"? This cannot be undone.`)) return;
        const result = await api.config.deleteProfile(section, p.id);
        if (result.success) {
          config = result.config;
          renderProfileStrip(section);
          populateSectionUI(section);
          showToast('Profile deleted', 'success');
          notifyPathWarning(result);
        } else {
          showToast(result.error || 'Could not delete profile', 'error');
        }
      });
      tab.appendChild(closeBtn);
    }

    // Duplicate button
    const dupBtn = document.createElement('button');
    dupBtn.className = 'profile-tab-close';
    dupBtn.textContent = '⧉';
    dupBtn.title = 'Duplicate profile';
    dupBtn.style.marginRight = svc.profiles.length > 1 ? '0' : '4px';
    dupBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await api.config.duplicateProfile(section, p.id);
      if (result.success) {
        config = result.config;
        renderProfileStrip(section);
        populateSectionUI(section);
        showToast('Profile duplicated', 'success');
        notifyPathWarning(result);
      }
    });
    tab.appendChild(dupBtn);

    // Click to switch profile
    tab.addEventListener('click', async (e) => {
      if (e.target.closest('.profile-tab-close')) return;
      if (p.id === svc.activeProfileId) return;
      const result = await api.config.setActiveProfile(section, p.id);
      if (result.success) {
        config = result.config;
        renderProfileStrip(section);
        populateSectionUI(section);
        showToast(`Switched to ${p.name}${result.restarted?.length ? ' and restarted the stack' : ''}`, 'success');
        notifyPathWarning(result);
        refreshStatuses();
      } else {
        showToast(result.error || 'Could not switch profile', 'error');
      }
    });

    // Double-click name to rename
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(section, p.id, nameSpan);
    });

    strip.appendChild(tab);
  }

  // Add "+" button
  const addBtn = document.createElement('button');
  addBtn.className = 'profile-add-btn';
  addBtn.textContent = '+';
  addBtn.title = 'New profile';
  addBtn.addEventListener('click', () => openNewProfileModal(section));
  strip.appendChild(addBtn);
}

function startInlineRename(section, profileId, nameSpan) {
  const current = nameSpan.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'profile-rename-input';

  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    const newName = input.value.trim() || current;
    const newSpan = document.createElement('span');
    newSpan.className = 'profile-tab-name';
    newSpan.textContent = newName;
    input.replaceWith(newSpan);

    if (newName !== current) {
      const result = await api.config.renameProfile(section, profileId, newName);
      if (result.success) config = result.config;
    }

    newSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(section, profileId, newSpan);
    });
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}

/* ===== Profile Creation Modal ===== */
function bindProfileModal() {
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
  document.getElementById('profile-modal-cancel').addEventListener('click', closeProfileModal);
  document.getElementById('profile-modal-confirm').addEventListener('click', confirmNewProfile);
  document.getElementById('profile-modal').addEventListener('click', (e) => {
    if (e.target.id === 'profile-modal') closeProfileModal();
  });
}

function openNewProfileModal(section) {
  modalSection = section;
  const modal = document.getElementById('profile-modal');
  const nameInput = document.getElementById('profile-modal-name');
  const typeGroup = document.getElementById('profile-modal-type-group');
  const title = document.getElementById('profile-modal-title');

  title.textContent = `New ${sectionLabel(section)} Profile`;
  nameInput.value = '';
  typeGroup.classList.add('hidden');
  populateModalVersions(section);

  modal.classList.remove('hidden');
  nameInput.focus();
}

function populateModalVersions(key) {
  const versionSelect = document.getElementById('profile-modal-version');
  const versions = installedVersionsFor(key);
  const confirmButton = document.getElementById('profile-modal-confirm');
  versionSelect.innerHTML = '';
  if (!versions.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No installed versions — use Version Manager';
    opt.disabled = true;
    opt.selected = true;
    versionSelect.appendChild(opt);
  }
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    versionSelect.appendChild(opt);
  }
  versionSelect.disabled = versions.length === 0;
  if (confirmButton) confirmButton.disabled = versions.length === 0;
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
  modalSection = null;
}

async function confirmNewProfile() {
  if (!modalSection) return;
  const name = document.getElementById('profile-modal-name').value.trim();
  const versionSelect = document.getElementById('profile-modal-version');
  const section = modalSection;

  const type = section;
  const version = versionSelect.value;

  if (!version) {
    showToast('Please select a version', 'error');
    return;
  }

  const result = await api.config.newProfile(section, type, version, name || undefined);
  if (result.success) {
    config = result.config;
    renderProfileStrip(section);
    populateSectionUI(section);
    showToast('Profile created', 'success');
    notifyPathWarning(result);
    closeProfileModal();
  } else {
    showToast(result.error || 'Failed to create profile', 'error');
  }
}

/* ===== Env Var Buttons ===== */
function bindEnvVarButtons() {
  document.getElementById('btn-add-node-env')?.addEventListener('click', () => addEnvVarRow('node'));
  document.getElementById('btn-add-go-env')?.addEventListener('click', () => addEnvVarRow('go'));
  document.getElementById('btn-add-bun-env')?.addEventListener('click', () => addEnvVarRow('bun'));
  document.getElementById('btn-add-python-env')?.addEventListener('click', () => addEnvVarRow('python'));
  document.getElementById('btn-add-deno-env')?.addEventListener('click', () => addEnvVarRow('deno'));
}

function addEnvVarRow(section, key = '', value = '') {
  const container = document.getElementById(section + '-envVars-container');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'env-var-row';
  row.innerHTML = `<input type="text" placeholder="KEY" value="${escapeHtml(key)}" class="env-key"><input type="text" placeholder="Value" value="${escapeHtml(value)}" class="env-value"><button class="btn-remove-env" title="Remove">✕</button>`;
  row.querySelector('.btn-remove-env').addEventListener('click', () => { row.remove(); markDirty(); });
  row.querySelectorAll('input').forEach(i => i.addEventListener('input', () => markDirty()));
  container.appendChild(row);
}

/* ===== Stop All & Reset ===== */
function bindStopAllAndReset() {
  document.getElementById('btn-start-all')?.addEventListener('click', async () => {
    // Use sidebar checkboxes as source of truth for which services to start
    const grouped = SERVICE_SECTIONS.filter(s => {
      const cb = document.querySelector(`.nav-group-check[data-service="${s}"]`);
      return cb && cb.checked;
    });
    if (!grouped.length) { showToast('No services marked for Start All', 'error'); return; }
    // Start ordering: databases → cache → php → web servers → runtimes
    const startPriority = { postgresql: 0, mysql: 0, mariadb: 0, mongodb: 0, redis: 1, memcached: 1, minio: 1, php: 2, apache: 3, nginx: 3, caddy: 3, node: 4, go: 4, bun: 4, python: 4, deno: 4 };
    grouped.sort((a, b) => (startPriority[a] ?? 9) - (startPriority[b] ?? 9));
    showToast('Starting selected services...', 'success');
    for (const section of grouped) {
      if (statuses[section]?.running) continue;
      const profile = getActiveProfile(section);
      if (!profile) continue;
      const dlKey = resolveDownloadKey(profile, section);
      const installed = await api.download.isInstalled(dlKey, profile.version);
      if (installed) {
        const result = await api.service.start(section);
        if (!result.success && result.error) {
          showToast(`${sectionLabel(section)}: ${result.error}`, 'error');
        }
      }
    }
    refreshStatuses();
  });

  document.getElementById('btn-stop-all')?.addEventListener('click', async () => {
    const runningCount = SERVICE_SECTIONS.filter(s => statuses[s]?.running).length;
    if (!runningCount) { showToast('No services running', 'error'); return; }
    if (!confirm(`Stop all ${runningCount} running services?`)) return;
    await api.service.stopAll();
    showToast('All services stopped', 'success');
    refreshStatuses();
  });

  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset all configuration to defaults? This cannot be undone.')) return;
    const result = await api.config.reset();
    if (result.success) {
      config = await api.config.get();
      populateUI();
      await refreshPathManagement();
      dirty = false;
      updateSaveBar();
      showToast('Config reset to defaults', 'success');
    }
  });
}

/* ===== Sidebar Start-All Group Checkboxes ===== */
function bindSidebarGroupChecks() {
  document.querySelectorAll('.nav-group-check').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      e.stopPropagation();
      const section = cb.dataset.service;
      const profile = getActiveProfile(section);
      if (!profile) return;
      profile.startAllGroup = cb.checked;
      // Also sync the panel toggle if it exists
      const panelToggle = document.getElementById(section + '-startAllGroup');
      if (panelToggle) panelToggle.checked = cb.checked;
      markDirty();
    });
    // Prevent checkbox click from navigating to the panel
    cb.addEventListener('click', (e) => e.stopPropagation());
  });
}

function syncSidebarGroupChecks() {
  for (const section of SERVICE_SECTIONS) {
    const cb = document.querySelector(`.nav-group-check[data-service="${section}"]`);
    if (!cb) continue;
    const profile = getActiveProfile(section);
    if (!profile) { cb.checked = false; continue; }
    // If explicitly set, respect it; otherwise default to installed status
    if (profile.startAllGroup !== undefined) {
      cb.checked = !!profile.startAllGroup;
    } else {
      cb.checked = !!installedMap[section];
    }
  }
}

/* ===== Collapsible Sidebar Groups ===== */
function initCollapsibleGroups() {
  document.querySelectorAll('.sidebar-group-label[data-group]').forEach(label => {
    label.addEventListener('click', () => {
      label.classList.toggle('collapsed');
      // Hide/show nav-items until next group label
      let sibling = label.nextElementSibling;
      while (sibling && !sibling.classList.contains('sidebar-group-label') && !sibling.classList.contains('sidebar-divider')) {
        sibling.style.display = label.classList.contains('collapsed') ? 'none' : '';
        sibling = sibling.nextElementSibling;
      }
    });
  });
}

/* ===== Keyboard Shortcuts Modal ===== */
function bindShortcutsModal() {
  const modal = document.getElementById('shortcuts-modal');
  const closeBtn = document.getElementById('shortcuts-close');
  if (!modal || !closeBtn) return;
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

/* ===== Dashboard Toolbar ===== */
function bindDashboardToolbar() {
  document.getElementById('dash-start-all')?.addEventListener('click', () => {
    document.getElementById('btn-start-all')?.click();
  });
  document.getElementById('dash-stop-all')?.addEventListener('click', () => {
    document.getElementById('btn-stop-all')?.click();
  });
  document.getElementById('dash-health-all')?.addEventListener('click', async () => {
    showToast('Running health checks...', 'success');
    for (const section of SERVICE_SECTIONS) {
      if (!statuses[section]?.running) continue;
      const result = await api.service.healthCheck(section);
      if (!result.healthy) {
        showToast(`${sectionLabel(section)}: unhealthy`, 'error');
      }
    }
    showToast('Health checks complete', 'success');
  });

  document.getElementById('dash-projects-manage')?.addEventListener('click', () => switchToPanel('workspaces'));

  // Dashboard search / filter
  const searchInput = document.getElementById('dash-search');
  if (searchInput) {
    searchInput.addEventListener('input', applyDashboardFilter);
  }

  document.getElementById('dash-download-all')?.addEventListener('click', () => openVersionManager());
}

/* ===== Save Bar ===== */
function bindSaveBarButtons() {
  // Auto-save — no manual save bar needed
}

async function saveConfig() {
  // Collect all changes from UI into config object
  collectAllFromUI();
  const result = await api.config.save(config);
  if (result.success) {
    dirty = false;
  } else {
    showToast('Save failed: ' + result.error, 'error');
  }
}

function markDirty() {
  dirty = true;
  // Auto-save with debounce
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { saveConfig(); }, 600);
}

function updateSaveBar() {
  // No-op — auto-save replaces the save bar
}

/* ===== Populate UI ===== */
function populateUI() {
  dashboardBuilt = false;
  for (const section of SERVICE_SECTIONS) {
    populateProfileSelect(section);
    populateSectionUI(section);
  }
  syncSidebarGroupChecks();
  populateGeneralUI();
  syncDocumentRootControls();
  refreshDashboard();
  refreshStatuses();
}

function populateProfileSelect(section) {
  renderProfileStrip(section);
}

function populateSectionUI(section) {
  const profile = getActiveProfile(section);
  if (!profile) return;

  // Set all data-pkey inputs from profile
  const panel = document.getElementById('panel-' + section);
  if (!panel) return;

  panel.querySelectorAll('[data-pkey]').forEach(el => {
    const key = el.dataset.pkey;
    // Skip version select — handled separately below
    if (key === 'version' && el.tagName === 'SELECT') return;

    let value = getNestedValue(profile, key);

    if (el.type === 'checkbox') {
      el.checked = !!value;
    } else if (el.tagName === 'SELECT') {
      el.value = value ?? '';
    } else if (el.tagName === 'TEXTAREA') {
      el.value = value ?? '';
    } else {
      el.value = value ?? '';
    }

    // Remove old listeners to avoid duplicates
    const newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
    if (newEl.type === 'checkbox') {
      newEl.addEventListener('change', () => {
        markDirty();
        // Sync sidebar group checkbox when panel toggle changes
        if (newEl.dataset.pkey === 'startAllGroup') {
          const sidebarCb = document.querySelector(`.nav-group-check[data-service="${section}"]`);
          if (sidebarCb) sidebarCb.checked = newEl.checked;
        }
      });
    } else {
      newEl.addEventListener('input', () => markDirty());
    }
  });

  // Version dropdown — populate options from VERSION_MAP then set to profile version
  populateVersionDropdown(section, section);

  // Attach version change handler (re-attach each time since other data-pkey elements got cloned)
  const versionEl = document.getElementById(section + '-version');
  if (versionEl) {
    // Clone to remove any old change handler
    const freshVersionEl = versionEl.cloneNode(true);
    versionEl.parentNode.replaceChild(freshVersionEl, versionEl);
    // Restore value after clone since cloneNode may not preserve selectedIndex
    freshVersionEl.value = profile.version;

    freshVersionEl.addEventListener('change', async () => {
      const newVersion = freshVersionEl.value;
      if (!installedVersionsFor(section).includes(newVersion)) {
        showToast('Install this version in Version Manager first', 'error');
        populateSectionUI(section);
        return;
      }
      const svc = config[section];
      if (!svc) return;

      // Check if a profile for this version already exists
      const existing = svc.profiles.find(p => p.version === newVersion);
      if (existing) {
        // Switch to existing profile
        const result = await api.config.setActiveProfile(section, existing.id);
        if (result.success) {
          config = result.config;
          dirty = false;
          updateSaveBar();
          renderProfileStrip(section);
          populateSectionUI(section);
          showToast(`Switched to ${existing.name}`, 'success');
          notifyPathWarning(result);
        } else showToast(result.error || 'Could not switch profile', 'error');
      } else {
        // Create a new profile for the new version
        const result = await api.config.newProfile(section, section, newVersion);
        if (result.success) {
          config = result.config;
          dirty = false;
          updateSaveBar();
          renderProfileStrip(section);
          populateSectionUI(section);
          showToast(`Profile created for ${sectionLabel(section)} ${newVersion}`, 'success');
          notifyPathWarning(result);
        } else showToast(result.error || 'Could not create the profile', 'error');
      }
      refreshStatuses();
    });
  }

  // PHP extensions
  if (section === 'php') {
    populatePhpExtensions(profile);
  }

  // Env vars
  if (['node', 'go', 'bun', 'python', 'deno'].includes(section)) {
    populateEnvVars(section, profile);
  }

  // Project selector for runtime services
  if (['node', 'go', 'bun', 'python', 'deno'].includes(section)) {
    populateProjectSelector(section, profile);
  }

  // Update install status
  updateInstallStatus(section, profile);
}

function populateVersionDropdown(section, type) {
  const versionSelect = document.getElementById(section + '-version');
  if (!versionSelect) return;
  const versions = installedVersionsFor(type);
  const profile = getActiveProfile(section);
  const activeVersion = profile?.version || '';
  versionSelect.innerHTML = '';
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    versionSelect.appendChild(opt);
  }
  // Keep a missing active version visible without offering other uninstalled releases.
  if (activeVersion && !versions.includes(activeVersion)) {
    const opt = document.createElement('option');
    opt.value = activeVersion;
    opt.textContent = activeVersion + ' (not installed — use Version Manager)';
    opt.disabled = true;
    versionSelect.appendChild(opt);
  }
  if (activeVersion) versionSelect.value = activeVersion;
  versionSelect.disabled = versions.length === 0;
}

function populatePhpExtensions(profile) {
  const grid = document.getElementById('php-extensions-grid');
  if (!grid) return;

  // Merge known extensions with profile state (preserve enabled flags + custom extensions)
  const profileMap = {};
  if (profile.extensions) {
    for (const ext of profile.extensions) profileMap[ext.name] = ext.enabled;
  }

  // Build full list: all known + any custom ones from profile
  const allKnown = new Set(PHP_ALL_EXTENSIONS);
  const customExts = profile.extensions
    ? profile.extensions.filter(e => !allKnown.has(e.name)).map(e => e.name)
    : [];

  // Populate category filter
  const catSelect = document.getElementById('php-ext-category');
  if (catSelect && catSelect.options.length <= 1) {
    for (const cat of Object.keys(PHP_EXTENSIONS)) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    }
    if (customExts.length) {
      const opt = document.createElement('option');
      opt.value = 'Custom';
      opt.textContent = 'Custom';
      catSelect.appendChild(opt);
    }
  }

  // Render
  renderPhpExtensions(profile, '');

  // Search handler
  const searchInput = document.getElementById('php-ext-search');
  if (catSelect) catSelect.onchange = () => renderPhpExtensions(profile, searchInput?.value || '');
  if (searchInput) searchInput.oninput = debounce(() => renderPhpExtensions(profile, searchInput.value), 150);

  // Add custom extension button
  const addBtn = document.getElementById('btn-add-php-ext');
  if (addBtn) {
    addBtn.onclick = () => {
      const name = prompt('Extension name (e.g. swoole, amqp):');
      if (!name) return;
      const clean = name.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase().trim();
      if (!clean) { showToast('Invalid extension name', 'error'); return; }
      if (!profile.extensions) profile.extensions = [];
      if (profile.extensions.some(e => e.name === clean)) {
        showToast(`"${clean}" already in list`, 'error');
        return;
      }
      profile.extensions.push({ name: clean, enabled: true });
      markDirty();
      // Refresh category filter to include Custom
      const catSel = document.getElementById('php-ext-category');
      if (catSel && ![...catSel.options].some(o => o.value === 'Custom')) {
        const opt = document.createElement('option');
        opt.value = 'Custom';
        opt.textContent = 'Custom';
        catSel.appendChild(opt);
      }
      renderPhpExtensions(profile, document.getElementById('php-ext-search')?.value || '');
      showToast(`Extension "${clean}" added`, 'success');
    };
  }
}

function renderPhpExtensions(profile, searchTerm) {
  const grid = document.getElementById('php-extensions-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const catSelect = document.getElementById('php-ext-category');
  const selectedCat = catSelect ? catSelect.value : 'all';
  const filter = searchTerm.toLowerCase().trim();

  // Build profile map for enabled state
  const profileMap = {};
  if (profile.extensions) {
    for (const ext of profile.extensions) profileMap[ext.name] = ext.enabled;
  }

  const allKnown = new Set(PHP_ALL_EXTENSIONS);
  const customExts = profile.extensions
    ? profile.extensions.filter(e => !allKnown.has(e.name))
    : [];

  // Categories to render
  const cats = { ...PHP_EXTENSIONS };
  if (customExts.length) cats['Custom'] = customExts.map(e => e.name);

  for (const [category, exts] of Object.entries(cats)) {
    if (selectedCat !== 'all' && selectedCat !== category) continue;

    const filtered = exts.filter(name => !filter || name.includes(filter));
    if (!filtered.length) continue;

    const label = document.createElement('div');
    label.className = 'ext-category-label';
    label.textContent = `${category} (${filtered.length})`;
    grid.appendChild(label);

    for (const extName of filtered) {
      const enabled = profileMap[extName] ?? false;
      const isCustom = !allKnown.has(extName);
      const item = document.createElement('div');
      item.className = 'extension-item' + (enabled ? ' active' : '') + (isCustom ? ' custom' : '');
      item.dataset.name = extName;

      item.innerHTML = `
        <span class="extension-name" title="${escapeHtml(extName)}">${escapeHtml(extName)}</span>
        <div class="extension-actions">
          ${isCustom ? '<button class="ext-remove-btn" title="Remove">✕</button>' : ''}
          <label class="toggle-switch small"><input type="checkbox" ${enabled ? 'checked' : ''}><span class="toggle-slider"></span></label>
        </div>`;

      const cb = item.querySelector('input[type=checkbox]');
      cb.addEventListener('change', () => {
        // Update or add to profile
        if (!profile.extensions) profile.extensions = [];
        const existing = profile.extensions.find(e => e.name === extName);
        if (existing) { existing.enabled = cb.checked; }
        else { profile.extensions.push({ name: extName, enabled: cb.checked }); }
        item.classList.toggle('active', cb.checked);
        markDirty();
      });

      if (isCustom) {
        item.querySelector('.ext-remove-btn').addEventListener('click', () => {
          profile.extensions = profile.extensions.filter(e => e.name !== extName);
          markDirty();
          renderPhpExtensions(profile, document.getElementById('php-ext-search')?.value || '');
        });
      }

      grid.appendChild(item);
    }
  }

  if (!grid.children.length) {
    grid.innerHTML = '<div class="log-empty">No extensions match your search.</div>';
  }
}

function populateEnvVars(section, profile) {
  const container = document.getElementById(section + '-envVars-container');
  if (!container) return;
  container.innerHTML = '';
  const envVars = profile.envVars || [];
  for (const ev of envVars) {
    addEnvVarRow(section, ev.key || '', ev.value || '');
  }
}

async function populateProjectSelector(section, profile) {
  const select = document.getElementById(section + '-project');
  if (!select) return;
  const projects = await api.projects.list(section);
  const current = profile.project || '';
  select.innerHTML = '<option value="">(custom path)</option>';
  for (const name of projects) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = '📁 ' + name;
    select.appendChild(opt);
  }
  if (current && projects.includes(current)) {
    select.value = current;
  } else {
    select.value = '';
  }
  // When project changes, update the profile and entry point hint
  const newSel = select.cloneNode(true);
  select.parentNode.replaceChild(newSel, select);
  // Re-populate options (cloneNode doesn't preserve dynamic content)
  newSel.innerHTML = '<option value="">(custom path)</option>';
  for (const name of projects) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = '📁 ' + name;
    newSel.appendChild(opt);
  }
  if (current && projects.includes(current)) newSel.value = current;
  newSel.addEventListener('change', () => { markDirty(); });
}

async function updateInstallStatus(section, profile) {
  const el = document.getElementById('install-status-' + section);
  if (!el) return;
  const dlKey = resolveDownloadKey(profile, section);
  const installed = await api.download.isInstalled(dlKey, profile.version);
  if (installed) {
    el.innerHTML = `<span class="installed-badge">✓ ${escapeHtml(dlKey)} ${escapeHtml(profile.version)} installed</span>`;
  } else {
    el.innerHTML = `<span class="not-installed-badge">⚠ ${escapeHtml(dlKey)} ${escapeHtml(profile.version)} is not installed</span><button class="btn-manage-version" title="Open Version Manager">📦 Manage versions</button>`;
    el.querySelector('.btn-manage-version').addEventListener('click', () => openVersionManager(section));
  }
}

/* ===== General Settings ===== */
function populateGeneralUI() {
  const general = config.general || {};
  document.querySelectorAll('[data-section="general"]').forEach(el => {
    const key = el.dataset.key;
    const value = general[key];
    if (el.type === 'checkbox') {
      el.checked = !!value;
      el.addEventListener('change', () => markDirty());
    } else {
      el.value = value ?? '';
      el.addEventListener('input', () => markDirty());
    }
  });
  // Apply theme
  applyTheme(general.theme || 'dark');
  const themeSel = document.getElementById('general-theme');
  if (themeSel) {
    themeSel.addEventListener('change', () => applyTheme(themeSel.value));
  }
  // Hide Electron-only options when running in web/server mode
  if (window.__KITSUNE_WEB_MODE__) {
    const elOnly = ['general-startMinimized', 'general-autoStartOnBoot'];
    for (const id of elOnly) {
      const el = document.getElementById(id);
      if (el) {
        const group = el.closest('.form-group');
        if (group) group.style.display = 'none';
      }
    }
  }
}

function initSecurityPanel() {
  document.getElementById('security-refresh')?.addEventListener('click', refreshSecurityPanel);
  document.getElementById('security-audit-verify')?.addEventListener('click', async () => {
    const result = await api.security.verifyAudit();
    showToast(result.valid ? `Audit chain verified (${result.entries} entries)` : `Audit chain is invalid at sequence ${result.firstInvalidSequence}`, result.valid ? 'success' : 'error');
    await refreshSecurityPanel();
  });
  document.getElementById('security-revoke-others')?.addEventListener('click', async () => {
    if (!confirm('Revoke every other active KitsuneServ web session?')) return;
    const result = await api.security.revokeOtherSessions();
    showToast(result.success ? `Revoked ${result.removed} session(s)` : result.error, result.success ? 'success' : 'error');
    await refreshSecurityPanel();
  });
}

/* ===== Kitsune Hub ===== */
let hubSnapshot = { status: {}, settings: {}, nodes: [], routes: [], objects: [], deployments: [], users: [], connectors: [], remotes: [] };
let hubPairing = null;

function initHubPanel() {
  if (!api.hub) return;
  document.querySelectorAll('[data-hub-tab],[data-hub-tab-target]').forEach(button => button.addEventListener('click', () => selectHubTab(button.dataset.hubTab || button.dataset.hubTabTarget)));
  document.getElementById('hub-enabled')?.addEventListener('change', async event => {
    try { await api.hub.configure({ enabled: event.target.checked }); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('hub-settings-save')?.addEventListener('click', saveHubSettings);
  document.getElementById('hub-sync-local')?.addEventListener('click', publishHubLocal);
  document.getElementById('hub-sync-refresh')?.addEventListener('click', publishHubLocal);
  document.getElementById('hub-reconcile')?.addEventListener('click', async () => {
    try { const result = await api.hub.reconcile(); showToast(result.success ? 'Wszystkie węzły i trasy są spójne' : `Wykryto ${result.issues.length} problemów`, result.success ? 'success' : 'warning'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('hub-pair-node')?.addEventListener('click', async () => {
    const name = prompt('Nazwa nowego urządzenia lub serwera:', 'Kitsune node'); if (!name) return;
    const kind = prompt('Typ: desktop, server, plesk, agent lub ci', 'desktop') || 'desktop';
    try { hubPairing = await api.hub.createPairing({ name, kind }); selectHubTab('nodes'); await refreshHubPanel(); showToast('Kod parowania jest ważny przez 10 minut', 'success'); } catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('hub-route-add')?.addEventListener('click', () => document.getElementById('hub-route-form')?.classList.toggle('hidden'));
  document.getElementById('hub-route-save')?.addEventListener('click', saveHubRoute);
  document.getElementById('hub-user-add')?.addEventListener('click', () => document.getElementById('hub-user-form')?.classList.toggle('hidden'));
  document.getElementById('hub-user-save')?.addEventListener('click', saveHubUser);
  document.getElementById('hub-plesk-add')?.addEventListener('click', () => document.getElementById('hub-plesk-form')?.classList.toggle('hidden'));
  document.getElementById('hub-plesk-save')?.addEventListener('click', savePleskConnector);
  document.getElementById('hub-remote-add')?.addEventListener('click', () => {
    const form = document.getElementById('hub-remote-form'); if (!form) return;
    const opening = form.classList.contains('hidden'); form.classList.toggle('hidden');
    if (opening) document.getElementById('hub-remote-url')?.focus();
  });
  document.getElementById('hub-remote-save')?.addEventListener('click', saveHubRemote);
  document.getElementById('hub-sync-filter')?.addEventListener('change', renderHubSync);
  document.getElementById('panel-hub')?.addEventListener('click', handleHubAction);
  api.hub.onChanged?.(debounce(() => refreshHubPanel(), 250));
  refreshHubPanel();
}

function selectHubTab(tab) {
  if (!tab) return;
  document.querySelectorAll('[data-hub-tab]').forEach(button => { const active = button.dataset.hubTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
  document.querySelectorAll('[data-hub-view]').forEach(view => view.classList.toggle('active', view.dataset.hubView === tab));
}

async function refreshHubPanel() {
  if (!api.hub || !document.getElementById('panel-hub')) return;
  try {
    const [status, settings, nodes, routes, objects, deployments, connectors, remotes, users] = await Promise.all([
      api.hub.status(), api.hub.settings(), api.hub.nodes(), api.hub.routes(), api.hub.inventory({ includeData: false }), api.hub.deployments({}), api.hub.connectors().catch(() => []), api.hub.remotes().catch(() => []), api.identity?.users?.().catch(() => []) || []
    ]);
    hubSnapshot = { status, settings, nodes, routes, objects, deployments, connectors, remotes, users };
    renderHubPanel();
  } catch (error) {
    const target = document.getElementById('hub-overview-nodes'); if (target) target.innerHTML = `<div class="hub-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderHubPanel() {
  const { status, settings, nodes, routes, objects, deployments, users, connectors, remotes } = hubSnapshot;
  const online = status.enabled;
  document.getElementById('hub-state-pill').textContent = online ? 'ONLINE' : 'OFFLINE';
  document.getElementById('hub-state-pill').classList.toggle('online', online);
  document.getElementById('hub-nav-dot').classList.toggle('online', online);
  document.getElementById('hub-live-dot').classList.toggle('online', online);
  document.getElementById('hub-live-text').textContent = online ? `Gateway aktywny · ${status.onlineNodes} węzłów online · tryb ${status.authMode}` : 'Hub jest wyłączony';
  document.getElementById('hub-domain-display').textContent = status.panelDomain || 'Skonfiguruj domenę panelu';
  document.getElementById('hub-domain-hint').textContent = status.panelDomain ? `Wildcard DNS/TLS: *.${status.panelDomain}` : 'Hub utworzy płaskie adresy typu project-sklep.panel.example.com i bezpiecznie skieruje je do właściwych usług.';
  document.getElementById('hub-enabled').checked = Boolean(status.enabled);
  document.getElementById('hub-stat-nodes').textContent = `${status.onlineNodes || 0} / ${status.nodeCount || 0}`;
  document.getElementById('hub-stat-routes').textContent = status.routeCount || 0; document.getElementById('hub-stat-objects').textContent = status.objectCount || 0; document.getElementById('hub-stat-deployments').textContent = status.pendingDeployments || 0;
  document.getElementById('hub-panel-domain').value = settings.panelDomain || ''; document.getElementById('hub-auth-mode').value = settings.authMode || 'hybrid'; document.getElementById('hub-tls-mode').value = settings.tlsMode || 'managed'; document.getElementById('hub-gateway-enabled').checked = settings.gatewayEnabled !== false;
  document.getElementById('hub-policy-auth').checked = settings.policies?.publicApiRequiresAuth !== false; document.getElementById('hub-policy-backup').checked = settings.policies?.backupBeforeDeploy !== false; document.getElementById('hub-policy-approval').checked = Boolean(settings.policies?.requireDeploymentApproval); document.getElementById('hub-policy-labs').value = settings.policies?.maxLabsPerUser ?? 20; document.getElementById('hub-policy-flows').value = settings.policies?.maxApiFlowsPerUser ?? 50;
  const localStatus = document.getElementById('hub-local-config-status');
  if (localStatus) { localStatus.textContent = settings.panelDomain ? (status.enabled ? 'Skonfigurowany · aktywny' : 'Skonfigurowany · wyłączony') : 'Wymaga domeny'; localStatus.classList.toggle('online', Boolean(settings.panelDomain && status.enabled)); localStatus.classList.toggle('warning', !settings.panelDomain); }
  const remoteSummary = document.getElementById('hub-remote-summary');
  if (remoteSummary) { const count = remotes.length; remoteSummary.textContent = count === 1 ? '1 połączenie' : count > 1 && count < 5 ? `${count} połączenia` : `${count} połączeń`; remoteSummary.classList.toggle('online', remotes.some(remote => remote.status === 'online')); }
  renderHubNodes(nodes); renderHubSync(); renderHubRoutes(routes); renderHubUsers(users); renderHubPlesk(connectors); renderHubRemotes(hubSnapshot.remotes); renderHubDeployments(deployments);
  document.getElementById('hub-overview-nodes').innerHTML = nodes.slice(0, 5).map(hubNodeRow).join('') || '<div class="hub-empty">Brak sparowanych węzłów</div>';
  document.getElementById('hub-overview-sync').innerHTML = objects.slice(0, 5).map(item => `<div class="hub-list-row"><i class="online"></i><div class="hub-list-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.kind)} · rewizja ${item.revision} · ${hubDate(item.updatedAt)}</span></div><span class="hub-badge">r${item.revision}</span></div>`).join('') || '<div class="hub-empty">Jeszcze nic nie zsynchronizowano</div>';
}

function hubNodeRow(node) { return `<div class="hub-list-row"><i class="${node.status === 'online' ? 'online' : ''}"></i><div class="hub-list-main"><strong>${escapeHtml(node.name)}</strong><span>${escapeHtml(node.kind)} · ${escapeHtml(node.version || 'bez wersji')} · ${hubDate(node.lastSeenAt)}</span></div><span class="hub-badge ${node.status === 'online' ? 'success' : 'warning'}">${escapeHtml(node.status)}</span></div>`; }
function hubDate(value) { if (!value) return 'nigdy'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }

function renderHubNodes(nodes = hubSnapshot.nodes) {
  const target = document.getElementById('hub-node-list'); if (!target) return;
  const pairing = hubPairing ? `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge warning">KOD PAROWANIA</span><h3 style="margin-top:8px">${escapeHtml(hubPairing.name)}</h3></div><button class="btn btn-small" data-hub-action="copy-pairing">Kopiuj</button></div><p>Wprowadź kod w desktopie/agencie albo wyślij POST do /auth/pair. Wygasa: ${hubDate(hubPairing.expiresAt)}</p><div class="hub-resource-meta"><strong style="font-size:16px;color:var(--text-primary)">${escapeHtml(hubPairing.code)}</strong></div></article>` : '';
  target.innerHTML = pairing + nodes.map(node => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge ${node.status === 'online' ? 'success' : 'warning'}">${escapeHtml(node.status)}</span><h3 style="margin-top:8px">${escapeHtml(node.name)}</h3><p>${escapeHtml(node.kind)} · ${escapeHtml(node.platform || 'platforma nieznana')}</p></div><button class="btn btn-small btn-danger" data-hub-action="revoke-node" data-id="${escapeHtml(node.id)}">Odłącz</button></div><div class="hub-resource-meta"><span>v${escapeHtml(node.version || '—')}</span><span>${node.capabilities?.length || 0} capabilities</span><span>${hubDate(node.lastSeenAt)}</span></div></article>`).join('') || (!pairing ? '<div class="hub-empty">Kliknij „Sparuj urządzenie”, aby połączyć desktop, serwer lub Pleska.</div>' : '');
}

function renderHubSync() {
  const target = document.getElementById('hub-sync-list'); if (!target) return; const filter = document.getElementById('hub-sync-filter')?.value || '';
  const objects = hubSnapshot.objects.filter(item => !filter || item.kind === filter);
  target.innerHTML = objects.map(item => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge">${escapeHtml(item.kind)}</span><h3 style="margin-top:8px">${escapeHtml(item.name)}</h3><p>${escapeHtml(item.id)} · źródło ${escapeHtml(item.sourceNodeId || 'local')}</p></div><span class="hub-badge success">r${item.revision}</span></div><div class="hub-resource-meta"><span>${hubDate(item.updatedAt)}</span><span>${escapeHtml((item.contentHash || '').slice(0, 10))}</span></div><div class="hub-resource-actions"><button class="btn btn-small" data-hub-action="apply-object" data-id="${escapeHtml(item.id)}">Zastosuj lokalnie</button><button class="btn btn-small" data-hub-action="history-object" data-id="${escapeHtml(item.id)}">Historia</button>${hubSnapshot.nodes.length ? `<button class="btn btn-small btn-primary" data-hub-action="deploy-object" data-id="${escapeHtml(item.id)}">Wdróż</button>` : ''}</div></article>`).join('') || '<div class="hub-empty">Brak obiektów. Kliknij „Publikuj lokalne”, aby dodać projekty, Test Laby i API Flow.</div>';
}

function renderHubRoutes(routes = hubSnapshot.routes) {
  const target = document.getElementById('hub-route-list'); if (!target) return;
  target.innerHTML = routes.map(route => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge ${route.enabled ? 'success' : 'warning'}">${route.enabled ? 'AKTYWNA' : 'WYŁĄCZONA'}</span><h3 style="margin-top:8px">${escapeHtml(route.hostname)}</h3><p>→ ${escapeHtml(route.target)}</p></div><button class="btn btn-small btn-danger" data-hub-action="remove-route" data-id="${escapeHtml(route.id)}">Usuń</button></div><div class="hub-resource-meta"><span>${escapeHtml(route.kind)}</span><span>auth: ${escapeHtml(route.authPolicy)}</span><span>${route.websocket ? 'WebSocket ✓' : 'HTTP'}</span></div></article>`).join('') || '<div class="hub-empty">Brak tras. Dodaj lokalną usługę i przypisz jej automatyczną subdomenę.</div>';
}

function renderHubUsers(users = hubSnapshot.users) {
  const target = document.getElementById('hub-user-list'); if (!target) return;
  target.innerHTML = users.map(user => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge ${user.active ? 'success' : 'danger'}">${user.active ? 'AKTYWNY' : 'ZABLOKOWANY'}</span><h3 style="margin-top:8px">${escapeHtml(user.displayName || user.username)}</h3><p>@${escapeHtml(user.username)}${user.email ? ` · ${escapeHtml(user.email)}` : ''}</p></div><button class="btn btn-small btn-danger" data-hub-action="remove-user" data-id="${escapeHtml(user.id)}">Usuń</button></div><div class="hub-resource-meta"><span>${user.roles.map(escapeHtml).join(', ')}</span><span>${user.memberships?.length || 0} zakresów</span><span>MFA ${user.mfaEnabled ? '✓' : '—'}</span></div><div class="hub-resource-actions"><button class="btn btn-small" data-hub-action="toggle-mfa" data-id="${escapeHtml(user.id)}" data-enabled="${user.mfaEnabled}">${user.mfaEnabled ? 'Wyłącz TOTP' : 'Włącz TOTP'}</button></div></article>`).join('') || '<div class="hub-empty">Brak kont</div>';
}

function renderHubPlesk(connectors = hubSnapshot.connectors) {
  const target = document.getElementById('hub-plesk-list'); if (!target) return;
  target.innerHTML = connectors.map(connector => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge ${connector.status === 'online' ? 'success' : ''}">${escapeHtml(connector.status)}</span><h3 style="margin-top:8px">${escapeHtml(connector.name)}</h3><p>${escapeHtml(connector.baseUrl)}</p><p>ID do konfiguracji rozszerzenia: <strong>${escapeHtml(connector.id)}</strong></p></div><button class="btn btn-small btn-danger" data-hub-action="remove-connector" data-id="${escapeHtml(connector.id)}">Usuń</button></div><div class="hub-resource-meta"><span>auth: ${escapeHtml(connector.authMode)}</span><span>SSO ${connector.configured ? '✓' : '—'}</span><span>${hubDate(connector.lastSeenAt)}</span></div><div class="hub-resource-actions"><button class="btn btn-small" data-hub-action="copy-connector-id" data-id="${escapeHtml(connector.id)}">Kopiuj ID</button></div></article>`).join('') || '<div class="hub-empty">Nie połączono żadnego panelu Plesk.</div>';
}

function renderHubRemotes(remotes = hubSnapshot.remotes) {
  const target = document.getElementById('hub-remote-list'); if (!target) return;
  target.innerHTML = remotes.map(remote => `<article class="hub-resource-card"><div class="hub-resource-top"><div><span class="hub-badge ${remote.status === 'online' ? 'success' : 'warning'}">${escapeHtml(remote.status)}</span><h3 style="margin-top:8px">${escapeHtml(remote.name)}</h3><p>${escapeHtml(remote.url)}</p></div><button class="btn btn-small btn-danger" data-hub-action="remove-remote" data-id="${escapeHtml(remote.id)}">Usuń</button></div><div class="hub-resource-meta"><span>token ${remote.configured ? '✓' : '—'}</span><span>pin certyfikatu ${remote.certificateFingerprint ? '✓' : '—'}</span><span>sprawdzono: ${hubDate(remote.lastCheckedAt)}</span></div><div class="hub-resource-actions"><button class="btn btn-small btn-primary" data-hub-action="push-remote" data-id="${escapeHtml(remote.id)}">Synchronizuj dwukierunkowo</button></div></article>`).join('') || '<div class="hub-empty"><div><strong>Nie połączono jeszcze żadnego zewnętrznego Huba.</strong><br>Użyj „Połącz z Hubem” i podaj adres oraz token utworzony na serwerze docelowym. Ustawienia lokalnego Huba nie zostaną zmienione.</div></div>';
}

function renderHubDeployments(items = hubSnapshot.deployments) {
  const target = document.getElementById('hub-deployments'); if (!target) return;
  target.innerHTML = items.slice(0, 20).map(item => `<div class="hub-table-row"><strong>${escapeHtml(item.objectId)}</strong><span>${escapeHtml(item.strategy)}</span><span>${hubDate(item.updatedAt)}</span><span class="hub-badge ${item.status === 'succeeded' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'}">${escapeHtml(item.status)}</span></div>`).join('') || '<div class="hub-empty">Brak wdrożeń</div>';
}

async function saveHubSettings() {
  try {
    await api.hub.configure({ panelDomain: document.getElementById('hub-panel-domain').value, authMode: document.getElementById('hub-auth-mode').value, tlsMode: document.getElementById('hub-tls-mode').value, gatewayEnabled: document.getElementById('hub-gateway-enabled').checked, enabled: document.getElementById('hub-enabled').checked, policies: { publicApiRequiresAuth: document.getElementById('hub-policy-auth').checked, backupBeforeDeploy: document.getElementById('hub-policy-backup').checked, requireDeploymentApproval: document.getElementById('hub-policy-approval').checked, maxLabsPerUser: Number(document.getElementById('hub-policy-labs').value), maxApiFlowsPerUser: Number(document.getElementById('hub-policy-flows').value) } });
    showToast('Ustawienia tego Huba zapisane', 'success'); await refreshHubPanel();
  } catch (error) { showToast(error.message, 'error'); }
}

async function publishHubLocal() { try { const result = await api.hub.publishLocal({ kinds: ['project', 'lab', 'api-flow'], nodeId: runtimeMode === 'desktop' ? 'desktop-local' : 'server-local' }); const conflicts = result.results?.filter(item => item.conflict).length || 0; showToast(conflicts ? `Synchronizacja zakończona: ${conflicts} konfliktów` : `Zsynchronizowano ${result.results?.length || 0} obiektów`, conflicts ? 'warning' : 'success'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); } }

async function saveHubRoute() { try { await api.hub.saveRoute({ name: document.getElementById('hub-route-name').value, kind: document.getElementById('hub-route-kind').value, target: document.getElementById('hub-route-target').value, authPolicy: document.getElementById('hub-route-auth').value }); document.getElementById('hub-route-form').classList.add('hidden'); showToast('Trasa gatewaya zapisana', 'success'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); } }
async function saveHubUser() { try { await api.identity.createUser({ username: document.getElementById('hub-user-name').value, displayName: document.getElementById('hub-user-display').value, email: document.getElementById('hub-user-email').value, password: document.getElementById('hub-user-password').value, roles: [document.getElementById('hub-user-role').value] }); document.getElementById('hub-user-form').classList.add('hidden'); showToast('Konto utworzone', 'success'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); } }
async function savePleskConnector() { try { const result = await api.hub.saveConnector({ baseUrl: document.getElementById('hub-plesk-url').value, name: document.getElementById('hub-plesk-name').value, authMode: document.getElementById('hub-plesk-auth').value }, document.getElementById('hub-plesk-secret').value); document.getElementById('hub-plesk-form').classList.add('hidden'); if (result.sharedSecret) await navigator.clipboard?.writeText(result.sharedSecret); showToast(result.sharedSecret ? 'Plesk dodany; sekret skopiowano do schowka' : 'Plesk zapisany', 'success'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); } }
async function saveHubRemote() { try { await api.hub.saveRemote({ url: document.getElementById('hub-remote-url').value, name: document.getElementById('hub-remote-name').value, certificateFingerprint: document.getElementById('hub-remote-fingerprint').value }, document.getElementById('hub-remote-token').value); document.getElementById('hub-remote-token').value = ''; document.getElementById('hub-remote-form').classList.add('hidden'); selectHubTab('connections'); showToast('Połączenie ze zdalnym Hubem zapisane', 'success'); await refreshHubPanel(); } catch (error) { showToast(error.message, 'error'); } }

async function handleHubAction(event) {
  const button = event.target.closest('[data-hub-action]'); if (!button) return; const id = button.dataset.id;
  try {
    if (button.dataset.hubAction === 'copy-pairing' && hubPairing) { await navigator.clipboard.writeText(hubPairing.code); showToast('Kod parowania skopiowany', 'success'); return; }
    if (button.dataset.hubAction === 'copy-connector-id') { await navigator.clipboard.writeText(id); showToast('ID konektora skopiowane', 'success'); return; }
    if (button.dataset.hubAction === 'revoke-node' && confirm('Odłączyć ten węzeł i unieważnić jego token?')) await api.hub.revokeNode(id);
    if (button.dataset.hubAction === 'remove-route' && confirm('Usunąć tę trasę?')) await api.hub.removeRoute(id);
    if (button.dataset.hubAction === 'remove-user' && confirm('Usunąć konto, sesje i tokeny użytkownika?')) await api.identity.removeUser(id);
    if (button.dataset.hubAction === 'remove-connector' && confirm('Odłączyć ten panel Plesk?')) await api.hub.removeConnector(id);
    if (button.dataset.hubAction === 'remove-remote' && confirm('Usunąć połączenie ze zdalnym Hubem?')) await api.hub.removeRemote(id);
    if (button.dataset.hubAction === 'push-remote') { const result = await api.hub.syncRemote(id, { kinds: ['project', 'lab', 'api-flow'], nodeId: 'desktop-local' }); showToast(result.conflicts ? `Synchronizacja zakończona: ${result.conflicts} konfliktów wymaga decyzji` : 'Synchronizacja dwukierunkowa zakończona', result.conflicts ? 'warning' : 'success'); }
    if (button.dataset.hubAction === 'apply-object') { await api.hub.applyObject(id, {}); showToast('Obiekt zastosowany lokalnie', 'success'); }
    if (button.dataset.hubAction === 'history-object') { const history = await api.hub.history(id); const revision = prompt(`Historia: ${history.map(item => `r${item.revision} · ${hubDate(item.updatedAt)}`).join('\n')}\n\nPodaj rewizję do rollbacku (Anuluj = bez zmian):`, ''); if (revision) { await api.hub.rollback(id, Number(revision)); showToast(`Przywrócono rewizję ${revision}`, 'success'); } }
    if (button.dataset.hubAction === 'deploy-object') { const node = hubSnapshot.nodes.find(item => item.status === 'online') || hubSnapshot.nodes[0]; if (!node) throw new Error('Najpierw sparuj węzeł docelowy'); const deployment = await api.hub.createDeployment({ objectId: id, targetNodeId: node.id, strategy: 'replace' }); showToast(`Wdrożenie ${deployment.status}: ${node.name}`, deployment.status === 'pending' ? 'warning' : 'success'); }
    if (button.dataset.hubAction === 'toggle-mfa') { if (button.dataset.enabled === 'true') { if (confirm('Wyłączyć TOTP dla tego konta?')) await api.identity.disableTotp(id); } else { const result = await api.identity.enableTotp(id); prompt('Zapisz sekret i kody odzyskiwania. Ten komunikat pojawi się tylko raz:', `${result.secret}\n\n${result.recoveryCodes.join('\n')}`); } }
    await refreshHubPanel();
  } catch (error) { showToast(error.message, 'error'); }
}

function initUpdatePanel() {
  document.getElementById('update-check')?.addEventListener('click', checkForKitsuneUpdate);
  document.getElementById('update-download')?.addEventListener('click', downloadKitsuneUpdate);
  document.getElementById('update-install')?.addEventListener('click', installKitsuneUpdate);
  refreshUpdateStatus();
}

function initSupportReport() {
  document.getElementById('support-generate')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true; button.classList.add('loading');
    try {
      const result = await api.support.generate();
      if (!result.success) throw new Error(result.error || 'Could not generate support report');
      downloadWorkspaceManifest(result.report, `${result.id}.json`);
      document.getElementById('support-report-status').textContent = `Saved ${result.path} · SHA-256 ${result.sha256}`;
      showToast('Redacted support report generated', 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; button.classList.remove('loading'); }
  });
}

let integrationItems = [];

function initIntegrations() {
  if (!api.integration) return;
  document.getElementById('integration-refresh')?.addEventListener('click', refreshIntegrations);
  document.getElementById('integration-search')?.addEventListener('input', renderIntegrations);
  document.getElementById('integration-category')?.addEventListener('change', renderIntegrations);
  document.getElementById('integration-modal-close')?.addEventListener('click', closeIntegrationEditor);
  document.getElementById('integration-modal-cancel')?.addEventListener('click', closeIntegrationEditor);
  document.getElementById('integration-modal-save')?.addEventListener('click', saveIntegrationEditor);
  document.getElementById('integration-modal-remove')?.addEventListener('click', removeIntegrationEditor);
  document.getElementById('integration-modal')?.addEventListener('click', event => {
    if (event.target.id === 'integration-modal') closeIntegrationEditor();
  });
  refreshIntegrations();
}

async function refreshIntegrations() {
  if (!api.integration) return;
  const container = document.getElementById('integration-grid');
  try {
    integrationItems = await api.integration.list();
    const category = document.getElementById('integration-category');
    const selected = category?.value || 'all';
    if (category) {
      const categories = [...new Set(integrationItems.map(item => item.category))].sort();
      category.innerHTML = '<option value="all">All categories</option>' + categories.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
      category.value = categories.includes(selected) ? selected : 'all';
    }
    renderIntegrations();
  } catch (error) {
    if (container) container.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`;
  }
}

function renderIntegrations() {
  const container = document.getElementById('integration-grid');
  if (!container) return;
  const query = (document.getElementById('integration-search')?.value || '').trim().toLowerCase();
  const category = document.getElementById('integration-category')?.value || 'all';
  const items = integrationItems.filter(item => (category === 'all' || item.category === category)
    && (!query || [item.name, item.category, item.description, item.id].join(' ').toLowerCase().includes(query)));
  if (!items.length) {
    container.innerHTML = '<div class="workspace-empty compact">No integrations match the selected filters.</div>';
    return;
  }
  container.innerHTML = items.map(item => {
    const test = item.config?.lastTest;
    const state = test?.success ? 'verified' : test ? 'failed' : item.configured ? 'pending' : '';
    const status = test?.success ? `Verified · ${new Date(test.testedAt).toLocaleDateString()}` : test ? 'Test failed' : item.configured ? 'Ready to test' : `${item.missing.length} setting(s) missing`;
    return `<article class="integration-card ${item.config?.enabled ? 'enabled' : ''}" data-integration-id="${escapeHtml(item.id)}">
      <div class="integration-card-head"><span class="integration-card-icon">${escapeHtml(item.icon)}</span><div class="integration-card-title"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.category)}</span></div></div>
      <p>${escapeHtml(item.description)}</p><span class="integration-status ${state}">${test?.success ? '✓' : test ? '✕' : item.configured ? '○' : '—'} ${escapeHtml(status)}</span>
      <div class="integration-card-actions"><button class="btn integration-configure">Configure</button><button class="btn btn-primary integration-test" ${item.configured ? '' : 'disabled'}>Test connection</button></div>
    </article>`;
  }).join('');
  container.querySelectorAll('[data-integration-id]').forEach(card => {
    const id = card.dataset.integrationId;
    card.querySelector('.integration-configure').addEventListener('click', () => openIntegrationEditor(id));
    card.querySelector('.integration-test').addEventListener('click', event => testIntegration(id, event.currentTarget));
  });
}

function openIntegrationEditor(id) {
  const item = integrationItems.find(integration => integration.id === id);
  if (!item) return;
  document.getElementById('integration-modal-id').value = id;
  document.getElementById('integration-modal-title').textContent = `${item.icon} ${item.name}`;
  document.getElementById('integration-modal-description').textContent = item.description;
  document.getElementById('integration-modal-enabled').checked = Boolean(item.config?.enabled);
  document.getElementById('integration-modal-remove').classList.toggle('hidden', !item.config?.updatedAt && !Object.values(item.secrets || {}).some(Boolean));
  const fields = document.getElementById('integration-modal-fields');
  fields.innerHTML = item.fields.map(field => {
    const configured = field.secret && item.secrets?.[field.id];
    const value = field.secret ? '' : (item.config?.[field.id] ?? field.default ?? '');
    return `<div class="form-group ${String(value).length > 70 ? 'full-width' : ''}"><label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label><input type="${field.secret ? 'password' : 'text'}" data-integration-field="${escapeHtml(field.id)}" data-secret="${field.secret ? '1' : '0'}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.secret && configured ? 'Stored securely — leave blank to keep' : field.placeholder || '')}" autocomplete="off">${field.secret ? `<label class="integration-secret-state ${configured ? 'configured' : ''}"><input type="checkbox" data-remove-integration-secret="${escapeHtml(field.id)}" ${configured ? '' : 'disabled'}> ${configured ? 'Secret stored securely · check to remove' : 'No secret stored'}</label>` : ''}</div>`;
  }).join('');
  document.getElementById('integration-modal').classList.remove('hidden');
}

function closeIntegrationEditor() {
  document.getElementById('integration-modal')?.classList.add('hidden');
}

async function saveIntegrationEditor() {
  const id = document.getElementById('integration-modal-id').value;
  const configInput = { enabled: document.getElementById('integration-modal-enabled').checked };
  const secrets = {};
  document.querySelectorAll('#integration-modal-fields [data-integration-field]').forEach(input => {
    if (input.dataset.secret === '1') {
      const remove = document.querySelector(`#integration-modal-fields [data-remove-integration-secret="${CSS.escape(input.dataset.integrationField)}"]`)?.checked;
      if (remove) secrets[input.dataset.integrationField] = null;
      else if (input.value) secrets[input.dataset.integrationField] = input.value;
    } else configInput[input.dataset.integrationField] = input.value;
  });
  const button = document.getElementById('integration-modal-save');
  button.disabled = true; button.classList.add('loading');
  try {
    const result = await api.integration.save(id, configInput, secrets);
    if (!result.success) throw new Error(result.error);
    closeIntegrationEditor();
    await refreshIntegrations();
    showToast('Integration configuration saved', 'success');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function removeIntegrationEditor() {
  const id = document.getElementById('integration-modal-id').value;
  const item = integrationItems.find(integration => integration.id === id);
  if (!item || !confirm(`Remove ${item.name} configuration and stored credentials?`)) return;
  const result = await api.integration.remove(id);
  if (!result.success) return showToast(result.error, 'error');
  closeIntegrationEditor();
  await refreshIntegrations();
  showToast('Integration configuration removed', 'success');
}

async function testIntegration(id, button) {
  button.disabled = true; button.classList.add('loading');
  try {
    const result = await api.integration.test(id);
    showToast(result.success ? result.message || 'Integration verified' : result.error, result.success ? 'success' : 'error');
    await refreshIntegrations();
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.classList.remove('loading'); }
}

async function refreshUpdateStatus() {
  if (!api.update) return;
  const status = await api.update.status();
  const container = document.getElementById('update-status');
  if (!container) return;
  container.innerHTML = `<div class="update-summary"><span>${status.configured ? '🔏' : '○'}</span><div><strong>KitsuneServ ${escapeHtml(status.currentVersion)}</strong><span>${status.configured ? `Signed channel: ${escapeHtml(status.manifestUrl)}` : 'No signed release channel configured'}${status.downloaded ? ` · verified ${escapeHtml(status.downloaded.version)} downloaded` : ''}</span></div></div>`;
  document.getElementById('update-install')?.classList.toggle('hidden', !status.downloaded);
}

async function checkForKitsuneUpdate() {
  const button = document.getElementById('update-check');
  button.disabled = true; button.classList.add('loading');
  try {
    const result = await api.update.check();
    if (!result.success) throw new Error(result.error);
    const container = document.getElementById('update-status');
    container.innerHTML = `<div class="update-summary"><span>${result.available ? '⬆' : '✓'}</span><div><strong>${result.available ? `KitsuneServ ${escapeHtml(result.manifest.version)} is available` : 'KitsuneServ is up to date'}</strong><span>${escapeHtml(result.manifest.notes || `Current version: ${result.currentVersion}`)}</span></div></div>`;
    document.getElementById('update-download').classList.toggle('hidden', !result.available);
    showToast(result.available ? 'A signed update is available' : 'You already have the latest signed release', 'success');
  } catch (error) { showToast(error.message, 'error'); await refreshUpdateStatus(); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function downloadKitsuneUpdate() {
  const button = document.getElementById('update-download');
  button.disabled = true; button.classList.add('loading');
  try {
    const result = await api.update.download();
    if (!result.success) throw new Error(result.error);
    showToast(`Verified KitsuneServ ${result.version} downloaded`, 'success');
    button.classList.add('hidden'); await refreshUpdateStatus();
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function installKitsuneUpdate() {
  if (!confirm('Install the verified update now? KitsuneServ will stop every managed service before closing.')) return;
  const result = await api.update.install();
  if (!result.success) showToast(result.error, result.manual ? 'success' : 'error');
}

async function refreshSecurityPanel() {
  if (!api.security) return;
  const grid = document.getElementById('security-status-grid');
  const list = document.getElementById('security-session-list');
  const auditList = document.getElementById('security-audit-list');
  const auditStatus = document.getElementById('security-audit-status');
  try {
    const [status, sessions, audit, verification] = await Promise.all([
      api.security.status(), api.security.sessions(), api.security.audit({ limit: 100 }), api.security.verifyAudit()
    ]);
    const items = [
      ['HTTPS', status.https, status.https ? 'enabled' : status.mode === 'desktop' ? 'desktop IPC' : 'HTTP only'],
      ['TOTP / 2FA', status.totpEnabled, status.totpEnabled ? 'required' : 'disabled'],
      ['API token', status.apiTokenEnabled, status.apiTokenEnabled ? 'configured' : 'disabled'],
      ['IP allowlist', status.allowlistEnabled, status.allowlistEnabled ? `${status.allowedRules.length} rule(s)` : 'all clients']
    ];
    grid.innerHTML = items.map(([label, enabled, detail]) => `<div class="security-status-item ${enabled ? 'enabled' : ''}"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></div>`).join('');
    document.getElementById('security-revoke-others').disabled = status.mode !== 'server' || sessions.length < 2;
    if (!sessions.length) {
      list.innerHTML = `<div class="workspace-empty compact">${status.mode === 'desktop' ? 'Web sessions exist only in server mode.' : 'No active sessions.'}</div>`;
    } else {
      list.innerHTML = sessions.map(session => `<div class="security-session-row"><span>${session.current ? '●' : '○'}</span><div class="security-session-info"><strong>${escapeHtml(session.username)}${session.current ? ' · current' : ''}</strong><span>${escapeHtml(session.address || 'unknown')} · last seen ${escapeHtml(new Date(session.lastSeenAt).toLocaleString())} · ${escapeHtml((session.userAgent || '').slice(0, 100))}</span></div>${session.current ? '' : `<button class="btn btn-small btn-danger security-revoke" data-id="${escapeHtml(session.id)}">Revoke</button>`}</div>`).join('');
      list.querySelectorAll('.security-revoke').forEach(button => button.addEventListener('click', async () => {
        const result = await api.security.revokeSession(button.dataset.id);
        showToast(result.success ? 'Session revoked' : result.error, result.success ? 'success' : 'error');
        await refreshSecurityPanel();
      }));
    }
    auditStatus.textContent = verification.valid
      ? `Verified · ${verification.entries} entries · head ${verification.headHash ? verification.headHash.slice(0, 12) : 'empty'}`
      : `Invalid chain · sequence ${verification.firstInvalidSequence}`;
    auditStatus.className = verification.valid ? 'verified' : 'invalid';
    auditList.innerHTML = audit.length ? audit.map(entry => `<div class="security-audit-row ${entry.success ? 'success' : 'failed'}"><span class="security-audit-result">${entry.success ? '✓' : '!'}</span><div class="security-session-info"><strong>${escapeHtml(entry.action)}${entry.target ? ` · ${escapeHtml(entry.target)}` : ''}</strong><span>#${entry.sequence} · ${escapeHtml(entry.actor)} via ${escapeHtml(entry.source)} · ${escapeHtml(new Date(entry.at).toLocaleString())} · ${entry.durationMs} ms</span></div><code>${escapeHtml(entry.hash.slice(0, 10))}</code></div>`).join('') : '<div class="workspace-empty compact">No audited operations yet.</div>';
  } catch (error) {
    grid.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`;
    list.innerHTML = '';
    auditList.innerHTML = '';
    auditStatus.textContent = 'Audit unavailable';
  }
}

function syncDocumentRootControls() {
  const general = config.general || {};
  const forced = Boolean(general.forceGlobalDocumentRoot);
  const globalToggle = document.getElementById('general-forceGlobalDocumentRoot');
  const globalInput = document.getElementById('general-globalDocumentRoot');
  const help = document.getElementById('global-docroot-help');
  if (globalToggle) globalToggle.checked = forced;
  if (globalInput) globalInput.value = general.globalDocumentRoot || './www';
  if (help) help.textContent = forced
    ? 'Enforced for Apache, Nginx and Caddy. Their individual directory selectors are locked.'
    : 'Saved as the shared directory but not enforced. Each web server uses its profile directory.';
  for (const section of ['apache', 'nginx', 'caddy']) {
    const input = document.getElementById(`${section}-documentRoot`);
    const button = document.getElementById(`btn-open-${section}-docroot`);
    if (input) {
      input.disabled = forced;
      input.title = forced ? 'The global document root is enforced in General settings' : '';
    }
    if (button) {
      button.disabled = forced;
      button.title = forced ? 'Disable the global document root in General settings to change this profile' : 'Choose Document Root';
    }
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/* ===== Collect from UI ===== */
function collectAllFromUI() {
  for (const section of SERVICE_SECTIONS) {
    const profile = getActiveProfile(section);
    if (!profile) continue;

    const panel = document.getElementById('panel-' + section);
    if (!panel) continue;

    panel.querySelectorAll('[data-pkey]').forEach(el => {
      const key = el.dataset.pkey;
      let value;
      if (el.type === 'checkbox') {
        value = el.checked;
      } else if (el.type === 'number') {
        value = el.value === '' ? 0 : Number(el.value);
      } else {
        value = el.value;
      }
      setNestedValue(profile, key, value);
    });



    // PHP extensions – stored on the profile object directly
    if (section === 'php') {
      const grid = document.getElementById('php-extensions-grid');
      if (grid) {
        const items = grid.querySelectorAll('.extension-item');
        // Merge toggled states into profile.extensions (keep untouched ones)
        const toggled = {};
        for (const item of items) {
          const name = item.dataset.name;
          const enabled = item.querySelector('input[type=checkbox]').checked;
          toggled[name] = enabled;
        }
        // Update existing + keep any not shown (filtered out)
        if (!profile.extensions) profile.extensions = [];
        for (const ext of profile.extensions) {
          if (ext.name in toggled) ext.enabled = toggled[ext.name];
        }
        // Add newly toggled ones not yet in profile
        for (const [name, enabled] of Object.entries(toggled)) {
          if (!profile.extensions.some(e => e.name === name)) {
            profile.extensions.push({ name, enabled });
          }
        }
      }
    }

    // Env vars
    if (['node', 'go', 'bun', 'python', 'deno'].includes(section)) {
      profile.envVars = collectEnvVars(section);
      // Collect selected project
      const projSel = document.getElementById(section + '-project');
      if (projSel) profile.project = projSel.value || '';
    }

    // Update profile name only if it still matches the auto-generated pattern
    const autoName = `${sectionLabel(section)} ${profile.version}`;
    const oldAutoPattern = new RegExp(`^${sectionLabel(section).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\S+$`);
    if (!profile.name || oldAutoPattern.test(profile.name)) {
      profile.name = autoName;
    }
  }

  // General settings
  const general = config.general || {};
  document.querySelectorAll('[data-section="general"]').forEach(el => {
    const key = el.dataset.key;
    if (el.type === 'checkbox') {
      general[key] = el.checked;
    } else {
      general[key] = el.value;
    }
  });
  config.general = general;
}

function collectEnvVars(section) {
  const container = document.getElementById(section + '-envVars-container');
  if (!container) return [];
  const rows = container.querySelectorAll('.env-var-row');
  const result = [];
  rows.forEach(row => {
    const key = row.querySelector('.env-key')?.value?.trim();
    const value = row.querySelector('.env-value')?.value ?? '';
    if (key) result.push({ key, value });
  });
  return result;
}

/* ===== Dashboard ===== */
let dashboardBuilt = false;
let dashboardProjectsLoaded = false;
let dashboardProjectsLoading = null;
let dashboardProjectsError = '';

function refreshDashboard() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  // First call: build cards with event listeners. Subsequent calls: patch in-place.
  if (!dashboardBuilt) {
    grid.innerHTML = '';
    for (const section of SERVICE_SECTIONS) {
      const card = _buildDashboardCard(section);
      if (card) grid.appendChild(card);
    }
    dashboardBuilt = true;
  } else {
    _patchDashboardCards();
  }
  applyDashboardFilter();
  if (!dashboardProjectsLoaded && !dashboardProjectsLoading) void refreshDashboardProjects();
}

function applyDashboardFilter() {
  const query = (document.getElementById('dash-search')?.value || '').toLowerCase().trim();
  const grid = document.getElementById('dashboard-grid');
  grid?.querySelectorAll('.dashboard-card').forEach(card => {
    const section = card.dataset.section || '';
    const label = sectionLabel(section).toLowerCase();
    card.style.display = (!query || label.includes(query) || section.includes(query)) ? '' : 'none';
  });
  renderDashboardProjects();
}

async function refreshDashboardProjects(force = false) {
  if (!api.workspace) return;
  if (dashboardProjectsLoading) return dashboardProjectsLoading;
  if (dashboardProjectsLoaded && !force) {
    renderDashboardProjects();
    return;
  }
  dashboardProjectsLoading = (async () => {
    try {
      const projects = await api.workspace.list();
      workspaceState.projects = Array.isArray(projects) ? projects : [];
      dashboardProjectsLoaded = true;
      dashboardProjectsError = '';
    } catch (error) {
      dashboardProjectsError = error.message || 'Could not load projects';
    } finally {
      dashboardProjectsLoading = null;
      renderDashboardProjects();
    }
  })();
  return dashboardProjectsLoading;
}

function renderDashboardProjects() {
  const container = document.getElementById('dashboard-project-grid');
  const summary = document.getElementById('dash-projects-summary');
  if (!container || !summary) return;

  if (!dashboardProjectsLoaded) {
    summary.textContent = dashboardProjectsError ? 'Unavailable' : 'Loading…';
    summary.classList.remove('has-running');
    container.innerHTML = `<div class="dashboard-project-empty">${dashboardProjectsError ? escapeHtml(dashboardProjectsError) : 'Loading projects…'}</div>`;
    return;
  }

  const projects = workspaceState.projects || [];
  const runningCount = projects.filter(project => project.state?.status === 'running').length;
  summary.textContent = `${runningCount}/${projects.length} running`;
  summary.classList.toggle('has-running', runningCount > 0);
  const query = (document.getElementById('dash-search')?.value || '').trim().toLowerCase();
  const visibleProjects = projects.filter(project => !query || [project.name, project.domain, project.root, project.templateId, ...(project.services || [])].join(' ').toLowerCase().includes(query));

  if (!visibleProjects.length) {
    container.innerHTML = `<div class="dashboard-project-empty">${projects.length ? 'No projects match the current filter.' : 'No projects yet. Open Project Manager to create your first environment.'}</div>`;
    return;
  }

  container.innerHTML = visibleProjects.map(project => {
    const state = project.state?.status || 'stopped';
    const busy = ['starting', 'stopping'].includes(state);
    const services = (project.services || []).slice(0, 5);
    const remainingServices = Math.max(0, (project.services || []).length - services.length);
    return `<article class="dashboard-project-card ${escapeHtml(state)}" data-dashboard-project="${escapeHtml(project.id)}">
      <div class="dashboard-project-head">
        <span class="dashboard-project-icon">${escapeHtml(project.icon || '📁')}</span>
        <div class="dashboard-project-title"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.templateId || 'custom')}</span></div>
        <span class="dashboard-project-state ${escapeHtml(state)}">${escapeHtml(state)}</span>
      </div>
      <div class="dashboard-project-domain" title="${escapeHtml(project.domain)}">${project.https ? '🔒' : '🌐'} ${escapeHtml(project.domain || 'No local domain')}</div>
      <div class="dashboard-project-services">${services.map(service => `<span class="dashboard-project-chip">${SECTION_ICONS[service] || '⚙️'} ${escapeHtml(sectionLabel(service))}</span>`).join('') || '<span class="dashboard-project-chip">No managed services</span>'}${remainingServices ? `<span class="dashboard-project-chip">+${remainingServices}</span>` : ''}</div>
      <div class="dashboard-project-path" title="${escapeHtml(project.root)}">${escapeHtml(project.root)}</div>
      ${['failed', 'interrupted'].includes(state) && project.state?.error ? `<div class="dashboard-project-error" title="${escapeHtml(project.state.error)}">${escapeHtml(project.state.error)}</div>` : ''}
      <div class="dashboard-project-actions">
        ${state === 'running'
          ? `<button class="card-btn card-btn-stop dashboard-project-stop" type="button"${busy ? ' disabled' : ''}>⏹ Stop</button>`
          : `<button class="card-btn card-btn-start dashboard-project-start" type="button"${busy ? ' disabled' : ''}>▶ Start</button>`}
        <button class="card-btn card-btn-open dashboard-project-open-url" type="button"${state !== 'running' ? ' disabled' : ''} title="Open project in browser">🌐 Open</button>
        <button class="card-btn dashboard-project-action-neutral dashboard-project-open-dir" type="button" title="Open project folder">📂 Folder</button>
      </div>
    </article>`;
  }).join('');
  container.querySelectorAll('[data-dashboard-project]').forEach(bindDashboardProjectCard);
}

function bindDashboardProjectCard(card) {
  const id = card.dataset.dashboardProject;
  const project = workspaceState.projects.find(item => item.id === id);
  if (!project) return;
  const run = async (button, action, successMessage) => {
    button.disabled = true;
    button.classList.add('loading');
    try {
      const result = await action();
      if (result?.success === false) showToast(result.error || 'Operation failed', 'error');
      else showToast(`${project.name}: ${successMessage}`, 'success');
      return result;
    } catch (error) {
      showToast(error.message, 'error');
      return null;
    } finally {
      button.classList.remove('loading');
      await refreshDashboardProjects(true);
      await refreshStatuses();
    }
  };
  card.querySelector('.dashboard-project-start')?.addEventListener('click', event => run(event.currentTarget, async () => {
    const result = await api.workspace.start(id);
    if (result.success && project.autoOpen && result.url) await api.shell.openExternal(result.url);
    return result;
  }, 'started'));
  card.querySelector('.dashboard-project-stop')?.addEventListener('click', event => run(event.currentTarget, () => api.workspace.stop(id), 'stopped'));
  card.querySelector('.dashboard-project-open-url')?.addEventListener('click', async () => {
    try {
      const result = await api.workspace.url(id);
      if (result.url) await api.shell.openExternal(result.url);
      else showToast(result.error || 'Project URL is unavailable', 'error');
    } catch (error) { showToast(error.message, 'error'); }
  });
  card.querySelector('.dashboard-project-open-dir')?.addEventListener('click', async () => {
    try {
      const result = await api.workspace.open(id);
      if (result.webMode && result.path && navigator.clipboard) {
        try { await navigator.clipboard.writeText(result.path); showToast('Server path copied to clipboard', 'success'); } catch {}
      } else if (!result.success) showToast(result.error, 'error');
    } catch (error) { showToast(error.message, 'error'); }
  });
}

function _buildDashboardCard(section) {
  const svc = config[section];
  if (!svc) return null;
  const profile = getActiveProfile(section);
  const running = statuses[section]?.running || false;
  const uptime = statuses[section]?.uptime || 0;
  const statusClass = running ? 'running' : 'stopped';
  const statusText = running ? 'Running' : 'Stopped';
  const version = profile?.version || '-';
  const isAutoManaged = AUTO_MANAGED_SECTIONS.includes(section);
  const isRuntime = ['node', 'go', 'bun', 'python', 'deno'].includes(section);
  const projectName = isRuntime && profile?.project ? profile.project : '';
  const WEB_SECTIONS = ['apache', 'nginx', 'caddy', 'node', 'go', 'bun', 'python', 'deno', 'minio'];
  const hasWebPort = WEB_SECTIONS.includes(section) && profile?.port;

  const card = document.createElement('div');
  card.className = `dashboard-card ${statusClass}`;
  card.dataset.section = section;
  card.dataset.panel = section;
  card.innerHTML = `
    <div class="card-header">
      <span class="card-icon">${SECTION_ICONS[section] || ''}</span>
      <span class="card-title">${escapeHtml(sectionLabel(section))}</span>
      <span class="card-profile-name">${escapeHtml(profile?.name || '-')}</span>
    </div>
    <div class="card-details">
      <div class="card-detail"><span class="card-detail-label">Version</span><span class="card-detail-value" data-field="version">${escapeHtml(version)}</span></div>
      <div class="card-detail"><span class="card-detail-label">Port</span><span class="card-detail-value" data-field="port">${profile?.port ?? '-'}</span></div>
      <div class="card-detail card-detail-project" ${!projectName ? 'style="display:none"' : ''}><span class="card-detail-label">Project</span><span class="card-detail-value" data-field="project">${escapeHtml(projectName)}</span></div>
      <div class="card-detail card-detail-uptime" ${!running ? 'style="display:none"' : ''}><span class="card-detail-label">Uptime</span><span class="card-detail-value card-uptime" data-started="${statuses[section]?.uptime ? Date.now() - statuses[section].uptime : 0}">${formatUptime(uptime)}</span></div>
      <div class="card-detail card-detail-memory" ${!(running && resourceUsage[section]) ? 'style="display:none"' : ''}><span class="card-detail-label">Memory</span><span class="card-detail-value" data-field="memory">${running && resourceUsage[section] ? resourceUsage[section].memoryMB + ' MB' : ''}</span></div>
      <div class="card-detail card-detail-env" ${!profile?.env ? 'style="display:none"' : ''}><span class="card-detail-label">Env</span><span class="card-detail-value card-env-${profile?.env === 'production' ? 'prod' : 'dev'}" data-field="env">${escapeHtml(profile?.env || '')}</span></div>
    </div>
    <div class="card-footer">
      <div class="card-status status-${statusClass}"><span class="status-dot"></span><span data-field="statusText">${statusText}</span>${isAutoManaged && !running ? ' <span class="auto-badge">auto</span>' : ''}${running ? ` <span class="health-badge unknown" data-health="${section}">⏳</span>` : ''}</div>
      ${isAutoManaged ? '' : `<div class="card-actions">
        ${hasWebPort ? `<button class="card-btn card-btn-open ${!running ? 'hidden' : ''}" data-section="${section}" title="Open in browser">🌐</button>
        <button class="card-btn card-btn-copy ${!running ? 'hidden' : ''}" data-section="${section}" title="Copy URL">📋</button>` : ''}
        <button class="card-btn card-btn-start ${running ? 'hidden' : ''}" data-section="${section}" title="Start">▶ Start</button>
        <button class="card-btn card-btn-stop ${!running ? 'hidden' : ''}" data-section="${section}" title="Stop">⏹ Stop</button>
        <button class="card-btn card-btn-restart ${!running ? 'hidden' : ''}" data-section="${section}" title="Restart">🔄 Restart</button>
      </div>`}
    </div>
  `;

  if (!isAutoManaged) {
    const startBtnEl = card.querySelector('.card-btn-start');
    // Disable start if service binaries are not installed yet
    const dlKey = resolveDownloadKey(profile, section);
    const isInstalled = installedMap[section] || false;
    if (!isInstalled && !running) {
      startBtnEl.disabled = true;
      startBtnEl.classList.add('card-btn-disabled');
      startBtnEl.title = `${sectionLabel(section)} ${profile?.version || ''} is not installed`;
    }
    startBtnEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await api.service.start(section);
      if (!result.success) {
        if (result.needsDownload) {
          const p = getActiveProfile(section);
          showToast(`${sectionLabel(section)} ${p?.version || ''} is not installed. Install it in Version Manager.`, 'error');
          openVersionManager(section);
        } else showToast(result.error, 'error');
      }
      refreshStatuses();
    });
    card.querySelector('.card-btn-stop').addEventListener('click', async (e) => {
      e.stopPropagation();
      const result = await api.service.stop(section);
      if (!result.success) showToast(result.error, 'error');
      refreshStatuses();
    });
    card.querySelector('.card-btn-restart').addEventListener('click', async (e) => {
      e.stopPropagation();
      showToast(`Restarting ${sectionLabel(section)}...`, 'success');
      const result = await api.service.restart(section);
      if (!result.success) showToast(result.error, 'error');
      else showToast(`${sectionLabel(section)} restarted`, 'success');
      refreshStatuses();
    });
    // Open in browser / Copy URL buttons
    const openBtn = card.querySelector('.card-btn-open');
    const copyBtn = card.querySelector('.card-btn-copy');
    if (openBtn) openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (WEB_SERVER_SECTIONS.includes(section)) void openWebService(section);
      else {
        const p = getActiveProfile(section);
        const url = section === 'minio' ? `http://localhost:${p?.consolePort || 9001}` : `http://localhost:${p?.port || 80}`;
        void api.shell.openExternal(url);
      }
    });
    if (copyBtn) copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = getActiveProfile(section);
      const url = WEB_SERVER_SECTIONS.includes(section)
        ? webServiceUrl(section, p)
        : (section === 'minio' ? `http://localhost:${p?.consolePort || 9001}` : `http://localhost:${p?.port || 80}`);
      navigator.clipboard.writeText(url);
      showToast(`URL copied: ${url}`, 'success');
    });
  }

  card.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-panel="${section}"]`);
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + section)?.classList.add('active');
  });

  return card;
}

function _patchDashboardCards() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;

  for (const section of SERVICE_SECTIONS) {
    const card = grid.querySelector(`[data-section="${section}"]`);
    if (!card) continue;

    const profile = getActiveProfile(section);
    const running = statuses[section]?.running || false;
    const uptime = statuses[section]?.uptime || 0;
    const statusClass = running ? 'running' : 'stopped';
    const isAutoManaged = AUTO_MANAGED_SECTIONS.includes(section);
    const isRuntime = ['node', 'go', 'bun', 'python', 'deno'].includes(section);
    const projectName = isRuntime && profile?.project ? profile.project : '';

    // Update card class
    card.className = `dashboard-card ${statusClass}`;

    // Patch profile name
    const profileNameEl = card.querySelector('.card-profile-name');
    if (profileNameEl) profileNameEl.textContent = profile?.name || '-';

    // Patch version & port
    const versionEl = card.querySelector('[data-field="version"]');
    if (versionEl) versionEl.textContent = profile?.version || '-';
    const portEl = card.querySelector('[data-field="port"]');
    if (portEl) portEl.textContent = profile?.port ?? '-';

    // Patch project
    const projectRow = card.querySelector('.card-detail-project');
    if (projectRow) {
      projectRow.style.display = projectName ? '' : 'none';
      const projectVal = card.querySelector('[data-field="project"]');
      if (projectVal) projectVal.textContent = projectName;
    }

    // Patch uptime
    const uptimeRow = card.querySelector('.card-detail-uptime');
    if (uptimeRow) {
      uptimeRow.style.display = running ? '' : 'none';
      const uptimeEl = uptimeRow.querySelector('.card-uptime');
      if (uptimeEl) {
        uptimeEl.dataset.started = statuses[section]?.uptime ? String(Date.now() - statuses[section].uptime) : '0';
        uptimeEl.textContent = formatUptime(uptime);
      }
    }

    // Patch memory
    const memRow = card.querySelector('.card-detail-memory');
    if (memRow) {
      const hasMem = running && resourceUsage[section];
      memRow.style.display = hasMem ? '' : 'none';
      const memVal = card.querySelector('[data-field="memory"]');
      if (memVal && hasMem) memVal.textContent = resourceUsage[section].memoryMB + ' MB';
    }

    // Patch status text & health badge
    const statusDiv = card.querySelector('.card-status');
    if (statusDiv) {
      statusDiv.className = `card-status status-${statusClass}`;
      const statusTextEl = statusDiv.querySelector('[data-field="statusText"]');
      if (statusTextEl) statusTextEl.textContent = running ? 'Running' : 'Stopped';

      // Manage health badge
      let healthBadge = statusDiv.querySelector('[data-health]');
      if (running && !healthBadge) {
        healthBadge = document.createElement('span');
        healthBadge.className = 'health-badge unknown';
        healthBadge.dataset.health = section;
        healthBadge.textContent = '⏳';
        statusDiv.appendChild(document.createTextNode(' '));
        statusDiv.appendChild(healthBadge);
      } else if (!running && healthBadge) {
        healthBadge.remove();
      }

      // Manage auto badge
      let autoBadge = statusDiv.querySelector('.auto-badge');
      if (isAutoManaged && !running && !autoBadge) {
        autoBadge = document.createElement('span');
        autoBadge.className = 'auto-badge';
        autoBadge.textContent = 'auto';
        statusDiv.appendChild(document.createTextNode(' '));
        statusDiv.appendChild(autoBadge);
      } else if ((!isAutoManaged || running) && autoBadge) {
        autoBadge.remove();
      }
    }

    // Patch action buttons visibility
    if (!isAutoManaged) {
      const startBtn = card.querySelector('.card-btn-start');
      const stopBtn = card.querySelector('.card-btn-stop');
      const restartBtn = card.querySelector('.card-btn-restart');
      if (startBtn) startBtn.classList.toggle('hidden', running);
      if (stopBtn) stopBtn.classList.toggle('hidden', !running);
      if (restartBtn) restartBtn.classList.toggle('hidden', !running);

      // Disable start if service binaries not installed
      const installed = installedMap[section] || false;
      if (startBtn && !installed && !running) {
        startBtn.disabled = true;
        startBtn.classList.add('card-btn-disabled');
        startBtn.title = `${sectionLabel(section)} ${profile?.version || ''} is not installed`;
      } else if (startBtn) {
        startBtn.disabled = false;
        startBtn.classList.remove('card-btn-disabled');
        startBtn.title = 'Start';
      }
      // Open / Copy URL button visibility
      const openBtn = card.querySelector('.card-btn-open');
      const copyBtn = card.querySelector('.card-btn-copy');
      if (openBtn) openBtn.classList.toggle('hidden', !running);
      if (copyBtn) copyBtn.classList.toggle('hidden', !running);
    }
  }
}

function sectionLabel(section) {
  const labels = { apache: 'Apache', nginx: 'Nginx', caddy: 'Caddy', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongodb: 'MongoDB', php: 'PHP', node: 'Node.js', go: 'Go', bun: 'Bun', redis: 'Redis', memcached: 'Memcached', minio: 'MinIO', python: 'Python', deno: 'Deno', composer: 'Composer', java: 'Eclipse Temurin JDK' };
  return labels[section] || section;
}

/* ===== Status Polling ===== */
function startStatusPolling() {
  refreshStatuses();
  statusInterval = setInterval(refreshStatuses, 3000);

  // Live uptime counter — update every second without full refresh
  setInterval(() => {
    document.querySelectorAll('.card-uptime').forEach(el => {
      const started = parseInt(el.dataset.started);
      if (!started) return;
      el.textContent = formatUptime(Date.now() - started);
    });
    // Sidebar uptime counters
    for (const section of SERVICE_SECTIONS) {
      if (!serviceUptime[section]) continue;
      const navItem = document.querySelector(`.nav-item[data-panel="${section}"]`);
      const uptimeEl = navItem?.querySelector('.nav-uptime');
      if (uptimeEl) uptimeEl.textContent = formatUptime(Date.now() - serviceUptime[section]);
    }
  }, 1000);

  // Health checks — run every 10 seconds for all running services (in parallel)
  setInterval(async () => {
    const healthSections = ['apache', 'nginx', 'caddy', 'node', 'bun', 'go', 'python', 'deno', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'minio', 'php'];
    const running = healthSections.filter(s => statuses[s]?.running);
    if (!running.length) return;
    await Promise.allSettled(running.map(async (section) => {
      try {
        const result = await api.service.healthCheck(section);
        const badge = document.querySelector(`[data-health="${section}"]`);
        if (badge) {
          if (result.healthy) {
            badge.className = 'health-badge healthy';
            badge.textContent = `✓ ${result.responseTime || 0}ms`;
          } else {
            badge.className = 'health-badge unhealthy';
            badge.textContent = '✗ down';
          }
        }
      } catch {}
    }));
  }, 10000);

  // Disk usage — refresh every 30 seconds
  const fetchDiskUsage = async () => {
    try { diskUsageMap = await api.download.diskUsage(); } catch { diskUsageMap = {}; }
    _patchDiskUsageBadges();
  };
  fetchDiskUsage();
  setInterval(fetchDiskUsage, 30000);
}

function _patchDiskUsageBadges() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  for (const section of SERVICE_SECTIONS) {
    const card = grid.querySelector(`[data-section="${section}"]`);
    if (!card) continue;
    let diskRow = card.querySelector('.card-detail-disk');
    const mb = diskUsageMap[section] || 0;
    if (!diskRow) {
      diskRow = document.createElement('div');
      diskRow.className = 'card-detail card-detail-disk';
      diskRow.innerHTML = '<span class="card-detail-label">Disk</span><span class="card-detail-value" data-field="disk"></span>';
      card.querySelector('.card-details')?.appendChild(diskRow);
    }
    const diskVal = diskRow.querySelector('[data-field="disk"]');
    if (diskVal) diskVal.textContent = mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';
    diskRow.style.display = mb > 0 ? '' : 'none';
  }
}

async function refreshStatuses() {
  try {
    statuses = await api.service.allStatuses();
  } catch { statuses = {}; }
  try {
    resourceUsage = await api.service.resourceUsage();
  } catch { resourceUsage = {}; }

  // Check install status for all sections in parallel
  const installChecks = {};
  await Promise.all(SERVICE_SECTIONS.map(async section => {
    const profile = getActiveProfile(section);
    if (profile) {
      const dlKey = resolveDownloadKey(profile, section);
      installChecks[section] = await api.download.isInstalled(dlKey, profile.version);
    } else {
      installChecks[section] = false;
    }
  }));

  installedMap = installChecks;

  for (const section of SERVICE_SECTIONS) {
    const running = statuses[section]?.running || false;
    const installed = installChecks[section] || false;
    const controls = document.querySelector(`.nav-controls[data-service="${section}"]`);
    if (!controls) continue;

    // Toggle running indicator on nav-item row
    const navItem = controls.closest('.nav-item');
    if (navItem) navItem.classList.toggle('service-running', running);

    // Track uptime
    if (running && !serviceUptime[section]) {
      serviceUptime[section] = Date.now() - Number(statuses[section]?.uptime || 0);
    } else if (!running) {
      delete serviceUptime[section];
    }
    // Display uptime in sidebar
    let uptimeEl = navItem?.querySelector('.nav-uptime');
    if (running && serviceUptime[section]) {
      if (!uptimeEl) {
        uptimeEl = document.createElement('span');
        uptimeEl.className = 'nav-uptime';
        const labelGroup = navItem?.querySelector('.nav-label-group');
        if (labelGroup) labelGroup.appendChild(uptimeEl);
      }
      uptimeEl.textContent = formatUptime(Date.now() - serviceUptime[section]);
    } else if (uptimeEl) {
      uptimeEl.remove();
    }

    const startBtn = controls.querySelector('.nav-btn-start');
    const stopBtn = controls.querySelector('.nav-btn-stop');
    const restartBtn = controls.querySelector('.nav-btn-restart');
    const openBtn = controls.querySelector('.nav-btn-open');
    const dot = controls.querySelector('.nav-status-dot');

    if (!startBtn) {
      // PHP or other auto-managed service — only update status dot
      if (dot) dot.classList.toggle('running', running);
    } else if (running) {
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      if (restartBtn) restartBtn.classList.remove('hidden');
      dot.classList.add('running');
    } else {
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      if (restartBtn) restartBtn.classList.add('hidden');
      dot.classList.remove('running');
    }

    // Disable play button if version not installed
    if (startBtn && !installed && !running) {
      startBtn.classList.add('nav-btn-disabled');
      startBtn.disabled = true;
    } else if (startBtn) {
      startBtn.classList.remove('nav-btn-disabled');
      startBtn.disabled = false;
    }

    if (openBtn) openBtn.classList.toggle('hidden', !running);
    document.querySelectorAll(`.btn-open-web[data-open-service="${section}"]`).forEach(button => {
      button.disabled = !running;
    });

    // Update sidebar version with red/green color
    const versionEl = document.getElementById('nav-version-' + section);
    if (versionEl) {
      const profile = getActiveProfile(section);
      versionEl.textContent = profile ? profile.version : '';
      versionEl.classList.remove('version-installed', 'version-missing');
      if (profile) {
        versionEl.classList.add(installed ? 'version-installed' : 'version-missing');
      }
    }
  }

  // Update DB viewer online/offline
  for (const dbSection of DB_SECTIONS) {
    const running = statuses[dbSection]?.running || false;
    const offlineEl = document.getElementById('db-offline-' + dbSection);
    const onlineEl = document.getElementById('db-online-' + dbSection);
    if (offlineEl && onlineEl) {
      offlineEl.classList.toggle('hidden', running);
      onlineEl.classList.toggle('hidden', !running);
      if (running && !dbState[dbSection]?.loaded) {
        if (!dbState[dbSection]) dbState[dbSection] = {};
        dbState[dbSection].loaded = true;
        dbRefresh(dbSection);
      }
      if (!running && dbState[dbSection]) {
        dbState[dbSection].loaded = false;
      }
    }
  }

  // Update running services counter
  const runningCount = SERVICE_SECTIONS.filter(s => statuses[s]?.running).length;
  const counterEl = document.getElementById('running-counter');
  if (counterEl) {
    counterEl.textContent = `${runningCount}/${SERVICE_SECTIONS.length} running`;
    counterEl.classList.toggle('has-running', runningCount > 0);
  }

  refreshDashboard();
  syncSidebarGroupChecks();
}

/* ===== Download Progress ===== */
function handleDownloadProgress(data) {
  const { service, version, stage, percent } = data;
  const managedOperation = versionOperations.has(service);
  updateVersionOperationProgress(data);
  // Find which section this download belongs to
  const section = findSectionForDownload(service);
  if (!section) return;

  const container = document.getElementById('progress-' + section);
  const label = document.getElementById('progress-label-' + section);
  const fill = document.getElementById('progress-fill-' + section);

  if (!container) return;

  if (stage === 'failed') {
    container.classList.add('hidden');
    if (!managedOperation) showToast(`${service} ${version}: ${data.error || 'installation failed'}`, 'error');
    return;
  }

  if (stage === 'done') {
    container.classList.add('hidden');
    if (fill) { fill.style.width = '100%'; fill.classList.add('complete'); }
    // Refresh install status + sidebar (version colors, play button)
    const profile = getActiveProfile(section);
    if (profile) updateInstallStatus(section, profile);
    refreshStatuses();
    if (!managedOperation) showToast(`${service} ${version} installed`, 'success');
    return;
  }

  container.classList.remove('hidden');
  if (fill) {
    fill.style.width = percent + '%';
    fill.classList.remove('complete');
  }
  if (label) {
    if (stage === 'retrying') {
      label.textContent = `Retrying ${service} ${version} (attempt ${data.attempt + 1}/${data.maxRetries})...`;
    } else if (stage === 'extracting') {
      label.textContent = `Extracting ${service} ${version}...`;
    } else if (stage === 'python-manager') {
      label.textContent = 'Installing and configuring the official Python Manager...';
    } else {
      label.textContent = `Downloading ${service} ${version}... ${percent}%`;
    }
  }
}

function findSectionForDownload(dlKey) {
  // dlKey might be 'nginx', 'apache', 'postgresql', 'php', etc.
  // Map back to section
  const typeToSection = {
    apache: 'apache', nginx: 'nginx', caddy: 'caddy',
    postgresql: 'postgresql', mysql: 'mysql', mariadb: 'mariadb', mongodb: 'mongodb',
    php: 'php', node: 'node', go: 'go', bun: 'bun', redis: 'redis',
    memcached: 'memcached', minio: 'minio', python: 'python', deno: 'deno'
  };
  return typeToSection[dlKey] || null;
}

/* ===== Helpers ===== */
function getActiveProfile(section) {
  const svc = config[section];
  if (!svc || !svc.profiles) return null;
  return svc.profiles.find(p => p.id === svc.activeProfileId) || svc.profiles[0] || null;
}

function getNestedValue(obj, key) {
  // Support dotted keys like "xdebug.mode"
  const parts = key.split('.');
  let val = obj;
  for (const part of parts) {
    if (val == null) return undefined;
    val = val[part];
  }
  return val;
}

function setNestedValue(obj, key, value) {
  const parts = key.split('.');
  let target = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (target[parts[i]] == null) target[parts[i]] = {};
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatUptime(ms) {
  if (!ms || ms < 0) return '-';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ===== Toast ===== */
function showToast(msg, type = 'success', group = '') {
  const container = document.getElementById('toast-container');
  if (group) (container || document).querySelectorAll(`[data-toast-group="${group}"]`).forEach(item => item.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  if (group) toast.dataset.toastGroup = group;
  toast.textContent = msg;
  if (container) {
    container.appendChild(toast);
  } else {
    document.body.appendChild(toast);
  }
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ===== Database Viewer ===== */
function initDbViewers() {
  for (const section of DB_SECTIONS) {
    const container = document.getElementById('db-viewer-' + section);
    if (!container) continue;

    const label = sectionLabel(section);
    const placeholder = section === 'mongodb'
      ? '{"collection":"users","operation":"find","filter":{},"limit":100}'
      : 'Enter SQL query...';

    container.innerHTML = `
      <div class="config-section">
        <h3 class="section-title">🗄 Database Explorer</h3>
        <div class="db-offline" id="db-offline-${section}">
          <div class="db-offline-msg">▶ Start ${escapeHtml(label)} to use Database Explorer</div>
        </div>
        <div class="db-online hidden" id="db-online-${section}">
          <div class="db-toolbar">
            <button class="btn db-btn" data-action="refresh">🔄 Refresh</button>
            <button class="btn db-btn" data-action="create-db">+ Database</button>
            <button class="btn db-btn db-btn-danger" data-action="drop-db">🗑 Drop DB</button>
            <button class="btn db-btn" data-action="export-csv">📥 Export CSV</button>
            <button class="btn db-btn db-btn-adminer" data-action="open-adminer" title="Open in Adminer">🔧 Adminer</button>
          </div>
          <div class="db-layout">
            <div class="db-sidebar">
              <div class="db-tree" id="db-tree-${section}"></div>
            </div>
            <div class="db-main">
              <div class="db-query-bar">
                <div class="db-query-wrap">
                  <textarea class="db-query-input code-textarea" id="db-query-${section}" placeholder="${placeholder}" rows="3" spellcheck="false"></textarea>
                  <div class="db-query-history-bar">
                    <button class="btn db-btn db-btn-history" data-action="history" title="Query History">📜 History</button>
                    <div class="db-history-dropdown hidden" id="db-history-${section}"></div>
                  </div>
                </div>
                <button class="btn btn-save db-run-btn" data-action="run-query">▶ Run</button>
              </div>
              <div class="db-result-info" id="db-info-${section}"></div>
              <div class="db-table-wrap" id="db-table-${section}"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    container.querySelector('[data-action="refresh"]').addEventListener('click', () => dbRefresh(section));
    container.querySelector('[data-action="create-db"]').addEventListener('click', () => dbCreateDb(section));
    container.querySelector('[data-action="drop-db"]').addEventListener('click', () => dbDropDb(section));
    container.querySelector('[data-action="export-csv"]').addEventListener('click', () => dbExportCsv(section));
    container.querySelector('[data-action="run-query"]').addEventListener('click', () => dbRunQuery(section));
    container.querySelector('[data-action="open-adminer"]').addEventListener('click', () => dbOpenTool(section));
    container.querySelector('[data-action="history"]').addEventListener('click', () => toggleQueryHistory(section));
    container.querySelector('.db-query-input').addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); dbRunQuery(section); }
    });
  }
}

/* ===== Monitoring and Automation ===== */
const monitoringState = { overview: null, history: [], rules: [], automations: [], automationHistory: [], publishing: [], initialized: false, timer: null };

function initMonitoringCenter() {
  if (!api.observability || monitoringState.initialized) return;
  monitoringState.initialized = true;
  const service = document.getElementById('monitor-rule-service');
  service.innerHTML = SERVICE_SECTIONS.map(id => `<option value="${id}">${escapeHtml(sectionLabel(id))}</option>`).join('');
  document.getElementById('monitor-refresh')?.addEventListener('click', () => refreshMonitoringCenter(true));
  document.getElementById('monitor-copy-prometheus')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(await api.observability.prometheus()); showToast('Prometheus metrics copied', 'success'); }
    catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('monitor-rule-add')?.addEventListener('click', saveMonitoringRule);
  document.getElementById('automation-add')?.addEventListener('click', saveAutomation);
  document.getElementById('automation-run-due')?.addEventListener('click', async () => { await api.automation.runDue(); await refreshMonitoringCenter(false); });
  document.getElementById('automation-action')?.addEventListener('change', updateAutomationForm);
  document.getElementById('monitor-ai-run')?.addEventListener('click', runMonitoringAssistant);
  api.observability.onChanged?.(() => scheduleMonitoringRefresh());
  api.automation.onChanged?.(() => scheduleMonitoringRefresh());
  updateAutomationForm();
}

function scheduleMonitoringRefresh() {
  clearTimeout(monitoringState.timer);
  monitoringState.timer = setTimeout(() => {
    if (document.getElementById('panel-monitoring')?.classList.contains('active')) refreshMonitoringCenter(false);
  }, 350);
}

async function refreshMonitoringCenter(collect = false) {
  try {
    if (collect) await api.observability.collect();
    const [overview, history, rules, automations, automationHistory, publishing] = await Promise.all([
      api.observability.overview(), api.observability.history({ limit: 120 }), api.observability.rules(), api.automation.list(), api.automation.history(50), api.integration.readiness('Publishing')
    ]);
    Object.assign(monitoringState, { overview, history, rules, automations, automationHistory, publishing });
    renderMonitoringCenter();
  } catch (error) { showToast(`Monitoring error: ${error.message}`, 'error'); }
}

function monitoringSparkline(service) {
  const values = monitoringState.history.map(sample => Number(sample.services?.[service]?.memoryMB || 0)).slice(-60);
  if (values.length < 2) return '';
  const maximum = Math.max(1, ...values);
  const points = values.map((value, index) => `${(index / (values.length - 1) * 100).toFixed(1)},${(36 - value / maximum * 33).toFixed(1)}`).join(' ');
  return `<svg class="monitor-sparkline" viewBox="0 0 100 38" preserveAspectRatio="none" aria-label="Memory history"><polyline points="${points}"></polyline></svg>`;
}

function renderMonitoringCenter() {
  const overview = monitoringState.overview || { latest: { services: {} }, activeAlerts: [], recentEvents: [] };
  document.getElementById('monitor-running').textContent = overview.running || 0;
  document.getElementById('monitor-memory').textContent = `${Number(overview.memoryMB || 0).toFixed(1)} MB`;
  document.getElementById('monitor-alert-count').textContent = overview.activeAlerts?.length || 0;
  document.getElementById('monitor-sample-time').textContent = overview.latest?.at ? new Date(overview.latest.at).toLocaleTimeString() : '—';
  const services = Object.entries(overview.latest?.services || {});
  document.getElementById('monitor-service-grid').innerHTML = services.map(([name, value]) => `<article class="monitor-service">
    <div class="monitor-service-head"><strong>${escapeHtml(sectionLabel(name))}</strong><span class="workspace-state ${value.running ? 'running' : 'stopped'}">${value.running ? 'running' : 'stopped'}</span></div>
    <div class="monitor-service-values"><span>${Number(value.memoryMB || 0).toFixed(1)} MB</span><span>${Number(value.cpuPercent || 0).toFixed(1)}% CPU</span><span>${formatUptime(Number(value.uptimeSeconds || 0) * 1000)}</span></div>
    ${monitoringSparkline(name)}
  </article>`).join('') || '<div class="workspace-empty">No metric samples yet.</div>';
  const alerts = document.getElementById('monitor-alerts');
  alerts.innerHTML = (overview.activeAlerts || []).map(alert => `<div class="monitor-row"><span class="doctor-severity ${escapeHtml(alert.severity)}"></span><div class="monitor-row-main"><strong>${escapeHtml(alert.message)}</strong><small>${escapeHtml(alert.target)} · ${alert.occurrences} occurrence(s) · ${escapeHtml(new Date(alert.lastSeenAt).toLocaleString())}</small></div><button class="btn btn-small monitor-ack" data-id="${escapeHtml(alert.id)}">Acknowledge</button></div>`).join('') || '<div class="workspace-empty compact">No active alerts.</div>';
  alerts.querySelectorAll('.monitor-ack').forEach(button => button.addEventListener('click', async () => { await api.observability.acknowledge(button.dataset.id); await refreshMonitoringCenter(false); }));
  document.getElementById('monitor-events').innerHTML = (overview.recentEvents || []).slice(0, 15).map(event => `<div class="monitor-row"><span>${event.type === 'service-crash' ? '💥' : '•'}</span><div class="monitor-row-main"><strong>${escapeHtml(event.type)} · ${escapeHtml(event.target)}</strong><small>${escapeHtml(new Date(event.at).toLocaleString())}</small></div></div>`).join('');
  const rules = document.getElementById('monitor-rules');
  rules.innerHTML = monitoringState.rules.map(rule => `<div class="monitor-row"><span class="doctor-severity ${escapeHtml(rule.severity)}"></span><div class="monitor-row-main"><strong>${escapeHtml(sectionLabel(rule.service))}: ${escapeHtml(rule.metric)} ${escapeHtml(rule.operator)} ${rule.threshold}</strong><small>${escapeHtml(rule.severity)} · ${rule.enabled ? 'enabled' : 'disabled'}</small></div><button class="btn btn-small btn-danger monitor-rule-remove" data-id="${escapeHtml(rule.id)}">×</button></div>`).join('') || '<div class="workspace-empty compact">No custom rules.</div>';
  rules.querySelectorAll('.monitor-rule-remove').forEach(button => button.addEventListener('click', async () => { await api.observability.removeRule(button.dataset.id); await refreshMonitoringCenter(false); }));
  renderAutomations();
  document.getElementById('monitor-publishing-readiness').innerHTML = monitoringState.publishing.map(item => {
    const state = !item.enabled ? 'disabled' : item.verified ? 'verified' : item.configured ? 'configured' : 'incomplete';
    return `<div class="monitor-row"><span>${item.verified ? '✓' : item.enabled ? '○' : '—'}</span><div class="monitor-row-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(state)}${item.missing?.length ? ` · missing: ${escapeHtml(item.missing.join(', '))}` : ''}</small></div></div>`;
  }).join('') || '<div class="workspace-empty compact">No publishing adapters.</div>';
}

async function runMonitoringAssistant() {
  const prompt = document.getElementById('monitor-ai-prompt').value.trim();
  if (!prompt) return showToast('Enter a diagnostic question first', 'error');
  const button = document.getElementById('monitor-ai-run');
  const output = document.getElementById('monitor-ai-result');
  setDatabaseManagerBusy(button, true, 'Analyzing…');
  output.classList.remove('hidden'); output.textContent = 'Sending sanitized context…';
  try {
    const result = await api.integration.assistant(prompt, {
      overview: monitoringState.overview,
      recentMetrics: monitoringState.history.slice(-20),
      alertRules: monitoringState.rules,
      automations: monitoringState.automations.map(item => ({ name: item.name, action: item.action, target: item.target, lastError: item.lastError }))
    });
    output.textContent = result.success ? result.content : result.error;
    if (!result.success) showToast(result.error, 'error');
  } catch (error) { output.textContent = error.message; showToast(error.message, 'error'); }
  finally { setDatabaseManagerBusy(button, false); }
}

async function saveMonitoringRule() {
  try {
    await api.observability.saveRule({
      service: document.getElementById('monitor-rule-service').value,
      metric: document.getElementById('monitor-rule-metric').value,
      operator: document.getElementById('monitor-rule-operator').value,
      threshold: Number(document.getElementById('monitor-rule-threshold').value),
      severity: document.getElementById('monitor-rule-severity').value,
      enabled: true
    });
    await refreshMonitoringCenter(false);
  } catch (error) { showToast(error.message, 'error'); }
}

function updateAutomationForm() {
  const action = document.getElementById('automation-action')?.value;
  const target = document.getElementById('automation-target');
  const command = document.getElementById('automation-command');
  const global = ['backup-run-due', 'doctor'].includes(action);
  target.classList.toggle('hidden', global);
  command.classList.toggle('hidden', action !== 'project-command');
  const hints = {
    'service-start': 'service id, e.g. mysql', 'service-stop': 'service id, e.g. node', 'service-restart': 'service id, e.g. nginx',
    'project-start': 'project id or slug', 'project-stop': 'project id or slug', 'project-command': 'project id or slug',
    'lab-start': 'lab id', 'lab-stop': 'lab id', 'lab-provision': 'lab id'
  };
  target.placeholder = hints[action] || 'target id';
}

async function saveAutomation() {
  try {
    const item = await api.automation.save({
      name: document.getElementById('automation-name').value.trim(),
      action: document.getElementById('automation-action').value,
      target: document.getElementById('automation-target').value.trim(),
      commandName: document.getElementById('automation-command').value.trim(),
      intervalMinutes: Number(document.getElementById('automation-interval').value), enabled: true
    });
    document.getElementById('automation-name').value = '';
    showToast(`Automation scheduled: ${item.name}`, 'success'); await refreshMonitoringCenter(false);
  } catch (error) { showToast(error.message, 'error'); }
}

function renderAutomations() {
  const historyMap = new Map(monitoringState.automationHistory.map(item => [item.automationId, item]));
  const list = document.getElementById('automation-list');
  list.innerHTML = monitoringState.automations.map(item => {
    const recent = historyMap.get(item.id);
    return `<div class="automation-row"><span>${item.running ? '⟳' : item.enabled ? '⚙' : '⏸'}</span><div class="automation-row-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.action)} ${escapeHtml(item.target)} · every ${item.intervalMinutes} min · next ${escapeHtml(new Date(item.nextRunAt).toLocaleString())}${recent ? ` · last ${recent.success ? '✓' : '✕'}` : ''}</small></div><button class="btn btn-small automation-run" data-id="${escapeHtml(item.id)}" ${item.running ? 'disabled' : ''}>Run</button><button class="btn btn-small btn-danger automation-remove" data-id="${escapeHtml(item.id)}">×</button></div>`;
  }).join('') || '<div class="workspace-empty compact">No automations.</div>';
  list.querySelectorAll('.automation-run').forEach(button => button.addEventListener('click', async () => { const result = await api.automation.run(button.dataset.id); showToast(result.success ? 'Automation completed' : result.error, result.success ? 'success' : 'error'); await refreshMonitoringCenter(false); }));
  list.querySelectorAll('.automation-remove').forEach(button => button.addEventListener('click', async () => { await api.automation.remove(button.dataset.id); await refreshMonitoringCenter(false); }));
}

/* ===== Visual Test Lab ===== */
const LAB_SERVICE_NAMES = { postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongodb: 'MongoDB', redis: 'Redis', memcached: 'Memcached', minio: 'MinIO' };
const testLabState = {
  recipes: [], labs: [], projects: [], initialized: false, refreshTimer: null, previewTimer: null,
  builder: { plan: null, layout: {}, services: [], selectedNodeId: '', selectedService: '', editing: null }
};

function initTestLab() {
  if (!api.lab || testLabState.initialized) return;
  testLabState.initialized = true;
  initApiFlowBuilder();
  document.querySelectorAll('[data-lab-mode]').forEach(button => button.addEventListener('click', () => setTestLabMode(button.dataset.labMode)));
  document.getElementById('lab-new')?.addEventListener('click', () => openTestLabEditor());
  document.getElementById('lab-refresh')?.addEventListener('click', () => document.getElementById('api-flow-mode')?.classList.contains('hidden') ? refreshTestLabs() : refreshApiFlows(true));
  document.getElementById('lab-editor-close')?.addEventListener('click', closeTestLabEditor);
  document.getElementById('lab-editor-cancel')?.addEventListener('click', closeTestLabEditor);
  document.getElementById('lab-editor-save')?.addEventListener('click', () => persistTestLabBlueprint(false));
  document.getElementById('lab-editor-launch')?.addEventListener('click', () => persistTestLabBlueprint(true));
  document.getElementById('lab-preview')?.addEventListener('click', () => previewTestLabBlueprint(true));
  document.getElementById('lab-recipe')?.addEventListener('change', () => applyTestLabRecipe(false));
  document.getElementById('lab-use-project')?.addEventListener('click', useSelectedProjectInLab);
  document.getElementById('lab-detect-root')?.addEventListener('click', detectTestLabSource);
  document.getElementById('lab-fit')?.addEventListener('click', fitTestLabCanvas);
  document.getElementById('lab-auto-layout')?.addEventListener('click', () => { testLabState.builder.layout = {}; renderTestLabFlow(testLabState.builder.plan, true); scheduleTestLabPreview(); });
  document.getElementById('lab-inspector-toggle')?.addEventListener('click', toggleTestLabInspector);
  document.getElementById('lab-inspector-close')?.addEventListener('click', closeTestLabInspector);
  document.getElementById('lab-remove-service')?.addEventListener('click', () => removeTestLabService(testLabState.builder.selectedService));
  document.getElementById('lab-palette-plugin')?.addEventListener('click', chooseTestLabPlugin);
  document.getElementById('lab-add-plugin')?.addEventListener('click', chooseTestLabPlugin);
  document.getElementById('lab-pick-root')?.addEventListener('click', async () => {
    const result = await api.shell.selectDirectory(document.getElementById('lab-root').value || '');
    if (!result?.success || !result.path) return;
    document.getElementById('lab-root').value = result.path;
    await detectTestLabSource();
  });
  document.querySelectorAll('[data-lab-service]').forEach(button => button.addEventListener('click', () => addTestLabService(button.dataset.labService)));
  document.querySelectorAll('[data-lab-view]').forEach(button => button.addEventListener('click', () => setTestLabBuilderView(button.dataset.labView)));
  for (const id of ['lab-name', 'lab-root', 'lab-setup-command', 'lab-command', 'lab-port', 'lab-health-path', 'lab-env', 'lab-wp-web', 'lab-wp-database', 'lab-wp-title', 'lab-wp-user', 'lab-wp-email']) {
    document.getElementById(id)?.addEventListener(id.includes('wp-') || id === 'lab-port' ? 'change' : 'input', scheduleTestLabPreview);
  }
  api.lab.onChanged?.(() => {
    clearTimeout(testLabState.refreshTimer);
    testLabState.refreshTimer = setTimeout(() => {
      if (document.getElementById('panel-test-lab')?.classList.contains('active')) refreshTestLabs();
    }, 250);
  });
  api.lab.onProgress?.(progress => {
    const card = document.querySelector(`[data-lab-id="${CSS.escape(progress.labId || '')}"] .lab-progress`);
    if (card) card.textContent = `${progress.message || progress.stage} · ${Math.round(progress.percent || 0)}%`;
    const status = document.getElementById('lab-plan-status');
    if (status && !document.getElementById('lab-editor')?.classList.contains('hidden')) status.innerHTML = `<span class="working">⟳</span><div><strong>${escapeHtml(progress.message || progress.stage)}</strong><small>${Math.round(progress.percent || 0)}% ukończone</small></div>`;
  });
}

async function refreshTestLabs() {
  if (!api.lab) return;
  const grid = document.getElementById('lab-grid');
  try {
    if (!testLabState.recipes.length) {
      [testLabState.recipes, testLabState.projects] = await Promise.all([api.lab.recipes(), api.workspace.list()]);
      const select = document.getElementById('lab-recipe');
      select.innerHTML = testLabState.recipes.map(recipe => `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)}</option>`).join('');
      const project = document.getElementById('lab-project');
      project.innerHTML = '<option value="">Bez powiązania</option>' + testLabState.projects.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
      renderTestLabTemplateGallery();
    }
    testLabState.labs = await api.lab.list();
    renderTestLabs();
  } catch (error) { if (grid) grid.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`; }
}

function renderTestLabTemplateGallery() {
  const icons = { 'wordpress-plugin': 'ⓦ', 'node-api': '⬢', 'php-api': '🐘', 'python-api': '🐍', 'go-api': 'Go', 'bun-api': 'B', 'deno-api': 'D', 'compose-stack': '🐳', 'custom-sidecar': '⚙' };
  const html = testLabState.recipes.map(recipe => `<button class="lab-template-card" type="button" data-lab-template="${escapeHtml(recipe.id)}"><span>${icons[recipe.id] || '⚡'}</span><div><strong>${escapeHtml(recipe.name)}</strong><small>${escapeHtml(recipe.description)}</small></div><i>Użyj →</i></button>`).join('');
  document.getElementById('lab-template-gallery').innerHTML = html;
  document.getElementById('lab-recipe-palette').innerHTML = testLabState.recipes.map(recipe => `<button type="button" data-lab-template="${escapeHtml(recipe.id)}"><span>${icons[recipe.id] || '⚡'}</span>${escapeHtml(recipe.name)}</button>`).join('');
  document.querySelectorAll('[data-lab-template]').forEach(button => button.addEventListener('click', () => {
    if (document.getElementById('lab-editor').classList.contains('hidden')) openTestLabEditor(null, button.dataset.labTemplate);
    else { document.getElementById('lab-recipe').value = button.dataset.labTemplate; applyTestLabRecipe(false); }
  }));
}

function renderTestLabs() {
  const grid = document.getElementById('lab-grid');
  if (!grid) return;
  if (!testLabState.labs.length) { grid.innerHTML = '<div class="workspace-empty">Nie masz jeszcze Labów. Kliknij jeden z szablonów powyżej — diagram utworzy się automatycznie.</div>'; return; }
  const states = { running: 'działa', ready: 'gotowy', stopped: 'zatrzymany', unprovisioned: 'blueprint' };
  grid.innerHTML = testLabState.labs.map(lab => {
    const recipe = testLabState.recipes.find(item => item.id === lab.recipeId);
    const running = lab.status === 'running'; const ready = Boolean(lab.provisionedAt);
    const icon = lab.kind === 'wordpress' ? 'ⓦ' : lab.recipeId === 'compose-stack' ? '🐳' : '⚡';
    const components = lab.kind === 'wordpress' ? [lab.wordpress.webService, lab.wordpress.databaseService, ...(lab.pluginPaths || []).map(value => `🧩 ${value.split(/[\\/]/).pop()}`)] : [...(lab.services || []), `127.0.0.1:${lab.port}`];
    return `<article class="lab-card" data-lab-id="${escapeHtml(lab.id)}"><div class="lab-card-head"><div class="lab-card-title"><span>${icon}</span><div><h3>${escapeHtml(lab.name)}</h3><p>${escapeHtml(recipe?.name || lab.recipeId)}</p></div></div><span class="workspace-state ${running ? 'running' : ready ? 'completed' : 'stopped'}">${escapeHtml(states[lab.status] || lab.status)}</span></div><div class="lab-card-meta">${components.map(value => `<span class="workspace-chip">${escapeHtml(LAB_SERVICE_NAMES[value] || value)}</span>`).join('')}</div><div class="lab-card-path" title="${escapeHtml(lab.root || lab.url)}">${escapeHtml(lab.root || lab.url || 'Środowisko zarządzane przez KitsuneServ')}</div>${lab.lastError ? `<div class="db-error">${escapeHtml(lab.lastError)}</div>` : ''}<div class="lab-progress form-help"></div>${lab.output ? `<pre class="lab-output">${escapeHtml(lab.output)}</pre>` : ''}<div class="lab-card-actions">${!ready ? '<button class="btn btn-primary lab-provision">⚙ Przygotuj</button>' : ''}${running ? '<button class="btn lab-stop">⏹ Zatrzymaj</button>' : '<button class="btn btn-primary lab-start">▶ Uruchom</button>'}<button class="btn lab-health">🩺 Test</button><button class="btn lab-open" ${!lab.url ? 'disabled' : ''}>🌐 Otwórz</button><button class="btn lab-edit" ${running ? 'disabled' : ''}>✎ Diagram</button><button class="btn btn-danger lab-delete">🗑</button></div></article>`;
  }).join('');
  grid.querySelectorAll('[data-lab-id]').forEach(bindTestLabCard);
}

function bindTestLabCard(card) {
  const id = card.dataset.labId; const lab = testLabState.labs.find(item => item.id === id);
  const run = async (button, action) => {
    setDatabaseManagerBusy(button, true, 'Pracuję…');
    try { const result = await action(); if (result?.success === false) throw new Error(result.error || 'Operacja Labu nie powiodła się'); if (result.generatedPassword) alert(`Hasło administratora WordPress (pokazywane jeden raz):\n\n${result.generatedPassword}`); showToast(`${lab.name}: gotowe`, 'success'); }
    catch (error) { showToast(error.message, 'error'); }
    finally { setDatabaseManagerBusy(button, false); await refreshTestLabs(); }
  };
  card.querySelector('.lab-provision')?.addEventListener('click', event => run(event.currentTarget, () => api.lab.provision(id)));
  card.querySelector('.lab-start')?.addEventListener('click', event => run(event.currentTarget, () => api.lab.start(id)));
  card.querySelector('.lab-stop')?.addEventListener('click', event => run(event.currentTarget, () => api.lab.stop(id)));
  card.querySelector('.lab-health')?.addEventListener('click', async () => { const result = await api.lab.health(id); showToast(result.healthy ? `Działa · HTTP ${result.statusCode || 'OK'} · ${result.responseTime} ms` : result.error || 'Brak odpowiedzi', result.healthy ? 'success' : 'error'); });
  card.querySelector('.lab-open')?.addEventListener('click', () => lab.url && api.shell.openExternal(lab.kind === 'wordpress' ? `${lab.url.replace(/\/?$/, '/')}wp-admin/` : lab.url));
  card.querySelector('.lab-edit')?.addEventListener('click', () => openTestLabEditor(lab));
  card.querySelector('.lab-delete')?.addEventListener('click', async () => { if (!confirm(`Usunąć Lab „${lab.name}”? Kod źródłowy pozostanie nietknięty.`)) return; const deleteInstance = lab.kind === 'wordpress' && confirm('Usunąć także zarządzaną kopię WordPress i bazę testową? Pluginy źródłowe pozostaną.'); const result = await api.lab.remove(id, { deleteInstance }); showToast(result.success ? 'Lab usunięty' : result.error, result.success ? 'success' : 'error'); await refreshTestLabs(); });
}

function openTestLabEditor(lab = null, recipeId = 'wordpress-plugin') {
  testLabState.builder = { plan: null, layout: structuredClone(lab?.layout || {}), services: [...(lab?.services || [])], selectedNodeId: '', selectedService: '', editing: lab };
  document.getElementById('lab-editor').classList.remove('hidden', 'inspector-open', 'inspector-collapsed');
  document.getElementById('lab-editor-title').textContent = lab ? `Diagram: ${lab.name}` : 'Nowe środowisko testowe';
  document.getElementById('lab-id').value = lab?.id || '';
  document.getElementById('lab-name').value = lab?.name || '';
  document.getElementById('lab-project').value = lab?.projectId || '';
  document.getElementById('lab-recipe').value = lab?.recipeId || recipeId;
  document.getElementById('lab-root').value = lab?.root || '';
  document.getElementById('lab-setup-command').value = lab?.setupCommand || '';
  document.getElementById('lab-command').value = lab?.command || '';
  document.getElementById('lab-port').value = lab?.port || 3001;
  document.getElementById('lab-health-path').value = lab?.healthPath || '/';
  document.getElementById('lab-env').value = formatWorkspaceMap(lab?.env);
  document.getElementById('lab-plugin-paths').value = (lab?.pluginPaths || []).join('\n');
  document.getElementById('lab-wp-web').value = lab?.wordpress?.webService || 'apache';
  document.getElementById('lab-wp-database').value = lab?.wordpress?.databaseService || 'mysql';
  document.getElementById('lab-wp-title').value = lab?.wordpress?.siteTitle || lab?.name || '';
  document.getElementById('lab-wp-user').value = lab?.wordpress?.adminUser || 'admin';
  document.getElementById('lab-wp-email').value = lab?.wordpress?.adminEmail || 'admin@example.test';
  document.getElementById('lab-wp-password').value = '';
  document.getElementById('lab-detection-result').textContent = 'Wybierz projekt lub katalog, a technologia i polecenia zostaną wykryte automatycznie.';
  applyTestLabRecipe(Boolean(lab)); renderTestLabPluginList(); setTestLabBuilderView('flow');
  document.getElementById('lab-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeTestLabEditor() { const editor = document.getElementById('lab-editor'); editor?.classList.add('hidden'); editor?.classList.remove('inspector-open', 'inspector-collapsed'); clearTimeout(testLabState.previewTimer); }

function applyTestLabRecipe(preserve = false) {
  const recipe = testLabState.recipes.find(item => item.id === document.getElementById('lab-recipe')?.value); if (!recipe) return;
  const wordpress = recipe.kind === 'wordpress';
  document.getElementById('lab-component-palette').classList.toggle('wordpress', wordpress);
  document.querySelectorAll('[data-lab-service]').forEach(button => { button.disabled = wordpress; });
  document.getElementById('lab-palette-plugin').disabled = !wordpress;
  if (!preserve) {
    document.getElementById('lab-setup-command').value = recipe.defaultSetupCommand || '';
    document.getElementById('lab-command').value = recipe.defaultCommand || '';
    document.getElementById('lab-port').value = recipe.defaultPort || 9001;
    testLabState.builder.services = wordpress ? [] : testLabState.builder.services;
    testLabState.builder.layout = {};
    if (!document.getElementById('lab-name').value.trim()) document.getElementById('lab-name').value = recipe.name.replace(/ sidecar| lab/gi, '');
  }
  scheduleTestLabPreview(true);
}

function collectTestLabBlueprint() {
  const recipe = testLabState.recipes.find(item => item.id === document.getElementById('lab-recipe').value);
  return {
    id: document.getElementById('lab-id').value || undefined,
    name: document.getElementById('lab-name').value.trim() || recipe?.name || 'Test Lab', recipeId: recipe.id,
    projectId: document.getElementById('lab-project').value,
    root: document.getElementById('lab-root').value.trim(), setupCommand: document.getElementById('lab-setup-command').value.trim(), command: document.getElementById('lab-command').value.trim(),
    port: Number(document.getElementById('lab-port').value), healthPath: document.getElementById('lab-health-path').value.trim() || '/',
    env: parseWorkspaceMap(document.getElementById('lab-env').value, 'Zmienne środowiskowe Labu'), services: [...testLabState.builder.services], layout: structuredClone(testLabState.builder.layout),
    pluginPaths: document.getElementById('lab-plugin-paths').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    wordpress: { webService: document.getElementById('lab-wp-web').value, databaseService: document.getElementById('lab-wp-database').value, siteTitle: document.getElementById('lab-wp-title').value.trim(), adminUser: document.getElementById('lab-wp-user').value.trim(), adminEmail: document.getElementById('lab-wp-email').value.trim() }
  };
}

function scheduleTestLabPreview(immediate = false) {
  clearTimeout(testLabState.previewTimer);
  testLabState.previewTimer = setTimeout(() => previewTestLabBlueprint(false), immediate ? 0 : 300);
}

async function previewTestLabBlueprint(openPlan = false) {
  try {
    const plan = await api.lab.preview(collectTestLabBlueprint());
    testLabState.builder.plan = plan; renderTestLabFlow(plan); renderTestLabPlan(plan); updateTestLabPlanStatus(plan);
    if (openPlan) setTestLabBuilderView('plan');
    return plan;
  } catch (error) {
    document.getElementById('lab-plan-status').innerHTML = `<span class="error">!</span><div><strong>Nie można zbudować planu</strong><small>${escapeHtml(error.message)}</small></div>`;
    if (openPlan) showToast(error.message, 'error');
    return null;
  }
}

function automaticTestLabLayout(plan) {
  const layout = {};
  if (plan.recipe.kind === 'wordpress') {
    layout.php = { x: 40, y: 55 }; layout.web = { x: 300, y: 55 }; layout.database = { x: 300, y: 300 }; layout.wordpress = { x: 585, y: 165 }; layout.browser = { x: 865, y: 165 };
    plan.nodes.filter(node => node.type === 'plugin').forEach((node, index) => { layout[node.id] = { x: 40, y: 285 + index * 150 }; });
  } else {
    layout.source = { x: 35, y: 180 }; layout.runtime = { x: 555, y: 180 }; layout.endpoint = { x: 830, y: 180 };
    plan.nodes.filter(node => node.id.startsWith('service:')).forEach((node, index) => { layout[node.id] = { x: 300, y: 65 + index * 150 }; });
  }
  return layout;
}

function renderTestLabFlow(plan, forceLayout = false) {
  if (!plan) return;
  const nodes = document.getElementById('lab-flow-nodes');
  if (forceLayout || !Object.keys(testLabState.builder.layout).length) testLabState.builder.layout = automaticTestLabLayout(plan);
  const canvasHeight = Math.max(620, ...plan.nodes.map(node => (testLabState.builder.layout[node.id]?.y || 0) + 145));
  nodes.style.height = `${canvasHeight}px`;
  const colors = { source: 'source', runtime: 'runtime', database: 'database', webserver: 'web', wordpress: 'wordpress', plugin: 'plugin', health: 'health' };
  nodes.innerHTML = plan.nodes.map(node => {
    const position = testLabState.builder.layout[node.id] || node.position || { x: 40, y: 40 };
    testLabState.builder.layout[node.id] = position;
    const removable = node.id.startsWith('service:') || node.id.startsWith('plugin:');
    return `<article class="lab-flow-node ${colors[node.type] || ''} ${escapeHtml(node.status)}${testLabState.builder.selectedNodeId === node.id ? ' selected' : ''}" data-lab-node="${escapeHtml(node.id)}" style="left:${position.x}px;top:${position.y}px"><div class="lab-flow-node-head"><span>${node.icon}</span><strong>${escapeHtml(node.label)}</strong>${removable ? '<button type="button" class="lab-flow-node-remove" title="Usuń">×</button>' : ''}</div><div class="lab-flow-node-body"><small>${escapeHtml(node.type)}</small><p title="${escapeHtml(node.detail)}">${escapeHtml(node.detail)}</p><i>${escapeHtml(node.status)}</i></div><b class="lab-port-in"></b><b class="lab-port-out"></b></article>`;
  }).join('');
  nodes.querySelectorAll('[data-lab-node]').forEach(element => {
    const id = element.dataset.labNode;
    element.addEventListener('click', event => { if (!event.target.closest('.lab-flow-node-remove')) selectTestLabNode(id, true); });
    element.querySelector('.lab-flow-node-remove')?.addEventListener('click', () => id.startsWith('service:') ? removeTestLabService(id.slice(8)) : removeTestLabPlugin(Number(id.slice(7))));
    enableTestLabNodeDrag(element, id);
  });
  if (!testLabState.builder.selectedNodeId || !plan.nodes.some(node => node.id === testLabState.builder.selectedNodeId)) selectTestLabNode(plan.recipe.kind === 'wordpress' ? 'wordpress' : 'source');
  requestAnimationFrame(drawTestLabConnections);
}

function drawTestLabConnections() {
  const plan = testLabState.builder.plan; const canvas = document.getElementById('lab-flow-canvas'); const svg = document.getElementById('lab-flow-svg'); if (!plan || !canvas || !svg) return;
  const width = Math.max(canvas.clientWidth, canvas.scrollWidth, 1120); const height = Math.max(canvas.clientHeight, canvas.scrollHeight, 620); svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.querySelectorAll('.lab-flow-connection').forEach(path => path.remove()); const canvasRect = canvas.getBoundingClientRect();
  for (const edge of plan.connections) {
    const from = document.querySelector(`[data-lab-node="${CSS.escape(edge.from)}"] .lab-port-out`); const to = document.querySelector(`[data-lab-node="${CSS.escape(edge.to)}"] .lab-port-in`); if (!from || !to) continue;
    const a = from.getBoundingClientRect(); const b = to.getBoundingClientRect(); const x1 = a.left + a.width / 2 - canvasRect.left + canvas.scrollLeft; const y1 = a.top + a.height / 2 - canvasRect.top + canvas.scrollTop; const x2 = b.left + b.width / 2 - canvasRect.left + canvas.scrollLeft; const y2 = b.top + b.height / 2 - canvasRect.top + canvas.scrollTop; const bend = Math.max(60, Math.abs(x2 - x1) * .45);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('class', 'lab-flow-connection'); path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); path.setAttribute('marker-end', 'url(#lab-flow-arrow)'); svg.appendChild(path);
  }
}

function enableTestLabNodeDrag(element, id) {
  const header = element.querySelector('.lab-flow-node-head');
  header.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return; event.preventDefault(); header.setPointerCapture(event.pointerId); element.classList.add('dragging');
    const start = { x: event.clientX, y: event.clientY, left: parseFloat(element.style.left), top: parseFloat(element.style.top) };
    const move = current => { const position = { x: Math.max(0, start.left + current.clientX - start.x), y: Math.max(0, start.top + current.clientY - start.y) }; element.style.left = `${position.x}px`; element.style.top = `${position.y}px`; testLabState.builder.layout[id] = position; drawTestLabConnections(); };
    const end = () => { element.classList.remove('dragging'); header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', end); header.removeEventListener('pointercancel', end); };
    header.addEventListener('pointermove', move); header.addEventListener('pointerup', end); header.addEventListener('pointercancel', end);
  });
}

function selectTestLabNode(id, revealInspector = false) {
  const node = testLabState.builder.plan?.nodes.find(item => item.id === id); if (!node) return;
  testLabState.builder.selectedNodeId = id; testLabState.builder.selectedService = id.startsWith('service:') ? id.slice(8) : '';
  document.querySelectorAll('.lab-flow-node').forEach(element => element.classList.toggle('selected', element.dataset.labNode === id));
  let inspector = node.type;
  if (id.startsWith('service:')) inspector = 'service';
  else if (['wordpress', 'webserver', 'database'].includes(node.type) || (id === 'php' && testLabState.builder.plan.recipe.kind === 'wordpress')) inspector = 'wordpress';
  else if (node.type === 'runtime' && testLabState.builder.plan.recipe.kind === 'wordpress') inspector = 'wordpress';
  else if (node.type === 'health' && testLabState.builder.plan.recipe.kind === 'wordpress') inspector = 'wordpress';
  document.querySelectorAll('[data-lab-inspector]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.labInspector !== inspector));
  document.getElementById('lab-inspector-title').textContent = node.label; document.getElementById('lab-inspector-help').textContent = node.detail;
  if (inspector === 'service') document.getElementById('lab-selected-service').innerHTML = `<div class="lab-selected-component"><span>🗄️</span><div><strong>${escapeHtml(LAB_SERVICE_NAMES[testLabState.builder.selectedService] || testLabState.builder.selectedService)}</strong><small>Usługa zarządzana przez KitsuneServ uruchamiana przed API.</small></div></div>`;
  if (inspector === 'plugin') renderTestLabPluginList(Number(id.slice(7)));
  if (revealInspector && window.innerWidth <= 1500) openTestLabInspector();
}

function fitTestLabCanvas() {
  const canvas = document.getElementById('lab-flow-canvas'); const nodes = [...document.querySelectorAll('#lab-flow-nodes .lab-flow-node')];
  if (!canvas || !nodes.length) return;
  const left = Math.max(0, Math.min(...nodes.map(node => node.offsetLeft)) - 24);
  const top = Math.max(0, Math.min(...nodes.map(node => node.offsetTop)) - 24);
  canvas.scrollTo({ left, top, behavior: 'smooth' });
  requestAnimationFrame(drawTestLabConnections);
}

function openTestLabInspector() { const editor = document.getElementById('lab-editor'); editor?.classList.remove('inspector-collapsed'); editor?.classList.add('inspector-open'); }
function closeTestLabInspector() { const editor = document.getElementById('lab-editor'); editor?.classList.remove('inspector-open'); if (window.innerWidth > 1500) editor?.classList.add('inspector-collapsed'); }
function toggleTestLabInspector() {
  const editor = document.getElementById('lab-editor'); if (!editor) return;
  if (window.innerWidth <= 1500) editor.classList.toggle('inspector-open');
  else editor.classList.toggle('inspector-collapsed');
}

function setTestLabBuilderView(view) {
  document.querySelectorAll('[data-lab-view]').forEach(button => button.classList.toggle('active', button.dataset.labView === view));
  document.getElementById('lab-flow-canvas').classList.toggle('hidden', view !== 'flow'); document.getElementById('lab-plan-panel').classList.toggle('hidden', view !== 'plan');
}

function renderTestLabPlan(plan) {
  if (!plan) return; const statusIcon = { ok: '✓', warning: '△', error: '!' };
  document.getElementById('lab-plan-panel').innerHTML = `<div class="lab-plan-columns"><section><h4>Kontrola gotowości</h4>${plan.checks.map(check => `<div class="lab-plan-check ${check.status}"><span>${statusIcon[check.status]}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div></div>`).join('') || '<div class="workspace-empty compact">Brak dodatkowych wymagań.</div>'}</section><section><h4>Co zrobi przycisk Start</h4>${plan.actions.map((action, index) => `<div class="lab-plan-action"><span>${index + 1}</span><p>${escapeHtml(action)}</p></div>`).join('')}</section></div><div class="lab-plan-safety">🛡️ Źródła nie są kopiowane ani usuwane. Sekrety trafiają do szyfrowanego magazynu. Pluginy WordPress są montowane na żywo.</div>`;
}

function updateTestLabPlanStatus(plan) {
  const errors = plan.checks.filter(item => item.status === 'error').length; const warnings = plan.checks.filter(item => item.status === 'warning').length;
  document.getElementById('lab-plan-status').innerHTML = errors ? `<span class="error">!</span><div><strong>Plan wymaga ${errors} poprawki/poprawek</strong><small>Otwórz „Plan i kontrola”, aby zobaczyć szczegóły.</small></div>` : `<span class="ok">✓</span><div><strong>Plan gotowy do uruchomienia</strong><small>${warnings ? `${warnings} ostrzeżenie/ostrzeżeń · ` : ''}${plan.nodes.length} bloków, ${plan.actions.length} operacji</small></div>`;
  document.getElementById('lab-editor-launch').disabled = errors > 0;
}

async function useSelectedProjectInLab() {
  const project = testLabState.projects.find(item => item.id === document.getElementById('lab-project').value); if (!project) return showToast('Wybierz projekt KitsuneServ', 'error');
  document.getElementById('lab-root').value = project.root; if (!document.getElementById('lab-name').value.trim()) document.getElementById('lab-name').value = `${project.name} Lab`; await detectTestLabSource();
}

async function detectTestLabSource() {
  const root = document.getElementById('lab-root').value.trim(); if (!root) return showToast('Najpierw wybierz katalog projektu', 'error');
  const button = document.getElementById('lab-detect-root'); setDatabaseManagerBusy(button, true, 'Wykrywam…');
  try {
    const detected = await api.workspace.detect(root); let recipeId = 'custom-sidecar';
    if (detected.wordpressPlugin?.detected) recipeId = 'wordpress-plugin'; else if (detected.compose) recipeId = 'compose-stack'; else if (detected.packageManager === 'bun') recipeId = 'bun-api'; else if (detected.services.includes('deno')) recipeId = 'deno-api'; else if (detected.services.includes('node')) recipeId = 'node-api'; else if (detected.services.includes('php')) recipeId = 'php-api'; else if (detected.services.includes('python')) recipeId = 'python-api'; else if (detected.services.includes('go')) recipeId = 'go-api';
    document.getElementById('lab-recipe').value = recipeId; applyTestLabRecipe(false);
    const recipe = testLabState.recipes.find(item => item.id === recipeId);
    document.getElementById('lab-setup-command').value = detected.commands.install || recipe?.defaultSetupCommand || '';
    document.getElementById('lab-command').value = detected.commands.dev || detected.commands.start || recipe?.defaultCommand || '';
    testLabState.builder.services = detected.services.filter(service => Object.hasOwn(LAB_SERVICE_NAMES, service));
    if (detected.wordpressPlugin?.detected) {
      const paths = new Set(document.getElementById('lab-plugin-paths').value.split(/\r?\n/).filter(Boolean)); paths.add(root); document.getElementById('lab-plugin-paths').value = [...paths].join('\n'); document.getElementById('lab-name').value ||= `${detected.wordpressPlugin.name} Lab`; document.getElementById('lab-wp-title').value ||= `${detected.wordpressPlugin.name} Test`;
    }
    document.getElementById('lab-detection-result').innerHTML = `<strong>✓ ${escapeHtml(detected.wordpressPlugin?.name || detected.templateId)}</strong><span>${Math.round(detected.confidence * 100)}% pewności · ${escapeHtml(detected.evidence.join(' · '))}</span>`;
    renderTestLabPluginList(); await previewTestLabBlueprint(false); selectTestLabNode(recipeId === 'wordpress-plugin' ? 'wordpress' : 'runtime');
  } catch (error) { showToast(error.message, 'error'); document.getElementById('lab-detection-result').textContent = error.message; }
  finally { setDatabaseManagerBusy(button, false); }
}

function addTestLabService(service) { if (!testLabState.builder.services.includes(service)) testLabState.builder.services.push(service); scheduleTestLabPreview(true); }
function removeTestLabService(service) { testLabState.builder.services = testLabState.builder.services.filter(item => item !== service); delete testLabState.builder.layout[`service:${service}`]; scheduleTestLabPreview(true); }

async function chooseTestLabPlugin() {
  const result = await api.shell.selectDirectory(''); if (!result?.success || !result.path) return;
  const paths = new Set(document.getElementById('lab-plugin-paths').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)); paths.add(result.path); document.getElementById('lab-plugin-paths').value = [...paths].join('\n'); renderTestLabPluginList(paths.size - 1); scheduleTestLabPreview(true);
}

function removeTestLabPlugin(index) { const paths = document.getElementById('lab-plugin-paths').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean); paths.splice(index, 1); document.getElementById('lab-plugin-paths').value = paths.join('\n'); testLabState.builder.layout = Object.fromEntries(Object.entries(testLabState.builder.layout).filter(([key]) => !key.startsWith('plugin:'))); renderTestLabPluginList(); scheduleTestLabPreview(true); }
function renderTestLabPluginList(active = -1) { const paths = document.getElementById('lab-plugin-paths').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean); document.getElementById('lab-plugin-list').innerHTML = paths.map((value, index) => `<div class="lab-plugin-item ${index === active ? 'active' : ''}"><span>🧩</span><div><strong>${escapeHtml(value.split(/[\\/]/).pop())}</strong><small title="${escapeHtml(value)}">${escapeHtml(value)}</small></div><button type="button" data-remove-plugin="${index}">×</button></div>`).join('') || '<div class="workspace-empty compact">Dodaj katalog pluginu. Kreator zweryfikuje nagłówek „Plugin Name”.</div>'; document.querySelectorAll('[data-remove-plugin]').forEach(button => button.addEventListener('click', () => removeTestLabPlugin(Number(button.dataset.removePlugin)))); }

async function persistTestLabBlueprint(launch) {
  const button = document.getElementById(launch ? 'lab-editor-launch' : 'lab-editor-save'); const id = document.getElementById('lab-id').value; const plan = await previewTestLabBlueprint(launch);
  if (!plan || (launch && !plan.valid)) return showToast('Popraw czerwone elementy planu przed uruchomieniem', 'error');
  setDatabaseManagerBusy(button, true, launch ? 'Buduję środowisko…' : 'Zapisuję…');
  try {
    const input = collectTestLabBlueprint(); const password = document.getElementById('lab-wp-password').value; const saved = id ? await api.lab.update(id, input, { adminPassword: password }) : await api.lab.create(input, { adminPassword: password });
    if (!launch) { showToast(`Blueprint „${saved.name}” zapisany`, 'success'); closeTestLabEditor(); await refreshTestLabs(); return; }
    const provisioned = await api.lab.provision(saved.id); if (provisioned?.success === false) throw new Error(provisioned.error); const started = await api.lab.start(saved.id); if (started?.success === false) throw new Error(started.error);
    if (provisioned.generatedPassword) alert(`Hasło administratora WordPress (pokazywane jeden raz):\n\n${provisioned.generatedPassword}\n\nZapisz je bezpiecznie.`);
    await refreshTestLabs(); const current = testLabState.labs.find(item => item.id === saved.id) || started.lab; if (current?.url) await api.shell.openExternal(current.kind === 'wordpress' ? `${current.url.replace(/\/?$/, '/')}wp-admin/` : current.url); showToast(`„${saved.name}” działa`, 'success'); closeTestLabEditor();
  } catch (error) { showToast(error.message, 'error'); }
  finally { setDatabaseManagerBusy(button, false); }
}

/* ===== Visual REST API Flow Builder ===== */
const apiFlowState = {
  initialized: false, catalog: [], projects: [], connections: [], project: null,
  endpointId: '', selectedNodeId: '', pendingConnection: null, dirty: false, view: 'editor', rail: 'endpoints',
  operation: 'idle', runtimeError: '', statusTimer: null, lastRenderedEndpointId: ''
};

function apiFlowId(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function selectedApiFlowEndpoint() { return apiFlowState.project?.endpoints?.find(item => item.id === apiFlowState.endpointId) || null; }
function selectedApiFlowNode() { return selectedApiFlowEndpoint()?.nodes?.find(item => item.id === apiFlowState.selectedNodeId) || null; }

function defaultApiFlowEndpoint(index = 1) {
  const inputId = apiFlowId('input'); const outputId = apiFlowId('output');
  return { id: apiFlowId('endpoint'), name: `Endpoint ${index}`, method: 'GET', path: index === 1 ? '/hello' : `/endpoint-${index}`, enabled: true, nodes: [
    { id: inputId, type: 'input', name: 'Input', x: 80, y: 150, config: {}, next: outputId, nextTrue: null, nextFalse: null, nextError: null },
    { id: outputId, type: 'output', name: 'Output', x: 520, y: 150, config: { status: 200, body: { message: 'Hello from KitsuneServ API Flow', query: '{query}', body: '{body}' }, headers: {} }, next: null, nextTrue: null, nextFalse: null, nextError: null }
  ] };
}

function createApiFlowDraft() {
  const endpoint = defaultApiFlowEndpoint();
  return { id: apiFlowId('flow'), name: 'Nowe REST API', slug: '', port: 9393, host: '127.0.0.1', basePath: '/api', cors: true, endpoints: [endpoint], running: false, url: null };
}

function initApiFlowBuilder() {
  if (!api.apiFlow || apiFlowState.initialized) return;
  apiFlowState.initialized = true;
  document.getElementById('api-flow-project-select')?.addEventListener('change', event => loadApiFlowProject(event.target.value));
  document.getElementById('api-flow-new')?.addEventListener('click', newApiFlowProject);
  document.getElementById('api-flow-save')?.addEventListener('click', saveAndRestartApiFlow);
  document.getElementById('api-flow-toggle')?.addEventListener('click', toggleApiFlowServer);
  document.getElementById('api-flow-delete')?.addEventListener('click', deleteApiFlowProject);
  document.getElementById('api-flow-add-endpoint')?.addEventListener('click', addApiFlowEndpoint);
  document.getElementById('api-flow-remove-endpoint')?.addEventListener('click', removeApiFlowEndpoint);
  document.getElementById('api-flow-block-search')?.addEventListener('input', renderApiFlowPalette);
  document.getElementById('api-flow-auto-layout')?.addEventListener('click', autoLayoutApiFlow);
  document.getElementById('api-flow-fit')?.addEventListener('click', fitApiFlowCanvas);
  document.getElementById('api-flow-open-blocks')?.addEventListener('click', () => setApiFlowRail('blocks'));
  document.getElementById('api-flow-inspector-toggle')?.addEventListener('click', toggleApiFlowInspector);
  document.getElementById('api-flow-inspector-close')?.addEventListener('click', closeApiFlowInspector);
  document.getElementById('api-flow-validate')?.addEventListener('click', () => validateApiFlow(true));
  document.getElementById('api-flow-send-test')?.addEventListener('click', sendApiFlowTest);
  document.getElementById('api-flow-copy-test')?.addEventListener('click', () => copyApiFlowUrl(document.getElementById('api-flow-test-url')?.value));
  document.getElementById('api-flow-copy-url')?.addEventListener('click', () => copyApiFlowUrl(apiFlowState.project?.url));
  document.getElementById('api-flow-open-url')?.addEventListener('click', () => apiFlowState.project?.url && api.shell.openExternal(apiFlowState.project.url));
  document.getElementById('api-flow-refresh-logs')?.addEventListener('click', refreshApiFlowLogs);
  document.getElementById('api-flow-clear-logs')?.addEventListener('click', clearApiFlowLogs);
  document.querySelectorAll('[data-api-flow-view]').forEach(button => button.addEventListener('click', () => setApiFlowView(button.dataset.apiFlowView)));
  document.querySelectorAll('[data-api-flow-rail]').forEach(button => button.addEventListener('click', () => setApiFlowRail(button.dataset.apiFlowRail)));
  for (const id of ['api-flow-name', 'api-flow-port', 'api-flow-host', 'api-flow-base-path', 'api-flow-cors', 'api-flow-method', 'api-flow-path', 'api-flow-endpoint-name', 'api-flow-endpoint-enabled']) {
    document.getElementById(id)?.addEventListener(['api-flow-port', 'api-flow-host', 'api-flow-cors', 'api-flow-method', 'api-flow-endpoint-enabled'].includes(id) ? 'change' : 'input', syncApiFlowForm);
  }
  api.apiFlow.onChanged?.(payload => {
    if (payload.type === 'request') { if (apiFlowState.view === 'logs') refreshApiFlowLogs(); refreshApiFlowRuntimeStatus(); }
    if (['started', 'stopped'].includes(payload.type) && apiFlowState.project?.id === payload.projectId) {
      apiFlowState.project.running = payload.type === 'started'; apiFlowState.project.url = payload.url || null; renderApiFlowToolbar(); renderApiFlowRuntime();
    }
  });
  apiFlowState.statusTimer = setInterval(() => {
    if (!document.getElementById('panel-test-lab')?.classList.contains('active') || document.getElementById('api-flow-mode')?.classList.contains('hidden')) return;
    refreshApiFlowRuntimeStatus();
  }, 1200);
}

function setTestLabMode(mode) {
  const apiMode = mode === 'api-flow';
  document.querySelectorAll('[data-lab-mode]').forEach(button => button.classList.toggle('active', button.dataset.labMode === mode));
  document.getElementById('lab-environment-mode')?.classList.toggle('hidden', apiMode);
  document.getElementById('api-flow-mode')?.classList.toggle('hidden', !apiMode);
  document.getElementById('lab-new')?.classList.toggle('hidden', apiMode);
  if (apiMode) { refreshApiFlows(); refreshApiFlowRuntimeStatus(); }
}

function setApiFlowRail(view) {
  apiFlowState.rail = view;
  document.querySelectorAll('[data-api-flow-rail]').forEach(button => button.classList.toggle('active', button.dataset.apiFlowRail === view));
  document.querySelectorAll('[data-api-flow-rail-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.apiFlowRailPane !== view));
  if (view === 'blocks') document.getElementById('api-flow-block-search')?.focus();
}

function toggleApiFlowInspector() {
  const studio = document.getElementById('api-flow-mode');
  if (window.innerWidth <= 1500) studio.classList.toggle('inspector-open');
  else studio.classList.toggle('inspector-collapsed');
  requestAnimationFrame(drawApiFlowConnections);
}

function closeApiFlowInspector() {
  const studio = document.getElementById('api-flow-mode'); studio.classList.remove('inspector-open'); studio.classList.add('inspector-collapsed'); requestAnimationFrame(drawApiFlowConnections);
}

function openApiFlowInspector() {
  const studio = document.getElementById('api-flow-mode'); studio.classList.remove('inspector-collapsed'); if (window.innerWidth <= 1500) studio.classList.add('inspector-open'); requestAnimationFrame(drawApiFlowConnections);
}

async function copyApiFlowUrl(value) {
  if (!value) return showToast('API nie ma jeszcze aktywnego adresu', 'warning');
  try { await navigator.clipboard.writeText(value); showToast('Adres API skopiowany', 'success'); } catch { showToast('Nie udało się skopiować adresu', 'error'); }
}

async function refreshApiFlows(force = false) {
  if (!api.apiFlow) return;
  try {
    if (!apiFlowState.catalog.length || force) {
      [apiFlowState.catalog, apiFlowState.connections] = await Promise.all([api.apiFlow.catalog(), api.db.connections().catch(() => [])]);
      renderApiFlowPalette();
    }
    apiFlowState.projects = await api.apiFlow.list();
    const currentId = apiFlowState.project?.id;
    const fresh = apiFlowState.projects.find(item => item.id === currentId);
    if (fresh && !apiFlowState.dirty) apiFlowState.project = structuredClone(fresh);
    else if (!apiFlowState.project) apiFlowState.project = structuredClone(apiFlowState.projects[0] || createApiFlowDraft());
    apiFlowState.endpointId = apiFlowState.project.endpoints?.some(item => item.id === apiFlowState.endpointId) ? apiFlowState.endpointId : apiFlowState.project.endpoints?.[0]?.id || '';
    renderApiFlowBuilder(); renderApiFlowRuntime();
  } catch (error) { showToast(`API Flow: ${error.message}`, 'error'); }
}

function newApiFlowProject() {
  if (apiFlowState.dirty && !confirm('Porzucić niezapisane zmiany aktualnego API?')) return;
  apiFlowState.project = createApiFlowDraft(); apiFlowState.endpointId = apiFlowState.project.endpoints[0].id; apiFlowState.selectedNodeId = ''; apiFlowState.pendingConnection = null; apiFlowState.dirty = true; renderApiFlowBuilder();
}

function loadApiFlowProject(id) {
  if (!id) return newApiFlowProject();
  if (apiFlowState.dirty && apiFlowState.project?.id !== id && !confirm('Porzucić niezapisane zmiany aktualnego API?')) { renderApiFlowToolbar(); return; }
  const project = apiFlowState.projects.find(item => item.id === id); if (!project) return;
  apiFlowState.project = structuredClone(project); apiFlowState.endpointId = project.endpoints?.[0]?.id || ''; apiFlowState.selectedNodeId = ''; apiFlowState.pendingConnection = null; apiFlowState.dirty = false; renderApiFlowBuilder();
}

function markApiFlowDirty() {
  apiFlowState.dirty = true;
  const state = document.getElementById('api-flow-dirty-state'); if (state) { state.textContent = '● Niezapisane zmiany'; state.classList.add('dirty'); }
}

function syncApiFlowForm() {
  const project = apiFlowState.project; const endpoint = selectedApiFlowEndpoint(); if (!project) return;
  project.name = document.getElementById('api-flow-name').value;
  project.port = Number(document.getElementById('api-flow-port').value);
  project.host = document.getElementById('api-flow-host').value;
  project.basePath = document.getElementById('api-flow-base-path').value;
  project.cors = document.getElementById('api-flow-cors').checked;
  if (endpoint) {
    endpoint.method = document.getElementById('api-flow-method').value; endpoint.path = document.getElementById('api-flow-path').value;
    endpoint.name = document.getElementById('api-flow-endpoint-name').value; endpoint.enabled = document.getElementById('api-flow-endpoint-enabled').checked;
  }
  markApiFlowDirty(); renderApiFlowEndpoints(); updateApiFlowTestUrl();
}

function renderApiFlowBuilder() {
  if (!apiFlowState.project) return;
  const endpointChanged = apiFlowState.lastRenderedEndpointId !== apiFlowState.endpointId;
  renderApiFlowToolbar(); renderApiFlowRuntime(); renderApiFlowEndpoints(); renderApiFlowCanvas(); renderApiFlowInspector(); updateApiFlowTestUrl();
  apiFlowState.lastRenderedEndpointId = apiFlowState.endpointId;
  if (endpointChanged) requestAnimationFrame(fitApiFlowCanvas);
}

function renderApiFlowToolbar() {
  const project = apiFlowState.project; if (!project) return;
  const select = document.getElementById('api-flow-project-select');
  select.innerHTML = '<option value="">＋ Nowy projekt API</option>' + apiFlowState.projects.map(item => `<option value="${escapeHtml(item.id)}">${item.running ? '● ' : ''}${escapeHtml(item.name)}</option>`).join(''); select.value = apiFlowState.projects.some(item => item.id === project.id) ? project.id : '';
  document.getElementById('api-flow-name').value = project.name || ''; document.getElementById('api-flow-port').value = project.port || 9393; document.getElementById('api-flow-host').value = project.host || '127.0.0.1'; document.getElementById('api-flow-base-path').value = project.basePath || '/api'; document.getElementById('api-flow-cors').checked = project.cors !== false;
  renderApiFlowToggle();
  document.getElementById('api-flow-delete').disabled = !apiFlowState.projects.some(item => item.id === project.id);
  const dirty = document.getElementById('api-flow-dirty-state'); dirty.textContent = apiFlowState.dirty ? '● Niezapisane zmiany' : project.running ? `● Działa · ${project.url || ''}` : '✓ Zapisano'; dirty.classList.toggle('dirty', apiFlowState.dirty); dirty.classList.toggle('running', Boolean(project.running));
}

function renderApiFlowToggle() {
  const project = apiFlowState.project; const toggle = document.getElementById('api-flow-toggle'); if (!project || !toggle) return;
  const busy = ['starting', 'stopping', 'testing'].includes(apiFlowState.operation);
  toggle.textContent = apiFlowState.operation === 'starting' ? '◌ Uruchamiam…' : apiFlowState.operation === 'stopping' ? '◌ Zatrzymuję…' : apiFlowState.operation === 'testing' ? '◌ Testuję…' : project.running ? '■ Zatrzymaj API' : '▶ Uruchom API';
  toggle.classList.toggle('btn-primary', !project.running && !busy); toggle.classList.toggle('api-flow-toggle-running', project.running && !busy); toggle.classList.toggle('api-flow-toggle-starting', busy); toggle.disabled = busy || (!apiFlowState.projects.some(item => item.id === project.id) && !apiFlowState.dirty);
}

function formatApiFlowUptime(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.floor(milliseconds / 1000); if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function renderApiFlowRuntime() {
  const project = apiFlowState.project; const bar = document.getElementById('api-flow-runtime'); if (!project || !bar) return;
  const state = apiFlowState.operation === 'starting' || apiFlowState.operation === 'testing' ? 'starting' : apiFlowState.operation === 'stopping' ? 'stopping' : apiFlowState.runtimeError ? 'error' : project.running ? 'running' : 'stopped';
  bar.dataset.state = state;
  const labels = { running: 'API działa', stopped: 'API zatrzymane', starting: apiFlowState.operation === 'testing' ? 'Przygotowuję test live…' : 'Uruchamiam API…', stopping: 'Zatrzymuję API…', error: 'Błąd runtime' };
  document.getElementById('api-flow-runtime-label').textContent = labels[state];
  const url = project.url || `http://${project.host === '0.0.0.0' ? '127.0.0.1' : project.host}:${project.port}${project.basePath || ''}`;
  document.getElementById('api-flow-runtime-url').textContent = project.running ? url : `Docelowo: ${url}`;
  document.getElementById('api-flow-runtime-uptime').textContent = project.running ? formatApiFlowUptime(project.runtime?.uptimeMs || 0) : '—';
  document.getElementById('api-flow-runtime-requests').textContent = String(project.runtime?.requestCount || 0);
  document.getElementById('api-flow-runtime-errors').textContent = String(project.runtime?.errorCount || 0);
  document.getElementById('api-flow-runtime-last').textContent = project.runtime?.lastStatus ? `${project.runtime.lastStatus} · ${project.runtime.lastDurationMs}ms` : '—';
  document.getElementById('api-flow-copy-url').disabled = !project.running; document.getElementById('api-flow-open-url').disabled = !project.running;
  const messages = {
    stopped: apiFlowState.dirty ? 'Masz niezapisane zmiany. Start zapisze projekt i uruchomi port.' : 'Serwer nie nasłuchuje. Klient REST może uruchomić go automatycznie.',
    starting: 'Trwa zapis, walidacja i otwieranie portu. Przycisk zmieni się po potwierdzeniu nasłuchiwania.',
    stopping: 'Kończę aktywne połączenia i zwalniam port.',
    error: apiFlowState.runtimeError || 'Nie udało się zmienić stanu API.'
  };
  const runningProjects = apiFlowState.projects.filter(item => item.running);
  const runningSummary = runningProjects.length ? `Aktywne API (${runningProjects.length}): ${runningProjects.map(item => item.name).join(', ')}.` : '';
  document.getElementById('api-flow-runtime-message').textContent = messages[state] || `${runningSummary} ${project.runtime?.lastRequestAt ? `Ostatnie żądanie ${new Date(project.runtime.lastRequestAt).toLocaleTimeString()}.` : 'Serwer nasłuchuje i jest gotowy do testów.'}`;
  renderApiFlowToggle();
}

async function refreshApiFlowRuntimeStatus() {
  const project = apiFlowState.project; if (!project || !apiFlowState.projects.some(item => item.id === project.id)) { renderApiFlowRuntime(); return; }
  try {
    const [status, allStatuses] = await Promise.all([api.apiFlow.status(project.id), api.apiFlow.status()]); if (apiFlowState.project?.id !== status.projectId) return;
    project.running = status.running; project.url = status.url; project.runtime = status.runtime;
    for (const currentStatus of allStatuses) { const stored = apiFlowState.projects.find(item => item.id === currentStatus.projectId); if (stored) { stored.running = currentStatus.running; stored.url = currentStatus.url; stored.runtime = currentStatus.runtime; } }
    const projectSelect = document.getElementById('api-flow-project-select');
    for (const option of projectSelect?.options || []) { const stored = apiFlowState.projects.find(item => item.id === option.value); if (stored) option.textContent = `${stored.running ? '● ' : ''}${stored.name}`; }
    if (apiFlowState.operation === 'idle') apiFlowState.runtimeError = '';
    renderApiFlowRuntime();
  } catch (error) { apiFlowState.runtimeError = error.message; renderApiFlowRuntime(); }
}

function renderApiFlowEndpoints() {
  const project = apiFlowState.project; const list = document.getElementById('api-flow-endpoint-list'); if (!project || !list) return;
  list.innerHTML = (project.endpoints || []).map(endpoint => `<button type="button" class="api-flow-endpoint ${endpoint.id === apiFlowState.endpointId ? 'active' : ''}" data-api-endpoint="${escapeHtml(endpoint.id)}"><span class="method ${endpoint.method.toLowerCase()}">${escapeHtml(endpoint.method)}</span><div><strong>${escapeHtml(endpoint.path)}</strong><small>${escapeHtml(endpoint.name)} · ${endpoint.nodes.length} bloków</small></div><i>${endpoint.enabled ? '●' : '○'}</i></button>`).join('') || '<div class="workspace-empty compact">Dodaj pierwszy endpoint.</div>';
  list.querySelectorAll('[data-api-endpoint]').forEach(button => button.addEventListener('click', () => { apiFlowState.endpointId = button.dataset.apiEndpoint; apiFlowState.selectedNodeId = ''; apiFlowState.pendingConnection = null; renderApiFlowBuilder(); setApiFlowRail('endpoints'); }));
  const endpoint = selectedApiFlowEndpoint();
  for (const id of ['api-flow-method', 'api-flow-path', 'api-flow-endpoint-name', 'api-flow-endpoint-enabled', 'api-flow-remove-endpoint']) document.getElementById(id).disabled = !endpoint;
  if (endpoint) { document.getElementById('api-flow-method').value = endpoint.method; document.getElementById('api-flow-path').value = endpoint.path; document.getElementById('api-flow-endpoint-name').value = endpoint.name; document.getElementById('api-flow-endpoint-enabled').checked = endpoint.enabled !== false; }
}

function addApiFlowEndpoint() {
  const project = apiFlowState.project; if (!project) return;
  const endpoint = defaultApiFlowEndpoint(project.endpoints.length + 1); project.endpoints.push(endpoint); apiFlowState.endpointId = endpoint.id; apiFlowState.selectedNodeId = ''; markApiFlowDirty(); renderApiFlowBuilder();
}

function removeApiFlowEndpoint() {
  const project = apiFlowState.project; const endpoint = selectedApiFlowEndpoint(); if (!project || !endpoint || !confirm(`Usunąć endpoint ${endpoint.method} ${endpoint.path}?`)) return;
  project.endpoints = project.endpoints.filter(item => item.id !== endpoint.id); apiFlowState.endpointId = project.endpoints[0]?.id || ''; apiFlowState.selectedNodeId = ''; markApiFlowDirty(); renderApiFlowBuilder();
}

function renderApiFlowPalette() {
  const palette = document.getElementById('api-flow-block-palette'); if (!palette) return;
  const filter = document.getElementById('api-flow-block-search')?.value.trim().toLowerCase() || '';
  const grouped = new Map();
  for (const block of apiFlowState.catalog.filter(item => !filter || `${item.name} ${item.description} ${item.group}`.toLowerCase().includes(filter))) {
    if (!grouped.has(block.group)) grouped.set(block.group, []); grouped.get(block.group).push(block);
  }
  palette.innerHTML = [...grouped].map(([group, blocks]) => `<section><strong>${escapeHtml(group)}</strong>${blocks.map(block => `<button type="button" data-api-block="${escapeHtml(block.type)}"><i class="${escapeHtml(block.color)}">${escapeHtml(block.icon)}</i><span><b>${escapeHtml(block.name)}</b><small>${escapeHtml(block.description)}</small></span></button>`).join('')}</section>`).join('') || '<div class="workspace-empty compact">Brak bloków.</div>';
  palette.querySelectorAll('[data-api-block]').forEach(button => button.addEventListener('click', () => addApiFlowNode(button.dataset.apiBlock)));
}

function apiFlowDefaultConfig(block) {
  return Object.fromEntries((block.fields || []).filter(item => item.default !== undefined).map(item => {
    let value = item.default;
    if (item.type === 'json' && typeof value === 'string') { try { value = JSON.parse(value); } catch {} }
    return [item.key, value];
  }));
}

function addApiFlowNode(type) {
  const endpoint = selectedApiFlowEndpoint(); const block = apiFlowState.catalog.find(item => item.type === type); if (!endpoint || !block) return;
  if (type === 'input' && endpoint.nodes.some(node => node.type === 'input')) return showToast('Endpoint może mieć tylko jeden Input', 'error');
  const id = apiFlowId(type); const selected = selectedApiFlowNode();
  const node = { id, type, name: block.name, x: selected ? Math.min(1350, selected.x + 260) : 180 + endpoint.nodes.length * 35, y: selected ? selected.y + 35 : 100 + endpoint.nodes.length * 70, config: apiFlowDefaultConfig(block), next: null, nextTrue: null, nextFalse: null, nextError: null };
  if (selected && selected.type !== 'output' && !['condition', 'switch'].includes(selected.type)) {
    const previousNext = selected.next;
    if (type === 'condition') { node.nextTrue = previousNext; node.nextFalse = previousNext; }
    else if (type === 'cache' && node.config.mode === 'get') { node.nextTrue = previousNext; node.nextFalse = previousNext; }
    else if (type === 'switch') node.nextFalse = previousNext;
    else node.next = previousNext;
    selected.next = node.id;
  }
  endpoint.nodes.push(node); apiFlowState.selectedNodeId = id; markApiFlowDirty(); renderApiFlowCanvas(); renderApiFlowInspector(); openApiFlowInspector();
}

function apiFlowPorts(node) {
  if (node.type === 'output') return [];
  if (node.type === 'condition') return [{ key: 'nextTrue', label: 'TAK', tone: 'true' }, { key: 'nextFalse', label: 'NIE', tone: 'false' }, { key: 'nextError', label: 'ERR', tone: 'error' }];
  if (node.type === 'cache' && node.config.mode === 'get') return [{ key: 'nextTrue', label: 'HIT', tone: 'true' }, { key: 'nextFalse', label: 'MISS', tone: 'false' }, { key: 'nextError', label: 'ERR', tone: 'error' }];
  if (node.type === 'switch') {
    const cases = Array.isArray(node.config.cases) ? node.config.cases : [];
    return [...cases.map((item, index) => ({ key: `case:${index}`, label: String(item.value ?? index).slice(0, 8), tone: 'true' })), { key: 'nextFalse', label: 'DOMYŚLNE', tone: 'false' }, { key: 'nextError', label: 'ERR', tone: 'error' }];
  }
  return [{ key: 'next', label: 'DALEJ', tone: 'normal' }, ...(node.type === 'input' ? [] : [{ key: 'nextError', label: 'ERR', tone: 'error' }])];
}

function getApiFlowNodeLink(node, key) { return key.startsWith('case:') ? node.config.cases?.[Number(key.slice(5))]?.next || null : node[key] || null; }
function setApiFlowNodeLink(node, key, value) { if (key.startsWith('case:')) { const item = node.config.cases?.[Number(key.slice(5))]; if (item) item.next = value; } else node[key] = value; }

function summarizeApiFlowNode(node) {
  const c = node.config || {};
  if (node.type === 'database-query') return `${c.connectionId || 'wybierz bazę'} · ${String(c.query || 'SQL / Mongo').split(/\r?\n/)[0]}`;
  if (node.type === 'http-request' || node.type === 'webhook') return `${c.method || (node.type === 'webhook' ? 'POST' : 'GET')} ${c.url || 'URL'}`;
  if (node.type === 'condition') return `${c.left || '{last}'} ${c.operator || '='} ${c.right ?? ''}`;
  if (node.type === 'output') return `HTTP ${c.status || 200}`;
  if (node.type === 'set-variable') return `${c.name || 'var'} = ${typeof c.value === 'string' ? c.value : JSON.stringify(c.value)}`;
  if (node.type === 'auth') return `${c.mode || 'bearer'} · ${c.hasSecret ? 'sekret zapisany' : 'ustaw sekret'}`;
  const first = Object.values(c).find(value => typeof value === 'string' && value); return first || apiFlowState.catalog.find(item => item.type === node.type)?.description || node.type;
}

function renderApiFlowCanvas() {
  const endpoint = selectedApiFlowEndpoint(); const container = document.getElementById('api-flow-nodes'); if (!container) return;
  if (!endpoint) { container.innerHTML = '<div class="workspace-empty">Dodaj endpoint, aby rozpocząć.</div>'; drawApiFlowConnections(); return; }
  container.innerHTML = endpoint.nodes.map(node => {
    const block = apiFlowState.catalog.find(item => item.type === node.type) || { icon: '?', color: 'gray' };
    const ports = apiFlowPorts(node);
    return `<article class="api-flow-node color-${escapeHtml(block.color)} ${node.id === apiFlowState.selectedNodeId ? 'selected' : ''}" data-api-node="${escapeHtml(node.id)}" style="left:${node.x}px;top:${node.y}px"><header><i>${escapeHtml(block.icon)}</i><strong>${escapeHtml(node.name)}</strong><button type="button" data-remove-api-node title="Usuń blok">×</button></header><div><small>${escapeHtml(node.type)}</small><p title="${escapeHtml(summarizeApiFlowNode(node))}">${escapeHtml(summarizeApiFlowNode(node))}</p></div>${node.type === 'input' ? '' : '<button class="api-flow-port input" type="button" data-api-input title="Połącz tutaj"></button>'}<div class="api-flow-node-ports">${ports.map(port => `<label class="${port.tone}"><span>${port.label}</span><button class="api-flow-port output ${apiFlowState.pendingConnection?.nodeId === node.id && apiFlowState.pendingConnection?.key === port.key ? 'pending' : ''}" type="button" data-api-output="${port.key}" title="Kliknij, aby połączyć; prawy przycisk rozłącza"></button></label>`).join('')}</div></article>`;
  }).join('');
  container.querySelectorAll('[data-api-node]').forEach(element => bindApiFlowNode(element));
  requestAnimationFrame(drawApiFlowConnections);
}

function bindApiFlowNode(element) {
  const nodeId = element.dataset.apiNode;
  element.addEventListener('click', event => { if (!event.target.closest('.api-flow-port,[data-remove-api-node]')) { apiFlowState.selectedNodeId = nodeId; renderApiFlowCanvas(); renderApiFlowInspector(); openApiFlowInspector(); } });
  element.querySelector('[data-remove-api-node]')?.addEventListener('click', () => removeApiFlowNode(nodeId));
  element.querySelector('[data-api-input]')?.addEventListener('click', () => completeApiFlowConnection(nodeId));
  element.querySelectorAll('[data-api-output]').forEach(port => {
    port.addEventListener('click', event => { event.stopPropagation(); apiFlowState.pendingConnection = { nodeId, key: port.dataset.apiOutput }; renderApiFlowCanvas(); document.getElementById('api-flow-canvas-help').textContent = 'Teraz kliknij wejście bloku docelowego. Esc anuluje połączenie.'; });
    port.addEventListener('contextmenu', event => { event.preventDefault(); const node = selectedApiFlowEndpoint().nodes.find(item => item.id === nodeId); setApiFlowNodeLink(node, port.dataset.apiOutput, null); markApiFlowDirty(); renderApiFlowCanvas(); renderApiFlowInspector(); });
  });
  const header = element.querySelector('header'); let drag = null;
  header.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return; const node = selectedApiFlowEndpoint().nodes.find(item => item.id === nodeId); drag = { x: event.clientX, y: event.clientY, left: node.x, top: node.y, node }; header.setPointerCapture(event.pointerId); element.classList.add('dragging');
  });
  header.addEventListener('pointermove', event => { if (!drag) return; drag.node.x = Math.max(10, Math.min(1450, drag.left + event.clientX - drag.x)); drag.node.y = Math.max(10, Math.min(900, drag.top + event.clientY - drag.y)); element.style.left = `${drag.node.x}px`; element.style.top = `${drag.node.y}px`; drawApiFlowConnections(); });
  header.addEventListener('pointerup', () => { if (!drag) return; drag = null; element.classList.remove('dragging'); markApiFlowDirty(); });
}

function completeApiFlowConnection(targetId) {
  const pending = apiFlowState.pendingConnection; if (!pending || pending.nodeId === targetId) return;
  const endpoint = selectedApiFlowEndpoint(); const node = endpoint.nodes.find(item => item.id === pending.nodeId); if (!node) return;
  setApiFlowNodeLink(node, pending.key, targetId); apiFlowState.pendingConnection = null; markApiFlowDirty(); document.getElementById('api-flow-canvas-help').textContent = 'Połączenie utworzone. Prawy przycisk na porcie wyjścia usuwa przewód.'; renderApiFlowCanvas(); renderApiFlowInspector();
}

function removeApiFlowNode(nodeId) {
  const endpoint = selectedApiFlowEndpoint(); const node = endpoint?.nodes.find(item => item.id === nodeId); if (!node) return;
  if (node.type === 'input') return showToast('Input jest wymagany. Usuń cały endpoint albo dodaj inny Input przed usunięciem.', 'error');
  endpoint.nodes = endpoint.nodes.filter(item => item.id !== nodeId);
  for (const item of endpoint.nodes) {
    for (const key of ['next', 'nextTrue', 'nextFalse', 'nextError']) if (item[key] === nodeId) item[key] = node.next || null;
    if (item.type === 'switch' && Array.isArray(item.config.cases)) for (const entry of item.config.cases) if (entry.next === nodeId) entry.next = node.next || null;
  }
  apiFlowState.selectedNodeId = ''; markApiFlowDirty(); renderApiFlowCanvas(); renderApiFlowInspector();
}

function drawApiFlowConnections() {
  const endpoint = selectedApiFlowEndpoint(); const canvas = document.getElementById('api-flow-canvas'); const svg = document.getElementById('api-flow-svg'); if (!svg || !canvas) return;
  svg.querySelectorAll('.api-flow-wire').forEach(path => path.remove()); if (!endpoint) return;
  const canvasRect = canvas.getBoundingClientRect();
  for (const node of endpoint.nodes) for (const port of apiFlowPorts(node)) {
    const targetId = getApiFlowNodeLink(node, port.key); if (!targetId) continue;
    const from = document.querySelector(`[data-api-node="${CSS.escape(node.id)}"] [data-api-output="${CSS.escape(port.key)}"]`); const to = document.querySelector(`[data-api-node="${CSS.escape(targetId)}"] [data-api-input]`); if (!from || !to) continue;
    const fromRect = from.getBoundingClientRect(); const toRect = to.getBoundingClientRect(); const x1 = fromRect.left - canvasRect.left + canvas.scrollLeft + fromRect.width / 2; const y1 = fromRect.top - canvasRect.top + canvas.scrollTop + fromRect.height / 2; const x2 = toRect.left - canvasRect.left + canvas.scrollLeft + toRect.width / 2; const y2 = toRect.top - canvasRect.top + canvas.scrollTop + toRect.height / 2; const bend = Math.max(65, Math.abs(x2 - x1) * .45);
    const wire = document.createElementNS('http://www.w3.org/2000/svg', 'path'); wire.setAttribute('class', `api-flow-wire ${port.tone}`); wire.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); wire.setAttribute('marker-end', 'url(#api-flow-arrow)'); svg.appendChild(wire);
  }
}

function renderApiFlowInspector() {
  const node = selectedApiFlowNode(); const inspector = document.getElementById('api-flow-inspector'); const help = document.getElementById('api-flow-inspector-help'); if (!inspector) return;
  if (!node) { help.textContent = 'Wybierz blok na diagramie'; inspector.innerHTML = '<div class="workspace-empty compact">Kliknij blok, aby edytować wszystkie jego ustawienia i połączenia.</div>'; return; }
  const definition = apiFlowState.catalog.find(item => item.type === node.type); help.textContent = definition?.description || node.type;
  const fields = (definition?.fields || []).map(item => renderApiFlowInspectorField(node, item)).join('');
  const connections = apiFlowPorts(node).map(port => { const target = getApiFlowNodeLink(node, port.key); return `<div class="api-flow-link-row"><span>${escapeHtml(port.label)}</span><code>${target ? escapeHtml(selectedApiFlowEndpoint().nodes.find(item => item.id === target)?.name || target) : 'niepodłączone'}</code>${target ? `<button type="button" data-disconnect="${port.key}">×</button>` : ''}</div>`; }).join('');
  inspector.innerHTML = `<div class="form-group"><label>Nazwa bloku</label><input type="text" data-api-node-name maxlength="100" value="${escapeHtml(node.name)}"></div>${fields}<details class="api-flow-connections" open><summary>Połączenia wyjściowe</summary>${connections || '<p class="form-help">To jest blok końcowy.</p>'}</details><div class="api-flow-placeholder-help"><strong>Placeholdery</strong><code>{body.email}</code><code>{query.page}</code><code>{params.id}</code><code>{var.name}</code><code>{last}</code><code>{steps.block-id}</code></div>`;
  inspector.querySelector('[data-api-node-name]')?.addEventListener('input', event => { node.name = event.target.value; markApiFlowDirty(); document.querySelector(`[data-api-node="${CSS.escape(node.id)}"] header strong`).textContent = node.name; });
  inspector.querySelectorAll('[data-api-field]').forEach(control => {
    const apply = () => updateApiFlowNodeField(node, control);
    control.addEventListener(control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input', apply);
  });
  inspector.querySelectorAll('[data-disconnect]').forEach(button => button.addEventListener('click', () => { setApiFlowNodeLink(node, button.dataset.disconnect, null); markApiFlowDirty(); renderApiFlowCanvas(); renderApiFlowInspector(); }));
}

function renderApiFlowInspectorField(node, item) {
  const value = node.config?.[item.key]; const id = `api-field-${node.id}-${item.key}`; const help = item.help ? `<small class="form-help">${escapeHtml(item.help)}</small>` : '';
  if (item.type === 'checkbox') return `<div class="form-group form-group-toggle"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><label class="toggle-switch small"><input id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}" type="checkbox" ${value ? 'checked' : ''}><span class="toggle-slider"></span></label></div>`;
  if (item.type === 'select') return `<div class="form-group"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><select id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}">${(item.options || []).map(option => `<option value="${escapeHtml(option)}" ${String(value ?? item.default) === String(option) ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>${help}</div>`;
  if (item.type === 'database') return `<div class="form-group"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><select id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}"><option value="">Wybierz połączenie…</option>${apiFlowState.connections.map(connection => `<option value="${escapeHtml(connection.id)}" ${value === connection.id ? 'selected' : ''}>${connection.online ? '●' : '○'} ${escapeHtml(connection.name)} (${escapeHtml(connection.type)})</option>`).join('')}</select></div>`;
  if (item.type === 'secret') return `<div class="form-group"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><input id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}" data-secret-field type="password" autocomplete="new-password" placeholder="${node.config?.hasSecret ? 'Sekret zapisany — puste zachowuje' : 'Wpisz sekret'}">${help}</div>`;
  if (item.type === 'code' || item.type === 'json') { const output = typeof value === 'string' ? value : JSON.stringify(value ?? (item.type === 'json' ? {} : ''), null, 2); return `<div class="form-group"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><textarea id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}" data-field-type="${item.type}" class="code-textarea" rows="${item.type === 'code' ? 6 : 4}" spellcheck="false" placeholder="${escapeHtml(item.placeholder || '')}">${escapeHtml(output)}</textarea>${help}</div>`; }
  return `<div class="form-group"><label for="${escapeHtml(id)}">${escapeHtml(item.label)}</label><input id="${escapeHtml(id)}" data-api-field="${escapeHtml(item.key)}" type="${item.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value ?? item.default ?? '')}" placeholder="${escapeHtml(item.placeholder || '')}" ${item.min != null ? `min="${item.min}"` : ''} ${item.max != null ? `max="${item.max}"` : ''}>${help}</div>`;
}

function updateApiFlowNodeField(node, control) {
  const key = control.dataset.apiField; let value;
  if (control.type === 'checkbox') value = control.checked;
  else if (control.type === 'number') value = Number(control.value);
  else if (control.dataset.secretField !== undefined) { if (!control.value) return; value = control.value; }
  else if (control.dataset.fieldType === 'json') { try { value = JSON.parse(control.value || '{}'); control.classList.remove('invalid'); } catch { value = control.value; control.classList.add('invalid'); } }
  else if (control.dataset.fieldType === 'code') { const raw = control.value; try { value = JSON.parse(raw); control.classList.remove('invalid'); } catch { value = raw; } }
  else value = control.value;
  node.config[key] = value; markApiFlowDirty();
  if ((key === 'mode' && node.type === 'cache') || (key === 'cases' && node.type === 'switch')) { renderApiFlowCanvas(); renderApiFlowInspector(); } else {
    const summary = document.querySelector(`[data-api-node="${CSS.escape(node.id)}"] div p`); if (summary) summary.textContent = summarizeApiFlowNode(node);
  }
}

function autoLayoutApiFlow() {
  const endpoint = selectedApiFlowEndpoint(); if (!endpoint) return;
  const input = endpoint.nodes.find(node => node.type === 'input'); const depths = new Map(); const queue = input ? [{ id: input.id, depth: 0 }] : [];
  while (queue.length) { const current = queue.shift(); if ((depths.get(current.id) ?? Infinity) <= current.depth) continue; depths.set(current.id, current.depth); const node = endpoint.nodes.find(item => item.id === current.id); for (const port of apiFlowPorts(node)) { const target = getApiFlowNodeLink(node, port.key); if (target) queue.push({ id: target, depth: current.depth + 1 }); } }
  const columns = new Map(); endpoint.nodes.forEach(node => { const depth = depths.get(node.id) ?? Math.max(0, ...depths.values()) + 1; if (!columns.has(depth)) columns.set(depth, []); columns.get(depth).push(node); });
  for (const [depth, nodes] of columns) nodes.forEach((node, index) => { node.x = 60 + depth * 285; node.y = 60 + index * 180; });
  markApiFlowDirty(); renderApiFlowCanvas(); requestAnimationFrame(fitApiFlowCanvas);
}

function fitApiFlowCanvas() {
  const endpoint = selectedApiFlowEndpoint(); const canvas = document.getElementById('api-flow-canvas'); if (!endpoint?.nodes?.length || !canvas) return;
  const left = Math.max(0, Math.min(...endpoint.nodes.map(node => node.x)) - 35);
  const top = Math.max(0, Math.min(...endpoint.nodes.map(node => node.y)) - 35);
  canvas.scrollTo({ left, top, behavior: 'smooth' });
  requestAnimationFrame(drawApiFlowConnections);
}

async function validateApiFlow(showMessage = false) {
  syncApiFlowForm(); const result = await api.apiFlow.validate(apiFlowState.project); const target = document.getElementById('api-flow-validation');
  const errorText = result.errors?.join(' · '); const warningText = result.warnings?.join(' · ');
  target.innerHTML = result.valid ? `<span class="ok">✓</span><div><strong>Graf jest poprawny</strong><small>${escapeHtml(warningText || `${apiFlowState.project.endpoints.length} endpointów gotowych do uruchomienia`)}</small></div>` : `<span class="error">!</span><div><strong>${result.errors.length} problemów w grafie</strong><small>${escapeHtml(errorText)}</small></div>`;
  if (showMessage) showToast(result.valid ? (warningText || 'API Flow jest poprawny') : errorText, result.valid ? (warningText ? 'warning' : 'success') : 'error');
  return result;
}

async function saveApiFlowProject(silent = false) {
  syncApiFlowForm(); const validation = await validateApiFlow(false); if (!validation.valid) { if (!silent) showToast(validation.errors.join(' · '), 'error'); return null; }
  try {
    const result = await api.apiFlow.save(apiFlowState.project); apiFlowState.project = structuredClone(result.project); apiFlowState.projects = await api.apiFlow.list(); apiFlowState.endpointId = apiFlowState.project.endpoints.find(item => item.id === apiFlowState.endpointId)?.id || apiFlowState.project.endpoints[0]?.id || ''; apiFlowState.dirty = false; renderApiFlowBuilder(); if (!silent) showToast(result.warnings?.length ? `Zapisano z ostrzeżeniami: ${result.warnings.join(' · ')}` : 'API Flow zapisany', result.warnings?.length ? 'warning' : 'success'); return result.project;
  } catch (error) { showToast(error.message, 'error'); return null; }
}

async function saveAndRestartApiFlow() {
  const wasRunning = Boolean(apiFlowState.project?.running); apiFlowState.runtimeError = '';
  try {
    const validation = await validateApiFlow(false); if (!validation.valid) { showToast(validation.errors.join(' · '), 'error'); return; }
    if (wasRunning) {
      apiFlowState.operation = 'stopping'; renderApiFlowRuntime();
      await api.apiFlow.stop(apiFlowState.project.id); apiFlowState.project.running = false; apiFlowState.project.url = null;
    }
    apiFlowState.operation = wasRunning ? 'starting' : 'idle'; renderApiFlowRuntime();
    const saved = await saveApiFlowProject(false); if (!saved) return;
    if (wasRunning) {
      await api.apiFlow.start(saved.id); apiFlowState.project = structuredClone(await api.apiFlow.get(saved.id));
      showToast(`Zmiany zapisane, API zrestartowane: ${apiFlowState.project.url}`, 'success');
    }
  } catch (error) {
    apiFlowState.runtimeError = error.message;
    if (wasRunning && !apiFlowState.project.running) { try { await api.apiFlow.start(apiFlowState.project.id); } catch {} }
    showToast(error.message, 'error');
  }
  finally { apiFlowState.operation = 'idle'; await refreshApiFlowRuntimeStatus(); renderApiFlowBuilder(); }
}

async function toggleApiFlowServer() {
  let project = apiFlowState.project; if (!project || apiFlowState.operation !== 'idle') return;
  apiFlowState.runtimeError = ''; apiFlowState.operation = project.running ? 'stopping' : 'starting'; renderApiFlowRuntime();
  try {
    if (project.running) await api.apiFlow.stop(project.id);
    else { if (apiFlowState.dirty || !apiFlowState.projects.some(item => item.id === project.id)) project = await saveApiFlowProject(true); if (!project) return; await api.apiFlow.start(project.id); }
    const fresh = await api.apiFlow.get(project.id); apiFlowState.project = structuredClone(fresh); apiFlowState.projects = await api.apiFlow.list(); renderApiFlowBuilder(); showToast(fresh.running ? `API działa: ${fresh.url}` : 'API zatrzymane', 'success');
  } catch (error) { apiFlowState.runtimeError = error.message; showToast(error.message, 'error'); }
  finally { apiFlowState.operation = 'idle'; await refreshApiFlowRuntimeStatus(); renderApiFlowBuilder(); }
}

async function deleteApiFlowProject() {
  const project = apiFlowState.project; if (!project || !apiFlowState.projects.some(item => item.id === project.id) || !confirm(`Usunąć projekt API „${project.name}”, jego logi i sekrety?`)) return;
  try { await api.apiFlow.remove(project.id); apiFlowState.project = null; apiFlowState.dirty = false; await refreshApiFlows(true); showToast('Projekt API usunięty', 'success'); } catch (error) { showToast(error.message, 'error'); }
}

function setApiFlowView(view) {
  apiFlowState.view = view; document.querySelectorAll('[data-api-flow-view]').forEach(button => button.classList.toggle('active', button.dataset.apiFlowView === view)); document.querySelectorAll('[data-api-flow-pane]').forEach(pane => pane.classList.toggle('hidden', pane.dataset.apiFlowPane !== view)); if (view === 'logs') refreshApiFlowLogs(); if (view === 'editor') requestAnimationFrame(drawApiFlowConnections);
}

function updateApiFlowTestUrl() {
  const project = apiFlowState.project; const endpoint = selectedApiFlowEndpoint(); if (!project || !endpoint) return;
  document.getElementById('api-flow-test-method').textContent = endpoint.method; document.getElementById('api-flow-test-url').value = `http://${project.host === '0.0.0.0' ? '127.0.0.1' : project.host}:${project.port}${project.basePath || ''}${endpoint.path}`;
}

function parseApiFlowTesterValue(id, fallback) {
  const value = document.getElementById(id).value.trim(); if (!value) return fallback;
  try { return JSON.parse(value); } catch { if (id === 'api-flow-test-body') return value; throw new Error(`${document.querySelector(`label[for="${id}"]`)?.textContent || id}: niepoprawny JSON`); }
}

async function sendApiFlowTest() {
  const endpoint = selectedApiFlowEndpoint(); if (!endpoint || apiFlowState.operation !== 'idle') return;
  const button = document.getElementById('api-flow-send-test'); const autoStart = document.getElementById('api-flow-test-autostart').checked;
  let request;
  const originalText = button.textContent; button.disabled = true; button.textContent = '◌ Przygotowuję…'; apiFlowState.operation = 'testing'; apiFlowState.runtimeError = ''; renderApiFlowRuntime();
  try {
    request = { query: parseApiFlowTesterValue('api-flow-test-query', {}), headers: parseApiFlowTesterValue('api-flow-test-headers', {}), params: parseApiFlowTesterValue('api-flow-test-params', {}), body: parseApiFlowTesterValue('api-flow-test-body', {}) };
    let project = apiFlowState.project;
    if (apiFlowState.dirty || !apiFlowState.projects.some(item => item.id === project.id)) {
      if (project.running) { button.textContent = '◌ Restartuję API…'; await api.apiFlow.stop(project.id); project.running = false; project.url = null; }
      button.textContent = '◌ Zapisuję flow…'; project = await saveApiFlowProject(true); if (!project) return;
    }
    if (autoStart && !project.running) {
      button.textContent = '◌ Uruchamiam port…'; await api.apiFlow.start(project.id); project = await api.apiFlow.get(project.id); apiFlowState.project = structuredClone(project);
    }
    button.textContent = project.running ? '◌ Wysyłam HTTP…' : '◌ Symuluję…';
    const result = project.running ? await api.apiFlow.request(project.id, endpoint.id, request) : await api.apiFlow.test(project.id, endpoint.id, request);
    const mode = document.getElementById('api-flow-client-mode'); mode.textContent = result.live ? 'LIVE HTTP' : 'PREVIEW'; mode.classList.toggle('offline', !result.live);
    const status = document.getElementById('api-flow-test-status'); status.textContent = `${result.live ? 'LIVE · ' : 'PREVIEW · '}HTTP ${result.status} · ${result.durationMs} ms`; status.className = result.success ? 'success' : 'error'; document.getElementById('api-flow-test-result').textContent = JSON.stringify(result.body !== undefined ? result.body : { error: result.error }, null, 2);
    document.getElementById('api-flow-test-trace').innerHTML = (result.trace || []).map((step, index) => `<div class="${step.success ? 'success' : 'error'}"><span>${index + 1}</span><div><strong>${escapeHtml(step.name)} <small>${escapeHtml(step.type)}</small></strong><p>${step.success ? escapeHtml(JSON.stringify(step.output)) : escapeHtml(step.error)}</p></div><time>${step.durationMs} ms</time></div>`).join('');
    if (!result.success) showToast(result.live ? `Live HTTP ${result.status} · ${result.durationMs} ms` : `Preview HTTP ${result.status}`, 'error');
  } catch (error) { apiFlowState.runtimeError = error.message; document.getElementById('api-flow-test-status').textContent = `Błąd · ${error.message}`; document.getElementById('api-flow-test-status').className = 'error'; showToast(error.message, 'error'); }
  finally { apiFlowState.operation = 'idle'; button.disabled = false; button.textContent = originalText; await refreshApiFlowRuntimeStatus(); renderApiFlowRuntime(); }
}

async function refreshApiFlowLogs() {
  const list = document.getElementById('api-flow-log-list'); if (!list || !apiFlowState.project) return;
  try { const logs = await api.apiFlow.logs(apiFlowState.project.id, 200); list.innerHTML = logs.map(log => `<div class="api-flow-log ${log.success ? 'success' : 'error'}"><time>${escapeHtml(new Date(log.at).toLocaleString())}</time><span class="method ${String(log.method).toLowerCase()}">${escapeHtml(log.method)}</span><code>${escapeHtml(log.path)}</code><b>HTTP ${log.status}</b><small>${log.durationMs} ms · ${escapeHtml(log.source)}</small>${log.error ? `<p>${escapeHtml(log.error)}</p>` : ''}</div>`).join('') || '<div class="workspace-empty">Brak żądań. Uruchom test albo serwer API.</div>'; } catch (error) { list.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`; }
}

async function clearApiFlowLogs() { if (!apiFlowState.project || !confirm('Wyczyścić logi tego projektu API?')) return; await api.apiFlow.clearLogs(apiFlowState.project.id); await refreshApiFlowLogs(); }

const databaseManagerState = {
  connections: [], selectedId: null, connection: null, passwords: new Map(),
  objects: null, selectedObject: null, objectMetadata: null,
  dataOffset: 0, dataHasMore: false, lastResult: null,
  editorTabs: [{ id: 'sql-1', title: 'SQL 1', query: '', result: null }], activeTabId: 'sql-1',
  history: [], savedQueries: [], activeQueryId: null
};

function initDatabaseManager() {
  if (!document.getElementById('panel-database-manager')) return;
  try { databaseManagerState.history = JSON.parse(localStorage.getItem('kitsune-db-query-history') || '[]'); } catch {}
  Promise.all([api.db.queryHistory?.(100) || [], api.db.savedQueries?.() || []]).then(([history, saved]) => {
    if (Array.isArray(history)) databaseManagerState.history = history;
    if (Array.isArray(saved)) databaseManagerState.savedQueries = saved;
  }).catch(() => {});
  const type = document.getElementById('dbm-type');
  type?.addEventListener('change', () => {
    const defaults = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 };
    document.getElementById('dbm-port').value = defaults[type.value];
    updateDatabaseQueryPlaceholder(type.value);
  });
  document.getElementById('dbm-refresh-connections')?.addEventListener('click', refreshDatabaseConnections);
  document.getElementById('dbm-new-connection')?.addEventListener('click', () => selectDatabaseConnection(null));
  document.getElementById('dbm-connection-filter')?.addEventListener('input', renderDatabaseConnections);
  document.getElementById('dbm-object-filter')?.addEventListener('input', renderDatabaseObjectTree);
  document.getElementById('dbm-refresh-objects')?.addEventListener('click', refreshDatabaseManagerObjects);
  document.getElementById('dbm-save')?.addEventListener('click', saveDatabaseConnection);
  document.getElementById('dbm-remove')?.addEventListener('click', removeDatabaseConnection);
  document.getElementById('dbm-test')?.addEventListener('click', testDatabaseConnection);
  document.getElementById('dbm-connect')?.addEventListener('click', connectDatabaseManager);
  document.getElementById('dbm-refresh-databases')?.addEventListener('click', connectDatabaseManager);
  document.getElementById('dbm-database')?.addEventListener('change', databaseManagerDatabaseChanged);
  document.getElementById('dbm-create-database')?.addEventListener('click', createDatabaseManagerDatabase);
  document.getElementById('dbm-drop-database')?.addEventListener('click', dropDatabaseManagerDatabase);
  document.getElementById('dbm-run-query')?.addEventListener('click', () => runDatabaseManagerQuery(false));
  document.getElementById('dbm-explain-query')?.addEventListener('click', () => runDatabaseManagerQuery(true));
  document.getElementById('dbm-cancel-query')?.addEventListener('click', cancelDatabaseManagerQuery);
  document.getElementById('dbm-format-query')?.addEventListener('click', formatDatabaseManagerQuery);
  document.getElementById('dbm-query-history')?.addEventListener('click', toggleDatabaseManagerHistory);
  document.getElementById('dbm-saved-queries')?.addEventListener('click', toggleDatabaseSavedQueries);
  document.getElementById('dbm-save-query')?.addEventListener('click', saveCurrentDatabaseQuery);
  document.getElementById('dbm-result-filter')?.addEventListener('input', () => renderDatabaseManagerResult(databaseManagerState.lastResult, 'dbm-result', false));
  document.getElementById('dbm-copy-result')?.addEventListener('click', copyDatabaseManagerResult);
  document.getElementById('dbm-export-result')?.addEventListener('click', exportDatabaseManagerResult);
  document.getElementById('dbm-data-prev')?.addEventListener('click', () => pageDatabaseManagerData(-1));
  document.getElementById('dbm-data-next')?.addEventListener('click', () => pageDatabaseManagerData(1));
  document.getElementById('dbm-data-refresh')?.addEventListener('click', loadDatabaseManagerData);
  document.getElementById('dbm-page-size')?.addEventListener('change', () => { databaseManagerState.dataOffset = 0; loadDatabaseManagerData(); });
  document.querySelectorAll('.dbm-workbench-tabs [data-dbm-pane]').forEach(button => button.addEventListener('click', () => switchDatabaseManagerPane(button.dataset.dbmPane)));
  document.getElementById('dbm-create-backup')?.addEventListener('click', createDatabaseManagerBackup);
  document.getElementById('dbm-refresh-backups')?.addEventListener('click', refreshDatabaseManagerBackups);
  document.getElementById('dbm-save-backup-schedule')?.addEventListener('click', saveDatabaseBackupSchedule);
  document.getElementById('dbm-query')?.addEventListener('input', persistActiveDatabaseSqlTab);
  document.getElementById('dbm-query')?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runDatabaseManagerQuery();
    }
  });
  renderDatabaseSqlTabs();
  refreshDatabaseConnections();
}

function databaseConnectionFromForm() {
  const selected = databaseManagerState.connections.find(item => item.id === databaseManagerState.selectedId);
  return {
    id: selected?.detected ? undefined : (databaseManagerState.selectedId || undefined),
    name: document.getElementById('dbm-name').value.trim(),
    type: document.getElementById('dbm-type').value,
    host: document.getElementById('dbm-host').value.trim(),
    port: Number(document.getElementById('dbm-port').value),
    username: document.getElementById('dbm-username').value.trim(),
    password: document.getElementById('dbm-password').value,
    ssl: document.getElementById('dbm-ssl').checked,
    rejectUnauthorized: document.getElementById('dbm-reject-unauthorized').checked
  };
}

function setDatabaseManagerBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.classList.remove('is-busy');
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

async function refreshDatabaseConnections() {
  const list = document.getElementById('dbm-connection-list');
  const button = document.getElementById('dbm-refresh-connections');
  if (!list) return;
  setDatabaseManagerBusy(button, true, 'Detecting…');
  list.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Scanning local database ports…</div>';
  try {
    databaseManagerState.connections = await api.db.connections();
    renderDatabaseConnections();
    const selected = databaseManagerState.connections.find(connection => connection.id === databaseManagerState.selectedId);
    if (selected) selectDatabaseConnection(selected.id);
    else if (!databaseManagerState.selectedId && databaseManagerState.connections.length) selectDatabaseConnection(databaseManagerState.connections[0].id);
  } catch (err) {
    list.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
  } finally {
    setDatabaseManagerBusy(button, false);
  }
}

function renderDatabaseConnections() {
  const list = document.getElementById('dbm-connection-list');
  if (!list) return;
  const filter = (document.getElementById('dbm-connection-filter')?.value || '').trim().toLowerCase();
  const connections = databaseManagerState.connections.filter(connection => !filter || `${connection.name} ${connection.host} ${connection.type} ${connection.port}`.toLowerCase().includes(filter));
  if (!connections.length) {
    list.innerHTML = '<div class="dbm-empty">No connections configured.</div>';
    return;
  }
  list.innerHTML = connections.map(connection => `
    <button class="dbm-connection${connection.id === databaseManagerState.selectedId ? ' active' : ''}" data-id="${escapeHtml(connection.id)}">
      <span class="dbm-engine">${connection.type === 'postgresql' ? '🐘' : connection.type === 'mongodb' ? '🍃' : '🗄️'}</span>
      <span class="dbm-connection-info"><strong>${escapeHtml(connection.name)}</strong><small>${escapeHtml(connection.host)}:${connection.port} · ${escapeHtml(connection.type)}</small></span>
      <span class="dbm-online ${connection.online ? 'online' : ''}" title="${connection.online ? 'Port is reachable' : 'Port is not reachable'}"></span>
    </button>`).join('');
  list.querySelectorAll('.dbm-connection').forEach(button => button.addEventListener('click', () => selectDatabaseConnection(button.dataset.id)));
}

function selectDatabaseConnection(id) {
  if (databaseManagerState.selectedId) {
    databaseManagerState.passwords.set(databaseManagerState.selectedId, document.getElementById('dbm-password')?.value || '');
  }
  databaseManagerState.selectedId = id;
  const connection = databaseManagerState.connections.find(item => item.id === id) || {
    name: 'New connection', type: 'postgresql', host: '127.0.0.1', port: 5432, username: ''
  };
  document.getElementById('dbm-name').value = connection.name || '';
  document.getElementById('dbm-type').value = connection.type;
  document.getElementById('dbm-host').value = connection.host;
  document.getElementById('dbm-port').value = connection.port;
  document.getElementById('dbm-username').value = connection.username || '';
  document.getElementById('dbm-password').value = id ? (databaseManagerState.passwords.get(id) || '') : '';
  document.getElementById('dbm-ssl').checked = Boolean(connection.ssl);
  document.getElementById('dbm-reject-unauthorized').checked = connection.rejectUnauthorized !== false;
  const managed = Boolean(connection.managed);
  const detected = Boolean(connection.detected);
  for (const field of ['dbm-name', 'dbm-type', 'dbm-host', 'dbm-port', 'dbm-username', 'dbm-ssl', 'dbm-reject-unauthorized']) document.getElementById(field).disabled = managed;
  document.getElementById('dbm-save').classList.toggle('hidden', managed);
  document.getElementById('dbm-remove').classList.toggle('hidden', !id || managed || detected);
  document.getElementById('dbm-workspace').classList.add('hidden');
  document.getElementById('dbm-object-explorer').classList.add('hidden');
  document.getElementById('dbm-connection-editor').open = true;
  databaseManagerState.connection = null;
  databaseManagerState.objects = null;
  databaseManagerState.selectedObject = null;
  document.getElementById('dbm-status').textContent = connection.online ? 'Port reachable' : 'Not connected';
  document.getElementById('dbm-status').className = `dbm-status${connection.online ? ' online' : ''}`;
  updateDatabaseQueryPlaceholder(connection.type);
  renderDatabaseConnections();
}

function updateDatabaseQueryPlaceholder(type) {
  const query = document.getElementById('dbm-query');
  if (!query) return;
  query.placeholder = type === 'mongodb'
    ? '{"collection":"users","operation":"find","filter":{},"limit":100}'
    : 'SELECT * FROM your_table LIMIT 100;';
}

async function saveDatabaseConnection() {
  const button = document.getElementById('dbm-save');
  setDatabaseManagerBusy(button, true, 'Saving…');
  try {
    const result = await api.db.saveConnection(databaseConnectionFromForm());
    databaseManagerState.selectedId = result.id;
    showToast('Database connection saved', 'success');
    await refreshDatabaseConnections();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    setDatabaseManagerBusy(button, false);
  }
}

async function removeDatabaseConnection() {
  const connection = databaseManagerState.connections.find(item => item.id === databaseManagerState.selectedId);
  if (!connection || !confirm(`Remove connection "${connection.name}"?`)) return;
  try {
    await api.db.removeConnection(connection.id);
    databaseManagerState.passwords.delete(connection.id);
    databaseManagerState.selectedId = null;
    selectDatabaseConnection(null);
    await refreshDatabaseConnections();
    showToast('Connection removed', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function testDatabaseConnection() {
  const button = document.getElementById('dbm-test');
  const status = document.getElementById('dbm-status');
  setDatabaseManagerBusy(button, true, 'Testing…');
  status.textContent = 'Connecting…';
  status.className = 'dbm-status';
  try {
    const result = await api.db.testConnection(databaseConnectionFromForm());
    status.textContent = `Connected · ${result.databases} databases`;
    status.className = 'dbm-status online';
    showToast('Database connection works', 'success');
  } catch (err) {
    status.textContent = 'Connection failed';
    status.className = 'dbm-status failed';
    showToast(err.message, 'error');
  } finally { setDatabaseManagerBusy(button, false); }
}

async function connectDatabaseManager() {
  const button = document.getElementById('dbm-connect');
  const status = document.getElementById('dbm-status');
  setDatabaseManagerBusy(button, true, 'Connecting…');
  try {
    const connection = databaseConnectionFromForm();
    const previousDatabase = document.getElementById('dbm-database')?.value;
    const databases = await api.db.listDatabasesFor(connection);
    databaseManagerState.connection = connection;
    const select = document.getElementById('dbm-database');
    select.innerHTML = databases.map(database => `<option value="${escapeHtml(database)}">${escapeHtml(database)}</option>`).join('');
    if (previousDatabase && databases.includes(previousDatabase)) select.value = previousDatabase;
    document.getElementById('dbm-workspace').classList.remove('hidden');
    document.getElementById('dbm-object-explorer').classList.remove('hidden');
    document.getElementById('dbm-connection-editor').open = false;
    document.getElementById('dbm-breadcrumb').textContent = `${connection.name} / ${select.value || 'no database'}`;
    status.textContent = `Connected · ${databases.length} databases`;
    status.className = 'dbm-status online';
    await refreshDatabaseManagerObjects();
    await refreshDatabaseManagerBackups();
  } catch (err) {
    status.textContent = 'Connection failed';
    status.className = 'dbm-status failed';
    showToast(err.message, 'error');
  } finally { setDatabaseManagerBusy(button, false); }
}

async function databaseManagerDatabaseChanged() {
  databaseManagerState.selectedObject = null;
  databaseManagerState.objectMetadata = null;
  databaseManagerState.dataOffset = 0;
  const database = document.getElementById('dbm-database')?.value || 'no database';
  document.getElementById('dbm-breadcrumb').textContent = `${databaseManagerState.connection?.name || 'Connection'} / ${database}`;
  await refreshDatabaseManagerObjects();
  await refreshDatabaseManagerBackups();
}

async function refreshDatabaseManagerTables() {
  return refreshDatabaseManagerObjects();
}

async function refreshDatabaseManagerObjects() {
  const database = document.getElementById('dbm-database')?.value;
  const tree = document.getElementById('dbm-object-tree');
  if (!databaseManagerState.connection || !database || !tree) {
    if (tree) tree.innerHTML = '<div class="dbm-empty">No database selected.</div>';
    return;
  }
  tree.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Reading database metadata…</div>';
  try {
    databaseManagerState.objects = await api.db.listObjectsFor(databaseManagerState.connection, database);
    renderDatabaseObjectTree();
  } catch (err) { tree.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`; }
}

function databaseObjectIcon(type) {
  if (type.includes('view')) return '◫';
  if (type === 'collection') return '◆';
  if (type.includes('foreign')) return '↗';
  return '▦';
}

function renderDatabaseObjectTree() {
  const tree = document.getElementById('dbm-object-tree');
  if (!tree) return;
  const filter = (document.getElementById('dbm-object-filter')?.value || '').trim().toLowerCase();
  const schemas = (databaseManagerState.objects?.schemas || []).map(schema => ({
    ...schema,
    objects: schema.objects.filter(object => !filter || `${schema.name} ${object.name} ${object.type}`.toLowerCase().includes(filter))
  })).filter(schema => schema.objects.length || !filter);
  if (!schemas.length) return void (tree.innerHTML = '<div class="dbm-empty">No matching objects.</div>');
  tree.innerHTML = schemas.map(schema => `<details class="dbm-schema" open>
    <summary><span>▾</span><strong>${escapeHtml(schema.name)}</strong><small>${schema.objects.length}</small></summary>
    <div class="dbm-schema-objects">${schema.objects.map(object => {
      const selected = databaseManagerState.selectedObject?.schema === schema.name && databaseManagerState.selectedObject?.name === object.name;
      const stats = object.estimatedRows == null ? '' : ` · ~${object.estimatedRows.toLocaleString()} rows`;
      return `<button class="dbm-object${selected ? ' active' : ''}" data-schema="${escapeHtml(schema.name)}" data-object="${escapeHtml(object.name)}" data-type="${escapeHtml(object.type)}" title="${escapeHtml(object.type)}${escapeHtml(stats)}"><span>${databaseObjectIcon(object.type)}</span><strong>${escapeHtml(object.name)}</strong><small>${escapeHtml(object.type)}</small></button>`;
    }).join('') || '<div class="dbm-empty compact">Empty schema</div>'}</div>
  </details>`).join('');
  tree.querySelectorAll('.dbm-object').forEach(button => {
    button.addEventListener('click', () => selectDatabaseObject(button.dataset.schema, button.dataset.object, button.dataset.type));
    button.addEventListener('dblclick', () => openDatabaseObjectData(button.dataset.schema, button.dataset.object, button.dataset.type));
  });
}

async function selectDatabaseObject(schema, name, type) {
  databaseManagerState.selectedObject = { schema, name, type };
  databaseManagerState.dataOffset = 0;
  renderDatabaseObjectTree();
  switchDatabaseManagerPane('properties');
  await loadDatabaseObjectMetadata();
}

async function loadDatabaseObjectMetadata() {
  const object = databaseManagerState.selectedObject;
  const database = document.getElementById('dbm-database')?.value;
  const wrap = document.getElementById('dbm-properties');
  if (!object || !database || !databaseManagerState.connection) return;
  wrap.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Loading object definition…</div>';
  try {
    const metadata = await api.db.describeObjectFor(databaseManagerState.connection, database, object.schema, object.name);
    databaseManagerState.objectMetadata = metadata;
    renderDatabaseObjectMetadata(metadata);
  } catch (error) { wrap.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`; }
}

function renderDatabaseObjectMetadata(metadata) {
  const wrap = document.getElementById('dbm-properties');
  const columns = metadata.columns || [];
  const indexes = metadata.indexes || [];
  const constraints = metadata.constraints || [];
  wrap.innerHTML = `<div class="dbm-properties-head"><div><span>${databaseObjectIcon(metadata.type || 'table')}</span><div><h3>${escapeHtml(metadata.schema)}.${escapeHtml(metadata.name)}</h3><p>${columns.length} columns · ${indexes.length} indexes · ${constraints.length} constraints</p></div></div><button class="btn btn-small" id="dbm-properties-open-data">Open data</button></div>
    <h4>Columns</h4>
    <div class="dbm-meta-grid"><table><thead><tr><th>#</th><th>Name</th><th>Data type</th><th>Nullable</th><th>Default / extra</th></tr></thead><tbody>${columns.map((column, index) => `<tr><td>${column.position || index + 1}</td><td><strong>${escapeHtml(column.name)}</strong></td><td><code>${escapeHtml(column.dataType || '')}</code></td><td>${column.nullable ? 'YES' : 'NO'}</td><td><code>${escapeHtml(column.defaultValue ?? column.extra ?? '')}</code></td></tr>`).join('') || '<tr><td colspan="5">No column metadata available.</td></tr>'}</tbody></table></div>
    <div class="dbm-metadata-columns"><section><h4>Indexes</h4>${indexes.map(index => `<div class="dbm-definition"><strong>${escapeHtml(index.name)}</strong><code>${escapeHtml(index.definition || index.columns || '')}</code></div>`).join('') || '<p class="dbm-empty compact">No indexes.</p>'}</section><section><h4>Constraints</h4>${constraints.map(item => `<div class="dbm-definition"><strong>${escapeHtml(item.name)} · ${escapeHtml(item.type || '')}</strong><code>${escapeHtml(item.definition || '')}</code></div>`).join('') || '<p class="dbm-empty compact">No constraints.</p>'}</section></div>
    ${metadata.stats ? `<h4>Storage</h4><div class="dbm-stat-row"><span>Documents <strong>${metadata.stats.count.toLocaleString()}</strong></span><span>Data <strong>${formatBackupSize(metadata.stats.size)}</strong></span><span>Storage <strong>${formatBackupSize(metadata.stats.storageSize)}</strong></span><span>Indexes <strong>${formatBackupSize(metadata.stats.totalIndexSize)}</strong></span></div>` : ''}
    ${metadata.ddl ? `<h4>DDL</h4><pre class="dbm-ddl">${escapeHtml(metadata.ddl)}</pre>` : ''}
    ${metadata.sample ? `<h4>Sample document</h4><pre class="dbm-ddl">${escapeHtml(metadata.sample)}</pre>` : ''}`;
  wrap.querySelector('#dbm-properties-open-data')?.addEventListener('click', openDatabaseObjectData);
}

async function openDatabaseObjectData(schema, name, type) {
  if (typeof schema === 'string') databaseManagerState.selectedObject = { schema, name, type };
  if (!databaseManagerState.selectedObject) return;
  databaseManagerState.dataOffset = 0;
  switchDatabaseManagerPane('data');
  renderDatabaseObjectTree();
  await loadDatabaseManagerData();
}

async function loadDatabaseManagerData() {
  const object = databaseManagerState.selectedObject;
  const database = document.getElementById('dbm-database')?.value;
  const wrap = document.getElementById('dbm-data-result');
  if (!object || !database || !databaseManagerState.connection || !wrap) return;
  const limit = Number(document.getElementById('dbm-page-size')?.value) || 100;
  wrap.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Loading rows…</div>';
  document.getElementById('dbm-data-title').textContent = `${object.schema}.${object.name}`;
  try {
    const data = await api.db.tableDataFor(databaseManagerState.connection, database, object.name, limit, databaseManagerState.dataOffset, object.schema);
    databaseManagerState.dataHasMore = Boolean(data.hasMore);
    renderDatabaseManagerResult(data, 'dbm-data-result', true);
    const start = data.rows.length ? databaseManagerState.dataOffset + 1 : 0;
    document.getElementById('dbm-data-page').textContent = `Rows ${start}–${databaseManagerState.dataOffset + data.rows.length}`;
    document.getElementById('dbm-data-prev').disabled = databaseManagerState.dataOffset === 0;
    document.getElementById('dbm-data-next').disabled = !data.hasMore;
  } catch (error) { wrap.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`; }
}

function pageDatabaseManagerData(direction) {
  const limit = Number(document.getElementById('dbm-page-size')?.value) || 100;
  if (direction > 0 && !databaseManagerState.dataHasMore) return;
  databaseManagerState.dataOffset = Math.max(0, databaseManagerState.dataOffset + direction * limit);
  loadDatabaseManagerData();
}

function switchDatabaseManagerPane(name) {
  document.querySelectorAll('.dbm-workbench-tabs [data-dbm-pane]').forEach(button => button.classList.toggle('active', button.dataset.dbmPane === name));
  document.querySelectorAll('.dbm-workbench-pane').forEach(pane => pane.classList.toggle('active', pane.dataset.pane === name));
  if (name === 'backups') refreshDatabaseManagerBackups();
}

async function createDatabaseManagerDatabase() {
  const name = document.getElementById('dbm-new-database').value.trim();
  if (!name || !databaseManagerState.connection) return;
  try {
    await api.db.createDatabaseFor(databaseManagerState.connection, name);
    document.getElementById('dbm-new-database').value = '';
    await connectDatabaseManager();
    document.getElementById('dbm-database').value = name;
    await refreshDatabaseManagerTables();
    showToast(`Database ${name} created`, 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function dropDatabaseManagerDatabase() {
  const database = document.getElementById('dbm-database')?.value;
  if (!database || !databaseManagerState.connection || !confirm(`Permanently drop database "${database}"?`)) return;
  try {
    await api.db.dropDatabaseFor(databaseManagerState.connection, database);
    await connectDatabaseManager();
    showToast(`Database ${database} dropped`, 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

async function runDatabaseManagerQuery(explain = false) {
  const editor = document.getElementById('dbm-query');
  const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
  let query = selected || editor.value.trim();
  const database = document.getElementById('dbm-database')?.value;
  const resultWrap = document.getElementById('dbm-result');
  const button = document.getElementById('dbm-run-query');
  if (!query || !database || !databaseManagerState.connection) return;
  if (explain && databaseManagerState.connection.type === 'mongodb') return showToast('Explain is currently available for SQL connections', 'error');
  setDatabaseManagerBusy(button, true, 'Running…');
  const explainButton = document.getElementById('dbm-explain-query');
  explainButton.disabled = true;
  const cancelButton = document.getElementById('dbm-cancel-query');
  cancelButton.classList.remove('hidden');
  resultWrap.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Executing query…</div>';
  const startedAt = performance.now();
  document.getElementById('dbm-query-message').textContent = 'Executing…';
  try {
    const limit = Number(document.getElementById('dbm-query-limit')?.value) || 100;
    if (databaseManagerState.connection.type === 'mongodb') {
      try {
        const operation = JSON.parse(query);
        if (operation.operation === 'find' && operation.limit == null) operation.limit = limit;
        query = JSON.stringify(operation, null, 2);
      } catch {}
    } else if (/^\s*select\b/i.test(query) && !/\blimit\s+\d+/i.test(query)) {
      query = `${query.replace(/;\s*$/, '')} LIMIT ${limit};`;
    }
    const queryId = globalThis.crypto?.randomUUID?.() || `query-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    databaseManagerState.activeQueryId = queryId;
    const result = await api.db.executeWorkbench(databaseManagerState.connection, database, query, {
      queryId,
      readOnly: document.getElementById('dbm-read-only').checked,
      transaction: document.getElementById('dbm-transaction').checked,
      explain,
      timeoutMs: Number(document.getElementById('dbm-query-timeout').value) || 30000,
      maxRows: limit
    });
    databaseManagerState.lastResult = result;
    const tab = databaseManagerState.editorTabs.find(item => item.id === databaseManagerState.activeTabId);
    if (tab) tab.result = result;
    renderDatabaseManagerResult(result, 'dbm-result', false);
    recordDatabaseManagerQuery(query, database);
    api.db.queryHistory?.(100).then(history => { if (Array.isArray(history)) databaseManagerState.history = history; }).catch(() => {});
    const elapsed = result.durationMs ?? (performance.now() - startedAt);
    document.getElementById('dbm-query-message').textContent = `${explain ? 'Execution plan' : result.message || `${result.rows?.length || 0} row(s)`}${result.truncated ? ` · truncated from ${result.totalRows}` : ''}${result.transaction ? ' · transaction committed' : ''}${result.readOnly ? ' · read-only' : ''}`;
    document.getElementById('dbm-query-time').textContent = `${Number(elapsed).toFixed(elapsed < 1000 ? 0 : 2)} ms`;
    await refreshDatabaseManagerObjects();
  } catch (err) {
    resultWrap.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
    document.getElementById('dbm-query-message').textContent = 'Execution failed';
    document.getElementById('dbm-query-time').textContent = `${(performance.now() - startedAt).toFixed(0)} ms`;
  } finally {
    databaseManagerState.activeQueryId = null;
    cancelButton.classList.add('hidden');
    explainButton.disabled = false;
    setDatabaseManagerBusy(button, false);
  }
}

async function cancelDatabaseManagerQuery() {
  if (!databaseManagerState.activeQueryId) return;
  const result = await api.db.cancelQuery(databaseManagerState.activeQueryId);
  showToast(result.success ? 'Query cancellation requested' : result.error, result.success ? 'success' : 'error');
}

function renderDatabaseManagerResult(data, targetId = 'dbm-result', rowNumbers = false) {
  const wrap = document.getElementById(targetId);
  if (!wrap || !data) return;
  if (!data?.columns?.length) {
    wrap.innerHTML = `<div class="db-success">✓ ${escapeHtml(data?.message || 'Query executed successfully')}</div>`;
    return;
  }
  const filter = targetId === 'dbm-result' ? (document.getElementById('dbm-result-filter')?.value || '').toLowerCase() : '';
  const rows = (data.rows || []).filter(row => !filter || row.some(cell => String(cell ?? '').toLowerCase().includes(filter)));
  wrap.innerHTML = `<table class="db-data-table"><thead><tr>${rowNumbers ? '<th class="dbm-row-number">#</th>' : ''}${data.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row, index) => `<tr>${rowNumbers ? `<td class="dbm-row-number">${(data.offset || 0) + index + 1}</td>` : ''}${row.map(cell => `<td${cell == null || cell === '' || cell === 'NULL' ? ' class="db-null"' : ''} title="${escapeHtml(cell == null ? 'NULL' : cell)}">${escapeHtml(cell == null ? 'NULL' : cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${!rows.length ? '<div class="dbm-empty">No rows match the filter.</div>' : ''}`;
}

function persistActiveDatabaseSqlTab() {
  const tab = databaseManagerState.editorTabs.find(item => item.id === databaseManagerState.activeTabId);
  if (tab) tab.query = document.getElementById('dbm-query')?.value || '';
}

function renderDatabaseSqlTabs() {
  const wrap = document.getElementById('dbm-sql-tabs');
  if (!wrap) return;
  wrap.innerHTML = databaseManagerState.editorTabs.map(tab => `<button class="dbm-sql-tab${tab.id === databaseManagerState.activeTabId ? ' active' : ''}" data-id="${tab.id}"><span>${escapeHtml(tab.title)}</span>${databaseManagerState.editorTabs.length > 1 ? '<i title="Close">×</i>' : ''}</button>`).join('') + '<button class="dbm-sql-tab-add" title="New SQL editor">＋</button>';
  wrap.querySelectorAll('.dbm-sql-tab').forEach(button => {
    button.addEventListener('click', () => switchDatabaseSqlTab(button.dataset.id));
    button.querySelector('i')?.addEventListener('click', event => { event.stopPropagation(); closeDatabaseSqlTab(button.dataset.id); });
  });
  wrap.querySelector('.dbm-sql-tab-add')?.addEventListener('click', addDatabaseSqlTab);
}

function switchDatabaseSqlTab(id) {
  persistActiveDatabaseSqlTab();
  databaseManagerState.activeTabId = id;
  const tab = databaseManagerState.editorTabs.find(item => item.id === id);
  document.getElementById('dbm-query').value = tab?.query || '';
  databaseManagerState.lastResult = tab?.result || null;
  if (tab?.result) renderDatabaseManagerResult(tab.result, 'dbm-result', false);
  else document.getElementById('dbm-result').innerHTML = '<div class="dbm-empty">Execute a query to see results.</div>';
  renderDatabaseSqlTabs();
}

function addDatabaseSqlTab() {
  persistActiveDatabaseSqlTab();
  const number = Math.max(0, ...databaseManagerState.editorTabs.map(tab => Number(tab.title.match(/\d+/)?.[0]) || 0)) + 1;
  const tab = { id: `sql-${Date.now()}-${number}`, title: `SQL ${number}`, query: '', result: null };
  databaseManagerState.editorTabs.push(tab);
  databaseManagerState.activeTabId = tab.id;
  switchDatabaseSqlTab(tab.id);
  document.getElementById('dbm-query').focus();
}

function closeDatabaseSqlTab(id) {
  if (databaseManagerState.editorTabs.length === 1) return;
  const index = databaseManagerState.editorTabs.findIndex(tab => tab.id === id);
  databaseManagerState.editorTabs.splice(index, 1);
  if (databaseManagerState.activeTabId === id) databaseManagerState.activeTabId = databaseManagerState.editorTabs[Math.max(0, index - 1)].id;
  switchDatabaseSqlTab(databaseManagerState.activeTabId);
}

function setDatabaseManagerQuery(query) {
  document.getElementById('dbm-query').value = query;
  persistActiveDatabaseSqlTab();
}

function formatDatabaseManagerQuery() {
  if (databaseManagerState.connection?.type === 'mongodb') {
    try { setDatabaseManagerQuery(JSON.stringify(JSON.parse(document.getElementById('dbm-query').value), null, 2)); }
    catch (error) { showToast(`Invalid JSON: ${error.message}`, 'error'); }
    return;
  }
  let query = document.getElementById('dbm-query').value.trim();
  for (const keyword of ['select', 'from', 'where', 'group by', 'order by', 'having', 'limit', 'offset', 'join', 'left join', 'right join', 'inner join', 'union', 'values', 'returning']) {
    query = query.replace(new RegExp(`\\b${keyword.replace(' ', '\\s+')}\\b`, 'gi'), keyword.toUpperCase());
  }
  query = query.replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|UNION|RETURNING)\b/g, '\n$1');
  setDatabaseManagerQuery(query);
}

function recordDatabaseManagerQuery(query, database) {
  databaseManagerState.history = [{ query, database, connection: databaseManagerState.connection?.name || '', at: new Date().toISOString() }, ...databaseManagerState.history.filter(item => item.query !== query)].slice(0, 50);
  try { localStorage.setItem('kitsune-db-query-history', JSON.stringify(databaseManagerState.history)); } catch {}
}

function toggleDatabaseManagerHistory() {
  document.querySelector('.dbm-query-history-menu')?.remove();
  const button = document.getElementById('dbm-query-history');
  const menu = document.createElement('div');
  menu.className = 'dbm-query-history-menu';
  menu.innerHTML = databaseManagerState.history.length ? databaseManagerState.history.map((item, index) => `<button data-index="${index}"><strong>${item.success === false ? '✕' : '✓'} ${escapeHtml(item.database || 'database')} · ${escapeHtml(item.connection || '')}</strong><code>${escapeHtml(item.query.replace(/\s+/g, ' ').slice(0, 160))}</code><small>${escapeHtml(new Date(item.at).toLocaleString())} · ${Number(item.durationMs || 0)} ms</small></button>`).join('') + '<button data-action="clear"><strong>Clear query history</strong></button>' : '<div class="dbm-empty">No query history yet.</div>';
  button.parentElement.appendChild(menu);
  menu.querySelectorAll('button[data-index]').forEach(item => item.addEventListener('click', () => { setDatabaseManagerQuery(databaseManagerState.history[Number(item.dataset.index)].query); menu.remove(); }));
  menu.querySelector('[data-action="clear"]')?.addEventListener('click', async () => { await api.db.clearQueryHistory(); databaseManagerState.history = []; menu.remove(); });
}

async function saveCurrentDatabaseQuery() {
  const query = document.getElementById('dbm-query').value.trim();
  if (!query) return showToast('Write a query before saving it', 'error');
  const name = prompt('Saved query name:', query.split(/\r?\n/)[0].slice(0, 60));
  if (!name) return;
  try {
    const saved = await api.db.saveQuery({ name, query, type: databaseManagerState.connection?.type || '', database: document.getElementById('dbm-database')?.value || '' });
    databaseManagerState.savedQueries = [saved, ...databaseManagerState.savedQueries.filter(item => item.id !== saved.id)];
    showToast(`Saved query: ${saved.name}`, 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

function toggleDatabaseSavedQueries() {
  document.querySelector('.dbm-query-history-menu')?.remove();
  const button = document.getElementById('dbm-saved-queries');
  const menu = document.createElement('div');
  menu.className = 'dbm-query-history-menu';
  menu.innerHTML = databaseManagerState.savedQueries.length
    ? databaseManagerState.savedQueries.map((item, index) => `<button data-index="${index}"><strong>☆ ${escapeHtml(item.name)}</strong><code>${escapeHtml(item.query.replace(/\s+/g, ' ').slice(0, 160))}</code><small>${escapeHtml(item.type || 'any engine')} · ${escapeHtml(item.database || 'any database')}</small><i class="saved-query-remove" title="Remove">×</i></button>`).join('')
    : '<div class="dbm-empty">No saved queries yet.</div>';
  button.parentElement.appendChild(menu);
  menu.querySelectorAll('button').forEach(item => {
    item.addEventListener('click', event => {
      if (event.target.classList.contains('saved-query-remove')) return;
      setDatabaseManagerQuery(databaseManagerState.savedQueries[Number(item.dataset.index)].query); menu.remove();
    });
    item.querySelector('.saved-query-remove')?.addEventListener('click', async event => {
      event.stopPropagation();
      const saved = databaseManagerState.savedQueries[Number(item.dataset.index)];
      await api.db.removeSavedQuery(saved.id);
      databaseManagerState.savedQueries = databaseManagerState.savedQueries.filter(query => query.id !== saved.id);
      menu.remove(); toggleDatabaseSavedQueries();
    });
  });
}

function databaseManagerDelimited(separator) {
  const data = databaseManagerState.lastResult;
  if (!data?.columns?.length) return '';
  const encode = value => {
    const text = String(value ?? '');
    return separator === ',' && /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text.replace(/[\t\r\n]+/g, ' ');
  };
  return [data.columns, ...data.rows].map(row => row.map(encode).join(separator)).join('\n');
}

async function copyDatabaseManagerResult() {
  const text = databaseManagerDelimited('\t');
  if (!text) return showToast('There is no tabular result to copy', 'error');
  try { await navigator.clipboard.writeText(text); showToast('Result copied as TSV', 'success'); }
  catch (error) { showToast(error.message, 'error'); }
}

function exportDatabaseManagerResult() {
  const csv = databaseManagerDelimited(',');
  if (!csv) return showToast('There is no tabular result to export', 'error');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `query-result-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function refreshDatabaseManagerBackups() {
  const list = document.getElementById('dbm-backup-list');
  const database = document.getElementById('dbm-database')?.value;
  if (!list || !databaseManagerState.connection || !database) return;
  list.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Loading backups…</div>';
  try {
    const backups = await api.backup.list({ type: databaseManagerState.connection.type, database });
    if (!backups.length) {
      list.innerHTML = '<div class="dbm-empty">No backups for this database.</div>';
      return;
    }
    list.innerHTML = backups.map(backup => `<div class="dbm-backup-row"><div class="dbm-backup-info"><strong>${escapeHtml(backup.label || backup.database)}</strong><span>${escapeHtml(new Date(backup.createdAt).toLocaleString())} · ${formatBackupSize(backup.size)} · ${backup.exists ? escapeHtml(backup.checksum.slice(0, 12)) : 'file missing'}</span></div>${backup.verifiedAt ? '<span class="dbm-backup-verified">✓ verified</span>' : ''}<div class="dbm-backup-row-actions"><button class="btn btn-small dbm-backup-verify" data-id="${escapeHtml(backup.id)}">Verify</button><button class="btn btn-small dbm-backup-restore" data-id="${escapeHtml(backup.id)}">Restore</button><button class="btn btn-small btn-danger dbm-backup-delete" data-id="${escapeHtml(backup.id)}">🗑</button></div></div>`).join('');
    list.querySelectorAll('.dbm-backup-verify').forEach(button => button.addEventListener('click', () => verifyDatabaseManagerBackup(button.dataset.id)));
    list.querySelectorAll('.dbm-backup-restore').forEach(button => button.addEventListener('click', () => restoreDatabaseManagerBackup(button.dataset.id)));
    list.querySelectorAll('.dbm-backup-delete').forEach(button => button.addEventListener('click', () => removeDatabaseManagerBackup(button.dataset.id)));
  } catch (error) { list.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`; }
}

async function createDatabaseManagerBackup() {
  const database = document.getElementById('dbm-database')?.value;
  if (!databaseManagerState.connection || !database) return showToast('Connect and select a database first', 'error');
  const button = document.getElementById('dbm-create-backup');
  setDatabaseManagerBusy(button, true, 'Backing up…');
  try {
    const keep = Number(document.getElementById('dbm-backup-keep').value) || 10;
    const result = await api.backup.create(databaseManagerState.connection, database, { keep });
    showToast(result.success ? `Backup created (${formatBackupSize(result.backup.size)})` : result.error, result.success ? 'success' : 'error');
    await refreshDatabaseManagerBackups();
  } catch (error) { showToast(error.message, 'error'); }
  finally { setDatabaseManagerBusy(button, false); }
}

async function verifyDatabaseManagerBackup(id) {
  const result = await api.backup.verify(id);
  showToast(result.success ? 'Backup checksum is valid' : result.error, result.success ? 'success' : 'error');
  await refreshDatabaseManagerBackups();
}

async function restoreDatabaseManagerBackup(id) {
  const database = document.getElementById('dbm-database')?.value;
  if (!database || !databaseManagerState.connection) return;
  if (!confirm(`Restore this backup into "${database}"? Existing objects may be replaced or removed.`)) return;
  const confirmation = prompt(`Type the database name to confirm restore: ${database}`);
  if (confirmation !== database) return showToast('Restore cancelled: database name did not match', 'error');
  try {
    const result = await api.backup.restore(id, databaseManagerState.connection, database);
    showToast(result.success ? `Database ${database} restored` : result.error, result.success ? 'success' : 'error');
    await refreshDatabaseManagerTables();
  } catch (error) { showToast(error.message, 'error'); }
}

async function removeDatabaseManagerBackup(id) {
  if (!confirm('Permanently delete this backup file?')) return;
  const result = await api.backup.remove(id);
  showToast(result.success ? 'Backup removed' : result.error, result.success ? 'success' : 'error');
  await refreshDatabaseManagerBackups();
}

async function saveDatabaseBackupSchedule() {
  const database = document.getElementById('dbm-database')?.value;
  const connection = databaseManagerState.connection;
  if (!connection || !database) return showToast('Connect and select a database first', 'error');
  if (!connection.id || connection.detected) return showToast('Save this connection before scheduling backups', 'error');
  try {
    const schedule = await api.backup.saveSchedule({
      name: `${connection.name}: ${database}`,
      type: connection.type,
      connectionId: connection.id,
      database,
      intervalHours: Number(document.getElementById('dbm-backup-interval').value),
      keep: Number(document.getElementById('dbm-backup-keep').value),
      enabled: true
    });
    showToast(`Backup scheduled every ${schedule.intervalHours} hour(s)`, 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

function formatBackupSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function dbRefresh(section) {
  if (!statuses[section]?.running) return;
  const tree = document.getElementById('db-tree-' + section);
  if (!tree) return;
  tree.innerHTML = '<div class="db-loading">Loading databases...</div>';
  try {
    const databases = await api.db.listDatabases(section);
    renderDbTree(section, databases);
  } catch (err) {
    tree.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
  }
}

function renderDbTree(section, databases) {
  const tree = document.getElementById('db-tree-' + section);
  if (!tree) return;
  tree.innerHTML = '';
  if (!dbState[section]) dbState[section] = {};

  if (!databases.length) {
    tree.innerHTML = '<div class="db-empty">No databases found</div>';
    return;
  }

  for (const db of databases) {
    const dbItem = document.createElement('div');
    dbItem.className = 'db-tree-item db-tree-database' + (dbState[section].currentDb === db ? ' active' : '');

    const dbLabel = document.createElement('span');
    dbLabel.className = 'db-tree-label';
    dbLabel.textContent = '📁 ' + db;
    dbItem.appendChild(dbLabel);

    const dbOpenBtn = document.createElement('button');
    dbOpenBtn.className = 'db-tree-open-btn';
    dbOpenBtn.textContent = '🔧';
    dbOpenBtn.title = 'Open in Adminer';
    dbOpenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dbOpenTool(section, db);
    });
    dbItem.appendChild(dbOpenBtn);

    const tablesContainer = document.createElement('div');
    tablesContainer.className = 'db-tree-tables hidden';

    dbLabel.addEventListener('click', async () => {
      dbState[section].currentDb = db;
      dbState[section].currentTable = null;

      tree.querySelectorAll('.db-tree-database').forEach(el => el.classList.remove('active'));
      dbItem.classList.add('active');

      const wasVisible = !tablesContainer.classList.contains('hidden');
      tree.querySelectorAll('.db-tree-tables').forEach(el => el.classList.add('hidden'));

      if (!wasVisible) {
        tablesContainer.classList.remove('hidden');
        tablesContainer.innerHTML = '<div class="db-loading">Loading...</div>';
        try {
          const tables = await api.db.listTables(section, db);
          tablesContainer.innerHTML = '';
          if (!tables.length) {
            tablesContainer.innerHTML = '<div class="db-empty">No tables</div>';
          }
          for (const table of tables) {
            const tItem = document.createElement('div');
            tItem.className = 'db-tree-item db-tree-table';
            tItem.textContent = '📋 ' + table;
            tItem.addEventListener('click', (e) => {
              e.stopPropagation();
              dbState[section].currentTable = table;
              tablesContainer.querySelectorAll('.db-tree-table').forEach(el => el.classList.remove('active'));
              tItem.classList.add('active');
              dbLoadTableData(section, db, table);
            });
            tablesContainer.appendChild(tItem);
          }
        } catch (err) {
          tablesContainer.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
        }
      }
    });

    dbItem.appendChild(tablesContainer);
    tree.appendChild(dbItem);
  }
}

async function dbLoadTableData(section, database, table) {
  const info = document.getElementById('db-info-' + section);
  const tableWrap = document.getElementById('db-table-' + section);
  info.textContent = `Loading ${table}...`;
  tableWrap.innerHTML = '';
  try {
    const data = await api.db.tableData(section, database, table, 200, 0);
    renderDbTable(section, data);
    info.textContent = `${escapeHtml(table)} — ${data.rows.length} rows`;
  } catch (err) {
    info.textContent = '';
    tableWrap.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
  }
}

function renderDbTable(section, data) {
  const wrap = document.getElementById('db-table-' + section);
  if (!wrap) return;

  if (!data.columns.length) {
    wrap.innerHTML = data.message
      ? `<div class="db-success">✓ ${escapeHtml(data.message)}</div>`
      : '<div class="db-empty">No data</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'db-data-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const col of data.columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of data.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      td.textContent = cell;
      if (cell === '' || cell === 'NULL' || cell == null) td.classList.add('db-null');
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.innerHTML = '';
  wrap.appendChild(table);
}

async function dbRunQuery(section) {
  const queryEl = document.getElementById('db-query-' + section);
  const query = queryEl?.value?.trim();
  if (!query) return;

  // Save to query history
  if (!dbQueryHistory[section]) dbQueryHistory[section] = [];
  const hist = dbQueryHistory[section];
  // Remove duplicate if exists, then add to front
  const idx = hist.indexOf(query);
  if (idx !== -1) hist.splice(idx, 1);
  hist.unshift(query);
  if (hist.length > 20) hist.pop();

  const database = dbState[section]?.currentDb;
  const info = document.getElementById('db-info-' + section);
  const tableWrap = document.getElementById('db-table-' + section);

  info.textContent = 'Executing...';
  tableWrap.innerHTML = '';

  try {
    const data = await api.db.executeQuery(section, database, query);
    if (data.message && !data.columns.length) {
      info.textContent = data.message;
      tableWrap.innerHTML = `<div class="db-success">✓ ${escapeHtml(data.message)}</div>`;
    } else {
      renderDbTable(section, data);
      info.textContent = `${data.rows.length} rows returned`;
    }
    // Refresh tree if query might have changed structure
    if (/CREATE|DROP|ALTER|INSERT|UPDATE|DELETE/i.test(query)) {
      setTimeout(() => dbRefresh(section), 500);
    }
  } catch (err) {
    info.textContent = 'Error';
    tableWrap.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
  }
}

async function dbCreateDb(section) {
  const name = prompt('Enter new database name:');
  if (!name?.trim()) return;
  try {
    await api.db.createDatabase(section, name.trim());
    showToast(`Database "${name.trim()}" created`, 'success');
    dbRefresh(section);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function dbDropDb(section) {
  const db = dbState[section]?.currentDb;
  if (!db) { showToast('Select a database first', 'error'); return; }
  if (!confirm(`Drop database "${db}"? This cannot be undone!`)) return;
  try {
    await api.db.dropDatabase(section, db);
    dbState[section].currentDb = null;
    dbState[section].currentTable = null;
    showToast(`Database "${db}" dropped`, 'success');
    dbRefresh(section);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function dbOpenTool(section, database) {
  const db = database || dbState[section]?.currentDb || null;
  try {
    const result = await api.db.getToolUrl(section, db);
    if (!result || !result.url) {
      showToast('Adminer not available. Make sure PHP is configured.', 'error');
      return;
    }
    api.shell.openExternal(result.url);
    showToast(`Opening ${result.tool}${db ? ': ' + db : ''}`, 'info');
  } catch (err) {
    showToast(`Failed to open DB tool: ${err.message}`, 'error');
  }
}

function toggleQueryHistory(section) {
  const dropdown = document.getElementById('db-history-' + section);
  if (!dropdown) return;
  const isHidden = dropdown.classList.contains('hidden');
  if (isHidden) {
    const hist = dbQueryHistory[section] || [];
    if (!hist.length) {
      dropdown.innerHTML = '<div class="db-history-empty">No query history yet</div>';
    } else {
      dropdown.innerHTML = hist.map((q, i) =>
        `<div class="db-history-item" data-index="${i}" title="${escapeHtml(q)}">${escapeHtml(q.length > 80 ? q.slice(0, 80) + '...' : q)}</div>`
      ).join('');
      dropdown.querySelectorAll('.db-history-item').forEach(item => {
        item.addEventListener('click', () => {
          const queryEl = document.getElementById('db-query-' + section);
          if (queryEl) queryEl.value = hist[parseInt(item.dataset.index)];
          dropdown.classList.add('hidden');
        });
      });
    }
    dropdown.classList.remove('hidden');
    // Close on outside click
    const close = (e) => {
      if (!dropdown.contains(e.target) && !e.target.closest('[data-action="history"]')) {
        dropdown.classList.add('hidden');
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  } else {
    dropdown.classList.add('hidden');
  }
}

function dbExportCsv(section) {
  const tableWrap = document.getElementById('db-table-' + section);
  if (!tableWrap) return;
  const table = tableWrap.querySelector('.db-data-table');
  if (!table) { showToast('No data to export', 'error'); return; }

  const rows = [];
  // Header
  const ths = table.querySelectorAll('thead th');
  rows.push([...ths].map(th => `"${th.textContent.replace(/"/g, '""')}"`).join(','));
  // Data rows
  table.querySelectorAll('tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    rows.push([...cells].map(td => `"${td.textContent.replace(/"/g, '""')}"`).join(','));
  });

  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const db = dbState[section]?.currentDb || section;
  const tbl = dbState[section]?.currentTable || 'query';
  a.download = `${db}-${tbl}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported', 'success');
}

/* ===== Log Viewer ===== */
const logViewerState = {}; // { section: { open, autoScroll } }
let logRefreshInterval = null;

function initLogViewers() {
  for (const section of SERVICE_SECTIONS) {
    const container = document.getElementById('log-viewer-' + section);
    if (!container) continue;

    logViewerState[section] = { open: true, autoScroll: true, autoRefresh: true, filter: '' };
    const label = sectionLabel(section);

    container.innerHTML = `
      <div class="log-viewer-toolbar">
        <div class="log-viewer-title">
          ${escapeHtml(label)} Logs
          <span class="log-viewer-badge stopped" id="log-badge-${section}">stopped</span>
        </div>
        <div class="log-viewer-actions">
          <input type="text" class="log-filter-input" data-section="${section}" placeholder="Filter logs..." title="Filter log lines (case-insensitive)">
          <button data-action="auto-refresh" class="log-auto-refresh active" title="Toggle auto-refresh">⏱ Auto</button>
          <button data-action="download" title="Download logs">💾 Save</button>
          <button data-action="clear" title="Clear logs">🗑 Clear</button>
          <button data-action="refresh" title="Refresh now">🔄 Refresh</button>
        </div>
      </div>
      <div class="log-output-wrap">
        <div class="log-output" id="log-output-${section}"><div class="log-empty">No logs yet. Start the service to see output.</div></div>
      </div>
    `;

    container.querySelector('[data-action="download"]').addEventListener('click', () => {
      const output = document.getElementById('log-output-' + section);
      const text = output?.innerText || '';
      if (!text || text === 'No logs yet. Start the service to see output.' || text === 'Logs cleared.') {
        showToast('No logs to save', 'error');
        return;
      }
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${section}-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Logs saved', 'success');
    });

    container.querySelector('[data-action="auto-refresh"]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      logViewerState[section].autoRefresh = !logViewerState[section].autoRefresh;
      btn.classList.toggle('active', logViewerState[section].autoRefresh);
    });

    container.querySelector('[data-action="clear"]').addEventListener('click', async () => {
      await api.service.clearLogs(section);
      const output = document.getElementById('log-output-' + section);
      output.innerHTML = '<div class="log-empty">Logs cleared.</div>';
    });

    container.querySelector('[data-action="refresh"]').addEventListener('click', () => {
      refreshLogs(section);
    });

    container.querySelector('.log-filter-input').addEventListener('input', (e) => {
      logViewerState[section].filter = e.target.value;
      refreshLogs(section);
    });
  }

  // Auto-refresh logs every 2 seconds for visible log tabs (if enabled)
  logRefreshInterval = setInterval(() => {
    for (const section of SERVICE_SECTIONS) {
      if (!logViewerState[section]?.autoRefresh) continue;
      const pane = document.getElementById('subtab-logs-' + section);
      if (pane && pane.classList.contains('active')) refreshLogs(section);
    }
  }, 2000);
}

function openLogViewer(section) {
  refreshLogs(section);
}

async function refreshLogs(section) {
  const output = document.getElementById('log-output-' + section);
  if (!output) return;

  try {
    const lines = await api.service.logs(section, 200);
    const running = statuses[section]?.running || false;

    // Update badge
    const badge = document.getElementById('log-badge-' + section);
    if (badge) {
      badge.textContent = running ? 'running' : 'stopped';
      badge.className = 'log-viewer-badge ' + (running ? 'running' : 'stopped');
    }

    if (!lines.length) {
      output.innerHTML = `<div class="log-empty">${running ? 'Service running, waiting for output...' : 'No logs yet. Start the service to see output.'}</div>`;
      return;
    }

    const filter = (logViewerState[section]?.filter || '').toLowerCase();
    const filteredLines = filter ? lines.filter(l => l.toLowerCase().includes(filter)) : lines;

    const wasAtBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 30;

    output.innerHTML = filteredLines.map(line => {
      const escaped = escapeHtml(line);
      if (line.startsWith('[ERR]') || /\[ERROR\]/i.test(line)) return `<span class="log-line-err">${escaped}</span>`;
      if (/\[Warning\]|\[WARN\]/i.test(line)) return `<span class="log-line-warn">${escaped}</span>`;
      if (/\[Note\]|\[INFO\]/i.test(line)) return `<span class="log-line-note">${escaped}</span>`;
      return escaped;
    }).join('');

    if (wasAtBottom) output.scrollTop = output.scrollHeight;
  } catch {
    // silently ignore
  }
}

/* ===== Sub-Tabs ===== */
function initSubTabs() {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const parent = btn.closest('.sub-tabs');
      parent.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      parent.querySelectorAll('.sub-tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = parent.querySelector('#subtab-' + btn.dataset.subtab);
      if (pane) pane.classList.add('active');

      // Auto-refresh logs when switching to Logs tab
      const subtab = btn.dataset.subtab;
      if (subtab.startsWith('logs-')) {
        const section = subtab.replace('logs-', '');
        refreshLogs(section);
      }
    });
  });
}

/* ===== Project Managers (Node / Go) ===== */
const PROJECT_SECTIONS = ['node', 'go', 'bun', 'python', 'deno'];

function initProjectManagers() {
  PROJECT_SECTIONS.forEach(section => {
    const createBtn = document.getElementById(`btn-create-project-${section}`);
    const nameInput = document.getElementById(`project-name-${section}`);
    if (createBtn && nameInput) {
      createBtn.addEventListener('click', () => createProject(section));
      nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createProject(section); });
    }
    const openBtn = document.getElementById(`btn-open-projects-${section}`);
    if (openBtn) openBtn.addEventListener('click', () => api.shell.openPath(`projects/${section}`));
    refreshProjectList(section);
  });
}

async function createProject(section) {
  const input = document.getElementById(`project-name-${section}`);
  const name = input.value.trim();
  if (!name) { showToast('Enter a project name', 'error'); return; }
  const result = await api.projects.create(section, name);
  if (result.success) {
    input.value = '';
    showToast(`Project "${name}" created`, 'success');
    refreshProjectList(section);
  } else {
    showToast(result.error || 'Failed to create project', 'error');
  }
}

async function refreshProjectList(section) {
  const container = document.getElementById(`projects-list-${section}`);
  if (!container) return;
  const projects = await api.projects.list(section);
  if (!projects.length) {
    container.innerHTML = '<div class="projects-empty">No projects yet. Create one above.</div>';
    return;
  }
  container.innerHTML = projects.map(name => `
    <div class="project-item">
      <span class="project-item-name">📁 ${escapeHtml(name)}</span>
      <div class="project-item-actions">
        <button class="btn" data-open="${escapeHtml(name)}" data-section="${section}" title="Open in Explorer">📂 Open</button>
        <button class="btn btn-danger" data-delete="${escapeHtml(name)}" data-section="${section}" title="Delete project">🗑 Delete</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => api.shell.openPath(`projects/${btn.dataset.section}/${btn.dataset.open}`));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pName = btn.dataset.delete;
      if (!confirm(`Delete project "${pName}"? This removes all files inside.`)) return;
      const res = await api.projects.delete(btn.dataset.section, pName);
      if (res.success) { showToast(`"${pName}" deleted`, 'success'); refreshProjectList(btn.dataset.section); }
      else showToast(res.error || 'Delete failed', 'error');
    });
  });
}

/* ===== Folder Buttons ===== */
function bindFolderButtons() {
  for (const section of ['apache', 'nginx', 'caddy']) {
    const button = document.getElementById(`btn-open-${section}-docroot`);
    if (!button) continue;
    button.addEventListener('click', async () => {
      const input = document.getElementById(`${section}-documentRoot`);
      if (!input) return;
      const original = button.textContent;
      button.disabled = true;
      button.classList.add('is-busy');
      button.textContent = 'Choosing…';
      try {
        let directory;
        const picked = await api.shell.selectDirectory(input.value || undefined);
        if (picked.canceled) return;
        if (!picked.success) throw new Error(picked.error || 'Could not choose directory');
        directory = picked.path;
        if (!directory) return;
        button.textContent = statuses[section]?.running ? 'Restarting…' : 'Saving…';
        const result = await api.config.setDocumentRoot(section, directory);
        if (!result.success) throw new Error(result.error || 'Could not save document root');
        config = result.config;
        populateSectionUI(section);
        syncDocumentRootControls();
        dirty = false;
        showToast(`Document root saved${result.restarted?.length ? ` and ${sectionLabel(section)} restarted` : ''}`, 'success');
        await refreshStatuses();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        button.disabled = false;
        button.classList.remove('is-busy');
        button.textContent = original;
      }
    });
  }

  const globalToggle = document.getElementById('general-forceGlobalDocumentRoot');
  const globalButton = document.getElementById('btn-global-docroot');
  const applyGlobalRoot = async (enabled, chooseDirectory) => {
    const input = document.getElementById('general-globalDocumentRoot');
    const original = globalButton?.textContent;
    if (globalButton) {
      globalButton.disabled = true;
      globalButton.classList.add('is-busy');
      globalButton.textContent = chooseDirectory ? 'Choosing…' : 'Applying…';
    }
    if (globalToggle) globalToggle.disabled = true;
    try {
      let directory = input?.value || config.general?.globalDocumentRoot || './www';
      if (chooseDirectory) {
        const picked = await api.shell.selectDirectory(directory || undefined);
        if (picked.canceled) return;
        if (!picked.success) throw new Error(picked.error || 'Could not choose directory');
        directory = picked.path;
      }
      if (!directory) return;
      if (globalButton) {
        const webRunning = ['apache', 'nginx', 'caddy'].some(section => statuses[section]?.running);
        globalButton.textContent = webRunning ? 'Restarting…' : 'Saving…';
      }
      const result = await api.config.setGlobalDocumentRoot(enabled, directory);
      if (!result.success) throw new Error(result.error || 'Could not update the global document root');
      config = result.config;
      for (const section of ['apache', 'nginx', 'caddy']) populateSectionUI(section);
      syncDocumentRootControls();
      dirty = false;
      const restarted = result.restarted?.length ? ` Restarted: ${result.restarted.map(sectionLabel).join(', ')}.` : '';
      showToast(`Global document root ${enabled ? 'enabled' : 'disabled'}.${restarted}`, 'success');
      await refreshStatuses();
    } catch (err) {
      showToast(err.message, 'error');
      syncDocumentRootControls();
    } finally {
      if (globalButton) {
        globalButton.disabled = false;
        globalButton.classList.remove('is-busy');
        globalButton.textContent = original;
      }
      if (globalToggle) globalToggle.disabled = false;
      syncDocumentRootControls();
    }
  };
  globalToggle?.addEventListener('change', () => applyGlobalRoot(globalToggle.checked, false));
  globalButton?.addEventListener('click', () => applyGlobalRoot(Boolean(globalToggle?.checked), true));
}

/* ===== Project Workspaces / Activity / Diagnostics ===== */
const workspaceState = { templates: [], projects: [], activities: [], doctor: null, ports: [], toolchains: [], ides: [], tasks: [], snapshots: [], plugins: [], platform: null, tunnels: [], tunnelProviders: [], initialized: false };
let workspaceEditorProject = null;

function initWorkspaceCenter() {
  if (!api.workspace || workspaceState.initialized) return;
  workspaceState.initialized = true;
  document.getElementById('workspace-new')?.addEventListener('click', () => openWorkspaceEditor());
  document.getElementById('workspace-detect')?.addEventListener('click', detectWorkspaceFolder);
  document.getElementById('workspace-editor-close')?.addEventListener('click', closeWorkspaceEditor);
  document.getElementById('workspace-editor-cancel')?.addEventListener('click', closeWorkspaceEditor);
  document.getElementById('workspace-editor-save')?.addEventListener('click', saveWorkspaceEditor);
  document.getElementById('workspace-template')?.addEventListener('change', applyWorkspaceTemplate);
  document.getElementById('workspace-pick-root')?.addEventListener('click', pickWorkspaceRoot);
  document.getElementById('workspace-refresh')?.addEventListener('click', refreshWorkspaceCenter);
  document.getElementById('workspace-search')?.addEventListener('input', renderWorkspaceCards);
  document.getElementById('workspace-state-filter')?.addEventListener('change', renderWorkspaceCards);
  document.getElementById('workspace-doctor')?.addEventListener('click', runWorkspaceDoctor);
  document.getElementById('doctor-run')?.addEventListener('click', runWorkspaceDoctor);
  document.getElementById('doctor-repair-all')?.addEventListener('click', repairWorkspaceIssues);
  document.getElementById('activity-clear')?.addEventListener('click', async () => { await api.activity.clear(); await refreshActivities(); });
  document.getElementById('port-find')?.addEventListener('click', findWorkspacePort);
  document.getElementById('workspace-import')?.addEventListener('click', importWorkspaceManifest);
  document.getElementById('workspace-domain-sync')?.addEventListener('click', syncWorkspaceDomains);
  document.getElementById('workspace-env-export')?.addEventListener('click', exportWorkspaceEnvironment);
  document.getElementById('workspace-env-import')?.addEventListener('click', importWorkspaceEnvironment);
  document.getElementById('workspace-snapshot')?.addEventListener('click', createWorkspaceSnapshot);
  document.getElementById('snapshot-refresh')?.addEventListener('click', refreshWorkspaceSnapshots);
  document.getElementById('plugin-install')?.addEventListener('click', installWorkspacePlugin);
  document.getElementById('platform-refresh')?.addEventListener('click', refreshPlatformInventory);
  document.getElementById('tunnel-refresh')?.addEventListener('click', refreshWorkspaceTunnels);
  document.getElementById('toolchain-refresh')?.addEventListener('click', refreshWorkspaceDevTools);
  document.getElementById('command-clear')?.addEventListener('click', async () => { await api.command.clear(); await refreshWorkspaceTasks(); });
  api.command?.onOutput?.(payload => {
    const task = workspaceState.tasks.find(item => item.id === payload.id);
    if (task) task.output = `${task.output || ''}${payload.data || ''}`.slice(-200000);
    renderWorkspaceTasks();
  });
  api.command?.onExit?.(() => refreshWorkspaceTasks());
  api.activity?.onChanged?.(() => {
    if (document.getElementById('panel-workspaces')?.classList.contains('active')) {
      refreshActivities();
      refreshWorkspaceProjects();
    } else if (document.getElementById('panel-dashboard')?.classList.contains('active')) {
      void refreshDashboardProjects(true);
    }
  });
  api.tunnel?.onChanged?.(() => refreshWorkspaceTunnels());
}

async function refreshWorkspaceCenter() {
  try {
    if (!workspaceState.templates.length) {
      workspaceState.templates = await api.workspace.templates();
      const select = document.getElementById('workspace-template');
      if (select) select.innerHTML = workspaceState.templates.map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`).join('');
      renderWorkspaceServiceChoices([]);
    }
    await Promise.all([refreshWorkspaceProjects(), refreshActivities(), refreshWorkspacePorts(), refreshWorkspaceDevTools(), refreshWorkspaceTasks(), refreshWorkspaceSnapshots(), refreshWorkspacePlugins(), refreshPlatformInventory(), refreshWorkspaceTunnels()]);
  } catch (error) {
    showToast(`Could not load projects: ${error.message}`, 'error');
  }
}

async function refreshWorkspaceProjects() {
  workspaceState.projects = await api.workspace.list();
  dashboardProjectsLoaded = true;
  dashboardProjectsError = '';
  document.getElementById('workspace-count').textContent = workspaceState.projects.length;
  document.getElementById('workspace-running-count').textContent = workspaceState.projects.filter(project => project.state?.status === 'running').length;
  renderWorkspaceCards();
  renderDashboardProjects();
}

function renderWorkspaceCards() {
  const container = document.getElementById('workspace-grid');
  if (!container) return;
  const query = (document.getElementById('workspace-search')?.value || '').trim().toLowerCase();
  const stateFilter = document.getElementById('workspace-state-filter')?.value || 'all';
  const projects = workspaceState.projects.filter(project => {
    const state = project.state?.status || 'stopped';
    if (stateFilter !== 'all' && state !== stateFilter) return false;
    return !query || [project.name, project.domain, project.root, ...(project.services || [])].join(' ').toLowerCase().includes(query);
  });
  if (!projects.length) {
    container.innerHTML = `<div class="workspace-empty">${workspaceState.projects.length ? 'No projects match the selected filters.' : 'No projects yet. Create the first environment from a stack template.'}</div>`;
    return;
  }
  container.innerHTML = projects.map(project => {
    const state = project.state?.status || 'stopped';
    const busy = ['starting', 'stopping'].includes(state);
    return `<article class="workspace-card ${escapeHtml(state)}" style="--project-color:${escapeHtml(project.color || '#e94560')}" data-workspace-id="${escapeHtml(project.id)}">
      <div class="workspace-card-head"><div class="workspace-card-title"><span>${escapeHtml(project.icon)}</span><div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.templateId)}</p></div></div><span class="workspace-state ${escapeHtml(state)}">${escapeHtml(state)}</span></div>
      <div class="workspace-card-domain">${project.https ? '🔒' : '🌐'} ${escapeHtml(project.domain)}</div>
      <div class="workspace-card-meta"><span class="workspace-chip">${escapeHtml(project.activeEnvironment || 'development')}</span>${(project.services || []).map(service => `<span class="workspace-chip">${escapeHtml(sectionLabel(service))}</span>`).join('') || '<span class="workspace-chip">No managed services</span>'}${(project.tags || []).map(tag => `<span class="workspace-chip">#${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="workspace-card-path" title="${escapeHtml(project.root)}">${escapeHtml(project.root)}</div>
      ${['failed', 'interrupted'].includes(state) && project.state?.error ? `<div class="form-help" style="color:${state === 'failed' ? 'var(--danger)' : 'var(--warning)'};margin-bottom:8px">${escapeHtml(project.state.error)}</div>` : ''}
      ${Object.keys(project.commands || {}).length ? `<div class="workspace-command-bar"><span>Commands</span>${workspaceState.platform?.wsl?.supported ? `<select class="workspace-command-target"><option value="host">Windows host</option>${workspaceState.platform.wsl.distributions.map(name => `<option value="${escapeHtml(name)}">WSL · ${escapeHtml(name)}</option>`).join('')}</select>` : ''}${Object.keys(project.commands).map(name => `<button class="btn btn-small workspace-command" data-command="${escapeHtml(name)}">▶ ${escapeHtml(name)}</button>`).join('')}</div>` : ''}
      ${workspaceState.ides.some(ide => ide.installed) ? `<div class="workspace-ide-row"><select class="workspace-ide-select">${workspaceState.ides.filter(ide => ide.installed).map(ide => `<option value="${escapeHtml(ide.id)}">${escapeHtml(ide.name)}</option>`).join('')}</select><button class="btn btn-small workspace-open-ide">Open IDE</button></div>` : ''}
      <div class="workspace-card-actions">
        ${state === 'running' ? '<button class="btn workspace-stop"'+(busy?' disabled':'')+'>⏹ Stop</button>' : '<button class="btn btn-primary workspace-start"'+(busy?' disabled':'')+'>▶ Start</button>'}
        <button class="btn workspace-open-url" ${state !== 'running' ? 'disabled' : ''}>🌐 Open</button>
        <button class="btn workspace-share" ${state !== 'running' || !workspaceState.tunnelProviders.some(item => item.installed) ? 'disabled' : ''}>↗ Share</button>
        <button class="btn workspace-open-dir">📂 Folder</button>
        <button class="btn workspace-preflight">🩺 Check</button>
        <button class="btn workspace-edit">✎ Edit</button>
        ${project.https ? '<button class="btn workspace-certificate">🔒 HTTPS</button>' : ''}
        <button class="btn workspace-export">⇩ Export</button>
        <button class="btn btn-danger workspace-delete">🗑</button>
      </div>
    </article>`;
  }).join('');
  for (const card of container.querySelectorAll('[data-workspace-id]')) bindWorkspaceCard(card);
}

function bindWorkspaceCard(card) {
  const id = card.dataset.workspaceId;
  const project = workspaceState.projects.find(item => item.id === id);
  const run = async (button, action) => {
    button.disabled = true;
    button.classList.add('loading');
    try {
      const result = await action();
      if (result?.preflight) showWorkspacePreflight(result.preflight);
      if (result?.success === false) showToast(result.error || 'Operation failed', 'error');
      else showToast(`${project.name}: operation completed`, 'success');
    } catch (error) { showToast(error.message, 'error'); }
    finally { button.classList.remove('loading'); await refreshWorkspaceCenter(); }
  };
  card.querySelector('.workspace-start')?.addEventListener('click', event => run(event.currentTarget, async () => {
    const result = await api.workspace.start(id);
    if (result.success && project.autoOpen && result.url) await api.shell.openExternal(result.url);
    return result;
  }));
  card.querySelector('.workspace-stop')?.addEventListener('click', event => run(event.currentTarget, () => api.workspace.stop(id)));
  card.querySelector('.workspace-open-url')?.addEventListener('click', async () => {
    const result = await api.workspace.url(id);
    if (result.url) await api.shell.openExternal(result.url);
  });
  card.querySelector('.workspace-share')?.addEventListener('click', event => shareWorkspaceProject(project, event.currentTarget));
  card.querySelector('.workspace-open-dir')?.addEventListener('click', async () => {
    const result = await api.workspace.open(id);
    if (result.webMode && result.path && navigator.clipboard) {
      try { await navigator.clipboard.writeText(result.path); showToast('Server path copied to clipboard', 'success'); } catch {}
    } else if (!result.success) showToast(result.error, 'error');
  });
  card.querySelector('.workspace-preflight')?.addEventListener('click', event => runWorkspacePreflight(project, event.currentTarget));
  card.querySelector('.workspace-edit')?.addEventListener('click', () => openWorkspaceEditor(project));
  card.querySelectorAll('.workspace-command').forEach(button => button.addEventListener('click', () => {
    const target = card.querySelector('.workspace-command-target')?.value || 'host';
    return startWorkspaceCommand(project.id, button.dataset.command, button, target === 'host' ? 'host' : 'wsl', target === 'host' ? '' : target);
  }));
  card.querySelector('.workspace-open-ide')?.addEventListener('click', async () => {
    const ideId = card.querySelector('.workspace-ide-select')?.value;
    const result = await api.ide.open(project.id, ideId);
    showToast(result.success ? `Opened ${project.name} in the selected IDE` : result.error, result.success ? 'success' : 'error');
  });
  card.querySelector('.workspace-certificate')?.addEventListener('click', event => provisionWorkspaceCertificate(project, event.currentTarget));
  card.querySelector('.workspace-export')?.addEventListener('click', async () => downloadWorkspaceManifest(await api.workspace.export(id), `${project.slug}.kitsune.json`));
  card.querySelector('.workspace-delete')?.addEventListener('click', async () => {
    if (!confirm(`Remove project "${project.name}" from KitsuneServ? Project files will be preserved.`)) return;
    const result = await api.workspace.remove(id, { deleteFiles: false });
    if (!result.success) showToast(result.error, 'error');
    else {
      showToast(result.hostsSync?.success === false
        ? `Project removed, but the stale hosts entry could not be removed: ${result.hostsSync.error}`
        : 'Project removed; files were preserved and local domains synchronized', result.hostsSync?.success === false ? 'error' : 'success');
      await refreshWorkspaceCenter();
    }
  });
}

function renderWorkspaceServiceChoices(selected) {
  const container = document.getElementById('workspace-service-choices');
  if (!container) return;
  container.innerHTML = SERVICE_SECTIONS.map(service => `<label class="workspace-service-choice"><input type="checkbox" value="${service}" ${selected.includes(service) ? 'checked' : ''}><span>${SECTION_ICONS[service] || '⚙️'} ${escapeHtml(sectionLabel(service))}</span></label>`).join('');
}

function openWorkspaceEditor(project = null) {
  workspaceEditorProject = project;
  const existing = Boolean(project?.id);
  const detected = Boolean(project?._detected);
  const editor = document.getElementById('workspace-editor');
  editor.classList.remove('hidden');
  document.getElementById('workspace-editor-title').textContent = existing ? `Edit ${project.name}` : detected ? `Import detected project` : 'Create project';
  document.getElementById('workspace-editor-save').textContent = existing ? 'Save changes' : detected ? 'Import project' : 'Create project';
  document.getElementById('workspace-id').value = project?.id || '';
  document.getElementById('workspace-create-directory').value = detected ? 'false' : 'true';
  document.getElementById('workspace-source').value = project?.source ? JSON.stringify(project.source) : '';
  document.getElementById('workspace-name').value = project?.name || '';
  document.getElementById('workspace-root').value = project?.root || '';
  document.getElementById('workspace-domain').value = project?.domain || '';
  document.getElementById('workspace-public-dir').value = project?.publicDir || '.';
  document.getElementById('workspace-https').checked = Boolean(project?.https);
  document.getElementById('workspace-auto-open').checked = project?.autoOpen !== false;
  document.getElementById('workspace-tags').value = (project?.tags || []).join(', ');
  document.getElementById('workspace-color').value = project?.color || '#e94560';
  document.getElementById('workspace-environment').value = project?.activeEnvironment || 'development';
  const activeProfile = project?.environmentProfiles?.[project?.activeEnvironment] || { env: {}, description: 'Local development' };
  document.getElementById('workspace-environment-description').value = activeProfile.description || '';
  document.getElementById('workspace-env').value = formatWorkspaceMap(project?.env);
  document.getElementById('workspace-profile-env').value = formatWorkspaceMap(activeProfile.env);
  document.getElementById('workspace-secrets').value = '';
  document.getElementById('workspace-commands').value = formatWorkspaceMap(project?.commands);
  document.getElementById('workspace-hook-before-start').value = project?.hooks?.beforeStart || '';
  document.getElementById('workspace-hook-after-start').value = project?.hooks?.afterStart || '';
  document.getElementById('workspace-hook-before-stop').value = project?.hooks?.beforeStop || '';
  document.getElementById('workspace-hook-after-stop').value = project?.hooks?.afterStop || '';
  document.getElementById('workspace-memory').value = project?.resourceLimits?.memoryMB || 0;
  document.getElementById('workspace-idle').value = project?.resourceLimits?.idleMinutes || 0;
  const detection = document.getElementById('workspace-detection');
  if (detected || project?.source?.evidence?.length) {
    const confidence = detected ? ` · ${Math.round((project.confidence || 0) * 100)}% confidence` : '';
    detection.innerHTML = `<strong>Detected configuration${confidence}</strong><br>${(project.evidence || project.source?.evidence || []).map(escapeHtml).join(' · ')}`;
    detection.classList.remove('hidden');
  } else detection.classList.add('hidden');
  document.getElementById('workspace-template').value = project?.templateId || workspaceState.templates[0]?.id || 'blank';
  if (project) {
    renderWorkspaceServiceChoices(project.services || []);
    document.getElementById('workspace-template-description').textContent = workspaceState.templates.find(item => item.id === project.templateId)?.description || '';
  } else applyWorkspaceTemplate();
  if (existing) {
    api.workspace.secretKeys(project.id).then(keys => {
      document.getElementById('workspace-secret-keys').textContent = keys.length
        ? `Stored keys: ${keys.join(', ')}. Enter only replacements, or KEY=<remove>. Values are never displayed.`
        : 'No stored secrets. Values are encrypted and are never displayed again.';
    }).catch(() => {});
  } else document.getElementById('workspace-secret-keys').textContent = 'No stored secrets. Values are encrypted and are never displayed again.';
  document.getElementById('workspace-name').focus();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeWorkspaceEditor() {
  workspaceEditorProject = null;
  document.getElementById('workspace-editor')?.classList.add('hidden');
}

function applyWorkspaceTemplate() {
  const template = workspaceState.templates.find(item => item.id === document.getElementById('workspace-template')?.value);
  if (!template) return;
  renderWorkspaceServiceChoices(template.services || []);
  document.getElementById('workspace-public-dir').value = template.publicDir || '.';
  document.getElementById('workspace-template-description').textContent = template.description || '';
  document.getElementById('workspace-commands').value = formatWorkspaceMap(template.commands);
}

function formatWorkspaceMap(value = {}) {
  return Object.entries(value || {}).map(([key, item]) => `${key}=${item}`).join('\n');
}

function parseWorkspaceMap(value, label) {
  const result = {};
  for (const [index, raw] of String(value || '').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`${label}, line ${index + 1}: expected KEY=value`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key)) throw new Error(`${label}, line ${index + 1}: invalid key`);
    result[key] = line.slice(separator + 1).trim();
  }
  return result;
}

function parseWorkspaceSecrets(value) {
  const result = {};
  for (const [key, item] of Object.entries(parseWorkspaceMap(value, 'Encrypted secrets'))) result[key] = item === '<remove>' ? null : item;
  return result;
}

async function detectWorkspaceFolder() {
  try {
    const selected = await api.shell.selectDirectory('');
    if (!selected?.success || !selected.path) return;
    const detected = await api.workspace.detect(selected.path);
    const sourceType = detected.compose ? 'compose' : detected.devcontainer ? 'devcontainer' : detected.git ? 'git' : 'detected';
    openWorkspaceEditor({
      ...detected,
      _detected: true,
      source: {
        type: sourceType,
        file: detected.compose?.file || detected.devcontainer?.file || '',
        evidence: detected.evidence,
        detectedAt: detected.detectedAt
      }
    });
  } catch (error) { showToast(`Could not detect project: ${error.message}`, 'error'); }
}

async function pickWorkspaceRoot() {
  const current = document.getElementById('workspace-root').value;
  const result = await api.shell.selectDirectory(current);
  if (result?.success && result.path) document.getElementById('workspace-root').value = result.path;
}

async function saveWorkspaceEditor() {
  const button = document.getElementById('workspace-editor-save');
  const id = document.getElementById('workspace-id').value;
  let options;
  let secrets;
  try {
    const environment = document.getElementById('workspace-environment').value.trim() || 'development';
    const environmentProfiles = { ...(workspaceEditorProject?.environmentProfiles || {}) };
    environmentProfiles[environment] = {
      description: document.getElementById('workspace-environment-description').value.trim(),
      env: parseWorkspaceMap(document.getElementById('workspace-profile-env').value, 'Profile environment')
    };
    const sourceValue = document.getElementById('workspace-source').value;
    options = {
    name: document.getElementById('workspace-name').value.trim(),
    templateId: document.getElementById('workspace-template').value,
    domain: document.getElementById('workspace-domain').value.trim() || undefined,
    root: document.getElementById('workspace-root').value.trim() || undefined,
    publicDir: document.getElementById('workspace-public-dir').value.trim() || '.',
    https: document.getElementById('workspace-https').checked,
    autoOpen: document.getElementById('workspace-auto-open').checked,
    services: [...document.querySelectorAll('#workspace-service-choices input:checked')].map(input => input.value),
    createDirectory: document.getElementById('workspace-create-directory').value !== 'false',
    tags: document.getElementById('workspace-tags').value.split(',').map(value => value.trim()).filter(Boolean),
    color: document.getElementById('workspace-color').value,
    env: parseWorkspaceMap(document.getElementById('workspace-env').value, 'Base environment'),
    commands: parseWorkspaceMap(document.getElementById('workspace-commands').value, 'Named commands'),
    environmentProfiles,
    activeEnvironment: environment,
    hooks: {
      beforeStart: document.getElementById('workspace-hook-before-start').value.trim(),
      afterStart: document.getElementById('workspace-hook-after-start').value.trim(),
      beforeStop: document.getElementById('workspace-hook-before-stop').value.trim(),
      afterStop: document.getElementById('workspace-hook-after-stop').value.trim()
    },
    resourceLimits: {
      memoryMB: Number(document.getElementById('workspace-memory').value) || 0,
      idleMinutes: Number(document.getElementById('workspace-idle').value) || 0
    },
    source: sourceValue ? JSON.parse(sourceValue) : workspaceEditorProject?.source || null
    };
    secrets = parseWorkspaceSecrets(document.getElementById('workspace-secrets').value);
  } catch (error) { return showToast(error.message, 'error'); }
  if (!options.name) return showToast('Project name is required', 'error');
  button.disabled = true;
  try {
    const result = id ? await api.workspace.update(id, options) : await api.workspace.create(options);
    const secretResult = Object.keys(secrets).length ? await api.workspace.setSecrets(result.id || id, secrets) : { success: true };
    if (secretResult.success === false) throw new Error(secretResult.error || 'Could not save encrypted secrets');
    closeWorkspaceEditor();
    if (result.hostsSync?.success === false) {
      showToast(`${id ? 'Project updated' : 'Project created'}, but the hosts file could not be synchronized: ${result.hostsSync.error}`, 'error');
    } else {
      showToast(`${id ? 'Project updated' : 'Project created'} · ${result.hostsSync?.domains?.length || 0} local domain(s) synchronized`, 'success');
    }
    await refreshWorkspaceCenter();
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; }
}

async function refreshActivities() {
  if (!api.activity) return;
  workspaceState.activities = await api.activity.list({ limit: 50 });
  const running = workspaceState.activities.filter(activity => activity.status === 'running');
  document.getElementById('workspace-busy-count').textContent = running.length;
  const container = document.getElementById('activity-list');
  if (!workspaceState.activities.length) {
    container.innerHTML = '<div class="workspace-empty compact">No operations yet.</div>';
    return;
  }
  const icons = { completed: '✓', failed: '✕', cancelled: '⊘', running: '⟳', interrupted: '⚠' };
  container.innerHTML = workspaceState.activities.map(activity => `<div class="activity-row"><span class="activity-icon ${escapeHtml(activity.status)}">${icons[activity.status] || '•'}</span><div class="activity-main"><strong>${escapeHtml(activity.title)}</strong><span>${escapeHtml(activity.message || activity.stage)} · ${escapeHtml(new Date(activity.updatedAt).toLocaleString())}</span>${activity.status === 'running' ? `<div class="activity-progress"><i style="width:${Number(activity.progress) || 0}%"></i></div>` : ''}</div>${activity.status === 'running' && activity.cancellable !== false ? `<button class="btn btn-small activity-cancel" data-id="${escapeHtml(activity.id)}">Cancel</button>` : `<span class="workspace-state ${escapeHtml(activity.status)}">${escapeHtml(activity.status)}</span>`}</div>`).join('');
  for (const button of container.querySelectorAll('.activity-cancel')) button.addEventListener('click', async () => { await api.activity.cancel(button.dataset.id); await refreshActivities(); });
}

async function runWorkspaceDoctor() {
  const buttons = [document.getElementById('workspace-doctor'), document.getElementById('doctor-run')].filter(Boolean);
  buttons.forEach(button => { button.disabled = true; button.classList.add('loading'); });
  try {
    workspaceState.doctor = await api.diagnostics.doctor();
    document.getElementById('workspace-issue-count').textContent = workspaceState.doctor.issues.length;
    renderWorkspaceDoctor();
    await refreshWorkspacePorts();
    showToast(workspaceState.doctor.healthy ? 'Environment is healthy' : `Doctor found ${workspaceState.doctor.issues.length} issue(s)`, workspaceState.doctor.healthy ? 'success' : 'error');
  } catch (error) { showToast(error.message, 'error'); }
  finally { buttons.forEach(button => { button.disabled = false; button.classList.remove('loading'); }); }
}

async function runWorkspacePreflight(project, button) {
  button.disabled = true;
  button.classList.add('loading');
  try {
    const report = await api.diagnostics.preflight(project.id);
    showWorkspacePreflight(report);
    showToast(report.ready ? `${project.name} is ready to start` : `${project.name}: ${report.counts.error} blocking issue(s)`, report.ready ? 'success' : 'error');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

function showWorkspacePreflight(report) {
  workspaceState.doctor = {
    healthy: report.ready,
    generatedAt: report.generatedAt,
    counts: report.counts,
    issues: report.checks || []
  };
  document.getElementById('workspace-issue-count').textContent = workspaceState.doctor.issues.length;
  renderWorkspaceDoctor();
  document.getElementById('doctor-results')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function repairWorkspaceIssues() {
  const button = document.getElementById('doctor-repair-all');
  button.disabled = true;
  button.classList.add('loading');
  try {
    const result = await api.diagnostics.repairAll();
    workspaceState.doctor = result.report;
    document.getElementById('workspace-issue-count').textContent = result.report.issues.length;
    renderWorkspaceDoctor();
    showToast(result.failed ? `Repaired ${result.repaired}; ${result.failed} repair(s) failed` : `Repaired ${result.repaired} safe issue(s)`, result.failed ? 'error' : 'success');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.classList.remove('loading'); }
}

function renderWorkspaceDoctor() {
  const container = document.getElementById('doctor-results');
  const report = workspaceState.doctor;
  if (!report) return;
  const repairAll = document.getElementById('doctor-repair-all');
  if (repairAll) repairAll.disabled = !report.issues.some(issue => issue.repair && issue.repair !== 'install-version');
  if (!report.issues.length) {
    container.innerHTML = '<div class="workspace-empty compact" style="color:var(--success)">✓ No problems detected.</div>';
    return;
  }
  container.innerHTML = report.issues.map((issue, index) => `<div class="doctor-row"><i class="doctor-severity ${escapeHtml(issue.severity)}"></i><div><strong>${escapeHtml(issue.message)}</strong><span>${escapeHtml(issue.service || issue.path || issue.code)}</span></div>${issue.repair ? `<button class="btn btn-small doctor-repair" data-index="${index}">Repair</button>` : ''}</div>`).join('');
  for (const button of container.querySelectorAll('.doctor-repair')) button.addEventListener('click', async () => {
    const issue = report.issues[Number(button.dataset.index)];
    const result = await api.diagnostics.repair(issue);
    showToast(result.success ? result.message || 'Issue repaired' : result.error, result.success ? 'success' : 'error');
    await runWorkspaceDoctor();
  });
}

async function refreshWorkspacePorts() {
  if (!api.diagnostics) return;
  workspaceState.ports = await api.diagnostics.ports();
  const body = document.getElementById('port-table-body');
  if (!workspaceState.ports.length) {
    body.innerHTML = '<tr><td colspan="5">No configured ports.</td></tr>';
    return;
  }
  body.innerHTML = workspaceState.ports.map(row => `<tr><td>${escapeHtml(sectionLabel(row.service))}</td><td>${escapeHtml(row.field)}</td><td><code>${row.port}</code></td><td>${row.running ? '<span class="port-ok">running</span>' : 'stopped'}</td><td>${row.conflict ? '<span class="port-conflict">configuration conflict</span>' : row.running ? '<span class="port-ok">owned by service</span>' : row.available ? '<span class="port-ok">available</span>' : '<span class="port-busy">occupied externally</span>'}</td></tr>`).join('');
}

async function findWorkspacePort() {
  const start = Number(document.getElementById('port-find-start').value) || 3000;
  const result = await api.diagnostics.findFreePort(start, Math.min(65535, start + 1000));
  showToast(result.success ? `Free port: ${result.port}` : result.error, result.success ? 'success' : 'error');
  if (result.success) document.getElementById('port-find-start').value = result.port;
}

async function syncWorkspaceDomains() {
  const button = document.getElementById('workspace-domain-sync');
  button.disabled = true; button.classList.add('loading');
  try {
    const status = await api.domain.status();
    if (status.synchronized) return showToast('Local domains are already synchronized', 'success');
    const result = await api.domain.apply();
    showToast(result.success ? `Synchronized ${result.domains?.length || 0} local domain(s)` : result.error, result.success ? 'success' : 'error');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function provisionWorkspaceCertificate(project, button) {
  button.disabled = true; button.classList.add('loading');
  try {
    let status = await api.domain.certificateStatus(project.domain);
    if (status.exists) return showToast(`HTTPS certificate is ready${status.expiresAt ? ` until ${new Date(status.expiresAt).toLocaleDateString()}` : ''}`, 'success');
    if (!status.mkcertInstalled) {
      showToast('mkcert is required. Install it with winget install FiloSottile.mkcert, then retry.', 'error');
      return;
    }
    const trusted = await api.domain.installCertificateAuthority();
    if (!trusted.success) throw new Error(trusted.error);
    const issued = await api.domain.issueCertificate(project.domain);
    if (!issued.success) throw new Error(issued.error);
    showToast(`Trusted HTTPS certificate created for ${project.domain}`, 'success');
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function refreshWorkspaceDevTools() {
  if (!api.toolchain) return;
  const button = document.getElementById('toolchain-refresh');
  if (button) { button.disabled = true; button.classList.add('loading'); }
  try {
    [workspaceState.toolchains, workspaceState.ides] = await Promise.all([api.toolchain.list(), api.ide.list()]);
    const container = document.getElementById('toolchain-list');
    container.innerHTML = [...workspaceState.toolchains, ...workspaceState.ides.map(ide => ({ ...ide, category: 'IDE', version: ide.name }))].map(tool => {
      const detail = [tool.version || 'Not found', tool.source, tool.executable].filter(Boolean).join(' · ');
      return `<div class="toolchain-chip ${tool.installed ? 'installed' : ''}" title="${escapeHtml(detail)}">
        <i class="toolchain-dot"></i><strong>${escapeHtml(tool.id)}</strong>
        <span>${tool.installed ? escapeHtml((tool.version || 'available').slice(0, 60)) : 'missing'}${tool.source ? ` · ${escapeHtml(tool.source)}` : ''}</span>
        ${tool.repairable ? `<button class="toolchain-repair" data-tool="${escapeHtml(tool.id)}">Repair</button>` : ''}
        ${tool.manageable ? `<button class="toolchain-manage" data-tool="${escapeHtml(tool.id)}">Manage</button>` : ''}
      </div>`;
    }).join('');
    container.querySelectorAll('.toolchain-repair').forEach(repair => repair.addEventListener('click', async event => {
      event.stopPropagation();
      const action = event.currentTarget;
      action.disabled = true;
      action.textContent = 'Repairing…';
      try {
        const result = await api.toolchain.repair(action.dataset.tool);
        if (!result.success) throw new Error(result.error || 'Tool repair failed');
        showToast('Full managed Python with pip installed', 'success');
        await refreshWorkspaceDevTools();
        await refreshPathManagement();
      } catch (error) {
        showToast(error.message || 'Tool repair failed', 'error');
        action.disabled = false;
        action.textContent = 'Repair';
      }
    }));
    container.querySelectorAll('.toolchain-manage').forEach(manage => manage.addEventListener('click', event => {
      event.stopPropagation();
      openVersionManager(event.currentTarget.dataset.tool);
    }));
    renderWorkspaceCards();
  } catch (error) { showToast(`Toolchain scan failed: ${error.message}`, 'error'); }
  finally { if (button) { button.disabled = false; button.classList.remove('loading'); } }
}

async function startWorkspaceCommand(projectId, name, button, execution = 'host', distribution = '') {
  button.disabled = true; button.classList.add('loading');
  try {
    const result = await api.command.start(projectId, name, execution, distribution);
    showToast(result.success ? `Started command: ${name}${execution === 'wsl' ? ` in WSL ${distribution}` : ''}` : result.error, result.success ? 'success' : 'error');
    await refreshWorkspaceTasks();
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; button.classList.remove('loading'); }
}

async function refreshWorkspaceTasks() {
  if (!api.command) return;
  workspaceState.tasks = await api.command.list();
  renderWorkspaceTasks();
}

function renderWorkspaceTasks() {
  const container = document.getElementById('command-task-list');
  if (!container) return;
  if (!workspaceState.tasks.length) {
    container.innerHTML = '<div class="workspace-empty compact">No project commands started.</div>';
    return;
  }
  container.innerHTML = workspaceState.tasks.map(task => `<div class="command-task"><div class="command-task-head"><span class="workspace-state ${escapeHtml(task.status)}">${escapeHtml(task.status)}</span><strong>${escapeHtml(task.projectName)} · ${escapeHtml(task.commandName)}</strong>${['running','stopping'].includes(task.status) ? `<button class="btn btn-small btn-danger command-stop" data-id="${escapeHtml(task.id)}">Stop</button>` : `<span>${task.exitCode == null ? '' : `exit ${task.exitCode}`}</span>`}</div>${task.output ? `<pre class="command-output">${escapeHtml(task.output.slice(-12000))}</pre>` : ''}</div>`).join('');
  container.querySelectorAll('.command-stop').forEach(button => button.addEventListener('click', async () => { await api.command.stop(button.dataset.id); await refreshWorkspaceTasks(); }));
}

function downloadWorkspaceManifest(manifest, filename) {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function importWorkspaceManifest() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.kitsune.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return showToast('Project manifest is too large', 'error');
    try {
      const manifest = JSON.parse(await file.text());
      const result = await api.workspace.import(manifest, { createDirectory: true });
      showToast(result.hostsSync?.success === false
        ? `Project imported, but the hosts file could not be synchronized: ${result.hostsSync.error}`
        : 'Project imported and local domain synchronized', result.hostsSync?.success === false ? 'error' : 'success');
      await refreshWorkspaceCenter();
    } catch (error) { showToast(error.message, 'error'); }
  }, { once: true });
  input.click();
}

async function exportWorkspaceEnvironment() {
  try {
    const payload = await api.environment.export('manual export');
    downloadWorkspaceManifest(payload, `kitsuneserv-environment-${new Date().toISOString().slice(0, 10)}.json`);
    showToast(`Exported ${payload.projects.length} project(s) without secrets`, 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

function importWorkspaceEnvironment() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return showToast('Environment file is too large', 'error');
    try {
      const payload = JSON.parse(await file.text());
      const inspection = await api.environment.inspect(payload);
      const missing = inspection.missingVersions.length;
      if (!confirm(`Import ${inspection.projects} project(s), update ${inspection.updatedProjects.length} existing project(s) and apply PATH settings?${missing ? ` ${missing} referenced version(s) must be installed separately.` : ''}`)) return;
      let result = await api.environment.apply(payload, { stopServices: false });
      if (result.needsStop && confirm(`${result.error}\n\nStop all services and continue?`)) result = await api.environment.apply(payload, { stopServices: true });
      showToast(result.success ? 'Environment imported successfully' : result.error, result.success ? 'success' : 'error');
      if (result.success) { config = await api.config.get(); populateUI(); await refreshWorkspaceCenter(); }
    } catch (error) { showToast(error.message, 'error'); }
  }, { once: true });
  input.click();
}

async function createWorkspaceSnapshot() {
  const label = prompt('Snapshot label (optional):', `Before changes ${new Date().toLocaleString()}`);
  if (label === null) return;
  try {
    const result = await api.environment.createSnapshot(label);
    showToast(result.success ? `Snapshot created (${result.snapshot.projects} projects)` : result.error, result.success ? 'success' : 'error');
    await refreshWorkspaceSnapshots();
  } catch (error) { showToast(error.message, 'error'); }
}

async function refreshWorkspaceSnapshots() {
  if (!api.environment) return;
  workspaceState.snapshots = await api.environment.listSnapshots();
  const container = document.getElementById('snapshot-list');
  if (!container) return;
  if (!workspaceState.snapshots.length) {
    container.innerHTML = '<div class="workspace-empty compact">No snapshots yet.</div>';
    return;
  }
  container.innerHTML = workspaceState.snapshots.map(snapshot => `<div class="snapshot-row"><span>${snapshot.valid ? '◉' : '⚠'}</span><div class="snapshot-info"><strong>${escapeHtml(snapshot.label || snapshot.id)}</strong><span>${snapshot.createdAt ? escapeHtml(new Date(snapshot.createdAt).toLocaleString()) : 'Unreadable'} · ${snapshot.projects || 0} projects · ${formatBackupSize(snapshot.size)}</span></div><button class="btn btn-small snapshot-restore" data-id="${escapeHtml(snapshot.id)}" ${snapshot.valid ? '' : 'disabled'}>Restore</button><button class="btn btn-small btn-danger snapshot-delete" data-id="${escapeHtml(snapshot.id)}">🗑</button></div>`).join('');
  container.querySelectorAll('.snapshot-restore').forEach(button => button.addEventListener('click', () => restoreWorkspaceSnapshot(button.dataset.id)));
  container.querySelectorAll('.snapshot-delete').forEach(button => button.addEventListener('click', () => removeWorkspaceSnapshot(button.dataset.id)));
}

async function restoreWorkspaceSnapshot(id) {
  if (!confirm('Restore this environment snapshot? Current project metadata and service configuration may be changed.')) return;
  let result = await api.environment.restoreSnapshot(id, { stopServices: false });
  if (result.needsStop && confirm(`${result.error}\n\nStop all services and continue?`)) result = await api.environment.restoreSnapshot(id, { stopServices: true });
  showToast(result.success ? 'Environment snapshot restored' : result.error, result.success ? 'success' : 'error');
  if (result.success) { config = await api.config.get(); populateUI(); await refreshWorkspaceCenter(); }
}

async function removeWorkspaceSnapshot(id) {
  if (!confirm('Permanently remove this snapshot?')) return;
  const result = await api.environment.removeSnapshot(id);
  showToast(result.success ? 'Snapshot removed' : result.error, result.success ? 'success' : 'error');
  await refreshWorkspaceSnapshots();
}

async function refreshWorkspacePlugins() {
  if (!api.plugin) return;
  workspaceState.plugins = await api.plugin.list();
  const container = document.getElementById('plugin-list');
  if (!container) return;
  if (!workspaceState.plugins.length) {
    container.innerHTML = '<div class="workspace-empty compact">No plugins installed.</div>';
    return;
  }
  container.innerHTML = workspaceState.plugins.map(plugin => `<div class="plugin-row"><span>${plugin.integrity ? '🧩' : '⚠'}</span><div class="plugin-info"><strong>${escapeHtml(plugin.name || plugin.id)} · ${escapeHtml(plugin.version || '')}</strong><span>${plugin.integrity ? `${plugin.contributes?.projectTemplates?.length || 0} templates · ${plugin.contributes?.tools?.length || 0} tools` : escapeHtml(plugin.error || 'Integrity check failed')}</span></div><button class="btn btn-small plugin-toggle" data-id="${escapeHtml(plugin.id)}" ${plugin.integrity ? '' : 'disabled'}>${plugin.enabled ? 'Disable' : 'Enable'}</button><button class="btn btn-small btn-danger plugin-remove" data-id="${escapeHtml(plugin.id)}">🗑</button></div>`).join('');
  container.querySelectorAll('.plugin-toggle').forEach(button => button.addEventListener('click', async () => {
    const plugin = workspaceState.plugins.find(item => item.id === button.dataset.id);
    const result = await api.plugin.setEnabled(plugin.id, !plugin.enabled);
    showToast(result.success ? 'Plugin state changed; templates refreshed' : result.error, result.success ? 'success' : 'error');
    workspaceState.templates = await api.workspace.templates(); await refreshWorkspacePlugins();
  }));
  container.querySelectorAll('.plugin-remove').forEach(button => button.addEventListener('click', async () => {
    if (!confirm(`Remove plugin ${button.dataset.id}?`)) return;
    const result = await api.plugin.remove(button.dataset.id);
    showToast(result.success ? 'Plugin removed' : result.error, result.success ? 'success' : 'error');
    workspaceState.templates = await api.workspace.templates(); await refreshWorkspacePlugins();
  }));
}

async function installWorkspacePlugin() {
  const selected = await api.shell.selectDirectory('');
  if (!selected?.success) return;
  const result = await api.plugin.install(selected.path);
  showToast(result.success ? `Installed plugin ${result.plugin.name}` : result.error, result.success ? 'success' : 'error');
  if (result.success) workspaceState.templates = await api.workspace.templates();
  await refreshWorkspacePlugins();
}

async function shareWorkspaceProject(project, button) {
  const active = workspaceState.tunnels.find(item => item.projectId === project.id && ['starting', 'running'].includes(item.status));
  if (active?.publicUrl) return api.shell.openExternal(active.publicUrl);
  if (active) return showToast('A tunnel for this project is still starting', 'success');
  const provider = workspaceState.tunnelProviders.find(item => item.installed);
  if (!provider) return showToast('Install cloudflared or ngrok and make it available in PATH', 'error');
  button.disabled = true;
  button.classList.add('loading');
  try {
    const result = await api.tunnel.start(project.id, provider.id);
    showToast(result.success ? `Starting ${provider.name} tunnel…` : result.error, result.success ? 'success' : 'error');
    await refreshWorkspaceTunnels();
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.classList.remove('loading'); button.disabled = false; }
}

async function refreshWorkspaceTunnels() {
  if (!api.tunnel) return;
  [workspaceState.tunnelProviders, workspaceState.tunnels] = await Promise.all([api.tunnel.providers(), api.tunnel.list()]);
  const providers = document.getElementById('tunnel-providers');
  const container = document.getElementById('tunnel-list');
  if (providers) providers.innerHTML = workspaceState.tunnelProviders.map(item => `<span class="platform-chip ${item.installed ? 'available' : ''}">${escapeHtml(item.name)} ${item.installed ? '✓' : '—'}</span>`).join('');
  if (!container) return;
  if (!workspaceState.tunnels.length) {
    container.innerHTML = '<div class="workspace-empty compact">No active tunnels. Start a project and choose Share.</div>';
    renderWorkspaceCards();
    return;
  }
  container.innerHTML = workspaceState.tunnels.map(tunnel => `<div class="tunnel-row"><span class="workspace-state ${escapeHtml(tunnel.status)}">${escapeHtml(tunnel.status)}</span><div class="tunnel-info"><strong>${escapeHtml(tunnel.projectName)} · ${escapeHtml(tunnel.provider)}</strong><span title="${escapeHtml(tunnel.publicUrl || tunnel.localUrl)}">${escapeHtml(tunnel.publicUrl || tunnel.localUrl)}</span></div><div class="tunnel-actions">${tunnel.publicUrl ? `<button class="btn btn-small tunnel-open" data-url="${escapeHtml(tunnel.publicUrl)}">Open</button>` : ''}${['starting','running'].includes(tunnel.status) ? `<button class="btn btn-small btn-danger tunnel-stop" data-id="${escapeHtml(tunnel.id)}">Stop</button>` : ''}</div></div>`).join('');
  container.querySelectorAll('.tunnel-open').forEach(button => button.addEventListener('click', () => api.shell.openExternal(button.dataset.url)));
  container.querySelectorAll('.tunnel-stop').forEach(button => button.addEventListener('click', async () => { await api.tunnel.stop(button.dataset.id); await refreshWorkspaceTunnels(); }));
  renderWorkspaceCards();
}

async function refreshPlatformInventory() {
  if (!api.platform) return;
  workspaceState.platform = await api.platform.inventory();
  const data = workspaceState.platform;
  const container = document.getElementById('platform-inventory');
  if (!container) return;
  container.innerHTML = `<div class="platform-group"><strong>Package managers</strong><div class="platform-chips">${data.packageManagers.map(item => `<span class="platform-chip ${item.installed ? 'available' : ''}">${escapeHtml(item.id)} ${item.installed ? '✓' : '—'}</span>`).join('') || '<span class="platform-chip">none detected</span>'}</div></div>
    <div class="platform-group"><strong>WSL</strong><div class="platform-chips">${data.wsl.supported ? data.wsl.distributions.map(item => `<span class="platform-chip available">${escapeHtml(item)}</span>`).join('') || '<span class="platform-chip available">available</span>' : '<span class="platform-chip">not available on this platform</span>'}</div></div>
    <div class="platform-group"><strong>systemd user service</strong><div class="platform-chips"><span class="platform-chip ${data.systemd.supported ? 'available' : ''}">${data.systemd.supported ? data.systemd.installed ? data.systemd.active ? 'installed · running' : 'installed · stopped' : 'available' : 'not available'}</span></div>${data.systemd.supported ? `<div class="platform-actions">${data.systemd.installed ? '<button class="btn btn-small btn-danger" id="platform-systemd-remove">Remove service</button>' : '<button class="btn btn-small btn-primary" id="platform-systemd-install">Install & start</button>'}</div>` : ''}</div>`;
  container.querySelector('#platform-systemd-install')?.addEventListener('click', async () => {
    const result = await api.platform.installSystemd({ port: 10000, host: '127.0.0.1' });
    if (result.success && result.credentialsCreated) {
      await navigator.clipboard?.writeText?.(result.generatedPassword).catch(() => {});
      container.insertAdjacentHTML('afterbegin', `<div class="db-warning"><strong>Save this generated server password now:</strong><br><code>${escapeHtml(result.generatedPassword)}</code><br>It was copied to the clipboard and will not be displayed again.</div>`);
    }
    showToast(result.success ? 'KitsuneServ systemd user service installed' : result.error, result.success ? 'success' : 'error');
    if (!result.credentialsCreated) await refreshPlatformInventory();
  });
  container.querySelector('#platform-systemd-remove')?.addEventListener('click', async () => {
    const result = await api.platform.removeSystemd(); showToast(result.success ? 'systemd service removed' : result.error, result.success ? 'success' : 'error'); await refreshPlatformInventory();
  });
  renderWorkspaceCards();
}

/* ===== Remote access and SFTP file manager ===== */
const remoteState = { sessions: [], storageProfiles: [], active: null, cloudActive: null, local: null, remote: null, selectedLocal: null, selectedRemote: null, lastSide: 'local', modalPurpose: 'files', transfers: [], editor: null, syncPreview: null };

function remoteInput() {
  return {
    id: document.getElementById('remote-session-id').value || undefined,
    name: document.getElementById('remote-session-name').value,
    group: document.getElementById('remote-session-group').value,
    favorite: document.getElementById('remote-session-favorite').checked,
    production: document.getElementById('remote-session-production').checked,
    jumpHostId: document.getElementById('remote-session-jump').value,
    useAgent: document.getElementById('remote-session-agent').checked,
    agentForward: document.getElementById('remote-session-agent-forward').checked,
    tmuxSession: document.getElementById('remote-session-tmux').value,
    hostFingerprint: document.getElementById('remote-session-fingerprint').value,
    type: document.getElementById('remote-session-type').value,
    host: document.getElementById('remote-session-host').value,
    port: Number(document.getElementById('remote-session-port').value),
    baudRate: Number(document.getElementById('remote-session-baud').value),
    username: document.getElementById('remote-session-user').value,
    auth: document.getElementById('remote-session-auth').value,
    privateKeyPath: document.getElementById('remote-session-key').value,
    remotePath: document.getElementById('remote-session-path').value || '/',
    password: document.getElementById('remote-session-password').value,
    passphrase: document.getElementById('remote-session-passphrase').value
  };
}

function openRemoteSessionModal(purpose = 'files', session = null) {
  if (!api.remote) return showToast('Remote access is available in the desktop application', 'warning');
  remoteState.modalPurpose = purpose;
  const value = session || {};
  document.getElementById('remote-session-id').value = value.id || '';
  document.getElementById('remote-session-name').value = value.name || '';
  document.getElementById('remote-session-group').value = value.group || '';
  document.getElementById('remote-session-favorite').checked = Boolean(value.favorite);
  document.getElementById('remote-session-production').checked = Boolean(value.production);
  document.getElementById('remote-session-agent').checked = Boolean(value.useAgent);
  document.getElementById('remote-session-agent-forward').checked = Boolean(value.agentForward);
  document.getElementById('remote-session-tmux').value = value.tmuxSession || '';
  const jump = document.getElementById('remote-session-jump'); jump.innerHTML = '<option value="">Direct connection</option>'; for (const item of remoteState.sessions.filter(item => item.id !== value.id && item.type !== 'rdp')) { const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} · ${item.host}`; jump.appendChild(option); } jump.value = value.jumpHostId || '';
  document.getElementById('remote-session-fingerprint').value = value.hostFingerprint || '';
  document.getElementById('remote-session-type').value = value.type || (purpose === 'files' ? 'sftp' : 'ssh');
  document.getElementById('remote-session-host').value = value.host || '';
  document.getElementById('remote-session-port').value = value.port || 22;
  document.getElementById('remote-session-baud').value = value.baudRate || 115200;
  document.getElementById('remote-session-user').value = value.username || '';
  document.getElementById('remote-session-auth').value = value.auth || 'password';
  document.getElementById('remote-session-key').value = value.privateKeyPath || '';
  document.getElementById('remote-session-path').value = value.remotePath || '/';
  document.getElementById('remote-session-password').value = '';
  document.getElementById('remote-session-passphrase').value = '';
  document.getElementById('remote-session-password').placeholder = value.id ? 'Leave empty to keep existing' : 'Password';
  document.getElementById('remote-session-passphrase').placeholder = value.id ? 'Leave empty to keep existing' : 'Private key passphrase';
  document.getElementById('remote-session-modal').classList.remove('hidden');
}

function closeRemoteSessionModal() { document.getElementById('remote-session-modal')?.classList.add('hidden'); }

function storageInput() { return { id: document.getElementById('storage-profile-id').value || undefined, name: document.getElementById('storage-profile-name').value, type: document.getElementById('storage-profile-type').value, host: document.getElementById('storage-profile-host').value, port: Number(document.getElementById('storage-profile-port').value), endpoint: document.getElementById('storage-profile-endpoint').value, username: document.getElementById('storage-profile-user').value, region: document.getElementById('storage-profile-region').value, bucket: document.getElementById('storage-profile-bucket').value, container: document.getElementById('storage-profile-container').value, rootPath: document.getElementById('storage-profile-root').value, production: document.getElementById('storage-profile-production').checked }; }
function storageSecrets() { return { password: document.getElementById('storage-profile-password').value, accessKeyId: document.getElementById('storage-profile-access-key').value, secretAccessKey: document.getElementById('storage-profile-secret-key').value, connectionString: document.getElementById('storage-profile-connection').value }; }
function openStorageProfile(profile = {}) { document.getElementById('storage-profile-id').value = profile.id || ''; document.getElementById('storage-profile-name').value = profile.name || ''; document.getElementById('storage-profile-type').value = profile.type || 'ftps'; document.getElementById('storage-profile-host').value = profile.host || ''; document.getElementById('storage-profile-port').value = profile.port || 21; document.getElementById('storage-profile-endpoint').value = profile.endpoint || ''; document.getElementById('storage-profile-user').value = profile.username || ''; document.getElementById('storage-profile-region').value = profile.region || 'us-east-1'; document.getElementById('storage-profile-bucket').value = profile.bucket || ''; document.getElementById('storage-profile-container').value = profile.container || ''; document.getElementById('storage-profile-root').value = profile.rootPath || '/'; document.getElementById('storage-profile-production').checked = Boolean(profile.production); for (const id of ['storage-profile-password','storage-profile-access-key','storage-profile-secret-key','storage-profile-connection']) document.getElementById(id).value = ''; document.getElementById('storage-profile-modal').classList.remove('hidden'); }
function closeStorageProfile() { document.getElementById('storage-profile-modal').classList.add('hidden'); }

function initRemoteAccess() {
  document.getElementById('fm-command-deck')?.addEventListener('click', () => { switchToPanel('operations-center'); selectVisionTab('workspace'); document.querySelector('.tf-deck')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const panel = document.getElementById('panel-file-manager');
  if (!panel) return;
  if (!api.remote || !api.files) {
    panel.querySelector('.file-manager-main').innerHTML = '<div class="file-empty">Remote desktop features are available only in the KitsuneServ desktop application.</div>';
    return;
  }
  document.getElementById('fm-new-session').addEventListener('click', () => openRemoteSessionModal('files'));
  document.getElementById('fm-new-storage').addEventListener('click', () => openStorageProfile());
  document.getElementById('fm-open-winscp').addEventListener('click', async () => { if (!remoteState.active) return showToast('Choose an SFTP session', 'warning'); try { await api.remote.openWinScp(remoteState.active); showToast('WinSCP Portable opened', 'success'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('fm-import-sessions').addEventListener('click', async () => { try { const result = await api.remote.importProfiles(); if (result.canceled) return; await loadRemoteSessions(); showToast(`Imported ${result.imported.length} ${result.format} profile(s)`, 'success'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('fm-export-sessions').addEventListener('click', async () => { try { const result = await api.remote.exportProfiles(); if (result.success) showToast('Portable profiles exported without passwords or host trust state', 'success'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('fm-session-filter').addEventListener('input', renderRemoteSessions);
  document.getElementById('btn-terminal-session').addEventListener('click', () => openRemoteSessionModal('terminal'));
  document.getElementById('btn-terminal-connect').addEventListener('click', async () => {
    const id = document.getElementById('terminal-remote-select').value;
    const session = remoteState.sessions.find(item => item.id === id);
    if (!session) return showToast('Choose a saved SSH session', 'warning');
    if (session.type === 'rdp') return api.remote.openRdp(session);
    await createTerminal(session);
  });
  document.getElementById('remote-session-close').addEventListener('click', closeRemoteSessionModal);
  document.getElementById('remote-session-cancel').addEventListener('click', closeRemoteSessionModal);
  document.getElementById('remote-session-reset-key').addEventListener('click', async () => {
    const id = document.getElementById('remote-session-id').value;
    if (!id || !confirm('Forget the pinned SSH host key? The next successful connection will trust and pin a new key.')) return;
    await api.remote.resetHostKey(id); document.getElementById('remote-session-fingerprint').value = ''; await loadRemoteSessions();
  });
  document.getElementById('remote-session-type').addEventListener('change', event => {
    const port = document.getElementById('remote-session-port');
    port.value = event.target.value === 'rdp' ? 3389 : event.target.value === 'vnc' ? 5900 : event.target.value === 'telnet' ? 23 : 22;
  });
  document.getElementById('remote-session-test').addEventListener('click', async () => {
    const input = remoteInput();
    if (['rdp', 'vnc', 'telnet', 'serial'].includes(input.type)) return showToast(`${input.type.toUpperCase()} profile is validated when launched`, 'success');
    const result = await api.remote.test(input);
    showToast(result.success ? 'Connection successful' : result.error, result.success ? 'success' : 'error');
  });
  document.getElementById('remote-session-save').addEventListener('click', async () => {
    const input = remoteInput();
    try {
      const secrets = {};
      if (input.password) secrets.password = input.password;
      if (input.passphrase) secrets.passphrase = input.passphrase;
      const result = await api.remote.save(input, secrets);
      if (!result.success) return showToast(result.error || 'Could not save session', 'error');
      closeRemoteSessionModal();
      await loadRemoteSessions();
      if (remoteState.modalPurpose === 'workspace') {
        switchToPanel('server-workspace'); document.getElementById('workspace-server-select').value = result.session.id; await refreshServerWorkspace();
      } else if (['rdp', 'vnc'].includes(input.type)) {
        const opened = input.type === 'rdp' ? await api.remote.openRdp(result.session) : await api.remote.openVnc(result.session);
        if (!opened.success) showToast(opened.error, 'error');
      } else if (remoteState.modalPurpose === 'terminal' || ['ssh', 'telnet', 'serial'].includes(input.type)) {
        switchToPanel('terminal');
        await createTerminal(result.session);
      } else {
        switchToPanel('file-manager');
        await selectRemoteSession(result.session.id);
      }
    } catch (error) { showToast(error.message, 'error'); }
  });
  document.getElementById('fm-refresh').addEventListener('click', refreshFileManager);
  document.getElementById('fm-local-path').addEventListener('keydown', event => { if (event.key === 'Enter') loadLocalFiles(event.target.value); });
  document.getElementById('fm-remote-path').addEventListener('keydown', event => { if (event.key === 'Enter') loadRemoteFiles(event.target.value); });
  document.getElementById('fm-local-up').addEventListener('click', () => remoteState.local?.parent && loadLocalFiles(remoteState.local.parent));
  document.getElementById('fm-remote-up').addEventListener('click', () => remoteState.remote?.parent && loadRemoteFiles(remoteState.remote.parent));
  document.getElementById('fm-upload').addEventListener('click', () => transferSelected('upload'));
  document.getElementById('fm-download').addEventListener('click', () => transferSelected('download'));
  document.getElementById('fm-server-transfer').addEventListener('click', transferServerToServer);
  document.getElementById('fm-mkdir').addEventListener('click', () => mutateSelected('mkdir'));
  document.getElementById('fm-rename').addEventListener('click', () => mutateSelected('rename'));
  document.getElementById('fm-delete').addEventListener('click', () => mutateSelected('delete'));
  document.getElementById('fm-chmod').addEventListener('click', () => mutateSelected('chmod'));
  document.getElementById('fm-edit').addEventListener('click', openSelectedFile);
  document.getElementById('fm-preview').addEventListener('click', previewSelectedFile);
  document.getElementById('fm-compare').addEventListener('click', compareSelectedFiles);
  document.getElementById('fm-merge3').addEventListener('click', mergeSelectedFiles);
  document.getElementById('fm-sync').addEventListener('click', previewFileSynchronization);
  document.getElementById('fm-search').addEventListener('keydown', event => { if (event.key === 'Enter') searchFiles(event.target.value); });
  document.getElementById('fm-queue-clear').addEventListener('click', () => { remoteState.transfers = remoteState.transfers.filter(item => item.status === 'running'); renderTransferQueue(); });
  document.getElementById('file-editor-close').addEventListener('click', closeFileEditor);
  document.getElementById('file-editor-cancel').addEventListener('click', closeFileEditor);
  document.getElementById('file-editor-save').addEventListener('click', saveEditedFile);
  document.getElementById('file-editor-wrap').addEventListener('click', () => document.getElementById('file-editor-content').classList.toggle('wrap'));
  document.getElementById('file-sync-close').addEventListener('click', closeFileSynchronization); document.getElementById('file-sync-cancel').addEventListener('click', closeFileSynchronization);
  document.getElementById('file-sync-all').addEventListener('change', event => document.querySelectorAll('#file-sync-list input:not(:disabled)').forEach(input => { input.checked = event.target.checked; }));
  document.getElementById('file-sync-upload').addEventListener('click', () => applyFileSynchronization('upload')); document.getElementById('file-sync-download').addEventListener('click', () => applyFileSynchronization('download'));
  document.getElementById('file-diff-close').addEventListener('click', closeFileDiff); document.getElementById('file-diff-done').addEventListener('click', closeFileDiff);
  document.getElementById('file-preview-close').addEventListener('click', closeFilePreview); document.getElementById('file-preview-done').addEventListener('click', closeFilePreview);
  document.getElementById('storage-profile-close').addEventListener('click', closeStorageProfile); document.getElementById('storage-profile-cancel').addEventListener('click', closeStorageProfile);
  document.getElementById('storage-profile-test').addEventListener('click', async () => { try { const saved = await api.storage.save(storageInput(), storageSecrets()); const result = await api.storage.test(saved.profile); showToast(result.success ? 'Storage connection successful' : 'Storage connection failed', result.success ? 'success' : 'error'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('storage-profile-save').addEventListener('click', async () => { try { const result = await api.storage.save(storageInput(), storageSecrets()); closeStorageProfile(); await loadRemoteSessions(); await selectStorageProfile(result.profile.id); showToast('Storage profile saved', 'success'); } catch (error) { showToast(error.message, 'error'); } });
  api.files.onTransferProgress(progress => {
    const item = remoteState.transfers.find(entry => entry.id === progress.transferId); if (!item) return;
    item.name = progress.name || item.name; item.transferred = progress.transferred || 0; item.total = progress.total || 0; item.files = progress.files || 0; renderTransferQueue();
  });
  document.getElementById('ssh-tunnel-start').addEventListener('click', startSshTunnel);
  void refreshFileManager();
  void refreshSshTunnels();
}

async function loadRemoteSessions() {
  [remoteState.sessions, remoteState.storageProfiles] = await Promise.all([api.remote.list(), api.storage?.list?.() || []]);
  renderRemoteSessions();
  renderStorageSessions();
  renderTerminalSessionOptions();
  if (document.getElementById('panel-server-workspace')?.classList.contains('active')) void refreshServerWorkspace();
}

function renderTerminalSessionOptions() {
  const select = document.getElementById('terminal-remote-select');
  const tunnelSelect = document.getElementById('ssh-tunnel-session');
  for (const target of [select, tunnelSelect]) {
    if (!target) continue;
    const selected = target.value; target.innerHTML = `<option value="">${target === tunnelSelect ? 'SSH session…' : 'Saved SSH sessions…'}</option>`;
    for (const session of remoteState.sessions.filter(item => ['ssh', 'telnet', 'serial'].includes(item.type))) { const option = document.createElement('option'); option.value = session.id; option.textContent = `${session.name} · ${session.host}`; target.appendChild(option); }
    target.value = selected;
  }
}

function renderRemoteSessions() {
  const list = document.getElementById('fm-session-list');
  if (!list) return;
  list.innerHTML = '';
  const needle = document.getElementById('fm-session-filter')?.value.toLowerCase() || '';
  const sessions = remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type) && `${item.name} ${item.host} ${item.group || ''}`.toLowerCase().includes(needle)).sort((a, b) => Number(b.favorite) - Number(a.favorite) || (a.group || '').localeCompare(b.group || '') || a.name.localeCompare(b.name));
  if (!sessions.length) list.innerHTML = '<div class="file-empty">No saved servers</div>';
  for (const session of sessions) {
    const card = document.createElement('div');
    card.className = `remote-session-card${remoteState.active?.id === session.id ? ' active' : ''}`;
    card.innerHTML = `<i style="background:${escapeHtml(session.color || '#6f7bff')}"></i><span><strong>${session.favorite ? '★ ' : ''}${session.production ? '◆ ' : ''}${escapeHtml(session.name)}</strong><small>${escapeHtml(session.group ? `${session.group} · ${session.host}` : (session.username ? `${session.username}@${session.host}` : session.host))}</small></span><button class="session-copy" title="Duplicate session">⧉</button><button class="session-remove" title="Remove session">×</button>`;
    card.addEventListener('dblclick', () => openRemoteSessionModal('files', session));
    card.addEventListener('click', event => { if (!event.target.closest('button')) selectRemoteSession(session.id); });
    card.querySelector('.session-copy').addEventListener('click', async event => {
      event.stopPropagation();
      const result = await api.remote.duplicate(session.id);
      if (!result?.success) return showToast(result?.error || 'Could not duplicate session', 'error');
      await loadRemoteSessions();
      showToast('Session duplicated', 'success');
    });
    card.querySelector('.session-remove').addEventListener('click', async event => {
      event.stopPropagation();
      if (!confirm(`Remove saved session "${session.name}"?`)) return;
      const result = await api.remote.remove(session.id);
      if (!result?.success) return showToast(result?.error || 'Could not remove session', 'error');
      if (remoteState.active?.id === session.id) remoteState.active = null;
      await loadRemoteSessions();
    });
    list.appendChild(card);
  }
}

function renderStorageSessions() {
  const list = document.getElementById('fm-storage-list'); if (!list) return; list.innerHTML = '';
  if (!remoteState.storageProfiles.length) list.innerHTML = '<div class="file-empty compact">No cloud storage</div>';
  for (const profile of remoteState.storageProfiles) { const card = document.createElement('div'); card.className = `remote-session-card${remoteState.cloudActive?.id === profile.id ? ' active' : ''}`; card.innerHTML = `<i style="background:#42b3a7"></i><span><strong>${profile.production ? '◆ ' : ''}${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.type.toUpperCase())} · ${escapeHtml(profile.bucket || profile.container || profile.host || profile.endpoint)}</small></span><button class="session-copy" title="Edit storage">✎</button><button class="session-remove" title="Remove storage">×</button>`; card.addEventListener('click', event => { if (!event.target.closest('button')) selectStorageProfile(profile.id); }); card.addEventListener('dblclick', () => openStorageProfile(profile)); card.querySelector('.session-copy').addEventListener('click', event => { event.stopPropagation(); openStorageProfile(profile); }); card.querySelector('.session-remove').addEventListener('click', async event => { event.stopPropagation(); if (!confirm(`Remove storage profile "${profile.name}"?`)) return; await api.storage.remove(profile.id); if (remoteState.cloudActive?.id === profile.id) remoteState.cloudActive = null; await loadRemoteSessions(); }); list.appendChild(card); }
}

async function refreshFileManager() {
  if (!api.files) return;
  await Promise.all([loadRemoteSessions(), loadLocalFiles(remoteState.local?.path || '')]);
  if (remoteState.active) await loadRemoteFiles(remoteState.remote?.path || remoteState.active.remotePath || '/');
  else if (remoteState.cloudActive) await loadRemoteFiles(remoteState.remote?.path || remoteState.cloudActive.rootPath || '');
}

async function selectRemoteSession(id) {
  remoteState.active = remoteState.sessions.find(item => item.id === id) || null;
  remoteState.cloudActive = null;
  remoteState.remote = null; remoteState.selectedRemote = null;
  await loadRemoteSessions();
  if (remoteState.active) await loadRemoteFiles(remoteState.active.remotePath || '/');
}

async function selectStorageProfile(id) { remoteState.cloudActive = remoteState.storageProfiles.find(item => item.id === id) || null; remoteState.active = null; remoteState.remote = null; remoteState.selectedRemote = null; renderRemoteSessions(); renderStorageSessions(); if (remoteState.cloudActive) await loadRemoteFiles(remoteState.cloudActive.rootPath || ''); }

function formatFileSize(size) {
  if (!size) return '—';
  const units = ['B', 'KB', 'MB', 'GB']; let value = size; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value < 10 && index ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

function renderFileList(kind, listing) {
  const list = document.getElementById(`fm-${kind}-list`);
  list.innerHTML = '';
  for (const entry of listing.entries) {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `<span>${entry.directory ? '📁' : '📄'} ${escapeHtml(entry.name)}</span><span>${entry.directory ? 'DIR' : formatFileSize(entry.size)}</span><span>${entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : ''}</span>`;
    row.addEventListener('click', () => {
      list.querySelectorAll('.selected').forEach(item => item.classList.remove('selected'));
      row.classList.add('selected'); remoteState[kind === 'local' ? 'selectedLocal' : 'selectedRemote'] = entry; remoteState.lastSide = kind;
      const connected = Boolean(remoteState.active || remoteState.cloudActive);
      document.getElementById('fm-upload').disabled = !connected || !remoteState.selectedLocal;
      document.getElementById('fm-download').disabled = !connected || !remoteState.selectedRemote;
    });
    row.addEventListener('dblclick', () => entry.directory && (kind === 'local' ? loadLocalFiles(entry.path) : loadRemoteFiles(entry.path)));
    list.appendChild(row);
  }
  if (!listing.entries.length) list.innerHTML = '<div class="file-empty">This directory is empty</div>';
}

async function loadLocalFiles(directory) {
  try {
    const listing = await api.files.localList(directory); remoteState.local = listing; remoteState.selectedLocal = null;
    document.getElementById('fm-local-path').value = listing.path; renderFileList('local', listing);
  } catch (error) { showToast(error.message, 'error'); }
}

async function loadRemoteFiles(directory) {
  if (!remoteState.active && !remoteState.cloudActive) return;
  const target = remoteState.cloudActive || remoteState.active;
  const status = document.getElementById('fm-status'); status.textContent = `Connecting to ${target.host || target.endpoint || target.bucket || target.container}…`;
  try {
    const listing = remoteState.cloudActive ? await api.storage.listFiles(remoteState.cloudActive, directory) : await api.files.remoteList(remoteState.active, directory); remoteState.remote = listing; remoteState.selectedRemote = null;
    document.getElementById('fm-remote-path').value = listing.path; renderFileList('remote', listing); status.textContent = `Connected · ${target.name}`;
  } catch (error) { status.textContent = `Connection failed · ${error.message}`; showToast(error.message, 'error'); }
}

async function transferSelected(direction) {
  if ((!remoteState.active && !remoteState.cloudActive) || !remoteState.local || !remoteState.remote) return;
  const source = direction === 'upload' ? remoteState.selectedLocal : remoteState.selectedRemote;
  if (!source) return;
  const separator = remoteState.local.path.includes('\\') ? '\\' : '/';
  const localPath = direction === 'upload' ? source.path : `${remoteState.local.path}${separator}${source.name}`;
  const remotePath = direction === 'upload' ? `${remoteState.remote.path.replace(/\/$/, '')}/${source.name}` : source.path;
  const status = document.getElementById('fm-status'); status.textContent = `${direction === 'upload' ? 'Uploading' : 'Downloading'} ${source.name}…`;
  const transfer = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: source.name, direction, status: 'running', transferred: 0, total: source.size || 0, files: 0 };
  remoteState.transfers.unshift(transfer); renderTransferQueue();
  try {
    if (direction === 'upload' && !source.directory && source.size <= 2 * 1024 * 1024) {
      const localFile = await api.files.readLocal(localPath);
      const scan = await api.advanced.secretScan(localFile.content, source.name);
      if (!scan.success && !confirm(`Secret scanner found ${scan.findings.length} high-risk value(s) in ${source.name}. Upload anyway?`)) throw new Error('Upload cancelled by Secret Guard');
    }
    const result = remoteState.cloudActive
      ? source.directory ? await api.storage.transferRecursive(remoteState.cloudActive, direction, localPath, remotePath, transfer.id) : await api.storage.transfer(remoteState.cloudActive, direction, localPath, remotePath)
      : source.directory
      ? await api.files.transferRecursive(remoteState.active, direction, localPath, remotePath, transfer.id)
      : await api.files.transferResumable(remoteState.active, direction, localPath, remotePath, transfer.id);
    transfer.status = 'success'; transfer.files = result.files || 1; transfer.total = result.bytes || transfer.total; transfer.transferred = transfer.total;
    showToast(`${source.name} transferred`, 'success'); await refreshFileManager();
  } catch (error) { transfer.status = 'error'; transfer.error = error.message; status.textContent = error.message; showToast(error.message, 'error'); }
  renderTransferQueue();
}

function joinLocal(directory, name) { return `${directory}${directory.includes('\\') ? '\\' : '/'}${name}`; }

async function mutateSelected(operation) {
  const side = remoteState.lastSide;
  const listing = remoteState[side];
  const selected = remoteState[side === 'local' ? 'selectedLocal' : 'selectedRemote'];
  if (!listing || (side === 'remote' && !remoteState.active && !remoteState.cloudActive)) return;
  try {
    if (operation === 'mkdir') {
      const name = prompt(`New folder name on ${side}:`);
      if (!name || /[\\/]/.test(name)) return;
      const target = side === 'local' ? joinLocal(listing.path, name) : `${listing.path.replace(/\/$/, '')}/${name}`;
      if (side === 'local') await api.files.localMutate('mkdir', target);
      else if (remoteState.cloudActive) await api.storage.mutate(remoteState.cloudActive, 'mkdir', target);
      else await api.files.remoteMutate(remoteState.active, 'mkdir', target);
    } else {
      if (!selected) return showToast(`Select a ${side} item first`, 'warning');
      if (operation === 'rename') {
        const name = prompt('New name:', selected.name);
        if (!name || /[\\/]/.test(name) || name === selected.name) return;
        const destination = side === 'local' ? joinLocal(listing.path, name) : `${listing.path.replace(/\/$/, '')}/${name}`;
        if (side === 'local') await api.files.localMutate('rename', selected.path, destination);
        else if (remoteState.cloudActive) await api.storage.mutate(remoteState.cloudActive, 'rename', selected.path, destination);
        else await api.files.remoteMutate(remoteState.active, 'rename', selected.path, destination);
      } else if (operation === 'chmod') {
        if (side !== 'remote' || remoteState.cloudActive) return showToast('Unix permissions apply only to SFTP files', 'warning');
        const mode = prompt('Unix permissions (octal):', selected.permissions?.slice(-3) || '644');
        if (!mode || !/^[0-7]{3,4}$/.test(mode)) return;
        await api.files.remoteMutate(remoteState.active, 'chmod', selected.path, mode);
      } else {
        if (!confirm(`Delete ${selected.directory ? 'folder' : 'file'} "${selected.name}" from ${side}?`)) return;
        const action = selected.directory ? 'delete-directory' : 'delete-file';
        if (side === 'local') await api.files.localMutate(action, selected.path);
        else if (remoteState.cloudActive) await api.storage.mutate(remoteState.cloudActive, action, selected.path);
        else await api.files.remoteMutate(remoteState.active, action, selected.path);
      }
    }
    await (side === 'local' ? loadLocalFiles(listing.path) : loadRemoteFiles(listing.path));
  } catch (error) { showToast(error.message, 'error'); }
}

function renderTransferQueue() {
  const list = document.getElementById('fm-transfer-list'); if (!list) return;
  list.innerHTML = remoteState.transfers.map(item => {
    const percent = item.total ? Math.min(100, Math.round(item.transferred / item.total * 100)) : (item.status === 'success' ? 100 : 5);
    const status = item.status === 'running' ? `${percent}% · ${item.files || 0} files` : item.status === 'success' ? `Done · ${item.files || 1} files` : item.error || 'Failed';
    return `<div class="transfer-item"><span>${item.direction === 'upload' ? '→' : '←'} ${escapeHtml(item.name)}</span><span class="${item.status}">${escapeHtml(status)}</span><span><div class="transfer-progress"><i style="width:${percent}%"></i></div></span></div>`;
  }).join('') || '<div class="file-empty">No transfers</div>';
  const running = remoteState.transfers.filter(item => item.status === 'running').length;
  document.getElementById('fm-queue-summary').textContent = running ? `${running} active · ${remoteState.transfers.length} total` : `${remoteState.transfers.length} transfer(s)`;
}

async function searchFiles(query) {
  if (!query.trim()) return remoteState.lastSide === 'local' ? loadLocalFiles(remoteState.local?.path) : loadRemoteFiles(remoteState.remote?.path);
  const side = remoteState.lastSide;
  try {
    if (side === 'remote' && remoteState.cloudActive) { const entries = remoteState.remote.entries.filter(item => item.name.toLowerCase().includes(query.toLowerCase())); renderFileList('remote', { ...remoteState.remote, entries }); document.getElementById('fm-status').textContent = `${entries.length} result(s) in the current cloud directory`; return; }
    const result = side === 'local' ? await api.files.searchLocal(remoteState.local.path, query) : await api.files.searchRemote(remoteState.active, remoteState.remote.path, query);
    const listing = { path: result.root, parent: '', entries: result.results.map(item => ({ ...item, size: 0, modifiedAt: '' })) };
    renderFileList(side, listing); document.getElementById('fm-status').textContent = `${result.results.length}${result.truncated ? '+' : ''} result(s) for “${query}” on ${side}`;
  } catch (error) { showToast(error.message, 'error'); }
}

async function openSelectedFile() {
  const side = remoteState.lastSide; const selected = remoteState[side === 'local' ? 'selectedLocal' : 'selectedRemote'];
  if (!selected || selected.directory) return showToast('Select a file to edit', 'warning');
  try {
    const file = side === 'local' ? await api.files.readLocal(selected.path) : remoteState.cloudActive ? await api.storage.read(remoteState.cloudActive, selected.path) : await api.files.readRemote(remoteState.active, selected.path);
    remoteState.editor = { side, path: selected.path };
    document.getElementById('file-editor-title').textContent = selected.name;
    document.getElementById('file-editor-meta').textContent = `${side.toUpperCase()} · ${selected.path} · ${formatFileSize(file.size)}`;
    document.getElementById('file-editor-content').value = file.content;
    document.getElementById('file-editor-state').textContent = 'UTF-8 · unsaved changes are kept only in this window';
    document.getElementById('file-editor-modal').classList.remove('hidden');
  } catch (error) { showToast(error.message, 'error'); }
}

function closeFileEditor() { document.getElementById('file-editor-modal')?.classList.add('hidden'); remoteState.editor = null; }

async function saveEditedFile() {
  if (!remoteState.editor) return;
  const content = document.getElementById('file-editor-content').value;
  try {
    if (remoteState.editor.side === 'local') { await api.suite?.snapshot(remoteState.editor.path); await api.files.writeLocal(remoteState.editor.path, content); }
    else if (remoteState.cloudActive) await api.storage.write(remoteState.cloudActive, remoteState.editor.path, content);
    else await api.files.writeRemote(remoteState.active, remoteState.editor.path, content);
    document.getElementById('file-editor-state').textContent = `Saved ${new Date().toLocaleTimeString()} · ${formatFileSize(new Blob([content]).size)}`;
    if (operationsState.collaboration?.kind === 'editor' && operationsState.collaboration.resourceId === remoteState.editor.path) await api.collaboration.event(operationsState.collaboration.id, 'owner', { kind: 'editor-change', filePath: remoteState.editor.path, data: content });
    showToast('File saved', 'success');
  } catch (error) { showToast(error.message, 'error'); }
}

async function mergeSelectedFiles() {
  const local = remoteState.selectedLocal; const remote = remoteState.selectedRemote; if (!remoteState.active || !local || !remote || local.directory || remote.directory) return showToast('Select a local file and an SFTP file', 'warning');
  try { const [localFile, remoteFile] = await Promise.all([api.files.readLocal(local.path), api.files.readRemote(remoteState.active, remote.path)]); const base = prompt('Paste the common/base version for the 3-way merge:', localFile.content); if (base === null) return; const merged = await api.suite.merge3(base, localFile.content, remoteFile.content); remoteState.editor = { side: 'local', path: local.path }; document.getElementById('file-editor-title').textContent = `${local.name} · 3-way merge`; document.getElementById('file-editor-meta').textContent = `${merged.conflicts} conflict(s) · saving creates an automatic snapshot`; document.getElementById('file-editor-content').value = merged.content; document.getElementById('file-editor-state').textContent = merged.clean ? 'Clean merge' : 'Resolve conflict markers before saving'; document.getElementById('file-editor-modal').classList.remove('hidden'); } catch (error) { showToast(error.message, 'error'); }
}

async function compareSelectedFiles() {
  const local = remoteState.selectedLocal; const remote = remoteState.selectedRemote;
  if (!remoteState.active || remoteState.cloudActive || !local || !remote || local.directory || remote.directory) return showToast('Diff currently requires one local file and one SFTP file', 'warning');
  try {
    const result = await api.files.diff(remoteState.active, local.path, remote.path);
    document.getElementById('file-diff-meta').textContent = `${local.name} ↔ ${remote.name} · ${result.identical ? 'identical' : 'differences found'}${result.truncated ? ' · first 10,000 lines' : ''}`;
    document.getElementById('file-diff-list').innerHTML = result.lines.map(line => `<div class="file-diff-row ${line.type}"><span>${line.line}</span><span>${escapeHtml(line.local)}</span><span>${escapeHtml(line.remote)}</span></div>`).join('');
    document.getElementById('file-diff-modal').classList.remove('hidden');
  } catch (error) { showToast(error.message, 'error'); }
}

async function previewSelectedFile() {
  const side = remoteState.lastSide; const selected = remoteState[side === 'local' ? 'selectedLocal' : 'selectedRemote']; if (!selected || selected.directory) return showToast('Select an image or PDF to preview', 'warning');
  try {
    const file = side === 'local' ? await api.files.previewLocal(selected.path) : remoteState.cloudActive ? await api.storage.read(remoteState.cloudActive, selected.path) : await api.files.previewRemote(remoteState.active, selected.path); const content = document.getElementById('file-preview-content'); content.replaceChildren();
    if (remoteState.cloudActive) file.mime = selected.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : selected.name.toLowerCase().match(/\.png$/) ? 'image/png' : selected.name.toLowerCase().match(/\.jpe?g$/) ? 'image/jpeg' : selected.name.toLowerCase().endsWith('.gif') ? 'image/gif' : '';
    if (!file.mime) throw new Error('Preview supports PNG, JPEG, GIF and PDF');
    const element = document.createElement(file.mime === 'application/pdf' ? 'iframe' : 'img'); element.src = `data:${file.mime};base64,${file.base64}`; if (element.tagName === 'IMG') element.alt = selected.name; content.appendChild(element);
    document.getElementById('file-preview-title').textContent = selected.name; document.getElementById('file-preview-meta').textContent = `${side.toUpperCase()} · ${file.mime} · ${formatFileSize(file.size)} · read-only preview`; document.getElementById('file-preview-modal').classList.remove('hidden');
  } catch (error) { showToast(error.message, 'error'); }
}

function closeFilePreview() { const content = document.getElementById('file-preview-content'); content?.replaceChildren(); document.getElementById('file-preview-modal')?.classList.add('hidden'); }

function closeFileDiff() { document.getElementById('file-diff-modal')?.classList.add('hidden'); }

async function previewFileSynchronization() {
  if (!remoteState.active || !remoteState.local || !remoteState.remote) return showToast('Connect to a server first', 'warning');
  if (remoteState.selectedLocal && !remoteState.selectedLocal.directory) return showToast('Select a local directory or clear the file selection', 'warning');
  if (remoteState.selectedRemote && !remoteState.selectedRemote.directory) return showToast('Select a remote directory or clear the file selection', 'warning');
  const localRoot = remoteState.selectedLocal?.path || remoteState.local.path; const remoteRoot = remoteState.selectedRemote?.path || remoteState.remote.path;
  const status = document.getElementById('fm-status'); status.textContent = 'Building synchronization preview…';
  try {
    const preview = await api.files.syncPreview(remoteState.active, localRoot, remoteRoot, { ignore: ['.git', 'node_modules', '.env'] }); remoteState.syncPreview = preview;
    document.getElementById('file-sync-roots').textContent = `${preview.localRoot} ↔ ${preview.remoteRoot} · preview only`;
    document.getElementById('file-sync-summary').innerHTML = Object.entries(preview.summary).map(([state, count]) => `<span class="${state}">${escapeHtml(state)}: ${count}</span>`).join('');
    document.getElementById('file-sync-list').innerHTML = preview.entries.filter(item => item.state !== 'same').map(item => { const selectable = !item.directory && item.state !== 'conflict'; return `<div class="file-sync-row ${item.state}"><label><input type="checkbox" data-sync-path="${escapeHtml(item.relative)}" ${selectable ? 'checked' : 'disabled'}><strong title="${escapeHtml(item.relative)}">${item.directory ? '📁' : '📄'} ${escapeHtml(item.relative)}</strong></label><span class="state">${item.local ? `${formatFileSize(item.local.size)} · ${item.state}` : '—'}</span><span class="state">${item.remote ? `${formatFileSize(item.remote.size)} · ${item.state}` : '—'}</span></div>`; }).join('') || '<div class="file-empty">Directories are already synchronized.</div>';
    document.getElementById('file-sync-all').checked = true; document.getElementById('file-sync-modal').classList.remove('hidden'); status.textContent = `Preview ready · ${preview.entries.length} entries checked`;
  } catch (error) { status.textContent = error.message; showToast(error.message, 'error'); }
}

function closeFileSynchronization() { document.getElementById('file-sync-modal')?.classList.add('hidden'); remoteState.syncPreview = null; }

async function applyFileSynchronization(direction) {
  const preview = remoteState.syncPreview; if (!preview || !remoteState.active) return;
  const compatible = direction === 'upload' ? new Set(['local-only', 'local-newer']) : new Set(['remote-only', 'remote-newer']);
  const selected = [...document.querySelectorAll('#file-sync-list input[data-sync-path]:checked')].map(input => input.dataset.syncPath).filter(relative => compatible.has(preview.entries.find(item => item.relative === relative)?.state));
  if (!selected.length) return showToast(`No ${direction === 'upload' ? 'local' : 'remote'} changes selected`, 'warning');
  const guard = remoteState.active.production ? ' Production Guard is enabled.' : '';
  if (!confirm(`${direction === 'upload' ? 'Upload to' : 'Download from'} ${remoteState.active.name}: ${selected.length} file(s)? Existing files can be overwritten.${guard}`)) return;
  try { const result = await api.files.syncApply(remoteState.active, preview, direction, selected); showToast(result.success ? `Synchronized ${result.results.length} file(s)` : 'Synchronization finished with errors', result.success ? 'success' : 'error'); closeFileSynchronization(); await refreshFileManager(); }
  catch (error) { showToast(error.message, 'error'); }
}

async function transferServerToServer() {
  const source = remoteState.selectedRemote;
  if (!remoteState.active || !source || source.directory) return showToast('Select a file on an SFTP server first', 'warning');
  const destinations = remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type) && item.id !== remoteState.active.id);
  if (!destinations.length) return showToast('Save a second SSH/SFTP server first', 'warning');
  const destinationName = prompt(`Destination server:\n${destinations.map(item => item.name).join(', ')}`, destinations[0].name); if (!destinationName) return;
  const destination = destinations.find(item => item.name.toLowerCase() === destinationName.toLowerCase()); if (!destination) return showToast('Unknown destination server', 'warning');
  const destinationPath = prompt('Destination absolute path:', `/${source.name}`); if (!destinationPath) return;
  if ((remoteState.active.production || destination.production) && !confirm(`Production Guard: transfer ${source.name} from ${remoteState.active.name} to ${destination.name}:${destinationPath}?`)) return;
  const transfer = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: `${remoteState.active.name}:${source.name} → ${destination.name}`, direction: 'upload', status: 'running', transferred: 0, total: source.size || 0, files: 0 };
  remoteState.transfers.unshift(transfer); renderTransferQueue();
  try { const result = await api.files.serverTransfer(remoteState.active, source.path, destination, destinationPath, transfer.id); transfer.status = 'success'; transfer.files = 1; transfer.total = result.bytes || transfer.total; transfer.transferred = transfer.total; showToast('Server-to-server transfer completed', 'success'); }
  catch (error) { transfer.status = 'error'; transfer.error = error.message; showToast(error.message, 'error'); }
  renderTransferQueue();
}

async function refreshSshTunnels() {
  if (!api.sshTunnel) return;
  const tunnels = await api.sshTunnel.list(); const list = document.getElementById('ssh-tunnel-list'); if (!list) return;
  list.innerHTML = tunnels.map(item => `<span class="ssh-tunnel-chip">● ${escapeHtml(item.sessionName)} · ${escapeHtml(item.localHost)}:${item.localPort} → ${escapeHtml(item.remoteHost)}:${item.remotePort}<button data-tunnel-stop="${item.id}" title="Stop tunnel">×</button></span>`).join('');
  list.querySelectorAll('[data-tunnel-stop]').forEach(button => button.addEventListener('click', async () => { await api.sshTunnel.stop(button.dataset.tunnelStop); await refreshSshTunnels(); }));
}

async function startSshTunnel() {
  const session = remoteState.sessions.find(item => item.id === document.getElementById('ssh-tunnel-session').value);
  if (!session) return showToast('Choose an SSH session', 'warning');
  const options = { localPort: Number(document.getElementById('ssh-tunnel-local-port').value) || 0, remoteHost: document.getElementById('ssh-tunnel-remote-host').value, remotePort: Number(document.getElementById('ssh-tunnel-remote-port').value) };
  if (!options.remotePort) return showToast('Remote port is required', 'warning');
  try { const tunnel = await api.sshTunnel.start(session, options); showToast(`Tunnel listening on 127.0.0.1:${tunnel.localPort}`, 'success'); await refreshSshTunnels(); }
  catch (error) { showToast(error.message, 'error'); }
}

/* ===== Operations Center ===== */
const operationsState = { graph: null, captures: new Map(), replacePreview: null, shadow: null, incidents: [], activeIncidentId: '', commands: [], workspaces: [], collaboration: null, fabric: null, enterprise: null, nextgen: null, opsWorkspace: null, terminalFilePro: null, terminalFileVision: null, terminalFileRuntime: null, terminalFileDeep: null, activeUniversalWorkspace: null, fleetPreview: null, networkReplay: null, accessGrant: null, canary: null, offlineMount: null, replayLab: null };
function opsSession() { return remoteState.sessions.find(item => item.id === document.getElementById('ops-server-select')?.value) || null; }
function opsPrint(value) { const output = document.getElementById('ops-output'); if (!output) return; output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
function opsPromptSession(message = 'Choose a server first') { const session = opsSession(); if (!session) showToast(message, 'warning'); return session; }

function initOperationsCenter() {
  if (!api.advanced) return;
  document.getElementById('ops-refresh')?.addEventListener('click', refreshOperationsCenter);
  document.querySelectorAll('[data-ops]').forEach(button => button.addEventListener('click', () => runOperationsAction(button.dataset.ops)));
  document.querySelectorAll('[data-vision-tab]').forEach(button => button.addEventListener('click', () => selectVisionTab(button.dataset.visionTab)));
  document.querySelectorAll('[data-vision]').forEach(button => button.addEventListener('click', () => selectVisionFeature(button.dataset.vision)));
  document.querySelectorAll('[data-vision-context]').forEach(button => button.addEventListener('click', () => { selectVisionFeature(button.dataset.visionContext); if (window.innerWidth <= 760) document.getElementById('tf-vision-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  document.querySelectorAll('[data-vision-platform]').forEach(button => button.addEventListener('click', () => { selectVisionFeature(button.dataset.visionPlatform); if (window.innerWidth <= 760) document.getElementById('tf-vision-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  document.querySelectorAll('[data-vision-expert]').forEach(button => button.addEventListener('click', () => { selectVisionFeature(button.dataset.visionExpert); if (window.innerWidth <= 760) document.getElementById('tf-vision-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  const contextButtons = [...document.querySelectorAll('[data-vision-context],[data-vision-platform],[data-vision-expert]')]; for (const button of contextButtons) button.addEventListener('keydown', event => { if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); const offset = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1; contextButtons[(contextButtons.indexOf(button) + offset + contextButtons.length) % contextButtons.length]?.focus(); });
  document.addEventListener('keydown', event => { if (event.altKey && event.key === 'Enter' && document.getElementById('panel-operations-center')?.classList.contains('active')) { event.preventDefault(); selectVisionFeature('contextual-action-orb'); document.getElementById('tf-vision-inspector')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' }); } });
  document.getElementById('tf-vision-search')?.addEventListener('input', event => filterVisionFeatures(event.target.value));
  document.getElementById('tf-runtime-audit')?.addEventListener('click', runTerminalFileRuntimeAudit);
  document.querySelectorAll('[data-deep-mode]').forEach(button => button.addEventListener('click', () => switchTerminalFileDeepMode(button.dataset.deepMode)));
  document.querySelectorAll('[data-deep-tool]').forEach(button => button.addEventListener('click', () => runTerminalFileDeepTool(button.dataset.deepTool, button)));
  document.getElementById('ops-command-query')?.addEventListener('keydown', event => { if (event.key === 'Enter') runOperationsAction('command-run'); });
}

async function refreshOperationsCenter() {
  if (!api.advanced) return; if (!remoteState.sessions.length) await loadRemoteSessions();
  const select = document.getElementById('ops-server-select'); if (!select) return; const selected = select.value; select.innerHTML = '<option value="">Choose server…</option>'; for (const session of remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type))) { const option = document.createElement('option'); option.value = session.id; option.textContent = `${session.production ? '◆ ' : ''}${session.name} · ${session.host}`; select.appendChild(option); } select.value = selected || remoteState.active?.id || '';
  const [graph, incidents, commands, workspaces, capabilities, fabric, enterprise, nextgen, opsWorkspace, terminalFilePro, terminalFileVision, terminalFileRuntime, terminalFileDeep] = await Promise.all([api.advanced.graph(), api.incident.list(), api.advanced.commands(), api.advanced.workspaces(), api.resilience.capabilities(), api.fabric.summary(), api.enterprise?.summary?.() || {}, api.nextgen?.summary?.() || {}, api.opsWorkspace?.summary?.() || {}, api.terminalFilePro?.summary?.() || {}, api.terminalFileVision?.summary?.() || {}, api.terminalFileRuntime?.summary?.() || {}, api.terminalFileDeep?.summary?.() || {}]); operationsState.graph = graph; operationsState.incidents = incidents; operationsState.commands = commands; operationsState.workspaces = workspaces; operationsState.fabric = fabric; operationsState.enterprise = enterprise; operationsState.nextgen = nextgen; operationsState.opsWorkspace = opsWorkspace; operationsState.terminalFilePro = terminalFilePro; operationsState.terminalFileVision = terminalFileVision; operationsState.terminalFileRuntime = terminalFileRuntime; operationsState.terminalFileDeep = terminalFileDeep;
  document.getElementById('ops-summary').innerHTML = `<span>${graph.nodes.length} nodes</span><span>${graph.edges.length} relations</span><span>${incidents.filter(item => item.status !== 'resolved').length} active incident(s)</span><span>${fabric.policies} access policies</span><span>${fabric.activeGrants} active grant(s)</span><span>${enterprise.agents || 0} agent(s)</span><span>${nextgen.relayNodes || 0} relay node(s)</span><span>${nextgen.frozenRoots || 0} guarded root(s)</span><span>${opsWorkspace.workspaces || 0} universal workspace(s)</span><span>${opsWorkspace.undoableEvents || 0} undoable action(s)</span><span>${terminalFilePro.notebooks || 0} notebook(s)</span><span>${terminalFilePro.encryptedIndexes || 0} encrypted index(es)</span><span>${terminalFilePro.pendingAirDrops || 0} pending AirDrop(s)</span><span>Mosh ${capabilities.mosh ? 'ready' : 'not installed'}</span>`; renderOperationsGraph();
  const visionSummary = document.getElementById('tf-vision-summary'); if (visionSummary) visionSummary.querySelector('span').textContent = `${terminalFileVision.features || 89} capabilities · ${terminalFileVision.runbooks || 0} runbooks · ${terminalFileVision.activeLeases || 0} active leases`;
  const reviewCount = document.getElementById('tf-review-count'); if (reviewCount) reviewCount.textContent = terminalFileVision.pendingReviews ? `${terminalFileVision.pendingReviews} pending plan${terminalFileVision.pendingReviews === 1 ? '' : 's'}` : 'No pending plans';
  renderTerminalFileRuntime(terminalFileRuntime);
  renderTerminalFileDeep(terminalFileDeep);
}

function renderTerminalFileRuntime(runtime) {
  if (!runtime?.layers) return; const byId = new Map(runtime.layers.map(item => [item.id, item])); for (const node of document.querySelectorAll('[data-runtime-layer]')) { const layer = byId.get(node.dataset.runtimeLayer); if (!layer) continue; node.classList.toggle('review', ['review', 'available'].includes(layer.status)); node.classList.toggle('blocked', ['blocked', 'failed'].includes(layer.status)); node.title = `${layer.status.toUpperCase()} · ${layer.detail}`; }
  const ring = document.getElementById('tf-runtime-ring'); if (ring) ring.textContent = `${runtime.healthy}/${runtime.total}`; const score = document.getElementById('tf-runtime-score'); if (score) score.textContent = runtime.healthy === runtime.total ? 'HEALTHY' : `${runtime.healthy}/${runtime.total}`; const caption = document.getElementById('tf-runtime-caption'); if (caption) caption.textContent = `${runtime.total} engines · ${runtime.journalValid ? 'journal verified' : 'journal blocked'} · ${runtime.transfers || 0} transfer records`;
}

async function runTerminalFileRuntimeAudit() {
  const button = document.getElementById('tf-runtime-audit'); if (!button || !api.terminalFileRuntime) return; button.disabled = true; button.textContent = 'Auditing…'; try { const report = await api.terminalFileRuntime.audit({ servers: 10000, files: 1000000 }); operationsState.terminalFileRuntime = report.summary; renderTerminalFileRuntime(report.summary); opsPrint(report); document.querySelector('.tf-runtime-cockpit').open = true; showToast(`Production Runtime: ${report.score}/100`, report.score === 100 ? 'success' : 'warning', 'terminal-files-runtime'); } catch (error) { showToast(error.message, 'error', 'terminal-files-runtime'); } finally { button.disabled = false; button.textContent = 'Run production audit'; }
}

function switchTerminalFileDeepMode(mode) {
  document.querySelectorAll('[data-deep-mode]').forEach(button => button.classList.toggle('active', button.dataset.deepMode === mode));
  document.querySelectorAll('[data-deep-pane]').forEach(pane => pane.classList.toggle('active', pane.dataset.deepPane === mode));
}

function renderTerminalFileDeep(summary = {}) {
  if (!summary.features) return; const byId = new Map(summary.features.map(item => [item.id, item]));
  document.querySelectorAll('[data-deep-tool]').forEach(button => { const feature = byId.get(button.dataset.deepTool); if (!feature) return; button.classList.toggle('review', feature.status === 'available'); button.classList.toggle('unavailable', feature.status === 'unavailable'); button.title = `${feature.status.toUpperCase()} · ${feature.detail}`; });
  const ring = document.getElementById('tf-deep-ring'); if (ring) ring.textContent = `${summary.ready}/${summary.total}`; const score = document.getElementById('tf-deep-score'); if (score) score.textContent = summary.ready === summary.total ? 'READY' : `${summary.ready}/${summary.total}`; const caption = document.getElementById('tf-deep-caption'); if (caption) caption.textContent = `${summary.total} tools · ${summary.activeMounts || 0} active mounts · external adapters detected honestly`;
}

function renderTerminalFileDeepResult(title, description, metrics = []) {
  const target = document.getElementById('tf-deep-result'); if (!target) return; const ring = document.getElementById('tf-deep-ring')?.textContent || `${operationsState.terminalFileDeep?.ready || 0}/${operationsState.terminalFileDeep?.total || 9}`; const safeMetrics = metrics.filter(item => item?.[1] !== undefined).slice(0, 6);
  target.innerHTML = `<div><b id="tf-deep-ring">${escapeHtml(ring)}</b><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span></div>${safeMetrics.length ? `<div class="tf-deep-result-metrics">${safeMetrics.map(([label, value]) => `<span title="${escapeHtml(String(value))}">${escapeHtml(label)} · ${escapeHtml(String(value))}</span>`).join('')}</div>` : '<div class="tf-deep-result-bars"><i></i><i></i><i></i></div>'}`;
}

function chooseTextFile() {
  return new Promise(resolve => { const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.ini,.reg,.conf,.config,.txt,.json,.xml,.rtsz'; picker.addEventListener('change', async () => { const file = picker.files?.[0]; resolve(file ? { name: file.name, content: await file.text() } : null); }, { once: true }); picker.click(); });
}

async function runTerminalFileDeepTool(tool, button) {
  if (!api.terminalFileDeep) return; button.disabled = true; const original = button.querySelector('em')?.textContent || ''; if (button.querySelector('em')) button.querySelector('em').textContent = 'WORKING';
  try {
    const session = opsSession(); let result; let title = button.querySelector('strong')?.textContent || 'Deep tool'; let description = 'Completed safely.'; let metrics = [];
    if (tool === 'binary-huge-file-workbench') { const remoteSelected = remoteState.lastSide === 'remote' && remoteState.selectedRemote; const selected = remoteSelected ? remoteState.selectedRemote : remoteState.selectedLocal; if (!selected) throw new Error('Select a local or remote file or local directory first'); if (remoteSelected && !session) throw new Error('Choose the server containing the selection'); if (selected.directory) { if (remoteSelected) throw new Error('Durable scale indexing currently runs on local directories'); if (!confirm(`Build or refresh the durable fast index for ${selected.path}?\n\nThe work runs outside the UI thread and can be cancelled.`)) return; result = await api.terminalFileDeep.execute(tool, { action: 'index-directory', path: selected.path, maxFiles: 1000000 }); description = 'Durable SQLite/WAL index completed outside the UI thread with bounded queue pressure.'; metrics = [['files', result.result.files], ['folders', result.result.directories], ['indexed', formatBytes(result.result.bytes)], ['backend', result.result.backend], ['capped', result.result.capped ? 'yes' : 'no']]; } else { result = await api.terminalFileDeep.execute(tool, { action: 'inspect', location: remoteSelected ? 'remote' : 'local', sessionId: session?.id, path: selected.path, offset: 0, length: 262144 }); description = `${result.encoding} · bounded byte range, full file never loaded`; metrics = [['size', formatBytes(result.size)], ['range', `${result.range.from}–${result.range.to}`], ['entropy', result.entropy], ['printable', `${Math.round(result.printableRatio * 100)}%`], ['scale engine', operationsState.terminalFileDeep?.runtime?.scale?.backend || 'worker']]; } }
    else if (tool === 'metadata-fidelity-engine') { const remoteSelected = remoteState.lastSide === 'remote' && remoteState.selectedRemote; const selected = remoteSelected ? remoteState.selectedRemote : remoteState.selectedLocal; if (!selected) { result = await api.terminalFileDeep.execute(tool, { action: 'matrix', sourcePlatform: 'windows', destinationPlatform: 'linux' }); description = 'Cross-platform fidelity plan; unsupported metadata moves to a verified sidecar.'; metrics = result.fields.slice(0, 6).map(item => [item.name, item.fidelity]); } else { result = await api.terminalFileDeep.execute(tool, { action: 'inspect', location: remoteSelected ? 'remote' : 'local', sessionId: session?.id, path: selected.path }); description = remoteSelected ? 'Remote metadata collected read-only.' : `${result.type} · local metadata collected read-only`; metrics = remoteSelected ? [['path', result.path], ['mode', result.raw?.match(/mode=(\d+)/)?.[1] || 'n/a'], ['mutations', 'none']] : [['mode', result.mode], ['size', formatBytes(result.size)], ['links', result.links], ['sparse', result.sparse === null ? 'n/a' : result.sparse ? 'yes' : 'no']]; } }
    else if (tool === 'remote-git-workspace') { if (!session) throw new Error('Choose a remote server first'); const root = prompt('Repository root:', session.remotePath || '/srv/app'); if (!root) return; const action = prompt('Action: status, diff, history, blame, stage or unstage', 'status'); if (!action) return; const file = remoteState.selectedRemote?.path || `${root}/README.md`; let input = { sessionId: session.id, root, file, action }; result = await api.terminalFileDeep.execute(tool, input); if (result.requiresApproval && confirm(`${action} ${file}? The repository state will change.`)) result = await api.terminalFileDeep.execute(tool, { ...input, approved: true }); description = `${action} · ${result.result?.success === false || result.success === false ? 'operation failed' : result.requiresApproval ? 'waiting for approval' : 'repository inspected'}`; metrics = [['repository', root], ['file', file], ['mutation', ['stage', 'unstage'].includes(action) ? 'approval-gated' : 'none']]; }
    else if (tool === 'hardware-backed-ssh') { result = await api.terminalFileDeep.execute(tool, { action: 'list-public-keys' }); const ready = result.providers.filter(item => item.available).length; const pool = operationsState.terminalFileDeep?.runtime?.ssh; description = 'Only public fingerprints are exposed; terminal, SFTP, commands and tunnels reuse one pinned SSH transport.'; metrics = [['providers', `${ready}/${result.providers.length}`], ['public keys', result.keys.length], ['SSH transport', pool?.sharedTransport ? 'shared' : 'isolated'], ['active channels', pool?.activeLeases || 0], ['private export', 'blocked']]; }
    else if (tool === 'migration-assistant') { const selected = await chooseTextFile(); if (!selected) return; const lower = selected.name.toLowerCase(); const format = lower.endsWith('.reg') ? 'putty' : lower.endsWith('.xml') || lower.endsWith('.rtsz') ? 'royalts' : lower.endsWith('.json') ? 'termius' : lower.endsWith('.ini') && /Bookmarks/i.test(selected.content) ? 'mobaxterm' : 'auto'; result = await api.terminalFileDeep.execute(tool, { action: 'preview', format, content: selected.content }); if (result.migration && result.migration.sessions.length && confirm(`Import ${result.migration.sessions.length} unique session(s)? ${result.migration.duplicates} duplicate(s) will be skipped.`)) result = await api.terminalFileDeep.execute(tool, { action: 'apply', id: result.migration.id, approved: true }); description = 'Profiles are deduplicated before import; passwords and private keys are never migrated.'; metrics = [['format', format], ['sessions', result.imported?.length ?? result.migration?.sessions?.length ?? 0], ['duplicates', result.migration?.duplicates ?? 0], ['credentials', 'excluded']]; await loadRemoteSessions(); }
    else if (tool === 'modern-terminal-media') { result = await api.terminalFileDeep.execute(tool, { action: 'policy', osc8Links: true, osc52Clipboard: false, sixel: true, kittyGraphics: true, maxImageBytes: 2097152 }); description = 'Links require confirmation, clipboard stays blocked until approved, and Sixel/Kitty renderers enforce memory and pixel budgets.'; metrics = [['OSC 8', 'guarded'], ['OSC 52', result.policy.osc52Clipboard], ['Sixel', 'rendered'], ['Kitty', operationsState.terminalFileDeep?.runtime?.kittyRenderer || 'rendered'], ['image cap', formatBytes(result.policy.maxImageBytes)]]; }
    else if (tool === 'cloud-object-storage-pro') { if (!remoteState.cloudActive) throw new Error('Select an S3, Azure or WebDAV profile in File Manager first'); const action = prompt('Cloud action: capabilities, versions, object-lock or multipart-upload', 'capabilities'); if (!action) return; const input = { action, profileId: remoteState.cloudActive.id }; if (action === 'versions' || action === 'object-lock') input.key = remoteState.selectedRemote?.path || prompt('Object prefix/key:', '') || ''; if (action === 'multipart-upload') { if (!remoteState.selectedLocal || remoteState.selectedLocal.directory) throw new Error('Select the local file to upload first'); input.localPath = remoteState.selectedLocal.path; input.key = prompt('Destination object key:', remoteState.selectedLocal.name); result = await api.terminalFileDeep.execute(tool, input); if (result.requiresApproval && confirm(`Start verified multipart upload to ${input.key}?`)) result = await api.terminalFileDeep.execute(tool, { ...input, approved: true }); } else result = await api.terminalFileDeep.execute(tool, input); description = action === 'capabilities' ? 'Provider capabilities detected from the active profile.' : `${action} completed with provider-native APIs.`; metrics = [['provider', remoteState.cloudActive.type], ['action', action], ['versions', result.versions?.length ?? 'n/a'], ['multipart', result.multipart ?? result.job?.status ?? 'n/a']]; }
    else if (tool === 'real-remote-mounts') { const cloud = remoteState.cloudActive; if (!cloud && !session) throw new Error('Choose an SFTP session or cloud profile first'); if (navigator.platform.toLowerCase().includes('win')) { const driver = await api.terminalFileDeep.execute(tool, { action: 'winfsp-status' }); if (!driver.installed) { if (!confirm(`Remote drives require the signed WinFsp ${driver.version} security build.\n\nDownload, verify SHA-256 + Authenticode and open the elevated installer now?`)) return; const installed = await api.terminalFileDeep.execute(tool, { action: 'winfsp-install', approved: true }); if (!installed.success) throw new Error('WinFsp installation did not complete'); } } const mountPoint = prompt('Drive letter or mount directory:', navigator.platform.toLowerCase().includes('win') ? (cloud ? 'R:' : 'K:') : '/mnt/kitsune'); if (!mountPoint) return; const input = cloud ? { protocol: cloud.type, profileId: cloud.id, remotePath: remoteState.remote?.path || '/', mountPoint } : { protocol: 'sftp', sessionId: session.id, mountPoint }; result = await api.terminalFileDeep.execute(tool, input); if (result.requiresApproval && confirm(`Mount ${cloud?.name || session.name} at ${mountPoint}?`)) result = await api.terminalFileDeep.execute(tool, { ...input, approved: true }); description = result.mount ? `${result.mount.protocol || 'sftp'} mounted with guarded write cache.` : 'Mount plan is waiting for approval.'; metrics = [['target', mountPoint], ['protocol', cloud?.type || 'sftp'], ['driver', 'signed + verified'], ['cache', result.mount?.cacheMode || 'adapter'], ['credentials in args', result.mount?.credentialsInArguments === false ? 'no' : 'n/a']]; }
    else if (tool === 'protocol-compatibility-ci-lab') { result = await api.terminalFileDeep.execute(tool, { run: false }); if (result.dockerAvailable && confirm('Start the disposable protocol containers now? They will be health-checked and destroyed automatically.')) result = await api.terminalFileDeep.execute(tool, { run: true, approved: true }); description = result.run ? `Disposable topology ${result.run.liveTargetsStarted ? 'started, verified and destroyed' : 'failed safely'}.` : 'A disposable test topology was generated; production profiles are never referenced.'; metrics = [['matrix', `${result.run?.cells || result.cells} cells`], ['containers', result.run?.containers ?? result.localContainers], ['Docker', result.run ? result.success ? 'verified' : 'failed' : result.dockerAvailable ? 'ready' : 'not installed'], ['production', 'untouched']]; }
    renderTerminalFileDeepResult(title, description, metrics); document.querySelector('.tf-deep-dock').open = true; showToast(`${title}: ready`, 'success', 'terminal-files-deep');
  } catch (error) { renderTerminalFileDeepResult('Action blocked', error.message, [['safety', 'no changes applied']]); showToast(error.message, 'error', 'terminal-files-deep'); }
  finally { button.disabled = false; if (button.querySelector('em')) button.querySelector('em').textContent = original; }
}

function renderOperationsGraph() { const target = document.getElementById('ops-graph'); if (!target || !operationsState.graph) return; const edges = operationsState.graph.edges; target.innerHTML = operationsState.graph.nodes.map(node => { const relations = edges.filter(edge => edge.from === node.id || edge.to === node.id).length; return `<div class="ops-graph-node ${node.production ? 'production' : ''}" data-node-id="${escapeHtml(node.id)}"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.kind)} · ${relations} relation(s)</small><small>${escapeHtml(node.subtitle || '')}</small></div>`; }).join(''); }

async function runOperationsAction(action) {
  try {
    const session = opsSession(); let result;
    if (action === 'clear') return opsPrint('Select an operation.');
    if (action === 'graph') { operationsState.graph = await api.advanced.graph(); renderOperationsGraph(); return opsPrint(operationsState.graph); }
    if (action === 'command-run') { const query = document.getElementById('ops-command-query').value.trim().toLowerCase(); const command = operationsState.commands.find(item => item.title.toLowerCase().includes(query)); if (!command) return showToast('No matching command', 'warning'); if (command.kind === 'terminal') { const target = remoteState.sessions.find(item => item.id === command.sessionId); switchToPanel('terminal'); await createTerminal(target); } else if (command.kind === 'files') { switchToPanel('file-manager'); await selectRemoteSession(command.sessionId); } else if (command.kind === 'diagnose') { document.getElementById('ops-server-select').value = command.sessionId; result = await api.remote.diagnose(remoteState.sessions.find(item => item.id === command.sessionId)); opsPrint(result); } else if (command.kind === 'workspace') { const workspace = operationsState.workspaces.find(item => item.id === command.workspaceId); await launchSmartWorkspace(workspace); } else if (command.kind === 'operation') return runOperationsAction(command.action); return; }
    if (action === 'global-search') { const query = prompt('File name or content to find across servers:'); if (!query) return; const content = confirm('Search inside text files? Cancel searches file names.'); result = await api.advanced.search(query, { content, root: '/', sessionIds: [] }); }
    else if (action === 'global-replace') { const query = prompt('Text to replace across remote files:'); if (!query) return; const replacement = prompt('Replacement text:', ''); if (replacement === null) return; const root = prompt('Remote root:', session?.remotePath || '/var/www'); if (!root) return; operationsState.replacePreview = await api.advanced.replacePreview(query, replacement, { root, content: true, sessionIds: session ? [session.id] : [] }); opsPrint(operationsState.replacePreview); if (!operationsState.replacePreview.changes.length || !confirm(`Apply ${operationsState.replacePreview.totalOccurrences} replacement(s) in ${operationsState.replacePreview.changes.length} file(s)? Files changed since preview will be skipped.`)) return; result = await api.advanced.replaceApply(operationsState.replacePreview, operationsState.replacePreview.changes.map(item => `${item.sessionId}:${item.path}`)); if (result.rollbackId && confirm('Replacement complete. Keep the automatic rollback snapshot? Cancel restores it now.')) result.rollbackSnapshotKept = true; else if (result.rollbackId) result.rollback = await api.advanced.replaceRollback(result.rollbackId); }
    else if (action === 'limited-transfer') { if (!opsPromptSession()) return; const direction = prompt('Direction: upload or download', 'upload'); if (!direction) return; const local = prompt('Local file:', remoteState.selectedLocal?.path || ''); const remote = prompt('Remote file:', remoteState.selectedRemote?.path || `${session.remotePath || '/tmp'}/file.bin`); const mbps = Number(prompt('Bandwidth limit in MB/s (0 = unlimited):', '5')) || 0; if (!local || !remote) return; result = await api.resilience.transferLimited(session, direction, local, remote, mbps * 1024 * 1024); }
    else if (action === 'workspace-save') { if (!session) return showToast('Choose a server', 'warning'); const name = prompt('Smart Workspace name:', `${session.name} operations`); if (!name) return; result = await api.advanced.workspaceSave({ name, sessionIds: [session.id], panels: ['terminal', 'file-manager', 'server-workspace', 'operations-center'], layout: 'split', tunnels: [] }); await refreshOperationsCenter(); }
    else if (action === 'workspace-run') { const name = prompt(`Workspace:\n${operationsState.workspaces.map(item => item.name).join(', ')}`, operationsState.workspaces[0]?.name || ''); const workspace = operationsState.workspaces.find(item => item.name.toLowerCase() === name?.toLowerCase()); if (!workspace) return; return launchSmartWorkspace(workspace); }
    else if (action === 'preflight') { if (!opsPromptSession()) return; const target = prompt('Deployment target:', session.remotePath || '/var/www/app'); if (!target) return; result = await api.advanced.preflight(session, { target, minimumDiskKb: 524288, minimumMemoryKb: 262144 }); }
    else if (action === 'secret-scan') { const content = prompt('Paste configuration, Git diff or deployment text to scan:'); if (!content) return; result = await api.advanced.secretScan(content, 'manual scan'); }
    else if (action === 'blast-radius') { if (!opsPromptSession()) return; result = await api.advanced.blastRadius({ session, operation: prompt('Planned operation:', 'deploy') || 'deploy' }); }
    else if (action === 'digital-twin') { if (!opsPromptSession()) return; const capture = operationsState.captures.get(session.id) || await api.advanced.captureInfrastructure(session); operationsState.captures.set(session.id, capture); result = await api.advanced.digitalTwin(capture, { type: prompt('Operation to simulate:', 'deploy') || 'deploy', target: prompt('Target:', session.remotePath || '/var/www/app') }); }
    else if (action === 'baseline') { if (!opsPromptSession()) return; result = await api.advanced.setBaseline(session); }
    else if (action === 'drift') { if (!opsPromptSession()) return; result = await api.advanced.drift(session); }
    else if (action === 'infra-diff') { if (!opsPromptSession()) return; const otherName = prompt(`Compare ${session.name} with server:`, remoteState.sessions.find(item => item.id !== session.id)?.name || ''); const other = remoteState.sessions.find(item => item.name.toLowerCase() === otherName?.toLowerCase()); if (!other) return; const [left, right] = await Promise.all([api.advanced.captureInfrastructure(session), api.advanced.captureInfrastructure(other)]); result = await api.advanced.diffInfrastructure(left, right); }
    else if (action === 'time-capture') { if (!opsPromptSession()) return; const paths = (prompt('Remote files to snapshot, comma separated:', `${session.remotePath || '/var/www/app'}/.env`) || '').split(',').map(value => value.trim()).filter(Boolean); result = await api.advanced.timeMachineCapture(session, { name: prompt('Snapshot name:', 'Before change'), operation: 'manual', paths }); }
    else if (action === 'time-restore') { if (!opsPromptSession()) return; const items = await api.advanced.timeMachineList(session.id); const id = prompt(`Snapshot ID:\n${items.map(item => `${item.id} · ${item.name}`).join('\n')}`, items[0]?.id || ''); if (!id || !confirm('Restore captured files to the server? Current versions will be overwritten.')) return; result = await api.advanced.timeMachineRestore(id, session, []); }
    else if (action === 'shadow') { if (!opsPromptSession()) return; const localDirectory = prompt('Local release directory:', remoteState.local?.path || ''); const liveLink = prompt('Remote live symlink:', session.remotePath || '/var/www/app'); if (!localDirectory || !liveLink) return; const gate = await api.advanced.maintenanceCheck(session.id, 'deploy'); if (!gate.allowed) return showToast(gate.reason, 'warning'); const preflight = await api.advanced.preflight(session, { target: liveLink }); if (!preflight.success) return opsPrint({ blocked: true, preflight }); await api.advanced.timeMachineCapture(session, { name: 'Before shadow deployment', operation: 'shadow-deploy', paths: [`${liveLink.replace(/\/$/, '')}/.env`] }); operationsState.shadow = await api.advanced.shadowDeploy(session, { localDirectory, liveLink, healthCommand: prompt('Health command inside release:', 'test -f package.json || test -f index.php') || '' }); opsPrint(operationsState.shadow); if (operationsState.shadow.success && confirm('Shadow release passed. Promote atomically now?')) result = await api.advanced.shadowPromote(session, operationsState.shadow); else return; }
    else if (action === 'timeline') { result = await api.advanced.timeline(session?.id || ''); }
    else if (action === 'replay') { if (!opsPromptSession()) return; const name = prompt('Replay name:', 'Diagnostics replay'); if (!name) return; const saved = await api.advanced.replaySave({ name, sessionId: session.id, steps: [{ kind: 'command-template', options: { template: 'disk' } }] }); result = await api.advanced.replayRun(saved.replay.id, session); }
    else if (action === 'incident-start') { const title = prompt('Incident title:', 'Production incident'); if (!title) return; result = await api.incident.start({ title, severity: prompt('Severity: sev1, sev2, sev3 or sev4', 'sev2'), sessionIds: session ? [session.id] : [], commander: 'Local owner' }); operationsState.activeIncidentId = result.incident.id; if (terminalState.activeId && !terminalState.recording.has(terminalState.activeId)) await toggleTerminalRecording(); await refreshOperationsCenter(); }
    else if (action === 'incident-list') result = await api.incident.list();
    else if (action === 'incident-note') { const incident = await chooseIncident(); if (!incident) return; const note = prompt('War Room note:'); if (!note) return; result = await api.incident.update(incident.id, { note, author: 'Local owner' }); }
    else if (action === 'incident-collect') { const incident = await chooseIncident(); if (!incident || !session) return; result = await api.incident.collect(incident.id, { type: 'infrastructure', sessionId: session.id }); }
    else if (action === 'incident-capsule') { const incident = await chooseIncident(); if (!incident) return; result = await api.incident.capsule(incident.id); }
    else if (action === 'collaboration') { const kind = prompt('Collaboration: terminal, editor or war-room', 'war-room'); if (!kind) return; const resourceId = kind === 'editor' ? (remoteState.selectedRemote?.path || remoteState.selectedLocal?.path || '') : kind === 'terminal' ? (terminalState.activeId || '') : operationsState.activeIncidentId; if (!resourceId) return showToast(`Open or select a ${kind} resource first`, 'warning'); result = await api.collaboration.start({ kind, resourceId, owner: 'Local owner', ttlMinutes: 120 }); operationsState.collaboration = result.session; if (kind === 'editor') await api.collaboration.lockFile(result.session.id, resourceId, 'owner'); await navigator.clipboard.writeText(result.session.id); }
    else if (action === 'logs') { if (!opsPromptSession()) return; const first = prompt('First remote log:', '/var/log/syslog'); if (!first) return; const second = prompt('Second remote log (optional):', ''); const sources = []; for (const file of [first, second].filter(Boolean)) { const read = await api.files.readRemote(session, file); sources.push({ name: file, content: read.content }); } result = await api.advanced.correlateLogs(sources); }
    else if (action === 'anomaly') { if (session) result = await api.advanced.anomalyBaseline(session.id); else { const samples = (prompt('Numeric samples, comma separated (latest last):', '10,11,9,10,12,80') || '').split(',').map(Number); result = await api.advanced.anomaly(samples); } }
    else if (action === 'explain') result = await api.advanced.explain(prompt('Paste the error or stack trace:') || '');
    else if (action === 'safe-command') { const kind = prompt('Template: tail, journal, disk, ports or dockerLogs', 'journal'); if (!kind) return; result = await api.advanced.safeCommand(kind, { unit: prompt('Unit/container/path as applicable:', 'nginx.service'), path: '/var/log/syslog', container: 'app', lines: 200 }); }
    else if (action === 'runbook-suggest') { const incident = await chooseIncident(); if (!incident) return; result = await api.incident.suggestRunbook(incident.id); }
    else if (action === 'health-save') { if (!opsPromptSession()) return; const name = prompt('Health contract name:', `${session.name} contract`); if (!name) return; const type = prompt('Check type: port, process or file', 'port'); const target = prompt('Expected target:', type === 'port' ? '443' : type === 'process' ? 'nginx' : '/var/www/app'); result = await api.advanced.healthSave({ name, sessionId: session.id, checks: [{ type, target }] }); }
    else if (action === 'health-run') { const configuration = await api.advanced.configuration(); const id = prompt(`Health contract ID:\n${configuration.healthContracts.map(item => `${item.id} · ${item.name}`).join('\n')}`, configuration.healthContracts[0]?.id || ''); if (!id) return; result = await api.advanced.healthEvaluate(id); }
    else if (action === 'maintenance') { if (!opsPromptSession()) return; const startsAt = prompt('Start ISO date/time:', new Date().toISOString()); const endsAt = prompt('End ISO date/time:', new Date(Date.now() + 3600000).toISOString()); result = await api.advanced.maintenanceSave({ name: prompt('Window name:', 'Production maintenance'), sessionId: session.id, startsAt, endsAt, operations: ['deploy', 'firewall', 'restart'] }); }
    else if (action === 'ssh-ca') { const name = prompt('SSH CA name:', 'kitsune-user-ca'); if (!name) return; result = await api.resilience.createSshCa(name, prompt('Optional CA passphrase:', '') || ''); if (session && confirm('Install this CA as TrustedUserCAKeys on the selected server? This requires sudo.')) result.install = await api.resilience.installSshCa(session, result.id); }
    else if (action === 'proxy') { if (!opsPromptSession()) return; const proxyCommand = prompt('ProxyCommand (allowed: ssh, nc/ncat, connect-proxy, cloudflared; %h, %p, %r placeholders):', session.proxyCommand || 'nc -X 5 -x 127.0.0.1:1080 %h %p'); if (proxyCommand === null) return; result = await api.remote.save({ ...session, proxyCommand }, {}); await loadRemoteSessions(); }
    else if (action === 'mosh') { if (!opsPromptSession()) return; result = await api.resilience.openMosh(session); }
    else if (action === 'ports') { if (!opsPromptSession()) return; result = await api.resilience.ports(session); result = result.stdout || result; }
    else if (action === 'db-tunnel') { if (!opsPromptSession()) return; const remotePort = Number(prompt('Database port:', '5432')); result = await api.resilience.databaseTunnel(session, { remotePort, localPort: 0, remoteHost: '127.0.0.1' }); }
    else if (action === 'dns') { const hostname = prompt('Hostname:', session?.host || 'example.com'); if (!hostname) return; result = await api.advanced.dns(hostname); if (confirm('Compare public propagation through Cloudflare, Google and Quad9?')) result.propagation = await api.advanced.dnsPropagation(hostname, prompt('Record type:', 'A') || 'A'); }
    else if (action === 'certificate') { const hostname = prompt('TLS hostname:', session?.host || 'example.com'); if (!hostname) return; result = await api.advanced.certificate(hostname, Number(prompt('Port:', '443')) || 443); if (session && confirm('Run ACME renewal on the selected server?')) { const provider = prompt('Provider: certbot, acme.sh or caddy', 'certbot'); if (provider && confirm(`Renew ${hostname} using ${provider}?`)) result.renewal = await api.resilience.certificateRenew(session, provider, hostname); } }
    else if (action === 'cron') { if (!opsPromptSession()) return; const operation = prompt('cron action: list or install', 'list'); result = await api.resilience.cron(session, operation, operation === 'install' ? { line: prompt('Cron expression and command:', '0 2 * * * /usr/local/bin/backup') } : {}); }
    else if (action === 'timer') { if (!opsPromptSession()) return; const operation = prompt('systemd timer action: install, status or remove', 'status'); const name = prompt('Timer name:', 'kitsune-health'); result = await api.resilience.timer(session, operation, { name, calendar: 'hourly', command: '/usr/bin/true' }); }
    else if (action === 'firewall') { if (!opsPromptSession()) return; const operation = prompt('Firewall action: status, allow, deny or delete', 'status'); const rule = operation === 'status' ? {} : { port: Number(prompt('Port:', '443')), protocol: prompt('Protocol: tcp or udp', 'tcp'), source: prompt('Source CIDR or any:', 'any') }; const preview = await api.resilience.firewall(session, operation, rule, false); if (operation === 'status') result = preview.stdout || preview; else if (confirm(`Apply firewall rule?\n\n${preview.preview}`)) result = await api.resilience.firewall(session, operation, rule, true); else result = preview; }
    else if (action === 'cache') { const file = prompt('Local file to add to content cache:', remoteState.selectedLocal?.path || ''); if (!file) return; result = await api.resilience.cachePut(file); }
    else if (action === 'dedupe-backup') { const source = prompt('Local file or directory:', remoteState.local?.path || ''); if (!source) return; result = await api.resilience.backup(source, prompt('Backup name:', 'Deduplicated backup')); }
    else if (action === 'offline-vault') { const passphrase = prompt('Offline Vault passphrase (minimum 12 characters):'); if (!passphrase) return; result = await api.resilience.offlineVault({ passphrase, profiles: remoteState.sessions, runbooks: [], publicKeys: await api.suite.keys(), tools: await api.portable.list() }); }
    else if (action === 'break-glass') { const mode = prompt('Break glass: create or consume', 'create'); if (mode === 'consume') { const grant = prompt('Grant in ID:CODE format:'); if (!grant?.includes(':')) return; const separator = grant.indexOf(':'); const username = prompt('Owner username:'); const password = prompt('Owner password:'); const secondFactor = prompt('Authenticator or recovery code (required when MFA is enabled):', ''); result = await api.resilience.breakGlassConsume(grant.slice(0, separator), grant.slice(separator + 1), { username, password, secondFactor }); } else { if (!opsPromptSession()) return; const reason = prompt('Emergency reason (required):'); if (!reason) return; if (!confirm('Create a 15-minute emergency access grant? The action is audited.')) return; result = await api.resilience.breakGlassCreate({ sessionId: session.id, reason, requestedBy: 'Local owner', ttlMinutes: 15 }); await navigator.clipboard.writeText(`${result.id}:${result.code}`); } }
    else if (action === 'policy') { const name = prompt('Policy name:', 'Production access'); if (!name) return; const actions = (prompt('Actions, comma separated:', 'connect,deploy,terminal') || '').split(',').map(value => value.trim()).filter(Boolean); result = await api.fabric.policySave({ name, effect: prompt('Effect: allow or deny', 'allow'), actions, sessionIds: session ? [session.id] : ['*'], minimumApprovals: Number(prompt('Minimum authenticated approvals:', '1')) || 0, requireMfa: confirm('Require MFA for this policy?'), conditions: session?.production ? [{ field: 'production', operator: 'eq', value: true }] : [] }); await refreshOperationsCenter(); }
    else if (action === 'access-grant') { const mode = prompt('Access workflow: request, approve or consume', 'request'); if (mode === 'request') { if (!opsPromptSession()) return; const actionName = prompt('Requested scope:', 'connect'); if (!actionName) return; result = await api.fabric.accessBegin({ subject: prompt('Requesting identity:', 'operator'), sessionId: session.id, scopes: [actionName], action: actionName, reason: prompt('Access reason:', 'Operational work'), production: session.production, ttlMinutes: Number(prompt('Grant lifetime in minutes:', '15')) || 15 }); if (result.success) await api.fabric.clipboardWrite(result.request.id, { ttlSeconds: 120, sessionId: session.id }); } else if (mode === 'approve') { const requestId = prompt('Access request ID:'); if (!requestId) return; const username = prompt('Approver username:'); const password = prompt('Approver password:'); const secondFactor = prompt('Authenticator/recovery code when enabled:', ''); result = await api.fabric.accessApprove(requestId, { username, password, secondFactor }); if (result.issued) { operationsState.accessGrant = result; await api.fabric.clipboardWrite(result.token, { ttlSeconds: 60, sessionId: result.grant.sessionId, allowSecrets: true }); } } else if (mode === 'consume') { const token = prompt('Signed access token:'); const scope = prompt('Scope:', 'connect'); if (!token || !scope) return; result = await api.fabric.accessConsume(token, scope); if (result.success && scope === 'connect') { const target = remoteState.sessions.find(item => item.id === result.sessionId); if (target && confirm(`Grant accepted for ${target.name}. Open terminal now?`)) { switchToPanel('terminal'); await createTerminal(target); } } } else return; }
    else if (action === 'secret-broker') { const reference = prompt('Secret reference:', 'DEPLOY_TOKEN'); const value = prompt('Secret value (stored encrypted and never written to state):'); if (!reference || !value) return; result = await api.fabric.secretLeaseCreate({ reference, value, scopes: ['remote-env'], ttlMinutes: 5 }); if (session && confirm('Use this one-time lease in a remote command now?')) { const command = prompt(`Command using $${reference}:`, `test -n "$${reference}" && echo secret-injected`); if (command && confirm('Execute the reviewed command? The secret value is excluded from audit metadata.')) result.execution = await api.fabric.secretLeaseUse(result.lease.id, session, reference.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase(), command); } }
    else if (action === 'secure-clipboard') { const value = prompt('Value to place in the self-clearing clipboard:'); if (!value) return; const ttlSeconds = Number(prompt('Clear after seconds:', '30')) || 30; try { result = await api.fabric.clipboardWrite(value, { ttlSeconds, sessionId: session?.id || '', allowSecrets: false }); } catch (error) { if (!confirm(`${error.message}. Copy with explicit secret override?`)) throw error; result = await api.fabric.clipboardWrite(value, { ttlSeconds, sessionId: session?.id || '', allowSecrets: true }); } }
    else if (action === 'service-map') { if (!opsPromptSession()) return; result = await api.fabric.serviceMap(session); operationsState.graph = result; renderOperationsGraph(); }
    else if (action === 'gitops') { if (!opsPromptSession()) return; const capture = operationsState.captures.get(session.id) || await api.advanced.captureInfrastructure(session); operationsState.captures.set(session.id, capture); const format = prompt('Export format: ansible, opentofu or compose', 'ansible'); const target = prompt('Local output file:', `D:\\kitsuneserv-${session.name.replace(/[^A-Za-z0-9_-]/g, '-')}.${format === 'ansible' ? 'yml' : format === 'opentofu' ? 'tf' : 'yaml'}`); if (!format || !target) return; result = await api.fabric.gitOpsExport(capture, format, target); }
    else if (action === 'fleet') { const targets = confirm('Run on every saved SSH server? Cancel uses only the selected server.') ? remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type)) : session ? [session] : []; if (!targets.length) return showToast('Choose at least one server', 'warning'); const template = prompt('Safe template: disk, ports, tail, journal or dockerLogs', 'disk'); if (!template) return; if (!confirm(`Run bounded ${template} inspection on ${targets.length} server(s)?`)) return; result = await api.fabric.fleetRun(targets.map(item => item.id), template, { path: '/var/log/syslog', unit: 'nginx.service', container: 'app', lines: 200 }, { batchSize: Number(prompt('Parallel batch size:', '3')) || 3, canarySessionId: targets[0].id, stopOnError: true }); }
    else if (action === 'network-recorder') { if (!opsPromptSession()) return; const durationSeconds = Number(prompt('Capture duration (5–300 seconds):', '30')) || 30; const port = Number(prompt('Optional port filter (0 = all):', '0')) || 0; if (!confirm(`Run bounded tcpdump on ${session.name} for ${durationSeconds} seconds? This may require sudo.`)) return; result = await api.fabric.networkRecord(session, { durationSeconds, port, incidentId: operationsState.activeIncidentId }); }
    else if (action === 'synthetic') { const kind = prompt('Synthetic type: http or ssh', session ? 'ssh' : 'http'); if (!kind) return; const saved = await api.fabric.syntheticSave({ name: prompt('Scenario name:', `${session?.name || 'Endpoint'} synthetic`), kind, target: kind === 'http' ? prompt('HTTPS endpoint:', `https://${session?.host || 'example.com'}/`) : '', sessionId: kind === 'ssh' ? session?.id : '', expectedStatus: 200, maximumMs: 5000, consecutiveFailuresToIncident: 3, intervalMinutes: Number(prompt('Automatic interval in minutes:', '5')) || 5, enabled: true }); result = await api.fabric.syntheticRun(saved.scenario.id); }
    else if (action === 'canary') { if (!opsPromptSession()) return; const trafficCommandTemplate = prompt('Optional reviewed traffic command; use {{percent}} placeholder (blank = controller only):', ''); const rollbackCommand = trafficCommandTemplate ? prompt('Required rollback command:', '') : ''; if (trafficCommandTemplate && (!rollbackCommand || !confirm(`Canary will execute:\n${trafficCommandTemplate}\n\nRollback:\n${rollbackCommand}\n\nContinue?`))) return; const saved = await api.fabric.canarySave({ name: prompt('Canary name:', `${session.name} rollout`), sessionId: session.id, stages: [1, 10, 50, 100], maximumErrorRate: Number(prompt('Maximum error rate (0–1):', '0.05')), maximumLatencyMs: Number(prompt('Maximum latency ms:', '2000')), trafficCommandTemplate, rollbackCommand }); operationsState.canary = saved.canary; result = await api.fabric.canaryAdvance(saved.canary.id, { errorRate: Number(prompt('Observed error rate:', '0')), latencyMs: Number(prompt('Observed p95 latency ms:', '500')) }); }
    else if (action === 'dr-simulator') { const backupId = prompt('Deduplicated backup ID (shown after creating a backup):'); if (!backupId) return; result = await api.fabric.disasterSimulate(backupId); }
    else if (action === 'database-studio') { const mode = prompt('Database Studio: capture, diff, erd, masked-export or mask-json', 'capture'); if (!mode) return; const database = document.getElementById('dbm-database')?.value || ''; const connection = databaseManagerState.connection; if (['capture', 'diff', 'erd', 'masked-export'].includes(mode) && (!connection || !database)) return showToast('Connect and select a database in Database Manager first', 'warning'); if (mode === 'masked-export') { const target = prompt('Local masked dataset file:', `D:\\${database}-masked.json`); if (!target) return; result = await api.fabric.databaseMaskedExport(connection, database, target, Number(prompt('Maximum rows per table:', '1000')) || 1000); } else if (mode === 'mask-json') { const rows = JSON.parse(prompt('Rows JSON array:', '[{"name":"Alice","email":"alice@example.com","token":"secret"}]') || '[]'); result = await api.fabric.databaseMask(rows, {}); } else { const captured = await api.fabric.databaseSchemaCapture(connection, database); result = mode === 'erd' ? await api.fabric.databaseErd(captured) : mode === 'diff' ? await api.fabric.databaseSchemaDiff(captured, JSON.parse(prompt('Desired/captured schema JSON:', '{"objects":[]}') || '{"objects":[]}')) : captured; } }
    else if (action === 'offline-mount') { const provider = prompt('Provider: remote or cloud', session ? 'remote' : 'cloud'); if (!provider) return; let profile; if (provider === 'remote') profile = session; else { const profiles = await api.storage.list(); const name = prompt(`Storage profile:\n${profiles.map(item => item.name).join('\n')}`, profiles[0]?.name || ''); profile = profiles.find(item => item.name === name); } if (!profile) return showToast('Select a matching server/storage profile', 'warning'); const saved = await api.fabric.offlineMountSave({ name: prompt('Offline mount name:', `${profile.name} offline`), provider, profileId: profile.id, remoteRoot: prompt('Remote root:', profile.remotePath || profile.rootPath || '/') }); operationsState.offlineMount = saved.mount; if (confirm('Queue a text file change now?')) { const relativePath = prompt('Relative path:', 'notes.txt'); const content = prompt('Offline content:', ''); if (relativePath && content !== null) await api.fabric.offlineStage(saved.mount.id, relativePath, content, ''); } result = confirm('Reconcile queued changes now?') ? await api.fabric.offlineReconcile(saved.mount.id) : saved; }
    else if (action === 'ephemeral') { const source = prompt('Project source directory or Git URL:', remoteState.local?.path || ''); if (!source) return; result = await api.fabric.ephemeralSave({ name: prompt('Preview environment name:', 'Branch preview'), source, branch: prompt('Branch:', 'main'), ttlMinutes: Number(prompt('Lifetime in minutes:', '120')) || 120, databaseClone: confirm('Include an isolated masked database clone plan?') }); }
    else if (action === 'remote-desktop-pro') { if (!opsPromptSession()) return; const protocol = prompt('Protocol: rdp or vnc', 'rdp'); if (!protocol) return; const saved = await api.fabric.remoteDesktopSave({ name: `${session.name} desktop`, sessionId: session.id, protocol, clipboardPolicy: prompt('Clipboard policy: disabled, text-only or full', 'text-only'), fileTransfer: confirm('Allow governed file transfer?'), recordAudit: true }); const launched = protocol === 'vnc' ? await api.remote.openVnc({ ...session, desktopPolicy: saved.workspace }) : await api.remote.openRdp({ ...session, desktopPolicy: saved.workspace }); result = { ...saved, launched }; }
    else if (action === 'rescue') { const target = prompt('Empty/local rescue directory:', 'D:\\KitsuneServ-Rescue'); if (!target) return; const passphrase = prompt('Optional Offline Vault passphrase (12+ chars; blank skips encrypted vault):', ''); result = await api.fabric.rescueCreate({ target, offlineVaultPassphrase: passphrase, tools: await api.portable.list() }); }
    else if (action === 'evidence-vault') { const payload = { kind: prompt('Evidence kind:', 'operator-note'), note: prompt('Evidence content:', document.getElementById('ops-output').textContent), sessionId: session?.id || '', capturedAt: new Date().toISOString() }; result = await api.fabric.evidenceSeal(payload); if (confirm('Verify the sealed object immediately?')) result.verification = await api.fabric.evidenceVerify(result.record.id); }
    else if (action === 'local-copilot') { const logs = prompt('Paste logs or error text:', document.getElementById('ops-output').textContent) || ''; const anomalies = session ? await api.advanced.anomalyBaseline(session.id) : null; let drift = null; if (session) try { drift = await api.advanced.drift(session); } catch {} result = await api.fabric.copilot({ logs, anomalies, drift }); }
    else if (action === 'agent') { const mode = prompt('Agent action: bootstrap, enroll, list or probe', 'bootstrap'); if (mode === 'bootstrap') result = await api.enterprise.agentBootstrap({ host: '0.0.0.0', port: 10991 }); else if (mode === 'enroll') { const endpoint = prompt('Agent endpoint:', 'https://server.example:10991'); const token = prompt('Enrollment token:'); if (!endpoint || !token) return; result = await api.enterprise.agentEnroll({ name: prompt('Agent name:', session?.name || 'server'), endpoint, token, environment: session?.production ? 'production' : 'staging' }); } else if (mode === 'probe') { const agents = await api.enterprise.agents(); const id = prompt(`Agent ID:\n${agents.map(item => `${item.id} · ${item.name}`).join('\n')}`, agents[0]?.id || ''); if (!id) return; result = await api.enterprise.agentProbe(id); } else result = await api.enterprise.agents(); }
    else if (action === 'patch-orchestrator') { if (!opsPromptSession()) return; const saved = await api.enterprise.patchSave({ name: `${session.name} patch rollout`, sessionIds: [session.id], canarySessionId: session.id, batchSize: 1, stopOnError: true }); result = await api.enterprise.patchRun(saved.plan.id, { preview: true }); if (confirm(`Preview ready for ${session.name}. Run the allowlisted OS upgrade now?`)) result = await api.enterprise.patchRun(saved.plan.id, { preview: false }); }
    else if (action === 'reboot-coordinator') { if (!opsPromptSession()) return; const planned = await api.enterprise.rebootPlan({ name: `${session.name} safe reboot`, targets: [{ sessionId: session.id, quorumGroup: prompt('Quorum/replica group:', 'default'), priority: 100 }] }); result = planned; if (confirm(`Reboot ${session.name}? The coordinator will preserve quorum grouping.`)) result = await api.enterprise.rebootRun(planned.plan.id, { approved: true }); }
    else if (action === 'slo') { const mode = prompt('SLO action: create or evaluate', 'create'); if (mode === 'evaluate') result = await api.enterprise.sloEvaluate(); else { const target = Number(prompt('Availability target (0.5–0.99999):', '0.999')); const saved = await api.enterprise.sloSave({ name: prompt('SLO name:', 'API availability'), service: prompt('Service:', session?.name || 'api'), target, latencyMs: Number(prompt('Latency objective in ms:', '1000')), windowDays: 30, freezeOnExhaustion: true }); result = { saved, evaluation: await api.enterprise.sloEvaluate() }; } }
    else if (action === 'capacity') { const resource = prompt('Resource key:', session ? `${session.id}/disk-percent` : 'local/disk-percent'); if (!resource) return; const value = prompt('Current value (leave blank to only forecast):', ''); if (value !== '') await api.enterprise.capacityRecord(resource, Number(value)); result = await api.enterprise.capacityForecast(resource, Number(prompt('Exhaustion limit:', '100')) || 100); }
    else if (action === 'voice-console') return startVoiceOperationsConsole();
    else if (action === 'compliance') { if (!opsPromptSession()) return; const baseline = await api.enterprise.complianceSave({ name: 'Hardened SSH baseline', requireFirewall: true, prohibitRootSsh: true, prohibitPasswordSsh: true, requireAutomaticUpdates: confirm('Require automatic security updates?') }); result = await api.enterprise.complianceScan(baseline.baseline.id, [session.id]); }
    else if (action === 'supply-chain') { const target = prompt('Local directory to scan:', remoteState.local?.path || ''); if (!target) return; result = await api.enterprise.supplyChainScan({ target }); }
    else if (action === 'image-promotion') { const image = prompt('Image name:', 'registry.example/app'); const digest = prompt('Immutable digest (sha256:…):'); if (!image || !digest) return; const stage = prompt('Stage: development, staging, canary or production', 'development'); if (stage === 'production' && !confirm('Promote this verified digest to production?')) return; result = await api.enterprise.imagePromote({ image, digest, stage, approvedBy: stage === 'production' ? 'Local owner' : '' }); }
    else if (action === 'airgap') { const source = prompt('Source directory:', remoteState.local?.path || ''); const destination = prompt('Offline/removable destination:', ''); if (!source || !destination) return; result = await api.enterprise.airgapCreate({ source, destination, retentionDays: Number(prompt('Retention lock days:', '90')) || 90 }); }
    else if (action === 'chaos-lab') { if (!opsPromptSession()) return; if (session.production) return showToast('Chaos Lab refuses production servers', 'error'); const created = await api.enterprise.chaosSave({ name: `${session.name} resilience test`, environment: 'staging', sessionId: session.id, action: prompt('Action: latency, container-pause or disk-pressure', 'latency'), target: prompt('Interface/container:', 'eth0'), durationSeconds: Number(prompt('Duration seconds (max 300):', '30')) }); result = created; if (confirm('Run this bounded experiment with automatic rollback now?')) result = await api.enterprise.chaosRun(created.experiment.id, { approved: true }); }
    else if (action === 'remediation') { const saved = await api.enterprise.remediationSave({ name: prompt('Rule name:', 'Restart failed service'), signal: prompt('Signal name:', 'service_failures'), threshold: Number(prompt('Threshold:', '1')), action: prompt('Action: restart-service, restart-container or collect-diagnostics', 'restart-service'), target: prompt('Service/container:', 'app.service'), maxAttempts: 1 }); result = saved; }
    else if (action === 'autonomous-sandbox') { const signal = prompt('Signal name:', 'service_failures'); const value = Number(prompt('Observed value:', '1')); result = await api.enterprise.autonomousSandbox({ signals: { [signal]: value }, capture: session ? (operationsState.captures.get(session.id) || {}) : {} }); }
    else if (action === 'migration-rehearsal') { const connections = await api.db.connections(); const connection = connections.find(item => item.name === prompt(`Connection:\n${connections.map(item => item.name).join(', ')}`, connections[0]?.name || '')); if (!connection) return; const database = prompt('Disposable database (must end _rehearsal, _preview or _sandbox):', 'app_rehearsal'); const sql = prompt('SQL migration to execute in the disposable clone:'); if (!database || !sql || !confirm(`Run migration only in ${database}?`)) return; result = await api.enterprise.migrationRehearse(connection, database, sql); }
    else if (action === 'config-studio') { const type = prompt('Type: nginx, caddy, systemd, compose or kubernetes', 'nginx'); const file = prompt('Local configuration file:', ''); if (!type || !file) return; result = await api.enterprise.configValidate({ type, file }); }
    else if (action === 'bare-metal') { const hostname = prompt('New node hostname:', 'kitsune-node'); const sshPublicKey = prompt('SSH public key:'); if (!hostname || !sshPublicKey) return; result = await api.enterprise.cloudInit({ hostname, sshPublicKey, target: prompt('Output cloud-init YAML:', '') || undefined }); }
    else if (action === 'oidc') { const provider = prompt('Provider: aws, azure or gcloud', 'aws'); if (!provider) return; const saved = await api.enterprise.oidcSave({ name: `${provider} login`, provider, account: prompt('Profile/account:', 'default'), tenant: prompt('Tenant (Azure only):', '') }); result = saved; if (confirm('Start the provider device/browser login now? No long-lived token is stored by KitsuneServ.')) result.login = await api.enterprise.oidcLogin(saved.profile.id); }
    else if (action === 'region') { result = await api.enterprise.regionSave({ name: prompt('Region name:', 'eu-central'), endpoint: prompt('Control endpoint:', 'https://region.example'), priority: Number(prompt('Priority:', '100')), sessionIds: session ? [session.id] : [], health: 'healthy' }); }
    else if (action === 'failover') { const config = await api.enterprise.configuration(); const fromId = prompt(`Source region ID:\n${config.regions.map(item => `${item.id} · ${item.name}`).join('\n')}`, config.regions[0]?.id || ''); const toId = prompt('Target region ID:', config.regions[1]?.id || ''); if (!fromId || !toId) return; result = await api.enterprise.failoverPlan(fromId, toId); }
    else if (action === 'marketplace') { const raw = prompt('Signed declarative pack JSON:'); const signature = prompt('HMAC signature:'); const trustedKey = prompt('Trusted publisher key:'); if (!raw || !signature || !trustedKey) return; result = await api.enterprise.marketplaceInstall({ payload: JSON.parse(raw), signature, trustedKey }); }
    else if (action === 'relay-mesh') { const agents = await api.enterprise.agents(); if (!agents.length) return showToast('Enroll a Kitsune Agent first', 'warning'); const config = await api.nextgen.configuration(); const mode = prompt('Relay action: add, route or bootstrap', config.relayNodes.length > 1 ? 'route' : 'add'); if (mode === 'add') result = await api.nextgen.relaySave({ name: prompt('Relay node name:', agents[0].name), agentId: prompt(`Agent ID:\n${agents.map(item => `${item.id} · ${item.name}`).join('\n')}`, agents[0].id), region: prompt('Region:', 'local'), cost: Number(prompt('Route cost:', '10')), links: (prompt('Linked relay IDs, comma separated:', '') || '').split(',').map(value => value.trim()).filter(Boolean) }); else if (mode === 'route') { const next = await api.nextgen.configuration(); const fromId = prompt(`From relay ID:\n${next.relayNodes.map(item => `${item.id} · ${item.name}`).join('\n')}`, next.relayNodes[0]?.id || ''); const toId = prompt('To relay ID:', next.relayNodes[1]?.id || ''); result = await api.nextgen.relayRoute(fromId, toId); } else result = await api.nextgen.relayBootstrap({ host: prompt('Relay SSH host:'), user: prompt('Relay user:', 'kitsune-relay'), port: 22, remotePort: Number(prompt('Remote loopback port:', '10992')), localPort: 10991 }); }
    else if (action === 'privilege-broker') { const agents = await api.enterprise.agents(); const agentId = prompt(`Agent ID:\n${agents.map(item => `${item.id} · ${item.name}`).join('\n')}`, agents[0]?.id || ''); if (!agentId) return; const actionName = prompt('Capability: service-status, service-restart, diagnostics or relay-start', 'service-status'); const resource = ['service-status', 'service-restart'].includes(actionName) ? prompt('Exact service:', 'nginx.service') : 'system'; const issued = await api.nextgen.capabilityIssue({ agentId, action: actionName, resource, ttlMinutes: 5, issuedBy: 'Local owner' }); result = issued; if (confirm('Consume this single-use capability now?')) result = await api.nextgen.capabilityUse(issued.grant.id, actionName === 'relay-start' ? { host: prompt('Relay host:'), user: 'kitsune-relay', port: 22, remotePort: Number(prompt('Remote port:', '10992')), localPort: 10991 } : {}); }
    else if (action === 'connectivity-heal') { if (!opsPromptSession()) return; const agents = await api.enterprise.agents(); result = await api.nextgen.connectivityHeal({ session, agentId: prompt('Fallback Agent ID (optional):', agents[0]?.id || '') || '' }); }
    else if (action === 'ssh-cert-broker') { const caId = prompt('Existing SSH CA ID:'); const publicKey = prompt('Public key file:'); if (!caId || !publicKey) return; const policy = await api.nextgen.sshPolicySave({ name: 'WebAuthn/MFA SSH certificate', caId, principals: (prompt('Principals, comma separated:', 'kitsune') || '').split(',').map(value => value.trim()).filter(Boolean), validity: '+15m', requireWebAuthn: true }); const auth = askFreshAuthentication(); if (!auth) return; result = await api.nextgen.sshCertificateIssue(policy.policy.id, publicKey, prompt('Certificate identity:', 'kitsune-session'), auth); }
    else if (action === 'delta-transfer') { const source = prompt('New/source file:'); const destination = prompt('Existing destination file:'); if (!source || !destination) return; const signature = await api.nextgen.deltaSignature(destination, 65536); const plan = await api.nextgen.deltaPlan(source, signature); result = plan; if (confirm(`Transfer ${plan.transferBytes} bytes and save ${plan.savedBytes} bytes using an atomic delta update?`)) result = await api.nextgen.deltaApply(source, destination, plan); }
    else if (action === 'filesystem-time-travel') { const config = await api.nextgen.configuration(); const mode = prompt('Time Travel action: snapshot, browse or restore', config.snapshots.length ? 'browse' : 'snapshot'); if (mode === 'snapshot') result = await api.nextgen.snapshotCreate({ source: prompt('Directory to snapshot:', remoteState.local?.path || ''), name: prompt('Snapshot name:', 'Before change') }); else { const id = prompt(`Snapshot ID:\n${config.snapshots.map(item => `${item.id} · ${item.name}`).join('\n')}`, config.snapshots[0]?.id || ''); const files = await api.nextgen.snapshotBrowse(id, prompt('Path prefix:', '') || ''); result = files; if (mode === 'restore') { const relative = prompt(`File to restore:\n${files.slice(0, 20).map(item => item.path).join('\n')}`, files[0]?.path || ''); const target = prompt('Restore destination:'); if (relative && target && confirm(`Restore ${relative} to ${target}?`)) result = await api.nextgen.snapshotRestore(id, relative, target); } } }
    else if (action === 'ransomware-guard') { const root = prompt('Protected directory:', remoteState.local?.path || ''); if (!root) return; const mode = prompt('Ransomware Guard: baseline or scan', 'scan'); if (mode === 'baseline') result = await api.nextgen.ransomwareBaseline(root); else { try { result = await api.nextgen.ransomwareScan(root, { changeLimit: Number(prompt('Mass-change threshold:', '100')) }); } catch (error) { if (!/baseline/i.test(error.message) || !confirm('No baseline exists. Create it now?')) throw error; result = await api.nextgen.ransomwareBaseline(root); } } }
    else if (action === 'remote-transaction') { if (!opsPromptSession()) return; const service = prompt('Service to restart transactionally:', 'nginx.service'); const steps = [{ kind: 'service-restart', target: service }]; const preview = await api.nextgen.transaction(session, steps, { approved: true, preview: true }); result = preview; if (confirm(`Execute the previewed transaction and rollback on health failure?`)) result = await api.nextgen.transaction(session, steps, { approved: true, healthCommand: `systemctl is-active -- ${service}` }); }
    else if (action === 'ebpf') { if (!opsPromptSession()) return; result = await api.nextgen.ebpf(session, prompt('Probe: network, disk or oom', 'network')); }
    else if (action === 'network-twin') { const host = prompt('Affected host:', session?.host || 'server'); const port = Number(prompt('Port affected:', '22')); result = await api.nextgen.networkTwin({ services: [{ name: session?.name || 'management', host, port, critical: true }], changes: [{ action: prompt('Change: deny, remove-route or dns', 'deny'), host, port }] }); }
    else if (action === 'black-box') { const mode = prompt('Black Box action: record or export', 'export'); if (mode === 'record') result = await api.nextgen.blackBoxRecord({ kind: prompt('Event kind:', 'manual-note'), message: prompt('Non-secret operational note:', '') }); else result = await api.nextgen.blackBoxExport(Number(prompt('Minutes:', '30')) || 30); }
    else if (action === 'server-dna') { if (!opsPromptSession()) return; const captured = await api.nextgen.dnaCapture(session); result = captured; const config = await api.nextgen.configuration(); const other = remoteState.sessions.find(item => item.id !== session.id); if (other && confirm(`Capture and compare with ${other.name}?`)) { await api.nextgen.dnaCapture(other); result = await api.nextgen.dnaCompare(session.id, other.id); } }
    else if (action === 'pair-operations') { const pair = await api.nextgen.pairCreate({ resource: terminalState.activeId || remoteState.selectedRemote?.path || session?.id || 'operations', kind: terminalState.activeId ? 'terminal' : 'files', owner: 'Local owner', fourEyes: true, ttlMinutes: 120 }); result = pair; const proposed = prompt('Optional action to propose for four-eyes approval:', ''); if (proposed) result.proposal = await api.nextgen.pairPropose(pair.session.id, proposed, 'Local owner'); }
    else if (action === 'mobile-approval') { const created = await api.nextgen.mobileCreate({ action: prompt('Action requiring approval:', 'production deployment'), target: session?.name || 'infrastructure', requestedBy: 'Local owner', ttlMinutes: 5, relyingParty: location.hostname }); result = created; try { await navigator.clipboard.writeText(JSON.stringify({ id: created.approval.id, challenge: created.challenge })); } catch {} if (confirm('Resolve this approval on this device with fresh MFA now?')) { const auth = askFreshAuthentication(); if (auth) result = await api.nextgen.mobileResolve(created.approval.id, created.challenge, confirm('Approve? Cancel means deny.') ? 'approve' : 'deny', auth); } }
    else if (action === 'offline-pwa') { if (!window.kitsuneOfflineVault) return showToast('Offline Vault is unavailable in this runtime', 'warning'); const passphrase = prompt('Offline Vault passphrase (minimum 12 characters):'); if (!passphrase) return; const [enterpriseConfig, nextgenConfig] = await Promise.all([api.enterprise.configuration(), api.nextgen.configuration()]); result = await window.kitsuneOfflineVault.save('operations-rescue', { enterprise: enterpriseConfig, nextgen: nextgenConfig, savedAt: new Date().toISOString(), secretsIncluded: false }, passphrase); }
    else if (action === 'embedded-desktop') { const saved = await api.nextgen.desktopSave({ name: prompt('Desktop name:', session?.name || 'Remote desktop'), type: prompt('Gateway: guacamole or novnc', 'guacamole'), endpoint: prompt('HTTPS gateway URL:'), sessionId: session?.id || '', clipboardPolicy: prompt('Clipboard: disabled, text-only or full', 'text-only'), fileTransfer: confirm('Allow file transfer?'), recordAudit: true }); result = saved; if (confirm('Open this governed desktop inside KitsuneServ?')) openEmbeddedDesktop(saved.gateway); }
    else if (action === 'wasm-sandbox') { const file = prompt('WASM module file (must export run and import nothing):'); if (!file) return; result = await api.nextgen.wasmRun({ file, args: (prompt('Numeric arguments, comma separated:', '') || '').split(',').filter(Boolean).map(Number) }); }
    else if (action === 'intent-operations') result = await api.nextgen.intentPlan({ intent: prompt('Describe the operational outcome:', 'Update the fleet without losing quorum') });
    else if (action === 'flight-simulator') { const created = await api.nextgen.simulatorCreate({ name: prompt('Exercise name:', 'Regional outage drill'), topology: operationsState.graph || { nodes: [], edges: [] }, timeline: [], faults: [{ id: 'fault-1', kind: prompt('Fault: latency, packet-loss, service-down, disk-full or certificate-expired', 'service-down'), target: session?.id || 'service' }] }); const response = prompt('Your response step:', 'Inspect health contract and fail over traffic'); result = await api.nextgen.simulatorRun(created.simulator.id, [{ faultId: 'fault-1', description: response, success: true }]); }
    else if (action === 'structured-shell') { const transcript = prompt('Paste an OSC 133 terminal transcript, or leave empty for integration hints:', ''); result = transcript ? await api.nextgen.shellParse(transcript) : { bashZsh: `printf '\\e]133;A\\a'; printf '\\e]133;B;%s\\a' "$BASH_COMMAND"; printf '\\e]133;D;%s\\a' "$?"`, powershell: 'Emit OSC 133 A/B/D markers from the prompt and command-completion hooks', effect: 'Commands become blocks with output and exit status.' }; }
    else if (TERMINAL_FILE_PRO_ACTIONS.has(action)) result = await runTerminalFileProAction(action, session);
    else if (OPERATIONS_WORKSPACE_ACTIONS.has(action)) result = await runOperationsWorkspaceAction(action, session);
    else if (action === 'replay-lab') { const file = prompt('Session Capsule JSON file:', ''); if (!file) return; const created = await api.fabric.replayCreate(file); operationsState.replayLab = created.lab; result = await api.fabric.replaySimulate(created.lab.id, { description: prompt('Action to simulate:', 'Restart affected service'), command: prompt('Optional command for risk analysis:', 'systemctl restart app'), target: 'isolated-lab' }); }
    opsPrint(result); if (result?.success === false) showToast('Operation completed with errors', 'error'); else showToast('Operation completed', 'success');
  } catch (error) { opsPrint(error.message); showToast(error.message, 'error'); }
}

const OPERATIONS_WORKSPACE_ACTIONS = new Set(['universal-connection-workspace', 'command-timeline-undo', 'live-file-collaboration', 'connection-doctor-2', 'smart-transfer-engine', 'workspace-resume', 'secretless-connections', 'fleet-terminal-pro', 'environment-diff-pro', 'disposable-rescue', 'operational-memory', 'visual-ssh-multiplexer', 'infrastructure-movie', 'live-blast-map', 'remote-pair-debugger', 'policy-autocomplete', 'one-click-incident-room', 'network-path-replay', 'portable-rescue-kit', 'intent-command-palette']);

async function runOperationsWorkspaceAction(action, session) {
  if (action === 'universal-connection-workspace') {
    const ids = session ? [session.id] : remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type)).slice(0, 8).map(item => item.id);
    const saved = await api.opsWorkspace.save({ name: prompt('Workspace name:', session ? `${session.name} operations` : 'Universal connections'), sessionIds: ids, activeSessionId: session?.id || ids[0], panels: ['terminal', 'files', 'logs', 'metrics', 'processes', 'containers', 'database'], layout: 'grid', resumeState: { activePanel: 'server-workspace', terminalIds: [...terminalState.tabs.keys()], filePath: remoteState.selectedRemote?.path || '' } }); operationsState.activeUniversalWorkspace = saved.workspace; return saved;
  }
  if (action === 'workspace-resume') { const config = await api.opsWorkspace.configuration(); const id = prompt(`Workspace ID:\n${config.workspaces.map(item => `${item.id} · ${item.name}`).join('\n')}`, operationsState.activeUniversalWorkspace?.id || config.workspaces[0]?.id || ''); if (!id) return { cancelled: true }; const result = await api.opsWorkspace.resume(id); operationsState.activeUniversalWorkspace = result.workspace; if (result.workspace.activeSessionId) { const target = remoteState.sessions.find(item => item.id === result.workspace.activeSessionId); if (target && confirm(`Resume ${target.name} terminal now?`)) { switchToPanel('terminal'); await createTerminal(target); } } return result; }
  if (action === 'command-timeline-undo') { if (!session) throw new Error('Choose a server first'); const events = await api.opsWorkspace.timeline(session.id, { minutes: 10080, limit: 1000 }); const undoable = [...events].reverse().find(item => item.undo?.snapshotId && !item.undoneAt); if (undoable && confirm(`Undo the latest supported action “${undoable.command}” using its snapshot?`)) { const plan = await api.opsWorkspace.undoPlan(undoable.id); opsPrint(plan); if (confirm('Execute this reviewed restore plan?')) return api.opsWorkspace.undoExecute(undoable.id, true); } return events; }
  if (action === 'live-file-collaboration') { if (!session) throw new Error('Choose a server first'); const target = remoteState.selectedRemote?.path || prompt('Remote file path:'); if (!target) return { cancelled: true }; const collaboration = await api.collaboration.start({ kind: 'editor', resourceId: target, owner: 'Local owner', ttlMinutes: 120 }); await api.collaboration.lockFile(collaboration.session.id, target, 'owner'); operationsState.collaboration = collaboration.session; return api.opsWorkspace.collaborativeChange({ sessionId: session.id, path: target, collaborationId: collaboration.session.id, participantId: 'owner', comment: 'Editing session opened', revision: 1 }); }
  if (action === 'connection-doctor-2') { if (!session) throw new Error('Choose a server first'); const result = await api.opsWorkspace.connectionDoctor(session.id); if (!result.success && confirm('Try direct/Agent/Relay self-healing path selection?')) result.selfHeal = await api.nextgen.connectivityHeal({ session }); return result; }
  if (action === 'smart-transfer-engine') { const bytes = Number(prompt('File size in bytes:', String(remoteState.selectedLocal?.size || 100000000))) || 0; return api.opsWorkspace.smartTransfer({ name: remoteState.selectedLocal?.name || prompt('File name:', 'archive.bin'), bytes, latencyMs: Number(prompt('Measured/expected RTT ms:', '30')), bandwidthMbps: Number(prompt('Available bandwidth Mbps:', '100')), sourceRemote: confirm('Is the source remote?'), destinationRemote: confirm('Is the destination remote?'), destinationSignature: bytes > 8 * 1024 * 1024 && confirm('Destination block signature is available?') ? { available: true } : null }); }
  if (action === 'secretless-connections') { if (!session) throw new Error('Choose a server first'); return api.opsWorkspace.secretless(session.id); }
  if (action === 'fleet-terminal-pro') { const selected = (prompt(`Server IDs, comma separated:\n${remoteState.sessions.map(item => `${item.id} · ${item.name}`).join('\n')}`, session?.id || '') || '').split(',').map(item => item.trim()).filter(Boolean); const template = prompt('Safe template: disk, ports, tail, journal or dockerLogs', 'disk'); if (!selected.length || !template) return { cancelled: true }; const parameters = template === 'tail' ? { path: prompt('Absolute path:', '/var/log/syslog'), lines: 200 } : template === 'journal' ? { unit: prompt('Unit:', 'nginx.service'), since: '1 hour ago' } : template === 'dockerLogs' ? { container: prompt('Container:', 'app'), lines: 200 } : {}; const preview = await api.opsWorkspace.fleetPreview(selected, template, parameters, { canarySessionId: selected[0], batchSize: Number(prompt('Batch size:', '3')), stopOnError: true }); operationsState.fleetPreview = preview; opsPrint(preview); return confirm(`Run reviewed command on ${selected.length} server(s), canary first?`) ? api.opsWorkspace.fleetExecute(preview, true) : preview; }
  if (action === 'environment-diff-pro') { if (!session) throw new Error('Choose a server first'); const other = remoteState.sessions.find(item => item.id !== session.id && ['ssh', 'sftp'].includes(item.type)); const right = prompt(`Comparison server ID:\n${remoteState.sessions.map(item => `${item.id} · ${item.name}`).join('\n')}`, other?.id || ''); return right ? api.opsWorkspace.environmentDiff(session.id, right) : { cancelled: true }; }
  if (action === 'disposable-rescue') { if (!session) throw new Error('Choose a server first'); const target = prompt('Empty/local rescue directory:'); return target ? api.opsWorkspace.disposableRescue({ target, sessionId: session.id, ttlHours: Number(prompt('Lifetime in hours:', '24')), tools: ['ssh', 'sftp', 'vncviewer'] }) : { cancelled: true }; }
  if (action === 'operational-memory') { const mode = prompt('Operational Memory: search or record', 'search'); return mode === 'record' ? api.opsWorkspace.memoryRecord({ signature: prompt('Problem signature:'), symptoms: (prompt('Symptoms, comma separated:', '') || '').split(',').filter(Boolean), resolution: prompt('Verified resolution:'), sessionId: session?.id || '', successful: true }) : api.opsWorkspace.memorySearch(prompt('Search local operational memory:', 'connection refused'), session?.id || ''); }
  if (action === 'visual-ssh-multiplexer') { const ids = (prompt(`Pane server IDs:\n${remoteState.sessions.map(item => `${item.id} · ${item.name}`).join('\n')}`, session?.id || '') || '').split(',').map(item => item.trim()).filter(Boolean); if (!ids.length) return { cancelled: true }; const synchronizedInput = confirm('Enable synchronized typing with confirmation?'); const saved = await api.opsWorkspace.multiplexerSave({ name: prompt('Multiplexer name:', 'Fleet console'), panes: ids.map(id => ({ sessionId: id, tmux: 'kitsune', readOnly: false })), synchronizedInput, requireConfirmation: true, layout: 'grid' }); if (confirm('Open the selected terminal panes now?')) { switchToPanel('terminal'); for (const id of ids) { const target = remoteState.sessions.find(item => item.id === id); if (target) await createTerminal(target); } terminalState.broadcast = synchronizedInput; renderTerminalLayout(); } return saved; }
  if (action === 'infrastructure-movie') { if (!session) throw new Error('Choose a server first'); return api.opsWorkspace.movie(session.id, { minutes: Number(prompt('Playback period in minutes:', '10080')) }); }
  if (action === 'live-blast-map') { if (!session) throw new Error('Choose a server first'); return api.opsWorkspace.blastRadius(session.id, prompt('Planned operation:', 'restart service')); }
  if (action === 'remote-pair-debugger') { const pair = await api.nextgen.pairCreate({ resource: terminalState.activeId || session?.id || 'terminal', kind: 'terminal', owner: 'Local owner', fourEyes: true, ttlMinutes: 120 }); const proposal = prompt('First reviewed debugging action:', 'Inspect service status'); if (proposal) pair.proposal = await api.nextgen.pairPropose(pair.session.id, proposal, 'Local owner'); return pair; }
  if (action === 'policy-autocomplete') return api.opsWorkspace.autocomplete({ query: prompt('Terminal completion query:', 'systemctl'), forbidden: (prompt('Forbidden keywords, comma separated:', 'restart,stop,delete') || '').split(',').map(item => item.trim()).filter(Boolean) });
  if (action === 'one-click-incident-room') { const result = await api.opsWorkspace.incidentRoom({ title: prompt('Terminal incident room:', 'Production connectivity incident'), severity: prompt('Severity:', 'sev2'), sessionIds: session ? [session.id] : [], commander: 'Local owner' }); operationsState.activeIncidentId = result.incident.id; operationsState.activeUniversalWorkspace = result.workspace; return result; }
  if (action === 'network-path-replay') { if (!session) throw new Error('Choose a server first'); const created = await api.opsWorkspace.networkReplayCreate({ name: `${session.name} path`, sessionId: session.id, latencyMs: Number(prompt('Baseline latency ms:', '30')), packetLossPercent: Number(prompt('Baseline packet loss %:', '0')), dns: session.host, scenarios: [{ kind: prompt('Scenario: latency, packet-loss, dns-failure, certificate-expired or route-loss', 'dns-failure') }] }); operationsState.networkReplay = created.replay; return api.opsWorkspace.networkReplayRun(created.replay.id, [{ kind: created.replay.scenarios[0]?.kind }]); }
  if (action === 'portable-rescue-kit') { const target = prompt('USB/folder destination for the portable rescue manifest:'); return target ? api.opsWorkspace.portableRescue({ target, tools: ['winscp', 'putty', 'plink', 'psftp', 'vncviewer'] }) : { cancelled: true }; }
  if (action === 'intent-command-palette') return api.opsWorkspace.palettePlan({ intent: prompt('Describe the terminal/file outcome:', 'Compare two servers and show configuration differences'), sessionId: session?.id || '' });
  throw new Error('Unknown terminal workspace action');
}

const VISION_FORMS = {
  'remote-workspace-drive': { title: 'Remote Workspace Drive', description: 'Create a cache-backed virtual workspace for local applications.', safety: 'This prepares a mount plan. Credentials are never included and writes use a conflict journal.', fields: [['name', 'Workspace name', 'text', 'Remote project'], ['remoteRoot', 'Remote root', 'text', '/srv/app'], ['localMount', 'Local mount directory', 'text', ''], ['cacheMode', 'Cache strategy', 'select', 'on-demand', ['metadata', 'on-demand', 'offline']]] },
  'delta-transfer-engine': { title: 'Delta Transfer Engine', description: 'Compare block signatures and calculate the minimum verified transfer.', safety: 'Planning is local and read-only; applying the transfer is a separate approval step.', fields: [['sourceHashes', 'Source block hashes (one per line)', 'textarea', 'a1\nb2\nc3'], ['targetHashes', 'Hashes already at destination', 'textarea', 'a1'], ['parallelStreams', 'Parallel streams', 'number', '4']] },
  'offline-workspace': { title: 'Offline Workspace', description: 'Prepare a local working copy with conflict-aware reconciliation.', safety: 'No secret is cached. Conflicting edits always stop for a three-way review.', fields: [['name', 'Workspace name', 'text', 'Offline project'], ['remoteRoot', 'Remote root', 'text', '/srv/app'], ['localRoot', 'Offline local directory', 'text', '']] },
  'remote-code-intelligence': { title: 'Remote Code Intelligence', description: 'Extract symbols and diagnostics without running repository code.', safety: 'Analysis is bounded to 4 MB and happens locally.', fields: [['path', 'File path', 'text', '/srv/app/index.js'], ['language', 'Language', 'select', 'javascript', ['javascript', 'typescript', 'python', 'go', 'rust']], ['content', 'Source preview', 'textarea', 'function startServer() {\n  // TODO\n}']] },
  'universal-content-search': { title: 'Universal Content Search', description: 'Search the currently loaded private file index.', safety: 'Search terms and index records remain local.', fields: [['query', 'Search text', 'text', 'config']] },
  'connection-graph': { title: 'Connection Graph', description: 'Build a layered map from saved servers and active tunnels.', safety: 'Read-only inventory; connection secrets and request bodies are excluded.', fields: [] },
  'smart-jump-tunnel-manager': { title: 'Smart Jump & Tunnel Manager', description: 'Prepare a resilient forward with collision and identity checks.', safety: 'The returned route is a preview and cannot bind a port until approved.', fields: [['localPort', 'Local port', 'number', '8080'], ['remoteHost', 'Destination host', 'text', '127.0.0.1'], ['remotePort', 'Destination port', 'number', '80'], ['mode', 'Forward type', 'select', 'local', ['local', 'remote', 'dynamic']]] },
  'just-in-time-secrets': { title: 'Just-in-Time Secrets', description: 'Create a one-use secret lease injected only into a process.', safety: 'The value never enters terminal history, API output or the state file.', fields: [['label', 'Lease label', 'text', 'Deployment token'], ['environmentName', 'Process variable', 'text', 'DEPLOY_TOKEN'], ['value', 'Secret value', 'password', ''], ['ttlSeconds', 'Lifetime in seconds', 'number', '60']] },
  'ephemeral-ssh-certificates': { title: 'Ephemeral SSH Certificates', description: 'Prepare a short-lived SSH CA signing request.', safety: 'Only a public-key hash is retained; a private key is never exported.', fields: [['principal', 'SSH principal', 'text', 'operator'], ['publicKey', 'Public key', 'textarea', 'ssh-ed25519 ...'], ['minutes', 'Validity in minutes', 'number', '30'], ['keySource', 'Key source', 'select', 'ssh-agent', ['ssh-agent', 'fido2', 'windows-hello']]] },
  'context-teleport': { title: 'Context Teleport', description: 'Encrypt tabs, paths, tunnels and checkpoints for another computer.', safety: 'Profiles are sanitized recursively and the capsule explicitly contains no secrets.', fields: [['target', 'Encrypted capsule file', 'text', ''], ['passphrase', 'Passphrase (12+ characters)', 'password', '']] },
  'policy-as-code-guardrails': { title: 'Policy-as-Code Guardrails', description: 'Save enforceable boundaries for terminal and file operations.', safety: 'Guardrails are evaluated before commands and protected-path writes.', fields: [['name', 'Policy name', 'text', 'Production safety'], ['environment', 'Environment', 'select', 'production', ['production', 'staging', 'development', '*']], ['forbiddenCommands', 'Forbidden terms, comma separated', 'text', 'rm -rf,mkfs,shutdown'], ['protectedPaths', 'Protected paths, comma separated', 'text', '/etc,/var/lib'], ['readOnly', 'Read-only policy', 'select', 'true', ['true', 'false']]] },
  'forensic-mode': { title: 'Forensic Mode', description: 'Create an immutable, signed evidence manifest.', safety: 'Collection is modeled as read-only and records serverMutations=false.', fields: [['name', 'Case name', 'text', 'Incident evidence'], ['evidencePaths', 'Evidence paths, one per line', 'textarea', '/var/log/syslog\n/etc/os-release']] },
  'canary-operations': { title: 'Canary Operations', description: 'Gate a fleet operation behind one verified canary host.', safety: 'The plan stores a redacted preview and does not execute commands.', fields: [['name', 'Plan name', 'text', 'Safe fleet change'], ['operation', 'Reviewed operation', 'textarea', 'systemctl restart app.service'], ['sessionIds', 'Server IDs, comma separated', 'text', ''], ['canaryCount', 'Canary hosts', 'number', '1']] },
  'production-safety-lens': { title: 'Production Safety Lens', description: 'Calculate the correct visual identity and confirmation level.', safety: 'Commands are represented by a hash and are not persisted.', fields: [['environment', 'Environment', 'select', 'production', ['production', 'staging', 'development']], ['command', 'Command to assess', 'textarea', 'systemctl restart app.service']] },
  'remote-disaster-undo': { title: 'Remote Disaster Undo', description: 'Capture the minimum restore scope before an operation.', safety: 'Restoring remains a separate explicitly approved workflow.', fields: [['name', 'Restore point name', 'text', 'Before service change'], ['operation', 'Planned operation', 'textarea', 'Update application configuration'], ['files', 'Affected paths, one per line', 'textarea', '/etc/app.conf'], ['hours', 'Retention hours', 'number', '24']] },
  'digital-twin-sandbox': { title: 'Digital Twin Sandbox', description: 'Predict effects against local metadata instead of a live host.', safety: 'No command is sent to the server and unknown effects are clearly flagged.', fields: [['command', 'Command to simulate', 'textarea', 'systemctl restart app.service']] },
  'intent-terminal': { title: 'Intent Terminal', description: 'Turn a plain-language outcome into deterministic visible steps.', safety: 'If no trusted template matches, no command is generated.', fields: [['intent', 'Desired outcome', 'textarea', 'Show disk usage'], ['unit', 'Optional service name', 'text', 'app.service']] },
  'terminal-heads-up-display': { title: 'Terminal Heads-Up Display', description: 'Compare before/after telemetry for a command.', safety: 'The command itself is represented only by its SHA-256 hash.', fields: [['command', 'Observed command', 'text', 'systemctl restart app'], ['cpuBefore', 'CPU before (%)', 'number', '12'], ['cpuAfter', 'CPU after (%)', 'number', '18'], ['processesBefore', 'Processes before', 'number', '120'], ['processesAfter', 'Processes after', 'number', '123']] },
  'adaptive-operations-scheduler': { title: 'Adaptive Operations Scheduler', description: 'Rank and throttle work by load, network, urgency and cost.', safety: 'It generates a schedule only; background execution remains disabled.', fields: [['kind', 'Job type', 'select', 'transfer', ['transfer', 'index', 'scan', 'backup']], ['serverLoad', 'Server load (%)', 'number', '40'], ['networkQuality', 'Network quality (%)', 'number', '80'], ['urgency', 'Urgency (%)', 'number', '60'], ['cloudCost', 'Relative cloud cost (%)', 'number', '20']] },
  'collaborative-terminal': { title: 'Collaborative Terminal', description: 'Create a governed shared session with explicit roles.', safety: 'Recording is mandatory and only the keyboard owner can type.', fields: [['name', 'Session name', 'text', 'Pair investigation'], ['operator', 'Operator', 'text', 'Local owner'], ['approver', 'Approver', 'text', 'Second operator'], ['minutes', 'Lifetime in minutes', 'number', '120']] },
  'visual-permission-studio': { title: 'Visual Permission Studio', description: 'Preview Unix mode bits, ACL context and effective access.', safety: 'This surface produces a reviewed chmod plan and never applies it directly.', fields: [['path', 'Remote path', 'text', '/srv/app'], ['currentMode', 'Current mode', 'text', '755'], ['proposedMode', 'Proposed mode', 'text', '750'], ['identities', 'Identities (name:owner/group/others)', 'textarea', 'deploy:owner\nwww-data:group']] },
  'living-runbooks': { title: 'Living Runbooks', description: 'Convert verified commands into parameterized guarded steps.', safety: 'Secrets are redacted and every risky step receives an approval gate.', fields: [['name', 'Runbook name', 'text', 'Restart and verify service'], ['commands', 'Commands, one per line', 'textarea', 'systemctl restart ${SERVICE}\nsystemctl is-active ${SERVICE}'], ['rollbacks', 'Rollback commands, one per line', 'textarea', 'systemctl start ${SERVICE}']] },
  'structured-output-canvas': { title: 'Structured Output Canvas', description: 'Recognize JSON, CSV, tabular commands and logs as navigable visual results.', safety: 'Raw output always remains available and detected actions are non-executable.', fields: [['output', 'Terminal output', 'textarea', '[{"pid":120,"name":"app","state":"running"}]']] },
  'file-relationship-graph': { title: 'File Relationship Graph', description: 'Build a dependency map from selected source and configuration files.', safety: 'Files are parsed locally and repository code is never executed.', fields: [['files', 'Files as path::content, one per line', 'textarea', "/srv/app/index.js::import './config.js'\n/srv/app/config.js::export const port = 3000"]] },
  'signed-transfer-receipts': { title: 'Signed Transfer Receipts', description: 'Create an integrity receipt for a completed verified transfer.', safety: 'Credential-shaped fields are removed before the receipt is signed.', fields: [['source', 'Source path', 'text', '/srv/app/release.zip'], ['destination', 'Destination path', 'text', '/backups/release.zip'], ['sha256', 'Verified SHA-256', 'text', ''], ['bytes', 'Transferred bytes', 'number', '0'], ['operator', 'Operator', 'text', 'Local owner']] },
  'predictive-workspace-cache': { title: 'Predictive Workspace Cache', description: 'Rank likely next files from local access events.', safety: 'Learning remains on this computer and only small content may be prefetched.', fields: [['paths', 'Recently opened paths, one per line', 'textarea', '/srv/app/package.json\n/srv/app/src/index.js']] },
  'live-remote-event-stream': { title: 'Live Remote Event Stream', description: 'Prepare incremental filesystem updates from the native platform journal.', safety: 'The stream is bounded and updates only affected file rows.', fields: [['root', 'Watched root', 'text', '/srv/app'], ['platform', 'Remote platform', 'select', 'linux', ['linux', 'windows', 'macos']], ['events', 'Sample events as kind:path', 'textarea', 'modify:/srv/app/config.json']] },
  'semantic-file-history': { title: 'Semantic File History', description: 'Explain configuration changes at key and value level.', safety: 'Content is compared locally and output is a read-only explanation.', fields: [['path', 'Configuration file', 'text', '/srv/app/config.json'], ['before', 'Before', 'textarea', '{"port":80,"tls":false}'], ['after', 'After', 'textarea', '{"port":443,"tls":true}']] },
  'visual-batch-rename-transform': { title: 'Visual Batch Rename & Transform', description: 'Preview bulk renames and text normalization with collision detection.', safety: 'Nothing is changed until the complete reversible set is approved.', fields: [['paths', 'Paths, one per line', 'textarea', '/srv/app/a.txt\n/srv/app/b.txt'], ['prefix', 'Name prefix', 'text', 'archived-'], ['suffix', 'Name suffix', 'text', ''], ['find', 'Find in basename', 'text', ''], ['replace', 'Replace with', 'text', ''], ['lineEndings', 'Line endings', 'select', 'lf', ['unchanged', 'lf', 'crlf']]] },
  'remote-data-inspector': { title: 'Remote Data Inspector', description: 'Create a bounded page for CSV, JSON, JSONL, SQLite or Parquet.', safety: 'The inspector is read-only and never requests the entire large file.', fields: [['format', 'Format', 'select', 'jsonl', ['jsonl', 'json', 'csv', 'sqlite', 'parquet']], ['content', 'Bounded sample', 'textarea', '{"name":"app","value":1}\n{"name":"worker","value":2}'], ['pageSize', 'Rows per page', 'number', '100']] },
  'connection-continuity': { title: 'Connection Continuity', description: 'Choose a resilient transport while preserving terminal and transfer context.', safety: 'Host identity is rechecked before every transport transition.', fields: [['mosh', 'Mosh available', 'select', 'true', ['true', 'false']], ['tmux', 'tmux available', 'select', 'true', ['true', 'false']], ['agent', 'Agent available', 'select', 'false', ['true', 'false']], ['relay', 'Relay available', 'select', 'false', ['true', 'false']]] },
  'server-identity-trust-timeline': { title: 'Server Identity Trust Timeline', description: 'Record and compare host identity, DNS and observed addresses.', safety: 'A changed fingerprint blocks connection and requires manual trust.', fields: [['fingerprint', 'Observed fingerprint', 'text', 'SHA256:'], ['host', 'Host', 'text', 'server.example.com'], ['addresses', 'Addresses, comma separated', 'text', '10.0.0.10'], ['dns', 'Resolved DNS name', 'text', 'server.example.com']] },
  'reviewable-command-composer': { title: 'Reviewable Command Composer', description: 'Build a pipeline from visible stages with annotated data flow.', safety: 'Redirects are marked as writes and every result remains non-executable.', fields: [['stages', 'Stages as kind:value', 'textarea', 'command:ps aux\nfilter:grep app\nlimit:head -n 20']] },
  'terminal-focus-mode': { title: 'Terminal Focus Mode', description: 'Prepare a distraction-free terminal for one environment and task.', safety: 'Production identity and risk indicators remain visible at all times.', fields: [['environment', 'Environment', 'select', 'production', ['production', 'staging', 'development']], ['fontScale', 'Terminal scale', 'number', '1.2'], ['readOnly', 'Read-only', 'select', 'false', ['false', 'true']]] },
  'universal-staging-area': { title: 'Universal Staging Area', description: 'Collect file changes into one cross-server reviewed transaction.', safety: 'Applying is all-selected-or-rollback and remains a separate approval.', fields: [['name', 'Staging area', 'text', 'Release candidate'], ['paths', 'Paths to stage, one per line', 'textarea', '/srv/app/config.json']] },
  'multi-monitor-operations-layout': { title: 'Multi-monitor Operations Layout', description: 'Assign terminal, files, HUD and graph to validated displays.', safety: 'The layout stores placement only and explicitly excludes secrets.', fields: [['name', 'Layout name', 'text', 'Operations cockpit'], ['displays', 'Displays as id:widthxheight', 'textarea', 'primary:1920x1080\nsecondary:1920x1080'], ['panels', 'Panels as kind:display-id', 'textarea', 'terminal:primary\nfiles:secondary\nhud:primary']] },
  'command-file-bookmarks': { title: 'Command & File Bookmarks', description: 'Create a keyboard-searchable jump target in the current server context.', safety: 'Credentials are excluded and commands are redacted before storage.', fields: [['name', 'Bookmark name', 'text', 'Application config'], ['kind', 'Target kind', 'select', 'file', ['server', 'directory', 'file', 'line', 'container', 'command']], ['target', 'Target', 'text', '/srv/app/config.json'], ['line', 'Line when applicable', 'number', '1'], ['tags', 'Tags, comma separated', 'text', 'app,config']] },
  'explain-this-screen': { title: 'Explain This Screen', description: 'Explain the selected object and expose only safe contextual actions.', safety: 'Unknown objects do not trigger generated or destructive actions.', fields: [['kind', 'Object type', 'select', 'file', ['process', 'file', 'permission', 'port', 'git', 'container']]] },
  'remote-workspace-health': { title: 'Remote Workspace Health', description: 'Calculate one compact quality signal from the active workspace.', safety: 'It is read-only telemetry and details stay collapsed until requested.', fields: [['latencyMs', 'Latency (ms)', 'number', '30'], ['packetLossPercent', 'Packet loss (%)', 'number', '0'], ['transferQueue', 'Queued transfers', 'number', '0'], ['conflicts', 'Offline conflicts', 'number', '0'], ['tunnelExpiryMinutes', 'Tunnel expiry (minutes)', 'number', '60']] },
  'disposable-data-lens': { title: 'Disposable Data Lens', description: 'Prepare a one-use isolated viewer for an untrusted file or archive.', safety: 'No network, credentials, clipboard, child processes or filesystem writes.', fields: [['path', 'Remote file or archive', 'text', '/tmp/sample.zip'], ['type', 'Content type', 'text', 'zip'], ['timeoutSeconds', 'Maximum lifetime (seconds)', 'number', '30'], ['memoryMb', 'Memory limit (MB)', 'number', '256']] },
  'cross-server-command-matrix': { title: 'Cross-Server Command Matrix', description: 'Compare one reviewed read-only command across selected servers.', safety: 'The matrix groups matching output and never runs before explicit approval.', fields: [['command', 'Reviewed command', 'textarea', 'uname -a'], ['sessionIds', 'Server IDs, comma separated', 'text', '']] },
  'transfer-control-center': { title: 'Transfer Control Center', description: 'Prepare a resumable, prioritized and bandwidth-aware transfer queue.', safety: 'Queue controls are modeled first; execution and cancellation remain explicit actions.', fields: [['name', 'Queue name', 'text', 'Release transfer'], ['items', 'Transfers as source::destination::bytes', 'textarea', '/srv/release.zip::/backups/release.zip::1048576'], ['bandwidthMbps', 'Bandwidth limit (0 = unlimited)', 'number', '0'], ['concurrency', 'Concurrent transfers', 'number', '3']] },
  'direct-server-transfer': { title: 'Direct Server Transfer', description: 'Plan a server-to-server stream without storing payload on this computer.', safety: 'Identity, access, space and hashes are checked before an encrypted route is approved.', fields: [['sourceSessionId', 'Source server ID', 'text', ''], ['sourcePath', 'Source path', 'text', '/srv/release.zip'], ['destinationSessionId', 'Destination server ID', 'text', ''], ['destinationPath', 'Destination path', 'text', '/backups/release.zip'], ['bytes', 'Expected bytes', 'number', '0']] },
  'atomic-remote-editor': { title: 'Atomic Remote Editor', description: 'Build a conflict-aware atomic save plan for one remote file.', safety: 'The live hash is rechecked immediately before a temporary-file rename.', fields: [['path', 'Remote file', 'text', '/srv/app/config.json'], ['beforeContent', 'Current content', 'textarea', '{"port":80}'], ['proposedContent', 'Proposed content', 'textarea', '{"port":443}']] },
  'session-time-machine': { title: 'Session Time Machine', description: 'Capture a searchable terminal timeline and context-only replay plan.', safety: 'Secrets are redacted and recorded commands are never silently re-executed.', fields: [['name', 'Timeline name', 'text', 'Production investigation'], ['events', 'Events as kind::value', 'textarea', 'cwd::/srv/app\ncommand::systemctl status app\noutput::active']] },
  'filesystem-snapshot-diff': { title: 'Filesystem Snapshot Diff', description: 'Compare content, ownership and mode manifests between two moments.', safety: 'Comparison is local and read-only; unchanged files stay collapsed.', fields: [['root', 'Compared root', 'text', '/srv/app'], ['before', 'Before as path::content::mode', 'textarea', '/srv/app/config.json::{"port":80}::640'], ['after', 'After as path::content::mode', 'textarea', '/srv/app/config.json::{"port":443}::640']] },
  'smart-sync-profiles': { title: 'Smart Sync Profiles', description: 'Create a dry-run-first folder synchronization policy.', safety: 'Deletes never propagate by default and protected paths are checked.', fields: [['name', 'Profile name', 'text', 'Project sync'], ['remoteRoot', 'Remote root', 'text', '/srv/app'], ['localRoot', 'Local root', 'text', ''], ['direction', 'Direction', 'select', 'bidirectional', ['download', 'upload', 'bidirectional']], ['excludes', 'Exclude patterns, comma separated', 'text', '.git,node_modules,*.tmp'], ['schedule', 'Schedule', 'select', 'manual', ['manual', 'on-connect', 'continuous']]] },
  'archive-explorer': { title: 'Archive Explorer', description: 'Navigate a remote archive as a safe folder tree.', safety: 'Traversal entries are blocked and extraction cannot overwrite existing files.', fields: [['path', 'Remote archive', 'text', '/tmp/archive.tar.gz'], ['entries', 'Optional known entries, one per line', 'textarea', 'README.md\napp/config.json']] },
  'remote-storage-fabric': { title: 'Remote Storage Fabric', description: 'Normalize servers, shares, object storage and containers into one workspace.', safety: 'Credentials are excluded and cross-protocol writes remain reviewed plans.', fields: [['endpoints', 'Endpoints as protocol::name::root', 'textarea', 'sftp::Application server::/srv/app\ns3::Backups::/releases']] },
  'live-virtual-folders': { title: 'Live Virtual Folders', description: 'Save an incremental query as a cross-server file collection.', safety: 'Only metadata is matched and source content is not copied.', fields: [['name', 'Collection name', 'text', 'Large recent logs'], ['conditions', 'Conditions as field::operator::value', 'textarea', 'extension::equals::.log\nbytes::gt::1048576']] },
  'disk-space-visualizer': { title: 'Disk Space Visualizer', description: 'Create a zoomable treemap rather than another size table.', safety: 'Cleanup candidates are suggestions only and no file is deleted.', fields: [['root', 'Visualized root', 'text', '/srv'], ['entries', 'Entries as path::bytes::kind', 'textarea', '/srv/app/app.log::1048576::file\n/srv/cache/old.tmp::524288::temporary']] },
  'process-port-container-navigator': { title: 'Process & Port Navigator', description: 'Connect listening ports to processes, containers and configuration files.', safety: 'Only inspection actions are exposed; stop and kill controls remain collapsed.', fields: [['processes', 'Processes as pid::name::container::config', 'textarea', '120::nginx::web::/etc/nginx/nginx.conf'], ['ports', 'Ports as port::protocol::address::pid', 'textarea', '443::tcp::0.0.0.0::120']] },
  'secure-clipboard-bridge': { title: 'Secure Clipboard Bridge', description: 'Prepare an expiring clipboard handoff between local, SSH and RDP.', safety: 'Secret-shaped content is blocked, history is disabled and data clears after paste.', fields: [['content', 'Clipboard content', 'textarea', ''], ['destinations', 'Destinations', 'select', 'ssh', ['local', 'ssh', 'rdp']], ['expiresSeconds', 'Clear after seconds', 'number', '30']] },
  'shell-resurrection': { title: 'Shell Resurrection', description: 'Plan tmux/screen reattachment and safe workspace restoration.', safety: 'Host identity is verified first and prior commands are not re-executed.', fields: [['tabs', 'Tabs as name::cwd::tmux/screen/none::session', 'textarea', 'Application::/srv/app::tmux::kitsune']] },
  'terminal-file-manager-fusion': { title: 'Terminal–Files Fusion', description: 'Synchronize working directory, selections and detected output paths.', safety: 'Paths are shell-quoted and interactions never cause automatic execution.', fields: [['cwd', 'Working directory', 'text', '/srv/app'], ['shell', 'Shell dialect', 'select', 'posix', ['posix', 'powershell', 'cmd']], ['paths', 'Selected paths, one per line', 'textarea', '/srv/app/config.json'], ['output', 'Optional terminal output', 'textarea', 'Config loaded from /srv/app/config.json']] },
  'execution-context-beacon': { title: 'Execution Context Beacon', description: 'Verify the exact identity and runtime receiving the next action.', safety: 'Any mismatch blocks the plan and production or elevation increases confirmation.', fields: [['host', 'Host', 'text', 'server.example.com'], ['user', 'Remote user', 'text', 'deploy'], ['environment', 'Environment', 'select', 'production', ['production', 'staging', 'development', 'unknown']], ['runtime', 'Runtime context', 'select', 'host', ['host', 'docker', 'kubernetes', 'wsl']], ['target', 'Container, pod or distribution', 'text', ''], ['namespace', 'Namespace', 'text', ''], ['cwd', 'Working directory', 'text', '/srv/app'], ['elevated', 'Elevated identity', 'select', 'false', ['false', 'true']]] },
  'connection-waterfall-tuner': { title: 'Connection Waterfall & Tuner', description: 'Visualize latency from DNS through SSH and SFTP.', safety: 'Recommendations are deterministic; no network setting is applied automatically.', fields: [['phases', 'Phases as name::milliseconds::status', 'textarea', 'dns::35::ok\ntcp::45::ok\nssh::180::ok\nauthentication::90::ok\nsftp::260::slow'], ['latencyMs', 'Round-trip latency', 'number', '60']] },
  'data-boundary-guard': { title: 'Data Boundary Guard', description: 'Classify content before it crosses an environment boundary.', safety: 'Only findings and a content hash are retained; critical secrets block transfer.', fields: [['sourceZone', 'Source trust zone', 'select', 'restricted', ['public', 'internal', 'confidential', 'restricted']], ['destinationZone', 'Destination trust zone', 'select', 'internal', ['public', 'internal', 'confidential', 'restricted']], ['content', 'Bounded content sample', 'textarea', '']] },
  'live-output-privacy-shield': { title: 'Live Output Privacy Shield', description: 'Sanitize terminal output before copying, sharing, recording or export.', safety: 'Original output is represented only by its hash and is never persisted here.', fields: [['output', 'Terminal output', 'textarea', 'user@example.com connected from 10.0.0.10']] },
  'detached-job-orchestrator': { title: 'Detached Job Orchestrator', description: 'Prepare a monitored job that survives disconnects and application exit.', safety: 'The command remains a reviewed plan with bounded resources and graceful cancellation.', fields: [['name', 'Job name', 'text', 'Remote maintenance'], ['command', 'Reviewed command', 'textarea', 'npm run build'], ['runner', 'Detached runner', 'select', 'systemd-run', ['systemd-run', 'tmux', 'screen', 'agent']], ['timeoutSeconds', 'Timeout seconds', 'number', '3600'], ['cpuPercent', 'CPU limit (%)', 'number', '50'], ['memoryMb', 'Memory limit (MB)', 'number', '1024'], ['outputBytes', 'Output limit (bytes)', 'number', '16777216']] },
  'conflict-resolution-cockpit': { title: 'Conflict Resolution Cockpit', description: 'Resolve base, local and remote content in a dedicated four-pane flow.', safety: 'Only hashes are stored; writing the selected result remains separately approved.', fields: [['path', 'Conflicted path', 'text', '/srv/app/config.json'], ['base', 'Base content', 'textarea', '{"port":80}'], ['local', 'Local content', 'textarea', '{"port":8080}'], ['remote', 'Remote content', 'textarea', '{"port":443}']] },
  'executable-trust-inspector': { title: 'Executable Trust Inspector', description: 'Resolve what a command really points to before execution.', safety: 'Inspection is read-only and world-writable or invalidly signed targets are flagged.', fields: [['name', 'Command name', 'text', 'node'], ['resolvedPath', 'Resolved executable path', 'text', '/usr/bin/node'], ['kind', 'Resolved kind', 'select', 'binary', ['binary', 'script', 'alias', 'function', 'builtin']], ['owner', 'Owner', 'text', 'root'], ['mode', 'Unix mode', 'text', '755'], ['package', 'Package origin', 'text', 'nodejs'], ['sha256', 'Known SHA-256', 'text', ''], ['signature', 'Signature state', 'select', 'unknown', ['valid', 'invalid', 'unsigned', 'unknown']]] },
  'resource-budgeted-commands': { title: 'Resource-Budgeted Commands', description: 'Constrain one command by time, CPU, memory, output and network.', safety: 'The process group is stopped gracefully before forced termination.', fields: [['command', 'Reviewed command', 'textarea', 'find /srv -type f'], ['timeoutSeconds', 'Timeout seconds', 'number', '300'], ['cpuPercent', 'CPU limit (%)', 'number', '50'], ['memoryMb', 'Memory limit (MB)', 'number', '512'], ['outputBytes', 'Output limit (bytes)', 'number', '8388608'], ['networkBytes', 'Network limit (0 = none)', 'number', '0']] },
  'remote-quarantine-lab': { title: 'Remote Quarantine Lab', description: 'Inspect a suspicious file inside a no-execution quarantine.', safety: 'Network, credentials, clipboard and execution are disabled; samples are not retained.', fields: [['path', 'Suspicious remote file', 'text', '/tmp/sample.bin'], ['sample', 'Optional bounded sample', 'textarea', '']] },
  'branchable-terminal': { title: 'Branchable Terminal', description: 'Fork the current context into an isolated experimental branch.', safety: 'Commands and secrets are not copied, and writable isolation requires approval.', fields: [['name', 'Branch name', 'text', 'Safe experiment'], ['backend', 'Isolation backend', 'select', 'disposable-workspace', ['tmux', 'container', 'disposable-workspace']], ['cwd', 'Starting directory', 'text', '/srv/app'], ['expiryMinutes', 'Expire after minutes', 'number', '120'], ['writable', 'Writable branch', 'select', 'false', ['false', 'true']]] },
  'adaptive-ssh-channel-pool': { title: 'Adaptive SSH Channel Pool', description: 'Reuse verified SSH transports across terminal, SFTP and tunnels.', safety: 'Keys are never persisted and an identity change forces reauthentication.', fields: [['maximumChannels', 'Maximum channels per transport', 'number', '8'], ['keepAliveSeconds', 'Keepalive seconds', 'number', '30'], ['expireIdleSeconds', 'Expire idle transport after seconds', 'number', '300']] },
  'terminal-files-review-inbox': { title: 'Terminal & Files Review Inbox', description: 'Create a risk-grouped review card for a planned change.', safety: 'The inbox stores a sanitized preview and plan hash, never credentials or executable payloads.', fields: [['title', 'Review title', 'text', 'Production file change'], ['kind', 'Change kind', 'select', 'file-change', ['file-change', 'command', 'transfer', 'sync', 'permission', 'extraction']], ['target', 'Target', 'text', '/srv/app/config.json'], ['risk', 'Risk level', 'select', 'write', ['read', 'write', 'destructive', 'restricted']], ['requestedBy', 'Requester', 'text', 'Local owner'], ['preview', 'Sanitized preview', 'textarea', 'Update application configuration']] },
  'approved-execution-engine': { title: 'Approved Execution Engine', description: 'Create, approve or apply a signed idempotent execution plan.', safety: 'Only bounded command templates and verified atomic file writes are accepted; failures roll back completed writes.', fields: [['operation', 'Lifecycle action', 'select', 'create', ['create', 'approve', 'apply']], ['planId', 'Plan ID for approve/apply', 'text', ''], ['requestedBy', 'Requester', 'text', 'Local owner'], ['approver', 'Distinct approver', 'text', 'Second operator'], ['actionKind', 'Planned action', 'select', 'safe-template', ['safe-template', 'file-write']], ['template', 'Safe command template', 'select', 'disk', ['disk', 'ports', 'tail', 'journal', 'dockerLogs']], ['path', 'File path for atomic write', 'text', '/srv/app/config.json'], ['content', 'New file content', 'textarea', ''], ['idempotencyKey', 'Idempotency key for apply', 'text', ''], ['consent', 'Explicit apply consent', 'select', 'false', ['false', 'true']]] },
  'visual-result-renderers': { title: 'Visual Result Renderers', description: 'Prepare an interactive visual model with raw data always available.', safety: 'Rendering is virtualized and read-only; data is sanitized before reaching the DOM.', fields: [['kind', 'Visualization', 'select', 'waterfall', ['waterfall', 'treemap', 'matrix', 'graph', 'conflict', 'timeline', 'transfer']], ['data', 'Bounded JSON data', 'textarea', '{"phases":[{"name":"SSH","durationMs":180}]}'], ['maximumItems', 'Maximum rendered items', 'number', '5000']] },
  'unified-remote-session-canvas': { title: 'Unified Remote Session Canvas', description: 'Compose terminal, files, desktop and console panes in one context.', safety: 'Credentials are never copied between panes; handoff contains encrypted context only.', fields: [['name', 'Canvas name', 'text', 'Server cockpit'], ['layout', 'Layout', 'select', 'split', ['tabs', 'split', 'grid', 'focus']], ['panes', 'Panes as protocol::role::title', 'textarea', 'ssh::terminal::Shell\nsftp::files::Files\nrdp::desktop::Desktop'], ['cwd', 'Shared working directory', 'text', '/srv/app'], ['clipboardPolicy', 'Clipboard policy', 'select', 'text-only', ['disabled', 'text-only', 'guarded-files']]] },
  'remote-desktop-quality-engine': { title: 'Remote Desktop Quality Engine', description: 'Select and continuously adapt an RDP/VNC quality profile.', safety: 'Clipboard and file redirection remain policy controlled; settings are previewed first.', fields: [['mode', 'Quality mode', 'select', 'auto', ['auto', 'quality', 'balanced', 'low-latency']], ['latencyMs', 'Latency (ms)', 'number', '60'], ['bandwidthMbps', 'Bandwidth (Mbps)', 'number', '20'], ['packetLossPercent', 'Packet loss (%)', 'number', '0'], ['clipboardPolicy', 'Clipboard policy', 'select', 'text-only', ['disabled', 'text-only', 'guarded-files']]] },
  'remote-desktop-file-bridge': { title: 'Remote Desktop File Bridge', description: 'Plan guarded file movement between local, desktop and SFTP contexts.', safety: 'Boundary classification, malware scan, free-space and hash checks precede every transfer.', fields: [['sourceProtocol', 'Source protocol', 'select', 'rdp', ['local', 'rdp', 'vnc', 'sftp']], ['sourcePath', 'Source path', 'text', '/Desktop/release.zip'], ['destinationProtocol', 'Destination protocol', 'select', 'sftp', ['local', 'rdp', 'vnc', 'sftp']], ['destinationPath', 'Destination path', 'text', '/srv/releases/release.zip'], ['sourceZone', 'Source zone', 'select', 'internal', ['public', 'internal', 'confidential', 'restricted']], ['destinationZone', 'Destination zone', 'select', 'internal', ['public', 'internal', 'confidential', 'restricted']], ['bytes', 'Expected bytes', 'number', '0'], ['sample', 'Optional classification sample', 'textarea', '']] },
  'capability-negotiator': { title: 'Capability Negotiator', description: 'Detect server adapters and expose honest fallback chains.', safety: 'Unsupported actions are hidden rather than guessed or executed through unsafe substitutes.', fields: [['platform', 'Remote platform', 'select', 'linux', ['linux', 'windows', 'macos']], ['available', 'Detected adapters, comma separated', 'text', 'ssh,sftp,tmux,systemd-run,docker,file-manifest,vnc']] },
  'optional-kitsune-agent': { title: 'Optional Kitsune Agent', description: 'Negotiate signed Agent acceleration with automatic SSH fallback.', safety: 'Capabilities use expiring nonces; the Agent remains optional and credentials are excluded.', fields: [['endpoint', 'Agent HTTPS endpoint', 'text', 'https://server.example.com:9443'], ['healthy', 'Agent health verified', 'select', 'true', ['true', 'false']], ['capabilities', 'Reported capabilities', 'text', 'systemd,docker,metrics,bounded-files'], ['required', 'Required capabilities', 'text', 'metrics,bounded-files']] },
  'contextual-action-orb': { title: 'Contextual Action Orb', description: 'Show only the best actions beside the selected object.', safety: 'The orb exposes at most six non-destructive actions and never creates a permanent toolbar.', fields: [['kind', 'Selected object', 'select', 'file', ['file', 'directory', 'terminal-output', 'process', 'port', 'transfer', 'desktop']]] },
  'terminal-files-adapter-sdk': { title: 'Terminal & Files Adapter SDK', description: 'Validate a declarative protocol, storage, preview or action contract.', safety: 'Renderer code and arbitrary processes are forbidden; write and exec permissions require preview approval.', fields: [['pluginId', 'Adapter ID', 'text', 'com.example.storage'], ['name', 'Adapter name', 'text', 'Example Storage'], ['kind', 'Adapter kind', 'select', 'storage', ['protocol', 'storage', 'preview', 'action']], ['protocols', 'Protocols, comma separated', 'text', 'example'], ['permissions', 'Permissions, comma separated', 'text', 'network,filesystem-read'], ['capabilities', 'Capabilities, comma separated', 'text', 'browse,read']] },
  'remote-operations-test-lab': { title: 'Remote Operations Test Lab', description: 'Inject bounded failure scenarios into a disposable target.', safety: 'Production is never touched and every result retains sanitized evidence.', fields: [['environment', 'Disposable environment', 'select', 'container', ['container', 'vm']], ['scenarios', 'Scenarios, comma separated', 'text', 'connection-drop,transfer-resume,file-conflict,host-key-change,disk-full,timeout,permission-denied,partial-rollback']] },
  'keyboard-accessibility-pass': { title: 'Keyboard & Accessibility Pass', description: 'Create a keyboard-first, screen-reader-ready operations profile.', safety: 'Every status uses text and shape in addition to color; motion can be reduced.', fields: [['name', 'Profile name', 'text', 'Accessible operations'], ['keyboardOnly', 'Keyboard-only navigation', 'select', 'true', ['true', 'false']], ['reduceMotion', 'Reduce motion', 'select', 'false', ['true', 'false']], ['highContrast', 'High contrast', 'select', 'false', ['true', 'false']], ['terminalScale', 'Terminal scale', 'number', '1']] },
  'performance-large-fleet-pass': { title: 'Performance & Large Fleet Pass', description: 'Select virtualization, streaming and cancellation strategies from expected scale.', safety: 'Raw datasets are never copied wholesale into the DOM and renderer memory stays bounded.', fields: [['servers', 'Expected servers', 'number', '1000'], ['records', 'Expected file records', 'number', '1000000'], ['outputBytes', 'Expected terminal output bytes', 'number', '67108864']] },
  'semantic-shell-layer': { title: 'Semantic Shell Layer', description: 'Turn terminal history into navigable command blocks with timing, cwd and exit state.', safety: 'Output is redacted, long histories are virtualized and reruns are always prepared rather than automatic.', fields: [['host', 'Host label', 'text', 'production-1'], ['blocks', 'Blocks as command::exit-code::duration-ms::output', 'textarea', 'pwd::0::18::/srv/app\nsystemctl status app::0::240::active']] },
  'config-studio': { title: 'Config Studio', description: 'Validate configuration syntax and show the operational impact before saving.', safety: 'Content remains in the reviewed request; applying uses snapshot, native validation, health check and rollback.', fields: [['kind', 'Configuration type', 'select', 'nginx', ['nginx', 'apache', 'systemd', 'docker-compose', 'kubernetes', 'ssh', 'json', 'yaml']], ['path', 'Remote path', 'text', '/etc/nginx/nginx.conf'], ['currentContent', 'Current bounded content', 'textarea', 'events {}'], ['content', 'Proposed content', 'textarea', 'events {}\nhttp { server { listen 80; } }']] },
  'identity-trust-center': { title: 'Identity & Trust Center', description: 'Unify SSH certificates, hardware-backed authentication, rotation and host trust.', safety: 'Only public fingerprints and policy metadata are retained; private key export is forbidden.', fields: [['name', 'Identity center', 'text', 'Production access'], ['methods', 'Authentication methods, comma separated', 'text', 'ssh-agent,certificate,fido2,windows-hello'], ['keys', 'Keys as label::fingerprint::algorithm::expires-at', 'textarea', 'Operations key::SHA256:example::ed25519::'], ['caEnabled', 'SSH CA enabled', 'select', 'true', ['true', 'false']], ['certificateLifetimeMinutes', 'Certificate lifetime', 'number', '60']] },
  'remote-desktop-pro': { title: 'Remote Desktop Pro', description: 'Prepare a policy-aware multi-monitor RDP or VNC workspace.', safety: 'Drive, printer, USB and recording channels require explicit approval and privacy safeguards.', fields: [['protocol', 'Desktop protocol', 'select', 'rdp', ['rdp', 'vnc']], ['displays', 'Displays as id::width::height', 'textarea', 'primary::1920::1080\nsecondary::1920::1080'], ['audio', 'Audio', 'select', 'true', ['true', 'false']], ['clipboard', 'Clipboard policy', 'select', 'text-only', ['disabled', 'text-only', 'guarded-files']], ['driveMapping', 'Drive mapping', 'select', 'false', ['true', 'false']], ['printers', 'Printer redirection', 'select', 'false', ['true', 'false']], ['usb', 'USB redirection', 'select', 'false', ['true', 'false']], ['recording', 'Consent-based recording', 'select', 'false', ['true', 'false']]] },
  'live-process-network-explorer': { title: 'Live Process & Network Explorer', description: 'Explore process ancestry, containers, ports and sockets as a connected graph.', safety: 'The live model is read-only, virtualized and keeps destructive actions collapsed.', fields: [['processes', 'Processes as pid::parent::name::cpu::memory-bytes', 'textarea', '1::0::systemd::1::52428800\n120::1::nginx::4::104857600'], ['sockets', 'Sockets as protocol::local::remote::state::pid', 'textarea', 'tcp::0.0.0.0:443::::LISTEN::120']] },
  'workspace-recovery-capsule': { title: 'Workspace Recovery Capsule', description: 'Encrypt tabs, panes, buffers and layout for recovery on this or another computer.', safety: 'Credentials are recursively removed and restoring context never replays commands.', fields: [['name', 'Capsule name', 'text', 'Production recovery'], ['target', 'Encrypted capsule file', 'text', ''], ['passphrase', 'Passphrase (12+ characters)', 'password', ''], ['cwd', 'Working directory', 'text', '/srv/app'], ['buffers', 'Unsaved buffers as path::content', 'textarea', '/srv/app/notes.txt::investigation notes']] },
  'cross-host-data-pipeline': { title: 'Cross-Host Data Pipeline', description: 'Design a verified, resumable flow between servers and storage.', safety: 'Stages use bounded buffers, checksums, no-overwrite and destination rollback; execution remains approval-gated.', fields: [['name', 'Pipeline name', 'text', 'Verified migration'], ['stages', 'Stages as kind::protocol::session::path', 'textarea', 'source::sftp::source-server::/srv/data\nscan::::::\ncompress::::::\nverify::::::\ndestination::sftp::target-server::/srv/import'], ['parallelism', 'Parallel streams', 'number', '4'], ['bandwidthMbps', 'Bandwidth limit (0 = policy default)', 'number', '0']] },
  'command-reproducibility': { title: 'Command Reproducibility', description: 'Create a signed manifest of a verified command, tools, configuration and sanitized environment.', safety: 'Secret-shaped environment values are redacted and rerunning always requires a reviewed runbook.', fields: [['command', 'Verified command', 'textarea', 'npm run build'], ['cwd', 'Working directory', 'text', '/srv/app'], ['environment', 'Environment as NAME=value', 'textarea', 'NODE_ENV=production'], ['tools', 'Tools as name::version::sha256', 'textarea', 'node::24.18.0::'], ['exitCode', 'Exit code', 'number', '0'], ['output', 'Bounded output', 'textarea', 'Build completed']] },
  'disposable-shadow-host': { title: 'Disposable Shadow Host', description: 'Rehearse a risky change in an isolated clone and visualize its impact.', safety: 'The clone has no production credentials or write route; promotion goes through Approved Execution.', fields: [['name', 'Shadow environment', 'text', 'Release rehearsal'], ['backend', 'Isolation backend', 'select', 'container', ['container', 'vm', 'filesystem-snapshot']], ['operation', 'Proposed operation', 'textarea', 'Deploy release and reload service'], ['before', 'Before files as path::content', 'textarea', '/etc/app.conf::port=80'], ['after', 'After files as path::content', 'textarea', '/etc/app.conf::port=8080\n/srv/app/release::v2'], ['expiresMinutes', 'Expires after minutes', 'number', '120']] },
  'focus-incident-layouts': { title: 'Focus & Incident Layouts', description: 'Reshape the workspace around one operational outcome.', safety: 'Server identity, environment, approvals and recording state remain visible in every mode.', fields: [['name', 'Layout name', 'text', 'Incident command'], ['mode', 'Workspace mode', 'select', 'incident', ['deployment', 'debugging', 'file-migration', 'database-recovery', 'incident']], ['maximumPanels', 'Maximum visible panels', 'number', '5']] }
};

function selectVisionTab(tab) {
  const search = document.getElementById('tf-vision-search'); if (search?.value) { search.value = ''; filterVisionFeatures(''); }
  document.querySelectorAll('[data-vision-tab]').forEach(button => button.classList.toggle('active', button.dataset.visionTab === tab));
  document.querySelectorAll('[data-vision-pane]').forEach(pane => pane.classList.toggle('active', pane.dataset.visionPane === tab));
  const first = document.querySelector(`[data-vision-pane="${tab}"] .tf-feature`); if (first) selectVisionFeature(first.dataset.vision);
}

function filterVisionFeatures(value) {
  const query = String(value || '').trim().toLocaleLowerCase(); const stage = document.querySelector('.tf-feature-stage'); if (!stage) return; const cards = [...stage.querySelectorAll('.tf-feature')]; let matches = 0;
  for (const card of cards) { const matched = !query || card.textContent.toLocaleLowerCase().includes(query) || card.dataset.vision.includes(query); card.hidden = !matched; if (matched) matches++; }
  stage.classList.toggle('searching', Boolean(query));
  for (const pane of stage.querySelectorAll('.tf-feature-pane')) pane.classList.toggle('search-match', Boolean(query) && [...pane.querySelectorAll('.tf-feature')].some(card => !card.hidden));
  document.querySelectorAll('[data-vision-tab]').forEach(button => button.classList.toggle('search-active', Boolean(query)));
  const count = document.querySelector('.tf-deck-filter kbd'); if (count) count.textContent = query ? `${matches} result${matches === 1 ? '' : 's'}` : `${cards.length} workflows`;
  if (query && matches === 1) selectVisionFeature(cards.find(card => !card.hidden).dataset.vision);
  else if (query) { document.querySelectorAll('[data-vision]').forEach(button => button.classList.remove('selected')); renderVisionInspectorMessage(matches ? `${matches} workflows found` : 'No workflow found', matches ? 'Choose one result to configure its reviewed plan.' : 'Try a broader outcome, protocol or safety term.'); }
  else { const first = stage.querySelector('.tf-feature-pane.active .tf-feature'); if (first) selectVisionFeature(first.dataset.vision); }
}

function renderVisionInspectorMessage(titleText, descriptionText) {
  const inspector = document.getElementById('tf-vision-inspector'); if (!inspector) return; inspector.replaceChildren(); const empty = document.createElement('div'); empty.className = 'tf-inspector-empty'; const icon = document.createElement('b'); icon.textContent = '⌕'; const title = document.createElement('strong'); title.textContent = titleText; const description = document.createElement('span'); description.textContent = descriptionText; empty.append(icon, title, description); inspector.appendChild(empty);
}

function renderVisionResultPreview(feature, result) {
  const inspector = document.getElementById('tf-vision-inspector'); if (!inspector || !result || typeof result !== 'object') return; inspector.querySelector('.tf-visual-result')?.remove(); const panel = document.createElement('section'); panel.className = 'tf-visual-result'; panel.setAttribute('role', 'status'); const head = document.createElement('header'); const marker = document.createElement('i'); marker.className = result.success === false || result.blocked ? 'danger' : 'ready'; const copy = document.createElement('span'); const title = document.createElement('strong'); title.textContent = result.success === false || result.blocked ? 'Review required' : result.executable ? 'Verified execution result' : 'Reviewed model ready'; const note = document.createElement('small'); note.textContent = result.rawAvailable ? 'Interactive view · raw data available' : 'Bounded contextual summary'; copy.append(title, note); head.append(marker, copy); panel.appendChild(head);
  const body = document.createElement('div'); body.className = 'tf-result-canvas'; const phases = result.phases || result.blocks || result.nodes || result.pipeline?.stages || result.plan?.comparison?.files || result.layout?.visiblePanels?.map((name, index) => ({ name, count: index + 1 })) || result.matrix?.rows || result.results || result.queue?.items || result.timeline?.events || result.changes;
  if (Array.isArray(phases) && phases.length) { const maximum = Math.max(...phases.slice(0, 8).map(item => Number(item.durationMs ?? item.bytes ?? item.remaining ?? item.count ?? 1) || 1)); for (const [index, item] of phases.slice(0, 6).entries()) { const lane = document.createElement('div'); lane.className = 'tf-result-lane'; const label = document.createElement('span'); label.textContent = String(item.name || item.id || item.kind || item.sessionId || item.path || `Step ${index + 1}`).slice(0, 42); const track = document.createElement('b'); const fill = document.createElement('i'); const value = Number(item.durationMs ?? item.bytes ?? item.remaining ?? item.count ?? 1) || 1; fill.style.width = `${Math.max(6, Math.round(value / maximum * 100))}%`; track.appendChild(fill); const state = document.createElement('em'); state.textContent = String(item.status || item.state || item.kind || (item.passed === true ? 'PASS' : item.success === false ? 'FAIL' : 'READY')).toUpperCase().slice(0, 16); lane.append(label, track, state); body.appendChild(lane); } }
  else { const candidates = []; const collect = (object, prefix = '') => { for (const [key, value] of Object.entries(object || {})) { if (candidates.length >= 6) break; if (['string', 'number', 'boolean'].includes(typeof value) && String(value).length <= 80) candidates.push([prefix ? `${prefix}.${key}` : key, value]); else if (value && typeof value === 'object' && !Array.isArray(value) && prefix === '') collect(value, key); } }; collect(result); for (const [key, value] of candidates.slice(0, 6)) { const metric = document.createElement('div'); metric.className = 'tf-result-metric'; const label = document.createElement('span'); label.textContent = key.replace(/([A-Z])/g, ' $1').replace(/[._-]/g, ' '); const data = document.createElement('strong'); data.textContent = String(value); metric.append(label, data); body.appendChild(metric); } }
  if (!body.childElementCount) { const empty = document.createElement('p'); empty.textContent = `${VISION_FORMS[feature]?.title || 'Workflow'} returned a bounded plan with no visual metrics.`; body.appendChild(empty); } panel.appendChild(body); inspector.querySelector('.tf-inspector-head')?.after(panel);
}

function selectVisionFeature(feature) {
  const definition = VISION_FORMS[feature]; if (!definition) return;
  document.querySelectorAll('[data-vision]').forEach(button => button.classList.toggle('selected', button.dataset.vision === feature));
  document.querySelectorAll('[data-vision-context]').forEach(button => button.classList.toggle('selected', button.dataset.visionContext === feature));
  document.querySelectorAll('[data-vision-platform]').forEach(button => button.classList.toggle('selected', button.dataset.visionPlatform === feature));
  document.querySelectorAll('[data-vision-expert]').forEach(button => button.classList.toggle('selected', button.dataset.visionExpert === feature));
  const inspector = document.getElementById('tf-vision-inspector'); inspector.replaceChildren();
  const head = document.createElement('div'); head.className = 'tf-inspector-head';
  const eyebrow = document.createElement('span'); eyebrow.textContent = 'GUIDED WORKFLOW'; const title = document.createElement('h3'); title.textContent = definition.title; const description = document.createElement('p'); description.textContent = definition.description; head.append(eyebrow, title, description);
  const form = document.createElement('form'); form.className = 'tf-form'; form.dataset.feature = feature;
  for (const [name, labelText, type, defaultValue, options] of definition.fields) { const label = document.createElement('label'); const caption = document.createElement('span'); caption.textContent = labelText; let control; if (type === 'textarea') control = document.createElement('textarea'); else if (type === 'select') { control = document.createElement('select'); for (const value of options) { const option = document.createElement('option'); option.value = value; option.textContent = value; control.appendChild(option); } } else { control = document.createElement('input'); control.type = type; } control.name = name; control.value = defaultValue; control.autocomplete = type === 'password' ? 'new-password' : 'off'; label.append(caption, control); form.appendChild(label); }
  applyVisionContextDefaults(feature, form);
  const note = document.createElement('div'); note.className = 'tf-safety-note'; note.textContent = `⛨ ${definition.safety}`;
  const actions = document.createElement('div'); actions.className = 'tf-inspector-actions'; const run = document.createElement('button'); run.className = 'btn btn-primary'; run.type = 'submit'; run.textContent = 'Prepare reviewed plan'; const state = document.createElement('span'); state.className = 'tf-run-state'; state.textContent = 'READY'; actions.append(run, state); form.append(note, actions); form.addEventListener('submit', event => { event.preventDefault(); void runVisionFeature(feature, form, state, run); }); inspector.append(head, form);
}

function applyVisionContextDefaults(feature, form) {
  const selectedPath = remoteState.selectedRemote?.path || remoteState.selectedLocal?.path || '';
  const set = (name, value) => { const control = form.elements.namedItem(name); if (control && value) control.value = value; };
  if (feature === 'structured-output-canvas') { const tab = terminalState.tabs.find(item => item.id === terminalState.activeId); const block = tab?.structuredBlocks?.at(-1); set('output', block?.output || ''); }
  if (['semantic-file-history', 'disposable-data-lens'].includes(feature)) set('path', selectedPath);
  if (['visual-batch-rename-transform', 'universal-staging-area'].includes(feature)) set('paths', selectedPath);
  if (feature === 'command-file-bookmarks') set('target', selectedPath);
  if (feature === 'signed-transfer-receipts') { set('source', remoteState.selectedLocal?.path); set('destination', remoteState.selectedRemote?.path); set('bytes', remoteState.selectedLocal?.size || remoteState.selectedRemote?.size); }
  if (feature === 'file-relationship-graph' && selectedPath) set('files', `${selectedPath}::`);
  if (['atomic-remote-editor', 'archive-explorer'].includes(feature)) set('path', selectedPath);
  if (feature === 'terminal-file-manager-fusion') { set('cwd', remoteState.remote?.path || '/'); set('paths', selectedPath); }
  if (feature === 'smart-sync-profiles') { set('remoteRoot', remoteState.remote?.path || '/'); set('localRoot', remoteState.local?.path || ''); }
  if (feature === 'cross-server-command-matrix') set('sessionIds', remoteState.sessions.map(item => item.id).slice(0, 8).join(','));
  if (feature === 'direct-server-transfer') { set('sourceSessionId', remoteState.sessions[0]?.id); set('destinationSessionId', remoteState.sessions[1]?.id); set('sourcePath', remoteState.selectedRemote?.path); }
  const session = opsSession(); const activeTab = terminalState.tabs.find(item => item.id === terminalState.activeId); const lastOutput = activeTab?.structuredBlocks?.at(-1)?.output || '';
  if (feature === 'execution-context-beacon') { set('host', session?.host); set('user', session?.username); set('environment', session?.production ? 'production' : session?.environment); set('cwd', activeTab?.cwd || remoteState.remote?.path); }
  if (feature === 'live-output-privacy-shield') set('output', lastOutput);
  if (['conflict-resolution-cockpit', 'remote-quarantine-lab'].includes(feature)) set('path', selectedPath);
  if (feature === 'branchable-terminal') set('cwd', activeTab?.cwd || remoteState.remote?.path);
  if (feature === 'terminal-files-review-inbox') set('target', selectedPath || session?.name);
  if (feature === 'approved-execution-engine') set('path', selectedPath);
  if (feature === 'unified-remote-session-canvas') set('cwd', activeTab?.cwd || remoteState.remote?.path);
  if (feature === 'remote-desktop-file-bridge') { set('sourcePath', remoteState.selectedLocal?.path || remoteState.selectedRemote?.path); set('destinationPath', remoteState.remote?.path); set('bytes', remoteState.selectedLocal?.size || remoteState.selectedRemote?.size); }
  if (feature === 'optional-kitsune-agent' && session?.host) set('endpoint', `https://${session.host}:9443`);
  if (feature === 'performance-large-fleet-pass') set('servers', remoteState.sessions.length);
}

function visionLines(value) { return String(value || '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean); }
function visionFormValues(form) { return Object.fromEntries([...new FormData(form).entries()]); }

async function runVisionFeature(feature, form, state, button) {
  state.textContent = 'PLANNING'; button.disabled = true;
  try {
    const values = visionFormValues(form); const session = opsSession(); let input = { ...values, sessionId: session?.id || '' };
    if (feature === 'remote-workspace-drive') input = { ...input, protocol: 'sftp', quotaBytes: 2 * 1024 ** 3 };
    else if (feature === 'delta-transfer-engine') input = { sourceBlocks: visionLines(values.sourceHashes).map(hash => ({ hash, bytes: 1024 * 1024 })), targetHashes: visionLines(values.targetHashes), parallelStreams: Number(values.parallelStreams) };
    else if (feature === 'offline-workspace') { if (!session) throw new Error('Choose a server for the offline workspace'); input.action = 'create'; }
    else if (feature === 'universal-content-search') input = { query: values.query, records: [...(remoteState.local?.entries || []).map(item => ({ ...item, source: 'local' })), ...(remoteState.remote?.entries || []).map(item => ({ ...item, sessionId: session?.id || '', source: 'remote' }))] };
    else if (feature === 'connection-graph') input = { sessions: remoteState.sessions, tunnels: await api.sshTunnel.list() };
    else if (feature === 'smart-jump-tunnel-manager') { if (!session) throw new Error('Choose a server for the tunnel'); input = { ...input, localPort: Number(values.localPort), remotePort: Number(values.remotePort), hops: [] }; }
    else if (feature === 'just-in-time-secrets') input = { ...input, ttlSeconds: Number(values.ttlSeconds) };
    else if (feature === 'ephemeral-ssh-certificates') { if (!session) throw new Error('Choose a server for the certificate'); input.minutes = Number(values.minutes); }
    else if (feature === 'context-teleport') input = { ...input, workspace: operationsState.activeUniversalWorkspace || {}, tabs: terminalState.tabs.map(tab => ({ name: tab.name, cwd: tab.cwd || '/', sessionId: tab.connection?.id || '' })), tunnels: await api.sshTunnel.list(), serverProfiles: remoteState.sessions };
    else if (feature === 'policy-as-code-guardrails') input = { ...input, action: 'save', readOnly: values.readOnly === 'true', forbiddenCommands: visionLines(values.forbiddenCommands), protectedPaths: visionLines(values.protectedPaths), requireSecondPerson: values.environment === 'production' };
    else if (feature === 'forensic-mode') input = { ...input, evidence: visionLines(values.evidencePaths).map(path => ({ path, content: '', bytes: 0 })) };
    else if (feature === 'canary-operations') input = { ...input, sessionIds: visionLines(values.sessionIds || session?.id), canaryCount: Number(values.canaryCount) };
    else if (feature === 'production-safety-lens') input.serverName = session?.name || 'PRODUCTION';
    else if (feature === 'remote-disaster-undo') { if (!session) throw new Error('Choose a server for the restore point'); input = { ...input, files: visionLines(values.files).map(path => ({ path })), hours: Number(values.hours) }; }
    else if (feature === 'intent-terminal') input.sessionIds = session ? [session.id] : [];
    else if (feature === 'terminal-heads-up-display') input = { command: values.command, before: { cpuPercent: Number(values.cpuBefore), processes: Number(values.processesBefore) }, after: { cpuPercent: Number(values.cpuAfter), processes: Number(values.processesAfter) } };
    else if (feature === 'adaptive-operations-scheduler') input = { jobs: [{ id: `job-${Date.now()}`, kind: values.kind, serverLoad: Number(values.serverLoad), networkQuality: Number(values.networkQuality), urgency: Number(values.urgency), cloudCost: Number(values.cloudCost) }] };
    else if (feature === 'collaborative-terminal') input = { action: 'create', name: values.name, resource: terminalState.activeId || session?.id || 'terminal', minutes: Number(values.minutes), keyboardOwner: values.operator, members: [{ name: values.operator, role: 'operator' }, { name: values.approver, role: 'approver' }] };
    else if (feature === 'visual-permission-studio') input = { ...input, identities: visionLines(values.identities).map(value => { const [name, identityClass] = value.split(':'); return { name, class: identityClass }; }) };
    else if (feature === 'living-runbooks') input = { ...input, commands: visionLines(values.commands), rollbacks: visionLines(values.rollbacks) };
    else if (feature === 'file-relationship-graph') input = { files: String(values.files || '').split(/\r?\n/).filter(Boolean).map(value => { const separator = value.indexOf('::'); return { path: separator >= 0 ? value.slice(0, separator) : value, content: separator >= 0 ? value.slice(separator + 2) : '' }; }) };
    else if (feature === 'signed-transfer-receipts') input = { source: { path: values.source }, destination: { path: values.destination }, sha256: values.sha256, bytes: Number(values.bytes), operator: values.operator };
    else if (feature === 'predictive-workspace-cache') { if (!session) throw new Error('Choose a server for predictive cache'); input = { sessionId: session.id, events: visionLines(values.paths).map((path, index) => ({ path, at: new Date(Date.now() - index * 3600000).toISOString(), bytes: index ? 1024 * 1024 : 4096, contentRequested: index === 0 })) }; }
    else if (feature === 'live-remote-event-stream') { if (!session) throw new Error('Choose a server for the event stream'); input = { sessionId: session.id, root: values.root, platform: values.platform, events: visionLines(values.events).map(value => { const separator = value.indexOf(':'); return { kind: separator >= 0 ? value.slice(0, separator) : 'modify', path: separator >= 0 ? value.slice(separator + 1) : value }; }) }; }
    else if (feature === 'visual-batch-rename-transform') input = { ...input, files: visionLines(values.paths).map(path => ({ path })), lineEndings: values.lineEndings };
    else if (feature === 'remote-data-inspector') input = { format: values.format, content: values.content, pageSize: Number(values.pageSize), page: 1 };
    else if (feature === 'connection-continuity') { if (!session) throw new Error('Choose a server for connection continuity'); input = { sessionId: session.id, mosh: values.mosh === 'true', tmux: values.tmux === 'true', agent: values.agent === 'true', relay: values.relay === 'true' }; }
    else if (feature === 'server-identity-trust-timeline') { if (!session) throw new Error('Choose a server for identity tracking'); input = { ...input, sessionId: session.id, addresses: visionLines(values.addresses) }; }
    else if (feature === 'reviewable-command-composer') input = { stages: String(values.stages || '').split(/\r?\n/).filter(Boolean).map(value => { const separator = value.indexOf(':'); return { kind: separator >= 0 ? value.slice(0, separator) : 'command', value: separator >= 0 ? value.slice(separator + 1) : value }; }) };
    else if (feature === 'terminal-focus-mode') input = { ...input, serverName: session?.name || 'Local terminal', fontScale: Number(values.fontScale), readOnly: values.readOnly === 'true' };
    else if (feature === 'universal-staging-area') input = { action: 'create', name: values.name, entries: visionLines(values.paths).map(path => ({ sessionId: session?.id || '', path, kind: 'modify', selected: true })) };
    else if (feature === 'multi-monitor-operations-layout') { const displays = visionLines(values.displays).map(value => { const [displayId, dimensions = '1920x1080'] = value.split(':'); const [width, height] = dimensions.split('x').map(Number); return { id: displayId, width, height }; }); input = { name: values.name, sessionId: session?.id || '', displays, panels: visionLines(values.panels).map(value => { const [kind, displayId] = value.split(':'); return { kind, displayId }; }) }; }
    else if (feature === 'command-file-bookmarks') input = { ...input, line: Number(values.line), tags: visionLines(values.tags) };
    else if (feature === 'explain-this-screen') input = { kind: values.kind, context: { sessionId: session?.id || '', selectedPath: remoteState.selectedRemote?.path || '' } };
    else if (feature === 'remote-workspace-health') input = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
    else if (feature === 'disposable-data-lens') input = { ...input, timeoutSeconds: Number(values.timeoutSeconds), memoryMb: Number(values.memoryMb) };
    else if (feature === 'cross-server-command-matrix') input = { command: values.command, sessionIds: visionLines(values.sessionIds || session?.id) };
    else if (feature === 'transfer-control-center') input = { name: values.name, bandwidthMbps: Number(values.bandwidthMbps), concurrency: Number(values.concurrency), items: String(values.items || '').split(/\r?\n/).filter(Boolean).map((value, index) => { const [source, destination, bytes] = value.split('::'); return { id: `transfer-${index + 1}`, source: { path: source }, destination: { path: destination }, bytes: Number(bytes), priority: index ? 'normal' : 'high' }; }) };
    else if (feature === 'direct-server-transfer') input = { ...input, bytes: Number(values.bytes), directAvailable: true };
    else if (feature === 'atomic-remote-editor') { if (!session) throw new Error('Choose a server for the atomic editor'); input = { sessionId: session.id, path: values.path, beforeContent: values.beforeContent, proposedContent: values.proposedContent };
    } else if (feature === 'session-time-machine') { if (!session) throw new Error('Choose a server for the session timeline'); input = { sessionId: session.id, name: values.name, events: String(values.events || '').split(/\r?\n/).filter(Boolean).map(value => { const [kind, ...parts] = value.split('::'); const payload = parts.join('::'); return kind === 'cwd' || kind === 'file-open' ? { kind, path: payload } : kind === 'command' ? { kind, command: payload } : { kind, output: payload }; }) };
    } else if (feature === 'filesystem-snapshot-diff') { const parseManifest = value => String(value || '').split(/\r?\n/).filter(Boolean).map(line => { const [file, content = '', mode = ''] = line.split('::'); return { path: file, content, mode }; }); input = { root: values.root, before: parseManifest(values.before), after: parseManifest(values.after) };
    } else if (feature === 'smart-sync-profiles') { if (!session) throw new Error('Choose a server for smart sync'); input = { ...input, sessionId: session.id, excludes: visionLines(values.excludes), includes: [], conflictStrategy: 'three-way' };
    } else if (feature === 'archive-explorer') input = { path: values.path, entries: visionLines(values.entries).map(name => ({ name })) };
    else if (feature === 'remote-storage-fabric') input = { endpoints: String(values.endpoints || '').split(/\r?\n/).filter(Boolean).map((value, index) => { const [protocol, name, root] = value.split('::'); return { id: `storage-${index + 1}`, protocol, name, root }; }) };
    else if (feature === 'live-virtual-folders') input = { name: values.name, sessionIds: session ? [session.id] : [], conditions: String(values.conditions || '').split(/\r?\n/).filter(Boolean).map(value => { const [field, operator, ...parts] = value.split('::'); return { field, operator, value: parts.join('::') }; }), records: [...(remoteState.local?.entries || []).map(item => ({ ...item, server: 'local' })), ...(remoteState.remote?.entries || []).map(item => ({ ...item, server: session?.name || 'remote' }))] };
    else if (feature === 'disk-space-visualizer') input = { root: values.root, entries: String(values.entries || '').split(/\r?\n/).filter(Boolean).map(value => { const [file, bytes, kind] = value.split('::'); return { path: file, bytes: Number(bytes), kind }; }) };
    else if (feature === 'process-port-container-navigator') input = { processes: String(values.processes || '').split(/\r?\n/).filter(Boolean).map(value => { const [pid, name, containerId, config] = value.split('::'); return { pid: Number(pid), name, containerId, configPaths: config ? [config] : [] }; }), ports: String(values.ports || '').split(/\r?\n/).filter(Boolean).map(value => { const [port, protocol, address, pid] = value.split('::'); return { port: Number(port), protocol, address, pid: Number(pid) }; }) };
    else if (feature === 'secure-clipboard-bridge') input = { content: values.content, destinations: [values.destinations], expiresSeconds: Number(values.expiresSeconds) };
    else if (feature === 'shell-resurrection') { if (!session) throw new Error('Choose a server to restore shell context'); input = { sessionId: session.id, tabs: String(values.tabs || '').split(/\r?\n/).filter(Boolean).map(value => { const [name, cwd, multiplexer, remoteSession] = value.split('::'); return { name, cwd, multiplexer, remoteSession }; }) }; }
    else if (feature === 'terminal-file-manager-fusion') input = { cwd: values.cwd, shell: values.shell, paths: visionLines(values.paths), output: values.output };
    else if (feature === 'execution-context-beacon') input = { ...input, host: values.host, user: values.user, environment: values.environment, runtime: values.runtime, target: values.target, namespace: values.namespace, cwd: values.cwd, elevated: values.elevated === 'true' };
    else if (feature === 'connection-waterfall-tuner') input = { latencyMs: Number(values.latencyMs), phases: String(values.phases || '').split(/\r?\n/).filter(Boolean).map(value => { const [id, durationMs, status] = value.split('::'); return { id, durationMs: Number(durationMs), status }; }) };
    else if (feature === 'data-boundary-guard') input = { sourceZone: values.sourceZone, destinationZone: values.destinationZone, content: values.content };
    else if (feature === 'live-output-privacy-shield') input = { output: values.output };
    else if (feature === 'detached-job-orchestrator') { if (!session) throw new Error('Choose a server for the detached job'); input = { ...input, sessionId: session.id, timeoutSeconds: Number(values.timeoutSeconds), cpuPercent: Number(values.cpuPercent), memoryMb: Number(values.memoryMb), outputBytes: Number(values.outputBytes) };
    } else if (feature === 'conflict-resolution-cockpit') input = { ...input, sessionId: session?.id || '', path: values.path, base: values.base, local: values.local, remote: values.remote };
    else if (feature === 'executable-trust-inspector') input = { ...input, user: session?.username || '', name: values.name, resolvedPath: values.resolvedPath, kind: values.kind, owner: values.owner, mode: values.mode, package: values.package, sha256: values.sha256, signature: values.signature };
    else if (feature === 'resource-budgeted-commands') { if (!session) throw new Error('Choose a server for command budgets'); input = { ...input, sessionId: session.id, timeoutSeconds: Number(values.timeoutSeconds), cpuPercent: Number(values.cpuPercent), memoryMb: Number(values.memoryMb), outputBytes: Number(values.outputBytes), networkBytes: Number(values.networkBytes) };
    } else if (feature === 'remote-quarantine-lab') input = { sessionId: session?.id || '', path: values.path, sample: values.sample };
    else if (feature === 'branchable-terminal') { if (!session) throw new Error('Choose a server for a terminal branch'); input = { ...input, sessionId: session.id, expiryMinutes: Number(values.expiryMinutes), writable: values.writable === 'true', openFiles: remoteState.selectedRemote?.path ? [remoteState.selectedRemote.path] : [] };
    } else if (feature === 'adaptive-ssh-channel-pool') input = { maximumChannels: Number(values.maximumChannels), keepAliveSeconds: Number(values.keepAliveSeconds), expireIdleSeconds: Number(values.expireIdleSeconds), connections: remoteState.sessions.filter(item => ['ssh', 'sftp'].includes(item.type)).map(item => ({ sessionId: item.id, host: item.host, user: item.username || '', port: item.port || 22, activeChannels: item.id === session?.id ? 1 : 0 })) };
    else if (feature === 'terminal-files-review-inbox') input = { action: 'create', sessionId: session?.id || '', title: values.title, kind: values.kind, target: values.target, risk: values.risk, requestedBy: values.requestedBy, preview: values.preview, plan: { target: values.target, kind: values.kind } };
    else if (feature === 'approved-execution-engine') { if (!session && values.operation === 'create') throw new Error('Choose a server for approved execution'); if (values.operation === 'create') input = { action: 'create', sessionId: session.id, requestedBy: values.requestedBy, actions: [values.actionKind === 'file-write' ? { kind: 'file-write', path: values.path, content: values.content } : { kind: 'safe-template', template: values.template, parameters: {} }] }; else input = { action: values.operation, id: values.planId, approver: values.approver, idempotencyKey: values.idempotencyKey, approved: values.consent === 'true' };
    } else if (feature === 'visual-result-renderers') input = { kind: values.kind, data: JSON.parse(values.data || '{}'), maximumItems: Number(values.maximumItems) };
    else if (feature === 'unified-remote-session-canvas') input = { name: values.name, layout: values.layout, sessionId: session?.id || '', cwd: values.cwd, clipboardPolicy: values.clipboardPolicy, panes: String(values.panes || '').split(/\r?\n/).filter(Boolean).map((value, index) => { const [protocol, role, title] = value.split('::'); return { id: `pane-${index + 1}`, protocol, role, title, sessionId: session?.id || '' }; }) };
    else if (feature === 'remote-desktop-quality-engine') input = { mode: values.mode, latencyMs: Number(values.latencyMs), bandwidthMbps: Number(values.bandwidthMbps), packetLossPercent: Number(values.packetLossPercent), clipboardPolicy: values.clipboardPolicy };
    else if (feature === 'remote-desktop-file-bridge') input = { source: { protocol: values.sourceProtocol, path: values.sourcePath }, destination: { protocol: values.destinationProtocol, path: values.destinationPath }, sourceZone: values.sourceZone, destinationZone: values.destinationZone, bytes: Number(values.bytes), sample: values.sample };
    else if (feature === 'capability-negotiator') input = { platform: values.platform, available: visionLines(values.available) };
    else if (feature === 'optional-kitsune-agent') input = { endpoint: values.endpoint, health: { ok: values.healthy === 'true', version: 1 }, capabilities: visionLines(values.capabilities), required: visionLines(values.required) };
    else if (feature === 'contextual-action-orb') input = { kind: values.kind, target: { sessionId: session?.id || '', path: remoteState.selectedRemote?.path || '' } };
    else if (feature === 'terminal-files-adapter-sdk') input = { manifest: { pluginId: values.pluginId, name: values.name, kind: values.kind, protocols: visionLines(values.protocols), permissions: visionLines(values.permissions), capabilities: visionLines(values.capabilities) } };
    else if (feature === 'remote-operations-test-lab') input = { environment: values.environment, scenarios: visionLines(values.scenarios) };
    else if (feature === 'keyboard-accessibility-pass') input = { name: values.name, keyboardOnly: values.keyboardOnly === 'true', reduceMotion: values.reduceMotion === 'true', highContrast: values.highContrast === 'true', terminalScale: Number(values.terminalScale) };
    else if (feature === 'performance-large-fleet-pass') input = { servers: Number(values.servers), records: Number(values.records), outputBytes: Number(values.outputBytes) };
    else if (feature === 'semantic-shell-layer') input = { host: values.host, blocks: String(values.blocks || '').split(/\r?\n/).filter(Boolean).map(value => { const [command, exitCode, durationMs, ...output] = value.split('::'); return { command, exitCode: Number(exitCode), durationMs: Number(durationMs), output: output.join('::'), cwd: remoteState.remote?.path || '/' }; }) };
    else if (feature === 'config-studio') input = { kind: values.kind, path: values.path, currentContent: values.currentContent, content: values.content };
    else if (feature === 'identity-trust-center') input = { name: values.name, methods: visionLines(values.methods), caEnabled: values.caEnabled === 'true', certificateLifetimeMinutes: Number(values.certificateLifetimeMinutes), keys: String(values.keys || '').split(/\r?\n/).filter(Boolean).map(value => { const [label, fingerprint, algorithm, expiresAt] = value.split('::'); return { label, fingerprint, algorithm, expiresAt, hardwareBacked: values.methods.includes('fido2') || values.methods.includes('windows-hello') }; }) };
    else if (feature === 'remote-desktop-pro') input = { protocol: values.protocol, displays: String(values.displays || '').split(/\r?\n/).filter(Boolean).map(value => { const [id, width, height] = value.split('::'); return { id, width: Number(width), height: Number(height) }; }), audio: values.audio === 'true', clipboard: values.clipboard, driveMapping: values.driveMapping === 'true', printers: values.printers === 'true', usb: values.usb === 'true', recording: values.recording === 'true' };
    else if (feature === 'live-process-network-explorer') input = { processes: String(values.processes || '').split(/\r?\n/).filter(Boolean).map(value => { const [pid, parentPid, name, cpu, memoryBytes] = value.split('::'); return { pid: Number(pid), parentPid: Number(parentPid), name, cpu: Number(cpu), memoryBytes: Number(memoryBytes) }; }), sockets: String(values.sockets || '').split(/\r?\n/).filter(Boolean).map(value => { const [protocol, local, remote, socketState, pid] = value.split('::'); return { protocol, local, remote, state: socketState, pid: Number(pid) }; }) };
    else if (feature === 'workspace-recovery-capsule') input = { action: 'create', name: values.name, target: values.target, passphrase: values.passphrase, cwd: values.cwd, tabs: terminalState.tabs.map(tab => ({ id: tab.id, name: tab.name, cwd: tab.cwd || values.cwd })), panes: operationsState.activeUniversalWorkspace?.panels || [], transfers: operationsState.terminalFileVision?.transferQueues || [], unsavedBuffers: String(values.buffers || '').split(/\r?\n/).filter(Boolean).map(value => { const [path, ...content] = value.split('::'); return { path, content: content.join('::') }; }), layout: { activePanel: 'operations-center' } };
    else if (feature === 'cross-host-data-pipeline') input = { name: values.name, parallelism: Number(values.parallelism), bandwidthMbps: Number(values.bandwidthMbps), stages: String(values.stages || '').split(/\r?\n/).filter(Boolean).map(value => { const [kind, protocol, sessionId, path] = value.split('::'); return { kind, endpoint: protocol ? { protocol, sessionId, path } : undefined }; }) };
    else if (feature === 'command-reproducibility') input = { sessionId: session?.id || '', command: values.command, cwd: values.cwd, environment: Object.fromEntries(String(values.environment || '').split(/\r?\n/).filter(Boolean).map(value => { const at = value.indexOf('='); return at < 1 ? [value, ''] : [value.slice(0, at), value.slice(at + 1)]; })), tools: String(values.tools || '').split(/\r?\n/).filter(Boolean).map(value => { const [name, version, sha256] = value.split('::'); return { name, version, sha256 }; }), exitCode: Number(values.exitCode), output: values.output };
    else if (feature === 'disposable-shadow-host') input = { name: values.name, sessionId: session?.id || '', backend: values.backend, operation: values.operation, before: String(values.before || '').split(/\r?\n/).filter(Boolean).map(value => { const [path, ...content] = value.split('::'); return { path, content: content.join('::') }; }), after: String(values.after || '').split(/\r?\n/).filter(Boolean).map(value => { const [path, ...content] = value.split('::'); return { path, content: content.join('::') }; }), expiresMinutes: Number(values.expiresMinutes) };
    else if (feature === 'focus-incident-layouts') input = { name: values.name, mode: values.mode, maximumPanels: Number(values.maximumPanels) };
    const result = await api.terminalFileVision.execute(feature, input); renderVisionResultPreview(feature, result); opsPrint(result); state.textContent = result?.success === false ? 'REVIEW' : result?.executable ? 'EXECUTED' : 'PLAN READY'; showToast(`${VISION_FORMS[feature].title}: ${result?.executable ? 'verified' : 'plan ready'}`, 'success', 'terminal-files-workflow'); try { await refreshOperationsCenter(); } catch (refreshError) { console.warn('Operations Center background refresh skipped:', refreshError.message); }
  } catch (error) { state.textContent = 'CHECK INPUT'; opsPrint(error.message); showToast(error.message, 'error'); } finally { button.disabled = false; }
}

const TERMINAL_FILE_PRO_ACTIONS = new Set(['terminal-notebook', 'secure-paste-firewall', 'shell-dialect-translator', 'terminal-sidecar', 'command-shadow-mode', 'terminal-checkpoint', 'multi-host-result-matrix', 'interactive-output-actions', 'terminal-recording-studio', 'protocol-console', 'transactional-multi-file-editor', 'container-kubernetes-files', 'git-aware-remote-files', 'archive-as-folder', 'huge-file-studio', 'remote-content-index', 'file-provenance', 'cross-protocol-drag-drop', 'duplicate-similarity-finder', 'filesystem-heatmap', 'terminal-file-causality', 'context-aware-split-view', 'transfer-pipeline-builder', 'safe-remote-drop-zone', 'connection-capsule', 'server-airdrop', 'remote-clipboard-vault', 'filesystem-watch-explain']);

async function runTerminalFileProAction(action, session) {
  if (action === 'terminal-notebook') { const tab = terminalState.tabs.find(item => item.id === terminalState.activeId); const blocks = tab?.structuredBlocks || []; return api.terminalFilePro.notebookSave({ name: prompt('Notebook name:', `${tab?.name || 'Terminal'} notebook`), sessionIds: tab?.connection?.id ? [tab.connection.id] : [], blocks, includeOutput: confirm('Include redacted command output?') }); }
  if (action === 'secure-paste-firewall') return api.terminalFilePro.pasteAnalyze(prompt('Paste commands to analyze safely:', '') || '');
  if (action === 'shell-dialect-translator') return api.terminalFilePro.translate({ from: prompt('Source shell: bash, zsh, fish, powershell or cmd', 'bash'), to: prompt('Target shell:', 'powershell'), command: prompt('Command to translate:', 'ls -la') });
  if (action === 'terminal-sidecar') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.sidecar(session.id); }
  if (action === 'command-shadow-mode') { if (!session) throw new Error('Choose a server first'); const template = prompt('Safe template: disk, ports, tail, journal or dockerLogs', 'disk'); const parameters = template === 'tail' ? { path: prompt('Remote path:', '/var/log/syslog'), lines: 200 } : template === 'journal' ? { unit: prompt('Unit:', 'nginx.service') } : {}; const preview = await api.terminalFilePro.shadow(session.id, template, parameters, { isolation: 'bubblewrap' }); opsPrint(preview); return confirm('Run this read-only template inside the isolated shadow?') ? api.terminalFilePro.shadow(session.id, template, parameters, { isolation: 'bubblewrap', approved: true }) : preview; }
  if (action === 'terminal-checkpoint') { const config = await api.terminalFilePro.configuration(); const mode = prompt('Checkpoint: save or restore', config.checkpoints.length ? 'restore' : 'save'); if (mode === 'restore') { const id = prompt(`Checkpoint ID:\n${config.checkpoints.map(item => `${item.id} · ${item.name}`).join('\n')}`, config.checkpoints[0]?.id || ''); return id ? api.terminalFilePro.checkpointRestore(id) : { cancelled: true }; } if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.checkpointSave({ name: prompt('Checkpoint name:', `${session.name} checkpoint`), sessionId: session.id, cwd: prompt('Current directory:', remoteState.remote?.path || session.remotePath || '/'), tmux: session.tmuxSession || '', tunnels: (await api.sshTunnel.list()).filter(item => item.sessionId === session.id).map(item => item.id), openFiles: remoteState.selectedRemote?.path ? [remoteState.selectedRemote.path] : [] }); }
  if (action === 'multi-host-result-matrix') { const events = session ? await api.opsWorkspace.timeline(session.id, { minutes: 1440, limit: 200 }) : []; return api.terminalFilePro.resultMatrix(events.map(item => ({ sessionId: item.sessionId, command: item.command, stdout: item.recordHash, code: item.result?.code, success: item.result?.success }))); }
  if (action === 'interactive-output-actions') return api.terminalFilePro.outputActions(prompt('Paste terminal output to detect paths, URLs, PID values, ports and containers:', '') || '');
  if (action === 'terminal-recording-studio') return api.terminalFilePro.recordingStudio({ transcript: prompt('Paste terminal recording/transcript:', '') || '', chapters: [{ title: 'Session', offset: 0 }], annotations: [], format: prompt('Format: text, html or asciinema', 'text') });
  if (action === 'protocol-console') return api.terminalFilePro.protocolSave({ name: prompt('Console name:', 'Protocol console'), protocol: prompt('Protocol: ssh, serial, telnet, kubernetes-exec, docker-exec, wsl or powershell', 'ssh'), sessionId: session?.id || '', target: prompt('Target/pod/container:', ''), namespace: prompt('Kubernetes namespace:', 'default'), readOnly: confirm('Open as read-only?') });
  if (action === 'transactional-multi-file-editor') { if (!session) throw new Error('Choose a server first'); const paths = (prompt('Remote file paths, comma separated:', remoteState.selectedRemote?.path || '/etc/app.conf') || '').split(',').map(item => item.trim()).filter(Boolean); const changes = []; for (const file of paths) { const current = await api.files.readRemote(session, file); const content = prompt(`New complete content for ${file}:`, current.content); if (content === null) return { cancelled: true }; changes.push({ path: file, content }); } const preview = await api.terminalFilePro.multiFilePreview(session.id, changes); opsPrint({ ...preview, items: preview.items.map(({ content, ...item }) => item) }); return confirm(`Apply ${preview.items.length} files as one verified transaction with rollback?`) ? api.terminalFilePro.multiFileApply(preview, true) : preview; }
  if (action === 'container-kubernetes-files') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.containerFiles(session.id, { engine: prompt('Engine: docker or kubernetes', 'docker'), target: prompt('Container or pod:', 'app'), namespace: prompt('Namespace:', 'default'), path: prompt('Path:', '/'), action: prompt('Action: list or read', 'list') }); }
  if (action === 'git-aware-remote-files') { if (!session) throw new Error('Choose a server first'); const root = prompt('Repository root:', session.remotePath || '/srv/app'); return api.terminalFilePro.gitFiles(session.id, { root, file: prompt('File path:', remoteState.selectedRemote?.path || `${root}/README.md`), action: prompt('Action: status, diff, history or blame', 'status') }); }
  if (action === 'archive-as-folder') { if (!session) throw new Error('Choose a server first'); const archive = prompt('Remote ZIP/TAR/7z archive:', remoteState.selectedRemote?.path || '/tmp/archive.tar.gz'); const operation = prompt('Action: list or extract', 'list'); const input = { archive, action: operation }; if (operation === 'extract') { input.destination = prompt('Destination directory:', '/tmp/extracted'); const preview = await api.terminalFilePro.archiveFiles(session.id, input); opsPrint(preview); if (confirm('Extract without overwriting existing files?')) input.approved = true; } return api.terminalFilePro.archiveFiles(session.id, input); }
  if (action === 'huge-file-studio') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.hugeFile(session.id, { path: prompt('Huge remote file:', remoteState.selectedRemote?.path || '/var/log/syslog'), action: prompt('Action: tail, range or search', 'tail'), offset: Number(prompt('Byte offset:', '0')), limitBytes: Number(prompt('Maximum bytes (up to 4 MB):', '1048576')), query: prompt('Search text when applicable:', '') }); }
  if (action === 'remote-content-index') { if (!session) throw new Error('Choose a server first'); const config = await api.terminalFilePro.configuration(); const mode = prompt('Encrypted index: build or search', config.indexes.length ? 'search' : 'build'); if (mode === 'build') return api.terminalFilePro.indexBuild(session.id, prompt('Remote root:', session.remotePath || '/'), { limit: 50000 }); const record = config.indexes.find(item => item.sessionId === session.id) || config.indexes[0]; return record ? api.terminalFilePro.indexSearch(record.id, prompt('File name query:', 'config')) : { error: 'Build an index first' }; }
  if (action === 'file-provenance') return api.terminalFilePro.provenance(prompt('File SHA-256:', '') || '');
  if (action === 'cross-protocol-drag-drop') return api.terminalFilePro.crossProtocolPlan({ source: { protocol: prompt('Source: local, sftp, ftp, ftps, webdav, s3, azure, docker or kubernetes', 'sftp'), path: prompt('Source path:', '/') }, destination: { protocol: prompt('Destination protocol:', 's3'), path: prompt('Destination path:', '/') } });
  if (action === 'duplicate-similarity-finder') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.duplicates(session.id, prompt('Remote root:', session.remotePath || '/')); }
  if (action === 'filesystem-heatmap') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.heatmap(session.id, prompt('Remote root:', session.remotePath || '/')); }
  if (action === 'terminal-file-causality') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.causality(session.id, prompt('Remote file:', remoteState.selectedRemote?.path || '/etc/app.conf')); }
  if (action === 'context-aware-split-view') { if (!session) throw new Error('Choose a server first'); const tab = terminalState.tabs.find(item => item.id === terminalState.activeId); const result = await api.terminalFilePro.splitContext({ terminalId: tab?.id || `manual-${Date.now()}`, sessionId: session.id, cwd: prompt('Terminal working directory:', tab?.cwd || session.remotePath || '/') }); switchToPanel('file-manager'); await selectRemoteSession(session.id); await loadRemoteFiles(result.context.cwd); return result; }
  if (action === 'transfer-pipeline-builder') { const saved = await api.terminalFilePro.pipelineSave({ name: prompt('Pipeline name:', 'Verified compressed transfer'), steps: [{ kind: 'compress' }, { kind: 'encrypt' }, { kind: 'transfer' }, { kind: 'checksum' }, { kind: 'validate' }], rollback: true }); return api.terminalFilePro.pipelinePlan(saved.pipeline.id, { source: prompt('Source:', ''), destination: prompt('Destination:', ''), bytes: Number(prompt('Bytes:', '0')) }); }
  if (action === 'safe-remote-drop-zone') { if (!session) throw new Error('Choose a server first'); const config = await api.terminalFilePro.configuration(); const mode = prompt('Drop Zone: create or inspect', config.dropZones.length ? 'inspect' : 'create'); if (mode === 'create') return api.terminalFilePro.dropZoneCreate({ name: `${session.name} staging`, root: prompt('Local staging directory:', ''), targetSessionId: session.id, targetRoot: prompt('Remote destination:', session.remotePath || '/tmp/drop'), validators: ['sha256', 'secret-scan', 'size-limit'] }); const zone = config.dropZones.find(item => item.targetSessionId === session.id) || config.dropZones[0]; return zone ? api.terminalFilePro.dropZoneInspect(zone.id) : { error: 'Create a zone first' }; }
  if (action === 'connection-capsule') { const target = prompt('Encrypted capsule output file:', ''); const passphrase = prompt('Passphrase (minimum 12 characters):'); if (!target || !passphrase) return { cancelled: true }; return api.terminalFilePro.capsuleCreate({ target, passphrase, profiles: remoteState.sessions, layout: operationsState.activeUniversalWorkspace || {}, tunnels: await api.sshTunnel.list(), syncRules: [], transferHistory: [] }); }
  if (action === 'server-airdrop') { const mode = prompt('AirDrop: create or receive', 'create'); if (mode === 'create') return api.terminalFilePro.airDropCreate({ source: prompt('Local file to seal:', ''), ttlMinutes: Number(prompt('Lifetime minutes:', '15')) }); return api.terminalFilePro.airDropConsume(prompt('Drop ID:'), prompt('One-time code:'), prompt('Local destination file:')); }
  if (action === 'remote-clipboard-vault') { const mode = prompt('Clipboard Vault: put or take', 'put'); if (mode === 'put') return api.terminalFilePro.clipboardPut({ value: prompt('Sensitive clipboard text:', ''), label: prompt('Label:', 'Remote paste'), sessionId: session?.id || '', ttlSeconds: Number(prompt('Lifetime seconds:', '60')) }); const result = await api.terminalFilePro.clipboardTake(prompt('Clipboard item ID:'), session?.id || ''); try { await navigator.clipboard.writeText(result.value); } catch {} return { ...result, value: '<copied-to-system-clipboard>' }; }
  if (action === 'filesystem-watch-explain') { if (!session) throw new Error('Choose a server first'); return api.terminalFilePro.filesystemWatch({ sessionId: session.id, root: prompt('Watched remote directory:', session.remotePath || '/var/www'), minutes: 30 }); }
  throw new Error('Unknown Terminal/File Pro action');
}

function startVoiceOperationsConsole() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return showToast('Voice recognition is not available in this browser/runtime', 'warning');
  const recognition = new Recognition(); recognition.lang = navigator.language || 'pl-PL'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  recognition.onresult = event => { const phrase = event.results[0][0].transcript.toLowerCase(); const route = phrase.includes('terminal') ? 'terminal' : phrase.includes('file') || phrase.includes('plik') ? 'file-manager' : phrase.includes('refresh') || phrase.includes('odśwież') ? 'refresh' : phrase.includes('graph') || phrase.includes('map') ? 'graph' : ''; opsPrint({ voice: phrase, matchedAction: route || null, mutationsExecuted: false }); if (route === 'terminal' || route === 'file-manager') switchToPanel(route); else if (route === 'refresh') refreshOperationsCenter(); else if (route === 'graph') runOperationsAction('graph'); else showToast('No safe voice command matched', 'warning'); };
  recognition.onerror = event => showToast(`Voice console: ${event.error}`, 'error'); recognition.start(); showToast('Listening for a safe navigation/read-only command…', 'success');
}

function askFreshAuthentication() {
  const username = prompt('Account for fresh MFA verification:', 'admin'); if (!username) return null;
  const password = prompt('Password:'); if (password === null) return null;
  const secondFactor = prompt('TOTP or recovery code:', ''); if (secondFactor === null) return null;
  return { username, password, secondFactor };
}

function openEmbeddedDesktop(gateway) {
  let endpoint; try { endpoint = new URL(gateway.endpoint); } catch { return showToast('Invalid desktop gateway URL', 'error'); }
  if (endpoint.protocol !== 'https:' || endpoint.origin !== gateway.allowedOrigin) return showToast('Desktop gateway origin mismatch', 'error');
  const overlay = document.createElement('div'); overlay.className = 'embedded-desktop-overlay';
  const header = document.createElement('div'); header.className = 'embedded-desktop-header';
  const title = document.createElement('strong'); title.textContent = `${gateway.name} · ${gateway.type.toUpperCase()} · clipboard ${gateway.clipboardPolicy}`;
  const close = document.createElement('button'); close.className = 'btn btn-small'; close.textContent = 'Close desktop'; close.addEventListener('click', () => overlay.remove());
  const frame = document.createElement('iframe'); frame.src = endpoint.toString(); frame.referrerPolicy = 'no-referrer'; frame.sandbox = 'allow-scripts allow-forms allow-same-origin allow-popups'; frame.allow = gateway.clipboardPolicy === 'disabled' ? '' : 'clipboard-read; clipboard-write'; frame.title = gateway.name;
  header.append(title, close); overlay.append(header, frame); document.body.appendChild(overlay);
}

async function launchSmartWorkspace(workspace) { if (!workspace) return; for (const id of workspace.sessionIds || []) { const session = remoteState.sessions.find(item => item.id === id); if (session) await createTerminal(session); } for (const tunnel of workspace.tunnels || []) { const session = remoteState.sessions.find(item => item.id === tunnel.sessionId || workspace.sessionIds?.[0]); if (session) await api.sshTunnel.start(session, tunnel); } switchToPanel(workspace.panels?.at(-1) || 'operations-center'); }
async function chooseIncident() { const incidents = await api.incident.list(); const active = incidents.filter(item => item.status !== 'resolved'); const id = prompt(`Incident ID:\n${active.map(item => `${item.id} · ${item.title}`).join('\n')}`, operationsState.activeIncidentId || active[0]?.id || ''); return active.find(item => item.id === id) || null; }

function initServerWorkspace() {
  const select = document.getElementById('workspace-server-select'); if (!select || !api.remote) return;
  select.addEventListener('change', refreshServerWorkspace);
  document.getElementById('workspace-server-new').addEventListener('click', () => openRemoteSessionModal('workspace'));
  document.getElementById('workspace-open-terminal').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; switchToPanel('terminal'); await createTerminal(session); });
  document.getElementById('workspace-open-putty').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; try { await api.remote.openPuTTY(session); showToast('PuTTY opened', 'success'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('workspace-open-files').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; switchToPanel('file-manager'); await selectRemoteSession(session.id); });
  document.getElementById('workspace-open-winscp').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; try { await api.remote.openWinScp(session); showToast('WinSCP Portable opened', 'success'); } catch (error) { showToast(error.message, 'error'); } });
  document.getElementById('workspace-mount-sftp').addEventListener('click', mountWorkspaceSftp);
  document.getElementById('workspace-open-rdp').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; const result = await api.remote.openRdp(session); if (!result.success) showToast(result.error, 'error'); });
  document.getElementById('workspace-open-vnc').addEventListener('click', async () => { const session = workspaceSession(); if (!session) return; const result = await api.remote.openVnc(session); if (!result.success) showToast(result.error, 'error'); });
  document.getElementById('workspace-deploy').addEventListener('click', openDeployment);
  document.getElementById('workspace-run-diagnostics').addEventListener('click', runWorkspaceDiagnostics);
  document.querySelectorAll('[data-workspace-inspect]').forEach(button => button.addEventListener('click', () => inspectWorkspace(button.dataset.workspaceInspect)));
  document.querySelectorAll('[data-workspace-control]').forEach(button => button.addEventListener('click', () => runWorkspaceControl(button.dataset.workspaceControl)));
  document.getElementById('workspace-runbook-new').addEventListener('click', openRunbookEditor);
  document.getElementById('runbook-close').addEventListener('click', closeRunbookEditor); document.getElementById('runbook-cancel').addEventListener('click', closeRunbookEditor); document.getElementById('runbook-save').addEventListener('click', saveRunbookEditor);
  document.getElementById('workspace-runbook-run').addEventListener('click', runSelectedRunbook);
  document.getElementById('deployment-close').addEventListener('click', closeDeployment); document.getElementById('deployment-cancel').addEventListener('click', closeDeployment); document.getElementById('deployment-run').addEventListener('click', runDeployment);
  api.remote.onDeployProgress?.(progress => { const target = document.getElementById('deployment-progress'); if (target) target.textContent += `\n${progress.status === 'success' ? '✓' : progress.status === 'error' ? '✕' : '…'} ${progress.stage}`; });
  api.runbook?.onProgress?.(progress => { document.getElementById('workspace-diagnostics-state').textContent = `${progress.name} · ${progress.status}`; });
  document.querySelectorAll('[data-portable-launch]').forEach(button => button.addEventListener('click', async () => { try { const result = await api.portable.launch(button.dataset.portableLaunch); showToast(`${result.name} ${result.version} opened`, 'success'); } catch (error) { showToast(error.message, 'error'); } }));
  document.querySelectorAll('[data-devops]').forEach(button => button.addEventListener('click', () => runDevOpsAction(button.dataset.devops)));
  document.querySelectorAll('[data-suite]').forEach(button => button.addEventListener('click', () => runSuiteAction(button.dataset.suite)));
  void refreshPortableTools();
  void refreshRunbooks();
  void refreshWorkspaceSuite();
  setInterval(async () => { if (document.getElementById('panel-server-workspace')?.classList.contains('active') && workspaceSession()) { try { const session = workspaceSession(); const result = await api.devops.metrics(session); const metrics = JSON.parse(result.stdout); await api.advanced.recordMetric(session.id, metrics); document.getElementById('workspace-live-metrics').textContent = `Load ${metrics.load.join(' / ')} · RAM ${formatFileSize(metrics.memory.used)} / ${formatFileSize(metrics.memory.total)} · Disk ${metrics.disk.percent} · Network ↓${formatFileSize(metrics.network.rx)} ↑${formatFileSize(metrics.network.tx)} · Containers ${metrics.containers} · ${new Date().toLocaleTimeString()}`; } catch {} } }, 10000);
}

async function refreshWorkspaceSuite() {
  if (!api.suite) return; try { const [keys, snapshots, state] = await Promise.all([api.suite.keys(), api.suite.snapshots(), api.suite.state()]); document.getElementById('workspace-key-summary').textContent = keys.length ? `${keys.length} managed key(s): ${keys.map(item => item.id).join(', ')}` : 'No managed SSH keys.'; document.getElementById('workspace-snapshot-summary').textContent = snapshots.length ? `${snapshots.length} restore point(s); latest ${new Date(snapshots[0].createdAt).toLocaleString()}` : 'No file snapshots yet.'; document.getElementById('workspace-team-summary').textContent = `${state.members.length} member(s) · ${state.approvals.length} approval(s) · ${state.templates.length} template(s) · ${state.schedules.length} schedule(s) · ${state.plugins.length} plugin(s)`; } catch {}
}

async function runSuiteAction(action) {
  const session = workspaceSession();
  try {
    if (action === 'key-generate') { const name = prompt('Key name:', `kitsune-${Date.now()}`); if (!name) return; const algorithm = prompt('Algorithm: ed25519 or rsa', 'ed25519') || 'ed25519'; const passphrase = prompt('Optional passphrase (stored encrypted):', '') ?? ''; await api.suite.keyGenerate({ name, algorithm, passphrase }); }
    else if (action === 'key-install') { if (!session) return showToast('Choose a server first', 'warning'); const keys = await api.suite.keys(); const id = prompt(`Key to install:\n${keys.map(item => item.id).join(', ')}`, keys[0]?.id || ''); if (!id) return; if (!confirm(`Install public key “${id}” in ${session.name}:~/.ssh/authorized_keys?`)) return; await api.suite.keyInstall(session, id); }
    else if (action === 'key-rotate') { if (!session) return showToast('Choose a server first', 'warning'); const keys = await api.suite.keys(); const id = prompt(`Key to rotate on ${session.name}:\n${keys.map(item => item.id).join(', ')}`, keys[0]?.id || ''); if (!id || !confirm(`Replace “${id}” in authorized_keys with a newly generated key? The old private key remains local for rollback.`)) return; await api.suite.keyRotate(session, id, prompt('Optional passphrase for the new key:', '') ?? ''); }
    else if (action === 'capabilities') { const value = await api.suite.capabilities(); const message = `Credential vault integrations:\n${value.vaults.map(item => `${item.available ? '✓' : '○'} ${item.name}`).join('\n')}\n\nCLI tools:\n${Object.entries(value.tools).map(([key, available]) => `${available ? '✓' : '○'} ${key}`).join('\n')}`; alert(message); if (session && confirm('Import this session password from 1Password, Bitwarden or KeePassXC now?')) { const provider = prompt('Provider: onepassword, bitwarden or keepassxc', 'onepassword'); if (!provider) return; const reference = prompt(provider === 'keepassxc' ? 'Reference: absolute-database-path::entry' : 'Vault item/reference:'); if (!reference) return; const masterPassword = provider === 'keepassxc' ? (prompt('KeePassXC database password (not stored):', '') ?? '') : ''; await api.suite.vaultImport(provider, reference, session.id, { masterPassword, kind: 'password' }); } }
    else if (action === 'snapshot') { const file = prompt('Absolute local file path:', remoteState.selectedLocal?.path || ''); if (!file) return; await api.suite.snapshot(file); }
    else if (action === 'restore') { const items = await api.suite.snapshots(); const id = prompt(`Snapshot ID to restore:\n${items.slice(0, 8).map(item => `${item.id} · ${item.source}`).join('\n')}`, items[0]?.id || ''); if (!id || !confirm('Restore this snapshot and overwrite the current local file?')) return; await api.suite.snapshotRestore(id); }
    else if (action === 'template') { const name = prompt('Workspace template name:'); if (!name) return; await api.suite.saveItem('templates', { name, sessionId: session?.id || '', panels: ['terminal', 'file-manager', 'server-workspace'], tunnels: [] }); }
    else if (action === 'template-run') { const state = await api.suite.state(); const name = prompt(`Template to launch:\n${state.templates.map(item => item.name).join(', ')}`, state.templates[0]?.name || ''); const template = state.templates.find(item => item.name.toLowerCase() === name?.toLowerCase()); if (!template) return; const target = remoteState.sessions.find(item => item.id === template.sessionId) || session; if (target) await createTerminal(target); for (const tunnel of template.tunnels || []) await api.sshTunnel.start(target, tunnel); switchToPanel(template.panels?.at(-1) || 'server-workspace'); }
    else if (action === 'schedule') { if (!session) return showToast('Choose a server first', 'warning'); const name = prompt('Schedule name:', 'Nightly encrypted backup'); if (!name) return; const type = prompt('Type: backup, sync or health', 'backup'); if (!type) return; const intervalHours = Number(prompt('Run every N hours:', '24')) || 24; let localPath = ''; let remotePath = ''; let direction = 'download'; if (type !== 'health') { remotePath = prompt(type === 'backup' ? 'Absolute remote file to back up:' : 'Absolute remote sync path:', session.remotePath || '/var/www/app'); if (!remotePath) return; if (type === 'sync') { localPath = prompt('Absolute local sync path:', remoteState.local?.path || ''); if (!localPath) return; direction = prompt('Direction: upload or download', 'download') || 'download'; } } await api.suite.saveItem('schedules', { name, type, intervalHours, keep: Number(prompt('Retention copies:', '14')) || 14, encrypted: type === 'backup' && confirm('Encrypt backup output with AES-256-GCM?'), sessionId: session.id, localPath, remotePath, direction }); }
    else if (action === 'plugin') { const pluginId = prompt('Plugin ID (for example com.example.preview):'); if (!pluginId) return; const name = prompt('Plugin name:', pluginId); const kind = prompt('Extension point: protocol, preview or action', 'action'); if (!kind) return; await api.suite.saveItem('plugins', { pluginId, name, kind, sdkVersion: 1, permissions: [] }); }
    else if (action === 'member') { const name = prompt('Member name:'); if (!name) return; const role = prompt('Role: owner, admin, operator or viewer', 'operator'); if (!role) return; await api.suite.saveItem('members', { name, role }); }
    else if (action === 'approval') { if (!session) return showToast('Choose a server first', 'warning'); const name = prompt('Production operation requiring approval:', 'Deploy release'); if (!name) return; await api.suite.saveItem('approvals', { name, sessionId: session.id, status: 'pending', requestedAt: new Date().toISOString() }); }
    else if (action === 'approval-review') { const state = await api.suite.state(); const pending = state.approvals.filter(item => item.status === 'pending'); const id = prompt(`Pending approval ID:\n${pending.map(item => `${item.id} · ${item.name}`).join('\n')}`, pending[0]?.id || ''); const item = pending.find(value => value.id === id); if (!item) return; item.status = confirm(`Approve “${item.name}”? Cancel will reject it.`) ? 'approved' : 'rejected'; item.reviewedAt = new Date().toISOString(); await api.suite.saveItem('approvals', item); }
    else if (action === 'handoff') { if (!session) return showToast('Choose a server first', 'warning'); const recipient = prompt('Recipient identifier:'); if (!recipient) return; const result = await api.suite.handoffCreate(session.id, recipient, 30); await navigator.clipboard.writeText(`${result.handoff.id}:${result.token}`); alert(`One-time handoff copied to clipboard. It expires at ${new Date(result.handoff.expiresAt).toLocaleString()}. No password is included.`); }
    showToast('Workspace suite updated', 'success'); await refreshWorkspaceSuite();
  } catch (error) { showToast(error.message, 'error'); }
}

async function runDevOpsAction(spec) {
  const session = workspaceSession(); if (!session) return showToast('Choose an SSH server', 'warning');
  const [kind, action] = spec.split(':'); const output = document.getElementById('workspace-diagnostics-output'); const state = document.getElementById('workspace-diagnostics-state');
  try {
    if (session.production && !['git:status', 'git:log', 'git:branches', 'git:diff', 'compose:ps', 'compose:logs', 'compose:config', 'kubernetes:contexts', 'kubernetes:pods', 'kubernetes:deployments', 'kubernetes:events', 'kubernetes:describe', 'metrics', 'alerts', 'http'].includes(spec) && !(await consumeProductionApproval(session, spec))) return;
    state.textContent = `Running ${spec}…`; let result;
    if (kind === 'git') { const repository = prompt('Absolute repository path:', session.remotePath || '/var/www/app'); if (!repository) return; if (['pull', 'push'].includes(action) && !confirm(`Run git ${action} in ${repository} on ${session.name}?`)) return; result = await api.devops.git(session, repository, action, {}); }
    else if (kind === 'compose') { const directory = prompt('Directory containing compose.yaml:', session.remotePath || '/var/www/app'); if (!directory) return; if (action === 'env') { const file = await api.files.readRemote(session, `${directory.replace(/\/$/, '')}/.env`); const content = prompt('Edit remote .env (secrets are not logged):', file.content); if (content === null) return; result = await api.files.writeRemote(session, `${directory.replace(/\/$/, '')}/.env`, content); } else { if (['up', 'down'].includes(action) && !confirm(`Run docker compose ${action} in ${directory}?`)) return; result = await api.devops.compose(session, directory, action, ''); } }
    else if (kind === 'kubernetes') { const options = {}; if (!['contexts'].includes(action)) options.namespace = prompt('Namespace (empty = current):', 'default') || ''; if (['logs', 'exec', 'describe', 'port-forward'].includes(action)) { options.pod = prompt('Pod name:'); if (!options.pod) return; } if (action === 'exec') options.command = prompt('Command:', 'sh') || 'sh'; if (action === 'port-forward') { options.localPort = Number(prompt('Local port:', '8080')); options.remotePort = Number(prompt('Pod port:', '80')); } if (action === 'copy') { options.source = prompt('Source (local path or namespace/pod:path):'); options.destination = prompt('Destination:'); if (!options.source || !options.destination) return; } result = await api.devops.kubernetes(session, action, options); }
    else if (kind === 'metrics') { result = await api.devops.metrics(session); try { const metrics = JSON.parse(result.stdout); document.getElementById('workspace-live-metrics').textContent = `Load ${metrics.load.join(' / ')} · RAM ${formatFileSize(metrics.memory.used)} / ${formatFileSize(metrics.memory.total)} · Disk ${metrics.disk.percent} · Network ↓${formatFileSize(metrics.network.rx)} ↑${formatFileSize(metrics.network.tx)} · Containers ${metrics.containers}`; } catch {} }
    else if (kind === 'alerts') { const httpsUrl = prompt('Optional HTTPS endpoint for certificate and availability check:', `https://${session.host}/`) || ''; result = await api.devops.alerts(session, { diskPercent: 85, memoryPercent: 90, load: 8, httpsUrl, certificateDays: 30 }); result = { ...result, stdout: result.alerts.length ? result.alerts.map(item => `[${item.severity.toUpperCase()}] ${item.message}`).join('\n') : 'No active threshold alerts.' }; }
    else if (kind === 'http') { const url = prompt('HTTP(S) URL:', `https://${session.host}/`); if (!url) return; const method = (prompt('Method:', 'GET') || 'GET').toUpperCase(); const body = ['GET', 'HEAD'].includes(method) ? '' : (prompt('Request body:', '') || ''); result = await api.devops.http({ url, method, body, headers: body ? { 'content-type': 'application/json' } : {} }); }
    output.textContent = result.stdout !== undefined ? `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}` : `${result.status} ${result.statusText} · ${result.durationMs} ms\n${JSON.stringify(result.headers, null, 2)}\n\n${result.body}`; state.textContent = result.success ? `${spec} · completed` : `${spec} · failed`; showToast(result.success ? 'Operation completed' : 'Operation returned an error', result.success ? 'success' : 'error');
  } catch (error) { state.textContent = `${spec} · failed`; output.textContent = error.message; showToast(error.message, 'error'); }
}

async function consumeProductionApproval(session, operation) { const state = await api.suite.state(); const approval = [...state.approvals].reverse().find(item => item.sessionId === session.id && item.status === 'approved' && !item.consumedAt); if (!approval) { showToast(`Production approval required for ${operation}. Request and approve it in Team Mode first.`, 'warning'); return false; } approval.consumedAt = new Date().toISOString(); approval.operation = operation; await api.suite.saveItem('approvals', approval); return true; }

async function inspectWorkspace(kind) {
  const session = workspaceSession(); if (!session) return showToast('Choose a server', 'warning');
  const output = document.getElementById('workspace-diagnostics-output'); const state = document.getElementById('workspace-diagnostics-state'); state.textContent = `Loading ${kind}…`;
  try { const result = await api.remote.inspect(session, kind); output.textContent = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`; state.textContent = result.success ? 'Ready' : `Exited ${result.code}`; } catch (error) { output.textContent = error.message; state.textContent = 'Failed'; }
}

async function runWorkspaceControl(kind) {
  const session = workspaceSession(); if (!session && kind !== 'wake') return showToast('Choose a server', 'warning');
  try {
    let result; let description = '';
    if (kind === 'docker') { const action = prompt('Docker action: start, stop, restart, pause, unpause or rm', 'restart'); if (!action) return; const target = prompt('Container name or ID:'); if (!target) return; description = `docker ${action} ${target}`; if (!confirm(`Run ${description} on ${session.name}?`)) return; result = await api.remote.docker(session, action, target); }
    else if (kind === 'systemd') { const action = prompt('systemd action: start, stop, restart, reload, status, enable or disable', 'restart'); if (!action) return; const unit = prompt('Unit name:', 'nginx.service'); if (!unit) return; description = `systemctl ${action} ${unit}`; if (action !== 'status' && !confirm(`Run ${description} on ${session.name}?`)) return; result = await api.remote.systemd(session, action, unit); }
    else if (kind === 'signal') { const pid = prompt('Process PID:'); if (!pid) return; const signal = prompt('Signal: TERM, KILL, HUP or INT', 'TERM'); if (!signal || !confirm(`Send ${signal} to PID ${pid} on ${session.name}?`)) return; description = `kill -${signal} ${pid}`; result = await api.remote.signal(session, Number(pid), signal.toUpperCase()); }
    else if (kind === 'archive') { const action = prompt('Archive action: tar or unpack', 'tar'); if (!action) return; const source = prompt(action === 'tar' ? 'Remote source path:' : 'Remote .tar.gz path:'); if (!source) return; const destination = prompt(action === 'tar' ? 'Destination .tar.gz path:' : 'Destination directory:'); if (!destination || !confirm(`${action} ${source} → ${destination} on ${session.name}?`)) return; description = `${action} ${source}`; result = await api.remote.archive(session, action, source, destination); }
    else if (kind === 'wake') { const mac = prompt('MAC address to wake:'); if (!mac) return; const address = prompt('Broadcast address:', '255.255.255.255'); if (address === null) return; description = `Wake ${mac}`; result = await api.remote.wake(mac, address, 9); }
    const output = document.getElementById('workspace-diagnostics-output'); output.textContent = `${result.stdout || ''}${result.stderr || ''}`.trim() || JSON.stringify(result, null, 2); document.getElementById('workspace-diagnostics-state').textContent = result.success ? `${description} · completed` : `${description} · failed`; showToast(result.success ? 'Remote operation completed' : `Operation failed (exit ${result.code})`, result.success ? 'success' : 'error');
  } catch (error) { showToast(error.message, 'error'); }
}

async function refreshRunbooks() {
  if (!api.runbook) return; const runbooks = await api.runbook.list(); const select = document.getElementById('workspace-runbook-select'); if (!select) return;
  const selected = select.value; select.innerHTML = '<option value="">Choose runbook…</option>'; for (const item of runbooks) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; option.dataset.runbook = JSON.stringify(item); select.appendChild(option); } select.value = selected;
}

function openRunbookEditor() { document.getElementById('runbook-name').value = ''; document.getElementById('runbook-parameters').value = ''; document.getElementById('runbook-steps').value = ''; document.getElementById('runbook-modal').classList.remove('hidden'); }
function closeRunbookEditor() { document.getElementById('runbook-modal').classList.add('hidden'); }
async function saveRunbookEditor() {
  const steps = document.getElementById('runbook-steps').value.split(/\r?\n/).map(line => { const [name, ...command] = line.split('::'); return { name: name.trim(), command: command.join('::').trim() }; }).filter(item => item.command);
  try { await api.runbook.save({ name: document.getElementById('runbook-name').value, parameters: document.getElementById('runbook-parameters').value.split(',').map(value => value.trim()).filter(Boolean), steps, productionApproval: document.getElementById('runbook-production').checked }); closeRunbookEditor(); await refreshRunbooks(); showToast('Runbook saved', 'success'); } catch (error) { showToast(error.message, 'error'); }
}
async function runSelectedRunbook() {
  const session = workspaceSession(); const select = document.getElementById('workspace-runbook-select'); const runbook = select.selectedOptions[0]?.dataset.runbook ? JSON.parse(select.selectedOptions[0].dataset.runbook) : null;
  if (!session || !runbook) return showToast('Choose a server and runbook', 'warning'); if (session.production && runbook.productionApproval && !confirm(`Production Guard: run “${runbook.name}” on ${session.name}?`)) return;
  const parameters = {}; for (const key of runbook.parameters || []) { const value = prompt(`Value for ${key}:`); if (value === null) return; parameters[key] = value; }
  const output = document.getElementById('workspace-diagnostics-output'); output.textContent = `Running ${runbook.name}…`;
  try { const result = await api.runbook.run(session, runbook.id, parameters); output.textContent = result.results.map(item => `=== ${item.name} (${item.code}) ===\n${item.stdout}${item.stderr}`).join('\n'); showToast(result.success ? 'Runbook completed' : 'Runbook stopped on an error', result.success ? 'success' : 'error'); } catch (error) { output.textContent = error.message; showToast(error.message, 'error'); }
}

function openDeployment() {
  const session = workspaceSession(); if (!session) return showToast('Choose a server', 'warning');
  document.getElementById('deployment-local').value = remoteState.local?.path || '';
  document.getElementById('deployment-remote').value = session.remotePath || '/var/www/app';
  document.getElementById('deployment-progress').textContent = `Ready for ${session.name}. No remote changes have been made.`;
  document.getElementById('deployment-modal').classList.remove('hidden');
}
function closeDeployment() { document.getElementById('deployment-modal').classList.add('hidden'); }
async function runDeployment() {
  const session = workspaceSession(); if (!session) return;
  const options = { localDirectory: document.getElementById('deployment-local').value.trim(), remoteDirectory: document.getElementById('deployment-remote').value.trim(), postCommand: document.getElementById('deployment-post').value.trim(), healthCommand: document.getElementById('deployment-health').value.trim() };
  if (!options.localDirectory || !options.remoteDirectory) return showToast('Local source and remote target are required', 'warning');
  const gate = await api.advanced.maintenanceCheck(session.id, 'deploy');
  if (!gate.allowed) return showToast(gate.reason, 'warning');
  const preflight = await api.advanced.preflight(session, { target: options.remoteDirectory });
  if (!preflight.success) { document.getElementById('deployment-progress').textContent = `Deployment blocked by preflight:\n${preflight.checks.filter(item => !item.success).map(item => `✕ ${item.name}: ${item.detail}`).join('\n')}`; return showToast('Deployment preflight failed', 'error'); }
  if (session.production && !(await consumeProductionApproval(session, 'atomic-deploy'))) return;
  if (!confirm(`Deploy ${options.localDirectory} to ${session.name}:${options.remoteDirectory}? A backup will be created and existing files will be replaced.${session.production ? ' Production Guard is enabled.' : ''}`)) return;
  const button = document.getElementById('deployment-run'); button.disabled = true; document.getElementById('deployment-progress').textContent = 'Starting deployment…';
  try { await api.advanced.timelineRecord({ sessionId: session.id, type: 'deployment', status: 'started', message: `${options.localDirectory} → ${options.remoteDirectory}` }); const result = await api.remote.deploy(session, options); await api.advanced.timelineRecord({ sessionId: session.id, type: 'deployment', status: result.success ? 'completed' : 'failed', message: result.success ? `Activated ${result.releaseId}` : result.error, metadata: { releaseId: result.releaseId, backup: result.backup, rolledBack: result.rolledBack } }); document.getElementById('deployment-progress').textContent += result.success ? `\n✓ Active release ${result.releaseId}\nBackup: ${result.backup}` : `\n✕ ${result.error}${result.rolledBack ? '\n✓ Previous release restored' : ''}${result.rollbackError ? `\nROLLBACK FAILED: ${result.rollbackError}` : ''}`; showToast(result.success ? 'Deployment completed' : result.rolledBack ? 'Deployment failed; rollback completed' : 'Deployment failed', result.success ? 'success' : 'error'); }
  catch (error) { await api.advanced.timelineRecord({ sessionId: session.id, type: 'deployment', status: 'failed', message: error.message }); document.getElementById('deployment-progress').textContent += `\n✕ ${error.message}`; showToast(error.message, 'error'); }
  finally { button.disabled = false; }
}

function workspaceSession() { return remoteState.sessions.find(item => item.id === document.getElementById('workspace-server-select')?.value) || null; }

async function refreshPortableTools() {
  if (!api.portable) return; const target = document.getElementById('workspace-portable-tools'); if (!target) return;
  try { const tools = await api.portable.list(); target.innerHTML = tools.map(tool => `<span class="platform-chip ${tool.available && tool.verified ? 'available' : ''}" title="${escapeHtml(tool.license)}">${escapeHtml(tool.name)} ${escapeHtml(tool.version)} ${tool.available && tool.verified ? '✓' : '✕'}</span>`).join(' '); } catch (error) { target.textContent = error.message; }
}

async function mountWorkspaceSftp() {
  const session = workspaceSession(); if (!session) return; const drive = prompt('Unused Windows drive letter:', 'K:'); if (!drive) return;
  try { const mount = await api.remote.mountSftp(session, drive); showToast(`${mount.sessionName} mounted as ${mount.drive}`, 'success'); await refreshServerWorkspace(); } catch (error) { showToast(error.message, 'error'); }
}

async function refreshServerWorkspace() {
  if (!api.remote) return;
  if (!remoteState.sessions.length) await loadRemoteSessions();
  const select = document.getElementById('workspace-server-select'); if (!select) return;
  const selected = select.value; select.innerHTML = '<option value="">Choose server…</option>';
  for (const session of remoteState.sessions) { const option = document.createElement('option'); option.value = session.id; option.textContent = `${session.favorite ? '★ ' : ''}${session.name} · ${session.host}`; select.appendChild(option); }
  select.value = selected || remoteState.active?.id || '';
  const session = workspaceSession();
  document.getElementById('workspace-server-state').textContent = session ? `${session.production ? 'PRODUCTION GUARD · ' : ''}${session.type.toUpperCase()} SESSION` : 'NO SERVER SELECTED';
  document.getElementById('workspace-server-name').textContent = session?.name || 'Choose a saved remote session';
  document.getElementById('workspace-server-address').textContent = session ? `${session.username ? `${session.username}@` : ''}${session.host}:${session.port}` : 'Create one profile and reuse its encrypted credentials everywhere.';
  document.getElementById('workspace-security').textContent = session?.hostFingerprint ? `Pinned key: ${session.hostFingerprint}` : 'SSH host key will be pinned on the first successful connection.';
  const tunnels = await api.sshTunnel.list(); const matching = session ? tunnels.filter(item => item.sessionId === session.id) : []; const mounts = await api.remote.listMounts(); const matchingMounts = session ? mounts.filter(item => item.sessionId === session.id) : [];
  const tunnelTarget = document.getElementById('workspace-tunnels'); tunnelTarget.innerHTML = [...matching.map(item => `<div>${escapeHtml(item.localHost)}:${item.localPort} → ${escapeHtml(item.remoteHost)}:${item.remotePort}</div>`), ...matchingMounts.map(item => `<div>Drive ${escapeHtml(item.drive)} → ${escapeHtml(item.remotePath)} <button class="btn btn-small workspace-unmount" data-id="${escapeHtml(item.id)}">Unmount</button></div>`)].join('') || 'No active tunnels or mounts for this server.'; tunnelTarget.querySelectorAll('.workspace-unmount').forEach(button => button.addEventListener('click', async () => { await api.remote.unmountSftp(button.dataset.id); await refreshServerWorkspace(); }));
  for (const id of ['workspace-open-terminal', 'workspace-open-putty', 'workspace-open-files', 'workspace-open-winscp', 'workspace-mount-sftp', 'workspace-open-rdp', 'workspace-open-vnc', 'workspace-deploy', 'workspace-run-diagnostics']) document.getElementById(id).disabled = !session;
  if (session) { document.getElementById('workspace-open-terminal').disabled = !['ssh', 'sftp', 'telnet', 'serial'].includes(session.type); document.getElementById('workspace-open-putty').disabled = !['ssh', 'sftp'].includes(session.type); document.getElementById('workspace-open-files').disabled = !['ssh', 'sftp'].includes(session.type); document.getElementById('workspace-open-winscp').disabled = !['ssh', 'sftp'].includes(session.type); document.getElementById('workspace-mount-sftp').disabled = !['ssh', 'sftp'].includes(session.type); document.getElementById('workspace-deploy').disabled = !['ssh', 'sftp'].includes(session.type); document.getElementById('workspace-run-diagnostics').disabled = !['ssh', 'sftp'].includes(session.type); }
}

async function runWorkspaceDiagnostics() {
  const session = workspaceSession(); if (!session) return;
  const state = document.getElementById('workspace-diagnostics-state'); const output = document.getElementById('workspace-diagnostics-output');
  state.textContent = 'Collecting…'; output.textContent = `Connecting securely to ${session.host}…`;
  try { const result = await api.remote.diagnose(session); output.textContent = `=== CONNECTION PATH ===\nDNS ${result.diagnostics.dns.durationMs} ms · ${result.diagnostics.dns.addresses.join(', ')}\nSSH ${result.diagnostics.ssh.durationMs} ms · port ${result.diagnostics.ssh.port} · host key ${result.diagnostics.ssh.hostKeyPinned ? 'pinned' : 'TOFU captured'}\nAuthentication: ${result.diagnostics.authentication.method}\n\n${result.stdout || ''}${result.stderr ? `\n=== STDERR ===\n${result.stderr}` : ''}`.trim(); state.textContent = `Collected ${new Date().toLocaleTimeString()}`; }
  catch (error) { output.textContent = error.message; state.textContent = 'Failed'; showToast(error.message, 'error'); }
}

/* ===== Built-in Terminal ===== */
const terminalState = { tabs: [], activeId: null, instances: {}, fitAddons: {}, searchAddons: {}, kittyRenderers: {}, observers: {}, reconnecting: new Set(), recording: new Set(), splitIds: new Set(), splitVertical: false, broadcast: false, structuredBuffers: {}, structuredTimers: {} };

/* ANSI escape code parser for terminal colors */
const ANSI_COLORS = {
  30: '#4e4e4e', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b', 34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#dcdfe4',
  90: '#5c6370', 91: '#e06c75', 92: '#98c379', 93: '#e5c07b', 94: '#61afef', 95: '#c678dd', 96: '#56b6c2', 97: '#ffffff'
};
const ANSI_BG_COLORS = {
  40: '#4e4e4e', 41: '#e06c75', 42: '#98c379', 43: '#e5c07b', 44: '#61afef', 45: '#c678dd', 46: '#56b6c2', 47: '#dcdfe4',
  100: '#5c6370', 101: '#e06c75', 102: '#98c379', 103: '#e5c07b', 104: '#61afef', 105: '#c678dd', 106: '#56b6c2', 107: '#ffffff'
};

function parseAnsi(text) {
  const fragment = document.createDocumentFragment();
  // Match ANSI escape sequences
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentSpan = null;
  let bold = false, fg = null, bg = null;

  let match;
  while ((match = regex.exec(text)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const textNode = document.createTextNode(text.slice(lastIndex, match.index));
      if (currentSpan) currentSpan.appendChild(textNode);
      else fragment.appendChild(textNode);
    }

    // Parse SGR parameters
    const codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (const code of codes) {
      if (code === 0) { bold = false; fg = null; bg = null; currentSpan = null; }
      else if (code === 1) bold = true;
      else if (ANSI_COLORS[code]) fg = ANSI_COLORS[code];
      else if (ANSI_BG_COLORS[code]) bg = ANSI_BG_COLORS[code];
    }

    if (fg || bg || bold) {
      currentSpan = document.createElement('span');
      let style = '';
      if (fg) style += `color:${fg};`;
      if (bg) style += `background:${bg};`;
      if (bold) style += 'font-weight:bold;';
      currentSpan.setAttribute('style', style);
      fragment.appendChild(currentSpan);
    } else {
      currentSpan = null;
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining text
  if (lastIndex < text.length) {
    const textNode = document.createTextNode(text.slice(lastIndex));
    if (currentSpan) currentSpan.appendChild(textNode);
    else fragment.appendChild(textNode);
  }
  return fragment;
}

function initTerminal() {
  document.getElementById('btn-terminal-command-deck')?.addEventListener('click', () => { switchToPanel('operations-center'); selectVisionTab('intelligence'); document.querySelector('.tf-deck')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  void loadLocalShellProfiles();
  document.getElementById('btn-new-terminal')?.addEventListener('click', () => createTerminal({ localProfile: document.getElementById('terminal-local-profile')?.value || '' }));
  document.getElementById('btn-terminal-clear')?.addEventListener('click', () => {
    terminalState.instances[terminalState.activeId]?.clear();
  });
  document.getElementById('btn-terminal-bottom')?.addEventListener('click', () => {
    terminalState.instances[terminalState.activeId]?.scrollToBottom();
  });
  document.getElementById('btn-terminal-search')?.addEventListener('click', () => {
    if (!terminalState.activeId) return;
    const query = prompt('Find in terminal:'); if (query) terminalState.searchAddons[terminalState.activeId]?.findNext(query, { incremental: true, caseSensitive: false });
  });
  document.getElementById('btn-terminal-split')?.addEventListener('click', toggleTerminalSplit);
  document.getElementById('btn-terminal-layout')?.addEventListener('click', () => { terminalState.splitVertical = !terminalState.splitVertical; renderTerminalLayout(); });
  document.getElementById('btn-terminal-broadcast')?.addEventListener('click', toggleTerminalBroadcast);
  document.getElementById('btn-terminal-record')?.addEventListener('click', toggleTerminalRecording);
  document.getElementById('btn-terminal-export')?.addEventListener('click', exportTerminalRecording);
  renderTerminalMacros();
  document.getElementById('btn-terminal-macro-add')?.addEventListener('click', () => {
    const name = prompt('Macro name:'); if (!name) return; const command = prompt('Command to run:'); if (!command) return;
    const macros = terminalMacros(); macros.push({ id: `${Date.now()}`, name: name.slice(0, 80), command: command.slice(0, 4000) }); localStorage.setItem('kitsune-terminal-macros', JSON.stringify(macros)); renderTerminalMacros();
  });
  document.getElementById('btn-terminal-macro-run')?.addEventListener('click', () => {
    const macro = terminalMacros().find(item => item.id === document.getElementById('terminal-macro-select').value);
    if (!macro || !terminalState.activeId) return showToast('Choose a macro and an active terminal', 'warning');
    if (isDangerousProductionCommand(macro.command) && !confirm(`Production Guard: run potentially destructive command?\n\n${macro.command}`)) return;
    writeTerminalInput(terminalState.activeId, `${macro.command}\r`);
  });

  // Listen for terminal data from backend
  api.terminal.onData(({ id, data }) => {
    const renderedData = terminalState.kittyRenderers[id]?.consume(data) ?? data;
    terminalState.instances[id]?.write(renderedData);
    terminalState.structuredBuffers[id] = `${terminalState.structuredBuffers[id] || ''}${data}`.slice(-2_000_000);
    if (data.includes('\x1b]7;file://') && api.terminalFilePro?.splitContext) { const tab = terminalState.tabs.find(item => item.id === id); if (tab?.remote && tab.connection?.id) api.terminalFilePro.splitContext({ terminalId: id, sessionId: tab.connection.id, osc7: data }).then(result => { tab.cwd = result.context.cwd; }).catch(() => {}); }
    if (data.includes('\x1b]133;') && api.nextgen?.shellParse) { clearTimeout(terminalState.structuredTimers[id]); terminalState.structuredTimers[id] = setTimeout(async () => { try { const parsed = await api.nextgen.shellParse(terminalState.structuredBuffers[id]); const tab = terminalState.tabs.find(item => item.id === id); if (tab) { const completed = parsed.blocks.filter(block => block.exitCode !== null); const fresh = completed.slice(tab.structuredRecordedCount || 0); tab.structuredBlocks = parsed.blocks; tab.structuredRecordedCount = completed.length; if (tab.remote && tab.connection?.id && api.opsWorkspace?.timelineRecord) for (const block of fresh) { const command = String(block.command || '').trim(); const effects = []; if (/\bsystemctl\s+(restart|start|stop|reload)\s+/i.test(command)) effects.push({ kind: 'service-state', operation: command.match(/\bsystemctl\s+(restart|start|stop|reload)/i)?.[1] }); if (/\b(mv|cp|rm|chmod|chown|sed|tee)\b/i.test(command)) effects.push({ kind: 'filesystem-change', reviewRequired: true }); api.opsWorkspace.timelineRecord({ sessionId: tab.connection.id, command, result: { success: block.success, code: block.exitCode }, effects, actor: 'local-owner' }).catch(() => {}); } } } catch {} }, 120); }
    if (operationsState.collaboration?.kind === 'terminal' && operationsState.collaboration.resourceId === id) api.collaboration.event(operationsState.collaboration.id, 'owner', { kind: 'terminal-output', data }).catch(() => {});
  });

  api.terminal.onExit(({ id, code }) => {
    terminalState.instances[id]?.writeln(`\r\n\x1b[90m[KitsuneServ: terminal exited with code ${code}]\x1b[0m`);
    const tab = terminalState.tabs.find(t => t.id === id);
    if (tab) {
      tab.dead = true;
      if (tab.remote && tab.autoReconnect && !terminalState.reconnecting.has(id)) scheduleTerminalReconnect(tab);
    }
    renderTerminalTabs();
  });
}

async function loadLocalShellProfiles() {
  if (!api.terminal.profiles) return;
  try {
    const profiles = await api.terminal.profiles(); const select = document.getElementById('terminal-local-profile'); if (!select) return;
    select.innerHTML = '<option value="">Default shell</option>';
    for (const profile of profiles) { const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; select.appendChild(option); }
  } catch {}
}

function isDangerousProductionCommand(command) { return /(^|[;&|]\s*)(rm\s+-rf|del\s+\/[^\n]*[sq]|format\s+|mkfs\b|shutdown\b|reboot\b|DROP\s+(DATABASE|TABLE)|TRUNCATE\s+TABLE)/i.test(command); }

function terminalMacros() {
  try { const value = JSON.parse(localStorage.getItem('kitsune-terminal-macros') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; }
}

function renderTerminalMacros() {
  const select = document.getElementById('terminal-macro-select'); if (!select) return;
  const selected = select.value; select.innerHTML = '<option value="">Command macros…</option>';
  for (const macro of terminalMacros()) { const option = document.createElement('option'); option.value = macro.id; option.textContent = macro.name; option.title = macro.command; select.appendChild(option); }
  select.value = selected;
}

async function toggleTerminalRecording() {
  const id = terminalState.activeId; if (!id) return showToast('Open a terminal first', 'warning'); const button = document.getElementById('btn-terminal-record');
  try { if (terminalState.recording.has(id)) { await api.terminal.recordStop(id); terminalState.recording.delete(id); button.textContent = '● Record'; showToast('Recording saved; export it as text, HTML or asciinema', 'success'); } else { const tab = terminalState.tabs.find(item => item.id === id); await api.terminal.recordStart(id, { name: tab?.name, remote: tab?.remote }); terminalState.recording.add(id); button.textContent = '■ Stop'; showToast('Terminal recording started', 'success'); } } catch (error) { showToast(error.message, 'error'); }
}

async function exportTerminalRecording() {
  const recordings = await api.terminal.recordList(); if (!recordings.length) return showToast('No completed recordings', 'warning'); const latest = recordings.sort((a, b) => b.startedAt - a.startedAt)[0]; const format = (prompt('Export format: text, html or asciinema', 'asciinema') || '').toLowerCase(); if (!['text', 'html', 'asciinema'].includes(format)) return; const result = await api.terminal.recordExport(latest.id, format); if (result.success) showToast(`Recording exported to ${result.filePath}`, 'success');
}

async function createTerminal(connection = null) {
  // Limit max terminals
  const MAX_TERMINALS = 12;
  if (terminalState.tabs.filter(t => !t.dead).length >= MAX_TERMINALS) {
    showToast(`Maximum ${MAX_TERMINALS} terminals allowed. Close one first.`, 'error');
    return;
  }
  let result;
  try {
    result = await api.terminal.create(connection);
  } catch (error) {
    showToast(error.message, 'error');
    return;
  }
  if (!result?.id) {
    if (result?.error) showToast(result.error, 'error');
    else if (result?.success === false) showToast(result.error || 'Could not start terminal', 'error');
    else showToast('Could not start terminal', 'error');
    return;
  }
  const id = result.id;
  const savedSession = result.sessionId ? remoteState.sessions.find(item => item.id === result.sessionId) : null;
  terminalState.tabs.push({ id, name: result.name || `Local ${id}`, dead: false, remote: Boolean(result.remote), connection: result.remote ? (savedSession || connection) : null, autoReconnect: Boolean(result.remote), production: Boolean(savedSession?.production || savedSession?.group?.toLowerCase().includes('production')) });
  terminalState.activeId = id;

  // Create DOM for this terminal
  const container = document.getElementById('terminal-container');
  const empty = document.getElementById('terminal-empty');
  if (empty) empty.classList.add('hidden');

  const pane = document.createElement('div');
  pane.className = 'terminal-pane active';
  pane.id = 'terminal-pane-' + id;
  pane.innerHTML = `<div class="terminal-xterm" id="terminal-output-${id}"></div>`;
  container.appendChild(pane);

  if (!terminalState.splitIds.size) container.querySelectorAll('.terminal-pane').forEach(p => { if (p.id !== pane.id) p.classList.remove('active'); });

  if (typeof Terminal === 'undefined') { pane.innerHTML = '<div class="terminal-empty">xterm.js could not be loaded.</div>'; return; }
  const term = new Terminal({ cursorBlink: true, cursorStyle: 'bar', convertEol: false, scrollback: 12000, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13, lineHeight: 1.2, linkHandler: { activate: (_event, uri) => { if (/^https?:\/\//i.test(uri) && confirm(`Open terminal link in the browser?\n\n${uri}`)) api.shell.openExternal(uri); }, hover: () => {}, leave: () => {} }, theme: { background: '#0d0d14', foreground: '#d7dae0', cursor: '#7f8cff', selectionBackground: '#5964c866', black: '#181820', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#dcdfe4' } });
  const fit = new FitAddon.FitAddon(); const search = new SearchAddon.SearchAddon(); term.loadAddon(fit); term.loadAddon(search); if (typeof ImageAddon !== 'undefined') term.loadAddon(new ImageAddon.ImageAddon({ enableSizeReports: true, pixelLimit: 4_194_304, sixelSupport: true, sixelSizeLimit: 2_097_152, iipSupport: true, iipSizeLimit: 2_097_152, storageLimit: 32, showPlaceholder: true })); term.open(pane.firstElementChild);
  if (typeof KittyGraphicsRenderer !== 'undefined') terminalState.kittyRenderers[id] = new KittyGraphicsRenderer(pane, { maxImageBytes: 2_097_152, maxStorageBytes: 33_554_432 });
  term.parser.registerOscHandler(52, data => { api.terminalFileDeep?.execute('modern-terminal-media', { action: 'parse', data: `\x1b]52;${data}\x07`, clipboardApproved: false }).then(parsed => { const item = parsed.clipboard?.[0]; if (!item || item.bytes > 2 * 1024 * 1024 || !confirm(`Remote terminal requests clipboard access (${formatBytes(item.bytes)}). Allow once?`)) return; return api.terminalFileDeep.execute('modern-terminal-media', { action: 'parse', data: `\x1b]52;${data}\x07`, clipboardApproved: true }).then(approved => api.fabric.clipboardWrite(approved.clipboard[0].value, { ttlSeconds: 60, sessionId: savedSession?.id || '', allowSecrets: false })); }).catch(error => showToast(`Clipboard request blocked: ${error.message}`, 'warning')); return true; });
  terminalState.instances[id] = term; terminalState.fitAddons[id] = fit; terminalState.searchAddons[id] = search;
  term.onData(async data => {
    const tab = terminalState.tabs.find(item => item.id === id);
    if (api.terminalFilePro?.pasteAnalyze && !data.startsWith('\x1b') && (data.includes('\n') || data.includes('\r') || data.length >= 8)) { const analysis = await api.terminalFilePro.pasteAnalyze(data); if (analysis.requiresConfirmation && !confirm(`Secure Paste Firewall · risk ${analysis.risk}/100\n\n${analysis.findings.map(item => item.kind).join(', ') || 'Review requested'}\n\nSend this input to ${tab?.name || 'terminal'}?`)) return; }
    if (tab?.production && data.length > 3 && isDangerousProductionCommand(data) && !confirm(`Production Guard: paste potentially destructive command?\n\n${data.trim()}`)) return;
    writeTerminalInput(id, data);
    if (operationsState.collaboration?.kind === 'terminal' && operationsState.collaboration.resourceId === id) api.collaboration.event(operationsState.collaboration.id, 'owner', { kind: 'terminal-input', data }).catch(() => {});
  });
  term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows));
  const observer = new ResizeObserver(() => { if (pane.classList.contains('active')) { try { fit.fit(); } catch {} } }); observer.observe(pane); terminalState.observers[id] = observer;
  requestAnimationFrame(() => { fit.fit(); term.focus(); });

  renderTerminalTabs();
  renderTerminalLayout();
  updateTerminalLatestButton();
}

async function scheduleTerminalReconnect(tab) {
  terminalState.reconnecting.add(tab.id); terminalState.instances[tab.id]?.writeln('\r\n\x1b[33mReconnecting in 3 seconds…\x1b[0m');
  setTimeout(async () => {
    terminalState.reconnecting.delete(tab.id);
    if (!terminalState.tabs.includes(tab)) return;
    closeTerminal(tab.id, false);
    await createTerminal(tab.connection);
  }, 3000);
}

function renderTerminalTabs() {
  const tabsEl = document.getElementById('terminal-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = '';

  for (const tab of terminalState.tabs) {
    const el = document.createElement('div');
    el.className = 'terminal-tab' + (tab.id === terminalState.activeId ? ' active' : '');
    el.innerHTML = `
      <span>💻 ${escapeHtml(tab.name)}${tab.dead ? ' (closed)' : ''}</span>
      <button class="terminal-tab-close" title="Close">&times;</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.terminal-tab-close')) return;
      switchTerminal(tab.id);
    });
    el.querySelector('.terminal-tab-close').addEventListener('click', () => closeTerminal(tab.id));
    tabsEl.appendChild(el);
  }
}

function switchTerminal(id) {
  terminalState.activeId = id;
  renderTerminalLayout();
  requestAnimationFrame(() => { try { terminalState.fitAddons[id]?.fit(); terminalState.instances[id]?.focus(); } catch {} });
  renderTerminalTabs();
  updateTerminalLatestButton();
}

function updateTerminalLatestButton() {
  const button = document.getElementById('btn-terminal-bottom');
  if (!button) return;
  button.classList.toggle('hidden', !terminalState.activeId);
}

function writeTerminalInput(sourceId, data) {
  const targets = terminalState.broadcast && terminalState.splitIds.size > 1 ? [...terminalState.splitIds] : [sourceId];
  for (const id of targets) if (!terminalState.tabs.find(tab => tab.id === id)?.dead) api.terminal.write(id, data);
}

function toggleTerminalSplit() {
  const id = terminalState.activeId; if (!id) return showToast('Open a terminal first', 'warning');
  if (terminalState.splitIds.has(id)) terminalState.splitIds.delete(id); else if (terminalState.splitIds.size < 4) terminalState.splitIds.add(id); else return showToast('Split view supports up to four panes', 'warning');
  if (terminalState.splitIds.size < 2) terminalState.broadcast = false;
  renderTerminalLayout(); renderTerminalTabs();
}

function toggleTerminalBroadcast() {
  if (terminalState.splitIds.size < 2) return showToast('Pin at least two terminals to split view first', 'warning');
  const production = [...terminalState.splitIds].some(id => terminalState.tabs.find(tab => tab.id === id)?.production);
  if (!terminalState.broadcast && production && !confirm('Production Guard: enable broadcast input to split terminals including production?')) return;
  terminalState.broadcast = !terminalState.broadcast; renderTerminalLayout();
}

function renderTerminalLayout() {
  const container = document.getElementById('terminal-container'); if (!container) return;
  const split = terminalState.splitIds.size >= 2; container.classList.toggle('split', split); container.classList.toggle('vertical', split && terminalState.splitVertical);
  container.querySelectorAll('.terminal-pane').forEach(pane => { const id = Number(pane.id.replace('terminal-pane-', '')); const visible = split ? terminalState.splitIds.has(id) : id === terminalState.activeId; pane.classList.toggle('active', visible); pane.classList.toggle('focused', visible && id === terminalState.activeId); if (visible) requestAnimationFrame(() => { try { terminalState.fitAddons[id]?.fit(); } catch {} }); });
  const splitButton = document.getElementById('btn-terminal-split'); if (splitButton) { splitButton.classList.toggle('active', terminalState.splitIds.has(terminalState.activeId)); splitButton.textContent = terminalState.splitIds.has(terminalState.activeId) ? '▣ Unpin split' : '▦ Pin split'; }
  const broadcast = document.getElementById('btn-terminal-broadcast'); if (broadcast) { broadcast.classList.toggle('active', terminalState.broadcast); broadcast.textContent = terminalState.broadcast ? '● Broadcasting' : '⌁ Broadcast'; }
}

function closeTerminal(id, kill = true) {
  if (kill) api.terminal.kill(id);
  const pane = document.getElementById('terminal-pane-' + id);
  if (pane) pane.remove();
  terminalState.tabs = terminalState.tabs.filter(t => t.id !== id);
  terminalState.splitIds.delete(id); if (terminalState.splitIds.size < 2) terminalState.broadcast = false;
  terminalState.observers[id]?.disconnect(); terminalState.instances[id]?.dispose(); terminalState.kittyRenderers[id]?.dispose();
  delete terminalState.observers[id]; delete terminalState.instances[id]; delete terminalState.fitAddons[id]; delete terminalState.searchAddons[id]; delete terminalState.kittyRenderers[id];

  if (terminalState.activeId === id) {
    terminalState.activeId = terminalState.tabs.length ? terminalState.tabs[terminalState.tabs.length - 1].id : null;
  }

  if (terminalState.activeId) {
    switchTerminal(terminalState.activeId);
  } else {
    const empty = document.getElementById('terminal-empty');
    if (empty) empty.classList.remove('hidden');
  }
  renderTerminalTabs();
  updateTerminalLatestButton();
}

/* ===== Composer ===== */
async function initComposer() {
  const statusEl = document.getElementById('composer-status');
  const installBtn = document.getElementById('btn-install-composer');
  const runBtn = document.getElementById('btn-composer-run');
  const outputEl = document.getElementById('composer-output');
  const cwdInput = document.getElementById('composer-cwd');
  const customInput = document.getElementById('composer-custom-input');
  const cwdBtn = document.getElementById('btn-composer-cwd');
  if (!statusEl) return;

  async function refreshStatus() {
    const st = await api.composer.getStatus();
    if (!st.phpAvailable) {
      statusEl.textContent = '⚠️ PHP not installed';
      statusEl.className = 'composer-status status-error';
      installBtn.classList.add('hidden');
    } else if (st.installed) {
      statusEl.textContent = `✅ Composer ${st.version || ''} installed${st.managed ? ' · managed' : ''}`.replace(/\s+/g, ' ').trim();
      statusEl.className = 'composer-status status-ok';
      installBtn.classList.add('hidden');
    } else {
      statusEl.textContent = '❌ Not installed';
      statusEl.className = 'composer-status status-missing';
      installBtn.classList.remove('hidden');
    }
  }

  installBtn?.addEventListener('click', async () => {
    installBtn.disabled = true;
    statusEl.textContent = '⏳ Installing Composer...';
    const result = await api.composer.install();
    if (result.success) {
      showToast('Composer installed successfully', 'success');
    } else {
      showToast('Failed to install Composer: ' + result.error, 'error');
    }
    installBtn.disabled = false;
    refreshStatus();
  });

  cwdBtn?.addEventListener('click', async () => {
    const result = await api.shell.openPath('.');
    // Use a simple prompt-style approach: user pastes a path
  });

  // Quick action buttons
  document.querySelectorAll('.composer-cmd-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'require') {
        customInput.value = 'require ';
        customInput.focus();
        return;
      }
      outputEl.textContent = `Running: composer ${cmd}...\n`;
      const result = await api.composer.run(cmd, cwdInput.value);
      outputEl.textContent += result.output || '(no output)';
      if (!result.success) outputEl.textContent += '\n[FAILED]';
    });
  });

  runBtn?.addEventListener('click', async () => {
    const cmd = customInput.value.trim();
    if (!cmd) return;
    outputEl.textContent = `Running: composer ${cmd}...\n`;
    const result = await api.composer.run(cmd, cwdInput.value);
    outputEl.textContent += result.output || '(no output)';
    if (!result.success) outputEl.textContent += '\n[FAILED]';
  });

  customInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runBtn?.click();
  });

  refreshStatus();
}

/* ===== PATH Management ===== */
let pathStatus = null;
let pathUpdateInProgress = false;

async function initPathManagement() {
  const list = document.getElementById('path-service-list');
  if (!list) return;

  await refreshPathManagement();

  list.addEventListener('change', async (event) => {
    if (!event.target.matches('input[data-path-service]') || pathUpdateInProgress) return;
    const selected = [...list.querySelectorAll('input[data-path-service]:checked')].map(input => input.dataset.pathService);
    await applyPathSelection(selected, 'System PATH selection updated');
  });

  document.getElementById('btn-path-add-all')?.addEventListener('click', () => {
    applyPathSelection(PATH_SECTIONS, 'All services and developer tools selected for system PATH');
  });
  document.getElementById('btn-path-remove-all')?.addEventListener('click', () => {
    applyPathSelection([], 'All KitsuneServ entries removed from system PATH');
  });
  document.getElementById('btn-python-alias-settings')?.addEventListener('click', async () => {
    const result = await api.shell.openSystemSettings('appExecutionAliases');
    if (!result?.success) showToast(result?.error || 'Could not open Windows Settings', 'error');
    else showToast(result.message || 'Windows Apps settings opened', 'warning');
  });
  document.getElementById('btn-python-alias-recheck')?.addEventListener('click', refreshPathManagement);
  document.getElementById('btn-install-python-manager')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.classList.add('is-busy');
    button.textContent = 'Installing official manager…';
    showToast('Installing Python Install Manager from python.org…', 'warning');
    try {
      const result = await api.path.installPythonManager();
      if (!result?.success) throw new Error(result?.error || 'Python Install Manager installation failed');
      showToast(result.alreadyInstalled ? 'Official Python Manager is already installed' : 'Official Python Manager installed and linked to KitsuneServ runtimes', 'success');
      await refreshPathManagement();
    } catch (err) {
      showToast(err.message || 'Python Install Manager installation failed', 'error');
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
      button.textContent = original;
    }
  });

  // Config import/export
  document.getElementById('btn-config-export')?.addEventListener('click', async () => {
    const result = await api.config.exportConfig();
    if (result.success) showToast('Config exported', 'success');
  });
  document.getElementById('btn-config-import')?.addEventListener('click', async () => {
    const result = await api.config.importConfig();
    if (result.success) {
      config = result.config;
      populateUI();
      await refreshPathManagement();
      showToast('Config imported successfully', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  });
}

async function applyPathSelection(selected, successMessage) {
  if (pathUpdateInProgress) return;
  pathUpdateInProgress = true;
  setPathControlsDisabled(true);
  const summary = document.getElementById('path-summary');
  if (summary) summary.innerHTML = `<span class="inline-spinner"></span> Updating ${runtimePlatform === 'win32' ? 'Windows user PATH' : 'shell PATH'}…`;
  document.querySelector('.path-management')?.classList.add('is-busy');
  try {
    const result = await api.path.apply(selected);
    if (!result.success) throw new Error(result.error || 'Failed to update PATH');
    config.general = { ...(config.general || {}), pathServices: [...selected], pathSelectionInitialized: true };
    await refreshPathManagement();
    const pending = result.pending?.length ? ` (${result.pending.length} waiting for installation)` : '';
    showToast(`${successMessage}${pending}`, 'success');
    if (result.warning) showToast(result.warning, 'error');
  } catch (err) {
    showToast(err.message || 'Failed to update PATH', 'error');
    await refreshPathManagement();
  } finally {
    pathUpdateInProgress = false;
    setPathControlsDisabled(false);
    document.querySelector('.path-management')?.classList.remove('is-busy');
  }
}

async function refreshPathManagement() {
  if (!document.getElementById('path-service-list')) return;
  try {
    pathStatus = await api.path.getStatus();
    updatePathUI(pathStatus);
  } catch (err) {
    const summary = document.getElementById('path-summary');
    if (summary) summary.textContent = `PATH unavailable: ${err.message}`;
  }
}

function setPathControlsDisabled(disabled) {
  document.querySelectorAll('#path-management button, .path-management button, #path-service-list input').forEach(control => {
    control.disabled = disabled;
  });
}

function updatePathUI(st) {
  const list = document.getElementById('path-service-list');
  const entries = document.getElementById('path-entries');
  const summary = document.getElementById('path-summary');
  const pythonLauncher = document.getElementById('python-launcher-status');
  const pythonLauncherDetail = document.getElementById('python-launcher-detail');
  const pythonAliasWarning = document.getElementById('python-alias-warning');
  const pythonManagerButton = document.getElementById('btn-install-python-manager');
  if (!list) return;

  const services = Array.isArray(st.services) ? st.services : [];
  list.innerHTML = services.map(service => {
    const state = service.pathAvailable ? 'ready' : 'pending';
    const stateLabel = service.pathAvailable ? 'ready' : (service.installed ? 'no binary path' : 'not installed');
    return `<label class="path-service-item">
      <input type="checkbox" data-path-service="${escapeHtml(service.id)}" ${service.selected ? 'checked' : ''}>
      <span class="path-service-info">
        <span class="path-service-name">${escapeHtml(sectionLabel(service.id))}</span>
        <span class="path-service-version">Active: ${escapeHtml(service.version || 'not configured')}</span>
      </span>
      <span class="path-service-state ${state}">${stateLabel}</span>
    </label>`;
  }).join('');
  if (st.integrationDisabled) {
    document.querySelectorAll('.path-management button, #path-service-list input').forEach(control => { control.disabled = true; });
  }

  if (summary) {
    const selectedCount = st.selected?.length || 0;
    const syncState = st.synced === false ? ' · needs sync' : '';
    summary.textContent = st.integrationDisabled
      ? 'System integration disabled (container mode); built-in terminal PATH remains active'
      : `${selectedCount} of ${services.length} selected${syncState}`;
  }

  if (entries) {
    if (st.entries?.length) {
      entries.innerHTML = `<div class="path-entry"><strong>Active PATH entries:</strong></div>${st.entries.map(e => `<div class="path-entry">${escapeHtml(e)}</div>`).join('')}`;
    } else {
      entries.innerHTML = '<div class="path-entry">No installed binaries selected for the system PATH.</div>';
    }
  }

  const isWindows = runtimePlatform === 'win32';
  const pythonSelected = isWindows && Boolean(st.python?.selected);
  pythonLauncher?.classList.toggle('hidden', !pythonSelected || !st.python?.launcherAvailable);
  if (pythonLauncherDetail) {
    pythonLauncherDetail.textContent = st.python?.launcherAvailable
      ? st.python.managerInstalled
        ? `Official Python Install Manager → KitsuneServ Python ${st.python.version} (${st.python.defaultTag})`
        : `Fallback py → Python ${st.python.version} (${st.python.launcherPath})`
      : '';
  }
  if (pythonManagerButton) {
    pythonManagerButton.classList.toggle('hidden', !isWindows || !pythonSelected || st.python?.managerInstalled);
    pythonManagerButton.disabled = Boolean(st.integrationDisabled || st.python?.managerInstallInProgress);
    pythonManagerButton.classList.toggle('is-busy', Boolean(st.python?.managerInstallInProgress));
    pythonManagerButton.textContent = st.python?.managerInstallInProgress
      ? 'Installing automatically…'
      : 'Install official Python Manager';
  }
  pythonAliasWarning?.classList.toggle('hidden', !isWindows || !st.python?.storeAliasConflict);
}

function notifyPathWarning(result) {
  refreshPathManagement();
  if (result?.pathWarning) showToast(`Version changed, but the system PATH could not be updated: ${result.pathWarning}`, 'error');
}

/* ===== Command Palette (Ctrl+K) ===== */
function initCommandPalette() {
  const overlay = document.getElementById('command-palette');
  const input = document.getElementById('command-palette-input');
  const results = document.getElementById('command-palette-results');
  if (!overlay || !input || !results) return;

  let selectedIndex = 0;
  let filteredItems = [];

  const commands = [
    // Navigation
    { icon: '📊', label: 'Dashboard', action: () => navigateToPanel('dashboard') },
    ...SERVICE_SECTIONS.map(s => ({
      icon: SECTION_ICONS[s] || '⚙️', label: `Go to ${sectionLabel(s)}`, action: () => navigateToPanel(s)
    })),
    { icon: '🗃️', label: 'Database Manager', action: () => navigateToPanel('database-manager') },
    { icon: '🧰', label: 'Version Manager', action: () => navigateToPanel('versions') },
    { icon: '📦', label: 'App Store', action: () => navigateToPanel('appstore') },
    { icon: '🗂️', label: 'File Manager', hint: 'Ctrl+Shift+F', action: () => navigateToPanel('file-manager') },
    { icon: '🛰️', label: 'Server Workspace', action: () => navigateToPanel('server-workspace') },
    { icon: '🧭', label: 'Operations Center', action: () => navigateToPanel('operations-center') },
    { icon: '💻', label: 'Terminal', action: () => navigateToPanel('terminal') },
    { icon: '⚙️', label: 'General Settings', action: () => navigateToPanel('general') },
    // Actions
    { icon: '▶', label: 'Start All Services', hint: 'start', action: () => document.getElementById('btn-start-all')?.click() },
    { icon: '⏹', label: 'Stop All Services', hint: 'stop', action: () => document.getElementById('btn-stop-all')?.click() },
    { icon: '💾', label: 'Save Configuration', hint: 'Ctrl+S', action: () => { saveConfig(); } },
    { icon: '📤', label: 'Export Configuration', action: () => document.getElementById('btn-config-export')?.click() },
    { icon: '📥', label: 'Import Configuration', action: () => document.getElementById('btn-config-import')?.click() },
    { icon: '💻', label: 'New Terminal', action: () => { navigateToPanel('terminal'); createTerminal(); } },
    // Per-service start/stop
    ...SERVICE_SECTIONS.flatMap(s => [
      { icon: '▶', label: `Start ${sectionLabel(s)}`, hint: s, action: () => api.service.start(s).then(r => { if (!r.success) showToast(r.error, 'error'); refreshStatuses(); }) },
      { icon: '⏹', label: `Stop ${sectionLabel(s)}`, hint: s, action: () => api.service.stop(s).then(r => { if (!r.success) showToast(r.error, 'error'); refreshStatuses(); }) },
      { icon: '🔄', label: `Restart ${sectionLabel(s)}`, hint: s, action: () => api.service.restart(s).then(r => { if (!r.success) showToast(r.error, 'error'); else showToast(`${sectionLabel(s)} restarted`, 'success'); refreshStatuses(); }) }
    ])
  ];
  api.advanced?.commands?.().then(items => { for (const item of items) commands.push({ icon: item.kind === 'terminal' ? '💻' : item.kind === 'files' ? '🗂️' : item.kind === 'operation' ? '🧭' : '🛰️', label: item.title, hint: item.kind, action: async () => { if (item.kind === 'terminal') { navigateToPanel('terminal'); await createTerminal(remoteState.sessions.find(session => session.id === item.sessionId)); } else if (item.kind === 'files') { navigateToPanel('file-manager'); await selectRemoteSession(item.sessionId); } else { navigateToPanel('operations-center'); const select = document.getElementById('ops-server-select'); if (select) select.value = item.sessionId || ''; if (item.kind === 'operation') await runOperationsAction(item.action); } } }); }).catch(() => {});

  function open() {
    overlay.classList.remove('hidden');
    input.value = '';
    selectedIndex = 0;
    render('');
    input.focus();
  }

  function close() {
    overlay.classList.add('hidden');
    input.value = '';
  }

  function render(filter) {
    const q = filter.toLowerCase().trim();
    filteredItems = q
      ? commands.filter(c => c.label.toLowerCase().includes(q) || (c.hint && c.hint.toLowerCase().includes(q)))
      : commands.slice(0, 15);
    selectedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

    if (!filteredItems.length) {
      results.innerHTML = '<div class="command-palette-empty">No results</div>';
      return;
    }

    results.innerHTML = filteredItems.map((item, i) => `
      <div class="command-palette-item${i === selectedIndex ? ' active' : ''}" data-index="${i}">
        <span class="command-palette-item-icon">${item.icon}</span>
        <span class="command-palette-item-label">${escapeHtml(item.label)}</span>
        ${item.hint ? `<span class="command-palette-item-hint">${escapeHtml(item.hint)}</span>` : ''}
      </div>
    `).join('');

    results.querySelectorAll('.command-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        filteredItems[idx]?.action();
        close();
      });
    });
  }

  function navigateToPanel(panel) {
    switchToPanel(panel);
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1); render(input.value); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = Math.max(selectedIndex - 1, 0); render(input.value); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        close();
      }
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Global Ctrl+K shortcut
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      if (overlay.classList.contains('hidden')) open();
      else close();
    }
  });
}

/* ===== Auto-start on Launch ===== */
async function autoStartServices() {
  if (runtimeSafeMode) return;
  const result = await api.service.autoStart();
  if (result.started?.length) {
    showToast(`Auto-started: ${result.started.map(s => sectionLabel(s)).join(', ')}`, 'success');
    refreshStatuses();
  }
}

/* ===== Version Manager ===== */
const versionOperations = new Map();

function initVersionManager() {
  const search = document.getElementById('version-manager-search');
  const category = document.getElementById('version-manager-category');
  const state = document.getElementById('version-manager-state');
  const refresh = document.getElementById('version-manager-refresh');
  search?.addEventListener('input', debounce(renderVersionManager, 120));
  category?.addEventListener('change', renderVersionManager);
  state?.addEventListener('change', renderVersionManager);
  document.getElementById('version-manager-cleanup')?.addEventListener('click', removeUnusedVersions);
  document.getElementById('version-manager-cache-export')?.addEventListener('click', exportOfflineCache);
  document.getElementById('version-manager-cache-import')?.addEventListener('click', importOfflineCache);
  document.getElementById('version-manager-cache-clear')?.addEventListener('click', clearOfflineCache);
  refresh?.addEventListener('click', async () => {
    refresh.disabled = true;
    refresh.textContent = '↻ Synchronizing…';
    try {
      const result = await api.download.refreshCatalog();
      versionCatalog = result.catalog || [];
      VERSION_MAP = await api.download.getVersions();
      renderVersionManager();
      const count = (result.refreshed || []).reduce((sum, item) => sum + item.versions, 0);
      if (result.errors?.length) {
        showToast(`Synchronized ${count} versions; ${result.errors.length} source(s) unavailable`, 'warning');
      } else {
        showToast(`Synchronized ${count} official versions`, 'success');
      }
    } catch (err) {
      showToast(`Catalog sync failed: ${err.message}`, 'error');
    } finally {
      refresh.disabled = false;
      refresh.textContent = '↻ Sync official catalogs';
    }
  });
}

async function exportOfflineCache() {
  const status = await api.download.cacheStatus();
  if (!status.entries.length) return showToast('Offline cache is empty. Install a version first.', 'error');
  const selected = await api.shell.selectDirectory('');
  if (!selected?.success) return;
  const result = await api.download.exportCache(selected.path);
  showToast(result.success ? `Exported ${result.entries.length} verified archive(s)` : result.error, result.success ? 'success' : 'error');
}

async function importOfflineCache() {
  const selected = await api.shell.selectDirectory('');
  if (!selected?.success) return;
  const result = await api.download.importCache(selected.path);
  showToast(result.success ? `Imported ${result.entries.length} cached archive(s)` : result.error, result.success ? 'success' : 'error');
}

async function clearOfflineCache() {
  const status = await api.download.cacheStatus();
  if (!status.entries.length) return showToast('Offline cache is already empty', 'success');
  if (!confirm(`Remove ${status.entries.length} cached installer archive(s) (${formatBackupSize(status.totalSize)})? Installed services are not affected.`)) return;
  const result = await api.download.clearCache();
  showToast(`Removed ${result.removed} cached archive(s)`, 'success');
}

async function refreshVersionManager() {
  try {
    versionCatalog = await api.download.catalog();
    await refreshInstalledVersionsMap(versionCatalog);
    for (const section of SERVICE_SECTIONS) populateVersionDropdown(section, section);
    const categorySelect = document.getElementById('version-manager-category');
    if (categorySelect && categorySelect.options.length <= 1) {
      for (const name of [...new Set(versionCatalog.map(item => item.category))]) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        categorySelect.appendChild(option);
      }
    }
    renderVersionManager();
  } catch (err) {
    const grid = document.getElementById('version-manager-grid');
    if (grid) grid.innerHTML = `<div class="appstore-empty">${escapeHtml(err.message)}</div>`;
  }
}

function renderVersionManager() {
  const grid = document.getElementById('version-manager-grid');
  const summary = document.getElementById('version-manager-summary');
  if (!grid) return;
  const query = (document.getElementById('version-manager-search')?.value || '').trim().toLowerCase();
  const category = document.getElementById('version-manager-category')?.value || 'all';
  const state = document.getElementById('version-manager-state')?.value || 'all';
  const filtered = versionCatalog.filter(service => {
    if (category !== 'all' && service.category !== category) return false;
    const installed = service.installedVersions || service.versions.filter(item => item.installed).map(item => item.version);
    if (state === 'installed' && !installed.length) return false;
    if (state === 'missing' && installed.length) return false;
    const haystack = `${service.name} ${service.id} ${service.versions.map(item => item.version).join(' ')} ${installed.join(' ')}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  const totalVersions = versionCatalog.reduce((sum, service) => sum + service.versions.length, 0);
  const installedVersions = versionCatalog.reduce((sum, service) => sum + (service.installedVersions?.length || service.versions.filter(item => item.installed).length), 0);
  if (summary) summary.textContent = `${versionCatalog.length} managed components • ${totalVersions} available versions • ${installedVersions} installed`;

  if (!filtered.length) {
    grid.innerHTML = '<div class="appstore-empty">No services or versions match this filter.</div>';
    return;
  }

  grid.innerHTML = filtered.map(service => {
    const active = getActiveProfile(service.id)?.version;
    const recommended = service.versions.find(item => item.recommended)?.version;
    const selected = service.versions.some(item => item.version === active) ? active : recommended || service.versions[0]?.version || '';
    const installed = service.installedVersions || service.versions.filter(item => item.installed).map(item => item.version);
    const referenced = new Set((config[service.id]?.profiles || []).map(profile => profile.version));
    const operation = versionOperations.get(service.id);
    const options = service.versions.map(item => {
      const badges = [item.recommended ? 'recommended' : '', item.lts ? `LTS ${item.lts === true ? '' : item.lts}`.trim() : '', item.prerelease ? 'preview' : '', item.installed ? 'installed' : ''].filter(Boolean);
      return `<option value="${escapeHtml(item.version)}" ${item.version === selected ? 'selected' : ''}>${escapeHtml(item.version)}${badges.length ? ` — ${escapeHtml(badges.join(', '))}` : ''}</option>`;
    }).join('');
    const installedRows = installed.length ? installed.map(version => `
      <div class="installed-version-row${version === active ? ' active' : ''}">
        <span class="installed-version-number">${escapeHtml(version)}</span>
        ${version === active ? '<span class="installed-version-badge">active</span>' : ''}
        ${referenced.has(version) && version !== active ? '<span class="installed-version-badge referenced">profile</span>' : ''}
        <span class="installed-version-spacer"></span>
        <button class="btn btn-small installed-version-use" data-version="${escapeHtml(version)}" ${version === active ? 'disabled' : ''}>Use</button>
        <button class="btn btn-small installed-version-remove" data-version="${escapeHtml(version)}" ${referenced.has(version) ? 'disabled title="Used by a profile"' : 'title="Remove from disk"'}>🗑</button>
      </div>`).join('') : '<div class="installed-version-empty">No versions installed yet.</div>';
    const operationLabel = operation ? formatVersionOperation(operation) : '';
    return `
      <article class="version-manager-card" data-service="${escapeHtml(service.id)}">
        <div class="version-manager-card-head">
          <span class="version-manager-icon">${service.icon}</span>
          <div><h3>${escapeHtml(service.name)}</h3><span>${escapeHtml(service.category)}</span></div>
        </div>
        <p>${escapeHtml(service.description)}</p>
        <div class="installed-version-list">
          <div class="installed-version-heading">Installed versions <span>${installed.length}</span></div>
          ${installedRows}
        </div>
        <div class="version-manager-install-label">Install or switch release</div>
        <select class="version-manager-select" aria-label="Choose ${escapeHtml(service.name)} version">${options}</select>
        <div class="version-manager-current">Active profile: <strong>${escapeHtml(active || 'none')}</strong></div>
        <div class="version-operation${operation ? '' : ' hidden'}">
          <div class="version-operation-label">${escapeHtml(operationLabel)}</div>
          <div class="version-operation-track"><div class="version-operation-fill" style="width:${Number(operation?.percent || 0)}%"></div></div>
        </div>
        <div class="version-manager-actions">
          <button class="btn btn-small version-install">⬇ Install</button>
          <button class="btn btn-small btn-primary version-activate">✓ Use version</button>
        </div>
      </article>`;
  }).join('');

  grid.querySelectorAll('.version-manager-card').forEach(card => {
    const service = card.dataset.service;
    const select = card.querySelector('.version-manager-select');
    const refreshButtons = () => {
      const item = versionCatalog.find(entry => entry.id === service)?.versions.find(entry => entry.version === select.value);
      const active = getActiveProfile(service)?.version;
      const busy = versionOperations.has(service);
      card.querySelector('.version-install').disabled = Boolean(item?.installed) || busy;
      card.querySelector('.version-install').textContent = busy ? 'Working…' : (item?.installed ? '✓ Installed' : '⬇ Install');
      card.querySelector('.version-activate').disabled = !item?.installed || active === select.value || busy;
    };
    select.addEventListener('change', refreshButtons);
    refreshButtons();

    card.querySelector('.version-install').addEventListener('click', async event => {
      const version = select.value;
      versionOperations.set(service, { version, stage: 'starting', percent: 0 });
      updateVersionOperationProgress({ service, version, stage: 'starting', percent: 0 });
      refreshButtons();
      try {
        const result = await api.download.install(service, version);
        if (!result.success) throw new Error(result.error || 'Installation failed');
        showToast(`${sectionLabel(service)} ${version} installed`, 'success');
        if (result.pythonManagerWarning) showToast(`Python was installed, but its official manager could not be configured: ${result.pythonManagerWarning}`, 'error');
        notifyPathWarning(result);
        VERSION_MAP = await api.download.getVersions();
        versionOperations.delete(service);
        await refreshVersionManager();
        if (SERVICE_SECTIONS.includes(service)) populateSectionUI(service);
      } catch (err) {
        showToast(err.message, 'error');
        versionOperations.set(service, { version, stage: 'failed', percent: 0, error: err.message });
        updateVersionOperationProgress({ service, version, stage: 'failed', percent: 0, error: err.message });
        setTimeout(() => {
          versionOperations.delete(service);
          if (document.getElementById('panel-versions')?.classList.contains('active')) renderVersionManager();
        }, 3500);
      }
    });

    card.querySelector('.version-activate').addEventListener('click', () => activateManagedVersion(service, select.value));
    card.querySelectorAll('.installed-version-use').forEach(button => {
      button.addEventListener('click', () => activateManagedVersion(service, button.dataset.version));
    });
    card.querySelectorAll('.installed-version-remove').forEach(button => {
      button.addEventListener('click', () => removeManagedVersion(service, button.dataset.version));
    });
  });
}

function formatVersionOperation(operation) {
  const labels = {
    starting: 'Preparing download…', downloading: `Downloading… ${operation.percent || 0}%`,
    retrying: 'Retrying download…', verifying: 'Verifying checksum…', extracting: 'Installing files…',
    'python-manager': 'Configuring official Python Manager…',
    'python-runtime': `Installing full Python runtime with pip… ${operation.percent || 0}%`,
    done: 'Installation complete', failed: operation.error || 'Installation failed'
  };
  return `${operation.version}: ${labels[operation.stage] || operation.stage}`;
}

function updateVersionOperationProgress(data) {
  if (!data?.service || !versionOperations.has(data.service)) return;
  const operation = { ...versionOperations.get(data.service), ...data };
  versionOperations.set(data.service, operation);
  const card = document.querySelector(`.version-manager-card[data-service="${data.service}"]`);
  if (!card) return;
  const box = card.querySelector('.version-operation');
  const label = card.querySelector('.version-operation-label');
  const fill = card.querySelector('.version-operation-fill');
  box?.classList.remove('hidden');
  if (label) label.textContent = formatVersionOperation(operation);
  if (fill) {
    fill.style.width = `${Math.max(0, Math.min(100, Number(operation.percent || 0)))}%`;
    fill.classList.toggle('failed', operation.stage === 'failed');
  }
}

async function activateManagedVersion(service, version) {
  const profile = getActiveProfile(service);
  if (!profile) return showToast('No active profile for this service', 'error');
  const runningStack = statuses[service]?.running || (service === 'php' && ['apache', 'nginx', 'caddy'].some(web => statuses[web]?.running));
  if (runningStack && !confirm(`Switch ${sectionLabel(service)} to ${version}? KitsuneServ will restart the affected stack and roll back if it fails.`)) return;
  const result = await api.service.switchVersion(service, version);
  if (!result.success) return showToast(result.error || 'Could not switch version', 'error');
  config = result.config;
  dirty = false;
  if (SERVICE_SECTIONS.includes(service)) populateSectionUI(service);
  refreshDashboard();
  showToast(`${sectionLabel(service)} now uses ${version}${result.restarted?.length ? ' — stack restarted' : ''}`, 'success');
  notifyPathWarning(result);
  await refreshStatuses();
  await refreshVersionManager();
}

async function removeManagedVersion(service, version, skipConfirm = false) {
  if (!skipConfirm && !confirm(`Remove ${sectionLabel(service)} ${version} from disk?`)) return false;
  const result = await api.download.remove(service, version);
  if (!result.success) {
    showToast(result.error || 'Could not remove version', 'error');
    return false;
  }
  if (result.pythonManagerWarning) showToast(`Python Manager cleanup warning: ${result.pythonManagerWarning}`, 'error');
  if (result.pathWarning) showToast(`PATH cleanup warning: ${result.pathWarning}`, 'error');
  if (!skipConfirm) showToast(`${sectionLabel(service)} ${version} removed`, 'success');
  await refreshVersionManager();
  return true;
}

async function removeUnusedVersions() {
  const button = document.getElementById('version-manager-cleanup');
  const removable = [];
  for (const service of versionCatalog) {
    const referenced = new Set((config[service.id]?.profiles || []).map(profile => profile.version));
    for (const version of service.installedVersions || []) {
      if (!referenced.has(version)) removable.push({ service: service.id, version });
    }
  }
  if (!removable.length) return showToast('There are no unused installed versions', 'success');
  if (!confirm(`Remove ${removable.length} unused version${removable.length === 1 ? '' : 's'} from disk?`)) return;
  button.disabled = true;
  const original = button.textContent;
  let removed = 0;
  try {
    for (const [index, item] of removable.entries()) {
      button.textContent = `Removing ${index + 1}/${removable.length}…`;
      const result = await api.download.remove(item.service, item.version);
      if (result.success) removed++;
    }
    await refreshVersionManager();
    showToast(`Removed ${removed} unused version${removed === 1 ? '' : 's'}`, removed === removable.length ? 'success' : 'warning');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/* ===== App Store ===== */
let appStoreCatalog = [];
let appStoreFilter = 'all';
let appStoreSearch = '';
let appStoreInstalling = new Set();
let _appStoreSearchTimer = null;

function initAppStore() {
  const searchInput = document.getElementById('appstore-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(_appStoreSearchTimer);
      _appStoreSearchTimer = setTimeout(() => {
        appStoreSearch = searchInput.value.toLowerCase().trim();
        renderAppStoreGrid();
      }, 300);
    });
  }

  // "Add from Git" button
  const addBtn = document.getElementById('btn-add-git-app');
  const modal = document.getElementById('git-app-modal');
  const closeBtn = document.getElementById('git-app-modal-close');
  const cancelBtn = document.getElementById('git-app-cancel');
  const confirmBtn = document.getElementById('git-app-add');

  if (addBtn && modal) {
    addBtn.addEventListener('click', () => modal.classList.remove('hidden'));
    closeBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    cancelBtn?.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    confirmBtn?.addEventListener('click', async () => {
      const name = document.getElementById('git-app-name').value.trim();
      const gitUrl = document.getElementById('git-app-url').value.trim();
      const branch = document.getElementById('git-app-branch').value.trim() || 'main';
      const entryPoint = document.getElementById('git-app-entry').value.trim() || 'index.php';
      const category = document.getElementById('git-app-category').value;
      const database = document.getElementById('git-app-database').value.trim();
      const description = document.getElementById('git-app-desc').value.trim();

      if (!name || !gitUrl) {
        showToast('Name and Git URL are required', 'error');
        return;
      }

      const result = await api.appStore.addCustomApp({ name, gitUrl, branch, entryPoint, category, database, description });
      if (result.success) {
        showToast(`${name} added to catalog`, 'success');
        modal.classList.add('hidden');
        // Clear form
        document.getElementById('git-app-name').value = '';
        document.getElementById('git-app-url').value = '';
        document.getElementById('git-app-branch').value = 'main';
        document.getElementById('git-app-entry').value = 'index.php';
        document.getElementById('git-app-database').value = '';
        document.getElementById('git-app-desc').value = '';
        await refreshAppStore();
      } else {
        showToast(result.error, 'error');
      }
    });
  }
}

async function refreshAppStore() {
  try {
    appStoreCatalog = await api.appStore.catalog();
  } catch { appStoreCatalog = []; }
  renderAppStoreFilters();
  renderAppStoreGrid();
}

function renderAppStoreFilters() {
  const container = document.getElementById('appstore-filters');
  if (!container) return;
  const categories = ['all', ...new Set(appStoreCatalog.map(a => a.category))];
  container.innerHTML = categories.map(cat => `
    <button class="appstore-filter-btn${appStoreFilter === cat ? ' active' : ''}" data-cat="${cat}">
      ${cat === 'all' ? '🏠 All' : cat}
    </button>
  `).join('');
  container.querySelectorAll('.appstore-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      appStoreFilter = btn.dataset.cat;
      renderAppStoreFilters();
      renderAppStoreGrid();
    });
  });
}

function renderAppStoreGrid() {
  const grid = document.getElementById('appstore-grid');
  if (!grid) return;

  let apps = appStoreCatalog;
  if (appStoreFilter !== 'all') apps = apps.filter(a => a.category === appStoreFilter);
  if (appStoreSearch) apps = apps.filter(a =>
    a.name.toLowerCase().includes(appStoreSearch) ||
    a.description.toLowerCase().includes(appStoreSearch) ||
    a.category.toLowerCase().includes(appStoreSearch) ||
    (a.type || '').toLowerCase().includes(appStoreSearch)
  );

  if (!apps.length) {
    grid.innerHTML = '<div class="appstore-empty">No apps found</div>';
    return;
  }

  grid.innerHTML = apps.map(app => {
    const installing = appStoreInstalling.has(app.id);
    const reqs = (app.requires || []).map(r => r.split('|').map(s => sectionLabel(s)).join(' / ')).join(', ');
    const typeLabel = { zip: 'ZIP', 'tar.gz': 'TAR.GZ', 'zip-exe': 'EXE', 'single-file': 'File', 'single-exe': 'EXE', composer: 'Composer', git: 'Git' }[app.type] || app.type;
    const isCustom = !!app.custom;
    const dbLabel = app.database ? `<div class="appstore-card-db">🗃 DB: ${escapeHtml(app.database)}</div>` : '';
    const instances = app.instances || [];
    const hasInstances = instances.length > 0;

    // Render installed instances list
    const instancesHtml = hasInstances ? `
      <div class="appstore-instances">
        ${instances.map(inst => `
          <div class="appstore-instance" data-instance="${escapeHtml(inst.instanceName)}">
            <span class="instance-name">📁 ${escapeHtml(inst.instanceName)}</span>
            <span class="instance-actions">
              <button class="btn btn-small btn-open-instance" data-instance="${escapeHtml(inst.instanceName)}" data-app="${app.id}" title="Open in browser">🌐</button>
              <button class="btn btn-small btn-remove-instance" data-instance="${escapeHtml(inst.instanceName)}" data-app="${app.id}" title="Remove">🗑️</button>
            </span>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="appstore-card${hasInstances ? ' installed' : ''}${isCustom ? ' custom' : ''}" data-app-id="${app.id}">
        <div class="appstore-card-header">
          <span class="appstore-card-icon">${app.icon}</span>
          <div class="appstore-card-info">
            <h3>${escapeHtml(app.name)}</h3>
            <span class="appstore-card-version">v${escapeHtml(String(app.version))}</span>
          </div>
          <span class="appstore-card-badge ${hasInstances ? 'badge-installed' : 'badge-available'}">
            ${hasInstances ? `✅ ${instances.length} inst.` : 'Available'}
          </span>
        </div>
        <p class="appstore-card-desc">${escapeHtml(app.description)}</p>
        <div class="appstore-card-meta">
          ${reqs ? `<span class="appstore-card-reqs">Requires: ${reqs}</span>` : ''}
          ${dbLabel}
          <span class="appstore-card-type">${typeLabel}</span>
          <span class="appstore-card-category">${escapeHtml(app.category)}</span>
        </div>
        ${instancesHtml}
        <div class="appstore-card-actions">
          <button class="btn btn-small btn-install-app${installing ? ' disabled' : ''}" data-app="${app.id}" ${installing ? 'disabled' : ''}>
            ${installing ? '<span class="appstore-spinner"></span> Installing...' : '⬇️ Install'}
          </button>
          ${isCustom && !hasInstances ? `<button class="btn btn-small btn-remove-custom-app" data-app="${app.id}" title="Remove from catalog">✕</button>` : ''}
        </div>
        ${installing ? `<div class="appstore-progress" id="appstore-progress-${app.id}"><div class="appstore-progress-bar"></div></div>` : ''}
      </div>
    `;
  }).join('');

  // Bind actions
  grid.querySelectorAll('.btn-install-app').forEach(btn => {
    btn.addEventListener('click', () => installApp(btn.dataset.app));
  });
  grid.querySelectorAll('.btn-open-instance').forEach(btn => {
    btn.addEventListener('click', () => openAppInstance(btn.dataset.app, btn.dataset.instance));
  });
  grid.querySelectorAll('.btn-remove-instance').forEach(btn => {
    btn.addEventListener('click', () => removeAppInstance(btn.dataset.app, btn.dataset.instance));
  });
  grid.querySelectorAll('.btn-remove-custom-app').forEach(btn => {
    btn.addEventListener('click', () => removeCustomApp(btn.dataset.app));
  });
}

function promptInstanceName(defaultValue) {
  return new Promise((resolve) => {
    const modal = document.getElementById('instance-name-modal');
    const input = document.getElementById('instance-name-input');
    const confirmBtn = document.getElementById('instance-name-confirm');
    const cancelBtn = document.getElementById('instance-name-cancel');
    const closeBtn = document.getElementById('instance-name-modal-close');
    if (!modal || !input) { resolve(null); return; }

    input.value = defaultValue || '';
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    function cleanup() {
      modal.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBg);
      input.removeEventListener('keydown', onKey);
    }
    function onConfirm() { cleanup(); resolve(input.value.trim()); }
    function onCancel() { cleanup(); resolve(null); }
    function onBg(e) { if (e.target === modal) onCancel(); }
    function onKey(e) { if (e.key === 'Enter') onConfirm(); else if (e.key === 'Escape') onCancel(); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBg);
    input.addEventListener('keydown', onKey);
  });
}

async function installApp(appId) {
  if (appStoreInstalling.has(appId)) return;

  // Pre-flight check
  const reqs = await api.appStore.checkRequirements(appId);
  if (!reqs.ok) {
    showToast(`Missing: ${reqs.missing.join(', ')}. Install required services first.`, 'error');
    return;
  }

  // Ask for instance name (allows multiple installs under different names)
  const appDef = appStoreCatalog.find(a => a.id === appId);
  const defaultName = appDef ? appDef.id : appId;
  const instanceName = await promptInstanceName(defaultName);
  if (!instanceName) return; // User cancelled

  const sanitized = instanceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!sanitized) {
    showToast('Invalid instance name', 'error');
    return;
  }

  appStoreInstalling.add(appId);
  renderAppStoreGrid();
  try {
    const result = await api.appStore.install(appId, sanitized);
    if (result.success) {
      if (result.alreadyInstalled) {
        showToast(`${sanitized} is already installed`, 'info');
      } else {
        showToast(`${sanitized} installed successfully!`, 'success');
      }
    } else {
      showToast(`Failed to install ${sanitized}: ${result.error}`, 'error');
    }
  } catch (err) {
    showToast(`Install error: ${err.message}`, 'error');
  }
  appStoreInstalling.delete(appId);
  await refreshAppStore();
}

async function openAppInstance(appId, instanceName) {
  const appDef = appStoreCatalog.find(a => a.id === appId);
  if (!appDef) return;

  if (appDef.type === 'single-exe' || appDef.type === 'zip-exe') {
    const exePath = await api.appStore.getExePath(instanceName);
    if (exePath) {
      await api.shell.openPath(exePath.replace(/[^\\\/]+$/, ''));
      showToast(`Opening ${appDef.name} directory`, 'info');
    }
    const url = await api.appStore.getUrl(instanceName);
    if (url) api.shell.openExternal(url);
  } else {
    const url = await api.appStore.getUrl(instanceName);
    if (url) api.shell.openExternal(url);
    else showToast('Could not determine app URL', 'error');
  }
}

async function removeAppInstance(appId, instanceName) {
  const appDef = appStoreCatalog.find(a => a.id === appId);
  const label = appDef ? `${appDef.name} (${instanceName})` : instanceName;
  if (!confirm(`Remove ${label}? This will delete all files for this instance.`)) return;
  const result = await api.appStore.remove(instanceName);
  if (result.success) {
    showToast(`${label} removed`, 'success');
    await refreshAppStore();
  } else {
    showToast(`Failed to remove: ${result.error}`, 'error');
  }
}

async function removeCustomApp(appId) {
  const appDef = appStoreCatalog.find(a => a.id === appId);
  if (!appDef) return;
  if (!confirm(`Remove "${appDef.name}" from the catalog?`)) return;
  const result = await api.appStore.removeCustomApp(appId);
  if (result.success) {
    showToast(`${appDef.name} removed from catalog`, 'success');
    await refreshAppStore();
  } else {
    showToast(result.error, 'error');
  }
}

function handleAppStoreProgress({ appId, stage, percent }) {
  const bar = document.querySelector(`#appstore-progress-${appId} .appstore-progress-bar`);
  if (bar) bar.style.width = `${percent || 0}%`;
}
