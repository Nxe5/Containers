# External Links (`ext+container:`)

Links opened from outside Firefox (a mail client, terminal, chat app) can be routed
into the right container. There are two paths.

## Automatic (no setup)

Any external link that opens as a new Firefox tab triggers the same
`webRequest.onBeforeRequest` listener as normal browsing, so it's isolated by the
usual [rules](../architecture/rule-resolution.md) with no special handling. Open a
GitHub link from your mail client and it lands in the GitHub container automatically.

## Explicit via the `ext+container:` protocol

For finer control, the extension registers the `ext+container:` protocol (in
`manifest.json`). A link like:

```
ext+container:url=https%3A%2F%2Fexample.com&name=Work&color=purple&icon=briefcase
```

opens `src/opener/opener.html`, which parses the parameters and:

- **`url`** (required) — must be `http(s)`. Invalid URLs show an error page.
- **`name`** — the target container by name. If it exists, the URL opens there
  immediately. If not, the opener asks for confirmation before **creating** a new
  container with the given `color` / `icon`, then opens the URL in it.
- **No `name`** — the opener just opens the URL as a normal tab and lets the engine
  decide the container.

`color` and `icon` are validated against Firefox's allowed sets; unknown values fall
back to safe defaults. When the opener opens a tab it registers a one-shot
[hint](../architecture/rule-resolution.md) so the engine honors the explicit choice.

## Launcher script

`scripts/open-in-container.sh` builds and opens these links for you:

```bash
./scripts/open-in-container.sh -n Gmail https://mail.google.com
./scripts/open-in-container.sh -n YouTube https://youtube.com
./scripts/open-in-container.sh -n Work -c purple -i briefcase https://example.com
```

Without `-n`, the script names the container after the URL's hostname — which won't
match one of the built-in containers by name, so the opener will offer to create a
new one. Pass `-n` with the exact container label (`YouTube`, `Gmail`, `GitHub`,
`Amazon`, or a custom container's name) to land in an existing container instead.

Set it as your system's link handler (macOS: an Automator app or `duti`; Linux: an
`xdg-mime` default with a `.desktop` file) to route links from other apps through it.
The `FIREFOX` env var overrides the Firefox binary. This script is a convenience and
is **not** part of the packaged add-on.
