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

async function vaultCall(type, payload = {}) {
  return browser.runtime.sendMessage({ type, ...payload });
}

function getContainerOptions() {
  const opts = [{ key: '', label: '(none)' }];
  for (const key of BUILTIN_KEYS) {
    const meta = currentStatus.domainData[key];
    if (meta) opts.push({ key, label: meta.label });
  }
  for (const [key, cfg] of Object.entries(currentStatus.settings.customContainers || {})) {
    opts.push({ key, label: cfg.label });
  }
  return opts;
}

function wrapLabel(text, input) {
  const label = document.createElement('label');
  label.appendChild(document.createTextNode(text));
  label.appendChild(input);
  return label;
}

function inputCell(type, value, placeholder) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.placeholder = placeholder || '';
  input.autocomplete = 'off';
  return input;
}

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

const PROXY_TYPES = [
  ['', 'None (direct)'],
  ['http', 'HTTP'],
  ['https', 'HTTPS'],
  ['socks', 'SOCKS5'],
  ['socks4', 'SOCKS4'],
];

function buildProxyBlock(key, proxyConfig) {
  const wrap = document.createElement('div');
  wrap.className = 'proxy-block';

  const heading = document.createElement('p');
  heading.className = 'hint';
  heading.textContent = 'Proxy (routes this container\'s traffic)';
  wrap.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'grid three';

  const typeSelect = document.createElement('select');
  for (const [value, label] of PROXY_TYPES) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (value === (proxyConfig?.type || '')) o.selected = true;
    typeSelect.appendChild(o);
  }

  const hostInput = inputCell('text', proxyConfig?.host, 'proxy.example.com');
  const portInput = inputCell('text', proxyConfig?.port, '1080');

  grid.append(
    wrapLabel('Proxy type', typeSelect),
    wrapLabel('Proxy host', hostInput),
    wrapLabel('Proxy port', portInput)
  );

  const authGrid = document.createElement('div');
  authGrid.className = 'grid three';

  const userInput = inputCell('text', '', 'Proxy username (optional)');
  const passInput = inputCell('password', '', 'Leave blank to keep existing');

  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary small';
  saveBtn.textContent = 'Save proxy';
  saveBtn.addEventListener('click', async () => {
    if (!typeSelect.value || !hostInput.value.trim() || !portInput.value.trim()) {
      await browser.runtime.sendMessage({ type: 'delete-container-proxy', key });
    } else {
      await browser.runtime.sendMessage({
        type: 'set-container-proxy',
        key,
        proxyType: typeSelect.value,
        host: hostInput.value.trim(),
        port: portInput.value.trim(),
      });
    }

    if (userInput.value || passInput.value) {
      const result = await vaultCall('vault-set-proxy-credential', {
        containerKey: key,
        username: userInput.value,
        password: passInput.value,
      });
      if (!result.ok) {
        alert(`Proxy host/port saved. Proxy credentials need the vault unlocked (${result.error}).`);
      }
    }

    await loadStatus();
    passInput.value = '';
    saveBtn.textContent = 'Saved';
    setTimeout(() => (saveBtn.textContent = 'Save proxy'), 1200);
  });

  authGrid.append(
    wrapLabel('Proxy username', userInput),
    wrapLabel('Proxy password', passInput),
    saveBtn
  );

  wrap.append(grid, authGrid);
  return wrap;
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
    card.appendChild(buildProxyBlock(key, currentStatus.settings.containerProxies?.[key]));
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

  card.appendChild(buildProxyBlock(key, currentStatus.settings.containerProxies?.[key]));

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

// --- Vault -----------------------------------------------------------------

async function refreshVaultUI() {
  const status = await vaultCall('vault-status');

  $('vaultUnlocked').classList.toggle('hidden', !status.unlocked);
  $('vaultLocked').classList.toggle('hidden', status.unlocked);
  $('credentialsSection').classList.toggle('hidden', !status.unlocked);
  $('paymentSection').classList.toggle('hidden', !status.unlocked);

  if (!status.unlocked) {
    $('vaultCreateBtn').classList.toggle('hidden', status.exists);
    $('vaultUnlockBtn').classList.toggle('hidden', !status.exists);
  } else {
    await renderCredentials();
    await renderPaymentMethods();
  }
}

async function renderCredentials() {
  const result = await vaultCall('vault-list-credentials');
  const tbody = $('credentialsTable').querySelector('tbody');
  tbody.innerHTML = '';
  if (!result.ok) return;

  const containerOptions = getContainerOptions();
  for (const cred of result.result) {
    tbody.appendChild(buildCredentialRow(cred, containerOptions));
  }
}

function buildContainerSelect(containerOptions, selectedKey) {
  const select = document.createElement('select');
  for (const opt of containerOptions) {
    const o = document.createElement('option');
    o.value = opt.key;
    o.textContent = opt.label;
    if (opt.key === (selectedKey || '')) o.selected = true;
    select.appendChild(o);
  }
  return select;
}

function buildCredentialRow(cred, containerOptions) {
  const tr = document.createElement('tr');

  const websiteInput = inputCell('text', cred.website, 'example.com');
  const accountInput = inputCell('text', cred.account, 'username');
  const passwordInput = inputCell('password', cred.password, 'password');
  const containerSelect = buildContainerSelect(containerOptions, cred.containerKey);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary small';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    await vaultCall('vault-save-credential', {
      entry: {
        id: cred.id,
        website: websiteInput.value.trim(),
        account: accountInput.value,
        password: passwordInput.value,
        containerKey: containerSelect.value || null,
      },
    });
    await renderCredentials();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'danger small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    await vaultCall('vault-delete-credential', { id: cred.id });
    await renderCredentials();
  });

  [websiteInput, accountInput, passwordInput].forEach((input) => {
    const td = document.createElement('td');
    td.appendChild(input);
    tr.appendChild(td);
  });

  const containerTd = document.createElement('td');
  containerTd.appendChild(containerSelect);
  tr.appendChild(containerTd);

  const actionsTd = document.createElement('td');
  actionsTd.append(saveBtn, deleteBtn);
  tr.appendChild(actionsTd);

  return tr;
}

async function renderPaymentMethods() {
  const result = await vaultCall('vault-list-payment-methods');
  const tbody = $('paymentTable').querySelector('tbody');
  tbody.innerHTML = '';
  if (!result.ok) return;

  const containerOptions = getContainerOptions();
  for (const pm of result.result) {
    tbody.appendChild(buildPaymentRow(pm, containerOptions));
  }
}

function buildPaymentRow(pm, containerOptions) {
  const tr = document.createElement('tr');

  const nickname = inputCell('text', pm.nickname, 'Nickname');
  const cardholder = inputCell('text', pm.cardholderName, 'Name on card');
  const cardNumber = inputCell('password', pm.cardNumber, 'Card number');
  const cvv = inputCell('password', pm.cvv, 'CVV');
  const expiry = inputCell('text', pm.expiry, 'MM/YY');
  const billing = inputCell('text', pm.billingAddress, 'Billing address');
  const containerSelect = buildContainerSelect(containerOptions, pm.containerKey);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary small';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    await vaultCall('vault-save-payment-method', {
      entry: {
        id: pm.id,
        nickname: nickname.value.trim(),
        cardholderName: cardholder.value,
        cardNumber: cardNumber.value,
        cvv: cvv.value,
        expiry: expiry.value,
        billingAddress: billing.value,
        containerKey: containerSelect.value || null,
      },
    });
    await renderPaymentMethods();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'danger small';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', async () => {
    await vaultCall('vault-delete-payment-method', { id: pm.id });
    await renderPaymentMethods();
  });

  [nickname, cardholder, cardNumber, cvv, expiry, billing].forEach((input) => {
    const td = document.createElement('td');
    td.appendChild(input);
    tr.appendChild(td);
  });

  const containerTd = document.createElement('td');
  containerTd.appendChild(containerSelect);
  tr.appendChild(containerTd);

  const actionsTd = document.createElement('td');
  actionsTd.append(saveBtn, deleteBtn);
  tr.appendChild(actionsTd);

  return tr;
}

// --- Native messaging token --------------------------------------------

async function refreshTokenStatus() {
  const status = await browser.runtime.sendMessage({ type: 'native-token-status' });
  $('tokenStatus').textContent = status.hasToken ? 'Token configured' : 'No token yet';
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
  await refreshVaultUI();
  await refreshTokenStatus();

  $('vaultCreateBtn').addEventListener('click', async () => {
    const password = $('vaultPasswordInput').value;
    if (!password) return;
    const result = await vaultCall('vault-create', { password });
    if (!result.ok) {
      $('vaultError').textContent = result.error;
      return;
    }
    $('vaultPasswordInput').value = '';
    $('vaultError').textContent = '';
    await refreshVaultUI();
  });

  $('vaultUnlockBtn').addEventListener('click', async () => {
    const password = $('vaultPasswordInput').value;
    if (!password) return;
    const result = await vaultCall('vault-unlock', { password });
    if (!result.ok) {
      $('vaultError').textContent =
        result.error === 'invalid-password' ? 'Wrong master password.' : result.error;
      return;
    }
    $('vaultPasswordInput').value = '';
    $('vaultError').textContent = '';
    await refreshVaultUI();
  });

  $('vaultLockBtn').addEventListener('click', async () => {
    await vaultCall('vault-lock');
    await refreshVaultUI();
  });

  $('addCredential').addEventListener('click', async () => {
    const result = await vaultCall('vault-save-credential', {
      entry: { website: '', account: '', password: '', containerKey: null },
    });
    if (result.ok) await renderCredentials();
  });

  $('addPayment').addEventListener('click', async () => {
    const result = await vaultCall('vault-save-payment-method', {
      entry: {
        nickname: '',
        cardholderName: '',
        cardNumber: '',
        cvv: '',
        expiry: '',
        billingAddress: '',
        containerKey: null,
      },
    });
    if (result.ok) await renderPaymentMethods();
  });

  $('regenerateToken').addEventListener('click', async () => {
    if (
      !confirm(
        'Regenerate the native-messaging API token? Any existing client will need the new one.'
      )
    ) {
      return;
    }
    const result = await browser.runtime.sendMessage({ type: 'native-token-regenerate' });
    const display = $('tokenDisplay');
    display.textContent = `New token (shown once, copy it now): ${result.token}`;
    display.classList.remove('hidden');
    await refreshTokenStatus();
  });

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
    await refreshTokenStatus();
  });
}

init().catch((err) => {
  console.error('[Company Containers options]', err);
  document.body.insertAdjacentHTML('afterbegin', `<p class="hint" style="color:#d70022">Error loading options: ${escapeHtml(err.message)}</p>`);
});
