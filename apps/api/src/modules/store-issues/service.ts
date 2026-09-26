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

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateStoreIssueInput,
  ListStoreIssuesQuery,
  ListStoreIssuesResponse,
  ReverseStoreIssueInput,
  StoreIssue,
  StoreIssueListItem,
} from '@innovic/shared';
import { STORE_ISSUE_REVERSE_REASON_MIN } from '@innovic/shared';
import { emitActivityLog } from '../activity-log/service';
import { items, storeIssues, storeTransactions } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { readStockPositionLocked } from '../../lib/stock-reservation';
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

export async function getNextStoreIssueCode(user: AuthContext): Promise<{ code: string }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const code = await nextStoreIssueCode(tx, companyId);
    return { code };
  });
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
        si.reversed_at AS "reversedAt", si.reversed_by AS "reversedBy",
        si.reversal_reason AS "reversalReason",
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

    // The pager total counts under the SAME filters as the page (it used to
    // ignore search and dates, so the pager overstated a filtered list).
    const totalRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.store_issues si
      WHERE si.company_id = ${companyId}::uuid
        AND si.deleted_at IS NULL
        ${searchFrag}
        ${itemFrag}
        ${fromFrag}
        ${toFrag}
    `)) as unknown as Array<{ total: number }>;
    const total = Number(totalRows[0]?.total ?? 0);

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
    reversedAt: r['reversedAt'] != null ? tsLike(r['reversedAt']) : null,
    reversedBy: (r['reversedBy'] as string | null) ?? null,
    reversalReason: (r['reversalReason'] as string | null) ?? null,
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
  // This endpoint had NO permission check at all — only the company-id check
  // below — so any logged-in account could post a stock issue and deduct
  // on-hand. Issuing material is `entry`, so L2 Data Entry and above may; an
  // L1 Viewer and an L4 Approver may not.
  await requireFormAccess(user, 'issue_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    // 1) Load + lock the item row.
    const itemRows = await tx
      .select({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1);
    const itm = itemRows[0];
    if (!itm)
      throw new NotFoundError('Selected Item was not found. Please select the Item Code again.');

    // 1b) ADR-185 — material issued against a Job Card or a Production Order is
    //     linked to it for real (job_card_id / production_order_id), so the
    //     card and the order can account for their raw material. A reference
    //     that names no such document is refused before any stock moves.
    let jobCardId: string | null = null;
    let productionOrderId: string | null = null;
    const refNo = input.refNo?.trim() ?? '';
    if (refNo && (input.refType === 'Job Card' || input.refType === 'Production')) {
      // The type the storekeeper picked is looked up first, so a code that
      // were ever shared by a card and an order links the one they meant.
      const preferJc = input.refType === 'Job Card';
      const refRows = (await tx.execute(sql`
        SELECT jc_id, po_id FROM (
          SELECT jc.id AS jc_id, jc.production_order_id AS po_id, 1 AS kind
          FROM public.job_cards jc
          WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL AND jc.code = ${refNo}
          UNION ALL
          SELECT po.job_card_id, po.id, 2
          FROM public.production_orders po
          WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL AND po.code = ${refNo}
        ) r
        ORDER BY CASE WHEN r.kind = ${preferJc ? 1 : 2} THEN 0 ELSE 1 END
        LIMIT 1
      `)) as unknown as Array<{ jc_id: string | null; po_id: string | null }>;
      const ref = refRows[0];
      if (!ref) {
        throw new ValidationError(
          input.refType === 'Job Card'
            ? `Job Card ${refNo} was not found. Type the JC No. exactly as printed on the card.`
            : `No Job Card or Production Order is numbered ${refNo}. Type the number exactly as printed.`,
        );
      }
      jobCardId = ref?.jc_id ?? null;
      productionOrderId = ref?.po_id ?? null;
    }

    // 2) Lock the item row and read PHYSICAL / RESERVED / AVAILABLE inside
    //    the lock (lib/stock-reservation), so two issues cannot double-spend.
    // 3) ADR-189 — an issue may take only AVAILABLE stock: pieces booked for a
    //    sales order line are on the shelf but already promised. The ledger
    //    before / after figures stay PHYSICAL (what the shelf holds).
    const pos = await readStockPositionLocked(tx, companyId, itm.id);
    const stockBefore = pos.physicalQty;
    if (input.qty > pos.availableQty) {
      throw new ConflictError(
        pos.reservedQty > 0
          ? `Item ${itm.code}: Qty (${input.qty}) cannot be more than Available (${pos.availableQty}) — In Stock ${pos.physicalQty}, of which ${pos.reservedQty} is booked for sales orders.`
          : `Item ${itm.code}: Qty (${input.qty}) cannot be more than In Stock (${stockBefore}).`,
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
        jobCardId,
        productionOrderId,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Could not save Item Issue. Try again.');

    await emitActivityLog(
      tx,
      {
        action: 'ISSUE',
        entity: 'Store Issue',
        detail: `${code} · ${itm.code} × ${input.qty} to ${input.issuedTo} — ${input.purpose} (stock ${stockBefore} → ${stockAfter})`,
        refId: code,
      },
      companyId,
      user,
    );

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
      reversedAt: null,
      reversedBy: null,
      reversalReason: null,
      createdAt: tsLike(row.createdAt),
      createdBy: row.createdBy,
      updatedAt: tsLike(row.updatedAt),
      updatedBy: row.updatedBy,
      deletedAt: row.deletedAt != null ? tsLike(row.deletedAt) : null,
    };
  });
}

/**
 * ADR-189 — undo an issue by an OPPOSITE ledger entry ('in' of the same qty),
 * never by editing or deleting the 'out' it made (ledger rows are immutable).
 * The issue stays on the register, stamped who / when / why. Once only.
 */
export async function reverseStoreIssue(
  id: string,
  input: ReverseStoreIssueInput,
  user: AuthContext,
): Promise<StoreIssueListItem> {
  // Undoing a saved issue changes a stored stock figure → `edit`, as Adjust.
  await requireFormAccess(user, 'issue_create', 'edit');
  const companyId = requireCompany(user);
  const reason = input.reason.trim();
  if (reason.length < STORE_ISSUE_REVERSE_REASON_MIN) {
    throw new ValidationError(
      `Give a reason for the reversal (at least ${STORE_ISSUE_REVERSE_REASON_MIN} characters).`,
    );
  }
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select()
      .from(storeIssues)
      .where(
        and(
          eq(storeIssues.id, id),
          eq(storeIssues.companyId, companyId),
          isNull(storeIssues.deletedAt),
        ),
      )
      .for('update')
      .limit(1);
    const iss = found[0];
    if (!iss) throw new NotFoundError('Item Issue not found.');
    if (iss.reversedAt) {
      throw new ConflictError(`${iss.code} is already reversed.`);
    }
    const live = iss.itemId
      ? await tx
          .select({ id: items.id })
          .from(items)
          .where(and(eq(items.id, iss.itemId), isNull(items.deletedAt)))
          .limit(1)
      : [];
    if (!iss.itemId || !live[0]) {
      throw new ConflictError(
        `${iss.code}: its item is no longer in the Item Master, so the stock cannot be put back.`,
      );
    }

    const pos = await readStockPositionLocked(tx, companyId, iss.itemId);
    const stockBefore = pos.physicalQty;
    const stockAfter = stockBefore + iss.qty;
    const itemCode = iss.itemCodeText ?? '';
    const st = await tx
      .insert(storeTransactions)
      .values({
        companyId,
        txnDate: new Date().toISOString().slice(0, 10),
        itemId: iss.itemId,
        itemCodeText: iss.itemCodeText,
        txnType: 'in',
        qty: iss.qty,
        sourceType: 'other',
        sourceRef: `${iss.code} reversal · ${itemCode}`,
        stockBefore,
        stockAfter,
        remarks: `Item Issue reversed · ${reason}`,
        createdBy: user.id,
      })
      .returning({ id: storeTransactions.id });

    const now = new Date();
    await tx
      .update(storeIssues)
      .set({
        reversedAt: now,
        reversedBy: user.id,
        reversalReason: reason,
        reversalStoreTransactionId: st[0]?.id ?? null,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(storeIssues.id, iss.id));

    await emitActivityLog(
      tx,
      {
        action: 'REVERSE',
        entity: 'Store Issue',
        detail: `${iss.code} · ${itemCode} × ${iss.qty} put back (stock ${stockBefore} → ${stockAfter}). Reason: ${reason}`,
        refId: iss.code,
      },
      companyId,
      user,
    );

    const rows = (await tx.execute(sql`
      SELECT
        si.id, si.company_id AS "companyId", si.code,
        si.issue_date AS "issueDate", si.item_id AS "itemId",
        si.item_code_text AS "itemCodeText", si.item_name AS "itemName",
        si.qty, si.issued_to AS "issuedTo", si.ref_type AS "refType",
        si.ref_no AS "refNo", si.purpose, si.remarks,
        si.store_transaction_id AS "storeTransactionId",
        si.reversed_at AS "reversedAt", si.reversed_by AS "reversedBy",
        si.reversal_reason AS "reversalReason",
        si.created_at AS "createdAt", si.created_by AS "createdBy",
        si.updated_at AS "updatedAt", si.updated_by AS "updatedBy",
        si.deleted_at AS "deletedAt",
        i.code AS "itemCode", u.full_name AS "issuedByName"
      FROM public.store_issues si
      LEFT JOIN public.items i ON i.id = si.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.users u ON u.id = si.created_by
      WHERE si.id = ${iss.id}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return toListItem(rows[0]!);
  });
}

void asc;
void desc;
