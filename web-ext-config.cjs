// Shared defaults for `web-ext lint|build|run`. See:
// https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
module.exports = {
  sourceDir: '.',
  artifactsDir: 'web-ext-artifacts',
  // Everything here is tooling around the extension, not the extension
  // itself, and must not end up in the AMO upload:
  //   - native-host/ is a separate companion process (Node net/fs/os) for
  //     the external automation bridge; bundling raw Node fs/net code next
  //     to a browser extension is exactly the kind of thing AMO's
  //     automated review flags as suspicious, and it isn't referenced by
  //     manifest.json anyway.
  //   - scripts/ are OS-level launcher/install helpers, not loaded by the
  //     extension.
  //   - plan, README.md, PRIVACY.md, docs/, and stray zips are project docs/artifacts.
  //   - package.json/pnpm-lock.yaml/web-ext-config.cjs are this tooling
  //     itself, not part of the extension bundle.
  ignoreFiles: [
    'native-host',
    'native-host/**',
    'scripts',
    'scripts/**',
    'plan',
    'README.md',
    'PRIVACY.md',
    'docs',
    'docs/**',
    '*.zip',
    'web-ext-artifacts',
    'web-ext-artifacts/**',
    '.sidebar',
    '.sidebar/**',
    'package.json',
    'pnpm-lock.yaml',
    'web-ext-config.cjs',
  ],
};
