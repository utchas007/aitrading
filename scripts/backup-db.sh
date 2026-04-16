#!/usr/bin/env bash
# =============================================================================
# backup-db.sh — PostgreSQL backup for the Trading Bot database
# =============================================================================
#
# Creates a compressed pg_dump of the trading database and rotates old backups.
# Designed to be run via cron or manually.
#
# CRON EXAMPLE (daily at 2 AM):
#   0 2 * * * /home/aiserver/Trading\ Project/scripts/backup-db.sh >> /var/log/trading-backup.log 2>&1
#
# INSTALL CRON:
#   crontab -e
#   # Add the line above, save, exit.
#
# ENVIRONMENT:
#   PGUSER        — Postgres user     (default: tradingbot)
#   PGPASSWORD    — Postgres password (default: tradingbot123)
#   PGHOST        — Postgres host     (default: localhost)
#   PGPORT        — Postgres port     (default: 5432)
#   PGDATABASE    — Database name     (default: tradingdb)
#   BACKUP_DIR    — Where to store backups (default: ~/Trading Project/backups)
#   BACKUP_RETAIN — Number of daily backups to keep (default: 14)
# =============================================================================
set -euo pipefail

PGUSER="${PGUSER:-tradingbot}"
PGPASSWORD="${PGPASSWORD:-tradingbot123}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-tradingdb}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Trading Project/backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-14}"

export PGPASSWORD

# ── Create backup directory if it doesn't exist ──────────────────────────────
mkdir -p "$BACKUP_DIR"

# ── Run pg_dump ───────────────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="tradingdb_${TIMESTAMP}.sql.gz"
FILEPATH="$BACKUP_DIR/$FILENAME"

echo "[$(date -Iseconds)] Starting backup → $FILEPATH"

pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --format=plain \
  --no-owner \
  --no-privileges \
  | gzip -9 > "$FILEPATH"

SIZE=$(du -sh "$FILEPATH" | cut -f1)
echo "[$(date -Iseconds)] Backup complete: $FILENAME ($SIZE)"

# ── Rotate old backups ────────────────────────────────────────────────────────
BACKUP_COUNT=$(find "$BACKUP_DIR" -name 'tradingdb_*.sql.gz' | wc -l)
if (( BACKUP_COUNT > BACKUP_RETAIN )); then
  TO_DELETE=$(( BACKUP_COUNT - BACKUP_RETAIN ))
  echo "[$(date -Iseconds)] Rotating $TO_DELETE old backup(s) (keeping $BACKUP_RETAIN)"
  find "$BACKUP_DIR" -name 'tradingdb_*.sql.gz' \
    | sort \
    | head -n "$TO_DELETE" \
    | xargs rm -f
fi

echo "[$(date -Iseconds)] Backup rotation complete. Current backups: $(find "$BACKUP_DIR" -name 'tradingdb_*.sql.gz' | wc -l)"
