# Native Messaging Bridge

An **optional** bridge that lets a local script (e.g. a Playwright automation) read
stored credentials — without ever seeing your master password. It uses the optional
`nativeMessaging` permission and a companion Node process in `native-host/` (which is
**not** part of the packaged add-on).

> This is an advanced, opt-in feature. If you don't set it up, nothing about it runs.

## Pieces

- **`native-host/index.js`** — a Node process Firefox spawns when the extension calls
  `connectNative()`. It speaks native-messaging framing on stdio to the extension and
  separately listens on a local Unix socket (`~/.company-containers/host.sock`, mode
  `0600`) for external clients.
- **`src/lib/native-messaging.js`** — the extension side. Opens the `connectNative`
  port and answers relayed requests. Connected only while the `nativeMessaging`
  permission is held; revoking it disconnects cleanly (`stopNativeMessaging`).
- **`native-host/example-client.js`** — a minimal reference socket client.

## Setup

1. Run `scripts/install-native-host.sh` once. It registers the host manifest with
   Firefox (name `com_companycontainers_host`) and pins `allowed_extensions` to this
   extension's ID. Re-run it if you move the repo.
2. Reload the extension, then Options → **Native messaging bridge** → **Regenerate
   token**. The first click prompts for the `nativeMessaging` permission. Copy the
   token — it's shown once; only its **hash** is stored in settings.
3. From your script, connect to the socket and send newline-delimited JSON:
   ```json
   {"id":"1","type":"get-credential","token":"<token>","website":"github.com"}
   ```
   ```bash
   node native-host/example-client.js github.com <token>
   ```

## Security model

- Every request must carry the bearer token, verified against the stored hash
  (constant-time compare) before anything touches the vault.
- Requests for secrets fail with `vault-locked` unless the vault was unlocked **in
  the browser** first. The master password never crosses the bridge.
- The host process never holds the vault key or password — it only relays whatever
  the extension chooses to return for a given request.
- The token gates the *bridge*, not the vault, so it's verifiable even while the
  vault is locked; that's why its hash lives in plain settings rather than the vault.

## Why the host isn't bundled

`native-host/` is raw Node (`net`/`fs`/`os`) and isn't referenced by
`manifest.json`. Bundling server-style Node code next to a browser extension is
exactly what AMO's automated review flags, so `web-ext-config.cjs` excludes it. Users
who want the bridge install the host from the repo separately.
