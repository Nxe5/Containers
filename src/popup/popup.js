let currentStatus = null;
let currentTabId = null;
let currentHostname = null;
let currentAction = null;

const BUILTIN_ORDER = ['google', 'microsoft', 'meta'];

async function getCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function loadStatus() {
  const tab = await getCurrentTab();
  currentTabId = tab?.id ?? null;

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

  return { status, tab };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  const dotColor = color === 'toolbar' ? '#8f8f8f' : (color === 'transparent' ? 'transparent' : color);
  const dotStyle = color === 'transparent'
    ? 'background:transparent;border:1px solid var(--border)'
    : `background:${dotColor}`;

  item.innerHTML = `
    <span class="dot" style="${dotStyle}"></span>
    <span class="name">${escapeHtml(label)}</span>
    ${subtitle ? `<span class="subtitle">${escapeHtml(subtitle)}</span>` : ''}
  `;

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

  // Toggles.
  document.getElementById('isolateToggle').checked = status.settings.isolateUnmatched !== false;
  document.getElementById('replaceToggle').checked = status.settings.replaceTabInsteadOfNew === true;

  // Container list.
  renderContainerList(document.getElementById('homeContainers'), document.getElementById('homeSearch').value);
}

async function init() {
  await loadStatus();
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

  // Options link.
  document.getElementById('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    browser.runtime.openOptionsPage();
    window.close();
  });
}

init().catch((err) => {
  console.error('[Company Containers popup]', err);
  document.getElementById('siteHint').textContent = 'Error loading popup';
});
