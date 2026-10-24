// ADR-235 Phase C — JWSO in the standard Cancel.
//
// A JWSO had no cancel before this. A JWSO nothing uses — no live Job Card,
// plan, Party GRN, Party Material Issue, JW Return, JW Invoice or Customer
// Material Return on its lines or header, nothing returned / invoiced, no
// customer material left in the party store against its lines — may be
// cancelled. The worker turns the header and every live line Cancelled
// (assertJwLineOpenForWork then refuses new work on it) and stamps the
// header's cancel reason / when / who. Header status is otherwise
// server-owned (recomputeJwHeaderStatus skips a cancelled header).
//
// One refusal rule — jobWorkOrderCancelBlockers — used by the preview, by the
// Cancel Request service (request + approve) and again by the worker, under
// the JWSO's lock and its lines' locks. Line usage is THE line-usage read
// (lib/jw-line-state.ts jwLineUsageRows), so the cancel and the edit / delete
// guards can never disagree. No rights check here: the Cancel Request service
// checks the jw_create ticks.

import { ActivityAction, type CancelBlocker } from '@innovic/shared';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { jobWorkOrderLines, jobWorkOrders } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { type JwLineUsageKind, jwLineUsageRows } from '../../lib/jw-line-state';
import { emitActivityLog } from '../activity-log/service';
import { blockerRefusal } from '../cancel-requests/messages';

type JwRow = typeof jobWorkOrders.$inferSelect;

const JW_STATUS_WORDS: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/** Read the JWSO header; `forUpdate` locks it (request / approve), the preview
 *  reads without a lock. null = not found in this company. */
export async function lockJobWorkOrderForCancel(
  tx: DbTransaction,
  companyId: string,
  id: string,
  forUpdate: boolean,
): Promise<JwRow | null> {
  const q = tx
    .select()
    .from(jobWorkOrders)
    .where(
      and(
        eq(jobWorkOrders.id, id),
        eq(jobWorkOrders.companyId, companyId),
        isNull(jobWorkOrders.deletedAt),
      ),
    )
    .limit(1);
  const rows = forUpdate ? await q.for('update') : await q;
  return rows[0] ?? null;
}

/** Screen name + link of each line-usage kind. Pages without a detail route
 *  link to their list, or not at all. */
const USAGE_DOC: Record<JwLineUsageKind, { label: string; href: (id: string) => string | null }> = {
  job_card: { label: 'Job Card', href: (id) => `/job-cards/${id}` },
  plan: { label: 'Plan', href: (id) => `/plans/${id}` },
  party_grn: { label: 'Party GRN', href: () => '/party-grn' },
  party_material_issue: { label: 'Party Material Issue', href: () => null },
  jw_return: { label: 'JW Return', href: () => null },
  jw_invoice: { label: 'JW Invoice', href: () => null },
  customer_material_return: {
    label: 'Customer Material Return',
    href: () => '/customer-material-returns',
  },
};

interface LineFacts {
  id: string;
  lineNo: number;
  returnedQty: number;
  invoicedQty: number;
  partyBalance: number;
}

async function readLineFacts(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<LineFacts[]> {
  const rows = (await tx.execute(sql`
    SELECT l.id, l.line_no AS "lineNo", l.returned_qty AS "returnedQty",
      l.invoiced_qty AS "invoicedQty",
      COALESCE((
        SELECT SUM(CASE WHEN s.direction = 'in' THEN s.qty ELSE -s.qty END)
        FROM public.party_stock_ledger s
        WHERE s.jw_line_id = l.id AND s.deleted_at IS NULL
      ), 0)::int AS "partyBalance"
    FROM public.job_work_order_lines l
    WHERE l.job_work_order_id = ${id}::uuid AND l.company_id = ${companyId}::uuid
      AND l.deleted_at IS NULL
    ORDER BY l.line_no
  `)) as unknown as LineFacts[];
  return rows.map((r) => ({
    id: r.id,
    lineNo: Number(r.lineNo),
    returnedQty: Number(r.returnedQty),
    invoicedQty: Number(r.invoicedQty),
    partyBalance: Number(r.partyBalance),
  }));
}

/**
 * THE JWSO cancel refusal rule. Every live document using its lines (THE
 * line-usage read) or its header (Party GRN / Party Material Issue raised
 * against the JWSO), named with a link; pieces already returned or invoiced;
 * customer material still in the party store against a line. Reads without
 * locks; the worker holds the header + lines locks when it re-runs this.
 */
export async function jobWorkOrderCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<CancelBlocker[]> {
  const jw = await lockJobWorkOrderForCancel(tx, companyId, id, false);
  if (!jw || jw.status === 'cancelled') return [];
  const out: CancelBlocker[] = [];

  const lines = await readLineFacts(tx, companyId, id);
  const lineNoById = new Map(lines.map((l) => [l.id, l.lineNo]));

  // One blocker per document, with every line it uses.
  const byDoc = new Map<string, { kind: JwLineUsageKind; label: string; lineNos: number[] }>();
  for (const u of await jwLineUsageRows(
    tx,
    lines.map((l) => l.id),
  )) {
    const key = `${u.kind}|${u.docId}`;
    const e = byDoc.get(key) ?? { kind: u.kind, label: u.label, lineNos: [] };
    const n = lineNoById.get(u.lineId);
    if (n !== undefined && !e.lineNos.includes(n)) e.lineNos.push(n);
    byDoc.set(key, e);
  }

  // Header-level customer-material documents (a Party GRN / issue may name the
  // JWSO without a line). Cancelled ones carry deleted_at (ADR-235).
  const hdrDocs = (await tx.execute(sql`
    SELECT 'party_grn' AS kind, id AS "docId", code AS label FROM public.party_grn
     WHERE company_id = ${companyId}::uuid AND job_work_order_id = ${id}::uuid
       AND deleted_at IS NULL
    UNION ALL
    SELECT 'party_material_issue', id, code FROM public.party_material_issues
     WHERE company_id = ${companyId}::uuid AND job_work_order_id = ${id}::uuid
       AND deleted_at IS NULL
  `)) as unknown as Array<{ kind: JwLineUsageKind; docId: string; label: string }>;
  for (const h of hdrDocs) {
    const key = `${h.kind}|${h.docId}`;
    if (!byDoc.has(key)) byDoc.set(key, { kind: h.kind, label: h.label, lineNos: [] });
  }

  for (const [key, d] of byDoc) {
    const docId = key.slice(key.indexOf('|') + 1);
    const meta = USAGE_DOC[d.kind];
    const lineNos = [...d.lineNos].sort((a, b) => a - b);
    out.push({
      docLabel: meta.label,
      docNo: d.label,
      href: meta.href(docId),
      reason: lineNos.length > 0 ? `uses Ln ${lineNos.join(', ')}` : 'raised against this JWSO',
    });
  }

  for (const l of lines) {
    if (l.returnedQty > 0) {
      out.push({
        docLabel: 'JWSO',
        docNo: jw.code,
        href: null,
        reason: `Ln ${l.lineNo}: ${l.returnedQty} pcs already returned to the customer`,
      });
    }
    if (l.invoicedQty > 0) {
      out.push({
        docLabel: 'JWSO',
        docNo: jw.code,
        href: null,
        reason: `Ln ${l.lineNo}: ${l.invoicedQty} pcs already invoiced`,
      });
    }
    if (l.partyBalance > 0) {
      out.push({
        docLabel: 'JWSO',
        docNo: jw.code,
        href: null,
        reason: `Ln ${l.lineNo}: ${l.partyBalance} pcs of customer material still in the party store — return it first`,
      });
    }
  }
  return out;
}

/** How many live lines the cancel turns Cancelled — for the preview. */
export async function jobWorkOrderLiveLineCount(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COUNT(*)::int AS n FROM public.job_work_order_lines
    WHERE job_work_order_id = ${id}::uuid AND company_id = ${companyId}::uuid
      AND deleted_at IS NULL
  `)) as unknown as Array<{ n: number }>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * The JWSO cancel worker, run only by an approved Cancel Request (ADR-235), in
 * the caller's transaction. Lock order: JWSO header, then its lines (id order)
 * — a Job Card / Party GRN on a line locks that line (lockJwLine), so it either
 * commits first and is named below, or waits and then sees the JWSO Cancelled.
 * Then the rule under the locks, then the writes, then the CANCEL activity row.
 */
export async function cancelJobWorkOrderTx(
  tx: DbTransaction,
  companyId: string,
  id: string,
  reason: string,
  user: AuthContext,
): Promise<void> {
  const jw = await lockJobWorkOrderForCancel(tx, companyId, id, true);
  if (!jw) throw new NotFoundError('JWSO not found. It may have been moved to Trash.');
  if (jw.status === 'cancelled') {
    throw new ConflictError(`${jw.code} is already Cancelled. Reload the page.`);
  }
  const lines = await tx
    .select({
      id: jobWorkOrderLines.id,
      returnedQty: jobWorkOrderLines.returnedQty,
      invoicedQty: jobWorkOrderLines.invoicedQty,
    })
    .from(jobWorkOrderLines)
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, id),
        eq(jobWorkOrderLines.companyId, companyId),
        isNull(jobWorkOrderLines.deletedAt),
      ),
    )
    .orderBy(asc(jobWorkOrderLines.id))
    .for('update');

  const blockers = await jobWorkOrderCancelBlockers(tx, companyId, id);
  if (blockers.length > 0) throw new ConflictError(blockerRefusal(jw.code, blockers), { blockers });
  // Belt and braces under the lock: nothing returned or invoiced.
  if (lines.some((l) => l.returnedQty !== 0 || l.invoicedQty !== 0)) {
    throw new ConflictError(`${jw.code} has pieces returned or invoiced — reload the page.`);
  }

  const trimmed = reason.trim();
  const now = new Date();
  await tx
    .update(jobWorkOrderLines)
    .set({ status: 'cancelled', updatedBy: user.id, updatedAt: now })
    .where(
      and(
        eq(jobWorkOrderLines.jobWorkOrderId, id),
        isNull(jobWorkOrderLines.deletedAt),
        ne(jobWorkOrderLines.status, 'cancelled'),
      ),
    );

  // §20.2 — conditional on the status read under the lock.
  const moved = await tx
    .update(jobWorkOrders)
    .set({
      status: 'cancelled',
      cancelReason: trimmed,
      cancelledAt: now,
      cancelledBy: user.id,
      updatedBy: user.id,
      updatedAt: now,
    })
    .where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.status, jw.status)))
    .returning({ id: jobWorkOrders.id });
  if (moved.length === 0) {
    throw new ConflictError(`${jw.code} was changed by someone else just now — reload the page.`);
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Cancel,
      entity: 'JobWorkOrder',
      entityId: jw.id,
      refId: jw.code,
      reason: trimmed,
      changes: [
        {
          field: 'status',
          label: 'JWSO Status',
          before: JW_STATUS_WORDS[jw.status] ?? jw.status,
          after: 'Cancelled',
        },
      ],
      detail: `${jw.code} cancelled — ${lines.length} line${lines.length === 1 ? '' : 's'} Cancelled. Reason: ${trimmed}`,
    },
    companyId,
    user,
  );
}
