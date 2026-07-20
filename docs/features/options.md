# Options Page

The full settings page (`src/options/*`), opened from the popup's **Options** link
or `about:addons` → Manage Extension → Options. Every change is sent to the engine
via a typed message; the page re-reads status after each change.

## Sections

- **Global settings** — "Isolate unmatched sites in a Temporary Container"
  (`isolateUnmatched`) and the temporary-container cosmetics (prefix, color, icon).
- **Vault** — create/unlock with a master password, lock now, or reset (with a hard
  warning). Sensitive tables below only appear once the vault is unlocked. See
  [vault.md](./vault.md).
- **Built-in company containers** — edit each company's domain list (one per line;
  saving replaces the built-in list) or reset it to the bundled default. Toggle a
  company on/off. Each card can also carry a [proxy](./proxies.md).
- **Custom containers** — add/edit/delete your own containers, with CSV import.
- **Site credentials / Payment methods / Addresses** — vault-backed tables, each
  with CSV import. Only visible when the vault is unlocked.
- **User overrides** — pin a hostname to a container. Highest-priority static rule.
- **Native messaging bridge** — generate the automation-bridge token. See
  [native-messaging.md](./native-messaging.md).
- **Maintenance** — clean up empty temporary containers on demand.
- **Danger zone** — reset all settings and recreate default containers.

## Optional-permission prompts

Two features request their permission the first time you use them (with your click
as the required user gesture), rather than at install:

- **Saving a container's proxy** requests the `proxy` permission.
- **Regenerating the native-messaging token** requests the `nativeMessaging`
  permission.

If you decline the prompt, the action is cancelled with an explanatory alert. See
[guides/permissions.md](../guides/permissions.md).

## CSV import

Custom containers and each vault table accept a CSV file (first row = headers).
Imports are **additive** — existing rows are left alone, and there's no undo, so back
up first for large files. A `container` column is matched to an existing container by
label or key (case-insensitive); unrecognized values import with no container rather
than failing the file.

| Section | Headers |
| --- | --- |
| Site credentials | `website, account, password, container` |
| Payment methods | `nickname, cardholderName, cardNumber, cvv, expiry, billingAddress, container` |
| Addresses | `label, recipientName, line1, line2, city, state, postalCode, country, phone, container` |
| Custom containers | `key, label, color, icon, domains` — `domains` is `;`-separated within the cell |
