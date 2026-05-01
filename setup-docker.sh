#!/bin/bash
# One-time Docker setup for the trading stack.
# Run with: sudo bash setup-docker.sh
set -e

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="${SUDO_USER:-aiserver}"

echo "=== Trading Stack — Docker Setup ==="
echo ""

# 1. Create docker group if missing (Snap Docker doesn't create it automatically),
#    then add the user and fix socket permissions
echo "[1/5] Configuring docker group..."
if ! getent group docker > /dev/null 2>&1; then
  groupadd docker
fi
usermod -aG docker "$USER_NAME"
# Fix socket ownership so group members can connect
chown root:docker /var/run/docker.sock
chmod 660 /var/run/docker.sock

# 2. Snap Docker is socket-activated — no systemctl needed, but ensure
#    the snap service is running
echo "[2/5] Starting Docker daemon..."
snap start docker 2>/dev/null || true

# 3. Stop + disable the old systemd user services (now replaced by Docker)
echo "[3/5] Disabling old systemd user services..."
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$(id -u $USER_NAME)" \
  systemctl --user stop    trading-ib trading-dashboard trading-websocket 2>/dev/null || true
sudo -u "$USER_NAME" XDG_RUNTIME_DIR="/run/user/$(id -u $USER_NAME)" \
  systemctl --user disable trading-ib trading-dashboard trading-websocket 2>/dev/null || true
# Also kill any processes still holding the ports
fuser -k 8765/tcp 3001/tcp 3002/tcp 2>/dev/null || true
sleep 2

# 4. Build and start all containers (run as root so group session isn't needed)
echo "[4/5] Building and starting containers (this takes a few minutes on first run)..."
cd "$PROJ_DIR"
docker compose up -d --build

# 5. Done
echo ""
echo "[5/5] Done!"
echo ""
docker compose ps
echo ""
echo "Dashboard:  http://localhost:3001"
echo "WS server:  http://localhost:3002"
echo "IB service: http://localhost:8765"
echo ""
echo "NOTE: Log out and back in (or run 'newgrp docker') so you can use"
echo "      'docker' without sudo in future terminals."
