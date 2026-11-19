// ADR-309 — the push sender's claim statement. Runs on its own (autocommit):
// it bumps push_attempts on up to `batch` pending notices and returns them.
// The trigger moves updated_at on that UPDATE, so updated_at is the lease: a
// claimed row is not claimable again — by the next tick, a kick, or another
// API instance — until `backoffMs` has passed. A never-tried row (attempts 0)
// is claimable at once. SKIP LOCKED keeps two instances off the same rows
// while the claim itself runs. No network call ever happens inside it.

import { type SQL, sql } from 'drizzle-orm';

export function claimPendingSql(batch: number, backoffMs: number): SQL {
  return sql`
    UPDATE public.task_notices n SET push_attempts = n.push_attempts + 1
    WHERE n.push_status = 'pending' AND n.id IN (
      SELECT p.id FROM public.task_notices p
      WHERE p.push_status = 'pending' AND p.deleted_at IS NULL
        AND (p.push_attempts = 0
          OR p.updated_at < now() - (${backoffMs}::int * interval '1 millisecond'))
      ORDER BY p.event_at
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED)
    RETURNING n.id::text AS id, n.company_id::text AS company_id,
      n.recipient_id::text AS recipient_id, n.event_at, n.push_attempts`;
}
