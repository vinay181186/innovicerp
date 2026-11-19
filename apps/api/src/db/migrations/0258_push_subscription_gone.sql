-- ============================================================
-- 0258 — ADR-309 follow-up: remember a dead pop-up subscription.
--   push_subscriptions.gone_at — set (with deleted_at) when the push service
--   answers 404/410 for the endpoint. POST /me/push/subscription refuses to
--   re-save an endpoint that has a gone_at row (410), so the browser makes a
--   fresh subscription instead of re-sending the dead one forever.
-- Additive and idempotent — one nullable column, no data change.
-- Apply: DB_TARGET=TEST|PROD … tsx src/db/apply-sql.ts (see apply-sql.ts header).
-- ============================================================

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "gone_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_gone_endpoint_idx"
  ON "push_subscriptions" ("endpoint") WHERE "gone_at" IS NOT NULL;
