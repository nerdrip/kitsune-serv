/* ===== KitsuneServ – Renderer (profile-aware) ===== */
'use strict';

const api = window.kitsuneAPI;

// Sections that have profiles (not general)
const SERVICE_SECTIONS = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];
const WEB_SERVER_SECTIONS = ['apache', 'nginx', 'caddy'];

// Version map loaded from backend (downloads.json)
let VERSION_MAP = {};
let versionCatalog = [];

// Dashboard card icons
const SECTION_ICONS = {
  apache: '🪶', nginx: '🔄', caddy: '🔒', postgresql: '🐘', mysql: '🐬', mariadb: '🦭', mongodb: '🍃',
  php: '🐘', node: '💚', go: '🔵', bun: '🧅', redis: '🔴',
  memcached: '⚡', minio: '📦', python: '🐍', deno: '🦕'
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
    const versionLabel = document.querySelector('.titlebar-version');
    if (versionLabel) versionLabel.textContent = `v${info.version}`;
    const dataRootLabel = document.getElementById('app-data-root');
    if (dataRootLabel) dataRootLabel.textContent = info.dataRoot;
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
  initLogViewers();
  initProjectManagers();
  bindFolderButtons();
  initTerminal();
  initCommandPalette();
  initComposer();
  initAppStore();
  initVersionManager();
  initSecurityPanel();
  initUpdatePanel();
  initSupportReport();
  initCollapsibleGroups();
  bindShortcutsModal();
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
  if (panelId === 'workspaces') refreshWorkspaceCenter();
  if (panelId === 'general') refreshSecurityPanel();
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

  // Dashboard search / filter
  const searchInput = document.getElementById('dash-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      const grid = document.getElementById('dashboard-grid');
      if (!grid) return;
      grid.querySelectorAll('.dashboard-card').forEach(card => {
        const section = card.dataset.section;
        const label = sectionLabel(section).toLowerCase();
        card.style.display = (!query || label.includes(query) || section.includes(query)) ? '' : 'none';
      });
    });
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
  document.getElementById('security-revoke-others')?.addEventListener('click', async () => {
    if (!confirm('Revoke every other active KitsuneServ web session?')) return;
    const result = await api.security.revokeOtherSessions();
    showToast(result.success ? `Revoked ${result.removed} session(s)` : result.error, result.success ? 'success' : 'error');
    await refreshSecurityPanel();
  });
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
  try {
    const [status, sessions] = await Promise.all([api.security.status(), api.security.sessions()]);
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
      return;
    }
    list.innerHTML = sessions.map(session => `<div class="security-session-row"><span>${session.current ? '●' : '○'}</span><div class="security-session-info"><strong>${escapeHtml(session.username)}${session.current ? ' · current' : ''}</strong><span>${escapeHtml(session.address || 'unknown')} · last seen ${escapeHtml(new Date(session.lastSeenAt).toLocaleString())} · ${escapeHtml((session.userAgent || '').slice(0, 100))}</span></div>${session.current ? '' : `<button class="btn btn-small btn-danger security-revoke" data-id="${escapeHtml(session.id)}">Revoke</button>`}</div>`).join('');
    list.querySelectorAll('.security-revoke').forEach(button => button.addEventListener('click', async () => {
      const result = await api.security.revokeSession(button.dataset.id);
      showToast(result.success ? 'Session revoked' : result.error, result.success ? 'success' : 'error');
      await refreshSecurityPanel();
    }));
  } catch (error) {
    grid.innerHTML = `<div class="db-error">${escapeHtml(error.message)}</div>`;
    list.innerHTML = '';
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
  const labels = { apache: 'Apache', nginx: 'Nginx', caddy: 'Caddy', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongodb: 'MongoDB', php: 'PHP', node: 'Node.js', go: 'Go', bun: 'Bun', redis: 'Redis', memcached: 'Memcached', minio: 'MinIO', python: 'Python', deno: 'Deno' };
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
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
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

const databaseManagerState = { connections: [], selectedId: null, connection: null, passwords: new Map() };

function initDatabaseManager() {
  if (!document.getElementById('panel-database-manager')) return;
  const type = document.getElementById('dbm-type');
  type?.addEventListener('change', () => {
    const defaults = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 };
    document.getElementById('dbm-port').value = defaults[type.value];
    updateDatabaseQueryPlaceholder(type.value);
  });
  document.getElementById('dbm-refresh-connections')?.addEventListener('click', refreshDatabaseConnections);
  document.getElementById('dbm-new-connection')?.addEventListener('click', () => selectDatabaseConnection(null));
  document.getElementById('dbm-save')?.addEventListener('click', saveDatabaseConnection);
  document.getElementById('dbm-remove')?.addEventListener('click', removeDatabaseConnection);
  document.getElementById('dbm-test')?.addEventListener('click', testDatabaseConnection);
  document.getElementById('dbm-connect')?.addEventListener('click', connectDatabaseManager);
  document.getElementById('dbm-refresh-databases')?.addEventListener('click', connectDatabaseManager);
  document.getElementById('dbm-database')?.addEventListener('change', refreshDatabaseManagerTables);
  document.getElementById('dbm-create-database')?.addEventListener('click', createDatabaseManagerDatabase);
  document.getElementById('dbm-drop-database')?.addEventListener('click', dropDatabaseManagerDatabase);
  document.getElementById('dbm-run-query')?.addEventListener('click', runDatabaseManagerQuery);
  document.getElementById('dbm-create-backup')?.addEventListener('click', createDatabaseManagerBackup);
  document.getElementById('dbm-refresh-backups')?.addEventListener('click', refreshDatabaseManagerBackups);
  document.getElementById('dbm-save-backup-schedule')?.addEventListener('click', saveDatabaseBackupSchedule);
  document.getElementById('dbm-query')?.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      runDatabaseManagerQuery();
    }
  });
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
  if (!databaseManagerState.connections.length) {
    list.innerHTML = '<div class="dbm-empty">No connections configured.</div>';
    return;
  }
  list.innerHTML = databaseManagerState.connections.map(connection => `
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
    const databases = await api.db.listDatabasesFor(connection);
    databaseManagerState.connection = connection;
    const select = document.getElementById('dbm-database');
    select.innerHTML = databases.map(database => `<option value="${escapeHtml(database)}">${escapeHtml(database)}</option>`).join('');
    document.getElementById('dbm-workspace').classList.remove('hidden');
    status.textContent = `Connected · ${databases.length} databases`;
    status.className = 'dbm-status online';
    await refreshDatabaseManagerTables();
    await refreshDatabaseManagerBackups();
  } catch (err) {
    status.textContent = 'Connection failed';
    status.className = 'dbm-status failed';
    showToast(err.message, 'error');
  } finally { setDatabaseManagerBusy(button, false); }
}

async function refreshDatabaseManagerTables() {
  const database = document.getElementById('dbm-database')?.value;
  const list = document.getElementById('dbm-table-list');
  if (!databaseManagerState.connection || !database || !list) {
    if (list) list.innerHTML = '<span class="dbm-empty">No database selected.</span>';
    return;
  }
  list.innerHTML = '<span class="inline-spinner"></span>Loading…';
  try {
    const tables = await api.db.listTablesFor(databaseManagerState.connection, database);
    list.innerHTML = tables.length ? tables.map(table => `<button class="dbm-table" data-table="${escapeHtml(table)}">${escapeHtml(table)}</button>`).join('') : '<span class="dbm-empty">No tables or collections.</span>';
    list.querySelectorAll('.dbm-table').forEach(button => button.addEventListener('click', () => {
      const table = button.dataset.table;
      const query = document.getElementById('dbm-query');
      if (databaseManagerState.connection.type === 'mongodb') query.value = JSON.stringify({ collection: table, operation: 'find', filter: {}, limit: 100 }, null, 2);
      else if (databaseManagerState.connection.type === 'postgresql') query.value = `SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 100;`;
      else query.value = `SELECT * FROM \`${table.replace(/`/g, '``')}\` LIMIT 100;`;
    }));
  } catch (err) { list.innerHTML = `<span class="db-error">${escapeHtml(err.message)}</span>`; }
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

async function runDatabaseManagerQuery() {
  const query = document.getElementById('dbm-query').value.trim();
  const database = document.getElementById('dbm-database')?.value;
  const resultWrap = document.getElementById('dbm-result');
  const button = document.getElementById('dbm-run-query');
  if (!query || !database || !databaseManagerState.connection) return;
  setDatabaseManagerBusy(button, true, 'Running…');
  resultWrap.innerHTML = '<div class="dbm-empty"><span class="inline-spinner"></span>Executing query…</div>';
  try {
    const result = await api.db.executeQueryFor(databaseManagerState.connection, database, query);
    renderDatabaseManagerResult(result);
    await refreshDatabaseManagerTables();
  } catch (err) {
    resultWrap.innerHTML = `<div class="db-error">${escapeHtml(err.message)}</div>`;
  } finally { setDatabaseManagerBusy(button, false); }
}

function renderDatabaseManagerResult(data) {
  const wrap = document.getElementById('dbm-result');
  if (!data?.columns?.length) {
    wrap.innerHTML = `<div class="db-success">✓ ${escapeHtml(data?.message || 'Query executed successfully')}</div>`;
    return;
  }
  wrap.innerHTML = `<table class="db-data-table"><thead><tr>${data.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${data.rows.map(row => `<tr>${row.map(cell => `<td${cell == null || cell === '' || cell === 'NULL' ? ' class="db-null"' : ''}>${escapeHtml(cell == null ? 'NULL' : cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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

function initWorkspaceCenter() {
  if (!api.workspace || workspaceState.initialized) return;
  workspaceState.initialized = true;
  document.getElementById('workspace-new')?.addEventListener('click', () => openWorkspaceEditor());
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
  document.getElementById('workspace-count').textContent = workspaceState.projects.length;
  document.getElementById('workspace-running-count').textContent = workspaceState.projects.filter(project => project.state?.status === 'running').length;
  renderWorkspaceCards();
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
    return `<article class="workspace-card ${escapeHtml(state)}" data-workspace-id="${escapeHtml(project.id)}">
      <div class="workspace-card-head"><div class="workspace-card-title"><span>${escapeHtml(project.icon)}</span><div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.templateId)}</p></div></div><span class="workspace-state ${escapeHtml(state)}">${escapeHtml(state)}</span></div>
      <div class="workspace-card-domain">${project.https ? '🔒' : '🌐'} ${escapeHtml(project.domain)}</div>
      <div class="workspace-card-meta">${(project.services || []).map(service => `<span class="workspace-chip">${escapeHtml(sectionLabel(service))}</span>`).join('') || '<span class="workspace-chip">No managed services</span>'}</div>
      <div class="workspace-card-path" title="${escapeHtml(project.root)}">${escapeHtml(project.root)}</div>
      ${state === 'failed' && project.state?.error ? `<div class="form-help" style="color:var(--danger);margin-bottom:8px">${escapeHtml(project.state.error)}</div>` : ''}
      ${Object.keys(project.commands || {}).length ? `<div class="workspace-command-bar"><span>Commands</span>${workspaceState.platform?.wsl?.supported ? `<select class="workspace-command-target"><option value="host">Windows host</option>${workspaceState.platform.wsl.distributions.map(name => `<option value="${escapeHtml(name)}">WSL · ${escapeHtml(name)}</option>`).join('')}</select>` : ''}${Object.keys(project.commands).map(name => `<button class="btn btn-small workspace-command" data-command="${escapeHtml(name)}">▶ ${escapeHtml(name)}</button>`).join('')}</div>` : ''}
      ${workspaceState.ides.some(ide => ide.installed) ? `<div class="workspace-ide-row"><select class="workspace-ide-select">${workspaceState.ides.filter(ide => ide.installed).map(ide => `<option value="${escapeHtml(ide.id)}">${escapeHtml(ide.name)}</option>`).join('')}</select><button class="btn btn-small workspace-open-ide">Open IDE</button></div>` : ''}
      <div class="workspace-card-actions">
        ${state === 'running' ? '<button class="btn workspace-stop"'+(busy?' disabled':'')+'>⏹ Stop</button>' : '<button class="btn btn-primary workspace-start"'+(busy?' disabled':'')+'>▶ Start</button>'}
        <button class="btn workspace-open-url" ${state !== 'running' ? 'disabled' : ''}>🌐 Open</button>
        <button class="btn workspace-share" ${state !== 'running' || !workspaceState.tunnelProviders.some(item => item.installed) ? 'disabled' : ''}>↗ Share</button>
        <button class="btn workspace-open-dir">📂 Folder</button>
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
    else { showToast('Project removed; files were preserved', 'success'); await refreshWorkspaceCenter(); }
  });
}

function renderWorkspaceServiceChoices(selected) {
  const container = document.getElementById('workspace-service-choices');
  if (!container) return;
  container.innerHTML = SERVICE_SECTIONS.map(service => `<label class="workspace-service-choice"><input type="checkbox" value="${service}" ${selected.includes(service) ? 'checked' : ''}><span>${SECTION_ICONS[service] || '⚙️'} ${escapeHtml(sectionLabel(service))}</span></label>`).join('');
}

function openWorkspaceEditor(project = null) {
  const editor = document.getElementById('workspace-editor');
  editor.classList.remove('hidden');
  document.getElementById('workspace-editor-title').textContent = project ? `Edit ${project.name}` : 'Create project';
  document.getElementById('workspace-editor-save').textContent = project ? 'Save changes' : 'Create project';
  document.getElementById('workspace-id').value = project?.id || '';
  document.getElementById('workspace-name').value = project?.name || '';
  document.getElementById('workspace-root').value = project?.root || '';
  document.getElementById('workspace-domain').value = project?.domain || '';
  document.getElementById('workspace-public-dir').value = project?.publicDir || '.';
  document.getElementById('workspace-https').checked = Boolean(project?.https);
  document.getElementById('workspace-auto-open').checked = project?.autoOpen !== false;
  document.getElementById('workspace-template').value = project?.templateId || workspaceState.templates[0]?.id || 'blank';
  if (project) {
    renderWorkspaceServiceChoices(project.services || []);
    document.getElementById('workspace-template-description').textContent = workspaceState.templates.find(item => item.id === project.templateId)?.description || '';
  } else applyWorkspaceTemplate();
  document.getElementById('workspace-name').focus();
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeWorkspaceEditor() {
  document.getElementById('workspace-editor')?.classList.add('hidden');
}

function applyWorkspaceTemplate() {
  const template = workspaceState.templates.find(item => item.id === document.getElementById('workspace-template')?.value);
  if (!template) return;
  renderWorkspaceServiceChoices(template.services || []);
  document.getElementById('workspace-public-dir').value = template.publicDir || '.';
  document.getElementById('workspace-template-description').textContent = template.description || '';
}

async function pickWorkspaceRoot() {
  const current = document.getElementById('workspace-root').value;
  const result = await api.shell.selectDirectory(current);
  if (result?.success && result.path) document.getElementById('workspace-root').value = result.path;
}

async function saveWorkspaceEditor() {
  const button = document.getElementById('workspace-editor-save');
  const id = document.getElementById('workspace-id').value;
  const options = {
    name: document.getElementById('workspace-name').value.trim(),
    templateId: document.getElementById('workspace-template').value,
    domain: document.getElementById('workspace-domain').value.trim() || undefined,
    root: document.getElementById('workspace-root').value.trim() || undefined,
    publicDir: document.getElementById('workspace-public-dir').value.trim() || '.',
    https: document.getElementById('workspace-https').checked,
    autoOpen: document.getElementById('workspace-auto-open').checked,
    services: [...document.querySelectorAll('#workspace-service-choices input:checked')].map(input => input.value)
  };
  if (!options.name) return showToast('Project name is required', 'error');
  button.disabled = true;
  try {
    if (id) await api.workspace.update(id, options);
    else await api.workspace.create(options);
    closeWorkspaceEditor();
    showToast(id ? 'Project updated' : 'Project created', 'success');
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

function renderWorkspaceDoctor() {
  const container = document.getElementById('doctor-results');
  const report = workspaceState.doctor;
  if (!report) return;
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
    container.innerHTML = [...workspaceState.toolchains, ...workspaceState.ides.map(ide => ({ ...ide, category: 'IDE', version: ide.name }))].map(tool => `<div class="toolchain-chip ${tool.installed ? 'installed' : ''}" title="${escapeHtml(tool.version || 'Not found')}"><i class="toolchain-dot"></i><strong>${escapeHtml(tool.id)}</strong><span>${tool.installed ? escapeHtml((tool.version || 'available').slice(0, 60)) : 'missing'}</span></div>`).join('');
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
      await api.workspace.import(manifest, { createDirectory: true });
      showToast('Project imported', 'success');
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

/* ===== Built-in Terminal ===== */
const terminalState = { tabs: [], activeId: null, cmdHistory: {}, historyIndex: {}, followOutput: {} };

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
  document.getElementById('btn-new-terminal')?.addEventListener('click', createTerminal);
  document.getElementById('btn-terminal-clear')?.addEventListener('click', () => {
    const output = document.getElementById('terminal-output-' + terminalState.activeId);
    if (output) output.textContent = '';
  });
  document.getElementById('btn-terminal-bottom')?.addEventListener('click', () => {
    const output = document.getElementById('terminal-output-' + terminalState.activeId);
    if (!output) return;
    terminalState.followOutput[terminalState.activeId] = true;
    output.scrollTop = output.scrollHeight;
    updateTerminalLatestButton();
  });

  // Listen for terminal data from backend
  api.terminal.onData(({ id, data }) => {
    const output = document.getElementById('terminal-output-' + id);
    if (!output) return;

    // Strip non-SGR escape sequences (cursor movement, etc.) but keep colors
    const cleaned = data.replace(/\x1b\[[0-9;]*[A-HJKSTfhlm]/g, (m) => {
      return m.endsWith('m') ? m : ''; // Keep only SGR (color) sequences
    });

    const shouldFollow = terminalState.followOutput[id] !== false
      || output.scrollHeight - output.scrollTop - output.clientHeight < 36;
    output.appendChild(parseAnsi(cleaned));

    // Limit terminal buffer to prevent memory leak
    const MAX_TERMINAL_NODES = 5000;
    while (output.childNodes.length > MAX_TERMINAL_NODES) {
      output.removeChild(output.firstChild);
    }
    if (shouldFollow) output.scrollTop = output.scrollHeight;
    terminalState.followOutput[id] = shouldFollow;
    if (terminalState.activeId === id) updateTerminalLatestButton();
  });

  api.terminal.onExit(({ id, code }) => {
    const output = document.getElementById('terminal-output-' + id);
    if (output) output.appendChild(document.createTextNode(`\n[Terminal exited with code ${code}]\n`));
    const tab = terminalState.tabs.find(t => t.id === id);
    if (tab) tab.dead = true;
    renderTerminalTabs();
  });
}

async function createTerminal() {
  // Limit max terminals
  const MAX_TERMINALS = 5;
  if (terminalState.tabs.filter(t => !t.dead).length >= MAX_TERMINALS) {
    showToast(`Maximum ${MAX_TERMINALS} terminals allowed. Close one first.`, 'error');
    return;
  }
  const result = await api.terminal.create();
  if (!result?.id) return;
  const id = result.id;
  terminalState.tabs.push({ id, name: `Terminal ${id}`, dead: false });
  terminalState.cmdHistory[id] = [];
  terminalState.historyIndex[id] = -1;
  terminalState.followOutput[id] = true;
  terminalState.activeId = id;

  // Create DOM for this terminal
  const container = document.getElementById('terminal-container');
  const empty = document.getElementById('terminal-empty');
  if (empty) empty.classList.add('hidden');

  const pane = document.createElement('div');
  pane.className = 'terminal-pane active';
  pane.id = 'terminal-pane-' + id;
  pane.innerHTML = `
    <div class="terminal-output" id="terminal-output-${id}"></div>
    <div class="terminal-input-bar">
      <span class="terminal-prompt-label">❯</span>
      <input class="terminal-input" id="terminal-input-${id}" placeholder="Type a command..." autofocus>
    </div>
  `;
  container.appendChild(pane);

  // Hide other panes
  container.querySelectorAll('.terminal-pane').forEach(p => {
    if (p.id !== pane.id) p.classList.remove('active');
  });

  const input = document.getElementById('terminal-input-' + id);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = input.value;
      input.value = '';
      if (cmd.trim()) {
        terminalState.cmdHistory[id].push(cmd);
        terminalState.historyIndex[id] = terminalState.cmdHistory[id].length;
      }
      api.terminal.write(id, cmd + '\r\n');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const hist = terminalState.cmdHistory[id];
      if (terminalState.historyIndex[id] > 0) {
        terminalState.historyIndex[id]--;
        input.value = hist[terminalState.historyIndex[id]] || '';
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const hist = terminalState.cmdHistory[id];
      if (terminalState.historyIndex[id] < hist.length - 1) {
        terminalState.historyIndex[id]++;
        input.value = hist[terminalState.historyIndex[id]] || '';
      } else {
        terminalState.historyIndex[id] = hist.length;
        input.value = '';
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      api.terminal.write(id, '\x03');
    } else if (e.key === 'l' && e.ctrlKey) {
      // Ctrl+L — clear terminal output
      e.preventDefault();
      const output = document.getElementById('terminal-output-' + id);
      if (output) output.innerHTML = '';
    } else if (e.key === 'Tab') {
      // Tab — send \t for shell tab-completion
      e.preventDefault();
      api.terminal.write(id, '\t');
    }
  });

  // Focus input when clicking the terminal area
  const output = pane.querySelector('.terminal-output');
  output.addEventListener('click', () => {
    input.focus();
  });
  output.addEventListener('scroll', () => {
    terminalState.followOutput[id] = output.scrollHeight - output.scrollTop - output.clientHeight < 36;
    if (terminalState.activeId === id) updateTerminalLatestButton();
  }, { passive: true });

  renderTerminalTabs();
  updateTerminalLatestButton();
  input.focus();
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
  const container = document.getElementById('terminal-container');
  container.querySelectorAll('.terminal-pane').forEach(p => p.classList.remove('active'));
  const pane = document.getElementById('terminal-pane-' + id);
  if (pane) {
    pane.classList.add('active');
    const input = document.getElementById('terminal-input-' + id);
    if (input) input.focus();
  }
  renderTerminalTabs();
  updateTerminalLatestButton();
}

function updateTerminalLatestButton() {
  const button = document.getElementById('btn-terminal-bottom');
  if (!button) return;
  button.classList.toggle('hidden', !terminalState.activeId || terminalState.followOutput[terminalState.activeId] !== false);
}

function closeTerminal(id) {
  api.terminal.kill(id);
  const pane = document.getElementById('terminal-pane-' + id);
  if (pane) pane.remove();
  terminalState.tabs = terminalState.tabs.filter(t => t.id !== id);
  delete terminalState.cmdHistory[id];
  delete terminalState.historyIndex[id];
  delete terminalState.followOutput[id];

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
      statusEl.textContent = '✅ Composer installed';
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
    applyPathSelection(SERVICE_SECTIONS, 'All services selected for system PATH');
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
  if (summary) summary.textContent = `${versionCatalog.length} services • ${totalVersions} available versions • ${installedVersions} installed`;

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
        populateSectionUI(service);
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
  populateSectionUI(service);
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
