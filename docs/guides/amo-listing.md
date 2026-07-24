# AMO Store Listing Copy

Draft copy for the addons.mozilla.org submission form. Character counts noted
where AMO enforces a limit — recheck against the current form, since limits
occasionally change.

## Name

```
Better Containers
```

## Summary

AMO's summary field is capped at **250 characters**. This draft is 245.

```
Auto-isolate YouTube, Gmail, GitHub, and Amazon into their own containers so
cookies and logins never mix. Unmatched sites open in disposable Temporary
Containers. Includes an encrypted vault, per-container proxies, and a
one-click pause switch.
```

## Category

**Primary: Privacy & Security** — the extension's purpose is isolating browsing
identity/state per site, which is how Mozilla's own Multi-Account Containers is
categorized.

**Alternate: Tabs** — also fits, since the mechanism is per-tab container
assignment. Pick one; AMO allows a single primary category per listing.

## Description

Plain text with paragraph breaks; AMO's editor supports basic formatting
(bullets, bold) if you want to reproduce this with markup instead.

```
Better Containers keeps the accounts you're logged into all the time
separated automatically.

Visit YouTube, Gmail, GitHub, or Amazon and the tab reopens in that site's own
container — so cookies, sessions, and tracking never bleed between them, or
into your regular browsing. Anything else you visit lands in a disposable
Temporary Container that's wiped once you close it.

FEATURES

• Automatic isolation for YouTube, Gmail, GitHub, and Amazon, with editable
  domain lists
• Temporary Containers for everything else, auto-cleaned when empty
• Custom containers — add your own (Work, Banking, Shopping…) with their own
  colors, icons, and domains
• Per-site overrides — pin any hostname to a specific container
• One-click pause — a switch in the toolbar popup temporarily disables
  auto-isolation (with a confirmation prompt) without losing your settings
• Optional encrypted vault — store site logins, payment methods, and
  addresses behind a master password (AES-256-GCM); fill logins from the
  popup with one click
• Optional per-container proxies — route a container's traffic through its
  own proxy
• External link support — open links from other apps in the right container
  via the ext+container: protocol, or automatically since external links
  trigger the same isolation rules as normal browsing

PRIVACY

No data is collected or transmitted anywhere. Settings, container rules, and
the encrypted vault all stay on your device — there is no analytics, no
tracking, and no server this extension talks to. Full privacy policy:
https://github.com/Nxe5/Containers/blob/main/PRIVACY.md

PERMISSIONS

Uses Firefox's container (contextualIdentities) and webRequest APIs to
intercept navigations and reopen them in the correct container — this is why
broad host access is requested. Proxy routing and the native-messaging
automation bridge are optional features; their permissions are requested only
if and when you turn those specific features on, not at install.

OPEN SOURCE

Source code: https://github.com/Nxe5/Containers
```

## Support links

- **Homepage URL:** `https://github.com/Nxe5/Containers`
- **Support site:** `https://github.com/Nxe5/Containers/issues`
- **Privacy policy URL:** `https://github.com/Nxe5/Containers/blob/main/PRIVACY.md`

## Tags / keywords (optional)

`containers`, `privacy`, `isolation`, `multi-account`, `youtube`, `gmail`, `github`, `amazon`, `proxy`

## Still needed before submitting

- **Screenshots** — at minimum, the popup (home page) and the Options page.
  Not something that can be generated without actually running the extension
  in a browser; capture these manually with `pnpm run start`.
- **Icon for the store listing** — AMO wants a square icon, typically 128px.
  `src/icons/icon.svg` is used as the in-browser icon; confirm it renders
  cleanly at listing size, or export a dedicated PNG if not.
