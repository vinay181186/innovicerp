// Service POs service. Mirror of legacy renderServicePO L27504.
//
// Header + lines. Manager/admin writes; admin approves. Approve flips
// status pending → approved with approved_by/at stamp. Soft-delete on
// remove. Activity log on every state transition.

import type {
  CreateServicePoInput,
  ListServicePosQuery,
  ListServicePosResponse,
  ServicePo,
  ServicePoDetail,
  ServicePoLine,
  UpdateServicePoInput,
} from '@innovic/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { servicePoLines, servicePos, vendors } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAdminRole, requireWriteRole } from '../../lib/auth';
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

function n(s: string | number): number {
  return Number(s) || 0;
}

function toLine(r: typeof servicePoLines.$inferSelect): ServicePoLine {
  return {
    id: r.id,
    servicePoId: r.servicePoId,
    lineNo: r.lineNo,
    description: r.description,
    qty: n(r.qty),
    rate: n(r.rate),
    amount: n(r.amount),
  };
}

function toServicePo(r: typeof servicePos.$inferSelect): ServicePo {
  return {
    id: r.id,
    companyId: r.companyId,
    spoNo: r.spoNo,
    spoDate: r.spoDate,
    vendorId: r.vendorId,
    vendorCodeText: r.vendorCodeText,
    expenseHead: r.expenseHead,
    costCenter: r.costCenter,
    soRefId: r.soRefId,
    soNoText: r.soNoText,
    subtotal: n(r.subtotal),
    taxType: r.taxType,
    gstPct: n(r.gstPct),
    taxAmount: n(r.taxAmount),
    total: n(r.total),
    paymentTerms: r.paymentTerms,
    remarks: r.remarks,
    status: r.status,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function computeTotals(input: { lines: { qty: number; rate: number }[]; gstPct: number }): {
  subtotal: number;
  taxAmount: number;
  total: number;
  lineAmounts: number[];
} {
  const lineAmounts = input.lines.map((l) => l.qty * l.rate);
  const subtotal = lineAmounts.reduce((s, v) => s + v, 0);
  const taxAmount = (subtotal * input.gstPct) / 100;
  return { subtotal, taxAmount, total: subtotal + taxAmount, lineAmounts };
}

export async function listServicePos(
  input: ListServicePosQuery,
  user: AuthContext,
): Promise<ListServicePosResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conditions: SQL[] = [eq(servicePos.companyId, companyId), isNull(servicePos.deletedAt)];
    if (input.status) conditions.push(eq(servicePos.status, input.status));
    if (input.vendorId) conditions.push(eq(servicePos.vendorId, input.vendorId));
    if (input.fromDate) conditions.push(gte(servicePos.spoDate, input.fromDate));
    if (input.toDate) conditions.push(lte(servicePos.spoDate, input.toDate));
    if (input.search) {
      const s = or(
        ilike(servicePos.spoNo, `%${input.search}%`),
        ilike(servicePos.remarks, `%${input.search}%`),
        ilike(vendors.name, `%${input.search}%`),
      );
      if (s) conditions.push(s);
    }
    const where = and(...conditions);

    const [rows, totals] = await Promise.all([
      tx
        .select({
          header: servicePos,
          vendorName: vendors.name,
        })
        .from(servicePos)
        .leftJoin(vendors, eq(vendors.id, servicePos.vendorId))
        .where(where)
        .orderBy(desc(servicePos.spoDate), desc(servicePos.createdAt))
        .limit(input.limit)
        .offset(input.offset),
      tx.select({ value: count() }).from(servicePos).where(where),
    ]);

    // Line counts in one shot.
    const ids = rows.map((r) => r.header.id);
    const lineCounts: Record<string, number> = {};
    if (ids.length > 0) {
      const lc = await tx
        .select({ id: servicePoLines.servicePoId, c: count() })
        .from(servicePoLines)
        .where(inArray(servicePoLines.servicePoId, ids))
        .groupBy(servicePoLines.servicePoId);
      for (const r of lc) lineCounts[r.id] = Number(r.c);
    }

    return {
      items: rows.map((r) => ({
        ...toServicePo(r.header),
        vendorName: r.vendorName,
        lineCount: lineCounts[r.header.id] ?? 0,
      })),
      total: totals[0]?.value ?? 0,
      limit: input.limit,
      offset: input.offset,
    };
  });
}

export async function getServicePo(id: string, user: AuthContext): Promise<ServicePoDetail> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => getServicePoInternal(tx, id, companyId));
}

async function getServicePoInternal(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<ServicePoDetail> {
  const rows = await tx
    .select({ header: servicePos, vendorName: vendors.name })
    .from(servicePos)
    .leftJoin(vendors, eq(vendors.id, servicePos.vendorId))
    .where(and(eq(servicePos.id, id), eq(servicePos.companyId, companyId), isNull(servicePos.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError(`Service PO ${id} not found`);

  const lineRows = await tx
    .select()
    .from(servicePoLines)
    .where(and(eq(servicePoLines.servicePoId, id), eq(servicePoLines.companyId, companyId)))
    .orderBy(asc(servicePoLines.lineNo));

  return {
    ...toServicePo(row.header),
    vendorName: row.vendorName,
    lines: lineRows.map(toLine),
  };
}

export async function createServicePo(
  input: CreateServicePoInput,
  user: AuthContext,
): Promise<ServicePoDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Dup check on spoNo.
    const dup = await tx
      .select({ id: servicePos.id })
      .from(servicePos)
      .where(
        and(
          eq(servicePos.companyId, companyId),
          eq(servicePos.spoNo, input.spoNo),
          isNull(servicePos.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) throw new ConflictError(`SPO ${input.spoNo} already exists`);

    // Vendor must exist in this company.
    const vendor = await tx
      .select({ id: vendors.id, code: vendors.code, name: vendors.name })
      .from(vendors)
      .where(
        and(
          eq(vendors.id, input.vendorId),
          eq(vendors.companyId, companyId),
          isNull(vendors.deletedAt),
        ),
      )
      .limit(1);
    if (vendor.length === 0) throw new NotFoundError(`Vendor ${input.vendorId} not found`);

    const lineData = input.lines.map((l) => ({ qty: l.qty, rate: l.rate }));
    const { subtotal, taxAmount, total, lineAmounts } = computeTotals({
      lines: lineData,
      gstPct: input.gstPct,
    });

    const inserted = await tx
      .insert(servicePos)
      .values({
        companyId,
        spoNo: input.spoNo,
        spoDate: input.spoDate,
        vendorId: input.vendorId,
        vendorCodeText: vendor[0]!.code,
        expenseHead: input.expenseHead,
        costCenter: input.costCenter,
        soRefId: input.soRefId ?? null,
        soNoText: input.soNoText ?? null,
        subtotal: String(subtotal),
        taxType: input.taxType,
        gstPct: String(input.gstPct),
        taxAmount: String(taxAmount),
        total: String(total),
        paymentTerms: input.paymentTerms,
        remarks: input.remarks ?? null,
        status: input.status,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    if (input.lines.length > 0) {
      await tx.insert(servicePoLines).values(
        input.lines.map((l, i) => ({
          companyId,
          servicePoId: header.id,
          lineNo: i + 1,
          description: l.description,
          qty: String(l.qty),
          rate: String(l.rate),
          amount: String(lineAmounts[i] ?? 0),
          createdBy: user.id,
          updatedBy: user.id,
        })),
      );
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'Service PO',
        detail: `${header.spoNo} → ${vendor[0]!.name ?? vendor[0]!.code} ₹${total.toFixed(0)}`,
        refId: header.spoNo,
      },
      companyId,
      user,
    );

    return getServicePoInternal(tx, header.id, companyId);
  });
}

export async function updateServicePo(
  id: string,
  input: UpdateServicePoInput,
  user: AuthContext,
): Promise<ServicePoDetail> {
  requireWriteRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(servicePos)
      .where(
        and(
          eq(servicePos.id, id),
          eq(servicePos.companyId, companyId),
          isNull(servicePos.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Service PO ${id} not found`);
    const cur = existing[0]!;

    // Lock approved/completed/cancelled records from edits (legacy semantics —
    // only Draft or Pending SPOs are editable).
    if (cur.status === 'approved' || cur.status === 'completed' || cur.status === 'cancelled') {
      throw new ValidationError(`Service PO ${cur.spoNo} is ${cur.status} — not editable`);
    }

    // If lines are provided, recompute totals; otherwise keep existing.
    let totals = { subtotal: n(cur.subtotal), taxAmount: n(cur.taxAmount), total: n(cur.total) };
    let lineAmounts: number[] = [];
    const gstPct = input.gstPct ?? n(cur.gstPct);
    if (input.lines) {
      const lineData = input.lines.map((l) => ({ qty: l.qty, rate: l.rate }));
      const t = computeTotals({ lines: lineData, gstPct });
      totals = t;
      lineAmounts = t.lineAmounts;
    }

    const updates: Partial<typeof servicePos.$inferInsert> = {
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    if (input.spoDate !== undefined) updates.spoDate = input.spoDate;
    if (input.vendorId !== undefined) updates.vendorId = input.vendorId;
    if (input.expenseHead !== undefined) updates.expenseHead = input.expenseHead;
    if (input.costCenter !== undefined) updates.costCenter = input.costCenter;
    if (input.soRefId !== undefined) updates.soRefId = input.soRefId ?? null;
    if (input.soNoText !== undefined) updates.soNoText = input.soNoText ?? null;
    if (input.taxType !== undefined) updates.taxType = input.taxType;
    if (input.gstPct !== undefined) updates.gstPct = String(gstPct);
    if (input.paymentTerms !== undefined) updates.paymentTerms = input.paymentTerms;
    if (input.remarks !== undefined) updates.remarks = input.remarks ?? null;
    if (input.status !== undefined) updates.status = input.status;
    if (input.lines !== undefined) {
      updates.subtotal = String(totals.subtotal);
      updates.taxAmount = String(totals.taxAmount);
      updates.total = String(totals.total);
    }

    await tx.update(servicePos).set(updates).where(eq(servicePos.id, id));

    if (input.lines !== undefined) {
      await tx.delete(servicePoLines).where(eq(servicePoLines.servicePoId, id));
      if (input.lines.length > 0) {
        await tx.insert(servicePoLines).values(
          input.lines.map((l, i) => ({
            companyId,
            servicePoId: id,
            lineNo: i + 1,
            description: l.description,
            qty: String(l.qty),
            rate: String(l.rate),
            amount: String(lineAmounts[i] ?? 0),
            createdBy: user.id,
            updatedBy: user.id,
          })),
        );
      }
    }

    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'Service PO',
        detail: `${cur.spoNo} updated`,
        refId: cur.spoNo,
      },
      companyId,
      user,
    );

    return getServicePoInternal(tx, id, companyId);
  });
}

export async function approveServicePo(id: string, user: AuthContext): Promise<ServicePoDetail> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(servicePos)
      .where(
        and(
          eq(servicePos.id, id),
          eq(servicePos.companyId, companyId),
          isNull(servicePos.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Service PO ${id} not found`);
    const cur = existing[0]!;
    if (cur.status !== 'pending') {
      throw new ValidationError(`Service PO ${cur.spoNo} is ${cur.status}; only pending can be approved`);
    }

    await tx
      .update(servicePos)
      .set({
        status: 'approved',
        approvedBy: user.id,
        approvedAt: new Date(),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(servicePos.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'APPROVE',
        entity: 'Service PO',
        detail: `${cur.spoNo} approved — ₹${n(cur.total).toFixed(0)}`,
        refId: cur.spoNo,
      },
      companyId,
      user,
    );

    return getServicePoInternal(tx, id, companyId);
  });
}

export async function softDeleteServicePo(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: servicePos.id, spoNo: servicePos.spoNo })
      .from(servicePos)
      .where(
        and(
          eq(servicePos.id, id),
          eq(servicePos.companyId, companyId),
          isNull(servicePos.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) throw new NotFoundError(`Service PO ${id} not found`);

    await tx
      .update(servicePos)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(servicePos.id, id));

    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'Service PO',
        detail: `${existing[0]!.spoNo} deleted`,
        refId: existing[0]!.spoNo,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
