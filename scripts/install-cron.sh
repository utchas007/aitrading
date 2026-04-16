#!/usr/bin/env bash
# =============================================================================
# install-cron.sh — Install Trading Bot cron jobs
# =============================================================================
# Sets up two daily cron jobs:
#   2:00 AM — PostgreSQL backup (pg_dump → compressed .sql.gz)
#   3:00 AM — Database cleanup (deletes ActivityLog + Notification rows > 90 days)
#
# Usage:
#   ./scripts/install-cron.sh
#
# The cleanup job requires CRON_SECRET to be set in .env.local.
# Generate one with: openssl rand -hex 32
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Read CRON_SECRET from .env.local if it exists
CRON_SECRET=""
ENV_FILE="$PROJECT_DIR/deepseek-ui/.env.local"
if [[ -f "$ENV_FILE" ]]; then
  CRON_SECRET=$(grep -E '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'" || true)
fi

if [[ -z "$CRON_SECRET" ]]; then
  echo ""
  echo "⚠️  CRON_SECRET is not set in deepseek-ui/.env.local"
  echo "   The cleanup endpoint will be OPEN (no auth) in development."
  echo "   For production, generate a secret and add it:"
  echo ""
  echo "   echo \"CRON_SECRET=\$(openssl rand -hex 32)\" >> deepseek-ui/.env.local"
  echo ""
  CRON_SECRET="no-secret-set"
fi

BACKUP_JOB="0 2 * * * \"$PROJECT_DIR/scripts/backup-db.sh\" >> /var/log/trading-backup.log 2>&1"
CLEANUP_JOB="0 3 * * * curl -sf -H \"X-Cron-Secret: $CRON_SECRET\" http://localhost:3001/api/cron/cleanup >> /var/log/trading-cleanup.log 2>&1"

echo "Installing cron jobs..."

# Get current crontab (ignore error if empty)
EXISTING=$(crontab -l 2>/dev/null || true)

# Remove old versions of our jobs (by comment marker)
CLEANED=$(echo "$EXISTING" | grep -v 'trading-bot\|backup-db\|api/cron/cleanup' || true)

# Add new jobs with comment markers
NEW_CRONTAB="${CLEANED}
# Trading Bot — daily backup (2 AM)
${BACKUP_JOB}
# Trading Bot — daily cleanup: delete ActivityLog + Notification rows > 90 days (3 AM)
${CLEANUP_JOB}
"

echo "$NEW_CRONTAB" | crontab -

echo ""
echo "✅ Cron jobs installed. Current crontab:"
crontab -l | grep -A1 'Trading Bot'
echo ""
echo "Logs will be written to:"
echo "  /var/log/trading-backup.log"
echo "  /var/log/trading-cleanup.log"
