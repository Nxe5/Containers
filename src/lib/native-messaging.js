/**
 * Bridge to the local Native Messaging host (see native-host/index.js).
 *
 * The extension is the only side that can *initiate* a native-messaging
 * connection, so it opens one at boot and keeps it alive. The host process
 * (spawned by Firefox) relays requests from a local Unix socket that an
 * external automation script (e.g. a Playwright script) connects to. Every
 * request must carry a bearer token that's checked against
 * settings.nativeMessaging.tokenHash before touching the vault, and requests
 * for actual secrets fail with 'vault-locked' unless the vault has been
 * unlocked from inside the browser first — the master password itself never
 * crosses this bridge.
 */

import { loadSettings } from './storage.js';
import * as vault from './vault.js';

const NATIVE_APP_NAME = 'com_companycontainers_host';
const RECONNECT_DELAY_MS = 60000;

let port = null;
let reconnectTimeout = null;
let hasWarned = false;
let torndown = false;

async function dispatch(type, message) {
  switch (type) {
    case 'get-credential':
      return vault.findCredentialsForHostname(message.website || '');
    case 'list-credentials': {
      const all = vault.listCredentials();
      return message.containerKey
        ? all.filter((c) => c.containerKey === message.containerKey)
        : all;
    }
    default:
      throw new Error(`unknown request type: ${type}`);
  }
}

function reply(id, payload) {
  if (!port) return;
  port.postMessage({ id, ...payload });
}

async function handleHostMessage(message) {
  const { id, type } = message || {};
  if (!id) return;

  try {
    const settings = await loadSettings();
    const tokenHash = settings.nativeMessaging?.tokenHash;
    if (!tokenHash) {
      return reply(id, { ok: false, error: 'bridge-not-configured' });
    }
    if (!(await vault.verifyToken(message.token, tokenHash))) {
      return reply(id, { ok: false, error: 'invalid-token' });
    }

    const result = await dispatch(type, message);
    reply(id, { ok: true, result });
  } catch (err) {
    const error = err.message === 'vault-locked' ? 'vault-locked' : 'internal-error';
    if (error === 'internal-error') {
      console.error('[Better Containers] native-messaging request failed', err);
    }
    reply(id, { ok: false, error });
  }
}

function scheduleReconnect() {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect() {
  try {
    port = browser.runtime.connectNative(NATIVE_APP_NAME);
  } catch (err) {
    port = null;
    scheduleReconnect();
    return;
  }

  port.onMessage.addListener(handleHostMessage);
  port.onDisconnect.addListener(() => {
    const err = browser.runtime.lastError;
    if (err && !hasWarned) {
      // Expected/common if the user hasn't run scripts/install-native-host.sh
      // yet; warn once instead of every retry.
      console.warn('[Better Containers] native host unavailable:', err.message);
      hasWarned = true;
    }
    port = null;
    if (!torndown) scheduleReconnect();
  });

  hasWarned = false;
}

export function initNativeMessaging() {
  torndown = false;
  connect();
}

/**
 * Stop talking to the native host and cancel any pending reconnect. Used
 * when the "nativeMessaging" optional permission is revoked at runtime, so
 * we don't keep retrying connectNative() without the permission to back it.
 */
export function stopNativeMessaging() {
  torndown = true;
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (port) {
    try {
      port.disconnect();
    } catch {
      // already gone
    }
    port = null;
  }
}
