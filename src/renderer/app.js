/* ===== KitsuneServ – Renderer (profile-aware) ===== */
'use strict';

const api = window.kitsuneAPI;

// Sections that have profiles (not general)
const SERVICE_SECTIONS = ['apache', 'nginx', 'caddy', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'php', 'node', 'go', 'bun', 'redis', 'memcached', 'minio', 'python', 'deno'];

// Version map loaded from backend (downloads.json)
let VERSION_MAP = {};

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
let diskUsageMap = {};
const DB_SECTIONS = ['postgresql', 'mysql', 'mariadb', 'mongodb'];
const dbState = {}; // { section: { currentDb, currentTable, loaded } }
const dbQueryHistory = {}; // { section: [query1, query2, ...] }
const serviceUptime = {}; // { section: startTimestamp }

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', async () => {
  // Load version map from backend (downloads.json)
  try { VERSION_MAP = await api.download.getVersions(); } catch { VERSION_MAP = {}; }
  config = await api.config.get();
  bindWindowControls();
  bindNavigation();
  bindSidebarServiceControls();
  bindSaveBarButtons();
  bindProfileModal();
  bindEnvVarButtons();
  bindStopAllAndReset();
  bindSidebarGroupChecks();
  bindDashboardToolbar();
  initSubTabs();
  initDbViewers();
  initLogViewers();
  initProjectManagers();
  bindFolderButtons();
  initTerminal();
  initCommandPalette();
  initComposer();
  initAppStore();
  initCollapsibleGroups();
  bindShortcutsModal();
  populateUI();
  startStatusPolling();
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
  if (panelId === 'appstore') refreshAppStore();
}

function bindNavigation() {
  const navItems = document.querySelectorAll('.nav-item[data-panel]');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't switch panel if click was on a nav-btn
      if (e.target.closest('.nav-controls')) return;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + item.dataset.panel);
      if (panel) panel.classList.add('active');
      // Refresh App Store when switching to it
      if (item.dataset.panel === 'appstore') refreshAppStore();
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
          // Auto-download then retry
          const profile = getActiveProfile(section);
          if (profile) {
            const dlKey = resolveDownloadKey(profile, section);
            await api.download.install(dlKey, profile.version);
          }
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
        // Auto-update PATH if entries are currently added
        if (pathAdded) {
          const pathResult = await api.path.add();
          if (pathResult.success) updatePathUI({ added: true, entries: pathResult.entries });
        }
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
  const versions = VERSION_MAP[key] || [];
  versionSelect.innerHTML = '';
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    versionSelect.appendChild(opt);
  }
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

  // Download All Missing
  document.getElementById('dash-download-all')?.addEventListener('click', async () => {
    let count = 0;
    for (const section of SERVICE_SECTIONS) {
      if (installedMap[section]) continue;
      const profile = getActiveProfile(section);
      if (!profile) continue;
      const dlKey = resolveDownloadKey(profile, section);
      count++;
      api.download.install(dlKey, profile.version);
    }
    if (count === 0) showToast('All services already installed', 'success');
    else showToast(`Downloading ${count} missing service(s)...`, 'success');
  });
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
        }
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
        }
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
  const versions = VERSION_MAP[type] || [];
  const profile = getActiveProfile(section);
  const activeVersion = profile?.version || '';
  versionSelect.innerHTML = '';
  for (const v of versions) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    versionSelect.appendChild(opt);
  }
  // If current profile version isn't in the list, add it
  if (activeVersion && !versions.includes(activeVersion)) {
    const opt = document.createElement('option');
    opt.value = activeVersion;
    opt.textContent = activeVersion + ' (custom)';
    versionSelect.appendChild(opt);
  }
  if (activeVersion) versionSelect.value = activeVersion;
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
    el.innerHTML = `<span class="installed-badge">✓ ${escapeHtml(dlKey)} ${escapeHtml(profile.version)} installed</span><button class="btn-remove-version" data-dl-key="${escapeHtml(dlKey)}" data-dl-version="${escapeHtml(profile.version)}" title="Delete this version from disk">🗑 Remove</button>`;
    el.querySelector('.btn-remove-version').addEventListener('click', async () => {
      if (!confirm(`Delete ${dlKey} ${profile.version} from disk? The downloaded binaries will be removed.`)) return;
      const result = await api.download.remove(dlKey, profile.version);
      if (result.success) {
        showToast(`${dlKey} ${profile.version} removed`, 'success');
        updateInstallStatus(section, profile);
        refreshStatuses();
      } else {
        showToast(result.error || 'Remove failed', 'error');
      }
    });
  } else {
    el.innerHTML = `<span class="not-installed-badge" data-dl-key="${escapeHtml(dlKey)}" data-dl-version="${escapeHtml(profile.version)}">⬇ Download ${escapeHtml(dlKey)} ${escapeHtml(profile.version)}</span>`;
    el.querySelector('.not-installed-badge').addEventListener('click', async () => {
      await api.download.install(dlKey, profile.version);
    });
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
          if (p) await api.download.install(resolveDownloadKey(p, section), p.version);
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
      const p = getActiveProfile(section);
      const port = p?.port || 80;
      const proto = section === 'minio' ? `http://localhost:${p?.consolePort || 9001}` : `http://localhost:${port}`;
      api.shell.openExternal(proto);
    });
    if (copyBtn) copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = getActiveProfile(section);
      const port = p?.port || 80;
      const url = section === 'minio' ? `http://localhost:${p?.consolePort || 9001}` : `http://localhost:${port}`;
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
      serviceUptime[section] = Date.now();
    } else if (!running) {
      delete serviceUptime[section];
    }
    // Display uptime in sidebar
    let uptimeEl = controls.querySelector('.nav-uptime');
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
  // Find which section this download belongs to
  const section = findSectionForDownload(service);
  if (!section) return;

  const container = document.getElementById('progress-' + section);
  const label = document.getElementById('progress-label-' + section);
  const fill = document.getElementById('progress-fill-' + section);

  if (!container) return;

  if (stage === 'done') {
    container.classList.add('hidden');
    if (fill) { fill.style.width = '100%'; fill.classList.add('complete'); }
    // Refresh install status + sidebar (version colors, play button)
    const profile = getActiveProfile(section);
    if (profile) updateInstallStatus(section, profile);
    refreshStatuses();
    showToast(`${service} ${version} installed`, 'success');
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
    const placeholder = section === 'mongodb' ? 'Enter MongoDB expression...' : 'Enter SQL query...';

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

    container.querySelector('[data-action="clear"]').addEventListener('click', () => {
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
  // Apache document root
  const apacheDocRootBtn = document.getElementById('btn-open-apache-docroot');
  if (apacheDocRootBtn) {
    apacheDocRootBtn.addEventListener('click', () => {
      const docRoot = document.getElementById('apache-documentRoot').value || './www';
      api.shell.openPath(docRoot);
    });
  }
  // Nginx document root
  const nginxDocRootBtn = document.getElementById('btn-open-nginx-docroot');
  if (nginxDocRootBtn) {
    nginxDocRootBtn.addEventListener('click', () => {
      const docRoot = document.getElementById('nginx-documentRoot').value || './www';
      api.shell.openPath(docRoot);
    });
  }
  // Caddy document root
  const caddyDocRootBtn = document.getElementById('btn-open-caddy-docroot');
  if (caddyDocRootBtn) {
    caddyDocRootBtn.addEventListener('click', () => {
      const docRoot = document.getElementById('caddy-documentRoot').value || './www';
      api.shell.openPath(docRoot);
    });
  }
}

/* ===== Built-in Terminal ===== */
const terminalState = { tabs: [], activeId: null, cmdHistory: {}, historyIndex: {} };

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

  // Listen for terminal data from backend
  api.terminal.onData(({ id, data }) => {
    const output = document.getElementById('terminal-output-' + id);
    if (!output) return;

    // Strip non-SGR escape sequences (cursor movement, etc.) but keep colors
    const cleaned = data.replace(/\x1b\[[0-9;]*[A-HJKSTfhlm]/g, (m) => {
      return m.endsWith('m') ? m : ''; // Keep only SGR (color) sequences
    });

    output.appendChild(parseAnsi(cleaned));

    // Limit terminal buffer to prevent memory leak
    const MAX_TERMINAL_NODES = 5000;
    while (output.childNodes.length > MAX_TERMINAL_NODES) {
      output.removeChild(output.firstChild);
    }
    output.scrollTop = output.scrollHeight;
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
      <span class="terminal-prompt-label">&gt;</span>
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
  pane.querySelector('.terminal-output').addEventListener('click', () => {
    input.focus();
  });

  renderTerminalTabs();
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
}

function closeTerminal(id) {
  api.terminal.kill(id);
  const pane = document.getElementById('terminal-pane-' + id);
  if (pane) pane.remove();
  terminalState.tabs = terminalState.tabs.filter(t => t.id !== id);
  delete terminalState.cmdHistory[id];
  delete terminalState.historyIndex[id];

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
let pathAdded = false;

async function initPathManagement() {
  const btn = document.getElementById('btn-path-toggle');
  if (!btn) return;

  const st = await api.path.getStatus();
  pathAdded = st.added;
  updatePathUI(st);

  btn.addEventListener('click', async () => {
    if (pathAdded) {
      const result = await api.path.remove();
      if (result.success) {
        pathAdded = false;
        showToast('Server paths removed from system PATH', 'success');
        updatePathUI({ added: false, entries: [] });
      } else {
        showToast(result.error || 'Failed to update PATH', 'error');
      }
    } else {
      const result = await api.path.add();
      if (result.success) {
        pathAdded = true;
        showToast('Server paths added to system PATH', 'success');
        updatePathUI({ added: true, entries: result.entries });
      } else {
        showToast(result.error || 'Failed to update PATH', 'error');
      }
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
      showToast('Config imported successfully', 'success');
    } else if (result.error) {
      showToast(result.error, 'error');
    }
  });
}

function updatePathUI(st) {
  const btn = document.getElementById('btn-path-toggle');
  const entries = document.getElementById('path-entries');
  if (!btn) return;

  if (st.added) {
    btn.textContent = '🗑 Remove from System PATH';
    btn.className = 'btn btn-path-remove';
  } else {
    btn.textContent = '📁 Add to System PATH';
    btn.className = 'btn btn-path-add';
  }

  if (entries) {
    if (st.entries?.length) {
      entries.innerHTML = st.entries.map(e => `<div class="path-entry">${escapeHtml(e)}</div>`).join('');
    } else {
      entries.innerHTML = '<div class="path-entry">No server binaries installed yet</div>';
    }
  }
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
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-panel="${panel}"]`);
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + panel)?.classList.add('active');
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
