import type { EffectiveAccess, UserRole } from '@innovic/shared';
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

// ADR-229 — a place to remember things for ONE request, opened by the auth
// plugin on that request's own user object. Non-enumerable, so a spread copy
// (`{ ...user }`) never carries it; a context built anywhere else (the alerts
// worker, tests) has none, and whoever reads it must then work it out afresh.
const REQUEST_SCOPE = Symbol('innovic.requestScope');
/** The caller's access as getMyAccess hands it out: frozen at runtime, and
 *  read-only all the way down here, so a write that would throw at runtime is
 *  refused at compile time wherever the value is held as FrozenAccess. */
export type FrozenAccess = Readonly<{
  fullAccess: boolean;
  auditor: boolean;
  drawingDownload: boolean;
  departments: Readonly<EffectiveAccess['departments']>;
  forms: Readonly<{
    [K in keyof EffectiveAccess['forms']]: Readonly<EffectiveAccess['forms'][K]>;
  }>;
}>;
// One typed field per thing remembered, so nothing else can be stored there.
export type RequestScope = { myAccess?: Promise<FrozenAccess> | undefined };

export function openRequestScope<T extends AuthContext>(user: T): T {
  // Opening twice is harmless — the first scope is kept.
  if (!Object.prototype.hasOwnProperty.call(user, REQUEST_SCOPE)) {
    Object.defineProperty(user, REQUEST_SCOPE, { value: {}, enumerable: false });
  }
  return user;
}

export function requestScope(user: AuthContext): RequestScope | undefined {
  return (user as AuthContext & { [REQUEST_SCOPE]?: RequestScope })[REQUEST_SCOPE];
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
