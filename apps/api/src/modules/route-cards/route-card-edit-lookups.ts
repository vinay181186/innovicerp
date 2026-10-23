// Route Card edit-approval (ADR-249 Step B2) — the reads the registry entry
// (./route-card-edit-registry.ts) and the source-document write path
// (./service.ts) share: id → code lookups, the two "as the summary reads it"
// projections of an op list, and a stored op row back as an edit input.

import { and, eq, inArray } from 'drizzle-orm';
import type { CreateRouteCardOpInput } from '@innovic/shared';
import {
  items,
  machines,
  materialGrades,
  materialSizes,
  routeCardOps,
  vendors,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import type { RoutingSummaryOp } from './route-card-edit-common';

type RcOpRow = typeof routeCardOps.$inferSelect;

const uniq = (ids: ReadonlyArray<string | null | undefined>): string[] => [
  ...new Set(ids.filter((x): x is string => Boolean(x))),
];

/** id → code for the items, machines and vendors a routing names — one
 *  company-scoped query each. No deleted_at filter: a card must keep naming
 *  the item / machine / vendor it holds. */
export async function loadCodes(
  tx: DbTransaction,
  companyId: string,
  ids: {
    items: ReadonlyArray<string | null | undefined>;
    machines: ReadonlyArray<string | null | undefined>;
    vendors: ReadonlyArray<string | null | undefined>;
  },
): Promise<{
  items: Map<string, string>;
  machines: Map<string, string>;
  vendors: Map<string, string>;
}> {
  const itemIds = uniq(ids.items);
  const machineIds = uniq(ids.machines);
  const vendorIds = uniq(ids.vendors);
  const itemRows =
    itemIds.length > 0
      ? await tx
          .select({ id: items.id, code: items.code })
          .from(items)
          .where(and(eq(items.companyId, companyId), inArray(items.id, itemIds)))
      : [];
  const machineRows =
    machineIds.length > 0
      ? await tx
          .select({ id: machines.id, code: machines.code })
          .from(machines)
          .where(and(eq(machines.companyId, companyId), inArray(machines.id, machineIds)))
      : [];
  const vendorRows =
    vendorIds.length > 0
      ? await tx
          .select({ id: vendors.id, code: vendors.code })
          .from(vendors)
          .where(and(eq(vendors.companyId, companyId), inArray(vendors.id, vendorIds)))
      : [];
  return {
    items: new Map(itemRows.map((r) => [r.id, r.code])),
    machines: new Map(machineRows.map((r) => [r.id, r.code])),
    vendors: new Map(vendorRows.map((r) => [r.id, r.code])),
  };
}

export async function gradeName(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<string | null> {
  const rows = await tx
    .select({ name: materialGrades.name })
    .from(materialGrades)
    .where(and(eq(materialGrades.id, id), eq(materialGrades.companyId, companyId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

export async function sizeName(
  tx: DbTransaction,
  companyId: string,
  id: string,
): Promise<string | null> {
  const rows = await tx
    .select({ name: materialSizes.name })
    .from(materialSizes)
    .where(and(eq(materialSizes.id, id), eq(materialSizes.companyId, companyId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

/** A proposed op list (form order, op_seq = index + 1) as the summary reads it. */
export function summaryOpsFromInput(
  ops: readonly CreateRouteCardOpInput[],
  machineCodes: ReadonlyMap<string, string>,
  vendorCodes: ReadonlyMap<string, string>,
): RoutingSummaryOp[] {
  return ops.map((o, i) => ({
    opSeq: i + 1,
    operation: o.operation,
    opType: o.opType,
    machineCode: (o.machineId ? machineCodes.get(o.machineId) : null) ?? o.machineCodeText ?? null,
    ospVendorCode:
      (o.ospVendorId ? vendorCodes.get(o.ospVendorId) : null) ?? o.ospVendorCodeText ?? null,
    cycleTimeMin: o.cycleTimeMin ?? 0,
    ospLeadDays: o.ospLeadDays ?? null,
    program: o.program ?? null,
    toolNo: o.toolNo ?? null,
    toolDetails: o.toolDetails ?? null,
    remarks: o.remarks ?? null,
    qcRequired: Boolean(o.qcRequired),
  }));
}

/** Stored op rows as the summary reads them — the same machine / vendor rule
 *  as the proposed side (master code, else the typed text). */
export function summaryOpsFromRows(
  rows: readonly RcOpRow[],
  machineCodes: ReadonlyMap<string, string>,
  vendorCodes: ReadonlyMap<string, string>,
): RoutingSummaryOp[] {
  return rows.map((r) => ({
    opSeq: r.opSeq,
    operation: r.operation,
    opType: r.opType,
    machineCode: (r.machineId ? machineCodes.get(r.machineId) : null) ?? r.machineCodeText ?? null,
    ospVendorCode:
      (r.ospVendorId ? vendorCodes.get(r.ospVendorId) : null) ?? r.ospVendorCodeText ?? null,
    cycleTimeMin: r.cycleTimeMin,
    ospLeadDays: r.ospLeadDays ?? null,
    program: r.program ?? null,
    toolNo: r.toolNo ?? null,
    toolDetails: r.toolDetails ?? null,
    remarks: r.remarks ?? null,
    qcRequired: Boolean(r.qcRequired),
  }));
}

/** A stored op row back as an edit input (unapproved routing is resubmitted
 *  as it stands). */
export function opInputFromRow(r: RcOpRow): CreateRouteCardOpInput {
  return {
    machineId: r.machineId,
    machineCodeText: r.machineCodeText,
    operation: r.operation,
    opType: r.opType,
    cycleTimeMin: Number(r.cycleTimeMin),
    program: r.program,
    toolNo: r.toolNo,
    toolDetails: r.toolDetails,
    remarks: r.remarks,
    qcRequired: Boolean(r.qcRequired),
    ospVendorId: r.ospVendorId,
    ospVendorCodeText: r.ospVendorCodeText,
    ospLeadDays: r.ospLeadDays,
  };
}
