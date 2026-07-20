// Invoices service (migration 0050). Full tax-invoice + payment tracking.
// Create is gated on dispatched − invoiced qty per SO line. Mirror of legacy
// renderInvoices / _createInvoice / _addPayment.

import type {
  AddPaymentInput,
  CreateInvoiceInput,
  DocumentTraceability,
  InvoiceDetail,
  InvoiceLineRow,
  InvoicePaymentRow,
  InvoiceRow,
  InvoiceableLine,
  InvoiceableSoResponse,
  ListInvoicesResponse,
} from '@innovic/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  clients,
  invoiceLines,
  invoicePayments,
  invoices,
  salesOrders,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(status: string, dueDate: string | null): boolean {
  return status !== 'paid' && !!dueDate && dueDate < todayStr();
}

function rowToInvoice(r: typeof invoices.$inferSelect): InvoiceRow {
  const grandTotal = n(r.grandTotal);
  const totalPaid = n(r.totalPaid);
  return {
    id: r.id,
    code: r.code,
    invoiceDate: r.invoiceDate,
    salesOrderId: r.salesOrderId,
    soCode: r.soCodeText,
    clientName: r.clientNameText,
    subtotal: n(r.subtotal),
    gstPercent: n(r.gstPercent),
    gstAmount: n(r.gstAmount),
    grandTotal,
    totalPaid,
    balance: grandTotal - totalPaid,
    status: r.status,
    dueDate: r.dueDate,
    overdue: isOverdue(r.status, r.dueDate),
  };
}

export async function listInvoices(user: AuthContext): Promise<ListInvoicesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), isNull(invoices.deletedAt)))
      .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt));
    const list = rows.map(rowToInvoice);

    const summary = {
      totalInvoiced: 0,
      totalReceived: 0,
      outstanding: 0,
      overdueAmount: 0,
      overdueCount: 0,
      unpaidCount: 0,
      partialCount: 0,
      paidCount: 0,
    };
    for (const inv of list) {
      summary.totalInvoiced += inv.grandTotal;
      summary.totalReceived += inv.totalPaid;
      if (inv.overdue) {
        summary.overdueAmount += inv.balance;
        summary.overdueCount += 1;
      }
      if (inv.status === 'unpaid') summary.unpaidCount += 1;
      else if (inv.status === 'partial') summary.partialCount += 1;
      else if (inv.status === 'paid') summary.paidCount += 1;
    }
    summary.outstanding = summary.totalInvoiced - summary.totalReceived;

    return { invoices: list, summary };
  });
}

async function getInvoiceInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<InvoiceDetail> {
  const rows = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId), isNull(invoices.deletedAt)))
    .limit(1);
  const inv = rows[0];
  if (!inv) throw new NotFoundError(`Invoice ${id} not found`);

  const lineRows = await tx
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.invoiceId, id), isNull(invoiceLines.deletedAt)))
    .orderBy(asc(invoiceLines.lineNo));
  const lines: InvoiceLineRow[] = lineRows.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    itemCode: l.itemCodeText,
    itemName: l.itemName,
    qty: l.qty,
    rate: n(l.rate),
    lineAmount: n(l.lineAmount),
  }));

  const payRows = await tx
    .select()
    .from(invoicePayments)
    .where(and(eq(invoicePayments.invoiceId, id), isNull(invoicePayments.deletedAt)))
    .orderBy(asc(invoicePayments.paymentDate));
  const payments: InvoicePaymentRow[] = payRows.map((p) => ({
    id: p.id,
    paymentDate: p.paymentDate,
    amount: n(p.amount),
    mode: p.mode,
    refNo: p.refNo,
    notes: p.notes,
  }));

  return {
    ...rowToInvoice(inv),
    clientCode: inv.clientCodeText,
    clientGst: inv.clientGstText,
    paymentTermsDays: inv.paymentTermsDays,
    remarks: inv.remarks,
    lines,
    payments,
  };
}

export async function getInvoice(id: string, user: AuthContext): Promise<InvoiceDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => getInvoiceInternal(tx, id, companyId));
}

/**
 * Read-only document-traceability for an invoice. An invoice is a leaf document
 * (nothing is generated FROM it), so downstream is always empty. Upstream links:
 *   - invoices.sales_order_id → sales_orders (the SO the invoice bills against)
 *   - invoices.client_id      → clients (the billed customer) [MASTER]
 * Both FKs are nullable; a null FK omits that row. Company-scoped + soft-delete
 * filtered inside a single withUserContext tx (RLS company isolation applied).
 */
export async function getInvoiceRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select({
        id: invoices.id,
        code: invoices.code,
        invoiceDate: invoices.invoiceDate,
        status: invoices.status,
        salesOrderId: invoices.salesOrderId,
        clientId: invoices.clientId,
      })
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, companyId), isNull(invoices.deletedAt)))
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Invoice ${id} not found`);

    // ── Upstream: sales order this invoice bills against ────────────────────
    const soRows = header.salesOrderId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrders)
          .where(
            and(
              eq(salesOrders.id, header.salesOrderId),
              eq(salesOrders.companyId, companyId),
              isNull(salesOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const so = soRows[0] ?? null;

    // ── Upstream: billed client (master) ────────────────────────────────────
    const clientRows = header.clientId
      ? await tx
          .select({ id: clients.id, code: clients.code, name: clients.name })
          .from(clients)
          .where(
            and(
              eq(clients.id, header.clientId),
              eq(clients.companyId, companyId),
              isNull(clients.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const client = clientRows[0] ?? null;

    const soSection = section(
      'sales-order',
      'Sales Order',
      '📄',
      'sales-order',
      so
        ? [{ id: so.id, code: so.code, status: so.status, date: toIsoDate(so.date), linkId: null, label: null }]
        : [],
    );
    const clientSection = section(
      'client',
      'Client',
      '👤',
      'client',
      client
        ? [{ id: client.id, code: client.code, status: null, date: null, linkId: null, label: client.name }]
        : [],
    );

    const upstream = [soSection, clientSection];
    const downstream: DocumentTraceability['downstream'] = [];
    return {
      self: { module: 'invoices', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.invoiceDate),
          label: 'Invoice created',
          code: header.code,
          routeKind: 'invoice',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

type InvLineRow = {
  so_line_id: string;
  line_no: number;
  item_code: string | null;
  item_name: string;
  order_qty: string | number;
  dispatched_qty: string | number;
  rate: string | number;
  invoiced_qty: string | number;
};

async function loadInvoiceableLines(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<InvoiceableLine[]> {
  const cid = `'${companyId}'::uuid`;
  const sid = `'${soId}'::uuid`;
  const res = await tx.execute(
    sql.raw(`
        SELECT sol.id AS so_line_id, sol.line_no,
          COALESCE(i.code, sol.item_code_text) AS item_code,
          sol.part_name AS item_name, sol.order_qty, sol.dispatched_qty, sol.rate,
          COALESCE((
            SELECT SUM(il.qty) FROM invoice_lines il
            JOIN invoices inv ON inv.id = il.invoice_id
            WHERE il.sales_order_line_id = sol.id AND inv.deleted_at IS NULL AND il.deleted_at IS NULL
          ), 0) AS invoiced_qty
        FROM sales_order_lines sol
        LEFT JOIN items i ON i.id = sol.item_id AND i.deleted_at IS NULL
        WHERE sol.sales_order_id = ${sid} AND sol.company_id = ${cid} AND sol.deleted_at IS NULL
        ORDER BY sol.line_no
      `),
  );
  return (res as unknown as InvLineRow[]).map((r) => {
    const dispatched = Math.round(n(r.dispatched_qty));
    const invoiced = Math.round(n(r.invoiced_qty));
    return {
      salesOrderLineId: r.so_line_id,
      lineNo: Number(r.line_no) || 0,
      itemCode: r.item_code,
      itemName: r.item_name,
      orderQty: Math.round(n(r.order_qty)),
      dispatchedQty: dispatched,
      invoicedQty: invoiced,
      availableQty: Math.max(0, dispatched - invoiced),
      rate: n(r.rate),
    };
  });
}

export async function getInvoiceableSo(
  soId: string,
  user: AuthContext,
): Promise<InvoiceableSoResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        customer: salesOrders.customerName,
        clientGst: clients.gstNumber,
      })
      .from(salesOrders)
      .leftJoin(clients, eq(clients.id, salesOrders.clientId))
      .where(
        and(eq(salesOrders.id, soId), eq(salesOrders.companyId, companyId), isNull(salesOrders.deletedAt)),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${soId} not found`);
    const lines = await loadInvoiceableLines(tx, companyId, soId);
    return {
      salesOrderId: so.id,
      soCode: so.code,
      customer: so.customer,
      clientGst: so.clientGst ?? null,
      lines,
    };
  });
}

async function nextInvoiceCode(tx: DbTransaction, companyId: string): Promise<string> {
  const rows = await tx
    .select({ code: invoices.code })
    .from(invoices)
    .where(eq(invoices.companyId, companyId));
  let max = 0;
  for (const r of rows) {
    const m = Number((r.code || '').replace(/\D/g, '')) || 0;
    if (m > max) max = m;
  }
  return `INV-${String(max + 1).padStart(4, '0')}`;
}

export async function createInvoice(
  input: CreateInvoiceInput,
  user: AuthContext,
): Promise<InvoiceDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const soRows = await tx
      .select({
        id: salesOrders.id,
        code: salesOrders.code,
        customer: salesOrders.customerName,
        clientId: salesOrders.clientId,
        clientCode: clients.code,
        clientName: clients.name,
        clientGst: clients.gstNumber,
      })
      .from(salesOrders)
      .leftJoin(clients, eq(clients.id, salesOrders.clientId))
      .where(
        and(
          eq(salesOrders.id, input.salesOrderId),
          eq(salesOrders.companyId, companyId),
          isNull(salesOrders.deletedAt),
        ),
      )
      .limit(1);
    const so = soRows[0];
    if (!so) throw new NotFoundError(`Sales order ${input.salesOrderId} not found`);

    // Validate qty <= available (dispatched − invoiced) per line, in-tx.
    const availLines = await loadInvoiceableLines(tx, companyId, input.salesOrderId);
    const byLine = new Map(availLines.map((l) => [l.salesOrderLineId, l]));
    for (const l of input.lines) {
      const a = byLine.get(l.salesOrderLineId);
      if (!a) throw new ValidationError(`Line ${l.salesOrderLineId} does not belong to SO ${so.code}`);
      if (l.qty > a.availableQty) {
        throw new ConflictError(
          `${a.itemName}: only ${a.availableQty} available to invoice (dispatched − invoiced); requested ${l.qty}`,
        );
      }
    }

    const lineAmounts = input.lines.map((l) => l.qty * l.rate);
    const subtotal = lineAmounts.reduce((s, v) => s + v, 0);
    const gstAmount = Math.round((subtotal * input.gstPercent) / 100 * 100) / 100;
    const grand = subtotal + gstAmount;

    const due = new Date(input.invoiceDate);
    due.setDate(due.getDate() + input.paymentTermsDays);
    const dueDate = due.toISOString().slice(0, 10);

    const code = await nextInvoiceCode(tx, companyId);
    const inserted = await tx
      .insert(invoices)
      .values({
        companyId,
        code,
        invoiceDate: input.invoiceDate,
        salesOrderId: so.id,
        soCodeText: so.code,
        clientId: so.clientId ?? null,
        clientNameText: so.clientName ?? so.customer,
        clientCodeText: so.clientCode ?? null,
        clientGstText: so.clientGst ?? null,
        subtotal: String(subtotal),
        gstPercent: String(input.gstPercent),
        gstAmount: String(gstAmount),
        grandTotal: String(grand),
        totalPaid: '0',
        paymentTermsDays: input.paymentTermsDays,
        dueDate,
        status: 'unpaid',
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    let lineNo = 1;
    for (let i = 0; i < input.lines.length; i++) {
      const l = input.lines[i]!;
      const a = byLine.get(l.salesOrderLineId)!;
      await tx.insert(invoiceLines).values({
        companyId,
        invoiceId: header.id,
        lineNo: lineNo++,
        itemId: null,
        itemCodeText: a.itemCode,
        itemName: a.itemName,
        qty: l.qty,
        rate: String(l.rate),
        lineAmount: String(lineAmounts[i] ?? 0),
        salesOrderLineId: l.salesOrderLineId,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Invoice',
        detail: `${code} — ${so.code} ₹${grand.toFixed(0)}`,
        refId: code,
      },
      companyId,
      user,
    );

    return getInvoiceInternal(tx, header.id, companyId);
  });
}

export async function addPayment(
  invoiceId: string,
  input: AddPaymentInput,
  user: AuthContext,
): Promise<InvoiceDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(invoices)
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.companyId, companyId), isNull(invoices.deletedAt)),
      )
      .limit(1);
    const inv = rows[0];
    if (!inv) throw new NotFoundError(`Invoice ${invoiceId} not found`);

    const grand = n(inv.grandTotal);
    const paid = n(inv.totalPaid);
    const balance = grand - paid;
    if (input.amount > balance + 0.01) {
      throw new ConflictError(`Amount ₹${input.amount} exceeds balance ₹${balance.toFixed(2)}`);
    }

    await tx.insert(invoicePayments).values({
      companyId,
      invoiceId,
      paymentDate: input.paymentDate,
      amount: String(input.amount),
      mode: input.mode,
      refNo: input.refNo ?? null,
      notes: input.notes ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    });

    const newPaid = paid + input.amount;
    const newStatus = newPaid >= grand - 0.01 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
    await tx
      .update(invoices)
      .set({ totalPaid: String(newPaid), status: newStatus, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));

    await emitActivityLog(
      tx,
      {
        action: 'PAYMENT',
        entity: 'Invoice',
        detail: `${inv.code} — ₹${input.amount.toFixed(0)} via ${input.mode}`,
        refId: inv.code,
      },
      companyId,
      user,
    );

    return getInvoiceInternal(tx, invoiceId, companyId);
  });
}
