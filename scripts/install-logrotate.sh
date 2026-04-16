#!/usr/bin/env bash
# Install log rotation config for the Trading Bot stack.
# Run once as a user with sudo access.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_SRC="$PROJECT_DIR/logrotate.conf"
CONFIG_DEST="/etc/logrotate.d/trading-bot"

if [[ ! -f "$CONFIG_SRC" ]]; then
  echo "[ERROR] logrotate.conf not found at $CONFIG_SRC"
  exit 1
fi

echo "Installing logrotate config: $CONFIG_DEST"
cp "$CONFIG_SRC" "$CONFIG_DEST"
chown root:root "$CONFIG_DEST"
chmod 644 "$CONFIG_DEST"

echo "Verifying config..."
logrotate -d "$CONFIG_DEST"

echo ""
echo "✅ Log rotation installed. Logs will rotate daily, keeping 14 days."
echo "   To force an immediate rotation (e.g. to shrink ib_service.log now):"
echo "   sudo logrotate -f $CONFIG_DEST"
