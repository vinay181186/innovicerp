// JW Invoice service (ADR-079).
//
// Bills the labour / processing charge for a Job Work Order line: qty x rate +
// GST (rate from the JW line, GST% from the JWSO header). NO material value —
// the customer owns the material. Guard: cannot invoice more than has been
// RETURNED to the customer minus already invoiced. Bumps
// job_work_order_lines.invoiced_qty.

import { and, desc, eq, isNull, like, sql } from 'drizzle-orm';
import type {
  CreateJwInvoiceInput,
  JwInvoice,
  ListJwInvoicesResponse,
} from '@innovic/shared';
import { clients, jobWorkOrderLines, jobWorkOrders, jwInvoices } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
const money = (n: number): string => n.toFixed(2);

async function nextInvoiceCode(tx: DbTransaction, companyId: string): Promise<string> {
  const prefix = 'IN-JWINV-';
  const rows = await tx
    .select({ code: jwInvoices.code })
    .from(jwInvoices)
    .where(and(eq(jwInvoices.companyId, companyId), like(jwInvoices.code, `${prefix}%`)));
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

function rowToInvoice(row: typeof jwInvoices.$inferSelect): JwInvoice {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    invoiceDate: dateLike(row.invoiceDate),
    jobWorkOrderId: row.jobWorkOrderId,
    jobWorkOrderLineId: row.jobWorkOrderLineId,
    jwCodeText: row.jwCodeText,
    clientId: row.clientId,
    qty: row.qty,
    rate: Number(row.rate),
    taxableAmount: Number(row.taxableAmount),
    gstPercent: Number(row.gstPercent),
    gstAmount: Number(row.gstAmount),
    totalAmount: Number(row.totalAmount),
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

export async function createJwInvoice(
  input: CreateJwInvoiceInput,
  user: AuthContext,
): Promise<JwInvoice> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    await tx.execute(
      sql`SELECT 1 FROM public.job_work_order_lines WHERE id = ${input.jobWorkOrderLineId}::uuid FOR UPDATE`,
    );
    const lineRows = await tx
      .select({
        id: jobWorkOrderLines.id,
        rate: jobWorkOrderLines.rate,
        returnedQty: jobWorkOrderLines.returnedQty,
        invoicedQty: jobWorkOrderLines.invoicedQty,
        jwId: jobWorkOrderLines.jobWorkOrderId,
      })
      .from(jobWorkOrderLines)
      .where(
        and(
          eq(jobWorkOrderLines.id, input.jobWorkOrderLineId),
          eq(jobWorkOrderLines.companyId, companyId),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .limit(1);
    const line = lineRows[0];
    if (!line) throw new NotFoundError(`Job Work Order line ${input.jobWorkOrderLineId} not found`);

    const jwRows = await tx
      .select({
        id: jobWorkOrders.id,
        code: jobWorkOrders.code,
        clientId: jobWorkOrders.clientId,
        gstPercent: jobWorkOrders.gstPercent,
      })
      .from(jobWorkOrders)
      .where(and(eq(jobWorkOrders.id, line.jwId), isNull(jobWorkOrders.deletedAt)))
      .limit(1);
    const jw = jwRows[0];
    if (!jw) throw new NotFoundError(`Job Work Order ${line.jwId} not found`);

    // GUARD — bill only what has been returned to the customer, minus already invoiced.
    const billable = line.returnedQty - line.invoicedQty;
    if (input.qty > billable) {
      throw new ConflictError(
        `Cannot invoice ${input.qty} — only ${Math.max(0, billable)} billable ` +
          `(returned ${line.returnedQty}, already invoiced ${line.invoicedQty}). ` +
          `Return the processed goods to the customer before billing.`,
      );
    }

    const rate = input.rate ?? Number(line.rate);
    if (!(rate >= 0)) throw new ValidationError('Rate must be a non-negative number');
    const gstPercent = Number(jw.gstPercent);
    const taxable = input.qty * rate;
    const gstAmount = (taxable * gstPercent) / 100;
    const total = taxable + gstAmount;

    const code = input.code ?? (await nextInvoiceCode(tx, companyId));
    const inserted = await tx
      .insert(jwInvoices)
      .values({
        companyId,
        code,
        invoiceDate: input.invoiceDate,
        jobWorkOrderId: jw.id,
        jobWorkOrderLineId: line.id,
        jwCodeText: jw.code,
        clientId: jw.clientId ?? null,
        qty: input.qty,
        rate: money(rate),
        taxableAmount: money(taxable),
        gstPercent: money(gstPercent),
        gstAmount: money(gstAmount),
        totalAmount: money(total),
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Failed to insert JW invoice');

    await tx
      .update(jobWorkOrderLines)
      .set({ invoicedQty: line.invoicedQty + input.qty, updatedAt: new Date(), updatedBy: userId })
      .where(eq(jobWorkOrderLines.id, line.id));

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'JwInvoice',
        detail: `${code} — billed ${input.qty} x ${money(rate)} + GST = ${money(total)} (${jw.code})`,
        refId: row.id,
      },
      companyId,
      user,
    );

    return rowToInvoice(row);
  });
}

export async function listJwInvoices(user: AuthContext): Promise<ListJwInvoicesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        inv: jwInvoices,
        clientName: clients.name,
        partName: jobWorkOrderLines.partName,
      })
      .from(jwInvoices)
      .leftJoin(clients, eq(clients.id, jwInvoices.clientId))
      .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jwInvoices.jobWorkOrderLineId))
      .where(and(eq(jwInvoices.companyId, companyId), isNull(jwInvoices.deletedAt)))
      .orderBy(desc(jwInvoices.invoiceDate), desc(jwInvoices.code))
      .limit(500);
    return {
      items: rows.map((r) => ({
        ...rowToInvoice(r.inv),
        clientName: r.clientName ?? null,
        partName: r.partName ?? null,
      })),
      total: rows.length,
    };
  });
}
