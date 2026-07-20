# Per-Container Proxies

Each built-in or custom container can route its traffic through its own proxy. This
uses the **optional** `proxy` permission — it's requested the first time you save a
proxy, not at install.

## Configuring

On the Options page, open a container's card and fill in the **Proxy** section:

- **Type** — HTTP, HTTPS, SOCKS5, or SOCKS4 (or "None" to clear).
- **Host** and **Port**.
- **Username / Password** (optional) — only if the proxy requires auth.

Saving a proxy requests the `proxy` permission (with your click as the user gesture).
If you decline, the save is cancelled. Non-secret config (`type`, `host`, `port`) is
stored in `settings.containerProxies`; the **username/password go into the encrypted
[vault](./vault.md)**, keyed by the same container.

## How routing works

- `proxy.onRequest` (in `main.js`) looks up the request's container via its
  `cookieStoreId`, finds that container's proxy config, and returns it. Containers
  with no proxy configured go **direct**.
- The `proxy.onRequest` listener is registered **only while the `proxy` permission is
  held**. Granting or revoking the permission from `about:addons` takes effect live,
  via the engine's `permissions.onAdded` / `onRemoved` handlers — no reload needed.
- When a proxied request needs authentication, `webRequest.onAuthRequired` supplies
  the stored username/password — but **only while the vault is unlocked**. If the
  vault is locked, the proxy prompts as usual.

## Interaction with the master switch

While the extension is [disabled](./popup.md), proxy routing and proxy auth are both
suspended along with auto-isolation.
