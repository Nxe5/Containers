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
 *   3. Sticky containers (only if enabled): stay in the current tab's
 *      container if it's already a named (built-in or custom) container.
 *   4. Enabled company default.
 *   5. Temporary container fallback (only if enabled).
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

  // 3. Sticky containers. Once you're inside a named container, links it
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

  // 4. Company defaults.
  const companyKey = matchCompany(h, domainData, settings);
  if (companyKey && isCompanyEnabled(companyKey, settings)) {
    const id = getCompanyCookieStoreId(companyKey, settings);
    if (id) {
      return { cookieStoreId: id, reason: `company:${companyKey}` };
    }
  }

  // 5. Temporary container fallback.
  if (
    allowTempFallback &&
    settings?.isolateUnmatched &&
    !isTemporaryContainerId(currentCookieStoreId, state)
  ) {
    return { cookieStoreId: null, reason: 'temporary', createTemp: true };
  }

  return { cookieStoreId: null, reason: 'no-match' };
}

export function isTemporaryContainerId(cookieStoreId, state) {
  return (
    cookieStoreId != null &&
    cookieStoreId.startsWith('firefox-container-') &&
    state?.tempContainers?.[cookieStoreId] != null
  );
}
