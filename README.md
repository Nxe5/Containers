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
    vault.js                  # Encrypted credentials/payments/proxy-auth vault
    native-messaging.js       # connectNative bridge to native-host/
  opener/
    opener.html / opener.js   # ext+container protocol handler target
  popup/
    popup.html / popup.js     # Toolbar popup
  options/
    options.html / options.js # Settings page
  icons/
    icon.svg
native-host/
  index.js                    # Native messaging host (stdio <-> Unix socket)
  example-client.js           # Reference client for the socket protocol
scripts/
  open-in-container.sh        # OS launcher
  install-native-host.sh      # Registers native-host/index.js with Firefox
plan                          # Original design document
```

## Custom and personal containers

The Options page now has a **Custom containers** section. You can add as many
containers as you want — e.g. *Work*, *Banking*, *Shopping* — each with its own
name, color, icon, and optional domain list. They behave like the built-in
company containers and show up in the toolbar popup.

For one-off assignments, use the **User overrides** section in Options to force
a specific hostname into any container, including the default “no container.”

## Per-container proxies

Each built-in or custom container can be routed through its own proxy. In the
Options page, open a container's card and fill in the **Proxy** section
(type — HTTP/HTTPS/SOCKS5/SOCKS4 — host, and port). Traffic for tabs in that
container is routed through the proxy via `browser.proxy.onRequest`; tabs in
containers without a proxy configured go direct. If the proxy requires
authentication, set a username/password in the same section — those
credentials are stored in the encrypted vault (see below), not in plain
settings, and are supplied automatically via `webRequest.onAuthRequired` when
the vault is unlocked.

## Vault: site credentials, payment methods, and addresses

The Options page has three tables — **Site credentials**, **Payment
methods**, and **Addresses** — each tied to a container and stored in an
**encrypted vault**, not in plain `browser.storage.local`:

- **Site credentials**: website / account / password / container.
- **Payment methods**: nickname / cardholder / card number / CVV / expiry /
  billing address / container.
- **Addresses**: label / recipient / address lines / city / state / postal
  code / country / phone / container — a per-container address book,
  independent of payment methods (a payment method's billing-address field
  stays free text; use this table when you want a reusable, assignable
  address per container).

To set it up: open Options → **Vault** and enter a master password —
**Create vault** the first time, **Unlock** on later visits. That password is
never stored anywhere; it's used once to derive an AES-256-GCM key (via
PBKDF2, 210k iterations) that encrypts the vault contents at rest.

- The decrypted vault only lives in the background page's memory for the
  current session. It locks automatically after 15 minutes of inactivity
  (`browser.idle`), and locking/reloading the browser clears it — you'll need
  to re-enter the master password to unlock it again.
- In the popup, if the current site has a saved credential and the vault is
  unlocked, a **Fill login** button appears and fills the page's username/
  password fields on click (no auto-submit, and nothing is filled
  automatically on page load).

**A note on payment data**: this vault stores full card numbers and CVVs if
you choose to enter them, at your own request. That is a materially larger
security surface than a browser normally takes on — this is not a
PCI-compliant system, there's no tokenization, and a bug or a compromised
update could expose real card data. Treat your master password, this browser
profile, and any backups of it with the same care you'd give the physical
cards.

### CSV import

Each vault table (and Custom containers) has a CSV file input at the bottom
of its section. The first row must be a header row; the `container` column
matches an existing container by its label or key (case-insensitive) — rows
with an unrecognized container are imported with no container assigned
rather than failing the whole file.

| Section | Headers |
| --- | --- |
| Site credentials | `website, account, password, container` |
| Payment methods | `nickname, cardholderName, cardNumber, cvv, expiry, billingAddress, container` |
| Addresses | `label, recipientName, line1, line2, city, state, postalCode, country, phone, container` |
| Custom containers | `key, label, color, icon, domains` — `domains` is `;`-separated within the cell (commas are the CSV delimiter) |

Imports are additive (existing rows are left alone) and there's no
undo — export/back up first if you're bulk-loading a file you haven't
reviewed.

## Native messaging bridge (external automation)

An external script — e.g. a Playwright automation — can read stored
credentials through a local Native Messaging host, without ever seeing your
master password:

1. Run `scripts/install-native-host.sh` once. It registers
   `native-host/index.js` as a Firefox native messaging host
   (`com_companycontainers_host`) and makes it executable.
2. Reload the extension, then open Options → **Native messaging bridge** and
   click **Regenerate token**. Copy the token shown (it's only displayed
   once; only its hash is stored).
3. From your external script, connect to the Unix socket at
   `~/.company-containers/host.sock` and send a newline-delimited JSON
   request:
   ```json
   {"id": "1", "type": "get-credential", "token": "<your token>", "website": "github.com"}
   ```
   You'll get back `{"id": "1", "ok": true, "result": [...]}` with any
   matching credentials, or `{"ok": false, "error": "vault-locked"}` if the
   vault hasn't been unlocked in the browser yet. `native-host/example-client.js`
   is a minimal reference implementation of this protocol:
   ```bash
   node native-host/example-client.js github.com <token>
   ```

How it fits together: `native-host/index.js` is spawned by Firefox when the
extension opens a `connectNative()` port at boot, and separately listens on
the Unix socket (mode `0600`, owner-only) for your script. It relays socket
requests to the extension over the native-messaging stdio channel and relays
the extension's response back — it never has its own copy of the vault key or
the master password, only whatever the extension chooses to hand back for a
given request.

## Updating domain lists

Edit `src/data/domains.json` and reload the extension, or use the Options page
to override a company's list without editing files. The options page stores your
overrides in `browser.storage.local`.

## License

This project is provided as a starting point for personal use. The reference
extensions it learns from are MPL-2.0 licensed.
