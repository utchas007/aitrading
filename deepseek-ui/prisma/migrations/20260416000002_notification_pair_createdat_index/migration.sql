-- Add composite index to Notification for efficient per-stock history queries
-- and to speed up the retention DELETE (WHERE createdAt < cutoff AND pair = ?).

-- CreateIndex
CREATE INDEX "Notification_pair_createdAt_idx" ON "Notification"("pair", "createdAt");
