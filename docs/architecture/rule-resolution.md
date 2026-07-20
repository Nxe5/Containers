# Rule Resolution

All routing decisions run through `resolveTarget()` in `src/lib/rules.js`. Given a
hostname and the current container, it returns `{ cookieStoreId, reason }` (and
sometimes `createTemp: true`). The functions are pure and covered by
`scripts/validate/rules.js`.

## Precedence

Signals are checked **in this order**, highest priority first. The first match wins:

1. **One-shot hint** — an explicit user choice for this exact URL, registered by a
   popup action or an `ext+container:` link. Time-limited (~30s) so it applies to
   the navigation it was meant for and then expires. This is why an explicit
   "reopen in X" is never immediately overridden by a domain rule.
2. **User override** — a `hostname → container` rule from the Options page. Matches
   the exact host or any subdomain of it.
3. **Company / custom default** — the hostname matches a built-in company's domain
   list (or a custom container's), and that container is enabled.
4. **Temporary container fallback** — nothing matched. If "isolate unmatched" is on
   *and* the tab isn't already in a temporary container, the engine signals that a
   fresh temporary container should be created (`createTemp: true`).

If none apply (e.g. isolation is off, or the tab is already in a temp container),
the result is `no-match` and the tab is left where it is.

> **Note:** the hint being highest — not user overrides — is intentional and is the
> behavior in code. An explicit action should always win for the navigation it
> triggered.

## Domain matching

`matchesDomain(hostname, domain)` matches when the hostname **equals** the domain
or **ends with `.` + domain**. So a rule for `google.com` matches `google.com` and
`mail.google.com`, but not `notgoogle.com`. Hostnames are lowercased and a trailing
dot is stripped before comparison (`normalizeHostname`).

## Domain lists

Built-in lists live in `src/data/domains.json`, keyed by company (`google`,
`microsoft`, `meta`). Each entry has a `label`, `color`, `icon`, and `domains[]`.
The Options page can **override** a company's list entirely (stored in
`settings.domainOverrides`) without editing the file; `getEffectiveDomainList()`
returns the override if present, otherwise the bundled list.

Custom containers contribute their own domains the same way, merged into the
in-memory `domainData` at boot by `buildDomainData()`.

## Reverse lookup

`getContainerKeyByCookieStoreId()` maps a `cookieStoreId` (which is all a tab
gives you) back to a company/custom key. Proxy routing and the native-messaging
bridge use it, since they start from a tab's container rather than a hostname.

## What happens after a decision

In `main.js`, `handleBeforeRequest()`:

1. Skips non-`http(s)`, extension pages, and private-browsing tabs.
2. Calls `resolveTarget()`.
3. If `createTemp`, creates a temporary container and uses its id.
4. If the target differs from the current container, marks the request processed
   (to avoid loops), cancels it, and `doReopen()`s the URL in the target container —
   replacing the original tab when it's a fresh/blank tab, otherwise opening beside it.
