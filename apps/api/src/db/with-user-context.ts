import type { UserRole } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { db } from './client';

export interface AuthContext {
  id: string;
  email: string;
  /** Optional so test mocks needn't supply it; the auth plugin always sets it at runtime. */
  fullName?: string | null;
  companyId: string | null;
  role: UserRole;
  isActive: boolean;
}

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Wraps a callback in a Drizzle transaction that injects the user's JWT claims
 * into the Postgres session via `set_config('request.jwt.claims', ..., true)`.
 * RLS policies read `current_company_id()` and `current_user_role()` which are
 * sourced from these claims.
 *
 * The `true` third arg makes the setting transaction-local, so it reverts on
 * commit/rollback automatically.
 */
export async function withUserContext<T>(
  user: AuthContext,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({
    sub: user.id,
    company_id: user.companyId ?? '',
    role: user.role,
    email: user.email,
  });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}
