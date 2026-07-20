/**
 * Container creation, lookup, and temporary-container garbage collection.
 */

import { loadState, saveState } from './storage.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const ALL_CONTAINER_COLORS = new Set([
  'blue',
  'turquoise',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
  'toolbar',
]);

const ALL_CONTAINER_ICONS = new Set([
  'fingerprint',
  'briefcase',
  'dollar',
  'cart',
  'circle',
  'gift',
  'vacation',
  'food',
  'fruit',
  'pet',
  'tree',
  'chill',
  'fence',
]);

function normalizeName(name) {
  return name.trim();
}

function sanitizeContainerParams({ color, icon }) {
  return {
    color: ALL_CONTAINER_COLORS.has(color) ? color : 'toolbar',
    icon: ALL_CONTAINER_ICONS.has(icon) ? icon : 'circle',
  };
}

/**
 * Ensure all configured containers (built-in companies and user-defined
 * custom containers) exist. Creates missing ones and persists their
 * cookieStoreIds in the right place in settings.
 */
export async function ensureContainers(settings, domainData) {
  let changed = false;
  const existing = await browser.contextualIdentities.query({});

  for (const [key, meta] of Object.entries(domainData)) {
    const label = meta.label;
    const isCustom = settings.customContainers && key in settings.customContainers;
    const entry = isCustom
      ? settings.customContainers[key]
      : settings.companies[key] || { enabled: true, cookieStoreId: null };

    let found = existing.find(
      (c) => c.cookieStoreId === entry.cookieStoreId ||
             c.name.toLowerCase() === label.toLowerCase()
    );

    const { color, icon } = sanitizeContainerParams(meta);

    if (!found) {
      try {
        found = await browser.contextualIdentities.create({
          name: label,
          color,
          icon,
        });
        changed = true;
      } catch (err) {
        console.warn('[Company Containers] failed to create container', key, err);
        continue;
      }
    } else if (
      found.name !== label ||
      found.color !== color ||
      found.icon !== icon
    ) {
      try {
        found = await browser.contextualIdentities.update(found.cookieStoreId, {
          name: label,
          color,
          icon,
        });
        changed = true;
      } catch (err) {
        console.warn('[Company Containers] failed to update container', found.cookieStoreId, err);
      }
    }

    const updated = { ...entry, cookieStoreId: found.cookieStoreId };
    if (isCustom) {
      settings.customContainers[key] = updated;
    } else {
      settings.companies[key] = updated;
    }
  }

  return { changed };
}

// Backwards-compatible alias.
export const ensureCompanyContainers = ensureContainers;

/**
 * Look up a container by name (case-insensitive). Returns null if not found.
 */
export async function lookupContainerByName(name) {
  const normalized = normalizeName(name).toLowerCase();
  const all = await browser.contextualIdentities.query({});
  return all.find((c) => c.name.toLowerCase() === normalized) || null;
}

/**
 * Ensure a container exists for the given name, creating it if necessary.
 */
export async function ensureContainerForName(name, { color, icon } = {}) {
  const existing = await lookupContainerByName(name);
  if (existing) return existing;

  const sanitized = sanitizeContainerParams({ color, icon });
  return browser.contextualIdentities.create({
    name: normalizeName(name),
    ...sanitized,
  });
}

/**
 * Create a new Temporary Container and register it in state.
 */
export async function createTemporaryContainer(settings, state) {
  state.tempCounter = (state.tempCounter || 0) + 1;
  const name = `${settings.tempPrefix || 'Temp'} ${state.tempCounter}`;
  const { color, icon } = sanitizeContainerParams({
    color: settings.tempColor,
    icon: settings.tempIcon,
  });

  const identity = await browser.contextualIdentities.create({ name, color, icon });

  state.tempContainers = {
    ...state.tempContainers,
    [identity.cookieStoreId]: {
      createdAt: Date.now(),
    },
  };

  await saveState(state);
  return identity.cookieStoreId;
}

/**
 * Remove Temporary Containers that no longer have any tabs.
 */
export async function gcTemporaryContainers() {
  const state = await loadState();
  const tempIds = Object.keys(state.tempContainers || {});
  if (tempIds.length === 0) return { removed: [] };

  const tabs = await browser.tabs.query({});
  const used = new Set(tabs.map((t) => t.cookieStoreId));

  const removed = [];
  for (const id of tempIds) {
    if (!used.has(id)) {
      try {
        await browser.contextualIdentities.remove(id);
        removed.push(id);
      } catch (err) {
        console.warn('[Company Containers] failed to remove temp container', id, err);
      }
      delete state.tempContainers[id];
    }
  }

  await saveState(state);
  return { removed };
}

/**
 * Register a one-shot hint so the engine yields to an explicit user choice.
 */
export async function registerHint(url, cookieStoreId, ttlMs = 30000) {
  const state = await loadState();
  state.hintedUrls = {
    ...(state.hintedUrls || {}),
    [url]: { cookieStoreId, until: Date.now() + ttlMs },
  };
  await saveState(state);
}

/**
 * Return a map of all known contextual identities keyed by cookieStoreId.
 */
export async function getAllContainers() {
  const all = await browser.contextualIdentities.query({});
  return Object.fromEntries(all.map((c) => [c.cookieStoreId, c]));
}
