# Storage & State

All persistence goes through `browser.storage.local`, wrapped by
`src/lib/storage.js`. Two top-level keys are stored: **`settings`** (user config)
and **`state`** (engine bookkeeping). Secrets are **not** here — they live in the
separately-encrypted [vault](../features/vault.md).

Both loaders run saved data through `mergeDefaults()`, so older stored objects that
predate a newly-added field are transparently filled in from the defaults. Callers
never have to null-check a missing field.

## `settings`

Defined in `src/lib/defaults.js` (`DEFAULT_SETTINGS`). Shape:

| Field | Meaning |
| --- | --- |
| `extensionEnabled` | Master switch. `false` pauses auto-isolation and proxy routing. |
| `isolateUnmatched` | Send unmatched navigations to a temporary container. |
| `tempPrefix` / `tempColor` / `tempIcon` | Cosmetics for generated temporary containers. |
| `replaceTabInsteadOfNew` | When reopening a site, remove the original tab vs. open a new one beside it. |
| `companies` | Per-company `{ enabled, cookieStoreId }`. `cookieStoreId` is filled after the container is created. |
| `domainOverrides` | Optional full replacement of a company's domain list. |
| `customContainers` | User-defined containers: `{ label, color, icon, domains[], enabled, cookieStoreId }`. |
| `userRules` | `hostname → cookieStoreId`. Highest-precedence static rules. |
| `containerProxies` | Per-container proxy config `{ type, host, port }` (non-secret; auth is in the vault). |
| `nativeMessaging.tokenHash` | Hash of the automation-bridge bearer token (never the token itself). |
| `vaultAutoLockMinutes` | Idle minutes before the vault auto-locks. |

## `state`

Defined as `DEFAULT_STATE` in `storage.js`. Engine bookkeeping, not user-facing:

| Field | Meaning |
| --- | --- |
| `tempCounter` | Monotonic counter used to name temporary containers (`Temp 1`, `Temp 2`, …). |
| `tempContainers` | `cookieStoreId → { createdAt }` for containers the engine created, so they can be GC'd. |
| `hintedUrls` | `url → { cookieStoreId, until }` one-shot hints (see [rule resolution](./rule-resolution.md)). |

## In-memory vs. persisted

The background engine keeps live `settings` and `state` objects in memory. After a
mutation it saves to storage **and** re-reads where another path may have changed
state concurrently (e.g. temp-container creation). The persistent MV2 background
page means this in-memory state survives for the browser session; on restart it is
reloaded from storage at boot.

## What is *not* stored here

- **Master password** — never stored anywhere; only used to derive the vault key.
- **Vault contents** (credentials, cards, addresses, proxy passwords) — stored only
  as an encrypted blob under a separate `vault` key. See [vault.md](../features/vault.md).
- **Automation-bridge token** — only its hash is kept, in `settings.nativeMessaging`.
