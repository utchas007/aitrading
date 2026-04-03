# Database Setup Guide

This guide explains how to set up PostgreSQL for the AI Trading Bot.

## Prerequisites

- PostgreSQL 14+
- Node.js 18+

## 1. Install PostgreSQL

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

## 2. Create Database and User

```bash
# Switch to postgres user
sudo -u postgres psql

# In PostgreSQL shell:
CREATE USER tradingbot WITH PASSWORD 'tradingbot123';
CREATE DATABASE tradingdb OWNER tradingbot;
GRANT ALL PRIVILEGES ON DATABASE tradingdb TO tradingbot;
\q
```

## 3. Configure Environment

Create or edit `deepseek-ui/.env.local`:

```env
DATABASE_URL="postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb"
```

## 4. Install Dependencies

```bash
cd deepseek-ui
npm install @prisma/client prisma pg @prisma/adapter-pg
```

## 5. Apply Database Schema

```bash
cd deepseek-ui
npx prisma db push
npx prisma generate
```

## 6. Database Tables

| Table | Purpose |
|-------|---------|
| `BotState` | Persists bot running state across server restarts |
| `ActivityLog` | Bot activity feed (survives page refresh) |
| `TradingSignal` | AI-generated trading signals |
| `Trade` | Executed trade records |
| `PortfolioSnapshot` | Portfolio value history |
| `ChatConversation` | AI chat sessions |
| `ChatMessage` | Chat messages |
| `MarketIntelligence` | Market sentiment data |
| `PriceCandle` | Historical price cache |

## 7. Verify Setup

```bash
# Check tables exist
PGPASSWORD=tradingbot123 psql -U tradingbot -h localhost -d tradingdb -c "\dt"

# Expected output:
#  Schema |        Name        | Type  |   Owner    
# --------+--------------------+-------+------------
#  public | ActivityLog        | table | tradingbot
#  public | BotState           | table | tradingbot
#  public | ChatConversation   | table | tradingbot
#  public | ChatMessage        | table | tradingbot
#  public | MarketIntelligence | table | tradingbot
#  public | PortfolioSnapshot  | table | tradingbot
#  public | PriceCandle        | table | tradingbot
#  public | Trade              | table | tradingbot
#  public | TradingSignal      | table | tradingbot
```

## 8. Key Features

### Bot State Persistence

The `BotState` table stores whether the bot is running. This survives:
- Page refreshes
- Server restarts
- Browser closes

When the server starts, it checks if the bot should be running and auto-recovers.

### Activity Log Persistence

The `ActivityLog` table stores all bot activities. When you refresh the page, the last 50 activities are loaded from the database.

## 9. Prisma Client Setup

The project uses Prisma with a custom `pg` adapter for connection pooling.

**File: `deepseek-ui/lib/db.ts`**
```typescript
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

## 10. Troubleshooting

### "relation does not exist" Error
```bash
cd deepseek-ui
npx prisma db push
```

### Connection Refused
```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### Permission Denied
```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tradingbot;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tradingbot;
```

### Clear Cache After Schema Changes
```bash
rm -rf deepseek-ui/.next
npx prisma generate
npm run dev
```

## 11. Backup

```bash
# Backup
pg_dump -U tradingbot -h localhost tradingdb > backup.sql

# Restore
psql -U tradingbot -h localhost tradingdb < backup.sql
```

## Quick Start Summary

```bash
# 1. Create database
sudo -u postgres psql -c "CREATE USER tradingbot WITH PASSWORD 'tradingbot123';"
sudo -u postgres psql -c "CREATE DATABASE tradingdb OWNER tradingbot;"

# 2. Set environment
echo 'DATABASE_URL="postgresql://tradingbot:tradingbot123@localhost:5432/tradingdb"' >> deepseek-ui/.env.local

# 3. Apply schema
cd deepseek-ui
npx prisma db push
npx prisma generate

# 4. Verify
PGPASSWORD=tradingbot123 psql -U tradingbot -h localhost -d tradingdb -c "\dt"
```
