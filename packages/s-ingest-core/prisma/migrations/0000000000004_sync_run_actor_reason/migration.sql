-- Audit columns for ADMIN runs (replay / reset-watermark): who triggered the run and why.
ALTER TABLE "sync_run" ADD COLUMN "actor" TEXT;
ALTER TABLE "sync_run" ADD COLUMN "reason" TEXT;
