/**
 * Domain matching and rule-resolution logic.
 */

import { DEFAULT_SETTINGS } from './defaults.js';

export function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Return the cookieStoreId for a matching user rule, or null.
 */
export function matchUserRule(hostname, userRules) {
  const h = normalizeHostname(hostname);
  for (const [pattern, cookieStoreId] of Object.entries(userRules || {})) {
    if (matchesDomain(h, normalizeHostname(pattern))) {
      return cookieStoreId;
    }
  }
  return null;
}

/**
 * Return the company key whose effective list matches the hostname, or null.
 */
export function matchCompany(hostname, domainData, settings) {
  const h = normalizeHostname(hostname);
  for (const key of Object.keys(domainData)) {
    const list = getEffectiveDomainList(key, domainData, settings);
    if (list.some((d) => matchesDomain(h, normalizeHostname(d)))) {
      return key;
    }
  }
  return null;
}

export function getEffectiveDomainList(companyKey, domainData, settings) {
  const overrides = settings?.domainOverrides || {};
  if (overrides[companyKey] && Array.isArray(overrides[companyKey])) {
    return overrides[companyKey];
  }
  return domainData[companyKey]?.domains || [];
}

function getContainerConfig(companyKey, settings) {
  return (
    settings?.companies?.[companyKey] ||
    settings?.customContainers?.[companyKey] ||
    null
  );
}

export function getCompanyCookieStoreId(companyKey, settings) {
  return getContainerConfig(companyKey, settings)?.cookieStoreId || null;
}

export function isCompanyEnabled(companyKey, settings) {
  return getContainerConfig(companyKey, settings)?.enabled !== false;
}

/**
 * Reverse lookup: given a cookieStoreId, find the company/custom container
 * key it belongs to. Used by proxy routing and the native-messaging bridge,
 * both of which only have a cookieStoreId (from a tab) to start from.
 */
export function getContainerKeyByCookieStoreId(cookieStoreId, settings) {
  if (!cookieStoreId) return null;
  for (const [key, cfg] of Object.entries(settings?.companies || {})) {
    if (cfg?.cookieStoreId === cookieStoreId) return key;
  }
  for (const [key, cfg] of Object.entries(settings?.customContainers || {})) {
    if (cfg?.cookieStoreId === cookieStoreId) return key;
  }
  return null;
}

/**
 * Non-secret proxy config for a container key, or null. Auth credentials (if
 * any) live in the encrypted vault, keyed by the same container key.
 */
export function getContainerProxy(containerKey, settings) {
  const proxy = settings?.containerProxies?.[containerKey];
  if (!proxy || !proxy.host || !proxy.port) return null;
  return proxy;
}

/**
 * Resolve which container a hostname belongs in.
 *
 * Precedence:
 *   1. One-shot external hint for this exact URL.
 *   2. User rule.
 *   3. Linked new tab (fromLinkedTab): a tab opened by a link/window.open
 *      from within any non-default container stays in that container.
 *   4. Sticky containers (only if enabled): stay in the current tab's
 *      container if it's already a named (built-in or custom) container.
 *   5. Enabled company default.
 *   6. Temporary container fallback (only if enabled).
 *
 * `fromLinkedTab` is computed by the caller (the background engine) because it
 * needs the opener + fresh-tab signals only available there; it already folds
 * in the keepLinkedTabsInContainer setting. Defaults false so callers that
 * only need domain resolution (popup display, etc.) are unaffected.
 *
 * Returns { cookieStoreId, reason } where reason is a short string.
 */
export function resolveTarget({
  hostname,
  url,
  currentCookieStoreId,
  domainData,
  settings,
  state,
  allowTempFallback = true,
  fromLinkedTab = false,
}) {
  const h = normalizeHostname(hostname);

  // 1. One-shot hint (explicit open via ext+container or popup action).
  if (url && state?.hintedUrls?.[url]) {
    const hint = state.hintedUrls[url];
    if (hint.until > Date.now()) {
      return { cookieStoreId: hint.cookieStoreId, reason: 'hint' };
    }
  }

  // 2. User rules.
  const userMatch = matchUserRule(h, settings?.userRules);
  if (userMatch) {
    return { cookieStoreId: userMatch, reason: 'user-rule' };
  }

  // 3. Linked new tab. A tab opened by a link (or window.open) from inside a
  // container inherits that container from Firefox. Keep it there — even a
  // Temporary Container, and even when the URL matches a preset company that
  // owns its own container — so opening a link in a new tab never pulls you
  // out of the context you were browsing. Broader than sticky (which excludes
  // Temporary Containers), but narrower in trigger: the caller only sets
  // fromLinkedTab on the new tab's first navigation, so same-tab navigations
  // still hand off by domain rule. An explicit user rule above still wins.
  if (
    fromLinkedTab &&
    currentCookieStoreId &&
    currentCookieStoreId !== 'firefox-default'
  ) {
    return { cookieStoreId: currentCookieStoreId, reason: 'linked-tab' };
  }

  // 4. Sticky containers. Once you're inside a named container, links it
  // opens (including in a new tab, since Firefox already assigns the
  // opener's container to it) stay there instead of being moved by a
  // company rule or the temporary-container fallback below. Deliberately
  // does not apply inside a Temporary Container: a link to a domain with its
  // own dedicated container should still hand off to it, landing in the
  // logged-in session rather than staying in a disposable container.
  if (
    settings?.stickyContainers &&
    currentCookieStoreId &&
    currentCookieStoreId !== 'firefox-default' &&
    !isTemporaryContainerId(currentCookieStoreId, state)
  ) {
    return { cookieStoreId: currentCookieStoreId, reason: 'sticky' };
  }

  // 5. Company defaults.
  const companyKey = matchCompany(h, domainData, settings);
  if (companyKey && isCompanyEnabled(companyKey, settings)) {
    const id = getCompanyCookieStoreId(companyKey, settings);
    if (id) {
      return { cookieStoreId: id, reason: `company:${companyKey}` };
    }
  }

  // 6. Temporary container fallback.
  if (
    allowTempFallback &&
    settings?.isolateUnmatched &&
    !isTemporaryContainerId(currentCookieStoreId, state)
  ) {
    return { cookieStoreId: null, reason: 'temporary', createTemp: true };
  }

  return { cookieStoreId: null, reason: 'no-match' };
}

/**
 * Heuristic: does this URL look like a hop in a sign-in flow (OAuth2 /
 * OIDC / SAML / plain login page)? Used to keep an auth chain in the
 * container it started in instead of relocating it by company rule —
 * "Login with GitHub" on some site should use *that tab's* container (and
 * whatever account is signed in there), not yank the flow into the global
 * GitHub container.
 *
 * Two signals, either suffices:
 *  1. Query params that only appear on authorization/SSO endpoints
 *     (client_id + redirect_uri together, response_type, SAMLRequest/Response).
 *  2. A path segment that marks dedicated auth endpoints (/oauth, /authorize,
 *     /signin, /sso, /saml, /login). Segment-anchored so e.g. /blog/login-tips
 *     doesn't match.
 */
const AUTH_PATH_RE = /(^|\/)(oauth2?|authorize|auth|login|signin|sign-in|sso|saml2?|openid|idp)(\/|$)/i;

export function looksLikeAuthNavigation(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  const params = url.searchParams;
  if (params.has('client_id') && params.has('redirect_uri')) return true;
  if (params.has('response_type')) return true;
  if (params.has('SAMLRequest') || params.has('SAMLResponse')) return true;
  return AUTH_PATH_RE.test(url.pathname);
}

export function isTemporaryContainerId(cookieStoreId, state) {
  return (
    cookieStoreId != null &&
    cookieStoreId.startsWith('firefox-container-') &&
    state?.tempContainers?.[cookieStoreId] != null
  );
}
