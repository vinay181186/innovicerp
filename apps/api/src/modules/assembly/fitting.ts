// Assembly Complete — check and FIT the parts (ADR-193 phase 3c, spec §13).
//
// The parts of an assembly SO leave the store when they are ISSUED against the
// SO. Complete (Mark Assembled / Stop) moves no component stock: it checks the
// parts are on the bench (Still Out) and records them as Fitted into the unit
// (assembly_unit_consumptions).
//
//   need      = Qty per Set × qty completed
//   Still Out = Issued − Returned − Fitted, for the SO (lib/assembly-parts.ts)
//   not last  Still Out < need on any part → 409 { short[] }            (M6)
//   last      Fitted = ALL Still Out; a part with Still Out ≠ need needs
//             confirmVarianceReason → else 409 { needsConfirmation,
//             variance[] } (M7). Still Out 0 is always short (P28).
//             Then the SO's leftover reservations are released (M14).
//
// Callers lock the SO row first (lockSoRow, M15), so two Completes on one SO
// serialise and the second re-reads Still Out after the first committed.

import type { AssemblyShortPart, AssemblyVariancePart } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { assemblyUnitConsumptions } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import {
  lockSoRow,
  NO_PARTS_OUT,
  type PartsOut,
  readPartsOutMany,
  releaseAllForSo,
} from '../../lib/assembly-parts';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { readBomParts, readItemInfo } from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stop: lock the SO of an assembly batch (M15) before the batch is read. */
export async function lockSoOfUnit(
  tx: DbTransaction,
  companyId: string,
  unitId: string,
): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT sales_order_id FROM public.assembly_units
    WHERE id = ${unitId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ sales_order_id: string }>;
  const soId = rows[0]?.sales_order_id;
  if (!soId) throw new NotFoundError('Assembly unit not found. Refresh the page.');
  await lockSoRow(tx, companyId, soId);
}

/** The BOM's parts per set, when the id is a live BOM of this company. */
export async function readLiveBomPerSet(
  tx: DbTransaction,
  companyId: string,
  bomMasterId: string | null,
): Promise<Array<{ itemId: string; qtyPerSet: number }>> {
  if (!bomMasterId || !UUID_RE.test(bomMasterId)) return [];
  const live = (await tx.execute(sql`
    SELECT id FROM public.bom_masters
    WHERE id = ${bomMasterId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ id: string }>;
  if (live.length === 0) return [];
  const parts = await readBomParts(tx, companyId, bomMasterId, 1);
  return [...parts.values()]
    .filter((p) => p.qtyPerSet > 0)
    .map((p) => ({ itemId: p.itemId, qtyPerSet: p.qtyPerSet }));
}

export interface FitArgs {
  companyId: string;
  soId: string;
  bomMasterId: string | null;
  /** The completed assembly_units row the parts go into. */
  unitId: string;
  qty: number;
  /** Assembled after this completion ≥ units the order needs. */
  isLast: boolean;
  confirmVarianceReason?: string | undefined;
  userId: string;
}

export interface FitResult {
  fitted: Array<{ itemCode: string; qty: number }>;
  /** "P1 need 6, fitted 5.5" per part that differed (last units only). */
  variance: string[];
  releasedQty: number;
}

/** Throws before anything is written, so a refused Complete leaves no trace. */
export async function checkParts(
  tx: DbTransaction,
  a: Omit<FitArgs, 'unitId' | 'userId'>,
): Promise<Array<{ itemId: string; itemCode: string; need: number; stillOut: number }>> {
  const perSet = await readLiveBomPerSet(tx, a.companyId, a.bomMasterId);
  if (perSet.length === 0) return []; // no BOM → nothing to fit
  const info = await readItemInfo(
    tx,
    a.companyId,
    perSet.map((p) => p.itemId),
  );
  const out =
    (await readPartsOutMany(tx, a.companyId, [a.soId])).get(a.soId) ?? new Map<string, PartsOut>();
  const rows = perSet.map((p) => ({
    itemId: p.itemId,
    itemCode: info.get(p.itemId)?.code ?? '—',
    need: roundQty(p.qtyPerSet * a.qty),
    stillOut: (out.get(p.itemId) ?? NO_PARTS_OUT).stillOut,
  }));

  const short: AssemblyShortPart[] = rows
    .filter((r) => r.stillOut <= 0 || (!a.isLast && r.stillOut < r.need))
    .map((r) => ({ itemCode: r.itemCode, needQty: r.need, stillOutQty: r.stillOut }));
  if (short.length > 0) {
    const what = short
      .map((s) => `${s.itemCode} needs ${s.needQty}, still out ${s.stillOutQty}`)
      .join('; ');
    throw new ConflictError(`Issue the parts from the store first: ${what}`, { short });
  }

  if (a.isLast && !a.confirmVarianceReason?.trim()) {
    const variance: AssemblyVariancePart[] = rows
      .filter((r) => r.stillOut !== r.need)
      .map((r) => ({ itemCode: r.itemCode, needQty: r.need, stillOutQty: r.stillOut }));
    if (variance.length > 0) {
      const what = variance
        .map((v) => `${v.itemCode}: need ${v.needQty}, still out ${v.stillOutQty}`)
        .join('; ');
      throw new ConflictError(
        `Last unit: parts out differ from the BOM (${what}) — confirm with a reason`,
        { needsConfirmation: true, variance },
      );
    }
  }
  return rows;
}

/**
 * Check, then write the consumption rows for the completed unit. Last units
 * fit everything still out and release the SO's leftover reservations.
 */
export async function fitParts(tx: DbTransaction, a: FitArgs): Promise<FitResult> {
  const rows = await checkParts(tx, a);
  const reason = a.confirmVarianceReason?.trim() || null;
  const fitted: FitResult['fitted'] = [];
  const variance: string[] = [];
  for (const r of rows) {
    const qty = a.isLast ? r.stillOut : r.need;
    if (!(qty > 0)) continue;
    const differs = a.isLast && qty !== r.need;
    if (differs) variance.push(`${r.itemCode} need ${r.need}, fitted ${qty}`);
    await tx.insert(assemblyUnitConsumptions).values({
      companyId: a.companyId,
      assemblyUnitId: a.unitId,
      salesOrderId: a.soId,
      itemId: r.itemId,
      qty,
      varianceReason: differs ? reason : null,
      createdBy: a.userId,
      updatedBy: a.userId,
    });
    fitted.push({ itemCode: r.itemCode, qty });
  }
  const releasedQty = a.isLast
    ? await releaseAllForSo(tx, a.companyId, a.soId, 'SO fully assembled', a.userId)
    : 0;
  return { fitted, variance, releasedQty };
}

/** Summary for the activity log line. */
export function fitSummary(r: FitResult, reason: string | undefined): string {
  let s =
    r.fitted.length > 0
      ? ` · fitted ${r.fitted.map((f) => `${f.itemCode} × ${f.qty}`).join(', ')}`
      : '';
  if (r.variance.length > 0)
    s += ` · differs from BOM (${r.variance.join('; ')}), reason: ${reason?.trim() ?? ''}`;
  if (r.releasedQty > 0) s += ` · ${r.releasedQty} reserved left over released`;
  return s;
}

/** Undo: the unit's parts are Still Out again (on the bench — Return them if
 *  not reused). Soft-delete, never a hard delete. */
export async function unfitUnit(
  tx: DbTransaction,
  companyId: string,
  unitId: string,
  userId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    UPDATE public.assembly_unit_consumptions
    SET deleted_at = now(), updated_at = now(), updated_by = ${userId}::uuid
    WHERE company_id = ${companyId}::uuid AND assembly_unit_id = ${unitId}::uuid
      AND deleted_at IS NULL
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  return rows.length;
}
