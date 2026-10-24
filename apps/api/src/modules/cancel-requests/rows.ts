// ADR-235 — Cancel Request rows as the API returns them (requester / decider
// names joined in), plus the small helpers service.ts and list.ts share.

import {
  CANCEL_DOC_FORM_KEY,
  type AccessFormKey,
  type CancelDocType,
  type CancelRequestRow,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

export const formKeyOf = (t: CancelDocType): AccessFormKey =>
  CANCEL_DOC_FORM_KEY[t] as AccessFormKey;

export function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

const iso = (v: unknown): string | null =>
  v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();

export async function selectRows(
  tx: DbTransaction,
  companyId: string,
  where: SQL,
  page?: { limit: number; offset: number },
): Promise<CancelRequestRow[]> {
  const rows = (await tx.execute(sql`
    SELECT cr.id, cr.doc_type, cr.doc_id, cr.doc_code, cr.reason, cr.status,
      cr.requested_by, ru.full_name AS requested_by_name, cr.requested_at,
      cr.decided_by, du.full_name AS decided_by_name, cr.decided_at, cr.decision_note
    FROM public.cancel_requests cr
    LEFT JOIN public.users ru ON ru.id = cr.requested_by
    LEFT JOIN public.users du ON du.id = cr.decided_by
    WHERE cr.company_id = ${companyId}::uuid AND cr.deleted_at IS NULL ${where}
    ORDER BY (cr.status = 'pending') DESC, cr.requested_at DESC, cr.id
    ${page ? sql`LIMIT ${page.limit} OFFSET ${page.offset}` : sql``}
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    docType: r['doc_type'] as CancelDocType,
    docId: String(r['doc_id']),
    docCode: String(r['doc_code']),
    reason: String(r['reason']),
    status: r['status'] as CancelRequestRow['status'],
    requestedBy: String(r['requested_by']),
    requestedByName: (r['requested_by_name'] as string | null) ?? null,
    requestedAt: iso(r['requested_at']) ?? '',
    decidedBy: (r['decided_by'] as string | null) ?? null,
    decidedByName: (r['decided_by_name'] as string | null) ?? null,
    decidedAt: iso(r['decided_at']),
    decisionNote: (r['decision_note'] as string | null) ?? null,
  }));
}

export async function rowById(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelRequestRow> {
  const [row] = await selectRows(tx, companyId, sql`AND cr.id = ${id}::uuid`);
  if (!row) throw new NotFoundError('Cancel request not found.');
  return row;
}

export async function pendingFor(
  tx: DbTransaction,
  companyId: string,
  docType: CancelDocType,
  docId: string,
): Promise<CancelRequestRow | null> {
  const [row] = await selectRows(
    tx,
    companyId,
    sql`AND cr.doc_type = ${docType} AND cr.doc_id = ${docId}::uuid AND cr.status = 'pending'`,
  );
  return row ?? null;
}
