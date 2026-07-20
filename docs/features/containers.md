# Containers

The extension works with three kinds of container, all backed by Firefox's
`contextualIdentities` API and managed in `src/lib/containers.js`.

## Built-in company containers

**YouTube**, **Gmail**, **GitHub**, and **Amazon** each get a dedicated container,
seeded from `src/data/domains.json`. At boot, `ensureContainers()` creates any that
don't exist yet and records their `cookieStoreId` in `settings.companies`. It also
repairs a container whose name/color/icon has drifted from the definition.

Each company can be toggled off individually (Options page). A disabled company no
longer captures its domains — those navigations fall through to the next rule.

Container creation is fault-tolerant: if one container can't be created, it's logged
and skipped rather than aborting the whole boot.

**Why these four:** they're the sites people actually stay logged into daily and
want kept separate from each other and from general browsing. Everything else
(unless you add a [custom container](#custom-containers) or a
[user override](../features/options.md)) falls into a disposable
[temporary container](#temporary-containers).

**A note on Gmail's domain list:** Gmail's web app lives at `mail.google.com`, a
subdomain of `google.com` — but `google.com` itself also covers Search, Drive,
Docs, Calendar, Maps, and the `accounts.google.com` sign-in flow. The Gmail
container's domain list is deliberately scoped to `mail.google.com` (plus
`gmail.com`/`googlemail.com`, which redirect to it) rather than the bare
`google.com`, so it isolates Gmail specifically without pulling in every other
Google product. See [rule-resolution.md](../architecture/rule-resolution.md) for
how domain matching works, and the earlier design note: bundling the *entire*
`google.com` family into one container (as this project originally did, alongside
Microsoft and Meta groupings) is the safer default if you want Google's
`accounts.google.com` single sign-on to work seamlessly across services sharing one
container — this per-service split trades a bit of that seamlessness for tighter
isolation.

## Custom containers

Defined by the user on the Options page (or via CSV import). Each has a `label`,
`color`, `icon`, and optional `domains[]`, and behaves exactly like a built-in
company — its domains auto-isolate, it appears in the popup, and it can carry a
proxy and vault entries. Stored in `settings.customContainers`, keyed by a slug.

Deleting a custom container removes the underlying Firefox container and drops any
user rules that pointed at it.

## Temporary containers

The fallback for anything unmatched (when "isolate unmatched" is on). Created on
demand by `createTemporaryContainer()`, named from `tempPrefix` + a monotonic
counter (`Temp 1`, `Temp 2`, …), and tracked in `state.tempContainers`.

**Garbage collection:** `gcTemporaryContainers()` removes any tracked temporary
container that no longer has open tabs. It runs at boot, shortly after tabs close
(`tabs.onRemoved` / `onDetached`, debounced ~1.5s), and on demand from the Options
page ("Clean up empty Temporary Containers"). Only containers the engine created are
ever removed — user and company containers are never touched by GC.

## Color and icon values

Firefox accepts a fixed set. Both are validated (`sanitizeContainerParams`) and fall
back to safe defaults (`toolbar` / `circle`) if an unknown value is supplied.

- **Colors:** blue, turquoise, green, yellow, orange, red, pink, purple, toolbar
- **Icons:** fingerprint, briefcase, dollar, cart, circle, gift, vacation, food,
  fruit, pet, tree, chill, fence
