-- Add composite indexes to ActivityLog for efficient range queries.
-- These support common dashboard queries like:
--   "all errors in the last 24h" → WHERE type='error' AND createdAt > now()-interval '1 day'
--   "all AAPL activity today"    → WHERE pair='AAPL' AND createdAt > now()-interval '1 day'

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_type_idx" ON "ActivityLog"("createdAt", "type");

-- CreateIndex
CREATE INDEX "ActivityLog_pair_createdAt_idx" ON "ActivityLog"("pair", "createdAt");
