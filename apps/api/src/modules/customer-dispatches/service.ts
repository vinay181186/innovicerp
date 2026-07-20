// Customer Dispatches service (migration 0050). Dispatch of ready (produced +
// QC-accepted) qty against SO lines — the customer Dispatch Register that gates
// invoicing. Maintains sales_order_lines.dispatched_qty (increment on create,
// decrement on cancel). Mirror of legacy dispatchLog / renderDispatchRegister.

import type {
  CreateCustomerDispatchInput,
  CustomerDispatchDetail,
  CustomerDispatchLineRow,
  CustomerDispatchRegisterResponse,
  CustomerDispatchRow,
  DispatchableLine,
  DispatchableSoResponse,
  FinanceSoOption,
  ListCustomerDispatchesResponse,
} from '@innovic/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  customerDispatchLines,
  customerDispatches,
  salesOrderLines,
  salesOrders,
  storeTransactions,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

const n = (s: string | number | null): number => Number(s ?? 0) || 0;

// Move finished-goods stock on dispatch (out) / cancel (in). Inserts a
// store_transactions row; the apply_store_txn_to_balance trigger (migration
// 0020) updates item_stock_balances. Free-text lines (no itemId) skip stock.
async function moveDispatchStock(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  dir: 'out' | 'in',
  code: string,
  date: string,
  lineNo: number,
  itemId: string | null,
  qty: number,
): Promise<void> {
  if (!itemId || qty <= 0) return;
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);
  const bal = (await tx.execute(sql`
    SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
    FROM public.v_item_stock
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{ on_hand: number }>;
  const before = Number(bal[0]?.on_hand ?? 0);
  const after = dir === 'out' ? before - qty : before + qty;
  await tx.insert(storeTransactions).values({
    companyId,
    txnDate: date,
    itemId,
    txnType: dir,
    qty,
    sourceType: 'dispatch',
    sourceRef: `${code} / ln ${lineNo}${dir === 'in' ? ' (cancel)' : ''}`,
    stockBefore: before,
    stockAfter: after,
    remarks: dir === 'out' ? `Customer dispatch · ${qty} pcs` : `Dispatch cancel reversal · ${qty} pcs`,
    createdBy: userId,
  });
}

type DispatchableRow = {
  so_line_id: string;
  line_no: number;
  item_code: string | null;
  item_name: string;
  order_qty: string | number;
  dispatched_qty: string | number;
  rate: string | number;
  ready_qty: string | number;
};

// Per-SO-line readiness: final-op effective output (QC-accepted for QC/qc-required
// ops, received for completed outsource, else completed qty) summed across the
// line's JCs, minus already-dispatched.
async function loadDispatchable(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<DispatchableLine[]> {
  const cid = `'${companyId}'::uuid`;
  const sid = `'${soId}'::uuid`;
  const res = await tx.execute(
    sql.raw(`
      SELECT sol.id AS so_line_id, sol.line_no,
        COALESCE(i.code, sol.item_code_text) AS item_code,
        sol.part_name AS item_name, sol.order_qty, sol.dispatched_qty, sol.rate,
        COALESCE(rdy.ready, 0) AS ready_qty
      FROM sales_order_lines sol
      LEFT JOIN items i ON i.id = sol.item_id AND i.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(x.eff), 0) AS ready FROM (
          SELECT DISTINCT ON (jc.id)
            CASE
              WHEN vs.op_type = 'qc' OR vs.qc_required THEN vs.qc_accepted_qty
              -- Outsource final op: dispatch up to the qty that actually came
              -- back and passed Incoming QC. Derived straight from the GRN lines
              -- against this op's PO line (self-healing — works for returns QC'd
              -- before outsource_returned_qty tracking existed), so partial
              -- vendor returns are dispatchable instead of all-or-nothing.
              WHEN vs.op_type = 'outsource' THEN COALESCE((
                SELECT SUM(grl.qc_accepted_qty)
                FROM goods_receipt_note_lines grl
                WHERE grl.purchase_order_line_id = jo.outsource_po_line_id
                  AND grl.deleted_at IS NULL
              ), 0)
              ELSE vs.completed_qty
            END AS eff
          FROM job_cards jc
          JOIN v_jc_op_status vs ON vs.job_card_id = jc.id
          LEFT JOIN jc_ops jo
            ON jo.job_card_id = jc.id AND jo.op_seq = vs.op_seq AND jo.deleted_at IS NULL
          WHERE jc.source_so_line_id = sol.id AND jc.deleted_at IS NULL
          ORDER BY jc.id, vs.op_seq DESC
        ) x
      ) rdy ON TRUE
      WHERE sol.sales_order_id = ${sid} AND sol.company_id = ${cid} AND sol.deleted_at IS NULL
      ORDER BY sol.line_no
    `),
  );
  return (res as unknown as DispatchableRow[]).map((r) => {
    const ready = Math.max(0, Math.round(n(r.ready_qty)));
    const dispatched = Math.round(n(r.dispatched_qty));
    return {
      salesOrderLineId: r.so_line_id,
      lineNo: Number(r.line_no) || 0,
      itemCode: r.item_code,
      itemName: r.item_name,
      orderQty: Math.round(n(r.order_qty)),
      readyQty: ready,
      dispatchedQty: dispatched,
      availableQty: Math.max(0, ready - dispatched),
      rate: n(r.rate),
    };
  });
}

async function loadSo(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<{ id: string; code: string; customer: string | null }> {
  const rows = await tx
    .select({ id: salesOrders.id, code: salesOrders.code, customer: salesOrders.customerName })
    .from(salesOrders)
    .where(
      and(eq(salesOrders.id, soId), eq(salesOrders.companyId, companyId), isNull(salesOrders.deletedAt)),
    )
    .limit(1);
  const so = rows[0];
  if (!so) throw new NotFoundError(`Sales order ${soId} not found`);
  return so;
}

export async function listFinanceSoOptions(user: AuthContext): Promise<FinanceSoOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({ id: salesOrders.id, code: salesOrders.code, customer: salesOrders.customerName })
      .from(salesOrders)
      .where(
        and(
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
          sql`${salesOrders.status} <> 'cancelled'`,
        ),
      )
      .orderBy(desc(salesOrders.code));
    return rows.map((r) => ({ salesOrderId: r.id, soCode: r.code, customer: r.customer }));
  });
}

export async function getDispatchableSo(
  soId: string,
  user: AuthContext,
): Promise<DispatchableSoResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const so = await loadSo(tx, companyId, soId);
    const lines = await loadDispatchable(tx, companyId, soId);
    return { salesOrderId: so.id, soCode: so.code, customer: so.customer, lines };
  });
}

async function nextCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: customerDispatches.code })
    .from(customerDispatches)
    .where(eq(customerDispatches.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = Number((r.code || '').replace(/\D/g, '')) || 0;
    if (m > max) max = m;
  }
  return `DSP-${String(max + 1).padStart(4, '0')}`;
}

function rowToHeader(
  r: typeof customerDispatches.$inferSelect,
  lineCount: number,
  totalQty: number,
): CustomerDispatchRow {
  return {
    id: r.id,
    code: r.code,
    dispatchDate: r.dispatchDate,
    salesOrderId: r.salesOrderId,
    soCode: r.soCodeText,
    customer: r.customerText,
    transport: r.transport,
    vehicleNo: r.vehicleNo,
    status: r.status,
    remarks: r.remarks,
    lineCount,
    totalQty,
  };
}

export async function listDispatches(user: AuthContext): Promise<ListCustomerDispatchesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select()
      .from(customerDispatches)
      .where(and(eq(customerDispatches.companyId, companyId), isNull(customerDispatches.deletedAt)))
      .orderBy(desc(customerDispatches.dispatchDate), desc(customerDispatches.createdAt));

    const aggRows = await tx
      .select({
        id: customerDispatchLines.customerDispatchId,
        cnt: sql<number>`count(*)::int`,
        qty: sql<number>`coalesce(sum(${customerDispatchLines.qty}), 0)::int`,
      })
      .from(customerDispatchLines)
      .where(
        and(eq(customerDispatchLines.companyId, companyId), isNull(customerDispatchLines.deletedAt)),
      )
      .groupBy(customerDispatchLines.customerDispatchId);
    const agg = new Map(aggRows.map((a) => [a.id, { cnt: Number(a.cnt), qty: Number(a.qty) }]));

    return {
      dispatches: headers.map((h) => {
        const a = agg.get(h.id) ?? { cnt: 0, qty: 0 };
        return rowToHeader(h, a.cnt, a.qty);
      }),
    };
  });
}

type RegisterRow = {
  dispatch_id: string;
  dispatch_code: string;
  status: 'dispatched' | 'cancelled';
  dispatch_date: string;
  jc_no: string | null;
  so_no: string | null;
  client_po_line_no: string | null;
  item_code: string | null;
  item_name: string;
  qty: number;
  uom: string | null;
  customer: string | null;
  dispatched_by: string | null;
  remarks: string | null;
  stock_before: number | null;
  stock_after: number | null;
  current_stock: number | null;
};

// Line-grain register (legacy renderDispatchRegister grain). One row per
// dispatched line: CPO Ln + UOM from the SO line, Dispatched By = the dispatch
// creator, Stock B→A from the store_transactions row createDispatch wrote,
// JC No. derived from the JCs feeding the SO line, current stock for the
// item-wise summary panel.
export async function listDispatchRegister(
  user: AuthContext,
): Promise<CustomerDispatchRegisterResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const res = await tx.execute(sql`
      SELECT h.id AS dispatch_id, h.code AS dispatch_code, h.status,
        h.dispatch_date::text AS dispatch_date, h.so_code_text AS so_no,
        h.customer_text AS customer, h.remarks,
        l.item_code_text AS item_code, l.item_name, l.qty,
        sol.client_po_line_no, sol.uom::text AS uom,
        u.full_name AS dispatched_by,
        st.stock_before, st.stock_after,
        vis.on_hand_qty::int AS current_stock,
        jcs.jc_codes AS jc_no
      FROM customer_dispatch_lines l
      JOIN customer_dispatches h ON h.id = l.customer_dispatch_id
      LEFT JOIN sales_order_lines sol ON sol.id = l.sales_order_line_id
      LEFT JOIN public.users u ON u.id = h.created_by
      LEFT JOIN store_transactions st ON st.company_id = h.company_id
        AND st.source_type = 'dispatch' AND st.txn_type = 'out'
        AND st.source_ref = h.code || ' / ln ' || l.line_no
      LEFT JOIN v_item_stock vis
        ON vis.company_id = h.company_id AND vis.item_id = l.item_id
      LEFT JOIN LATERAL (
        SELECT string_agg(jc.code, ', ' ORDER BY jc.code) AS jc_codes
        FROM job_cards jc
        WHERE jc.source_so_line_id = l.sales_order_line_id AND jc.deleted_at IS NULL
      ) jcs ON TRUE
      WHERE h.company_id = ${companyId}::uuid
        AND h.deleted_at IS NULL AND l.deleted_at IS NULL
      ORDER BY h.dispatch_date DESC, h.created_at DESC, l.line_no
    `);
    return {
      rows: (res as unknown as RegisterRow[]).map((r) => ({
        dispatchId: r.dispatch_id,
        dispatchCode: r.dispatch_code,
        status: r.status,
        date: r.dispatch_date,
        jcNo: r.jc_no,
        soNo: r.so_no,
        clientPoLineNo: r.client_po_line_no,
        itemCode: r.item_code,
        itemName: r.item_name,
        qty: Math.round(n(r.qty)),
        uom: r.uom,
        customer: r.customer,
        dispatchedBy: r.dispatched_by,
        remarks: r.remarks,
        stockBefore: r.stock_before === null ? null : Math.round(n(r.stock_before)),
        stockAfter: r.stock_after === null ? null : Math.round(n(r.stock_after)),
        currentStock: r.current_stock === null ? null : Math.round(n(r.current_stock)),
      })),
    };
  });
}

async function getDispatchInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<CustomerDispatchDetail> {
  const rows = await tx
    .select()
    .from(customerDispatches)
    .where(
      and(
        eq(customerDispatches.id, id),
        eq(customerDispatches.companyId, companyId),
        isNull(customerDispatches.deletedAt),
      ),
    )
    .limit(1);
  const h = rows[0];
  if (!h) throw new NotFoundError(`Dispatch ${id} not found`);

  const lineRows = await tx
    .select()
    .from(customerDispatchLines)
    .where(
      and(
        eq(customerDispatchLines.customerDispatchId, id),
        isNull(customerDispatchLines.deletedAt),
      ),
    )
    .orderBy(asc(customerDispatchLines.lineNo));

  const lines: CustomerDispatchLineRow[] = lineRows.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    salesOrderLineId: l.salesOrderLineId,
    itemCode: l.itemCodeText,
    itemName: l.itemName,
    qty: l.qty,
  }));
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  return { ...rowToHeader(h, lines.length, totalQty), lines };
}

export async function getDispatch(id: string, user: AuthContext): Promise<CustomerDispatchDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => getDispatchInternal(tx, id, companyId));
}

export async function createDispatch(
  input: CreateCustomerDispatchInput,
  user: AuthContext,
): Promise<CustomerDispatchDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const so = await loadSo(tx, companyId, input.salesOrderId);
    const dispatchable = await loadDispatchable(tx, companyId, input.salesOrderId);
    const byLine = new Map(dispatchable.map((d) => [d.salesOrderLineId, d]));

    // Validate every line belongs to the SO and qty <= available.
    for (const l of input.lines) {
      const d = byLine.get(l.salesOrderLineId);
      if (!d) {
        throw new ValidationError(`Line ${l.salesOrderLineId} does not belong to SO ${so.code}`);
      }
      if (l.qty > d.availableQty) {
        throw new ConflictError(
          `${d.itemName}: only ${d.availableQty} ready to dispatch (requested ${l.qty})`,
        );
      }
    }

    const code = await nextCode(tx, companyId);
    const inserted = await tx
      .insert(customerDispatches)
      .values({
        companyId,
        code,
        dispatchDate: input.dispatchDate,
        salesOrderId: so.id,
        soCodeText: so.code,
        customerText: so.customer,
        transport: input.transport ?? null,
        vehicleNo: input.vehicleNo ?? null,
        status: 'dispatched',
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    // Resolve each SO line's item for stock movement.
    const solRows = await tx
      .select({ id: salesOrderLines.id, itemId: salesOrderLines.itemId })
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.companyId, companyId),
          inArray(salesOrderLines.id, input.lines.map((l) => l.salesOrderLineId)),
        ),
      );
    const itemIdByLine = new Map(solRows.map((r) => [r.id, r.itemId]));

    let lineNo = 0;
    for (const l of input.lines) {
      lineNo += 1;
      const d = byLine.get(l.salesOrderLineId)!;
      const itemId = itemIdByLine.get(l.salesOrderLineId) ?? null;
      await tx.insert(customerDispatchLines).values({
        companyId,
        customerDispatchId: header.id,
        lineNo,
        salesOrderLineId: l.salesOrderLineId,
        itemId,
        itemCodeText: d.itemCode,
        itemName: d.itemName,
        qty: l.qty,
        createdBy: user.id,
        updatedBy: user.id,
      });
      // Maintain cumulative dispatched qty on the SO line.
      await tx
        .update(salesOrderLines)
        .set({ dispatchedQty: sql`${salesOrderLines.dispatchedQty} + ${l.qty}`, updatedBy: user.id })
        .where(eq(salesOrderLines.id, l.salesOrderLineId));
      // Reduce on-hand stock (finished goods out).
      await moveDispatchStock(tx, companyId, user.id, 'out', code, input.dispatchDate, lineNo, itemId, l.qty);
    }

    const totalQty = input.lines.reduce((s, l) => s + l.qty, 0);
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Dispatch',
        detail: `${code} — ${so.code} (${totalQty} pcs)`,
        refId: code,
      },
      companyId,
      user,
    );

    return getDispatchInternal(tx, header.id, companyId);
  });
}

export async function cancelDispatch(
  id: string,
  user: AuthContext,
): Promise<CustomerDispatchDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(customerDispatches)
      .where(
        and(
          eq(customerDispatches.id, id),
          eq(customerDispatches.companyId, companyId),
          isNull(customerDispatches.deletedAt),
        ),
      )
      .limit(1);
    const h = rows[0];
    if (!h) throw new NotFoundError(`Dispatch ${id} not found`);
    if (h.status === 'cancelled') throw new ValidationError(`Dispatch ${h.code} is already cancelled`);

    const lineRows = await tx
      .select()
      .from(customerDispatchLines)
      .where(
        and(
          eq(customerDispatchLines.customerDispatchId, id),
          isNull(customerDispatchLines.deletedAt),
        ),
      );

    // Reverse the dispatched-qty bump + add the stock back on each line.
    for (const l of lineRows) {
      if (l.salesOrderLineId) {
        await tx
          .update(salesOrderLines)
          .set({
            dispatchedQty: sql`GREATEST(0, ${salesOrderLines.dispatchedQty} - ${l.qty})`,
            updatedBy: user.id,
          })
          .where(eq(salesOrderLines.id, l.salesOrderLineId));
      }
      await moveDispatchStock(tx, companyId, user.id, 'in', h.code, h.dispatchDate, l.lineNo, l.itemId, l.qty);
    }

    await tx
      .update(customerDispatches)
      .set({ status: 'cancelled', updatedBy: user.id, updatedAt: new Date() })
      .where(eq(customerDispatches.id, id));

    await emitActivityLog(
      tx,
      { action: 'CANCEL', entity: 'Dispatch', detail: `${h.code} cancelled`, refId: h.code },
      companyId,
      user,
    );

    return getDispatchInternal(tx, id, companyId);
  });
}
