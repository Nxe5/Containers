import { loadSettings, saveSettings, loadState, saveState } from '../lib/storage.js';
import {
  resolveTarget,
  getEffectiveDomainList,
  getContainerKeyByCookieStoreId,
  getContainerProxy,
  looksLikeAuthNavigation,
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
import { initNativeMessaging, stopNativeMessaging } from '../lib/native-messaging.js';

// "proxy" and "nativeMessaging" are optional_permissions — most installs
// never use per-container proxies or the automation bridge, so we don't ask
// for them up front. Options page requests them (with a user gesture) the
// first time someone actually configures either feature; these listeners
// react to that grant (or a later revocation) whenever it happens.
let proxyListenerActive = false;
let nativeMessagingActive = false;

async function syncProxyPermissionState() {
  const granted = await browser.permissions.contains({ permissions: ['proxy'] });
  // browser.proxy is only guaranteed accessible while the permission is held;
  // guard the add/remove so a revocation racing this call can't throw and
  // leave proxyListenerActive out of sync.
  try {
    if (granted && !proxyListenerActive) {
      browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ['<all_urls>'] });
      proxyListenerActive = true;
    } else if (!granted && proxyListenerActive) {
      browser.proxy.onRequest.removeListener(handleProxyRequest);
      proxyListenerActive = false;
    }
  } catch (err) {
    console.warn('[Better Containers] proxy listener sync failed', err);
    proxyListenerActive = granted && proxyListenerActive;
  }
}

async function syncNativeMessagingPermissionState() {
  const granted = await browser.permissions.contains({ permissions: ['nativeMessaging'] });
  if (granted && !nativeMessagingActive) {
    initNativeMessaging();
    nativeMessagingActive = true;
  } else if (!granted && nativeMessagingActive) {
    stopNativeMessaging();
    nativeMessagingActive = false;
  }
}

let bundledDomainData = null;
let domainData = null;
let settings = null;
let state = null;
let booted = false;
let gcTimeout = null;
const processedRequests = new Set();
// requestIds of main_frame requests currently inside a server-redirect chain.
// Every leg of a redirect keeps the same requestId, so membership here means
// "this navigation arrived via redirect" — see the preserveAuthFlows guard in
// handleBeforeRequest. Entries are removed when the request completes or
// errors, so the set stays small.
const redirectChainRequests = new Set();
// tabIds of tabs (and new-window tabs) that were opened to host a navigation
// from another tab — a link, "open in new tab/window", or window.open. Firefox
// gives such a tab its opener's container; membership here marks it so its
// first navigation is kept in that container instead of being handed off by a
// domain rule (see the fromLinkedTab guard in handleBeforeRequest — the
// new-tab/window half of the stickyContainers setting). Populated by
// webNavigation.onCreatedNavigationTarget, which — unlike tab.openerTabId —
// also reports opens into a *new window*. Consumed on the first navigation and
// dropped when the tab is removed.
const linkedTabIds = new Set();

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

    // Container creation/GC can fail for reasons outside our control (a
    // container was deleted externally, a name collision, browser limits).
    // Never let those permanently prevent boot — the rest of the extension
    // (popup, opener, message handling) should still work even if a
    // container needs to be repaired on the next boot instead.
    try {
      const { changed } = await ensureContainers(settings, domainData);
      if (changed) {
        await saveSettings(settings);
      }
    } catch (err) {
      console.error('[Better Containers] ensureContainers failed, continuing boot', err);
    }

    try {
      await gcTemporaryContainers();
    } catch (err) {
      console.warn('[Better Containers] gc failed during boot', err);
    }

    vault.configureAutoLock(settings.vaultAutoLockMinutes);
    await syncProxyPermissionState();
    await syncNativeMessagingPermissionState();
    booted = true;
    updateActionBadge();
    console.log('[Better Containers] booted', reason);
  } catch (err) {
    console.error('[Better Containers] boot failed', err);
    throw err;
  }
}

function isHttpUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function updateActionBadge() {
  const disabled = settings && settings.extensionEnabled === false;
  browser.browserAction.setBadgeText({ text: disabled ? 'OFF' : '' });
  if (disabled) {
    browser.browserAction.setBadgeBackgroundColor({ color: '#d70022' });
  }
  browser.browserAction.setTitle({
    title: disabled ? 'Better Containers (disabled)' : 'Better Containers',
  });
}

function isFreshTab(tab, targetUrl) {
  if (!tab) return false;
  // A brand-new tab's URL is often still empty (or about:blank) at
  // onBeforeRequest time, before its first load commits — treat that as fresh
  // so a link-opened tab is recognised and can be replaced in place.
  if (!tab.url) return true;
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
    console.error('[Better Containers] tabs.create failed', err);
    return false;
  }

  if (fresh) {
    try {
      await browser.tabs.remove(tab.id);
    } catch (err) {
      console.warn('[Better Containers] failed to remove original tab', tab.id, err);
    }
  }

  console.log('[Better Containers] reopened', url, '->', cookieStoreId, 'reason:', reason, 'fresh:', fresh);
  return true;
}

async function handleBeforeRequest(details) {
  if (!booted) return {};
  if (!settings.extensionEnabled) return {};
  if (details.tabId < 0) return {};
  if (!isHttpUrl(details.url)) return {};
  // Only ever relocate GET navigations. We move a request to another
  // container by cancelling it and re-creating the tab, and tabs.create can
  // only issue a GET — so reopening a POST would drop its body and corrupt
  // the request. This matters most for auth: OAuth/OIDC callbacks using
  // response_mode=form_post (Google, others) POST the token back at the top
  // level, and login forms POST too. Reopening those as GET produces a
  // malformed request and a provider-side 400. Leave non-GET navigations in
  // whatever container they're already in.
  if (details.method && details.method !== 'GET') return {};
  if (processedRequests.has(details.requestId)) return {};

  // Keep sign-in flows in the container they started in (see defaults.js).
  // A navigation is part of an auth chain if it arrived as a server-redirect
  // leg (same requestId as the request that redirected — catches the whole
  // OAuth round-trip with no URL knowledge) or if its URL looks like an auth
  // endpoint (catches sites that JS-navigate straight to the authorize URL).
  // Checked before any container resolution so it applies from every origin:
  // named containers, Temporary Containers, and no container at all.
  if (
    settings.preserveAuthFlows &&
    (redirectChainRequests.has(details.requestId) || looksLikeAuthNavigation(details.url))
  ) {
    return {};
  }

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

  // Never relocate a navigation inside a popup window. "Sign in with Google"
  // and similar flows open a small popup via window.open() and hand the
  // result back to the page that launched it through window.opener. We move a
  // request between containers by cancelling it and re-creating the tab, which
  // severs that opener link — so the popup completes but the parent page never
  // receives the token and the sign-in silently fails. Leave popups alone.
  try {
    const win = await browser.windows.get(tab.windowId);
    if (win.type === 'popup') return {};
  } catch {
    // Window already gone or inaccessible; fall through and treat as normal.
  }

  const url = new URL(details.url);
  const currentCookieStoreId = tab.cookieStoreId || 'firefox-default';

  // A tab (or new window) opened from a link/window.open inherits its opener's
  // container from Firefox. Keep that first navigation in the container it came
  // from instead of handing off by a domain rule. This is the new-tab/window
  // half of the "keep links in their origin container" setting
  // (stickyContainers); the same-tab half lives in resolveTarget.
  //
  // Primary signal: webNavigation.onCreatedNavigationTarget recorded this tab
  // in linkedTabIds — the only signal that also covers opens into a new window.
  // It's authoritative for this navigation, so we do NOT also require
  // isFreshTab (a just-created tab's url is often still "" or about:blank here,
  // which used to make this check spuriously fail and let the domain rule win).
  // We consume the entry so only the first load is kept; later same-tab
  // navigations resolve normally.
  //
  // Fallback: tab.openerTabId (same-window only) in case that event raced this
  // request. openerTabId persists for the tab's life, so this path still needs
  // isFreshTab to avoid catching later navigations.
  let fromLinkedTab = false;
  if (settings.stickyContainers) {
    if (linkedTabIds.has(details.tabId)) {
      linkedTabIds.delete(details.tabId);
      fromLinkedTab = true;
    } else if (tab.openerTabId != null && isFreshTab(tab, details.url)) {
      fromLinkedTab = true;
    }
  }

  const target = resolveTarget({
    hostname: url.hostname,
    url: details.url,
    currentCookieStoreId,
    domainData,
    settings,
    state,
    allowTempFallback: true,
    fromLinkedTab,
  });

  let targetCookieStoreId = target.cookieStoreId;

  if (target.createTemp) {
    targetCookieStoreId = await createTemporaryContainer(settings, state);
    // state was persisted inside createTemporaryContainer; reload to keep in-memory state current.
    state = await loadState();
  }

  if (!targetCookieStoreId || targetCookieStoreId === currentCookieStoreId) {
    if (target.reason === 'linked-tab') {
      console.log('[Better Containers] kept linked tab in', currentCookieStoreId, 'for', details.url);
    }
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
  if (!booted || !settings.extensionEnabled) return [{ type: 'direct' }];
  const containerKey = getContainerKeyByCookieStoreId(details.cookieStoreId, settings);
  const proxy = containerKey ? getContainerProxy(containerKey, settings) : null;
  if (!proxy) return [{ type: 'direct' }];
  return [{ type: proxy.type, host: proxy.host, port: Number(proxy.port) }];
}

async function handleProxyAuth(details) {
  if (!booted || !settings.extensionEnabled || !details.isProxy || !vault.isUnlocked()) return {};

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
      console.warn('[Better Containers] scheduled GC failed', err);
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

    case 'set-extension-enabled': {
      settings.extensionEnabled = message.value;
      await saveSettings(settings);
      updateActionBadge();
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

    case 'set-sticky-containers': {
      settings.stickyContainers = message.value;
      await saveSettings(settings);
      return { settings };
    }

    case 'set-preserve-auth-flows': {
      settings.preserveAuthFlows = message.value;
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
          console.warn('[Better Containers] failed to remove container', cfg.cookieStoreId, err);
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
      // Deep-clone: DEFAULT_SETTINGS is only shallow-frozen, so a spread would
      // leave nested objects (companies, customContainers, …) aliased to the
      // constant. ensureContainers() then writes cookieStoreIds straight into
      // that shared object, permanently polluting the defaults for the rest of
      // the session. structuredClone gives a fully independent, mutable copy.
      settings = structuredClone(DEFAULT_SETTINGS);
      rebuildDomainData();
      await ensureContainers(settings, domainData);
      await saveSettings(settings);
      updateActionBadge();
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

    case 'vault-reset':
      return vault.resetVault();

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

    case 'vault-import-credentials':
      return vaultOp(() => vault.importCredentials(message.entries));

    case 'vault-import-payment-methods':
      return vaultOp(() => vault.importPaymentMethods(message.entries));

    // --- Addresses ------------------------------------------------------

    case 'vault-list-addresses':
      return vaultOp(() => vault.listAddresses());

    case 'vault-save-address':
      return vaultOp(() => vault.saveAddress(message.entry));

    case 'vault-delete-address':
      return vaultOp(() => vault.deleteAddress(message.id));

    case 'vault-import-addresses':
      return vaultOp(() => vault.importAddresses(message.entries));

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

  // Track server-redirect chains for the preserveAuthFlows guard. Every leg
  // of a redirect keeps its requestId, so marking the id on the first
  // redirect covers all subsequent legs — including a POST login that 302s
  // back to the relying party (the redirected leg arrives as a GET with the
  // same id). Cleared when the request finishes either way.
  const redirectFilter = { urls: ['<all_urls>'], types: ['main_frame'] };
  browser.webRequest.onBeforeRedirect.addListener((details) => {
    redirectChainRequests.add(details.requestId);
  }, redirectFilter);
  browser.webRequest.onCompleted.addListener((details) => {
    redirectChainRequests.delete(details.requestId);
  }, redirectFilter);
  browser.webRequest.onErrorOccurred.addListener((details) => {
    redirectChainRequests.delete(details.requestId);
  }, redirectFilter);

  // Registered by syncProxyPermissionState() (called from boot(), and again
  // below whenever the optional "proxy" permission is granted/revoked at
  // runtime from the options page) rather than unconditionally here, since
  // browser.proxy isn't safe to touch before the permission is granted.

  browser.webRequest.onAuthRequired.addListener(
    handleProxyAuth,
    { urls: ['<all_urls>'] },
    ['blocking']
  );

  // Mark tabs opened to host a navigation from another tab (link, "open in new
  // tab/window", window.open). Fires for opens into a new window too, which
  // tab.openerTabId misses. Read once on the new tab's first navigation and
  // dropped when the tab goes away — see the fromLinkedTab guard.
  browser.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    linkedTabIds.add(details.tabId);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    linkedTabIds.delete(tabId);
    scheduleGc();
  });
  browser.tabs.onDetached.addListener(() => scheduleGc());

  browser.runtime.onMessage.addListener(handleMessage);

  browser.permissions.onAdded.addListener(({ permissions }) => {
    if (permissions.includes('proxy')) syncProxyPermissionState();
    if (permissions.includes('nativeMessaging')) syncNativeMessagingPermissionState();
  });
  browser.permissions.onRemoved.addListener(({ permissions }) => {
    if (permissions.includes('proxy')) syncProxyPermissionState();
    if (permissions.includes('nativeMessaging')) syncNativeMessagingPermissionState();
  });
}

init().catch((err) => console.error('[Better Containers] init error', err));
