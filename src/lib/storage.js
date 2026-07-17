import { DEFAULT_SETTINGS } from './defaults.js';

/**
 * Lightweight wrapper around browser.storage.local.
 */

const SETTINGS_KEY = 'settings';
const STATE_KEY = 'state';

export const DEFAULT_STATE = Object.freeze({
  // Monotonic counter used to name Temporary Containers.
  tempCounter: 0,
  // Map cookieStoreId -> { createdAt } for containers we created.
  tempContainers: {},
  // One-shot hints: url -> { cookieStoreId, until }. Used by the opener and
  // by the popup "reopen in container" feature so the engine doesn't fight
  // an explicit user choice.
  hintedUrls: {},
});

/**
 * Merge a possibly partial saved object with the default shape.
 */
function mergeDefaults(saved, defaults) {
  const out = { ...defaults };
  if (!saved || typeof saved !== 'object') {
    return out;
  }
  for (const key of Object.keys(defaults)) {
    if (saved[key] !== undefined) {
      if (
        defaults[key] !== null &&
        typeof defaults[key] === 'object' &&
        !Array.isArray(defaults[key])
      ) {
        out[key] = { ...defaults[key], ...saved[key] };
      } else {
        out[key] = saved[key];
      }
    }
  }
  return out;
}

export async function loadSettings() {
  const { [SETTINGS_KEY]: saved } = await browser.storage.local.get(SETTINGS_KEY);
  return mergeDefaults(saved, DEFAULT_SETTINGS);
}

export async function saveSettings(settings) {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadState() {
  const { [STATE_KEY]: saved } = await browser.storage.local.get(STATE_KEY);
  return mergeDefaults(saved, DEFAULT_STATE);
}

export async function saveState(state) {
  await browser.storage.local.set({ [STATE_KEY]: state });
}
