// Store Issues service (PL-II-1).
//
// Daily-use consumable register. Mirrors legacy renderIssueRegister + addIssue
// (HTML L23874 / L23914). Numbering: ISS-NNNNN, generated server-side via
// MAX(code) + 1 inside the same tx for atomicity.
//
// Write cascades into store_transactions (`txn_type='out'`,
// `source_type='other'`, source_ref=`<code> · <itemCode>`). The
// item_stock_balances trigger auto-updates per-item on-hand.
//
// Validation:
//   - qty > 0 (DB CHECK enforces this too)
//   - item exists, not soft-deleted
//   - qty <= current on-hand (from v_item_stock)

import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateStoreIssueInput,
  ListStoreIssuesQuery,
  ListStoreIssuesResponse,
  StoreIssue,
  StoreIssueListItem,
} from '@innovic/shared';
import { items, storeIssues, storeTransactions } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

const CODE_PREFIX = 'ISS-';
const CODE_PAD = 5;

async function nextStoreIssueCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  // MAX of trailing digit suffix on existing codes for this company. Lives
  // inside the same tx as the insert so concurrent inserts cant collide
  // (followed by the uniqueIndex CHECK as a backstop).
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.store_issues
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function listStoreIssues(
  input: ListStoreIssuesQuery,
  user: AuthContext,
): Promise<ListStoreIssuesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (
          si.code ILIKE ${term}
          OR si.item_code_text ILIKE ${term}
          OR si.item_name ILIKE ${term}
          OR si.issued_to ILIKE ${term}
          OR si.ref_no ILIKE ${term}
        )`
      : sql``;
    const itemFrag = input.itemId ? sql`AND si.item_id = ${input.itemId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND si.issue_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND si.issue_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        si.id, si.company_id AS "companyId", si.code,
        si.issue_date AS "issueDate",
        si.item_id AS "itemId",
        si.item_code_text AS "itemCodeText",
        si.item_name AS "itemName",
        si.qty,
        si.issued_to AS "issuedTo",
        si.ref_type AS "refType",
        si.ref_no AS "refNo",
        si.purpose,
        si.remarks,
        si.store_transaction_id AS "storeTransactionId",
        si.created_at AS "createdAt", si.created_by AS "createdBy",
        si.updated_at AS "updatedAt", si.updated_by AS "updatedBy",
        si.deleted_at AS "deletedAt",
        i.code AS "itemCode",
        u.full_name AS "issuedByName"
      FROM public.store_issues si
      LEFT JOIN public.items i ON i.id = si.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.users u ON u.id = si.created_by
      WHERE si.company_id = ${companyId}::uuid
        AND si.deleted_at IS NULL
        ${searchFrag}
        ${itemFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY si.issue_date DESC, si.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(storeIssues.companyId, companyId), isNull(storeIssues.deletedAt)];
    if (input.itemId) conditions.push(eq(storeIssues.itemId, input.itemId));
    const totalRows = await tx
      .select({ value: count() })
      .from(storeIssues)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): StoreIssueListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    issueDate: dateLike(r['issueDate']),
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    itemName: String(r['itemName'] ?? ''),
    qty: Number(r['qty'] ?? 0),
    issuedTo: String(r['issuedTo'] ?? ''),
    refType: (r['refType'] as string | null) ?? null,
    refNo: (r['refNo'] as string | null) ?? null,
    purpose: (r['purpose'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    storeTransactionId: (r['storeTransactionId'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    issuedByName: (r['issuedByName'] as string | null) ?? null,
  };
}

export async function createStoreIssue(
  input: CreateStoreIssueInput,
  user: AuthContext,
): Promise<StoreIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) Load + lock the item row.
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);

    // 2) Lock the items row for the duration of the tx so concurrent
    //    issues cant double-spend stock.
    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itm.id}::uuid FOR UPDATE`);

    // 3) Read current on-hand and validate qty.
    const balRows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${itm.id}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const stockBefore = Number(balRows[0]?.on_hand ?? 0);
    if (input.qty > stockBefore) {
      throw new ConflictError(
        `Insufficient stock for ${itm.code}: available ${stockBefore}, requested ${input.qty}`,
      );
    }
    const stockAfter = stockBefore - input.qty;

    // 4) Allocate the next code.
    const code = await nextStoreIssueCode(tx, companyId);

    // 5) Emit the store_transactions row first (so we can FK it back to
    //    store_issues.store_transaction_id).
    const stRows = await tx
      .insert(storeTransactions)
      .values({
        companyId,
        txnDate: input.issueDate,
        itemId: itm.id,
        itemCodeText: itm.code,
        txnType: 'out',
        qty: input.qty,
        sourceType: 'other',
        sourceRef: `${code} · ${itm.code}`,
        stockBefore,
        stockAfter,
        remarks: `Item Issue · to ${input.issuedTo}${input.purpose ? ` · ${input.purpose}` : ''}`,
        createdBy: userId,
      })
      .returning({ id: storeTransactions.id });
    const storeTxnId = stRows[0]?.id ?? null;

    // 6) Insert the store_issue.
    const inserted = await tx
      .insert(storeIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        itemId: itm.id,
        itemCodeText: itm.code,
        itemName: itm.name,
        qty: input.qty,
        issuedTo: input.issuedTo,
        refType: input.refType ?? null,
        refNo: input.refNo ?? null,
        purpose: input.purpose ?? null,
        remarks: input.remarks ?? null,
        storeTransactionId: storeTxnId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert store issue');

    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      issueDate: dateLike(row.issueDate),
      itemId: row.itemId,
      itemCodeText: row.itemCodeText,
      itemName: row.itemName,
      qty: row.qty,
      issuedTo: row.issuedTo,
      refType: row.refType,
      refNo: row.refNo,
      purpose: row.purpose,
      remarks: row.remarks,
      storeTransactionId: row.storeTransactionId,
      createdAt: tsLike(row.createdAt),
      createdBy: row.createdBy,
      updatedAt: tsLike(row.updatedAt),
      updatedBy: row.updatedBy,
      deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
    };
  });
}

void asc;
void desc;
