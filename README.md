# Company Containers

A Firefox extension that automatically isolates Google, Microsoft, and Meta
properties into their own [containers](https://support.mozilla.org/en-US/kb/containers),
while opening everything else in disposable Temporary Containers.

It combines ideas from three reference extensions:

- [Mozilla Multi-Account Containers](https://github.com/mozilla/multi-account-containers) — container reassignment logic
- [Temporary Containers](https://github.com/stoically/temporary-containers) — on-demand temp container creation and cleanup
- [Open URL in Container](https://github.com/honsiorovskyi/open-url-in-container) — external link handling via `ext+container:`

## What it does

1. **Predefined company containers**  
   Google, Microsoft, and Meta each get a dedicated container seeded with the
domains listed in `src/data/domains.json`. When you navigate to any of those
domains, the tab is reopened in the matching container.

2. **Temporary Container fallback**  
   Any navigation that doesn't match a company default (or a user override) is
reopened in a fresh Temporary Container. Once the last tab in a Temporary
Container closes, the container is deleted.

3. **External link support**  
   Links from outside Firefox (email clients, terminals, chat apps, etc.) are
caught because they open as a new tab in Firefox and trigger the same
main-frame request listener. An optional launcher script can also build
`ext+container:` links that hint at a specific container.

## Install in Firefox

This extension is designed to be loaded as an unsigned add-on in
**Firefox Developer Edition** or **Firefox Nightly**:

1. Open `about:config` and set:
   - `privacy.userContext.enabled` → `true`
   - `xpinstall.signatures.required` → `false`

2. Open `about:debugging` → **This Firefox** → **Load Temporary Add-on**.

3. Select the `manifest.json` file in this folder.

The extension will start immediately. The first time it loads it creates the
three company containers.

> Temporary add-ons loaded this way stay active until you restart Firefox. For
> a permanent install you can either sign the extension on
> [addons.mozilla.org](https://addons.mozilla.org) or use a Firefox policy
> (`ExtensionSettings`) for enterprise installs.

## Usage

- **Normal browsing**: navigate anywhere. The extension quietly moves tabs into
the right container.
- **Toolbar popup**: click the extension icon to open a multi-action panel:
  - **Open new tab in…** — pick a container for a fresh empty tab.
  - **Reopen this site in…** — move the current site into a chosen container.
  - **Always open this site in…** — remember the current hostname in a chosen container.
  - **Containers list** — quick-search and open an empty tab in any container.
  - **Auto isolate** toggle and **Replace tab instead of opening new one** toggle.
- **Options page**: right-click the toolbar button and choose **Manage Extension**
→ **Options** (or open it from the popup). Edit domain lists, add custom/personal
containers, manage user overrides, and tweak temp container settings.

## External launcher

A bash launcher is included at `scripts/open-in-container.sh`:

```bash
chmod +x scripts/open-in-container.sh
./scripts/open-in-container.sh https://mail.google.com
./scripts/open-in-container.sh -n Google https://youtube.com
./scripts/open-in-container.sh -n Work -c purple -i briefcase https://example.com
```

You can set it as the default browser invocation for links from your terminal,
mail client, or other tools. On macOS this usually means wrapping it in an
Automator application or using a tool like `duti`; on Linux you can register it
with `xdg-mime default` after creating a `.desktop` file.

The launcher uses the custom protocol `ext+container:`, which this extension
registers in `manifest.json`.

## Rule precedence

When more than one signal applies, the extension resolves them in this order:

1. User overrides (configured on the options page)
2. Company default rules (`src/data/domains.json`)
3. Explicit container hints (`ext+container:` links, popup actions)
4. Temporary Container fallback

## File layout

```
manifest.json                 # WebExtension manifest (MV2)
src/
  background/
    background.html           # Background page entry
    main.js                   # Engine, listeners, message handlers
  data/
    domains.json              # Built-in Google / Microsoft / Meta lists
  lib/
    defaults.js               # Default settings
    storage.js                # storage.local wrapper
    rules.js                  # Domain matching and precedence
    containers.js             # Container CRUD and temp-container GC
  opener/
    opener.html / opener.js   # ext+container protocol handler target
  popup/
    popup.html / popup.js     # Toolbar popup
  options/
    options.html / options.js # Settings page
  icons/
    icon.svg
scripts/
  open-in-container.sh        # OS launcher
plan                          # Original design document
```

## Custom and personal containers

The Options page now has a **Custom containers** section. You can add as many
containers as you want — e.g. *Work*, *Banking*, *Shopping* — each with its own
name, color, icon, and optional domain list. They behave like the built-in
company containers and show up in the toolbar popup.

For one-off assignments, use the **User overrides** section in Options to force
a specific hostname into any container, including the default “no container.”

## Updating domain lists

Edit `src/data/domains.json` and reload the extension, or use the Options page
to override a company's list without editing files. The options page stores your
overrides in `browser.storage.local`.

## License

This project is provided as a starting point for personal use. The reference
extensions it learns from are MPL-2.0 licensed.
