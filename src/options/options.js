const COLORS = [
  'blue', 'turquoise', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'toolbar',
];

const ICONS = [
  'fingerprint', 'briefcase', 'dollar', 'cart', 'circle', 'gift',
  'vacation', 'food', 'fruit', 'pet', 'tree', 'chill', 'fence',
];

const BUILTIN_KEYS = new Set(['youtube', 'gmail', 'github', 'amazon']);

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

// Wraps a button placed alongside <label> grid siblings with a hidden
// spacer matching the label's text line, so the button lines up with the
// input fields instead of stretching to fill (or floating low in) the row.
function wrapFieldButton(button) {
  const wrap = document.createElement('div');
  wrap.className = 'field-btn-wrap';
  const spacer = document.createElement('span');
  spacer.className = 'field-btn-spacer';
  spacer.innerHTML = '&nbsp;';
  wrap.append(spacer, button);
  return wrap;
}

function inputCell(type, value, placeholder) {
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.placeholder = placeholder || '';
  input.autocomplete = 'off';
  return input;
}

function iconButton(symbol, label, variant) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = variant ? `icon-action-btn ${variant}` : 'icon-action-btn';
  btn.textContent = symbol;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  return btn;
}

// Groups [label, input] pairs into a sequence of `.grid.three` rows, three
// fields per row, for the payment/address form-card layouts.
function buildFieldRows(fieldPairs, perRow = 3) {
  const rows = [];
  for (let i = 0; i < fieldPairs.length; i += perRow) {
    const grid = document.createElement('div');
    grid.className = 'grid three';
    for (const [labelText, input] of fieldPairs.slice(i, i + perRow)) {
      grid.appendChild(wrapLabel(labelText, input));
    }
    rows.push(grid);
  }
  return rows;
}

// --- CSV import --------------------------------------------------------
// Minimal RFC4180-ish parser: quoted fields, escaped "" quotes, CRLF/LF.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] || '').trim();
    });
    return obj;
  });
}

function resolveContainerKey(value, containerOptions) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const match = containerOptions.find(
    (o) => o.key && (o.key.toLowerCase() === v || o.label.toLowerCase() === v)
  );
  return match ? match.key : null;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file read failed'));
    reader.readAsText(file);
  });
}

function wireCsvImport(inputId, statusId, handler) {
  const input = $(inputId);
  const status = $(statusId);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = 'Importing…';
    try {
      const text = await readFileAsText(file);
      const rows = csvToObjects(text);
      const summary = await handler(rows);
      status.textContent = summary;
    } catch (err) {
      status.textContent = `Import failed: ${err.message}`;
    } finally {
      input.value = '';
    }
  });
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
  $('stickyContainers').checked = s.stickyContainers === true;
  $('preserveAuthFlows').checked = s.preserveAuthFlows !== false;
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
      // "proxy" is an optional permission — request it (with this click as
      // the user gesture) the first time a container actually gets a proxy
      // configured, rather than asking for it at install time.
      const granted = await browser.permissions.request({ permissions: ['proxy'] });
      if (!granted) {
        alert('Proxy routing needs the "Proxy" permission, which was not granted.');
        return;
      }
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
    wrapFieldButton(saveBtn)
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

    const header = document.createElement('div');
    header.className = 'company-header';

    const title = document.createElement('span');
    title.className = 'company-title';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = meta.color === 'toolbar' ? '#8f8f8f' : meta.color;
    title.appendChild(dot);
    title.appendChild(document.createTextNode(meta.label));

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'toggle';
    enabledLabel.style.marginLeft = '8px';
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.dataset.key = key;
    enabledCheckbox.checked = !!cfg.enabled;
    const enabledSpan = document.createElement('span');
    enabledSpan.textContent = 'Enabled';
    enabledLabel.append(enabledCheckbox, enabledSpan);
    title.appendChild(enabledLabel);

    const actions = document.createElement('span');
    actions.className = 'company-actions';
    const saveDomainsBtn = document.createElement('button');
    saveDomainsBtn.className = 'secondary small save-domains';
    saveDomainsBtn.dataset.key = key;
    saveDomainsBtn.textContent = 'Save domains';
    const resetDomainsBtn = document.createElement('button');
    resetDomainsBtn.className = 'secondary small reset-domains';
    resetDomainsBtn.dataset.key = key;
    resetDomainsBtn.textContent = 'Reset';
    actions.append(saveDomainsBtn, resetDomainsBtn);

    header.append(title, actions);

    const containerHint = document.createElement('p');
    containerHint.className = 'hint';
    containerHint.textContent = `Container: ${containerInfo ? containerInfo.name : 'not created yet'}`;

    const textarea = document.createElement('textarea');
    textarea.dataset.key = key;
    textarea.value = effective.join('\n');

    card.append(header, containerHint, textarea);
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

  const header = document.createElement('div');
  header.className = 'company-header';

  const title = document.createElement('span');
  title.className = 'company-title';
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = cfg.color === 'toolbar' ? '#8f8f8f' : cfg.color;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'inline-name';
  nameInput.value = cfg.label;
  nameInput.placeholder = 'Container name';
  title.append(dot, nameInput);

  const actions = document.createElement('span');
  actions.className = 'company-actions';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'toggle';
  enabledLabel.style.marginRight = '8px';
  const enabledCheckbox = document.createElement('input');
  enabledCheckbox.type = 'checkbox';
  enabledCheckbox.className = 'enabled-toggle';
  enabledCheckbox.checked = cfg.enabled !== false;
  const enabledSpan = document.createElement('span');
  enabledSpan.textContent = 'Enabled';
  enabledLabel.append(enabledCheckbox, enabledSpan);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'secondary small save-custom';
  saveBtn.textContent = 'Save';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'danger small delete-custom';
  deleteBtn.textContent = 'Delete';

  actions.append(enabledLabel, saveBtn, deleteBtn);
  header.append(title, actions);

  const fieldsGrid = document.createElement('div');
  fieldsGrid.className = 'grid three';

  const colorSelect = document.createElement('select');
  colorSelect.className = 'color-select';
  colorSelect.id = `cc-color-${key}`;
  fieldsGrid.appendChild(wrapLabel('Color', colorSelect));

  const iconSelect = document.createElement('select');
  iconSelect.className = 'icon-select';
  iconSelect.id = `cc-icon-${key}`;
  fieldsGrid.appendChild(wrapLabel('Icon', iconSelect));

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'key-display';
  keyInput.value = key;
  keyInput.readOnly = true;
  fieldsGrid.appendChild(wrapLabel('Key', keyInput));

  const domainsLabel = document.createElement('label');
  domainsLabel.style.marginTop = '8px';
  domainsLabel.textContent = 'Domains (one per line)';

  const domainsTextarea = document.createElement('textarea');
  domainsTextarea.className = 'domains-textarea';
  domainsTextarea.value = (cfg.domains || []).join('\n');

  card.append(header, fieldsGrid, domainsLabel, domainsTextarea);

  populateSelect(colorSelect, COLORS, cfg.color || 'toolbar');
  populateSelect(iconSelect, ICONS, cfg.icon || 'circle');

  card.appendChild(buildProxyBlock(key, currentStatus.settings.containerProxies?.[key]));

  saveBtn.addEventListener('click', async () => {
    await saveCustomContainer(card, key);
  });

  deleteBtn.addEventListener('click', async () => {
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
  $('addressesSection').classList.toggle('hidden', !status.unlocked);

  if (!status.unlocked) {
    $('vaultCreateBtn').classList.toggle('hidden', status.exists);
    $('vaultUnlockBtn').classList.toggle('hidden', !status.exists);
    $('vaultConfirmWrap').classList.toggle('hidden', status.exists);
    $('forgotPasswordLink').classList.toggle('hidden', !status.exists);
    if (!status.exists) $('vaultResetConfirm').classList.add('hidden');
  } else {
    $('vaultConfirmWrap').classList.add('hidden');
    $('forgotPasswordLink').classList.add('hidden');
    $('vaultResetConfirm').classList.add('hidden');
    await renderCredentials();
    await renderPaymentMethods();
    await renderAddresses();
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

  const saveBtn = iconButton('✓', 'Save');
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

  const deleteBtn = iconButton('✕', 'Delete', 'danger');
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
  const list = $('paymentList');
  list.innerHTML = '';
  if (!result.ok) return;

  const containerOptions = getContainerOptions();
  for (const pm of result.result) {
    list.appendChild(buildPaymentCard(pm, containerOptions));
  }
}

function buildPaymentCard(pm, containerOptions) {
  const card = document.createElement('div');
  card.className = 'entry-card';

  const nickname = inputCell('text', pm.nickname, 'Nickname');
  nickname.className = 'entry-title-input';
  const cardholder = inputCell('text', pm.cardholderName, 'Name on card');
  const cardNumber = inputCell('password', pm.cardNumber, 'Card number');
  const cvv = inputCell('password', pm.cvv, 'CVV');
  const expiry = inputCell('text', pm.expiry, 'MM/YY');
  const billing = inputCell('text', pm.billingAddress, 'Billing address');
  const containerSelect = buildContainerSelect(containerOptions, pm.containerKey);

  const saveBtn = iconButton('✓', 'Save');
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

  const deleteBtn = iconButton('✕', 'Delete', 'danger');
  deleteBtn.addEventListener('click', async () => {
    await vaultCall('vault-delete-payment-method', { id: pm.id });
    await renderPaymentMethods();
  });

  const header = document.createElement('div');
  header.className = 'entry-header';
  header.appendChild(nickname);
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.append(saveBtn, deleteBtn);
  header.appendChild(actions);

  card.appendChild(header);
  card.append(
    ...buildFieldRows([
      ['Cardholder', cardholder],
      ['Card number', cardNumber],
      ['CVV', cvv],
    ])
  );
  card.append(
    ...buildFieldRows([
      ['Expiry (MM/YY)', expiry],
      ['Billing address', billing],
      ['Container', containerSelect],
    ])
  );

  return card;
}

async function renderAddresses() {
  const result = await vaultCall('vault-list-addresses');
  const list = $('addressesList');
  list.innerHTML = '';
  if (!result.ok) return;

  const containerOptions = getContainerOptions();
  for (const addr of result.result) {
    list.appendChild(buildAddressCard(addr, containerOptions));
  }
}

function buildAddressCard(addr, containerOptions) {
  const card = document.createElement('div');
  card.className = 'entry-card';

  const label = inputCell('text', addr.label, 'Label (e.g. Home, Office)');
  label.className = 'entry-title-input';
  const recipient = inputCell('text', addr.recipientName, 'Recipient name');
  const line1 = inputCell('text', addr.line1, 'Address line 1');
  const line2 = inputCell('text', addr.line2, 'Address line 2');
  const city = inputCell('text', addr.city, 'City');
  const state = inputCell('text', addr.state, 'State / region');
  const postalCode = inputCell('text', addr.postalCode, 'Postal code');
  const country = inputCell('text', addr.country, 'Country');
  const phone = inputCell('text', addr.phone, 'Phone');
  const containerSelect = buildContainerSelect(containerOptions, addr.containerKey);

  const saveBtn = iconButton('✓', 'Save');
  saveBtn.addEventListener('click', async () => {
    await vaultCall('vault-save-address', {
      entry: {
        id: addr.id,
        label: label.value.trim(),
        recipientName: recipient.value,
        line1: line1.value,
        line2: line2.value,
        city: city.value,
        state: state.value,
        postalCode: postalCode.value,
        country: country.value,
        phone: phone.value,
        containerKey: containerSelect.value || null,
      },
    });
    await renderAddresses();
  });

  const deleteBtn = iconButton('✕', 'Delete', 'danger');
  deleteBtn.addEventListener('click', async () => {
    await vaultCall('vault-delete-address', { id: addr.id });
    await renderAddresses();
  });

  const header = document.createElement('div');
  header.className = 'entry-header';
  header.appendChild(label);
  const actions = document.createElement('div');
  actions.className = 'entry-actions';
  actions.append(saveBtn, deleteBtn);
  header.appendChild(actions);

  card.appendChild(header);
  card.append(
    ...buildFieldRows([
      ['Recipient', recipient],
      ['Address line 1', line1],
      ['Address line 2', line2],
    ])
  );
  card.append(
    ...buildFieldRows([
      ['City', city],
      ['State / region', state],
      ['Postal code', postalCode],
    ])
  );
  card.append(
    ...buildFieldRows([
      ['Country', country],
      ['Phone', phone],
      ['Container', containerSelect],
    ])
  );

  return card;
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
      stickyContainers: $('stickyContainers').checked,
      preserveAuthFlows: $('preserveAuthFlows').checked,
      tempPrefix: $('tempPrefix').value.trim() || 'Temp',
      tempColor: $('tempColor').value,
      tempIcon: $('tempIcon').value,
    },
  });
  await loadStatus();
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
    const confirmPassword = $('vaultConfirmInput').value;
    if (!password) return;
    if (password !== confirmPassword) {
      $('vaultError').textContent = "Passwords don't match.";
      return;
    }
    const result = await vaultCall('vault-create', { password });
    if (!result.ok) {
      $('vaultError').textContent = result.error;
      return;
    }
    $('vaultPasswordInput').value = '';
    $('vaultConfirmInput').value = '';
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

  $('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    $('vaultResetConfirm').classList.toggle('hidden');
  });

  $('vaultResetBtn').addEventListener('click', async () => {
    if (
      !confirm(
        'This permanently deletes every saved credential, payment method, address, ' +
          'and proxy password. There is no recovery. Continue?'
      )
    ) {
      return;
    }
    const result = await vaultCall('vault-reset');
    if (!result.ok) {
      $('vaultError').textContent = result.error;
      return;
    }
    $('vaultPasswordInput').value = '';
    $('vaultConfirmInput').value = '';
    $('vaultError').textContent = '';
    $('vaultResetConfirm').classList.add('hidden');
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

  $('addAddress').addEventListener('click', async () => {
    const result = await vaultCall('vault-save-address', {
      entry: {
        label: '',
        recipientName: '',
        line1: '',
        line2: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        phone: '',
        containerKey: null,
      },
    });
    if (result.ok) await renderAddresses();
  });

  wireCsvImport('importCredentialsCsv', 'importCredentialsStatus', async (rows) => {
    const containerOptions = getContainerOptions();
    const entries = rows
      .filter((r) => r.website || r.account)
      .map((r) => ({
        website: r.website || '',
        account: r.account || '',
        password: r.password || '',
        containerKey: resolveContainerKey(r.container, containerOptions),
      }));
    const result = await vaultCall('vault-import-credentials', { entries });
    if (!result.ok) return `Import failed: ${result.error}`;
    await renderCredentials();
    return `Imported ${result.result.imported} credential(s).`;
  });

  wireCsvImport('importPaymentCsv', 'importPaymentStatus', async (rows) => {
    const containerOptions = getContainerOptions();
    const entries = rows
      .filter((r) => r.nickname || r.cardnumber)
      .map((r) => ({
        nickname: r.nickname || '',
        cardholderName: r.cardholdername || '',
        cardNumber: r.cardnumber || '',
        cvv: r.cvv || '',
        expiry: r.expiry || '',
        billingAddress: r.billingaddress || '',
        containerKey: resolveContainerKey(r.container, containerOptions),
      }));
    const result = await vaultCall('vault-import-payment-methods', { entries });
    if (!result.ok) return `Import failed: ${result.error}`;
    await renderPaymentMethods();
    return `Imported ${result.result.imported} payment method(s).`;
  });

  wireCsvImport('importAddressesCsv', 'importAddressesStatus', async (rows) => {
    const containerOptions = getContainerOptions();
    const entries = rows
      .filter((r) => r.label || r.line1)
      .map((r) => ({
        label: r.label || '',
        recipientName: r.recipientname || '',
        line1: r.line1 || '',
        line2: r.line2 || '',
        city: r.city || '',
        state: r.state || '',
        postalCode: r.postalcode || '',
        country: r.country || '',
        phone: r.phone || '',
        containerKey: resolveContainerKey(r.container, containerOptions),
      }));
    const result = await vaultCall('vault-import-addresses', { entries });
    if (!result.ok) return `Import failed: ${result.error}`;
    await renderAddresses();
    return `Imported ${result.result.imported} address(es).`;
  });

  wireCsvImport('importContainersCsv', 'importContainersStatus', async (rows) => {
    const custom = { ...(currentStatus.settings.customContainers || {}) };
    let count = 0;
    for (const r of rows) {
      const key = (r.key || r.label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (!key || BUILTIN_KEYS.has(key)) continue;
      custom[key] = {
        label: r.label || key,
        color: COLORS.includes(r.color) ? r.color : 'toolbar',
        icon: ICONS.includes(r.icon) ? r.icon : 'circle',
        domains: (r.domains || '')
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean),
        enabled: true,
        cookieStoreId: custom[key]?.cookieStoreId || null,
      };
      count++;
    }
    await browser.runtime.sendMessage({
      type: 'update-settings',
      settings: { customContainers: custom },
    });
    await loadStatus();
    renderCustomContainers();
    return `Imported ${count} custom container(s).`;
  });

  $('regenerateToken').addEventListener('click', async () => {
    if (
      !confirm(
        'Regenerate the native-messaging API token? Any existing client will need the new one.'
      )
    ) {
      return;
    }
    // "nativeMessaging" is an optional permission — request it (with this
    // click as the user gesture) the first time someone actually sets up
    // the automation bridge, rather than asking for it at install time.
    const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] });
    if (!granted) {
      alert('The native-messaging bridge needs the "Native messaging" permission, which was not granted.');
      return;
    }
    const result = await browser.runtime.sendMessage({ type: 'native-token-regenerate' });
    const display = $('tokenDisplay');
    display.textContent = `New token (shown once, copy it now): ${result.token}`;
    display.classList.remove('hidden');
    await refreshTokenStatus();
  });

  $('isolateUnmatched').addEventListener('change', saveGlobals);
  $('stickyContainers').addEventListener('change', saveGlobals);
  $('preserveAuthFlows').addEventListener('change', saveGlobals);
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
  console.error('[Better Containers options]', err);
  const notice = document.createElement('p');
  notice.className = 'hint danger-text';
  notice.textContent = `Error loading options: ${err.message}`;
  document.body.prepend(notice);
});
