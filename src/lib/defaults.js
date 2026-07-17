/**
 * Default extension state and settings.
 */

export const EXTENSION_ID = 'company-containers@example.com';

export const DEFAULT_SETTINGS = Object.freeze({
  // Send any navigation that doesn't match a company/user rule into a
  // brand-new Temporary Container instead of the current container.
  isolateUnmatched: true,

  // Cosmetic defaults for Temporary Containers.
  tempPrefix: 'Temp',
  tempColor: 'toolbar',
  tempIcon: 'circle',

  // When reopening a site into a container, remove the original tab instead
  // of opening a new tab next to it.
  replaceTabInsteadOfNew: false,

  // Per-company toggles and the cookieStoreId of the container we created.
  // cookieStoreId is persisted after first run.
  companies: {
    google:    { enabled: true, cookieStoreId: null },
    microsoft: { enabled: true, cookieStoreId: null },
    meta:      { enabled: true, cookieStoreId: null },
  },

  // Optional full domain overrides. If a key exists here it replaces the
  // bundled list for that company entirely.
  domainOverrides: {},

  // User-defined containers that behave like the built-in companies.
  // Key -> { label, color, icon, domains[], enabled, cookieStoreId }
  customContainers: {},

  // hostname -> cookieStoreId. Highest precedence rules.
  userRules: {},

  // Per-container proxy config (non-secret). Key matches a companies/
  // customContainers key. { type: 'http'|'https'|'socks'|'socks4', host, port }
  // Proxy auth username/password lives in the encrypted vault, not here.
  containerProxies: {},

  // Native Messaging bridge settings. The token itself is never stored, only
  // a hash of it, so it can be verified without being readable from settings.
  nativeMessaging: {
    tokenHash: null,
  },

  // Minutes of inactivity (browser.idle) before the vault auto-locks.
  vaultAutoLockMinutes: 15,
});

// URLs where replacing the tab is safe without losing the user's history.
export const FRESH_TAB_URLS = new Set([
  'about:blank',
  'about:newtab',
  'about:home',
  'about:privatebrowsing',
  'about:preferences',
  'about:settings',
]);

export const TEMP_CONTAINER_MARKER = 'cc-temp';
