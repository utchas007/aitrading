-- CreateTable
CREATE TABLE "TradingSignal" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pair" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit" DOUBLE PRECISION NOT NULL,
    "positionSize" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT NOT NULL,
    "rsi" DOUBLE PRECISION,
    "rsiSignal" TEXT,
    "macdTrend" TEXT,
    "bbPosition" TEXT,
    "emaTrend" TEXT,
    "volumeSpike" BOOLEAN,
    "stochRsiK" DOUBLE PRECISION,
    "stochRsiD" DOUBLE PRECISION,
    "stochRsiSignal" TEXT,
    "atrPercent" DOUBLE PRECISION,
    "obvTrend" TEXT,
    "ichimokuSignal" TEXT,
    "volatilityLevel" TEXT,
    "fearGreedValue" INTEGER,
    "fearGreedClass" TEXT,
    "redditSentiment" DOUBLE PRECISION,
    "overallSentiment" TEXT,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "txid" TEXT,

    CONSTRAINT "TradingSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "pair" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION,
    "pnlPercent" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "txid" TEXT,
    "closeTxid" TEXT,
    "closeReason" TEXT,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "cadBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "btcBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ethBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "solBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ltcBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "xrpBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "btcPrice" DOUBLE PRECISION,
    "ethPrice" DOUBLE PRECISION,
    "solPrice" DOUBLE PRECISION,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "pair" TEXT,
    "data" JSONB,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketIntelligence" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pair" TEXT NOT NULL,
    "fearGreedValue" INTEGER NOT NULL,
    "fearGreedClass" TEXT NOT NULL,
    "redditSentiment" DOUBLE PRECISION NOT NULL,
    "overallSentiment" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "coinDeskHeadlines" JSONB,
    "redditPosts" JSONB,
    "consensusSignal" TEXT,
    "buyCount" INTEGER,
    "sellCount" INTEGER,
    "holdCount" INTEGER,
    "avgConfidence" DOUBLE PRECISION,

    CONSTRAINT "MarketIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceCandle" (
    "id" SERIAL NOT NULL,
    "pair" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "time" INTEGER NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceCandle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradingSignal_pair_createdAt_idx" ON "TradingSignal"("pair", "createdAt");

-- CreateIndex
CREATE INDEX "TradingSignal_createdAt_idx" ON "TradingSignal"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_pair_createdAt_idx" ON "Trade"("pair", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_createdAt_idx" ON "PortfolioSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_type_idx" ON "ActivityLog"("type");

-- CreateIndex
CREATE INDEX "ActivityLog_pair_idx" ON "ActivityLog"("pair");

-- CreateIndex
CREATE INDEX "MarketIntelligence_pair_createdAt_idx" ON "MarketIntelligence"("pair", "createdAt");

-- CreateIndex
CREATE INDEX "PriceCandle_pair_interval_time_idx" ON "PriceCandle"("pair", "interval", "time");

-- CreateIndex
CREATE UNIQUE INDEX "PriceCandle_pair_interval_time_key" ON "PriceCandle"("pair", "interval", "time");
