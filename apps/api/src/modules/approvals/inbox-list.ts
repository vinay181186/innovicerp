// GET /approvals/inbox/list — ONE section (PR or PO) of the Approvals inbox, a
// page at a time (ADR-201). Search and Sort & Filter run here over every
// waiting document; `total` is counted with the same WHERE as the page.
//
// The eligibility rules are the SAME as the inbox's own lists (and so the
// approve endpoints'): purchase-requests/approval-inbox.ts and
// purchase-orders/approval-inbox.ts. They are restated in SQL here so the PO
// approval-ceiling test (done in JS there) can sit under LIMIT / OFFSET:
//   PR — Approve on Purchase Requests, PR Status Open (own PRs included).
//   PO — Approve on Purchase Orders + write role, on po_approvers (admins
//        always), PO Status Draft, PO value within the ceiling unless it is
//        the caller's own PO (self-approval skips the limit).
// The access answers come from those modules' own loaders, read before the
// transaction opens (each opens its own).

import type {
  ApprovalInboxListQuery,
  ApprovalInboxListResponse,
  ApprovalInboxRow,
} from '@innovic/shared';
import { approvalInboxListQuerySchema } from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { loadPoInboxAccess } from '../purchase-orders/approval-inbox';
import { loadApprovalContext } from '../purchase-orders/service';
import { loadPrInboxAccess } from '../purchase-requests/approval-inbox';

/** Sort & Filter fields — columns of the `t` row set both sections build. */
export const APPROVALS_SF_COLUMNS: SfColumnMap = {
  docCode: { sql: sql`t.doc_code`, type: 'text' },
  vendorName: { sql: sql`t.vendor_name`, type: 'text' },
  itemCode: { sql: sql`t.item_code`, type: 'text' },
  itemName: { sql: sql`t.item_name`, type: 'text' },
  docQty: { sql: sql`t.doc_qty`, type: 'num' },
  docAmount: { sql: sql`t.doc_amount`, type: 'num', price: true },
  createdByName: { sql: sql`t.created_by_name`, type: 'text' },
  createdAt: { sql: sql`(t.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};

function prRows(companyId: string): SQL {
  return sql`
    SELECT pr.id, pr.code AS doc_code,
      COALESCE(v.name, pr.vendor_code_text) AS vendor_name,
      COALESCE(i.code, pr.item_code_text) AS item_code,
      pr.item_name AS item_name,
      pr.qty::float AS doc_qty,
      -- Est. Rate is per piece (the form labels it ₹/pc).
      (pr.qty * COALESCE(pr.est_cost, 0))::float AS doc_amount,
      u.full_name AS created_by_name,
      pr.created_at
    FROM public.purchase_requests pr
    LEFT JOIN public.vendors v ON v.id = pr.vendor_id
    LEFT JOIN public.items i ON i.id = pr.item_id
    LEFT JOIN public.users u ON u.id = pr.created_by
    WHERE pr.company_id = ${companyId}::uuid
      AND pr.deleted_at IS NULL
      AND pr.status = 'open'`;
}

function poRows(companyId: string, userId: string, isAdmin: boolean, ceiling: number): SQL {
  return sql`
    SELECT po.id, po.code AS doc_code,
      COALESCE(v.name, po.vendor_code_text) AS vendor_name,
      NULL::text AS item_code, NULL::text AS item_name,
      COALESCE(SUM(pol.qty), 0)::float AS doc_qty,
      COALESCE(SUM(pol.qty * pol.rate), 0)::float AS doc_amount,
      u.full_name AS created_by_name,
      po.created_at
    FROM public.purchase_orders po
    LEFT JOIN public.vendors v ON v.id = po.vendor_id
    LEFT JOIN public.users u ON u.id = po.created_by
    LEFT JOIN public.purchase_order_lines pol
      ON pol.purchase_order_id = po.id AND pol.deleted_at IS NULL
    WHERE po.company_id = ${companyId}::uuid
      AND po.deleted_at IS NULL
      AND po.status = 'draft'
    GROUP BY po.id, v.name, u.full_name
    ${
      isAdmin
        ? sql``
        : sql`HAVING po.created_by = ${userId}::uuid
            OR COALESCE(SUM(pol.qty * pol.rate), 0)::float <= ${ceiling}::float`
    }`;
}

export async function listApprovalInboxSection(
  rawQuery: ApprovalInboxListQuery,
  user: AuthContext,
): Promise<ApprovalInboxListResponse> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  const q = approvalInboxListQuerySchema.parse(rawQuery);
  const sf = readSf(q.sf);

  const access = q.section === 'pr' ? await loadPrInboxAccess(user) : await loadPoInboxAccess(user);
  if (!access.canApprove) return { items: [], total: 0 };
  const opts = { canSeePrice: access.showMoney };

  return withUserContext(user, async (tx) => {
    let rowsSql: SQL;
    if (q.section === 'pr') {
      rowsSql = prRows(companyId);
    } else {
      const ctx = await loadApprovalContext(tx, companyId, user.id, user.role);
      if (!ctx.isApprover) return { items: [], total: 0 };
      rowsSql = poRows(companyId, user.id, ctx.isAdmin, ctx.approvalCeiling);
    }

    const term = q.search?.trim().replace(/\s+/g, ' ');
    const pat = term ? `%${likeEscape(term)}%` : null;
    const searchSql = pat
      ? sql`AND (${sql.join(
          [
            sql`t.doc_code`,
            sql`t.vendor_name`,
            sql`t.item_code`,
            sql`t.item_name`,
            sql`t.created_by_name`,
          ].map((f) => sql`${f} ILIKE ${pat} ESCAPE '\\'`),
          sql` OR `,
        )})`
      : sql``;
    const where = sql`WHERE TRUE ${searchSql} ${sfWhere(APPROVALS_SF_COLUMNS, sf, opts)}`;
    // Oldest first (a queue); id last so paging never skips or repeats a row.
    const order = sfOrderBy(APPROVALS_SF_COLUMNS, sf, sql`t.created_at ASC, t.id ASC`, opts);

    const rows = (await tx.execute(sql`
      SELECT t.*, COUNT(*) OVER ()::int AS total_rows
      FROM (${rowsSql}) t
      ${where}
      ORDER BY ${order}
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    let total = Number(rows[0]?.['total_rows'] ?? 0);
    if (rows.length === 0 && q.offset > 0) {
      const [c] = (await tx.execute(
        sql`SELECT COUNT(*)::int AS n FROM (${rowsSql}) t ${where}`,
      )) as unknown as Array<{ n: number }>;
      total = Number(c?.n ?? 0);
    }

    const section = q.section;
    const items: ApprovalInboxRow[] = rows.map((r) => {
      const createdAt = r['created_at'];
      return {
        id: r['id'] as string,
        docCode: r['doc_code'] as string,
        vendorName: (r['vendor_name'] as string | null) ?? null,
        itemCode: (r['item_code'] as string | null) ?? null,
        itemName: (r['item_name'] as string | null) ?? null,
        docQty: r['doc_qty'] != null ? Number(r['doc_qty']) : null,
        docAmount: access.showMoney ? Number(r['doc_amount'] ?? 0) : null,
        createdByName: (r['created_by_name'] as string | null) ?? null,
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : new Date(String(createdAt)).toISOString(),
        navPage: `/${section === 'pr' ? 'purchase-requests' : 'purchase-orders'}/${String(r['id'])}`,
      };
    });
    return { items, total };
  });
}
