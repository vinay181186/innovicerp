// Tool Issues service (PL-TI-1).
//
// Returnable counterpart to store_issues. Same stock-cascade pattern via
// store_transactions, plus a separate "record return" flow that:
//   - splits return qty into good/damaged/consumed
//   - restores Good qty to stock (a separate store_transactions IN row)
//   - increments cumulative return counters
//   - flips return_status (issued → partial → returned)
//
// Status math: after applying a return,
//   totalReturned = returnGoodQty + returnDamagedQty + returnConsumedQty
//   if totalReturned === 0          → status = 'issued'
//   if totalReturned < qty          → status = 'partial'
//   if totalReturned === qty        → status = 'returned'
//
// Issued-qty totals never change after creation (so the constraint
// total returned <= qty is enforced).

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateToolIssueInput,
  ListToolIssuesQuery,
  ListToolIssuesResponse,
  RecordToolReturnInput,
  ToolIssue,
  ToolIssueListItem,
} from '@innovic/shared';
import { items, storeTransactions, toolIssues, toolIssueReturns } from '../../db/schema';
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

const CODE_PREFIX = 'TIS-';
const CODE_PAD = 5;

async function nextToolIssueCode(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  companyId: string,
): Promise<string> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(
      MAX(NULLIF(regexp_replace(code, '^${sql.raw(CODE_PREFIX)}', ''), '')::int),
      0
    ) + 1 AS next_num
    FROM public.tool_issues
    WHERE company_id = ${companyId}::uuid
      AND code LIKE ${`${CODE_PREFIX}%`}
      AND code ~ ${`^${CODE_PREFIX}\\d+$`}
  `)) as unknown as Array<{ next_num: number }>;
  const next = Number(rows[0]?.next_num ?? 1);
  return `${CODE_PREFIX}${String(next).padStart(CODE_PAD, '0')}`;
}

export async function getNextToolIssueCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextToolIssueCode(tx, companyId);
    return { code };
  });
}

export async function listToolIssues(
  input: ListToolIssuesQuery,
  user: AuthContext,
): Promise<ListToolIssuesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const today = new Date().toISOString().slice(0, 10);
    const searchFrag = term
      ? sql`AND (
          ti.code ILIKE ${term}
          OR ti.item_code_text ILIKE ${term}
          OR ti.item_name ILIKE ${term}
          OR ti.issued_to ILIKE ${term}
          OR ti.ref_no ILIKE ${term}
        )`
      : sql``;

    // Filter set:
    //   all      — no constraint
    //   out      — return_status != 'returned'
    //   overdue  — same as out + expected_return_date < today
    //   returned — return_status = 'returned'
    let filterFrag = sql``;
    if (input.filter === 'out') filterFrag = sql`AND ti.return_status <> 'returned'`;
    else if (input.filter === 'overdue')
      filterFrag = sql`AND ti.return_status <> 'returned'
                      AND ti.expected_return_date IS NOT NULL
                      AND ti.expected_return_date < ${today}::date`;
    else if (input.filter === 'returned')
      filterFrag = sql`AND ti.return_status = 'returned'`;

    const result = await tx.execute(sql`
      SELECT
        ti.id, ti.company_id AS "companyId", ti.code,
        ti.issue_date AS "issueDate",
        ti.expected_return_date AS "expectedReturnDate",
        ti.item_id AS "itemId",
        ti.item_code_text AS "itemCodeText",
        ti.item_name AS "itemName",
        ti.qty,
        ti.issued_to AS "issuedTo",
        ti.ref_type AS "refType",
        ti.ref_no AS "refNo",
        ti.purpose, ti.remarks,
        ti.return_status AS "returnStatus",
        ti.return_good_qty AS "returnGoodQty",
        ti.return_damaged_qty AS "returnDamagedQty",
        ti.return_consumed_qty AS "returnConsumedQty",
        ti.store_transaction_id AS "storeTransactionId",
        ti.created_at AS "createdAt", ti.created_by AS "createdBy",
        ti.updated_at AS "updatedAt", ti.updated_by AS "updatedBy",
        ti.deleted_at AS "deletedAt",
        i.code AS "itemCode",
        u.full_name AS "issuedByName",
        (
          ti.return_status <> 'returned'
          AND ti.expected_return_date IS NOT NULL
          AND ti.expected_return_date < ${today}::date
        ) AS "isOverdue"
      FROM public.tool_issues ti
      LEFT JOIN public.items i ON i.id = ti.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.users u ON u.id = ti.created_by
      WHERE ti.company_id = ${companyId}::uuid
        AND ti.deleted_at IS NULL
        ${searchFrag}
        ${filterFrag}
      ORDER BY ti.issue_date DESC, ti.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    const conditions = [eq(toolIssues.companyId, companyId), isNull(toolIssues.deletedAt)];
    const totalRows = await tx
      .select({ value: count() })
      .from(toolIssues)
      .where(and(...conditions));
    const total = totalRows[0]?.value ?? 0;

    // Summary (4 tiles) over ALL non-deleted tool_issues for this company.
    const summaryRows = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE return_status <> 'returned')::int AS out,
        COUNT(*) FILTER (WHERE return_status = 'returned')::int AS returned,
        COUNT(*) FILTER (
          WHERE return_status <> 'returned'
            AND expected_return_date IS NOT NULL
            AND expected_return_date < ${today}::date
        )::int AS overdue
      FROM public.tool_issues
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
    `);
    const sumRow = (summaryRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const summary = {
      total: Number(sumRow['total'] ?? 0),
      out: Number(sumRow['out'] ?? 0),
      returned: Number(sumRow['returned'] ?? 0),
      overdue: Number(sumRow['overdue'] ?? 0),
    };

    const itemsOut = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items: itemsOut, total, limit: input.limit, offset: input.offset, summary };
  });
}

function toListItem(r: Record<string, unknown>): ToolIssueListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    issueDate: dateLike(r['issueDate']),
    expectedReturnDate: r['expectedReturnDate'] != null ? dateLike(r['expectedReturnDate']) : null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    itemName: String(r['itemName'] ?? ''),
    qty: Number(r['qty'] ?? 0),
    issuedTo: String(r['issuedTo'] ?? ''),
    refType: (r['refType'] as string | null) ?? null,
    refNo: (r['refNo'] as string | null) ?? null,
    purpose: (r['purpose'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    returnStatus: (r['returnStatus'] as 'issued' | 'partial' | 'returned') ?? 'issued',
    returnGoodQty: Number(r['returnGoodQty'] ?? 0),
    returnDamagedQty: Number(r['returnDamagedQty'] ?? 0),
    returnConsumedQty: Number(r['returnConsumedQty'] ?? 0),
    storeTransactionId: (r['storeTransactionId'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: r['deletedAt'] != null ? tsLike(r['deletedAt']) : null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    issuedByName: (r['issuedByName'] as string | null) ?? null,
    isOverdue: Boolean(r['isOverdue']),
  };
}

export async function createToolIssue(
  input: CreateToolIssueInput,
  user: AuthContext,
): Promise<ToolIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);

    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itm.id}::uuid FOR UPDATE`);

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

    const code = await nextToolIssueCode(tx, companyId);

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
        remarks: `Tool Issue · to ${input.issuedTo} (Returnable)`,
        createdBy: userId,
      })
      .returning({ id: storeTransactions.id });
    const storeTxnId = stRows[0]?.id ?? null;

    const inserted = await tx
      .insert(toolIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        expectedReturnDate: input.expectedReturnDate,
        itemId: itm.id,
        itemCodeText: itm.code,
        itemName: itm.name,
        qty: input.qty,
        issuedTo: input.issuedTo,
        refType: input.refType ?? null,
        refNo: input.refNo ?? null,
        purpose: input.purpose ?? null,
        remarks: input.remarks ?? null,
        returnStatus: 'issued',
        storeTransactionId: storeTxnId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert tool issue');

    return rowToToolIssue(row);
  });
}

export async function recordToolReturn(
  toolIssueId: string,
  input: RecordToolReturnInput,
  user: AuthContext,
): Promise<ToolIssue> {
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) Load + lock the tool_issue + its item.
    const tiRows = await tx
      .select()
      .from(toolIssues)
      .where(
        and(
          eq(toolIssues.id, toolIssueId),
          eq(toolIssues.companyId, companyId),
          isNull(toolIssues.deletedAt),
        ),
      )
      .limit(1);
    const ti = tiRows[0];
    if (!ti) throw new NotFoundError(`Tool issue ${toolIssueId} not found`);
    if (ti.returnStatus === 'returned') {
      throw new ConflictError(`Tool issue ${ti.code} is already fully returned`);
    }

    await tx.execute(
      sql`SELECT 1 FROM public.tool_issues WHERE id = ${ti.id}::uuid FOR UPDATE`,
    );
    if (ti.itemId) {
      await tx.execute(
        sql`SELECT 1 FROM public.items WHERE id = ${ti.itemId}::uuid FOR UPDATE`,
      );
    }

    // 2) Validate the return doesn't overshoot the issued qty.
    const totalThisReturn = input.goodQty + input.damagedQty + input.consumedQty;
    const alreadyReturned = ti.returnGoodQty + ti.returnDamagedQty + ti.returnConsumedQty;
    if (alreadyReturned + totalThisReturn > ti.qty) {
      const remaining = ti.qty - alreadyReturned;
      throw new ConflictError(
        `Return overshoots issued qty. Issued ${ti.qty}, already returned ${alreadyReturned}, remaining ${remaining}, this return ${totalThisReturn}.`,
      );
    }

    // 3) For Good qty, emit a store_transactions IN row that restores stock.
    let stockTxnId: string | null = null;
    if (input.goodQty > 0 && ti.itemId) {
      const balRows = (await tx.execute(sql`
        SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
        FROM public.v_item_stock
        WHERE company_id = ${companyId}::uuid AND item_id = ${ti.itemId}::uuid
      `)) as unknown as Array<{ on_hand: number }>;
      const stockBefore = Number(balRows[0]?.on_hand ?? 0);
      const stockAfter = stockBefore + input.goodQty;
      const stRows = await tx
        .insert(storeTransactions)
        .values({
          companyId,
          txnDate: input.returnDate,
          itemId: ti.itemId,
          itemCodeText: ti.itemCodeText,
          txnType: 'in',
          qty: input.goodQty,
          sourceType: 'other',
          sourceRef: `${ti.code} · ${ti.itemCodeText ?? ''}`,
          stockBefore,
          stockAfter,
          remarks: `Tool Return · ${input.goodQty} good${input.damagedQty > 0 ? ` · ${input.damagedQty} damaged` : ''}${input.consumedQty > 0 ? ` · ${input.consumedQty} consumed` : ''}`,
          createdBy: userId,
        })
        .returning({ id: storeTransactions.id });
      stockTxnId = stRows[0]?.id ?? null;
    }

    // 4) Insert the return event.
    await tx.insert(toolIssueReturns).values({
      companyId,
      toolIssueId: ti.id,
      returnDate: input.returnDate,
      returnedBy: input.returnedBy ?? ti.issuedTo,
      goodQty: input.goodQty,
      damagedQty: input.damagedQty,
      consumedQty: input.consumedQty,
      remarks: input.remarks ?? null,
      storeTransactionId: stockTxnId,
      createdBy: userId,
      updatedBy: userId,
    });

    // 5) Update cumulative counters + status on the issue header.
    const newGood = ti.returnGoodQty + input.goodQty;
    const newDmg = ti.returnDamagedQty + input.damagedQty;
    const newCons = ti.returnConsumedQty + input.consumedQty;
    const newTotal = newGood + newDmg + newCons;
    const newStatus: 'issued' | 'partial' | 'returned' =
      newTotal === 0 ? 'issued' : newTotal >= ti.qty ? 'returned' : 'partial';

    const updated = await tx
      .update(toolIssues)
      .set({
        returnGoodQty: newGood,
        returnDamagedQty: newDmg,
        returnConsumedQty: newCons,
        returnStatus: newStatus,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(toolIssues.id, ti.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ValidationError('Failed to update tool issue after return');

    return rowToToolIssue(row);
  });
}

function rowToToolIssue(row: typeof toolIssues.$inferSelect): ToolIssue {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    issueDate: dateLike(row.issueDate),
    expectedReturnDate: row.expectedReturnDate ? dateLike(row.expectedReturnDate) : null,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemName: row.itemName,
    qty: row.qty,
    issuedTo: row.issuedTo,
    refType: row.refType,
    refNo: row.refNo,
    purpose: row.purpose,
    remarks: row.remarks,
    returnStatus: row.returnStatus as 'issued' | 'partial' | 'returned',
    returnGoodQty: row.returnGoodQty,
    returnDamagedQty: row.returnDamagedQty,
    returnConsumedQty: row.returnConsumedQty,
    storeTransactionId: row.storeTransactionId,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
  };
}
