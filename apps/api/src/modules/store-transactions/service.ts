// Store Transactions service (T-036d).
//
// Read-only. store_transactions is append-only per ADR-015 #4 — rows land
// here exclusively via service-layer cascades (today: GRN QC accept in
// T-036c; future: dispatch, JW out/in, manual adjusts). No create/update/
// delete here.

import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import type {
  ItemBalance,
  ListStoreTransactionsQuery,
  ListStoreTransactionsResponse,
  StoreTransaction,
  StoreTransactionListItem,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Single source of truth for the stock-ledger WHERE conditions. Pure — builds
 * SQL fragments only, touches no DB. Used by the rows query, the pagination
 * count query, and the KPI summary so all three agree on the active filter set
 * (company scope, free-text search, item/txn/source, date range). Conditions
 * reference `st` (store_transactions) and the search fragment references `i`
 * (items) — both queries that consume this LEFT JOIN public.items i.
 */
export function buildStoreTxnWhere(companyId: string, query: ListStoreTransactionsQuery): SQL[] {
  const conditions: SQL[] = [sql`st.company_id = ${companyId}::uuid`];

  if (query.search) {
    // Search matches the item too: i.code/i.name cover id-resolved rows
    // (grn_qc, dispatch, … which leave item_code_text null), st.item_code_text
    // covers free-text rows.
    const term = `%${query.search}%`;
    conditions.push(
      sql`(st.source_ref ILIKE ${term} OR st.remarks ILIKE ${term}
           OR i.code ILIKE ${term} OR i.name ILIKE ${term}
           OR st.item_code_text ILIKE ${term})`,
    );
  }
  if (query.itemId) conditions.push(sql`st.item_id = ${query.itemId}::uuid`);
  if (query.txnType) conditions.push(sql`st.txn_type = ${query.txnType}::store_txn_type`);
  if (query.sourceType) {
    conditions.push(sql`st.source_type = ${query.sourceType}::store_txn_source_type`);
  }
  if (query.fromDate) conditions.push(sql`st.txn_date >= ${query.fromDate}::date`);
  if (query.toDate) conditions.push(sql`st.txn_date <= ${query.toDate}::date`);

  return conditions;
}

export async function listStoreTransactions(
  input: ListStoreTransactionsQuery,
  user: AuthContext,
): Promise<ListStoreTransactionsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Single filter set shared by rows, count, and KPI summary so page count
    // and totals always agree with the visible rows (search + date range
    // included). Both consuming queries LEFT JOIN public.items i, which the
    // search fragment references.
    const whereClause = sql.join(buildStoreTxnWhere(companyId, input), sql` AND `);

    const result = await tx.execute(sql`
      SELECT
        st.id, st.company_id AS "companyId",
        st.txn_date AS "txnDate",
        st.item_id AS "itemId",
        st.item_code_text AS "itemCodeText",
        st.txn_type AS "txnType", st.qty,
        st.source_type AS "sourceType",
        st.source_ref AS "sourceRef",
        st.stock_before AS "stockBefore",
        st.stock_after AS "stockAfter",
        st.remarks,
        st.created_at AS "createdAt", st.created_by AS "createdBy",
        i.code AS "itemCode",
        i.name AS "itemName"
      FROM public.store_transactions st
      LEFT JOIN public.items i ON i.id = st.item_id AND i.deleted_at IS NULL
      WHERE ${whereClause}
      ORDER BY st.txn_date DESC, st.created_at DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total count over the SAME filter set (search + date range included).
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS value
      FROM public.store_transactions st
      LEFT JOIN public.items i ON i.id = st.item_id AND i.deleted_at IS NULL
      WHERE ${whereClause}
    `)) as unknown as Array<{ value: number }>;
    const total = Number(countRows[0]?.value ?? 0);

    // PL-SL-1b — KPI summary across the SAME filter set (no LIMIT).
    // Mirrors legacy renderStockLedger L25081–25084.
    const summaryRows = await tx.execute(sql`
      SELECT
        COUNT(*)::int                                                    AS txn_count,
        COALESCE(SUM(CASE WHEN st.txn_type = 'in'  THEN st.qty END), 0)::int AS total_in,
        COALESCE(SUM(CASE WHEN st.txn_type = 'out' THEN st.qty END), 0)::int AS total_out,
        COUNT(DISTINCT st.item_id)::int                                  AS item_count
      FROM public.store_transactions st
      LEFT JOIN public.items i ON i.id = st.item_id AND i.deleted_at IS NULL
      WHERE ${whereClause}
    `);
    const sumRow = (summaryRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const totalIn = Number(sumRow['total_in'] ?? 0);
    const totalOut = Number(sumRow['total_out'] ?? 0);
    const summary = {
      txnCount: Number(sumRow['txn_count'] ?? 0),
      totalIn,
      totalOut,
      net: totalIn - totalOut,
      itemCount: Number(sumRow['item_count'] ?? 0),
    };

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset, summary };
  });
}

function toListItem(r: Record<string, unknown>): StoreTransactionListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    txnDate: dateLike(r['txnDate']),
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    txnType: r['txnType'] as StoreTransaction['txnType'],
    qty: Number(r['qty'] ?? 0),
    sourceType: r['sourceType'] as StoreTransaction['sourceType'],
    sourceRef: String(r['sourceRef'] ?? ''),
    stockBefore: Number(r['stockBefore'] ?? 0),
    stockAfter: Number(r['stockAfter'] ?? 0),
    remarks: (r['remarks'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
  };
}

/** Returns the per-item current on-hand from v_item_stock. Returns 0 when
 *  the item has no ledger rows yet (the view filters them out). */
export async function getItemBalance(itemId: string, user: AuthContext): Promise<ItemBalance> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    return { itemId, onHand: Number(rows[0]?.on_hand ?? 0) };
  });
}
