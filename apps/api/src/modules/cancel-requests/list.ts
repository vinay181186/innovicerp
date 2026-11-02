// ADR-235 — GET /cancel-requests, the Approvals inbox tab. Pending first.
// `toDecide` narrows to doc types whose page the caller holds Approve on (and
// defaults to pending only when no `status` is given, so the tab's Approved /
// Rejected views still work). `total` is counted with the same WHERE.

import {
  CANCEL_DOC_TYPES,
  type CancelDocType,
  type ListCancelRequestsResponse,
} from '@innovic/shared';
import type { listCancelRequestsQuerySchema } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { cancelDeciderRight } from './registry';
import { formKeyOf, requireCompany, selectRows } from './rows';

/** Doc types whose page grants the caller `action` — the list never shows a
 *  request on a page the caller cannot open. 'decide' = the tick that decides
 *  that type's cancel: Approve, or Edit for a one-step type (Purchase Request,
 *  owner rule 2026-10-31 — so a request left pending from before still shows).
 *  Also used by GET /approvals/waiting and /approvals/history (ADR-265). */
export async function typesWith(
  user: AuthContext,
  action: 'view' | 'decide',
): Promise<CancelDocType[]> {
  const ok = await Promise.all(
    CANCEL_DOC_TYPES.map((t) =>
      hasFormAccess(user, formKeyOf(t), action === 'view' ? 'view' : cancelDeciderRight(t)),
    ),
  );
  return CANCEL_DOC_TYPES.filter((_, i) => ok[i]);
}

export async function listCancelRequests(
  q: z.output<typeof listCancelRequestsQuerySchema>,
  user: AuthContext,
): Promise<ListCancelRequestsResponse> {
  const companyId = requireCompany(user);
  const types = await typesWith(user, q.toDecide ? 'decide' : 'view');
  if (types.length === 0) return { items: [], total: 0 };

  const where = sql`
    AND cr.doc_type IN (${sql.join(
      types.map((t) => sql`${t}`),
      sql`, `,
    )})
    ${
      q.status
        ? sql`AND cr.status = ${q.status}`
        : q.toDecide
          ? sql`AND cr.status = 'pending'`
          : sql``
    }`;

  return withUserContext(user, async (tx) => {
    const items = await selectRows(tx, companyId, where, { limit: q.limit, offset: q.offset });
    const [c] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM public.cancel_requests cr
      WHERE cr.company_id = ${companyId}::uuid AND cr.deleted_at IS NULL ${where}
    `)) as unknown as Array<{ n: number }>;
    return { items, total: Number(c?.n ?? 0) };
  });
}
