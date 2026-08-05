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
3. **Linked new tab or window** (only if `stickyContainers` is on) — the navigation is
   the first load of a tab (or new window) opened by a link/`window.open` from inside
   any non-default container. Stay in that container. The new-tab/window half of "keep
   links in their origin container"; see [below](#keep-links-in-their-origin-container-stickycontainers).
4. **Same-tab sticky** (only if `stickyContainers` is on) — if the tab is already in a
   named container, a same-tab navigation stays there. The same-tab half of the same
   setting; see [below](#keep-links-in-their-origin-container-stickycontainers).
5. **Company / custom default** — the hostname matches a built-in company's domain
   list (or a custom container's), and that container is enabled.
6. **Temporary container fallback** — nothing matched. If "isolate unmatched" is on
   *and* the tab isn't already in a temporary container, the engine signals that a
   fresh temporary container should be created (`createTemp: true`).

If none apply (e.g. isolation is off, or the tab is already in a temp container),
the result is `no-match` and the tab is left where it is.

> **Note:** the hint being highest — not user overrides — is intentional and is the
> behavior in code. An explicit action should always win for the navigation it
> triggered.

## Keep links in their origin container (`stickyContainers`)

One setting, on by default, with two halves. The intent is simple: a link should open
in the container you were already in. It's split only because "new tab/window" and
"same tab" need different handling around Temporary Containers.

### New tab or window (precedence rule 3)

A tab **or window** opened by a link (or `window.open`) from inside a container stays
in the container it came from — **any** container, including a Temporary Container, and
even when the destination matches a preset company that owns its own container.
Deliberately opening a link in a new tab or window should never pull you out of the
context you were browsing.

The engine detects this in `handleBeforeRequest()` and passes `fromLinkedTab` into
`resolveTarget()`. The tab must have been **opened to host a navigation** from another
tab:

- Primary signal: `webNavigation.onCreatedNavigationTarget` records the new tab's id in
  `linkedTabIds`. It's the only signal that also fires for opens into a **new window** —
  `tab.openerTabId` is populated only when the opener is in the *same* window. The entry
  is **consumed** on the first navigation (so later same-tab navigations fall through to
  the same-tab half) and dropped on `tabs.onRemoved`. It is trusted directly and is
  *not* also gated on `isFreshTab()`, because a just-created tab's URL is often still
  empty or `about:blank` at request time — gating on it there caused the linked tab to
  spuriously hand off.
- Fallback: `tab.openerTabId` (same-window only), used with `isFreshTab()` in case the
  webNavigation event races the request.

Firefox already assigns the new tab (or window) its opener's container before the
listener runs, so `currentCookieStoreId` is correct with no extra bookkeeping.

### Same tab (precedence rule 4)

Once a tab is inside a **named** container (built-in or custom — anything except the
default "no container" and except a Temporary Container), a same-tab navigation stays
in that container instead of being moved by a company-domain match or the temp fallback.

This half **excludes** Temporary Containers on purpose: a same-tab navigation to a
domain with its own dedicated container (e.g. typing/following `github.com` while
browsing in a disposable temp container) still hands off to that dedicated container, so
you land in your logged-in session rather than a throwaway one. (Sign-in *chains* are
preserved regardless by [`preserveAuthFlows`](#sign-in-flow-preservation).)

A one-shot hint or a user override, both checked first, still win over either half — so
an explicit "reopen in X" or a configured `hostname → container` rule takes precedence.
Toggle from the popup ("Keep links in their origin container") or the Options page.

## Sign-in flow preservation

The same-tab half of "keep links in their origin container" covers named containers
only, which leaves two origins where a same-tab auth chain used to get yanked away
mid-flow: Temporary Containers and "no container". Clicking **Login with GitHub** on a
site would hop to
`github.com/login/oauth/authorize`, match the GitHub company rule, and relocate
the flow into the global GitHub container — completing the login as whatever
account lives there instead of the one the starting container holds.

With `settings.preserveAuthFlows` on (the default), `handleBeforeRequest()` skips
relocation entirely — **before** `resolveTarget()` runs, so it applies from every
origin — when either signal fires:

1. **Redirect-chain membership.** Every leg of a server-redirect chain shares one
   `requestId`. An `onBeforeRedirect` listener records the id, and any navigation
   arriving under a recorded id is left where it is. This follows the whole OAuth
   round-trip (site → provider → back to the site's `redirect_uri`) with no URL
   knowledge, including the provider's post-login `302` — and the id is dropped
   once the request completes or errors.
2. **Auth-shaped URL.** `looksLikeAuthNavigation()` in `rules.js` matches
   authorization-endpoint query params (`client_id` + `redirect_uri`,
   `response_type`, `SAMLRequest`/`SAMLResponse`) or a dedicated auth path
   segment (`/oauth`, `/authorize`, `/login`, `/signin`, `/sso`, `/saml`, …).
   This catches sites that JS-navigate straight to the authorize URL rather
   than server-redirecting to it.

Ordinary links are unaffected: a plain `github.com` link is neither a redirect
leg nor auth-shaped, so company rules and the temp fallback apply as usual. Known
tradeoffs: a link-shortener hop (one redirect leg) stays in the origin container
instead of handing off, and a direct navigation to an auth-shaped URL won't
follow a user override — deliberate, since relocating mid-chain is exactly what
breaks logins.

Toggle from the popup: "Keep sign-in flows where they start".

## Domain matching

`matchesDomain(hostname, domain)` matches when the hostname **equals** the domain
or **ends with `.` + domain**. So a rule for `google.com` matches `google.com` and
`mail.google.com`, but not `notgoogle.com`. Hostnames are lowercased and a trailing
dot is stripped before comparison (`normalizeHostname`).

## Domain lists

Built-in lists live in `src/data/domains.json`, keyed by company (`youtube`,
`gmail`, `github`, `amazon`). Each entry has a `label`, `color`, `icon`, and `domains[]`.
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
