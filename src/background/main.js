import { loadSettings, saveSettings, loadState, saveState } from '../lib/storage.js';
import {
  resolveTarget,
  getEffectiveDomainList,
  getContainerKeyByCookieStoreId,
  getContainerProxy,
} from '../lib/rules.js';
import {
  ensureContainers,
  ensureContainerForName,
  createTemporaryContainer,
  gcTemporaryContainers,
  registerHint,
  getAllContainers,
} from '../lib/containers.js';
import { FRESH_TAB_URLS } from '../lib/defaults.js';
import * as vault from '../lib/vault.js';
import { initNativeMessaging } from '../lib/native-messaging.js';

let bundledDomainData = null;
let domainData = null;
let settings = null;
let state = null;
let booted = false;
let gcTimeout = null;
const processedRequests = new Set();

async function loadDomainData() {
  const url = browser.runtime.getURL('/src/data/domains.json');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load domain data: ${res.status}`);
  return res.json();
}

function buildDomainData(bundled, customContainers) {
  const customDomainData = Object.fromEntries(
    Object.entries(customContainers || {}).map(([key, cfg]) => [
      key,
      {
        label: cfg.label,
        color: cfg.color,
        icon: cfg.icon,
        domains: cfg.domains || [],
      },
    ])
  );
  return { ...bundled, ...customDomainData };
}

function rebuildDomainData() {
  domainData = buildDomainData(bundledDomainData, settings.customContainers);
}

async function boot(reason = '') {
  if (booted) return;
  try {
    bundledDomainData = await loadDomainData();
    settings = await loadSettings();
    state = await loadState();

    rebuildDomainData();

    const { changed } = await ensureContainers(settings, domainData);
    if (changed) {
      await saveSettings(settings);
    }

    await gcTemporaryContainers();
    vault.configureAutoLock(settings.vaultAutoLockMinutes);
    initNativeMessaging();
    booted = true;
    console.log('[Company Containers] booted', reason, settings, state);
  } catch (err) {
    console.error('[Company Containers] boot failed', err);
    throw err;
  }
}

function isHttpUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function isFreshTab(tab, targetUrl) {
  if (!tab) return false;
  if (FRESH_TAB_URLS.has(tab.url)) return true;
  // First navigation of a newly-created tab.
  if (tab.url === targetUrl) return true;
  return false;
}

async function doReopen({ tab, url, cookieStoreId, reason, keepOriginal = false, forceReplace = false }) {
  const fresh = forceReplace || (!keepOriginal && isFreshTab(tab, url));

  const createProps = {
    url,
    cookieStoreId,
    active: tab.active,
    windowId: tab.windowId,
    index: fresh ? tab.index : tab.index + 1,
  };

  if (fresh && tab.pinned) {
    createProps.pinned = true;
  }

  try {
    await browser.tabs.create(createProps);
  } catch (err) {
    console.error('[Company Containers] tabs.create failed', err);
    return false;
  }

  if (fresh) {
    try {
      await browser.tabs.remove(tab.id);
    } catch (err) {
      console.warn('[Company Containers] failed to remove original tab', tab.id, err);
    }
  }

  console.log('[Company Containers] reopened', url, '->', cookieStoreId, 'reason:', reason, 'fresh:', fresh);
  return true;
}

async function handleBeforeRequest(details) {
  if (!booted) return {};
  if (details.tabId < 0) return {};
  if (!isHttpUrl(details.url)) return {};
  if (processedRequests.has(details.requestId)) return {};

  let tab;
  try {
    tab = await browser.tabs.get(details.tabId);
  } catch (err) {
    return {};
  }

  // Ignore our own extension pages and private tabs (containers don't mix
  // with Private Browsing).
  if (tab.url && tab.url.startsWith(browser.runtime.getURL(''))) return {};
  if (tab.incognito) return {};

  const url = new URL(details.url);
  const currentCookieStoreId = tab.cookieStoreId || 'firefox-default';

  const target = resolveTarget({
    hostname: url.hostname,
    url: details.url,
    currentCookieStoreId,
    domainData,
    settings,
    state,
    allowTempFallback: true,
  });

  let targetCookieStoreId = target.cookieStoreId;

  if (target.createTemp) {
    targetCookieStoreId = await createTemporaryContainer(settings, state);
    // state was persisted inside createTemporaryContainer; reload to keep in-memory state current.
    state = await loadState();
  }

  if (!targetCookieStoreId || targetCookieStoreId === currentCookieStoreId) {
    return {};
  }

  processedRequests.add(details.requestId);
  setTimeout(() => processedRequests.delete(details.requestId), 30000);

  const ok = await doReopen({
    tab,
    url: details.url,
    cookieStoreId: targetCookieStoreId,
    reason: target.reason,
  });

  return ok ? { cancel: true } : {};
}

async function reopenTab(tabId, cookieStoreId, reason = 'manual', replace = null) {
  const tab = await browser.tabs.get(tabId);
  const url = tab.url;
  if (!isHttpUrl(url)) return { error: 'not an http/https tab' };

  await registerHint(url, cookieStoreId);
  state = await loadState();

  const forceReplace = replace !== null ? replace : settings.replaceTabInsteadOfNew;

  await doReopen({
    tab,
    url,
    cookieStoreId,
    reason,
    keepOriginal: false,
    forceReplace,
  });

  return { ok: true };
}

async function vaultOp(fn) {
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message === 'vault-locked' ? 'vault-locked' : err.message };
  }
}

function handleProxyRequest(details) {
  if (!booted) return [{ type: 'direct' }];
  const containerKey = getContainerKeyByCookieStoreId(details.cookieStoreId, settings);
  const proxy = containerKey ? getContainerProxy(containerKey, settings) : null;
  if (!proxy) return [{ type: 'direct' }];
  return [{ type: proxy.type, host: proxy.host, port: Number(proxy.port) }];
}

async function handleProxyAuth(details) {
  if (!booted || !details.isProxy || !vault.isUnlocked()) return {};

  let containerKey = null;
  if (details.tabId >= 0) {
    try {
      const tab = await browser.tabs.get(details.tabId);
      containerKey = getContainerKeyByCookieStoreId(tab.cookieStoreId, settings);
    } catch {
      return {};
    }
  }
  if (!containerKey) return {};

  let creds;
  try {
    creds = vault.getProxyCredential(containerKey);
  } catch {
    return {};
  }
  if (!creds) return {};

  return { authCredentials: { username: creds.username, password: creds.password } };
}

function scheduleGc() {
  if (gcTimeout) clearTimeout(gcTimeout);
  gcTimeout = setTimeout(async () => {
    try {
      await gcTemporaryContainers();
      state = await loadState();
    } catch (err) {
      console.warn('[Company Containers] scheduled GC failed', err);
    }
  }, 1500);
}

function resolveTabTarget(tab) {
  if (!tab || !isHttpUrl(tab.url)) return null;
  const url = new URL(tab.url);
  return resolveTarget({
    hostname: url.hostname,
    url: tab.url,
    currentCookieStoreId: tab.cookieStoreId || 'firefox-default',
    domainData,
    settings,
    state,
    allowTempFallback: false,
  });
}

async function handleMessage(message, sender, sendResponse) {
  // Ensure we're booted before handling most messages.
  if (!booted && message.type !== 'get-status') {
    await boot('message');
  }

  switch (message.type) {
    case 'get-status': {
      if (!booted) await boot('status-request');
      const containers = await getAllContainers();
      return {
        booted,
        settings,
        domainData,
        containers,
      };
    }

    case 'get-tab-info': {
      const tab = await browser.tabs.get(message.tabId);
      const target = resolveTabTarget(tab);
      const containers = await getAllContainers();
      return { tab, target, container: containers[tab?.cookieStoreId] || null };
    }

    case 'list-containers': {
      return getAllContainers();
    }

    case 'ensure-container': {
      const container = await ensureContainerForName(message.name, {
        color: message.color,
        icon: message.icon,
      });
      return { container };
    }

    case 'set-company-enabled': {
      if (settings.customContainers?.[message.key]) {
        settings.customContainers[message.key].enabled = message.enabled;
      } else if (settings.companies?.[message.key]) {
        settings.companies[message.key].enabled = message.enabled;
      }
      await saveSettings(settings);
      return { settings };
    }

    case 'set-isolate-unmatched': {
      settings.isolateUnmatched = message.value;
      await saveSettings(settings);
      return { settings };
    }

    case 'set-replace-tab': {
      settings.replaceTabInsteadOfNew = message.value;
      await saveSettings(settings);
      return { settings };
    }

    case 'open-empty-tab': {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab) return { error: 'no active tab' };

      const createProps = {
        cookieStoreId: message.cookieStoreId,
        active: true,
        windowId: tab.windowId,
        index: message.replace ? tab.index : tab.index + 1,
        pinned: message.replace ? tab.pinned : false,
      };
      await browser.tabs.create(createProps);
      if (message.replace) {
        await browser.tabs.remove(tab.id);
      }
      return { ok: true };
    }

    case 'add-user-rule': {
      settings.userRules = {
        ...(settings.userRules || {}),
        [message.hostname]: message.cookieStoreId,
      };
      await saveSettings(settings);
      return { ok: true };
    }

    case 'update-settings': {
      // Merge in changes but preserve company cookieStoreIds if not supplied.
      settings = { ...settings, ...message.settings };
      rebuildDomainData();
      await ensureContainers(settings, domainData);
      await saveSettings(settings);
      return { settings };
    }

    case 'delete-custom-container': {
      const cfg = settings.customContainers?.[message.key];
      if (cfg?.cookieStoreId) {
        try {
          await browser.contextualIdentities.remove(cfg.cookieStoreId);
        } catch (err) {
          console.warn('[Company Containers] failed to remove container', cfg.cookieStoreId, err);
        }
        // Drop any user rules that pointed at this container.
        const userRules = { ...(settings.userRules || {}) };
        for (const [hostname, id] of Object.entries(userRules)) {
          if (id === cfg.cookieStoreId) delete userRules[hostname];
        }
        settings.userRules = userRules;
      }
      delete settings.customContainers[message.key];
      await saveSettings(settings);
      rebuildDomainData();
      return { settings };
    }

    case 'reset-settings': {
      const { DEFAULT_SETTINGS } = await import('../lib/defaults.js');
      settings = { ...DEFAULT_SETTINGS };
      rebuildDomainData();
      await ensureContainers(settings, domainData);
      await saveSettings(settings);
      return { settings };
    }

    case 'register-hint': {
      await registerHint(message.url, message.cookieStoreId, message.ttlMs);
      state = await loadState();
      return { ok: true };
    }

    case 'reopen-tab': {
      return reopenTab(message.tabId, message.cookieStoreId, 'manual', message.replace);
    }

    case 'create-temp-container': {
      const id = await createTemporaryContainer(settings, state);
      state = await loadState();
      return { cookieStoreId: id };
    }

    case 'gc-temp-containers': {
      const result = await gcTemporaryContainers();
      state = await loadState();
      return result;
    }

    case 'get-domain-data': {
      return { domainData };
    }

    // --- Vault lifecycle ---------------------------------------------

    case 'vault-status':
      return vault.vaultStatus();

    case 'vault-create':
      return vault.createVault(message.password);

    case 'vault-unlock':
      return vault.unlockVault(message.password);

    case 'vault-lock':
      vault.lockVault();
      return { ok: true };

    // --- Site credentials ---------------------------------------------

    case 'vault-list-credentials':
      return vaultOp(() => vault.listCredentials());

    case 'vault-find-credentials-for-hostname':
      return vaultOp(() => vault.findCredentialsForHostname(message.hostname));

    case 'vault-save-credential':
      return vaultOp(() => vault.saveCredential(message.entry));

    case 'vault-delete-credential':
      return vaultOp(() => vault.deleteCredential(message.id));

    // --- Payment methods ------------------------------------------------

    case 'vault-list-payment-methods':
      return vaultOp(() => vault.listPaymentMethods());

    case 'vault-save-payment-method':
      return vaultOp(() => vault.savePaymentMethod(message.entry));

    case 'vault-delete-payment-method':
      return vaultOp(() => vault.deletePaymentMethod(message.id));

    // --- Proxy auth credentials (vault) + proxy config (plain settings) --

    case 'vault-get-proxy-credential':
      return vaultOp(() => vault.getProxyCredential(message.containerKey));

    case 'vault-set-proxy-credential':
      return vaultOp(() =>
        vault.setProxyCredential(message.containerKey, {
          username: message.username,
          password: message.password,
        })
      );

    case 'vault-delete-proxy-credential':
      return vaultOp(() => vault.deleteProxyCredential(message.containerKey));

    case 'set-container-proxy': {
      settings.containerProxies = {
        ...(settings.containerProxies || {}),
        [message.key]: {
          type: message.proxyType,
          host: message.host,
          port: message.port,
        },
      };
      await saveSettings(settings);
      return { settings };
    }

    case 'delete-container-proxy': {
      const proxies = { ...(settings.containerProxies || {}) };
      delete proxies[message.key];
      settings.containerProxies = proxies;
      await saveSettings(settings);
      return { settings };
    }

    // --- Native messaging bridge token -----------------------------------

    case 'native-token-status':
      return { hasToken: !!settings.nativeMessaging?.tokenHash };

    case 'native-token-regenerate': {
      const token = vault.generateApiToken();
      const tokenHash = await vault.hashToken(token);
      settings.nativeMessaging = { tokenHash };
      await saveSettings(settings);
      return { ok: true, token };
    }

    default:
      return { error: `unknown message type: ${message.type}` };
  }
}

async function init() {
  browser.runtime.onInstalled.addListener(() => boot('installed'));
  browser.runtime.onStartup.addListener(() => boot('startup'));

  // Boot immediately as well so the extension works right after a temporary
  // load in about:debugging (which doesn't fire onInstalled).
  await boot('immediate');

  browser.webRequest.onBeforeRequest.addListener(
    handleBeforeRequest,
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['blocking']
  );

  browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ['<all_urls>'] });

  browser.webRequest.onAuthRequired.addListener(
    handleProxyAuth,
    { urls: ['<all_urls>'] },
    ['blocking']
  );

  browser.tabs.onRemoved.addListener(() => scheduleGc());
  browser.tabs.onDetached.addListener(() => scheduleGc());

  browser.runtime.onMessage.addListener(handleMessage);
}

init().catch((err) => console.error('[Company Containers] init error', err));
