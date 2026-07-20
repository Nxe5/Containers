# Submitting to Firefox (AMO)

Checklist for publishing to [addons.mozilla.org](https://addons.mozilla.org).

## Build the package

```bash
pnpm run lint     # must be 0 errors / 0 warnings
pnpm run build    # writes web-ext-artifacts/company_containers-<version>.zip
```

`web-ext-config.cjs` excludes everything that isn't the extension (`native-host/`,
`scripts/`, `docs/`, `plan`, tooling, zips), so the uploaded zip contains only
`manifest.json` and `src/`. Confirm with `unzip -l web-ext-artifacts/*.zip`.

## Pre-flight checklist

- [x] **Lint clean** — `pnpm run lint` reports 0 errors, 0 warnings.
- [x] **No minified/obfuscated code** — everything is plain, readable ES modules, so
      **no source-code submission is required**.
- [x] **Extension ID set** — `browser_specific_settings.gecko.id` is a stable UUID.
      (The native-host installer's `allowed_extensions` uses the same ID.)
- [x] **Minimum version** — `strict_min_version` is `142.0` (needed for the declared
      `data_collection_permissions`).
- [x] **Data collection declared** — `required: ["none"]`; the extension transmits
      nothing off-device.
- [x] **Icons present** — `icon.svg` covers the required sizes.
- [x] **Least-privilege at install** — `proxy` and `nativeMessaging` are optional and
      requested at runtime; only the core permissions are requested up front.
- [x] **Privacy policy** — [`PRIVACY.md`](../../PRIVACY.md) at the repo root. Link its
      raw/rendered GitHub URL in AMO's "Privacy Policy" field during submission.
- [x] **Listing copy drafted** — name, summary, description, category, and support
      links are in [`amo-listing.md`](./amo-listing.md), ready to paste into the
      submission form.
- [ ] **Screenshots** — still needed; see the "Still needed" section in
      [`amo-listing.md`](./amo-listing.md#still-needed-before-submitting).
- [ ] **Reviewer notes** — see below.

## Reviewer notes to include

Paste something like this in the submission's notes-to-reviewer field:

> This extension isolates browsing into Firefox containers by company. It requires
> `webRequest` + `webRequestBlocking` and `<all_urls>` because it must intercept
> top-level navigations and reopen them in the correct container — this cannot be
> done with `declarativeNetRequest`, which is why it is Manifest V2. No data is sent
> off-device; matching is entirely local. Credentials/payment data (opt-in) are
> stored locally, encrypted with AES-256-GCM. `proxy` and `nativeMessaging` are
> optional permissions requested only at first use of those features. The
> `native-host/` companion process and `scripts/` are development tooling and are
> excluded from the packaged add-on.

See [permissions.md](./permissions.md) for the full per-permission justification.

## Signing / distribution

- **AMO (recommended):** upload the zip; AMO reviews and signs it, and users install
  and auto-update normally.
- **Self-distribution:** AMO can sign an XPI for distribution outside the store.
- **Enterprise:** an unsigned build can be deployed via the `ExtensionSettings`
  policy.

## Releasing a new version

1. Bump `version` in **`manifest.json`** and **`package.json`** (keep them in sync).
2. `pnpm run lint && pnpm run build`.
3. Upload the new zip to AMO (or use `web-ext sign`).
4. Tag the release in git.

## Notes

- **Chrome Web Store is not applicable** — the extension depends on Firefox-only
  container APIs and blocking `webRequest`. See
  [architecture/overview.md](../architecture/overview.md#why-firefox-only).
- **Firefox for Android:** the manifest targets 142+ on Android too, but containers
  and this UI are desktop-oriented — test before advertising Android support.
