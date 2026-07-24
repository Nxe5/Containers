# Architecture Overview

Better Containers is a **Manifest V2** Firefox extension. MV2 (with a persistent
background page) is used deliberately: the container-reassignment feature depends
on **blocking `webRequest`**, which MV3 removed. See [Why Firefox-only](#why-firefox-only).

## Components

| Component | File(s) | Role |
| --- | --- | --- |
| Background engine | `src/background/main.js` | Owns all browser listeners, applies rules, routes messages. The only long-lived context. |
| Rules | `src/lib/rules.js` | Pure functions: hostname → container decision. |
| Containers | `src/lib/containers.js` | Create/update containers, temp-container garbage collection. |
| Storage | `src/lib/storage.js` | Thin wrapper over `browser.storage.local` for `settings` and `state`. |
| Vault | `src/lib/vault.js` | Encrypted store for secrets; lives only in background memory when unlocked. |
| Native messaging | `src/lib/native-messaging.js` | Optional bridge to a local Node host. |
| Popup | `src/popup/*` | Toolbar UI. Talks to the engine only via `runtime.sendMessage`. |
| Options | `src/options/*` | Settings UI. Same message-passing contract. |
| Opener | `src/opener/*` | Landing page for `ext+container:` links. |
| Fill-login content script | `src/content/fill-login.js` | Injected on demand to fill a page's login fields. |

The popup and options pages hold **no authority** — they read state and send
typed messages; the background engine is the single source of truth.

## The background engine

`main.js` registers its listeners once, at load, and lazily `boot()`s (loads
settings/state, ensures containers exist, configures the vault auto-lock). Boot
is **best-effort**: if creating a container fails, the error is logged and boot
still completes, so the popup and message handling keep working.

Key listeners:

- **`webRequest.onBeforeRequest`** (blocking, `main_frame`, `<all_urls>`) — the
  heart of auto-isolation. For each top-level navigation it resolves the target
  container and, if it differs from the current one, cancels the request and
  reopens the URL in the right container.
- **`proxy.onRequest`** — routes a container's traffic through its configured
  proxy. Registered only while the optional `proxy` permission is held.
- **`webRequest.onAuthRequired`** (blocking) — supplies proxy credentials from
  the vault when a proxied request asks for auth.
- **`tabs.onRemoved` / `onDetached`** — schedule temp-container garbage collection.
- **`runtime.onMessage`** — the command router for the popup, options, and opener.
- **`permissions.onAdded` / `onRemoved`** — react live when the user grants or
  revokes the optional `proxy` / `nativeMessaging` permissions.

## Message flow

Everything the UI does is a message. Example — "Reopen this site in GitHub":

```
popup.js  ──runtime.sendMessage({type:'reopen-tab', tabId, cookieStoreId})──▶  main.js
main.js   registers a one-shot hint for the URL, then creates a new tab in the
          target container and removes the old one
```

The one-shot **hint** matters: it tells `onBeforeRequest` "the user explicitly
chose this container for this URL," so the engine doesn't immediately re-evaluate
and move the tab somewhere else. Hints expire after ~30s.

## The master switch

`settings.extensionEnabled` is a kill switch. When `false`, `onBeforeRequest`,
`proxy.onRequest`, and `onAuthRequired` all return early — automatic isolation and
proxy routing stop, but manual popup actions and the options page keep working, so
it can be turned back on. The toolbar button shows an `OFF` badge while disabled.
See [features/popup.md](../features/popup.md).

## Why Firefox-only

The core feature is built on two Firefox-only APIs with **no Chrome equivalent**:

- **`contextualIdentities`** — the container API. Chrome does not expose containers
  to extensions at all.
- **`proxy.onRequest`** — per-request proxy routing keyed by container.

On top of that, Chrome requires **Manifest V3**, which replaced blocking
`webRequest` with `declarativeNetRequest` — a static rule engine that cannot make
the dynamic, per-navigation container decisions this extension makes. Porting to
Chrome would mean rebuilding the isolation mechanism around a different primitive
(e.g. separate Chrome profiles driven by native messaging) — effectively a
different product. This extension targets Firefox only.
