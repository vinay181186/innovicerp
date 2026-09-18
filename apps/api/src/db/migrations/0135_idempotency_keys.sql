-- 0135 — Idempotency keys for write requests (ADR-172).
--
-- Twice in the 2026-09-17 verification run (IN-DC-00043/R1, IN-GRN-00044) one
-- click on Save took 14–20 s, the connection dropped, the browser resent the
-- request, and the second copy failed with "already exists" — although the
-- first copy had created the document within a second. Nothing was
-- duplicated; the user just saw an error for a save that worked.
--
-- The web app now sends a random `Idempotency-Key` header on every POST /
-- PATCH / PUT / DELETE. The API records (user, key) here BEFORE running the
-- handler and stores the response AFTER; a repeat with the same key waits for
-- the first run and is answered with its stored result instead of running the
-- handler again. Rows are short-lived (the plugin purges anything older than
-- one day) so this table never needs company scoping or RLS — it is
-- server-only bookkeeping keyed by the authenticated user.
--
-- Idempotent — every step is guarded, so a re-run is a no-op.

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_user_key_uniq
  ON idempotency_keys (user_id, key);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx
  ON idempotency_keys (created_at);
--> statement-breakpoint

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
