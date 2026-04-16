#!/usr/bin/env bash
# =============================================================================
# restore-db.sh — Restore PostgreSQL backup for the Trading Bot database
# =============================================================================
#
# Usage:
#   ./scripts/restore-db.sh <backup-file.sql.gz>
#
# Example:
#   ./scripts/restore-db.sh ~/Trading\ Project/backups/tradingdb_20260416_020000.sql.gz
#
# WARNING: This DROPS and RECREATES the trading database. All current data
# will be lost. Make sure you have confirmed you want to restore from backup.
# =============================================================================
set -euo pipefail

PGUSER="${PGUSER:-tradingbot}"
PGPASSWORD="${PGPASSWORD:-tradingbot123}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-tradingdb}"

export PGPASSWORD

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  exit 1
fi

BACKUP_FILE="$1"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "[ERROR] Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo ""
echo "⚠️  WARNING: This will DROP and RECREATE the database '$PGDATABASE'."
echo "   All current data will be replaced with the backup."
echo "   Backup file: $BACKUP_FILE"
echo ""
read -p "Type 'yes' to continue: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date -Iseconds)] Dropping and recreating database..."
psql --host="$PGHOST" --port="$PGPORT" --username="$PGUSER" \
  --dbname="postgres" \
  -c "DROP DATABASE IF EXISTS \"$PGDATABASE\";" \
  -c "CREATE DATABASE \"$PGDATABASE\" OWNER \"$PGUSER\";"

echo "[$(date -Iseconds)] Restoring from $BACKUP_FILE..."
zcat "$BACKUP_FILE" | psql \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --quiet

echo "[$(date -Iseconds)] ✅ Restore complete. Run 'npx prisma migrate deploy' to apply any pending migrations."
