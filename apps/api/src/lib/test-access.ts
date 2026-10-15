// ADR-232 — TEST ONLY. Build a caller with a chosen Access Control matrix,
// without writing a user_access row.
//
// Refusal tests used to spoof `{ ...admin, role: 'viewer' }`. That kept the
// seed admin's id, so once the role stopped gating writes the "viewer" read the
// admin's own full-access row and passed. A refusal test must instead say what
// the person's MATRIX is. This pre-fills the per-request access memo (ADR-229)
// that getMyAccess reads first, so every guard in the call sees `access`.
import type { EffectiveAccess } from '@innovic/shared';
import { openRequestScope, requestScope, type AuthContext } from '../db/with-user-context';

export function asAccess(
  base: AuthContext,
  access: Partial<EffectiveAccess>,
  role: string = 'operator',
): AuthContext {
  const eff: EffectiveAccess = {
    fullAccess: false,
    auditor: false,
    drawingDownload: false,
    departments: {},
    forms: {},
    ...access,
  };
  const user = openRequestScope({ ...base, role } as AuthContext);
  requestScope(user)!.myAccess = Promise.resolve(Object.freeze(eff));
  return user;
}

/** An L7 Auditor who still has a write tier stored — must write nothing. */
export const AUDITOR = { auditor: true, departments: { sales: 'L5', planning: 'L5', qc: 'L5' } } as const;
