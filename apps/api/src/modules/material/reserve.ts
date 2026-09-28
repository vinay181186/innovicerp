// Assembly part reservations — ADR-193 phase 3c (spec §13 "Rules").
//
//   POST /material/sales-orders/:id/reserve   { lines:[{itemId, qty}] }
//   POST /material/sales-orders/:id/release   { itemId, qty, reason }
//
// Both need Planning entry (plan_create 'entry' — the key the SO Planning
// Allocate box uses to book stock). Reserve holds FREE stock for an assembly
// SO's BOM parts: never beyond To Issue − already Reserved, never beyond
// Available (409 names the SOs holding the rest). Items locked in id order.
// Release gives this SO's own reservation back, newest first.

import { sql } from 'drizzle-orm';
import type {
  MaterialHolder,
  ReleaseAssemblyPartsInput,
  ReserveAssemblyPartsInput,
  SoMaterial,
} from '@innovic/shared';
import { assemblyPartReservations } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { readOwnAssemblyReserved, releaseOwnReservation } from '../../lib/assembly-parts';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import {
  balanceOf,
  readBomParts,
  readBookedForOthers,
  readIssuedReturned,
  readItemInfo,
  readSoHead,
  type SoHead,
} from '../../lib/material-requirement';
import { assertQtyFitsUom, lockItemForStock, roundQty } from '../../lib/stock-ledger';
import { readStockPositions } from '../../lib/stock-reservation';
import { emitActivityLog } from '../activity-log/service';
import { getSoMaterial } from './service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** "IN-SO-00786 (4), IN-SO-00001 (2)". */
export function holdersText(holders: readonly MaterialHolder[]): string {
  return holders.map((h) => `${h.soCode} (${h.qty})`).join(', ');
}

async function readOpenAssemblySo(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<SoHead & { bomId: string }> {
  const so = await readSoHead(tx, companyId, soId);
  if (!so) throw new NotFoundError('Sales Order not found.');
  if (so.status === 'cancelled' || so.status === 'closed') {
    throw new ValidationError(`${so.code} is ${so.status} — it takes no more reservations`);
  }
  if (!so.isEquipment || !so.bomId) {
    throw new ValidationError('Reserving parts needs an Equipment SO with a BOM');
  }
  // Review F2: every unit already assembled → nothing left to reserve for
  // (a short-variance finish still shows To Issue > 0, but no unit needs it).
  const done = (await tx.execute(sql`
    SELECT COALESCE(SUM(qty), 0)::int AS q FROM public.assembly_units
    WHERE sales_order_id = ${so.id}::uuid AND status = 'completed' AND deleted_at IS NULL
  `)) as unknown as Array<{ q: number }>;
  if (so.units > 0 && Number(done[0]?.q ?? 0) >= so.units) {
    throw new ValidationError(`${so.code}: every unit is assembled — nothing left to reserve`);
  }
  return { ...so, bomId: so.bomId };
}

export async function reserveAssemblyParts(
  soId: string,
  input: ReserveAssemblyPartsInput,
  user: AuthContext,
): Promise<SoMaterial> {
  await requireFormAccess(user, 'plan_create', 'entry');
  const companyId = requireCompany(user);

  await withUserContext(user, async (tx) => {
    const so = await readOpenAssemblySo(tx, companyId, soId);
    const parts = await readBomParts(tx, companyId, so.bomId, so.units);
    const itemIds = input.lines.map((l) => l.itemId);
    const info = await readItemInfo(tx, companyId, itemIds);
    for (const l of input.lines) {
      const it = info.get(l.itemId);
      if (!it) throw new NotFoundError('A part on this reservation was not found. Pick it again.');
      if (!parts.has(l.itemId)) {
        throw new ValidationError(`${it.code} is not a BOM part of ${so.code}`);
      }
    }

    // Lock in id order (no deadlock with an issue / another reserve), THEN read.
    for (const id of [...itemIds].sort()) await lockItemForStock(tx, companyId, id);
    const got = await readIssuedReturned(tx, companyId, { salesOrderId: so.id });
    const own = await readOwnAssemblyReserved(tx, companyId, so.id);
    const pos = await readStockPositions(tx, companyId, itemIds);
    const others = await readBookedForOthers(tx, companyId, itemIds, so.id);

    const done: string[] = [];
    for (const l of input.lines) {
      const it = info.get(l.itemId)!;
      const qty = roundQty(l.qty);
      assertQtyFitsUom(it.code, it.uom ?? '', qty, 'Reserve Qty');
      const toIssue = balanceOf(parts.get(l.itemId)!.required, got.get(l.itemId));
      const needLeft = Math.max(0, roundQty(toIssue - (own.get(l.itemId) ?? 0)));
      if (qty > needLeft) {
        throw new ConflictError(`${it.code}: only ${needLeft} still needs reserving`, {
          itemCode: it.code,
          needLeftQty: needLeft,
          qty,
        });
      }
      const avail = Math.max(0, roundQty(pos.get(l.itemId)?.availableQty ?? 0));
      if (qty > avail) {
        const holders = others.get(l.itemId) ?? [];
        throw new ConflictError(
          `${it.code}: only ${avail} free` +
            (holders.length > 0 ? `; reserved for ${holdersText(holders)}` : ''),
          { holders },
        );
      }
      await tx.insert(assemblyPartReservations).values({
        companyId,
        salesOrderId: so.id,
        soCodeText: so.code,
        itemId: l.itemId,
        qty,
        createdBy: user.id,
        updatedBy: user.id,
      });
      done.push(`${it.code} × ${qty}`);
    }

    await emitActivityLog(
      tx,
      {
        action: 'RESERVE',
        entity: 'Assembly Reservation',
        detail: `${so.code} reserved ${done.join(', ')}`,
        refId: so.code,
      },
      companyId,
      user,
    );
  });
  return getSoMaterial(soId, user);
}

export async function releaseAssemblyParts(
  soId: string,
  input: ReleaseAssemblyPartsInput,
  user: AuthContext,
): Promise<SoMaterial> {
  await requireFormAccess(user, 'plan_create', 'entry');
  const companyId = requireCompany(user);
  const reason = input.reason.trim();

  await withUserContext(user, async (tx) => {
    // Any SO status: a closed / cancelled SO must still be able to let go.
    const so = await readSoHead(tx, companyId, soId);
    if (!so) throw new NotFoundError('Sales Order not found.');
    const it = await lockItemForStock(tx, companyId, input.itemId);
    const qty = roundQty(input.qty);
    await releaseOwnReservation(
      tx,
      {
        companyId,
        soId: so.id,
        itemId: input.itemId,
        userId: user.id,
        itemCode: it.code,
        soCode: so.code,
      },
      qty,
      reason,
    );
    await emitActivityLog(
      tx,
      {
        action: 'RELEASE',
        entity: 'Assembly Reservation',
        detail: `${so.code} released ${it.code} × ${qty}. Reason: ${reason}`,
        refId: so.code,
      },
      companyId,
      user,
    );
  });
  return getSoMaterial(soId, user);
}
