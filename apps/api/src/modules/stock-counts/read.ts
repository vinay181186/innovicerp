// Stock Count reads (ADR-193 phase 2): list, one count with its lines, and the
// Excel code → item resolver. Writes live in service.ts.

import type {
  ListStockCountsQuery,
  ListStockCountsResponse,
  ResolveStockCountItemsInput,
  ResolveStockCountItemsResponse,
  StockCount,
  StockCountLine,
} from '@innovic/shared';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { items, stockCountLines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { roundQty } from '../../lib/stock-ledger';
import { readStockPositions } from '../../lib/stock-reservation';

const FORM = 'stockcount_create' as const;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

const ts = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v);
const d = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

// ─── Reads ─────────────────────────────────────────────────────────────────

async function assertCanView(user: AuthContext): Promise<void> {
  await requireAnyFormAccess(user, [[FORM, 'view'], ...STORE_VIEW_FORMS]);
}

function headerOut(r: Record<string, unknown>): StockCount {
  return {
    id: String(r['id']),
    code: String(r['code']),
    countDate: d(r['countDate']),
    purpose: r['purpose'] as StockCount['purpose'],
    status: r['status'] as StockCount['status'],
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: ts(r['createdAt'])!,
    createdBy: String(r['createdBy']),
    createdByName: (r['createdByName'] as string | null) ?? null,
    submittedAt: ts(r['submittedAt']),
    approvedAt: ts(r['approvedAt']),
    approvedByName: (r['approvedByName'] as string | null) ?? null,
    approvalReason: (r['approvalReason'] as string | null) ?? null,
    cancelledAt: ts(r['cancelledAt']),
    cancelReason: (r['cancelReason'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    blockedApproverIds: ((r['blockedApproverIds'] as string[] | null) ?? []).filter(Boolean),
  };
}

const HEADER_SELECT = sql`
  sc.id, sc.code, sc.count_date AS "countDate", sc.purpose, sc.status, sc.remarks,
  sc.created_at AS "createdAt", sc.created_by AS "createdBy", cu.full_name AS "createdByName",
  sc.submitted_at AS "submittedAt", sc.approved_at AS "approvedAt", au.full_name AS "approvedByName",
  sc.approval_reason AS "approvalReason", sc.cancelled_at AS "cancelledAt", sc.cancel_reason AS "cancelReason",
  (SELECT COUNT(*)::int FROM public.stock_count_lines l WHERE l.stock_count_id = sc.id AND l.deleted_at IS NULL) AS "lineCount",
  ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[sc.created_by, sc.submitted_by]
        || ARRAY(SELECT l2.created_by FROM public.stock_count_lines l2 WHERE l2.stock_count_id = sc.id)) x
        WHERE x IS NOT NULL)::text[] AS "blockedApproverIds"`;

export async function listStockCounts(
  q: ListStockCountsQuery,
  user: AuthContext,
): Promise<ListStockCountsResponse> {
  await assertCanView(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = q.search ? `%${q.search}%` : null;
    const where = sql`sc.company_id = ${companyId}::uuid AND sc.deleted_at IS NULL
      ${q.status ? sql`AND sc.status = ${q.status}` : sql``}
      ${term ? sql`AND (sc.code ILIKE ${term} OR sc.remarks ILIKE ${term})` : sql``}`;
    const rows = (await tx.execute(sql`
      SELECT ${HEADER_SELECT}
      FROM public.stock_counts sc
      LEFT JOIN public.users cu ON cu.id = sc.created_by
      LEFT JOIN public.users au ON au.id = sc.approved_by
      WHERE ${where}
      ORDER BY sc.count_date DESC, sc.code DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const tot = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n FROM public.stock_counts sc WHERE ${where}
    `)) as unknown as Array<{ n: number }>;
    return {
      items: rows.map(headerOut),
      total: Number(tot[0]?.n ?? 0),
      limit: q.limit,
      offset: q.offset,
    };
  });
}

export async function getStockCount(id: string, user: AuthContext): Promise<StockCount> {
  await assertCanView(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${HEADER_SELECT}
      FROM public.stock_counts sc
      LEFT JOIN public.users cu ON cu.id = sc.created_by
      LEFT JOIN public.users au ON au.id = sc.approved_by
      WHERE sc.id = ${id}::uuid AND sc.company_id = ${companyId}::uuid AND sc.deleted_at IS NULL
    `)) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) throw new NotFoundError('Stock Count not found.');
    const header = headerOut(rows[0]);
    const ls = await tx
      .select({
        id: stockCountLines.id,
        lineNo: stockCountLines.lineNo,
        itemId: stockCountLines.itemId,
        itemCodeText: stockCountLines.itemCodeText,
        countedQty: stockCountLines.countedQty,
        systemQtyAtCount: stockCountLines.systemQtyAtCount,
        reason: stockCountLines.reason,
        storeTransactionId: stockCountLines.storeTransactionId,
        itemCode: items.code,
        itemName: items.name,
        uom: items.uom,
      })
      .from(stockCountLines)
      .leftJoin(items, eq(items.id, stockCountLines.itemId))
      .where(and(eq(stockCountLines.stockCountId, id), isNull(stockCountLines.deletedAt)))
      .orderBy(asc(stockCountLines.lineNo));
    const pos = await readStockPositions(
      tx,
      companyId,
      ls.map((l) => l.itemId),
    );
    const lines: StockCountLine[] = ls.map((l) => {
      const now = roundQty(pos.get(l.itemId)?.physicalQty ?? 0);
      const base = l.systemQtyAtCount ?? now;
      return {
        id: l.id,
        lineNo: l.lineNo,
        itemId: l.itemId,
        itemCode: l.itemCode ?? l.itemCodeText,
        itemName: l.itemName ?? null,
        uom: l.uom ? String(l.uom) : null,
        countedQty: l.countedQty,
        systemQtyAtCount: l.systemQtyAtCount,
        systemQtyNow: now,
        difference: roundQty(l.countedQty - base),
        reason: l.reason,
        storeTransactionId: l.storeTransactionId,
      };
    });
    return { ...header, lines };
  });
}

/** Excel upload: item codes → items, plus the codes that are not in the
 *  Item Master (listed back to the user, never guessed — paper test C11). */
export async function resolveStockCountItems(
  input: ResolveStockCountItemsInput,
  user: AuthContext,
): Promise<ResolveStockCountItemsResponse> {
  await requireFormAccess(user, FORM, 'entry');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const codes = [...new Set(input.codes.map((c) => c.trim()))];
    const rows = await tx
      .select({ id: items.id, code: items.code, name: items.name, uom: items.uom })
      .from(items)
      .where(
        and(inArray(items.code, codes), eq(items.companyId, companyId), isNull(items.deletedAt)),
      );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    return {
      found: codes
        .filter((c) => byCode.has(c))
        .map((c) => {
          const r = byCode.get(c)!;
          return { code: r.code, itemId: r.id, name: r.name, uom: String(r.uom) };
        }),
      missing: codes.filter((c) => !byCode.has(c)),
    };
  });
}
