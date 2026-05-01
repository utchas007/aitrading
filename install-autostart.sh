#!/bin/bash
# Install trading services as systemd units so they auto-start on boot.
# Run with: sudo bash install-autostart.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ETC_DIR="$SCRIPT_DIR/etc"

echo "Installing trading service files..."

cp "$ETC_DIR/trading-ib.service"        /etc/systemd/system/
cp "$ETC_DIR/trading-dashboard.service" /etc/systemd/system/
cp "$ETC_DIR/trading-websocket.service" /etc/systemd/system/

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling services to start on boot..."
systemctl enable trading-ib.service
systemctl enable trading-dashboard.service
systemctl enable trading-websocket.service

echo ""
echo "Done! Services will now start automatically on boot."
echo ""
echo "To start them right now:"
echo "  sudo systemctl start trading-ib"
echo "  sudo systemctl start trading-dashboard"
echo "  sudo systemctl start trading-websocket"
echo ""
echo "To check status:"
echo "  sudo systemctl status trading-ib trading-dashboard trading-websocket"
