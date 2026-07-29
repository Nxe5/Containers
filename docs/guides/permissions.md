# Permissions

Every permission the extension requests, and why. This doubles as reviewer notes for
the AMO submission.

## Required (`permissions`)

| Permission | Why it's needed |
| --- | --- |
| `contextualIdentities` | Create, update, and query containers. The whole point of the extension. |
| `cookies` | Container cookie stores (`cookieStoreId`) are the identity of each container; used to place tabs. |
| `storage` | Persist `settings` and `state` and the encrypted vault blob in `storage.local`. |
| `tabs` | Read the active tab's URL and reopen tabs in the correct container. |
| `webNavigation` | Detect when a tab or **window** is opened from a link/`window.open` (`onCreatedNavigationTarget`) so it can be kept in its opener's container. `tab.openerTabId` alone misses cross-window opens. |
| `webRequest` + `webRequestBlocking` | Intercept top-level navigations (`onBeforeRequest`) to reopen them in the right container, and answer proxy auth (`onAuthRequired`). Blocking is essential — the request must be cancelled/redirected before it proceeds. This is why the extension is Manifest V2. |
| `idle` | Auto-lock the vault after a period of inactivity. |
| `<all_urls>` | Isolation must work on **any** site the user navigates to, so the navigation listener has to observe all URLs. No data is sent anywhere — matching happens locally. |

## Optional (`optional_permissions`)

Requested at runtime, from a user gesture, only when the feature is first used —
never at install:

| Permission | Requested when | Feature |
| --- | --- | --- |
| `proxy` | You save a container's proxy settings | [Per-container proxies](../features/proxies.md) |
| `nativeMessaging` | You regenerate the automation-bridge token | [Native messaging bridge](../features/native-messaging.md) |

The engine registers/unregisters the corresponding functionality live via
`permissions.onAdded` / `permissions.onRemoved`, so granting or revoking either from
`about:addons` takes effect without a reload.

## Data handling

- **No data is transmitted off-device by the extension.** `manifest.json` declares
  `data_collection_permissions: { required: ["none"] }`.
- Credentials, payment methods, and addresses are stored **locally, encrypted**
  (AES-256-GCM) in the vault — see [vault.md](../features/vault.md).
- The optional native-messaging bridge only exposes data to a **local** script the
  user explicitly authorizes with a token, and only while the vault is unlocked.

## Host permissions rationale for reviewers

`<all_urls>` looks broad but is intrinsic to the feature: an "isolate my browsing by
company" tool cannot know in advance which of a user's sites belong to which company,
so it must be able to evaluate every navigation. The extension does not read page
content (the only content script, `fill-login.js`, is injected on an explicit click
and only fills form fields), makes no network requests of its own, and sends nothing
externally.
