#!/usr/bin/env bash
# Install all Trading Bot systemd service units and enable auto-start on boot.
# Run as root or via sudo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_DIR="/etc/systemd/system"

SERVICES=(
  nextjs.service
  trading-bot.service
  ib-service.service
  websocket-server.service
)

echo "Installing Trading Bot systemd services..."

for svc in "${SERVICES[@]}"; do
  SRC="$SCRIPT_DIR/$svc"
  DEST="$SYSTEMD_DIR/$svc"
  if [[ ! -f "$SRC" ]]; then
    echo "[SKIP] $svc not found at $SRC"
    continue
  fi
  cp "$SRC" "$DEST"
  chown root:root "$DEST"
  chmod 644 "$DEST"
  echo "  Installed: $DEST"
done

systemctl daemon-reload

echo ""
echo "Enabling services to auto-start on boot..."
for svc in "${SERVICES[@]}"; do
  systemctl enable "$svc" && echo "  Enabled: $svc"
done

echo ""
echo "✅ Done. Start services with:"
echo "   sudo systemctl start ib-service nextjs websocket-server trading-bot"
echo ""
echo "   Check status with:"
echo "   sudo systemctl status nextjs trading-bot ib-service websocket-server"
