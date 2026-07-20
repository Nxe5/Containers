# Company Containers — Documentation

This folder documents how the extension is built and how each feature works.
For a quick overview and install instructions, see the [root README](../README.md).

## Architecture

How the pieces fit together and how a navigation becomes a container decision.

- [Overview](./architecture/overview.md) — components, the background engine, message flow, why Firefox-only
- [Rule resolution](./architecture/rule-resolution.md) — domain matching and the precedence order
- [Storage & state](./architecture/storage-and-state.md) — the `settings` and `state` shapes and how they persist

## Features

- [Containers](./features/containers.md) — built-in company, custom, and temporary containers
- [Popup](./features/popup.md) — the toolbar panel and the enable/disable switch
- [Options page](./features/options.md) — every settings section
- [Vault](./features/vault.md) — encrypted credentials, payment methods, addresses, proxy auth
- [Per-container proxies](./features/proxies.md) — routing a container through a proxy
- [External links](./features/external-links.md) — the `ext+container:` protocol and launcher
- [Native messaging](./features/native-messaging.md) — the local automation bridge

## Guides

- [Development](./guides/development.md) — project layout, build, lint, run, test
- [Permissions](./guides/permissions.md) — what each manifest permission is for
- [AMO listing copy](./guides/amo-listing.md) — draft summary, description, category, and support links
- [Submitting to Firefox](./guides/submitting-to-firefox.md) — the AMO release checklist

## Source layout

```
manifest.json                 WebExtension manifest (Manifest V2)
src/
  background/main.js          Engine: listeners, rule application, message router
  data/domains.json           Built-in YouTube / Gmail / GitHub / Amazon domain lists
  lib/
    defaults.js               Default settings and constants
    storage.js                storage.local wrapper (settings + state)
    rules.js                  Domain matching and precedence
    containers.js             Container CRUD and temp-container GC
    vault.js                  Encrypted vault (WebCrypto)
    native-messaging.js       connectNative bridge to native-host/
  popup/                      Toolbar popup (home + container-picker pages)
  options/                    Full settings page
  opener/                     ext+container: protocol handler target
  content/fill-login.js       On-demand credential-fill content script
  icons/icon.svg
native-host/                  Companion Node process for the automation bridge (not bundled)
scripts/                      OS launcher + native-host installer + rule tests (not bundled)
```

`native-host/`, `scripts/`, and project docs are excluded from the packaged
add-on by `web-ext-config.cjs` — the uploaded zip contains only `manifest.json`
and `src/`.
