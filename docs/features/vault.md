# Vault

An optional encrypted store for secrets — site logins, payment methods, addresses,
and per-container proxy passwords. Implemented in `src/lib/vault.js` using WebCrypto.
It is **separate** from ordinary [settings/state](../architecture/storage-and-state.md):
only an encrypted blob ever touches `browser.storage.local`.

## Cryptography

- **Cipher:** AES-256-GCM.
- **Key derivation:** PBKDF2 (SHA-256, 210,000 iterations) from a master password
  the user chooses, with a random 16-byte salt.
- **Per-write IV:** a fresh random 12-byte IV each time the blob is re-encrypted.
- **At rest:** only `{ version, salt, iterations, iv, ciphertext }` is stored. The
  master password and the derived key are never written to disk.

## Lifecycle

- **Create** (first time) or **Unlock** (later) from Options → Vault by entering the
  master password. There is **no recovery** — the key derives solely from the
  password. The only way out of a forgotten password is **Reset**, which deletes all
  vault data.
- The decrypted data and key live **only in the background page's memory** for the
  session.
- **Auto-lock:** after `vaultAutoLockMinutes` of inactivity (via `browser.idle`;
  default 15). Locking or restarting the browser also clears it. A locked vault
  requires the master password again.

## What it stores

| Table | Fields |
| --- | --- |
| Site credentials | website, account, password, container, notes |
| Payment methods | nickname, cardholder, card number, CVV, expiry, billing address, container |
| Addresses | label, recipient, address lines, city, state, postal code, country, phone, container |
| Proxy credentials | username/password, keyed by container (see [proxies.md](./proxies.md)) |

## How secrets are used

- **Fill login** (popup) — when the vault is unlocked and a credential matches the
  current site, the popup can fill the page's fields on click. See [popup.md](./popup.md).
- **Proxy auth** — proxy passwords are supplied to `webRequest.onAuthRequired`
  automatically while the vault is unlocked.
- **Native-messaging bridge** — an external script can request a credential, but only
  while the vault is unlocked in the browser. The master password never crosses the
  bridge. See [native-messaging.md](./native-messaging.md).

## A note on payment data

Storing full card numbers and CVVs is a materially larger security surface than a
browser normally takes on. This is **not** a PCI-compliant system — there's no
tokenization, and a bug or compromised update could expose real card data. Treat your
master password, this browser profile, and any backups with the same care as the
physical cards. The Options page repeats this warning inline.
