#!/usr/bin/env bash
#
# Build the extension locally, bumping the patch version (+0.0.1) first.
#
# Bumps the "version" in both manifest.json and package.json so they stay in
# lockstep, then runs `web-ext build` and drops an installable .xpi copy next to
# the .zip in web-ext-artifacts/.
#
# Usage: scripts/build-local.sh
#
set -euo pipefail

# Repo root = parent of this script's directory, so it works from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MANIFEST="$ROOT/manifest.json"
PKG="$ROOT/package.json"

# Bump the patch component (x.y.z -> x.y.(z+1)) in manifest.json and
# package.json. Node handles the JSON parse/serialize so formatting and any
# other fields are preserved exactly.
NEW_VERSION="$(node -e '
  const fs = require("fs");
  const files = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(files[0], "utf8"));
  const parts = String(manifest.version).split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  const next = parts.join(".");
  for (const f of files) {
    const json = JSON.parse(fs.readFileSync(f, "utf8"));
    json.version = next;
    fs.writeFileSync(f, JSON.stringify(json, null, 2) + "\n");
  }
  process.stdout.write(next);
' "$MANIFEST" "$PKG")"

echo "Bumped version to $NEW_VERSION"

# Build the .zip bundle.
npx web-ext build --overwrite-dest

# web-ext emits a .zip; Firefox loads/installs the same bytes as .xpi, so copy
# one next to it for convenience.
ZIP="web-ext-artifacts/better_containers-${NEW_VERSION}.zip"
XPI="web-ext-artifacts/better_containers-${NEW_VERSION}.xpi"
cp "$ZIP" "$XPI"

echo "Built $ZIP"
echo "Built $XPI"
