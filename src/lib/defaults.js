/**
 * Default extension state and settings.
 */

export const EXTENSION_ID = '{d2e31876-bc5b-4d3c-b649-4b1faec96a87}';

export const DEFAULT_SETTINGS = Object.freeze({
  // Master kill switch. When false, the background engine stops
  // auto-redirecting tabs into containers and stops routing/authenticating
  // container proxies, without touching any other stored settings. Manual
  // popup actions and the options page keep working so it can be turned
  // back on.
  extensionEnabled: true,

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

  // Once a tab is already inside a named (built-in or custom) container,
  // keep links it opens — including ones opened in a new tab, which Firefox
  // already assigns the opener's container — in that same container instead
  // of letting domain rules or the Temporary Container fallback move them
  // elsewhere. Does not apply while already inside a Temporary Container: a
  // link to a domain with its own dedicated container (e.g. github.com)
  // still hands off to that container so you land in your logged-in session
  // rather than staying in a disposable one.
  // Defaults ON: without it, multi-domain login flows break. Google signs you
  // in on accounts.google.com, which no container owns, so the Temporary
  // Container fallback drops each auth hop into a fresh disposable jar and the
  // login cookies never survive the redirect ("cookies disabled"). Keeping the
  // redirect in the container that started it lets those cookies persist.
  stickyContainers: true,

  // Per-company toggles and the cookieStoreId of the container we created.
  // cookieStoreId is persisted after first run.
  companies: {
    youtube: { enabled: true, cookieStoreId: null },
    gmail:   { enabled: true, cookieStoreId: null },
    github:  { enabled: true, cookieStoreId: null },
    amazon:  { enabled: true, cookieStoreId: null },
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
