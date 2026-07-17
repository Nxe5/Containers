/**
 * Encrypted vault for site credentials, payment methods, and proxy auth.
 *
 * The vault is a single JSON blob encrypted with AES-256-GCM using a key
 * derived (PBKDF2) from a master password the user chooses. Only the
 * encrypted manifest ({salt, iterations, iv, ciphertext}) ever touches
 * browser.storage.local. The decrypted data and the derived key live only in
 * this module's memory for the current session, and are dropped on lock,
 * idle timeout, or background-page restart.
 */

import { normalizeHostname } from './rules.js';

const VAULT_KEY = 'vault';
const PBKDF2_ITERATIONS = 210000;

const enc = new TextEncoder();
const dec = new TextDecoder();

let vaultKey = null;
let vaultData = null;
let idleListenerAdded = false;
let autoLockMinutes = 15;

function emptyVaultData() {
  return {
    credentials: [],
    paymentMethods: [],
    proxyCredentials: {},
  };
}

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(password, salt, iterations) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

async function decryptJson(key, ivB64, ciphertextB64) {
  const iv = new Uint8Array(fromB64(ivB64));
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromB64(ciphertextB64)
  );
  return JSON.parse(dec.decode(plaintext));
}

async function loadManifest() {
  const { [VAULT_KEY]: manifest } = await browser.storage.local.get(VAULT_KEY);
  return manifest || null;
}

async function saveManifest(manifest) {
  await browser.storage.local.set({ [VAULT_KEY]: manifest });
}

export async function vaultExists() {
  return (await loadManifest()) !== null;
}

export function isUnlocked() {
  return vaultKey !== null && vaultData !== null;
}

export async function vaultStatus() {
  return { exists: await vaultExists(), unlocked: isUnlocked() };
}

function requireUnlocked() {
  if (!isUnlocked()) throw new Error('vault-locked');
}

async function persist() {
  requireUnlocked();
  const manifest = await loadManifest();
  const { iv, ciphertext } = await encryptJson(vaultKey, vaultData);
  await saveManifest({ ...manifest, iv, ciphertext });
}

/**
 * Create a brand-new vault protected by `password`. Fails if one already
 * exists — use unlockVault to open it instead.
 */
export async function createVault(password) {
  if (await vaultExists()) {
    return { ok: false, error: 'vault-exists' };
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const data = emptyVaultData();
  const { iv, ciphertext } = await encryptJson(key, data);

  await saveManifest({
    version: 1,
    salt: toB64(salt),
    iterations: PBKDF2_ITERATIONS,
    iv,
    ciphertext,
  });

  vaultKey = key;
  vaultData = data;
  ensureIdleListener();
  return { ok: true };
}

export async function unlockVault(password) {
  const manifest = await loadManifest();
  if (!manifest) return { ok: false, error: 'no-vault' };

  const salt = new Uint8Array(fromB64(manifest.salt));
  const key = await deriveKey(password, salt, manifest.iterations);

  let data;
  try {
    data = await decryptJson(key, manifest.iv, manifest.ciphertext);
  } catch {
    return { ok: false, error: 'invalid-password' };
  }

  vaultKey = key;
  vaultData = data;
  ensureIdleListener();
  return { ok: true };
}

export function lockVault() {
  vaultKey = null;
  vaultData = null;
}

/**
 * Auto-lock the vault after `minutes` of user inactivity (browser.idle).
 * Safe to call repeatedly (e.g. whenever settings change).
 */
export function configureAutoLock(minutes) {
  autoLockMinutes = Math.max(1, minutes || 15);
  browser.idle.setDetectionInterval(Math.max(15, autoLockMinutes * 60));
  ensureIdleListener();
}

function ensureIdleListener() {
  if (idleListenerAdded) return;
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'idle' || state === 'locked') {
      lockVault();
    }
  });
  idleListenerAdded = true;
}

// --- Site credentials ---------------------------------------------------

function hostnameMatchesWebsite(website, hostname) {
  const w = normalizeHostname(String(website).replace(/^https?:\/\//, '').split('/')[0]);
  const h = normalizeHostname(hostname);
  return h === w || h.endsWith(`.${w}`);
}

export function listCredentials() {
  requireUnlocked();
  return vaultData.credentials.map((c) => ({ ...c }));
}

export function findCredentialsForHostname(hostname) {
  requireUnlocked();
  return vaultData.credentials.filter((c) => hostnameMatchesWebsite(c.website, hostname));
}

export async function saveCredential(entry) {
  requireUnlocked();
  const id = entry.id || crypto.randomUUID();
  const now = Date.now();
  const idx = vaultData.credentials.findIndex((c) => c.id === id);
  const record = {
    id,
    website: entry.website,
    account: entry.account,
    password: entry.password,
    containerKey: entry.containerKey || null,
    notes: entry.notes || '',
    createdAt: idx >= 0 ? vaultData.credentials[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) vaultData.credentials[idx] = record;
  else vaultData.credentials.push(record);
  await persist();
  return record;
}

export async function deleteCredential(id) {
  requireUnlocked();
  vaultData.credentials = vaultData.credentials.filter((c) => c.id !== id);
  await persist();
}

// --- Payment methods ------------------------------------------------------

export function listPaymentMethods() {
  requireUnlocked();
  return vaultData.paymentMethods.map((p) => ({ ...p }));
}

export async function savePaymentMethod(entry) {
  requireUnlocked();
  const id = entry.id || crypto.randomUUID();
  const now = Date.now();
  const idx = vaultData.paymentMethods.findIndex((p) => p.id === id);
  const record = {
    id,
    nickname: entry.nickname,
    cardholderName: entry.cardholderName,
    cardNumber: entry.cardNumber,
    cvv: entry.cvv,
    expiry: entry.expiry,
    billingAddress: entry.billingAddress || '',
    containerKey: entry.containerKey || null,
    createdAt: idx >= 0 ? vaultData.paymentMethods[idx].createdAt : now,
    updatedAt: now,
  };
  if (idx >= 0) vaultData.paymentMethods[idx] = record;
  else vaultData.paymentMethods.push(record);
  await persist();
  return record;
}

export async function deletePaymentMethod(id) {
  requireUnlocked();
  vaultData.paymentMethods = vaultData.paymentMethods.filter((p) => p.id !== id);
  await persist();
}

// --- Proxy auth credentials ------------------------------------------------

export function getProxyCredential(containerKey) {
  requireUnlocked();
  return vaultData.proxyCredentials[containerKey] || null;
}

export async function setProxyCredential(containerKey, { username, password }) {
  requireUnlocked();
  vaultData.proxyCredentials = {
    ...vaultData.proxyCredentials,
    [containerKey]: { username, password },
  };
  await persist();
}

export async function deleteProxyCredential(containerKey) {
  requireUnlocked();
  const next = { ...vaultData.proxyCredentials };
  delete next[containerKey];
  vaultData.proxyCredentials = next;
  await persist();
}

// --- Native-messaging API token --------------------------------------------
// The token gates the local Playwright/automation bridge. It is not part of
// the vault (it's a bearer credential for the *bridge*, not vault contents)
// so it can be verified even while the vault is locked; only its hash is
// persisted in plain settings.

export function generateApiToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/[+/=]/g, '');
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return toB64(digest);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyToken(token, hash) {
  if (!token || !hash) return false;
  const actual = await hashToken(token);
  return timingSafeEqual(actual, hash);
}
