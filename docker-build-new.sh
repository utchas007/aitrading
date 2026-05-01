#!/bin/bash
# Build and start worldmonitor + trading-bot containers
# Run from a terminal where docker group is active (after logging out/in or newgrp docker)
set -e
cd "$(dirname "$0")"
docker compose up -d --build worldmonitor trading-bot
echo ""
docker compose ps
