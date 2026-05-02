// Store Transactions service (T-036d).
//
// Read-only. store_transactions is append-only per ADR-015 #4 — rows land
// here exclusively via service-layer cascades (today: GRN QC accept in
// T-036c; future: dispatch, JW out/in, manual adjusts). No create/update/
// delete here.

import { and, count, eq, sql } from 'drizzle-orm';
import { storeTransactions } from '../../db/schema';
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

export async function listStoreTransactions(
  input: ListStoreTransactionsQuery,
  user: AuthContext,
): Promise<ListStoreTransactionsResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (st.source_ref ILIKE ${term} OR st.remarks ILIKE ${term})`
      : sql``;
    const itemFrag = input.itemId
      ? sql`AND st.item_id = ${input.itemId}::uuid`
      : sql``;
    const txnTypeFrag = input.txnType
      ? sql`AND st.txn_type = ${input.txnType}::store_txn_type`
      : sql``;
    const sourceTypeFrag = input.sourceType
      ? sql`AND st.source_type = ${input.sourceType}::store_txn_source_type`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND st.txn_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND st.txn_date <= ${input.toDate}::date` : sql``;

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
      WHERE st.company_id = ${companyId}::uuid
        ${searchFrag}
        ${itemFrag}
        ${txnTypeFrag}
        ${sourceTypeFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY st.txn_date DESC, st.created_at DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total count uses Drizzle ORM with the same filter set.
    const conditions = [eq(storeTransactions.companyId, companyId)];
    if (input.itemId) conditions.push(eq(storeTransactions.itemId, input.itemId));
    if (input.txnType) conditions.push(eq(storeTransactions.txnType, input.txnType));
    if (input.sourceType) conditions.push(eq(storeTransactions.sourceType, input.sourceType));
    const totalRows = await tx
      .select({ value: count() })
      .from(storeTransactions)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const rowsList = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
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
