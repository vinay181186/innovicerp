// ADR-265 — GET /approvals/history: past approve / reject decisions on the
// approval types the CALLER may decide (scope.ts — the decide endpoints' own
// checks). ONE UNION ALL over the stores that keep a decision:
//   edit     document_edit_requests, status approved / rejected (the
//            request's own final status, also when decided across calls)
//   cancel   cancel_requests, status approved / rejected
//   logEntry op_log_time_change_requests, status approved / rejected
//   po / rc  activity_log APPROVE / REJECT written by approvePurchaseOrder /
//            rejectPurchaseOrder (PO Status change from Draft) and
//            approveRouteCard / rejectRouteCard (RC Status change) — the
//            change filter keeps a staged edit's APPROVE row on the same
//            document out (that one is in the edit branch already).
// Day Log keeps no decision record, so it is not listed.
// Every branch filters company_id; the request tables filter deleted_at (the
// activity log has none). Newest first, paged with LIMIT / OFFSET; `counts` is
// per type for the decision asked (before the type filter) and `total` is
// read off it, so paging and counts always agree.

import {
  type ApprovalHistoryListResponse,
  type ApprovalHistoryRow,
  approvalHistoryListQuerySchema,
  type ApprovalKind,
  CANCEL_DOC_LABELS,
  type CancelDocType,
  docNavPage,
  type ApprovalHistoryListQuery,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape } from '../../lib/list-query';
import { entityHref } from '../dashboard/personal/util';
import { rcNavPage } from '../route-cards/approval-inbox';
import { type ApproverScope, loadApproverScope } from './scope';
import { cancelDocHref } from './waiting';
import { orderedCounts, poRequestText, RC_REQUEST_TEXT, toIso, typeLabelOf } from './waiting-text';

const inList = (values: readonly string[]): SQL =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** "COALESCE(full name, e-mail)" of a users alias. */
const nameOf = (alias: string): SQL =>
  sql.raw(`COALESCE(NULLIF(btrim(${alias}.full_name), ''), ${alias}.email)`);

/** The UNION ALL branches the caller may see; empty = nothing to show. */
function branches(companyId: string, s: ApproverScope): SQL[] {
  const out: SQL[] = [];
  if (s.editEntities.length > 0) {
    out.push(sql`
      SELECT 'edit' AS kind, d.id::text AS id, 'edit:' || d.entity AS type_key,
        d.doc_code, d.entity_id::text AS doc_id, d.entity, NULL::text AS doc_type,
        jsonb_array_length(d.changes)::text
          || CASE WHEN jsonb_array_length(d.changes) = 1 THEN ' field changed'
                  ELSE ' fields changed' END AS request,
        d.status::text AS decision, ${nameOf('du')} AS decided_by_name,
        COALESCE(d.decided_at, d.updated_at) AS decided_at,
        -- The overall note, else the per-change reject reasons (1A).
        COALESCE(d.decision_reason, (
          SELECT string_agg(x->>'reason', '; ')
          FROM jsonb_array_elements(d.decisions) x
          WHERE NULLIF(btrim(x->>'reason'), '') IS NOT NULL
        )) AS reason
      FROM public.document_edit_requests d
      LEFT JOIN public.users du ON du.id = d.decided_by
      WHERE d.company_id = ${companyId}::uuid AND d.deleted_at IS NULL
        AND d.status IN ('approved', 'rejected')
        AND d.entity IN (${inList(s.editEntities)})`);
  }
  if (s.cancelTypes.length > 0) {
    const label = sql`CASE cr.doc_type ${sql.join(
      s.cancelTypes.map((t) => sql`WHEN ${t}::text THEN ${CANCEL_DOC_LABELS[t]}::text`),
      sql` `,
    )} ELSE cr.doc_type END`;
    out.push(sql`
      SELECT 'cancel', cr.id::text, 'cancel', cr.doc_code, cr.doc_id::text, NULL::text,
        cr.doc_type, 'Cancel ' || ${label} || ' · ' || cr.reason,
        cr.status, ${nameOf('du')}, COALESCE(cr.decided_at, cr.updated_at), cr.decision_note
      FROM public.cancel_requests cr
      LEFT JOIN public.users du ON du.id = cr.decided_by
      WHERE cr.company_id = ${companyId}::uuid AND cr.deleted_at IS NULL
        AND cr.status IN ('approved', 'rejected')
        AND cr.doc_type IN (${inList(s.cancelTypes)})`);
  }
  if (s.logScope) {
    out.push(sql`
      -- Op # = op_seq × 10, the same number opSrNo (shared) prints.
      SELECT 'logEntry', r.id::text, 'logEntry', jc.code || ' · Op #' || (o.op_seq * 10)::text,
        jc.id::text, NULL::text, NULL::text,
        -- Same text as timeChangeRequestText (waiting-text.ts).
        CASE WHEN r.prev_log_date = r.requested_log_date
          THEN 'Start ' || COALESCE(left(r.prev_start_time::text, 5), '—') || ' → '
            || COALESCE(left(r.requested_start_time::text, 5), '—')
          ELSE to_char(r.prev_log_date, 'DD-Mon-YYYY') || ' '
            || COALESCE(left(r.prev_start_time::text, 5), '—') || ' → '
            || to_char(r.requested_log_date, 'DD-Mon-YYYY') || ' '
            || COALESCE(left(r.requested_start_time::text, 5), '—')
        END || COALESCE(' · ' || NULLIF(btrim(r.reason), ''), ''),
        r.status::text, ${nameOf('du')}, COALESCE(r.decided_at, r.updated_at), r.decision_reason
      FROM public.op_log_time_change_requests r
      JOIN public.op_log l ON l.id = r.op_log_id
      JOIN public.jc_ops o ON o.id = r.jc_op_id AND o.deleted_at IS NULL
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      LEFT JOIN public.users du ON du.id = r.decided_by
      WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
        AND r.status IN ('approved', 'rejected')
        ${s.logScope}`);
  }
  const docs: SQL[] = [];
  if (s.po) {
    docs.push(sql`(al.entity = 'PurchaseOrder'
      AND al.changes @> ${'[{"field":"status","before":"Draft"}]'}::jsonb)`);
  }
  if (s.rc) {
    docs.push(sql`(al.entity = 'RouteCard'
      AND al.changes @> ${'[{"field":"approvalStatus"}]'}::jsonb)`);
  }
  if (docs.length > 0) {
    out.push(sql`
      SELECT CASE al.entity WHEN 'PurchaseOrder' THEN 'po' ELSE 'rc' END,
        al.id::text, CASE al.entity WHEN 'PurchaseOrder' THEN 'po' ELSE 'rc' END,
        COALESCE(al.ref_id, ''), al.entity_id::text, al.entity, NULL::text,
        CASE al.entity WHEN 'PurchaseOrder' THEN ${poRequestText(null)}::text ELSE ${RC_REQUEST_TEXT}::text END,
        CASE al.action WHEN 'APPROVE' THEN 'approved' ELSE 'rejected' END,
        COALESCE(NULLIF(btrim(al.user_full_name), ''), ${nameOf('u')}, al.user_name),
        al.ts,
        -- A PO approve remark is only in detail ("<code> approved by X — <remark>").
        COALESCE(al.reason, CASE WHEN al.action = 'APPROVE' AND position(' — ' IN al.detail) > 0
          THEN NULLIF(btrim(substring(al.detail FROM position(' — ' IN al.detail) + 3)), '') END)
      FROM public.activity_log al
      LEFT JOIN public.users u ON u.id = al.user_id
      WHERE al.company_id = ${companyId}::uuid
        AND al.action IN ('APPROVE', 'REJECT')
        AND (${sql.join(docs, sql` OR `)})`);
  }
  return out;
}

/** The document page a history row opens on. */
function hrefOf(r: Record<string, unknown>): string | null {
  const docId = (r['doc_id'] as string | null) ?? null;
  if (!docId) return null;
  const code = String(r['doc_code'] ?? '');
  switch (r['kind'] as ApprovalKind) {
    case 'po':
      return docNavPage('purchase-order', docId);
    case 'rc':
      return rcNavPage(docId);
    case 'logEntry':
      return docNavPage('job-card', docId);
    case 'edit':
      return entityHref(String(r['entity'] ?? ''), docId, code);
    case 'cancel':
      return cancelDocHref(r['doc_type'] as CancelDocType, docId, code);
    default:
      return null;
  }
}

export async function listApprovalHistory(
  rawQuery: ApprovalHistoryListQuery,
  user: AuthContext,
): Promise<ApprovalHistoryListResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const q = approvalHistoryListQuerySchema.parse(rawQuery);
  // Access first — each check opens its own transaction.
  const scope = await loadApproverScope(user);
  const parts = branches(companyId, scope);
  if (parts.length === 0) return { rows: [], counts: [], total: 0 };

  const term = q.search?.trim().replace(/\s+/g, ' ');
  const pat = term ? `%${likeEscape(term)}%` : null;
  const where = sql`WHERE h.decision = ${q.decision}
    ${
      pat
        ? sql`AND (h.doc_code ILIKE ${pat} ESCAPE '\\' OR h.request ILIKE ${pat} ESCAPE '\\'
            OR h.decided_by_name ILIKE ${pat} ESCAPE '\\' OR h.reason ILIKE ${pat} ESCAPE '\\')`
        : sql``
    }`;
  const union = sql.join(parts, sql` UNION ALL `);

  return withUserContext(user, async (tx) => {
    const countRows = (await tx.execute(sql`
      SELECT h.type_key, COUNT(*)::int AS n FROM (${union}) h ${where} GROUP BY h.type_key
    `)) as unknown as Array<{ type_key: string; n: number }>;
    const counts = orderedCounts(new Map(countRows.map((c) => [c.type_key, Number(c.n)])));
    const total = q.type
      ? (counts.find((c) => c.typeKey === q.type)?.n ?? 0)
      : counts.reduce((s, c) => s + c.n, 0);
    if (total === 0 || q.offset >= total) return { rows: [], counts, total };

    const rows = (await tx.execute(sql`
      SELECT h.* FROM (${union}) h ${where}
        ${q.type ? sql`AND h.type_key = ${q.type}` : sql``}
      ORDER BY h.decided_at DESC, h.id DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    const out: ApprovalHistoryRow[] = rows.map((r) => {
      const typeKey = String(r['type_key']);
      return {
        kind: r['kind'] as ApprovalKind,
        id: String(r['id']),
        typeKey,
        typeLabel: typeLabelOf(typeKey),
        docCode: String(r['doc_code'] ?? ''),
        docHref: hrefOf(r),
        request: String(r['request'] ?? ''),
        decision: r['decision'] === 'approved' ? 'approved' : 'rejected',
        decidedByName: (r['decided_by_name'] as string | null) ?? null,
        decidedAt: toIso(r['decided_at']),
        reason: (r['reason'] as string | null) ?? null,
      };
    });
    return { rows: out, counts, total };
  });
}
