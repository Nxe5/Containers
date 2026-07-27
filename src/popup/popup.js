let currentStatus = null;
let currentTabId = null;
let currentCookieStoreId = null;
let currentHostname = null;
let currentAction = null;
let vaultState = { exists: false, unlocked: false };
let currentCredentialMatches = [];

const BUILTIN_ORDER = ['youtube', 'gmail', 'github', 'amazon'];

async function getCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadStatus() {
  const tab = await getCurrentTab();
  currentTabId = tab?.id ?? null;
  currentCookieStoreId = tab?.cookieStoreId || 'firefox-default';

  const status = await browser.runtime.sendMessage({ type: 'get-status' });
  currentStatus = status;

  const url = tab?.url || '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      currentHostname = new URL(url).hostname;
    } catch {
      currentHostname = null;
    }
  } else {
    currentHostname = null;
  }

  vaultState = await browser.runtime.sendMessage({ type: 'vault-status' });
  if (currentHostname && vaultState.unlocked) {
    const result = await browser.runtime.sendMessage({
      type: 'vault-find-credentials-for-hostname',
      hostname: currentHostname,
    });
    const matches = result.ok ? result.result : [];
    // Surface the credential(s) tagged to the tab's own container first, so
    // the same site in different containers (e.g. personal Gmail vs. a work
    // account) fills the login that belongs to where you actually are.
    const ck = containerKeyForCookieStoreId(currentCookieStoreId);
    currentCredentialMatches = matches
      .slice()
      .sort((a, b) => (b.containerKey === ck) - (a.containerKey === ck));
  } else {
    currentCredentialMatches = [];
  }

  return { status, tab };
}

// Reverse-lookup a tab's cookieStoreId to the built-in/custom container key
// used to tag vault credentials. Mirrors getContainerKeyByCookieStoreId in
// lib/rules.js, but runs in the popup against the status snapshot.
function containerKeyForCookieStoreId(cookieStoreId) {
  if (!cookieStoreId || !currentStatus) return null;
  const s = currentStatus.settings || {};
  for (const [key, cfg] of Object.entries(s.companies || {})) {
    if (cfg?.cookieStoreId === cookieStoreId) return key;
  }
  for (const [key, cfg] of Object.entries(s.customContainers || {})) {
    if (cfg?.cookieStoreId === cookieStoreId) return key;
  }
  return null;
}

function containerLabelForKey(key) {
  if (!key) return '';
  return (
    currentStatus?.domainData?.[key]?.label ||
    currentStatus?.settings?.customContainers?.[key]?.label ||
    key
  );
}

function getContainerConfig(key) {
  return currentStatus.settings.companies[key] || currentStatus.settings.customContainers[key];
}

function getAllContainerEntries() {
  const entries = [];
  // Built-in first, in fixed order.
  for (const key of BUILTIN_ORDER) {
    const meta = currentStatus.domainData[key];
    const cfg = getContainerConfig(key);
    if (meta && cfg?.cookieStoreId) {
      entries.push({ key, label: meta.label, color: meta.color, cookieStoreId: cfg.cookieStoreId, builtIn: true });
    }
  }
  // Custom containers alphabetical by label.
  const custom = Object.entries(currentStatus.settings.customContainers || {})
    .map(([key, cfg]) => ({ key, ...cfg, builtIn: false }))
    .filter((c) => c.cookieStoreId)
    .sort((a, b) => a.label.localeCompare(b.label));
  for (const c of custom) {
    entries.push({ key: c.key, label: c.label, color: c.color, cookieStoreId: c.cookieStoreId, builtIn: false });
  }
  return entries;
}

function renderContainerList(containerEl, filter = '') {
  containerEl.innerHTML = '';
  const entries = getAllContainerEntries();
  const term = filter.toLowerCase();

  // Default / no container option.
  if ('default'.includes(term) || 'no container'.includes(term)) {
    containerEl.appendChild(buildItem({
      label: 'Default (no container)',
      color: 'transparent',
      cookieStoreId: 'firefox-default',
      subtitle: '',
    }));
  }

  // Temporary container option.
  if ('temporary'.includes(term) || 'temp'.includes(term)) {
    containerEl.appendChild(buildItem({
      label: 'Temporary Container',
      color: 'toolbar',
      cookieStoreId: '__temp__',
      subtitle: '',
    }));
  }

  for (const entry of entries) {
    if (term && !entry.label.toLowerCase().includes(term)) continue;
    containerEl.appendChild(buildItem(entry));
  }
}

function buildItem({ label, color, cookieStoreId, subtitle = '', key = '' }) {
  const item = document.createElement('div');
  item.className = 'container-item';
  item.dataset.cookieStoreId = cookieStoreId;
  if (key) item.dataset.key = key;

  const dot = document.createElement('span');
  dot.className = 'dot';
  if (color === 'transparent') {
    dot.style.background = 'transparent';
    dot.style.border = '1px solid var(--border)';
  } else {
    dot.style.background = color === 'toolbar' ? '#8f8f8f' : color;
  }
  item.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  item.appendChild(name);

  if (subtitle) {
    const sub = document.createElement('span');
    sub.className = 'subtitle';
    sub.textContent = subtitle;
    item.appendChild(sub);
  }

  item.addEventListener('click', () => onContainerClick(cookieStoreId, label));
  return item;
}

function showPage(name) {
  document.getElementById('page-home').classList.toggle('hidden', name !== 'home');
  document.getElementById('page-select').classList.toggle('hidden', name !== 'select');
}

function openSelectionPage(action) {
  currentAction = action;
  const titleMap = {
    new: 'Open new tab in…',
    reopen: 'Reopen this site in…',
    always: 'Always open this site in…',
  };
  document.getElementById('selectTitle').textContent = titleMap[action] || 'Choose container';
  document.getElementById('selectSearch').value = '';
  renderContainerList(document.getElementById('selectContainers'), '');
  showPage('select');
}

async function onContainerClick(cookieStoreId, label) {
  if (currentAction === 'new') {
    await openEmptyTab(cookieStoreId, false);
  } else if (currentAction === 'reopen') {
    await reopenCurrentSite(cookieStoreId);
  } else if (currentAction === 'always') {
    if (currentHostname) {
      await browser.runtime.sendMessage({
        type: 'add-user-rule',
        hostname: currentHostname,
        cookieStoreId,
      });
    }
    await reopenCurrentSite(cookieStoreId);
  } else {
    // Home container list click: reopen the current page in the chosen container.
    if (currentHostname) {
      const replace = document.getElementById('replaceToggle').checked;
      await reopenCurrentSite(cookieStoreId, replace);
    } else {
      await openEmptyTab(cookieStoreId, false);
    }
  }
  window.close();
}

async function openEmptyTab(cookieStoreId, replace) {
  let targetId = cookieStoreId;
  if (cookieStoreId === '__temp__') {
    const resp = await browser.runtime.sendMessage({ type: 'create-temp-container' });
    targetId = resp.cookieStoreId;
  }
  await browser.runtime.sendMessage({
    type: 'open-empty-tab',
    cookieStoreId: targetId,
    replace,
  });
}

async function reopenCurrentSite(cookieStoreId, replace = null) {
  let targetId = cookieStoreId;
  if (cookieStoreId === '__temp__') {
    const resp = await browser.runtime.sendMessage({ type: 'create-temp-container' });
    targetId = resp.cookieStoreId;
  }
  const msg = {
    type: 'reopen-tab',
    tabId: currentTabId,
    cookieStoreId: targetId,
  };
  if (replace !== null) msg.replace = replace;
  await browser.runtime.sendMessage(msg);
}

function renderHome() {
  const status = currentStatus;

  // Site hint.
  const siteHint = document.getElementById('siteHint');
  const reopenBtn = document.querySelector('[data-action="reopen"]');
  const alwaysBtn = document.querySelector('[data-action="always"]');

  if (currentHostname) {
    siteHint.textContent = currentHostname;
    reopenBtn.disabled = false;
    alwaysBtn.disabled = false;
  } else {
    siteHint.textContent = 'No website active in this tab';
    reopenBtn.disabled = true;
    alwaysBtn.disabled = true;
  }

  // Fill login button.
  const fillBtn = document.getElementById('fillLoginBtn');
  if (currentCredentialMatches.length > 0) {
    fillBtn.classList.remove('hidden');
    fillBtn.disabled = false;
    fillBtn.textContent =
      currentCredentialMatches.length === 1
        ? `Fill login (${currentCredentialMatches[0].account || 'saved'})`
        : `Fill login (${currentCredentialMatches.length} saved)`;
  } else if (currentHostname && vaultState.exists && !vaultState.unlocked) {
    fillBtn.classList.remove('hidden');
    fillBtn.disabled = true;
    fillBtn.textContent = 'Unlock vault in Options to fill';
  } else {
    fillBtn.classList.add('hidden');
  }

  // Toggles.
  document.getElementById('isolateToggle').checked = status.settings.isolateUnmatched !== false;
  document.getElementById('replaceToggle').checked = status.settings.replaceTabInsteadOfNew === true;
  document.getElementById('stickyToggle').checked = status.settings.stickyContainers === true;
  document.getElementById('authFlowToggle').checked = status.settings.preserveAuthFlows !== false;
  document.getElementById('linkedTabToggle').checked = status.settings.keepLinkedTabsInContainer !== false;

  // Container list.
  renderContainerList(document.getElementById('homeContainers'), document.getElementById('homeSearch').value);
}

function renderExtensionToggle() {
  const enabled = currentStatus.settings.extensionEnabled !== false;
  const btn = document.getElementById('extensionToggleBtn');
  btn.textContent = enabled ? 'Extension Enabled — Click to Disable' : 'Extension Disabled — Click to Enable';
  btn.classList.toggle('is-disabled', !enabled);
  document.getElementById('extensionToggleHint').classList.toggle('hidden', enabled);
}

async function setExtensionEnabled(value) {
  await browser.runtime.sendMessage({ type: 'set-extension-enabled', value });
  await loadStatus();
  renderExtensionToggle();
}

function bindExtensionToggle() {
  renderExtensionToggle();

  const overlay = document.getElementById('disableConfirmOverlay');

  document.getElementById('extensionToggleBtn').addEventListener('click', () => {
    const enabled = currentStatus.settings.extensionEnabled !== false;
    if (enabled) {
      overlay.classList.remove('hidden');
    } else {
      setExtensionEnabled(true);
    }
  });

  document.getElementById('disableConfirmCancel').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });

  document.getElementById('disableConfirmOk').addEventListener('click', async () => {
    overlay.classList.add('hidden');
    await setExtensionEnabled(false);
  });
}

function bindHeaderOptions() {
  document.getElementById('openOptions').addEventListener('click', () => {
    browser.runtime.openOptionsPage();
    window.close();
  });
}

async function init() {
  await loadStatus();
  bindExtensionToggle();
  bindHeaderOptions();
  if (!currentTabId) {
    document.getElementById('siteHint').textContent = 'No active tab';
    return;
  }
  renderHome();

  // Home action buttons.
  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      openSelectionPage(btn.dataset.action);
    });
  });

  // Search inputs.
  document.getElementById('homeSearch').addEventListener('input', (e) => {
    renderContainerList(document.getElementById('homeContainers'), e.target.value);
  });
  document.getElementById('selectSearch').addEventListener('input', (e) => {
    renderContainerList(document.getElementById('selectContainers'), e.target.value);
  });

  // Back button.
  document.getElementById('backButton').addEventListener('click', () => {
    currentAction = null;
    showPage('home');
  });

  // Toggles.
  document.getElementById('isolateToggle').addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({
      type: 'set-isolate-unmatched',
      value: e.target.checked,
    });
    await loadStatus();
  });

  document.getElementById('replaceToggle').addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({
      type: 'set-replace-tab',
      value: e.target.checked,
    });
    await loadStatus();
  });

  document.getElementById('stickyToggle').addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({
      type: 'set-sticky-containers',
      value: e.target.checked,
    });
    await loadStatus();
  });

  document.getElementById('authFlowToggle').addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({
      type: 'set-preserve-auth-flows',
      value: e.target.checked,
    });
    await loadStatus();
  });

  document.getElementById('linkedTabToggle').addEventListener('change', async (e) => {
    await browser.runtime.sendMessage({
      type: 'set-keep-linked-tabs',
      value: e.target.checked,
    });
    await loadStatus();
  });

  // Fill login button.
  document.getElementById('fillLoginBtn').addEventListener('click', () => {
    if (currentCredentialMatches.length === 0 || !currentTabId) return;

    // If exactly one saved login belongs to the tab's own container, that's
    // unambiguously the right one — fill it directly. Otherwise (several
    // container matches, or none tagged) let the user pick instead of
    // silently guessing.
    const ck = containerKeyForCookieStoreId(currentCookieStoreId);
    const containerMatches = currentCredentialMatches.filter(
      (c) => c.containerKey && c.containerKey === ck
    );
    if (containerMatches.length === 1) {
      fillCredential(containerMatches[0]);
    } else if (currentCredentialMatches.length === 1) {
      fillCredential(currentCredentialMatches[0]);
    } else {
      openFillPicker();
    }
  });

  document.getElementById('fillPickerCancel').addEventListener('click', () => {
    document.getElementById('fillPickerOverlay').classList.add('hidden');
  });
}

async function fillCredential(cred) {
  try {
    await browser.tabs.executeScript(currentTabId, {
      file: '/src/content/fill-login.js',
    });
    await browser.tabs.sendMessage(currentTabId, {
      type: 'fill-login-credential',
      account: cred.account,
      password: cred.password,
    });
  } catch (err) {
    console.error('[Better Containers] fill login failed', err);
  }
  window.close();
}

function openFillPicker() {
  const overlay = document.getElementById('fillPickerOverlay');
  const list = document.getElementById('fillPickerList');
  const ck = containerKeyForCookieStoreId(currentCookieStoreId);
  list.innerHTML = '';

  for (const cred of currentCredentialMatches) {
    const btn = document.createElement('button');
    btn.className = 'secondary fill-picker-item';

    const account = document.createElement('span');
    account.className = 'fill-picker-account';
    account.textContent = cred.account || '(no username)';
    btn.appendChild(account);

    const label = containerLabelForKey(cred.containerKey);
    if (label) {
      const meta = document.createElement('span');
      meta.className = 'fill-picker-container';
      meta.textContent =
        cred.containerKey === ck ? `${label} · this container` : label;
      btn.appendChild(meta);
    }

    btn.addEventListener('click', () => fillCredential(cred));
    list.appendChild(btn);
  }

  overlay.classList.remove('hidden');
}

init().catch((err) => {
  console.error('[Better Containers popup]', err);
  document.getElementById('siteHint').textContent = 'Error loading popup';
});
