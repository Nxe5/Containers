# Privacy Policy — Company Containers

**Last updated:** 2026-07-19

## Summary

Company Containers collects and transmits **no data** to the developer, to
Mozilla, or to any third party. Everything the extension stores lives only in
your own browser profile, on your own device. There is no analytics, no
telemetry, and no network request to any server the developer controls or
that the developer can see the results of.

## What the extension stores, and where

Everything below is saved locally via Firefox's `storage.local` API (or, for
the vault, an encrypted blob within it). None of it ever leaves your device.

### Settings and rules

Your container configuration — which built-in companies are enabled, custom
containers you've created, per-hostname overrides, and (if configured)
non-secret proxy host/port values. This exists so the extension can do its
job; it is never read by anyone but you and the extension code running in
your browser.

### Encrypted vault (optional)

If you choose to use it, the vault stores site logins, payment methods,
addresses, and proxy passwords, encrypted at rest with AES-256-GCM using a
key derived from a master password you choose (PBKDF2, 210,000 iterations).

- Your master password is **never stored anywhere** — it exists only in
  memory for the moment it's used to derive the encryption key.
- The decrypted vault lives only in the background page's memory for your
  browsing session, and is cleared on lock, idle timeout, or browser restart.
- **There is no password recovery.** Because the encryption key is derived
  solely from your master password, forgetting it means the only way forward
  is resetting the vault, which permanently deletes its contents.
- Using the vault is entirely optional. If you never create one, none of
  this data exists.

### Native messaging bridge (optional, advanced)

If you explicitly set up the companion native-messaging host (a manual,
opt-in step — see the [documentation](./docs/features/native-messaging.md)),
a local script you run on your own computer can request stored credentials
over a token-gated local channel. This is a connection between your browser
and a program on **your own machine** — not to the developer or any external
service. Your master password never crosses this bridge, and requests only
succeed while the vault is unlocked in the browser.

## What the extension does *not* do

- It does not send any data to the developer, to an analytics service, or to
  any third party.
- It does not include any tracking, advertising, or analytics code.
- It does not read the content of the pages you visit. Domain names are
  compared locally to decide which container a tab belongs in; that
  comparison never leaves your device.
- The one content script (used only when you click "Fill login" in the
  popup) is injected on that explicit click, fills the page's form fields,
  and does nothing else — it does not read or transmit page content.

## Permissions

The permissions the extension requests are used only to provide its
container-isolation, vault, and (optional) proxy/automation features — never
to collect information. A full explanation of each permission is in
[`docs/guides/permissions.md`](./docs/guides/permissions.md).

## Usage statistics

The developer does not run any usage analytics. To the extent any install or
download counts exist, they come only from addons.mozilla.org's own
aggregate, anonymous store statistics (visible to any developer of a
listed add-on) — not from anything this extension reports.

## Removing your data

Uninstalling the extension removes all data it stored via `storage.local`,
including the encrypted vault. If you set up the optional native-messaging
host, its files live outside the extension at `~/.company-containers/` and
in Firefox's native-messaging-hosts directory; removing those is a separate,
manual step described in the native-messaging documentation.

## Changes to this policy

If this policy changes, the updated version will be posted here with a new
"Last updated" date, and reflected in the extension's changelog on
addons.mozilla.org.

## Contact

Questions or concerns: open an issue at
[github.com/Nxe5/Containers/issues](https://github.com/Nxe5/Containers/issues).
