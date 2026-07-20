#!/usr/bin/env bash
# Registers native-host/index.js as a Firefox Native Messaging host so the
# extension can open a connectNative() port to it. Run this once (and again
# if you move the repo), then reload the extension in about:debugging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/native-host/index.js"
HOST_NAME="com_companycontainers_host"
EXTENSION_ID="{d2e31876-bc5b-4d3c-b649-4b1faec96a87}"

if [[ ! -f "$HOST_SCRIPT" ]]; then
  echo "error: $HOST_SCRIPT not found" >&2
  exit 1
fi

chmod +x "$HOST_SCRIPT"

case "$(uname -s)" in
  Darwin)
    TARGET_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  Linux)
    TARGET_DIR="$HOME/.mozilla/native-messaging-hosts"
    ;;
  *)
    echo "error: unsupported platform $(uname -s)." >&2
    echo "Install the host manifest manually per:" >&2
    echo "https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"
MANIFEST_PATH="$TARGET_DIR/$HOST_NAME.json"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Company Containers native messaging host",
  "path": "$HOST_SCRIPT",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
EOF

echo "Installed native messaging host manifest at:"
echo "  $MANIFEST_PATH"
echo
echo "Next steps:"
echo "  1. Reload the extension in about:debugging."
echo "  2. Open the extension's Options page > Native Messaging > Regenerate token."
echo "  3. Try: node native-host/example-client.js <website> <token>"
