# Development Guide

The extension has **no build step** — it's plain ES modules loaded directly per
`manifest.json`. `pnpm` here only manages
[`web-ext`](https://github.com/mozilla/web-ext), Mozilla's packaging/lint CLI.

## Prerequisites

- Node.js (for `web-ext` and the native host)
- `pnpm`
- Firefox (Developer Edition or Nightly recommended for loading unsigned add-ons)

## Commands

```bash
pnpm install          # one-time: installs web-ext
pnpm run start        # launch Firefox with the extension loaded (live-reloads)
pnpm run lint         # web-ext lint — validate the manifest and scan for review flags
pnpm run build        # write web-ext-artifacts/company_containers-<version>.zip
```

Extra checks:

```bash
node scripts/validate/rules.js    # assertions for rule matching / precedence
```

## Loading manually

`about:debugging` → **This Firefox** → **Load Temporary Add-on** → select
`manifest.json`. Temporary add-ons persist until Firefox restarts. On first load the
three company containers are created.

For containers to work, `privacy.userContext.enabled` must be `true` (it is by
default in current Firefox).

## Project layout

See the [source layout](../README.md#source-layout) in the docs index. In short:

- **`src/background/main.js`** is the only long-lived context and owns every listener
  and the message router. Start here to trace any behavior.
- **`src/lib/*`** are focused, mostly-pure modules (rules, containers, storage, vault,
  native-messaging). `rules.js` is pure and unit-testable.
- **`src/popup`, `src/options`, `src/opener`, `src/content`** are UI/entry surfaces
  that only talk to the engine through `runtime.sendMessage`.

## Conventions

- **Manifest V2, persistent background page** — required for blocking `webRequest`.
  Don't port listeners to a service worker.
- **UI holds no authority** — never mutate settings from a page directly; send a
  message and let the engine persist and re-broadcast.
- **Optional permissions** (`proxy`, `nativeMessaging`) must be requested from a user
  gesture in the UI and synced in the engine via `permissions.onAdded/onRemoved`.
  Don't touch `browser.proxy` or `connectNative` unless the permission is held.
- **Secrets** go through `vault.js`, never into `settings`/`state`.
- Match the surrounding style: small pure helpers, `browser.*` promises with
  `async/await`, `[Containers]`-prefixed console logging.

## Testing

- `scripts/validate/rules.js` exercises `matchCompany`, `matchUserRule`, and
  `resolveTarget` with assertions. Run it after touching `src/lib/rules.js`.
- There is no automated UI test harness; verify popup/options changes by loading the
  extension (`pnpm run start`) and exercising the flow.
