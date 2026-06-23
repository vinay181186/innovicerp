// Retry helper for server-generated unique codes (SO No, JWSO No, Vendor code).
//
// These codes are generated server-side as MAX(series)+1 inside the create
// transaction. Under concurrency two transactions can compute the same next
// number; the loser hits the per-company unique index
// (`<table>_company_code_uniq`) and Postgres raises SQLSTATE 23505.
//
// A 23505 ABORTS the whole Postgres transaction, so it cannot be caught and
// retried inside the same `withUserContext(tx)` callback — the retry must open
// a FRESH transaction per attempt. Hence this wraps the whole transactional
// thunk and re-invokes it on a unique violation.

/** True for a Postgres unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === '23505'
  );
}

/**
 * Run `fn` (which should open its own transaction, e.g. via withUserContext)
 * and retry from scratch if it fails with a unique violation. Non-unique errors
 * (including ConflictError from an explicit caller-supplied duplicate code)
 * propagate immediately. Throws the last 23505 if all attempts collide.
 */
export async function withUniqueRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error('withUniqueRetry: exhausted attempts');
}
