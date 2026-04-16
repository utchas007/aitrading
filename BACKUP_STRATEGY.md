# Database Backup Strategy

## Overview

The trading bot uses PostgreSQL (`tradingdb`) as its primary data store. All trading signals, open positions, portfolio snapshots, and activity logs are persisted here.

Backups are managed by `scripts/backup-db.sh` which creates compressed `pg_dump` snapshots and rotates old files automatically.

---

## Automated Backup (Recommended)

### Install cron job (daily at 2 AM)

```bash
crontab -e
```

Add:
```
# Daily DB backup at 2 AM
0 2 * * * /home/aiserver/Trading\ Project/scripts/backup-db.sh >> /var/log/trading-backup.log 2>&1

# Daily cleanup at 3 AM (deletes ActivityLog + Notification rows older than 90 days)
0 3 * * * curl -s -H "X-Cron-Secret: your-secret-here" http://localhost:3001/api/cron/cleanup >> /var/log/trading-cleanup.log 2>&1
```

Save and exit. Verify with:
```bash
crontab -l
```

---

## Manual Backup

```bash
./scripts/backup-db.sh
```

Backups are stored in `~/Trading Project/backups/` by default:
```
backups/
├── tradingdb_20260416_020000.sql.gz   ← 14 days kept
├── tradingdb_20260415_020000.sql.gz
└── ...
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PGUSER` | `tradingbot` | PostgreSQL user |
| `PGPASSWORD` | `tradingbot123` | PostgreSQL password |
| `PGHOST` | `localhost` | PostgreSQL host |
| `PGPORT` | `5432` | PostgreSQL port |
| `PGDATABASE` | `tradingdb` | Database name |
| `BACKUP_DIR` | `~/Trading Project/backups` | Where backups are stored |
| `BACKUP_RETAIN` | `14` | Number of daily backups to keep |

Override via environment:
```bash
BACKUP_RETAIN=30 BACKUP_DIR=/mnt/nas/backups ./scripts/backup-db.sh
```

---

## Restore from Backup

```bash
./scripts/restore-db.sh backups/tradingdb_20260416_020000.sql.gz
```

> ⚠️ **WARNING**: Restore DROPS and RECREATES the database. All current data is replaced. The script prompts for confirmation.

After restore, apply any pending Prisma migrations:
```bash
cd deepseek-ui && npx prisma migrate deploy
```

---

## What Is Backed Up

| Table | Contents |
|---|---|
| `Trade` | All open and closed trade records |
| `TradingSignal` | AI-generated signals |
| `ActivityLog` | Bot activity feed |
| `PortfolioSnapshot` | Portfolio value history |
| `BotState` | Bot running state / config |
| `ChatConversation` | AI chat history |
| `Notification` | Trade notifications |
| `PriceCandle` | OHLCV price history |

---

## Recovery Time Objective (RTO)

- Restore from backup: ~2–5 minutes
- Prisma migrations: ~30 seconds
- Bot restart: ~1 minute
- **Total estimated RTO: < 10 minutes**

---

## Off-Site Backup (Optional)

For production use, copy backups to an off-site location:

```bash
# Example: rsync to another server
rsync -avz ~/Trading\ Project/backups/ user@backup-server:/backups/tradingdb/

# Example: copy to S3
aws s3 sync ~/Trading\ Project/backups/ s3://my-bucket/tradingdb-backups/
```

Add this to the cron job after `backup-db.sh` completes.
