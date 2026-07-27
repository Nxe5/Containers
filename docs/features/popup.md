# Popup

The toolbar popup (`src/popup/*`) is a two-page panel. It holds no state of its own
— it reads status via `get-status` and drives the engine with typed messages.

## Enable / disable switch

At the top of the popup is a full-width button reflecting `settings.extensionEnabled`:

- **Enabled** → "Extension Enabled — Click to Disable" (green).
- **Disabled** → "Extension Disabled — Click to Enable" (red), with a hint that
  auto-isolation and proxies are paused but manual actions still work.

**Disabling** opens a confirmation overlay ("Disable Containers?") — the
switch only flips after you confirm. **Enabling** is immediate (no confirm).

The toggle is wired up **before** the popup's "no active tab" early-return, so it
works on every page, including `about:` pages where the rest of the popup is inert.
Flipping it sends `set-extension-enabled`; the engine persists the flag and updates
the toolbar `OFF` badge. See [architecture/overview.md](../architecture/overview.md#the-master-switch).

## Options button

A gear icon (⚙) in the top-right of the header opens the [Options page](./options.md)
(`browser.runtime.openOptionsPage()`) and closes the popup. Like the enable/disable
switch, it's bound before the "no active tab" early-return, so it always works.

## Home page

- **Open new tab in…** — pick a container for a fresh empty tab.
- **Reopen this site in…** — move the current site into a chosen container.
- **Always open this site in…** — add a user override for the current hostname *and*
  reopen it there now.
- **Site hint** — shows the current hostname (or that no site is active).
- **Fill login** — appears only when the [vault](./vault.md) is unlocked and has a
  credential for the current site. See below.
- **Toggles** — "Auto isolate all unmatched tabs" (`isolateUnmatched`), "Replace tab
  instead of opening new one" (`replaceTabInsteadOfNew`), "Keep links in their
  origin container" (`stickyContainers` — see
  [rule-resolution.md](../architecture/rule-resolution.md#sticky-containers)), and
  "Keep sign-in flows where they start" (`preserveAuthFlows` — see
  [rule-resolution.md](../architecture/rule-resolution.md#sign-in-flow-preservation)),
  and "Keep new tabs in their origin container" (`keepLinkedTabsInContainer` — see
  [rule-resolution.md](../architecture/rule-resolution.md#linked-new-tabs)).
- **Containers list** — searchable; click any container to open/reopen there. Also
  offers "Default (no container)" and "Temporary Container".

## Container-picker page

The three action buttons open a second page listing every container (built-in in
fixed order, then custom alphabetically, plus Default and Temporary), with a search
box. Picking one performs the action and closes the popup.

## Fill login

When shown and clicked, the popup:

1. Injects the static content script `src/content/fill-login.js` into the tab.
2. Sends it the chosen credential over `runtime.sendMessage`.

The content script locates the username/password fields and fills them, dispatching
`input`/`change` events so site frameworks notice. **It never auto-submits**, and
nothing is filled on page load — only on an explicit click. Using a static file plus
a message (rather than building an injected code string) keeps the credential out of
any generated source.
