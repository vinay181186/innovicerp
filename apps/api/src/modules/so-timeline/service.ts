// SO Timeline service (PL-SOTL-1).
//
// GET /so-timeline/:soId — aggregates an SO's lifecycle into a chronological
// event list. Mirrors legacy `_soTimeline(soNo)` at HTML L17679–17900+.
//
// Event sources implemented in this slice (see docs/PARITY/sotimeline.md §2):
//   1. SO Created    — from sales_orders.so_date
//   2. Plan Created  — from plans WHERE so_line_id IN (so.lines)
//   3. JC Created    — from job_cards WHERE source_so_line_id IN (so.lines)
//   4. JC Completed  — from job_cards.closed_at WHERE source_so_line_id IN (...)
//   5. PR Raised     — from purchase_requests WHERE source_so_line_id IN (...)
//   6. PO Created    — via purchase_order_lines.source_so_line_id → purchase_orders
//   7. GRN Received  — via goods_receipt_notes WHERE purchase_order_id IN (POs above)
//
// Deferred (sources not yet ported to this codebase): Design Assigned/Approved,
// BOM Linked event, Party Material Received/Returned, JW DC Outward/Inward,
// Material Issued, Op Started/Completed.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { SoTimelineEvent, SoTimelineResponse } from '@innovic/shared';
import { salesOrders, salesOrderLines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Stable colour palette matching legacy event-row colours
 *  (HTML L17688 / L17692 / L17708 / L17713 / L17745 / L17751 / L17758). */
const DEPT_COLORS = {
  sales: '#22C55E',
  design: '#8B5CF6',
  planning: '#8B5CF6',
  production: '#06B6D4',
  store: '#F59E0B',
  purchase: '#2563EB',
  dispatch: '#0D9488',
  qc: '#EF4444',
} as const;

export async function getSoTimeline(
  soId: string,
  user: AuthContext,
): Promise<SoTimelineResponse> {
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        internalSoNo: salesOrders.internalSoNo,
        customerName: salesOrders.customerName,
        type: salesOrders.type,
        soDate: salesOrders.soDate,
      })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.id, soId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales Order ${soId} not found`);

    const lineRows = await tx
      .select({ id: salesOrderLines.id })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.salesOrderId, soId),
          isNull(salesOrderLines.deletedAt),
        ),
      );
    const lineIds = lineRows.map((r) => r.id);

    const events: SoTimelineEvent[] = [];

    // 1. SO Created — always present.
    events.push({
      date: so.soDate,
      kind: 'so_created',
      icon: '📋',
      label: 'SO Created',
      detail: `${so.internalSoNo ? `${so.code} · ${so.internalSoNo}` : so.code} — ${so.customerName ?? ''}`,
      dept: 'sales',
      color: DEPT_COLORS.sales,
      flag: null,
      flagReason: null,
    });

    if (lineIds.length > 0) {
      // 2. Plans created against any of these SO lines.
      const planRows = await tx.execute(sql`
        SELECT
          p.code              AS plan_code,
          p.plan_type         AS plan_type,
          p.plan_qty          AS plan_qty,
          p.created_at        AS created_at
        FROM public.plans p
        WHERE p.company_id = ${companyId}::uuid
          AND p.deleted_at IS NULL
          AND p.so_line_id IN (${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY p.created_at ASC
      `);
      for (const row of planRows as unknown as Array<{
        plan_code: string;
        plan_type: string;
        plan_qty: number;
        created_at: Date | string;
      }>) {
        events.push({
          date: tsLike(row.created_at),
          kind: 'plan_created',
          icon: '📋',
          label: 'Plan Created',
          detail: `${row.plan_code} — ${row.plan_type} — ${row.plan_qty} pcs`,
          dept: 'planning',
          color: DEPT_COLORS.planning,
          flag: null,
          flagReason: null,
        });
      }

      // 3+4. JC Created + JC Completed.
      const jcRows = await tx.execute(sql`
        SELECT
          jc.code        AS jc_code,
          jc.jc_date     AS jc_date,
          jc.order_qty   AS order_qty,
          jc.closed_at   AS closed_at,
          i.code         AS item_code
        FROM public.job_cards jc
        LEFT JOIN public.items i ON i.id = jc.item_id AND i.deleted_at IS NULL
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          AND jc.source_so_line_id IN (${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY jc.jc_date ASC
      `);
      for (const row of jcRows as unknown as Array<{
        jc_code: string;
        jc_date: string;
        order_qty: number;
        closed_at: Date | string | null;
        item_code: string | null;
      }>) {
        events.push({
          date: row.jc_date,
          kind: 'jc_created',
          icon: '📝',
          label: 'Job Card Created',
          detail: `${row.jc_code} — ${row.item_code ?? '—'} × ${row.order_qty}`,
          dept: 'production',
          color: DEPT_COLORS.production,
          flag: null,
          flagReason: null,
        });
        if (row.closed_at !== null) {
          events.push({
            date: tsLike(row.closed_at),
            kind: 'jc_completed',
            icon: '✅',
            label: 'JC Completed',
            detail: row.jc_code,
            dept: 'production',
            color: DEPT_COLORS.sales,
            flag: null,
            flagReason: null,
          });
        }
      }

      // 5. PR Raised.
      const prRows = await tx.execute(sql`
        SELECT
          pr.code       AS pr_code,
          pr.pr_date    AS pr_date,
          pr.status     AS status,
          pr.item_code_text AS item_code,
          trim_scale(pr.qty)::float8 AS qty
        FROM public.purchase_requests pr
        WHERE pr.company_id = ${companyId}::uuid
          AND pr.deleted_at IS NULL
          AND pr.source_so_line_id IN (${sql.join(lineIds.map((id) => sql`${id}::uuid`), sql`, `)})
        ORDER BY pr.pr_date ASC
      `);
      for (const row of prRows as unknown as Array<{
        pr_code: string;
        pr_date: string;
        status: string;
        item_code: string | null;
        qty: number;
      }>) {
        events.push({
          date: row.pr_date,
          kind: 'pr_raised',
          icon: '📨',
          label: 'PR Raised',
          detail: `${row.pr_code} — ${row.item_code ?? '—'} × ${row.qty} — ${row.status}`,
          dept: 'purchase',
          color: DEPT_COLORS.purchase,
          flag: null,
          flagReason: null,
        });
      }

      // 6+7. PO Created (via PO line FK) + GRN Received.
      // ADR-320: vendor name from the vendor master (vendor_code_text only as
      // the fallback), the PO's status in the detail (a cancelled PO stays
      // listed, saying Cancelled), and a date check against the latest PR
      // behind the PO's lines (purchase_order_lines.source_pr_id). Warning only.
      const lineList = sql.join(
        lineIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const poRows = await tx.execute(sql`
        SELECT
          po.id               AS po_id,
          po.code             AS po_code,
          po.po_date::text    AS po_date,
          po.status::text     AS status,
          v.name              AS vendor_name,
          po.vendor_code_text AS vendor_code,
          pr.pr_code          AS pr_code,
          pr.pr_date          AS pr_date
        FROM public.purchase_orders po
        LEFT JOIN public.vendors v
          ON v.id = po.vendor_id AND v.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT r.code AS pr_code, r.pr_date::text AS pr_date
          FROM public.purchase_order_lines l
          JOIN public.purchase_requests r
            ON r.id = l.source_pr_id AND r.deleted_at IS NULL
          WHERE l.purchase_order_id = po.id AND l.deleted_at IS NULL
          ORDER BY r.pr_date DESC, r.code DESC
          LIMIT 1
        ) pr ON TRUE
        WHERE po.company_id = ${companyId}::uuid
          AND po.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM public.purchase_order_lines pol
            WHERE pol.purchase_order_id = po.id
              AND pol.deleted_at IS NULL
              AND pol.source_so_line_id IN (${lineList})
          )
        ORDER BY po.po_date ASC, po.code ASC
      `);
      const poById = new Map<
        string,
        { code: string; poDate: string; prCode: string | null; prDate: string | null }
      >();
      for (const row of poRows as unknown as Array<{
        po_id: string;
        po_code: string;
        po_date: string;
        status: string;
        vendor_name: string | null;
        vendor_code: string | null;
        pr_code: string | null;
        pr_date: string | null;
      }>) {
        poById.set(row.po_id, {
          code: row.po_code,
          poDate: row.po_date,
          prCode: row.pr_code,
          prDate: row.pr_date,
        });
        const vendor = blankToNull(row.vendor_name) ?? blankToNull(row.vendor_code) ?? '—';
        const prLate = row.pr_date !== null && row.po_date < row.pr_date;
        events.push({
          date: row.po_date,
          kind: 'po_created',
          icon: '💳',
          label: 'PO Created',
          detail: `${row.po_code} — ${vendor} · ${poStatusLabel(row.status)}`,
          dept: 'purchase',
          color: DEPT_COLORS.purchase,
          flag: prLate ? 'date_check' : null,
          flagReason:
            prLate && row.pr_date
              ? `PO date ${dmy(row.po_date)} is before PR ${row.pr_code ?? '—'} (${dmy(row.pr_date)})`
              : null,
        });
      }

      const poIds = [...poById.keys()];
      if (poIds.length > 0) {
        const grnRows = await tx.execute(sql`
          SELECT
            grn.code              AS grn_code,
            grn.grn_date::text    AS grn_date,
            grn.purchase_order_id AS po_id,
            grn.po_code_text      AS po_code
          FROM public.goods_receipt_notes grn
          WHERE grn.company_id = ${companyId}::uuid
            AND grn.deleted_at IS NULL
            AND grn.purchase_order_id IN (${sql.join(
              poIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
          ORDER BY grn.grn_date ASC
        `);
        for (const row of grnRows as unknown as Array<{
          grn_code: string;
          grn_date: string;
          po_id: string;
          po_code: string | null;
        }>) {
          const po = poById.get(row.po_id);
          const reasons: string[] = [];
          if (po && row.grn_date < po.poDate) {
            reasons.push(`GRN date ${dmy(row.grn_date)} is before PO ${po.code} (${dmy(po.poDate)})`);
          }
          if (po?.prDate && row.grn_date < po.prDate) {
            reasons.push(
              `GRN date ${dmy(row.grn_date)} is before PR ${po.prCode ?? '—'} (${dmy(po.prDate)})`,
            );
          }
          events.push({
            date: row.grn_date,
            kind: 'grn_received',
            icon: '📥',
            label: 'GRN Received',
            detail: `${row.grn_code} — PO ${po?.code ?? row.po_code ?? '—'}`,
            dept: 'store',
            color: DEPT_COLORS.store,
            flag: reasons.length > 0 ? 'date_check' : null,
            flagReason: reasons.length > 0 ? reasons.join('; ') : null,
          });
        }
      }
    }


    // Final sort — pure date ascending; ties broken by insertion order
    // (legacy renders in this same order: source-traversal order).
    events.sort((a, b) => a.date.localeCompare(b.date));

    return {
      generatedAt: new Date().toISOString(),
      soId: so.id,
      soCode: so.code,
      soInternalNo: so.internalSoNo,
      customerName: so.customerName,
      type: so.type,
      events,
    };
  });
}

// Screen words for PO status (same words as modules/purchase-orders and the
// web's po-labels.ts).
const PO_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  partial: 'Partly Received',
  qc_pending: 'QC Pending',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
function poStatusLabel(status: string): string {
  return (
    PO_STATUS_LABEL[status] ??
    status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function blankToNull(v: string | null | undefined): string | null {
  return v && v.trim() !== '' ? v : null;
}

/** YYYY-MM-DD → dd-mm-yyyy (owner date format). */
function dmy(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-');
  return y && m && day ? `${day}-${m}-${y}` : d;
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
