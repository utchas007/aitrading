#!/bin/bash
# Migrates old local PostgreSQL data into the Docker trading-postgres container.
# Pipes pg_dump directly into psql — no intermediate files on the host.
set -e

OLD_DATA_DIR="/home/aiserver/pg-local/data"
CONTAINER="trading-postgres"
DB_USER="tradingbot"
DB_NAME="tradingdb"

echo "=== Trading DB Migration ==="
echo ""

# Clean up any leftover temp container from a previous failed run
sudo docker rm -f trading-pg-dump-tmp >/dev/null 2>&1 || true

# 1. Check old data dir exists
if [ ! -d "$OLD_DATA_DIR" ]; then
  echo "ERROR: Old data directory not found at $OLD_DATA_DIR"
  exit 1
fi
echo "[1/5] Found old data at $OLD_DATA_DIR"

# 2. Check trading-postgres is running
if ! sudo docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo "ERROR: Container '$CONTAINER' is not running."
  echo "  Run: cd ~/Trading\ Project && sudo docker compose up -d postgres"
  exit 1
fi
echo "[2/5] Container $CONTAINER is running"

# 3. Start temp postgres container mounting old data
echo "[3/5] Starting temporary postgres to read old database..."
sudo docker run -d \
  --user 1000:1000 \
  -v "${OLD_DATA_DIR}:/var/lib/postgresql/data" \
  --name trading-pg-dump-tmp \
  postgres:16-alpine \
  sh -c "postgres -D /var/lib/postgresql/data -p 5433 -k /tmp"

echo "Waiting for temp postgres to be ready..."
for i in $(seq 1 30); do
  if sudo docker exec trading-pg-dump-tmp pg_isready -h 127.0.0.1 -p 5433 -U "$DB_USER" -q 2>/dev/null; then
    echo "Postgres ready after ${i}s"
    break
  fi
  sleep 1
done

# 4. Drop and recreate the target database, then pipe dump directly into it
echo "[4/5] Dropping old schema and restoring old data..."

# Terminate connections, then drop/create outside any transaction
sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"
sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"
sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# Pipe pg_dump output from temp container directly into psql in live container
sudo docker exec trading-pg-dump-tmp \
  pg_dump -h 127.0.0.1 -p 5433 -U "$DB_USER" -d "$DB_NAME" \
  --no-owner --no-privileges \
  | sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME"

sudo docker rm -f trading-pg-dump-tmp >/dev/null 2>&1
echo "[4/5] Restore complete."

# 5. Verify
echo "[5/5] Verifying restored data..."
sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
  SELECT relname AS table, n_live_tup AS rows
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 15;
"

echo ""
echo "=== Migration complete! ==="
echo "Your old trade history, notifications, and portfolio data are now in Docker."
echo "Refresh the dashboard at http://localhost:3001"
