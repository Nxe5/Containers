# Company Containers

A Firefox extension that automatically isolates **YouTube**, **Gmail**,
**GitHub**, and **Amazon** into their own [containers](https://support.mozilla.org/en-US/kb/containers),
and drops everything else into a disposable **Temporary Container** that's wiped
when its last tab closes.

Cookies, logins, and local storage for one site never leak into another's —
or into your general browsing.

## Features

- **Automatic isolation** — navigating to YouTube, Gmail, GitHub, or Amazon
  reopens the tab in its own container. Domain lists ship built-in and are editable.
- **Temporary containers** — unmatched sites open in a throwaway container that's
  garbage-collected once empty.
- **Custom containers** — add your own (Work, Banking, Shopping…) with their own
  domains, color, and icon.
- **Per-site overrides** — pin any hostname to a specific container.
- **One-click enable/disable** — a master switch in the popup (with a confirm
  prompt) pauses all automatic isolation without losing your settings.
- **Encrypted vault** (optional) — store site logins, payment methods, and
  addresses behind a master password (AES-256-GCM); a popup "Fill login" action
  fills the current page.
- **Per-container proxies** (optional) — route a container's traffic through its
  own proxy, with credentials kept in the vault.
- **External links** — open links from outside Firefox in the right container via
  the `ext+container:` protocol and the included launcher script.

## Install

**From Firefox Add-ons (AMO):** _coming soon._

**For development** (temporary load):

```bash
pnpm install          # installs web-ext (the only dependency)
pnpm run start        # launches Firefox with the extension loaded
```

Or load it manually: open `about:debugging` → **This Firefox** →
**Load Temporary Add-on** → select `manifest.json`.

## Build & verify

```bash
pnpm run lint         # web-ext lint — validates the manifest (0 warnings expected)
pnpm run build        # writes web-ext-artifacts/company_containers-<version>.zip
node scripts/validate/rules.js   # runs the rule-resolution assertions
```

## Documentation

Full documentation lives in [`docs/`](./docs/):

- [Architecture](./docs/architecture/overview.md) — how the engine, rules, and storage fit together
- [Features](./docs/features/) — popup, options, containers, vault, proxies, external links, native messaging
- [Development guide](./docs/guides/development.md) — project layout, build, test
- [Permissions](./docs/guides/permissions.md) — what each permission is for
- [Submitting to Firefox](./docs/guides/submitting-to-firefox.md) — AMO release checklist

## Privacy

No data is collected or transmitted anywhere — everything stays on your device.
See [`PRIVACY.md`](./PRIVACY.md) for the full policy.

## Compatibility

Firefox **142+** (desktop and Android). This extension relies on Firefox-only
container APIs (`contextualIdentities`) and has **no Chrome equivalent** —
Chrome does not expose containers to extensions. See
[architecture/overview.md](./docs/architecture/overview.md#why-firefox-only).

## License

Provided as a starting point for personal use. The reference extensions it learns
from ([Multi-Account Containers](https://github.com/mozilla/multi-account-containers),
[Temporary Containers](https://github.com/stoically/temporary-containers),
[Open URL in Container](https://github.com/honsiorovskyi/open-url-in-container))
are MPL-2.0 licensed.
