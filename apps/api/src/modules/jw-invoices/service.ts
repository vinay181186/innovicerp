// JW Invoice service (ADR-079).
//
// Bills the labour / processing charge for a Job Work Order line: qty x rate +
// GST (rate from the JW line, GST% from the JWSO header). NO material value —
// the customer owns the material. Guard: cannot invoice more than has been
// RETURNED to the customer minus already invoiced. Bumps
// job_work_order_lines.invoiced_qty.

import { type SQL, and, asc, count, desc, eq, ilike, isNull, like, or, sql } from 'drizzle-orm';
import type {
  CancelJwInvoiceInput,
  CreateJwInvoiceInput,
  JwInvoice,
  JwInvoiceableLinesResponse,
  ListJwInvoicesQuery,
  ListJwInvoicesResponse,
} from '@innovic/shared';
import { clients, items, jobWorkOrderLines, jobWorkOrders, jwInvoices } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
import { requireWriteRole } from '../../lib/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
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
    // text column, CHECK-constrained to the two codes (migration 0148); any
    // other value is treated as "not recorded" so the print falls back to one
    // GST row instead of guessing a split.
    taxType: row.taxType === 'sgst_cgst' || row.taxType === 'igst' ? row.taxType : null,
    remarks: row.remarks,
    // R5 (ADR-194): a cancelled invoice reverses its billed qty and never prints
    // as a live tax document. The text column is CHECK-free here, so any value
    // other than 'cancelled' reads as the default 'issued'.
    status: row.status === 'cancelled' ? 'cancelled' : 'issued',
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancelledBy: row.cancelledBy,
    cancelReason: row.cancelReason,
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
  // Raising a JW invoice is Finance invoice entry — the same form key the SO
  // invoice checks, so Access Control governs both from one switch.
  await requireFormAccess(user, 'invoice_create', 'entry');
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
    if (!line) throw new NotFoundError('Selected JWSO line was not found. Please pick it again.');

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
    if (!jw) throw new NotFoundError('JWSO not found. It may have been moved to Trash.');

    // GUARD — bill only what has been returned to the customer, minus already invoiced.
    const billable = line.returnedQty - line.invoicedQty;
    if (input.qty > billable) {
      throw new ConflictError(
        `Qty (${input.qty}) cannot be more than To Invoice (${Math.max(0, billable)}) — ` +
          `Returned ${line.returnedQty}, already Invoiced ${line.invoicedQty}. ` +
          `Return the processed goods to the customer before billing.`,
      );
    }

    const rate = input.rate ?? Number(line.rate);
    if (!(rate >= 0)) throw new ValidationError('Rate cannot be less than 0.');
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
        taxType: input.taxType ?? 'sgst_cgst',
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new ValidationError('Could not save JW Invoice. Try again.');

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

// R5 (ADR-194) — cancel an issued JW invoice.
//
// A JW invoice bumped job_work_order_lines.invoiced_qty; cancelling gives that
// billed qty back so the line can be re-billed, and flags the row so it never
// prints as a live tax document. Refused when already cancelled (double-cancel
// would credit the line twice). Cancelling reverses a billed quantity, so — like
// the other job-work cancels — it takes the edit AND approve pair only L5
// Department Admin and above hold.
export async function cancelJwInvoice(
  id: string,
  input: CancelJwInvoiceInput,
  user: AuthContext,
): Promise<JwInvoice> {
  await requireFormAccess(user, 'jw_create', 'edit');
  await requireFormAccess(user, 'jw_create', 'approve');
  const companyId = requireCompany(user);
  const userId = user.id;
  const reason = input.reason.trim();
  if (!reason) throw new ValidationError('Reason is required to cancel a JW Invoice.');

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(jwInvoices)
      .where(
        and(
          eq(jwInvoices.id, id),
          eq(jwInvoices.companyId, companyId),
          isNull(jwInvoices.deletedAt),
        ),
      )
      .limit(1);
    const inv = rows[0];
    if (!inv) throw new NotFoundError('JW Invoice not found. Refresh the page.');
    if (inv.status === 'cancelled') {
      throw new ConflictError(`JW Invoice ${inv.code} is already Cancelled.`);
    }

    // Lock the JW line, then give the billed qty back (clamp at 0).
    await tx.execute(
      sql`SELECT 1 FROM public.job_work_order_lines WHERE id = ${inv.jobWorkOrderLineId}::uuid FOR UPDATE`,
    );
    await tx
      .update(jobWorkOrderLines)
      .set({
        invoicedQty: sql`GREATEST(${jobWorkOrderLines.invoicedQty} - ${inv.qty}, 0)`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(jobWorkOrderLines.id, inv.jobWorkOrderLineId));

    const updated = await tx
      .update(jwInvoices)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelReason: reason,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(jwInvoices.id, inv.id))
      .returning();
    const row = updated[0];
    if (!row) throw new ConflictError(`Could not cancel JW Invoice ${inv.code}. Try again.`);

    await emitActivityLog(
      tx,
      {
        action: 'CANCEL',
        entity: 'JwInvoice',
        detail: `${inv.code} cancelled: ${reason} — reversed ${inv.qty} billed on ${inv.jwCodeText ?? ''}`,
        refId: inv.id,
      },
      companyId,
      user,
    );

    return rowToInvoice(row);
  });
}

/**
 * The New JW Invoice form's line options for one JWSO: each line's Returned,
 * Invoiced and To Invoice (Returned − Invoiced) — the same figures and the same
 * limit createJwInvoice checks, so the form can show the limit and prefill it
 * instead of the user learning it from an error. Qty only, no money.
 */
export async function listJwInvoiceableLines(
  jobWorkOrderId: string,
  user: AuthContext,
): Promise<JwInvoiceableLinesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: jobWorkOrderLines.id,
        lineNo: jobWorkOrderLines.lineNo,
        itemCode: sql<string | null>`COALESCE(${items.code}, ${jobWorkOrderLines.itemCodeText})`,
        itemRevision: sql<string | null>`${jobWorkOrderLines.revision}::text`,
        partName: jobWorkOrderLines.partName,
        returnedQty: jobWorkOrderLines.returnedQty,
        invoicedQty: jobWorkOrderLines.invoicedQty,
      })
      .from(jobWorkOrderLines)
      .leftJoin(items, eq(items.id, jobWorkOrderLines.itemId))
      .where(
        and(
          eq(jobWorkOrderLines.jobWorkOrderId, jobWorkOrderId),
          eq(jobWorkOrderLines.companyId, companyId),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .orderBy(asc(jobWorkOrderLines.lineNo));
    return {
      lines: rows.map((r) => ({
        jobWorkOrderLineId: r.id,
        lineNo: r.lineNo,
        itemCode: r.itemCode ?? null,
        itemRevision: r.itemRevision ?? null,
        partName: r.partName ?? null,
        returnedQty: r.returnedQty,
        invoicedQty: r.invoicedQty,
        toInvoiceQty: Math.max(0, r.returnedQty - r.invoicedQty),
      })),
    };
  });
}

// Money-hiding for L1 Viewers ("Can See Price"). JW invoices ride the JW
// department's price permission (jw_create).
function hideJwInvoiceMoney<
  T extends {
    rate: number | null;
    taxableAmount: number | null;
    gstPercent: number | null;
    gstAmount: number | null;
    totalAmount: number | null;
  },
>(r: T): T {
  return {
    ...r,
    rate: null,
    taxableAmount: null,
    gstPercent: null,
    gstAmount: null,
    totalAmount: null,
  };
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the JW Invoice search box gets a wildcard pattern instead of a
 *  literal search — i.e. the search box becomes a "show everything" button.
 *  Postgres's DEFAULT LIKE/ILIKE escape character is backslash, so no explicit
 *  ESCAPE clause is needed here (and drizzle's `ilike()` builder, which this
 *  list is written with, cannot emit one) — verified against the live database.
 *  Deliberately a local copy of the clients / sales-orders helper rather than an
 *  export across modules: it is three lines, and each list must be free to
 *  change its own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listJwInvoices(
  input: ListJwInvoicesQuery,
  user: AuthContext,
): Promise<ListJwInvoicesResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'jw_create');
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(jwInvoices.companyId, companyId), isNull(jwInvoices.deletedAt)];
    if (input.search) {
      // Search covers every column the JW Invoice register
      // (apps/web/src/modules/jw-invoices/components/jw-invoice-view.tsx) shows:
      // Invoice No., Date, JWSO, Client and Part.
      // Deliberately NOT searched:
      //  - Qty — a number, so "2" would hit nearly every invoice.
      //  - EVERY money column (Rate, Taxable, GST%, GST Amt, Total). This list
      //    gates amounts behind `priceVisible` (canSeeFormPrice 'jw_create')
      //    and nulls them for a user without price rights — a searchable
      //    amount would hand that same user a way to confirm a value by typing
      //    it and seeing whether the row comes back.
      const term = `%${escapeLikeTerm(input.search)}%`;
      const s = or(
        ilike(jwInvoices.code, term),
        // `invoice_date` is a DATE column; cast so ILIKE has text to match, and
        // so the pattern matches exactly the YYYY-MM-DD the screen prints.
        sql`${jwInvoices.invoiceDate}::text ILIKE ${term}`,
        ilike(jwInvoices.jwCodeText, term),
        ilike(clients.name, term),
        ilike(jobWorkOrderLines.partName, term),
      );
      if (s) conditions.push(s);
    }
    const where = and(...conditions);

    // ONE predicate, used by both the page query and the count — a total that
    // ignored the search would break the pager the moment anyone typed.
    const [rows, totals] = await Promise.all([
      tx
        .select({
          inv: jwInvoices,
          clientName: clients.name,
          // WHAT IS BEING BILLED. The printed invoice line carried a part name
          // and nothing else; a part name is not an identity. The code comes off
          // the JWSO line this invoice bills — the live items-master code where
          // the line names an item, else the snapshot the line was typed with.
          itemCode: sql<string | null>`COALESCE(${items.code}, ${jobWorkOrderLines.itemCodeText})`,
          // The customer's drawing revision on that SAME JWSO line. Never
          // items.revision, which is about the item master, not the drawing.
          // Cast to text: the contract types it as a string.
          itemRevision: sql<string | null>`${jobWorkOrderLines.revision}::text`,
          partName: jobWorkOrderLines.partName,
          // The unit the JWSO line was booked in, for the printed UOM column.
          uom: sql<string | null>`${jobWorkOrderLines.uom}::text`,
        })
        .from(jwInvoices)
        .leftJoin(clients, eq(clients.id, jwInvoices.clientId))
        .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jwInvoices.jobWorkOrderLineId))
        // LEFT: a JWSO line may name no item (part name only), and an invoice
        // must never drop out of its own register over a missing master row.
        .leftJoin(items, and(eq(items.id, jobWorkOrderLines.itemId), isNull(items.deletedAt)))
        .where(where)
        .orderBy(desc(jwInvoices.invoiceDate), desc(jwInvoices.code))
        .limit(input.limit)
        .offset(input.offset),
      tx
        .select({ value: count() })
        .from(jwInvoices)
        .leftJoin(clients, eq(clients.id, jwInvoices.clientId))
        .leftJoin(jobWorkOrderLines, eq(jobWorkOrderLines.id, jwInvoices.jobWorkOrderLineId))
        .where(where),
    ]);

    return {
      items: rows.map((r) => {
        const item = {
          ...rowToInvoice(r.inv),
          clientName: r.clientName ?? null,
          itemCode: r.itemCode ?? null,
          itemRevision: r.itemRevision ?? null,
          // POL is a CUSTOMER PURCHASE ORDER line number, and a job-work order
          // has no sales order behind it: job_work_order_lines carries no
          // source_so_line_id and job_work_orders carries no sales_order_id.
          // There is no SO line to read, so null is the only truthful answer —
          // never the JWSO line number, which is a different number entirely.
          clientPoLineNo: null,
          partName: r.partName ?? null,
          uom: r.uom ?? null,
        };
        return showMoney ? item : hideJwInvoiceMoney(item);
      }),
      total: totals[0]?.value ?? 0,
      priceVisible: showMoney,
    };
  });
}
