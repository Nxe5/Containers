const COLORS = [
  'blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'toolbar',
];

const ICONS = [
  'fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift',
  'vacation', 'food', 'fruit', 'pet', 'tree', 'chill', 'fence',
];

const BUILTIN_KEYS = new Set(['google', 'microsoft', 'meta']);

let currentStatus = null;

async function loadStatus() {
  const status = await browser.runtime.sendMessage({ type: 'get-status' });
  currentStatus = status;
  return status;
}

function $(id) { return document.getElementById(id); }

function populateSelect(select, values, selected) {
  select.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    if (v === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderGlobals() {
  const s = currentStatus.settings;
  $('isolateUnmatched').checked = s.isolateUnmatched !== false;
  $('tempPrefix').value = s.tempPrefix || 'Temp';
  populateSelect($('tempColor'), COLORS, s.tempColor || 'toolbar');
  populateSelect($('tempIcon'), ICONS, s.tempIcon || 'circle');
}

function renderBuiltinCompanies() {
  const container = $('companies');
  container.innerHTML = '';

  for (const [key, meta] of Object.entries(currentStatus.domainData || {})) {
    if (!BUILTIN_KEYS.has(key)) continue;

    const cfg = currentStatus.settings.companies[key] || { enabled: true };
    const containerInfo = currentStatus.containers[cfg.cookieStoreId];
    const effective = currentStatus.settings.domainOverrides?.[key] || meta.domains;

    const card = document.createElement('div');
    card.className = 'company-card';
    card.innerHTML = `
      <div class="company-header">
        <span class="company-title">
          <span class="dot" style="background:${meta.color === 'toolbar' ? '#8f8f8f' : meta.color}"></span>
          ${escapeHtml(meta.label)}
          <label class="toggle" style="margin-left:8px">
            <input type="checkbox" data-key="${key}" ${cfg.enabled ? 'checked' : ''} />
            <span>Enabled</span>
          </label>
        </span>
        <span class="company-actions">
          <button class="secondary small save-domains" data-key="${key}">Save domains</button>
          <button class="secondary small reset-domains" data-key="${key}">Reset</button>
        </span>
      </div>
      <p class="hint">Container: ${containerInfo ? escapeHtml(containerInfo.name) : 'not created yet'}</p>
      <textarea data-key="${key}">${effective.join('\n')}</textarea>
    `;
    container.appendChild(card);
  }

  container.addEventListener('change', async (e) => {
    if (e.target.matches('input[type="checkbox"][data-key]')) {
      const key = e.target.dataset.key;
      await browser.runtime.sendMessage({
        type: 'set-company-enabled',
        key,
        enabled: e.target.checked,
      });
      await loadStatus();
    }
  });

  container.addEventListener('click', async (e) => {
    if (e.target.matches('.save-domains')) {
      const key = e.target.dataset.key;
      const textarea = container.querySelector(`textarea[data-key="${key}"]`);
      const list = textarea.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const overrides = { ...(currentStatus.settings.domainOverrides || {}), [key]: list };
      await browser.runtime.sendMessage({
        type: 'update-settings',
        settings: { domainOverrides: overrides },
      });
      await loadStatus();
      e.target.textContent = 'Saved';
      setTimeout(() => (e.target.textContent = 'Save domains'), 1200);
    }

    if (e.target.matches('.reset-domains')) {
      const key = e.target.dataset.key;
      const overrides = { ...(currentStatus.settings.domainOverrides || {}) };
      delete overrides[key];
      await browser.runtime.sendMessage({
        type: 'update-settings',
        settings: { domainOverrides: overrides },
      });
      await loadStatus();
      renderBuiltinCompanies();
    }
  });
}

function renderCustomContainers() {
  const section = $('customContainers');
  section.innerHTML = '';

  const custom = currentStatus.settings.customContainers || {};
  for (const [key, cfg] of Object.entries(custom)) {
    section.appendChild(buildCustomContainerCard(key, cfg));
  }
}

function buildCustomContainerCard(key, cfg) {
  const card = document.createElement('div');
  card.className = 'company-card custom-card';
  card.dataset.key = key;

  const colorSelectId = `cc-color-${key}`;
  const iconSelectId = `cc-icon-${key}`;

  card.innerHTML = `
    <div class="company-header">
      <span class="company-title">
        <span class="dot" style="background:${cfg.color === 'toolbar' ? '#8f8f8f' : cfg.color}"></span>
        <input type="text" class="inline-name" value="${escapeHtml(cfg.label)}" placeholder="Container name" />
      </span>
      <span class="company-actions">
        <label class="toggle" style="margin-right:8px">
          <input type="checkbox" class="enabled-toggle" ${cfg.enabled !== false ? 'checked' : ''} />
          <span>Enabled</span>
        </label>
        <button class="secondary small save-custom">Save</button>
        <button class="danger small delete-custom">Delete</button>
      </span>
    </div>
    <div class="grid three">
      <label>
        Color
        <select class="color-select" id="${colorSelectId}"></select>
      </label>
      <label>
        Icon
        <select class="icon-select" id="${iconSelectId}"></select>
      </label>
      <label>
        Key
        <input type="text" class="key-display" value="${escapeHtml(key)}" readonly />
      </label>
    </div>
    <label style="margin-top:8px">Domains (one per line)</label>
    <textarea class="domains-textarea">${(cfg.domains || []).join('\n')}</textarea>
  `;

  populateSelect(card.querySelector('.color-select'), COLORS, cfg.color || 'toolbar');
  populateSelect(card.querySelector('.icon-select'), ICONS, cfg.icon || 'circle');

  card.querySelector('.save-custom').addEventListener('click', async () => {
    await saveCustomContainer(card, key);
  });

  card.querySelector('.delete-custom').addEventListener('click', async () => {
    if (!confirm(`Delete container "${cfg.label}"?`)) return;
    await browser.runtime.sendMessage({ type: 'delete-custom-container', key });
    await loadStatus();
    renderCustomContainers();
  });

  return card;
}

async function saveCustomContainer(card, originalKey) {
  const label = card.querySelector('.inline-name').value.trim();
  if (!label) {
    card.querySelector('.inline-name').style.borderColor = '#d70022';
    return;
  }
  card.querySelector('.inline-name').style.borderColor = '';

  const custom = { ...(currentStatus.settings.customContainers || {}) };
  custom[originalKey] = {
    label,
    color: card.querySelector('.color-select').value,
    icon: card.querySelector('.icon-select').value,
    domains: card.querySelector('.domains-textarea').value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    enabled: card.querySelector('.enabled-toggle').checked,
    cookieStoreId: custom[originalKey]?.cookieStoreId || null,
  };

  await browser.runtime.sendMessage({
    type: 'update-settings',
    settings: { customContainers: custom },
  });

  await loadStatus();
  renderCustomContainers();
}

async function addCustomContainer() {
  const custom = { ...(currentStatus.settings.customContainers || {}) };
  let n = 1;
  while (custom[`custom${n}`] || BUILTIN_KEYS.has(`custom${n}`)) n++;
  const key = `custom${n}`;
  custom[key] = {
    label: `Custom ${n}`,
    color: 'purple',
    icon: 'briefcase',
    domains: [],
    enabled: true,
    cookieStoreId: null,
  };
  await browser.runtime.sendMessage({
    type: 'update-settings',
    settings: { customContainers: custom },
  });
  await loadStatus();
  renderCustomContainers();
}

function renderUserRules() {
  const tbody = $('userRules').querySelector('tbody');
  tbody.innerHTML = '';
  const containers = Object.values(currentStatus.containers || {});

  const addRow = (hostname = '', cookieStoreId = '') => {
    const tr = document.createElement('tr');

    const hostTd = document.createElement('td');
    const hostInput = document.createElement('input');
    hostInput.type = 'text';
    hostInput.value = hostname;
    hostInput.placeholder = 'example.com';
    hostTd.appendChild(hostInput);

    const containerTd = document.createElement('td');
    const select = document.createElement('select');
    const defOpt = document.createElement('option');
    defOpt.value = 'firefox-default';
    defOpt.textContent = 'Default (no container)';
    if (cookieStoreId === 'firefox-default') defOpt.selected = true;
    select.appendChild(defOpt);

    for (const c of containers) {
      const opt = document.createElement('option');
      opt.value = c.cookieStoreId;
      opt.textContent = c.name;
      if (c.cookieStoreId === cookieStoreId) opt.selected = true;
      select.appendChild(opt);
    }
    containerTd.appendChild(select);

    const removeTd = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.className = 'secondary small';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      tr.remove();
      saveUserRules();
    });
    removeTd.appendChild(removeBtn);

    tr.appendChild(hostTd);
    tr.appendChild(containerTd);
    tr.appendChild(removeTd);
    tbody.appendChild(tr);

    hostInput.addEventListener('change', saveUserRules);
    select.addEventListener('change', saveUserRules);
  };

  for (const [hostname, cookieStoreId] of Object.entries(
    currentStatus.settings.userRules || {}
  )) {
    addRow(hostname, cookieStoreId);
  }

  $('addUserRule').onclick = () => {
    addRow();
  };
}

async function saveUserRules() {
  const rules = {};
  const rows = $('userRules').querySelectorAll('tbody tr');
  for (const row of rows) {
    const hostname = row.querySelector('input').value.trim();
    const cookieStoreId = row.querySelector('select').value;
    if (hostname) {
      rules[hostname] = cookieStoreId;
    }
  }
  await browser.runtime.sendMessage({
    type: 'update-settings',
    settings: { userRules: rules },
  });
  await loadStatus();
}

async function saveGlobals() {
  await browser.runtime.sendMessage({
    type: 'update-settings',
    settings: {
      isolateUnmatched: $('isolateUnmatched').checked,
      tempPrefix: $('tempPrefix').value.trim() || 'Temp',
      tempColor: $('tempColor').value,
      tempIcon: $('tempIcon').value,
    },
  });
  await loadStatus();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function init() {
  await loadStatus();
  renderGlobals();
  renderBuiltinCompanies();
  renderCustomContainers();
  renderUserRules();

  $('isolateUnmatched').addEventListener('change', saveGlobals);
  $('tempPrefix').addEventListener('change', saveGlobals);
  $('tempColor').addEventListener('change', saveGlobals);
  $('tempIcon').addEventListener('change', saveGlobals);

  $('addCustomContainer').addEventListener('click', async () => {
    await addCustomContainer();
  });

  $('gcNow').addEventListener('click', async () => {
    const result = await browser.runtime.sendMessage({ type: 'gc-temp-containers' });
    $('gcResult').textContent = `Removed ${result.removed.length}`;
  });

  $('resetAll').addEventListener('click', async () => {
    if (!confirm('Reset all settings and recreate default containers?')) return;
    await browser.runtime.sendMessage({ type: 'reset-settings' });
    await loadStatus();
    renderGlobals();
    renderBuiltinCompanies();
    renderCustomContainers();
    renderUserRules();
  });
}

init().catch((err) => {
  console.error('[Company Containers options]', err);
  document.body.insertAdjacentHTML('afterbegin', `<p class="hint" style="color:#d70022">Error loading options: ${escapeHtml(err.message)}</p>`);
});
