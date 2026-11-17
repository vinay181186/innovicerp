// ADR-307 — Customer Material Return (IN-CMR) against an EQUIPMENT SO, for
// customer-supplied BOM parts. The JWSO path (service.ts) is unchanged; the
// service dispatches here when the input / header names a sales_order_id.
//
//   good     — spare pieces still in the SO's customer store. Cap = the part's
//              figures.inStoreQty (lib/party-so-parts.ts, THE figures — it
//              already counts live, issued good CMR lines of the SO), duplicates
//              summed; the ledger writer also caps at the register's stock.
//   rejected — deviated pieces held on the SO's Party GRN lines; the same
//              conditional UPDATE of rejected_returned_qty (cap in the WHERE,
//              ADR-247 NC hold-back) and NC rebalance as the JWSO path.
// Lock order (§20.3): SO row (lockOpenEquipmentSo) → party material (advisory
// lock in ensurePartyMaterial, then the row in postPartyStockMove) → Party GRN
// line. Lines store jw_line_id NULL and party_material_id = the register row.

import { sql } from 'drizzle-orm';
import type {
  CreateCustomerMaterialReturnInput,
  CustomerMaterialReturnDetail,
  CustomerMaterialReturnableRow,
} from '@innovic/shared';
import { ActivityAction } from '@innovic/shared';
import { customerMaterialReturnLines, customerMaterialReturns } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { lockOpenEquipmentSo } from '../../lib/assembly-parts';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { ensurePartyMaterial } from '../../lib/jw-rm';
import { readSoCustomerParts } from '../../lib/party-so-parts';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import {
  HELD_RETURNABLE_SQL,
  loadDetail,
  ncHeldBackQtySql,
  nextReturnCode,
  rebalanceReturnToCustomerNcs,
} from './service';

const FOR_WHAT = 'return customer material';

/** The live Equipment SO (no lock — read path). */
async function readEquipmentSo(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<{ id: string; code: string; clientId: string | null }> {
  const rows = (await tx.execute(sql`
    SELECT id, code, client_id AS "clientId", type::text AS type
      FROM public.sales_orders
     WHERE id = ${soId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ id: string; code: string; clientId: string | null; type: string }>;
  const so = rows[0];
  if (!so) throw new NotFoundError('Selected Sales Order was not found. Please select it again.');
  if (so.type !== 'equipment') {
    throw new ConflictError(`${so.code} is not an Equipment SO — cannot ${FOR_WHAT}.`);
  }
  return so;
}

/** What can still go back to the customer on one Equipment SO. */
export async function listSoCustomerMaterialReturnable(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<CustomerMaterialReturnableRow[]> {
  const so = await readEquipmentSo(tx, companyId, soId);
  const out: CustomerMaterialReturnableRow[] = [];

  const parts = Array.from((await readSoCustomerParts(tx, companyId, so.id)).values()).filter(
    (p) => p.figures.inStoreQty > 0,
  );
  if (parts.length > 0 && so.clientId) {
    const ids = sql.param(parts.map((p) => p.rmItemId));
    const pmRows = (await tx.execute(sql`
      SELECT id, code, item_id AS "itemId", stock_qty::int AS "stockQty"
        FROM public.party_materials
       WHERE company_id = ${companyId}::uuid AND client_id = ${so.clientId}::uuid
         AND item_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string; code: string; itemId: string; stockQty: number }>;
    const pmByItem = new Map(pmRows.map((r) => [r.itemId, r]));
    for (const p of parts) {
      const pm = pmByItem.get(p.rmItemId);
      if (!pm) continue;
      const returnable = Math.min(p.figures.inStoreQty, Number(pm.stockQty));
      if (returnable <= 0) continue;
      out.push({
        kind: 'good',
        jwLineId: null,
        jwLineNo: null,
        rmItemId: p.rmItemId,
        clientPoLineNo: null,
        partCode: null,
        partyMaterialId: pm.id,
        partyMaterialCode: pm.code,
        rmItemCode: p.rmItemCode,
        partyGrnLineId: null,
        partyGrnCode: null,
        returnableQty: returnable,
      });
    }
  }

  // Deviated pieces on the SO's QC'd Party GRN lines, less NC hold-back (ADR-247).
  const rejRows = (await tx.execute(sql`
    SELECT pgl.id AS "partyGrnLineId", pg.code AS "partyGrnCode",
           pm.id AS "partyMaterialId", pm.code AS "partyMaterialCode",
           pm.item_id AS "rmItemId",
           COALESCE(ri.code, pm.item_code_text) AS "rmItemCode",
           ${HELD_RETURNABLE_SQL}::int AS held
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
      JOIN public.party_materials pm ON pm.id = pgl.party_material_id
      LEFT JOIN public.items ri ON ri.id = pm.item_id
     WHERE pg.sales_order_id = ${so.id}::uuid
       AND pgl.company_id = ${companyId}::uuid
       AND pgl.deleted_at IS NULL
       AND pgl.qc_at IS NOT NULL
       AND ${HELD_RETURNABLE_SQL} > 0
     ORDER BY pg.code, pgl.line_no
  `)) as unknown as Array<{
    partyGrnLineId: string;
    partyGrnCode: string;
    partyMaterialId: string;
    partyMaterialCode: string;
    rmItemId: string | null;
    rmItemCode: string | null;
    held: number;
  }>;
  for (const r of rejRows) {
    out.push({
      kind: 'rejected',
      jwLineId: null,
      jwLineNo: null,
      rmItemId: r.rmItemId ?? null,
      clientPoLineNo: null,
      partCode: null,
      partyMaterialId: r.partyMaterialId,
      partyMaterialCode: r.partyMaterialCode,
      rmItemCode: r.rmItemCode ?? null,
      partyGrnLineId: r.partyGrnLineId,
      partyGrnCode: r.partyGrnCode,
      returnableQty: Number(r.held),
    });
  }
  return out;
}

/** Create an IN-CMR against an Equipment SO, in the caller's transaction. */
export async function createSoCustomerMaterialReturnTx(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  input: CreateCustomerMaterialReturnInput,
  user: AuthContext,
): Promise<CustomerMaterialReturnDetail> {
  const userId = user.id;
  // §20.3: the SO row lock FIRST — every cap below is read under it. A closed
  // SO still passes: returning the customer's material is not new work.
  const so = await lockOpenEquipmentSo(tx, companyId, soId, FOR_WHAT, false);
  if (!so.clientId) throw new ValidationError(`${so.code} has no Customer.`);

  const parts = await readSoCustomerParts(tx, companyId, so.id);
  const wantByItem = new Map<string, number>();
  for (const [idx, ln] of input.lines.entries()) {
    const row = `Row #${idx + 1}`;
    if (ln.jwLineId) {
      throw new ValidationError(
        `${row}: ${so.code} is a Sales Order — a JWSO line does not apply.`,
      );
    }
    if (ln.kind === 'good') {
      if (ln.partyGrnLineId) {
        throw new ValidationError(
          `${row}: a good-material row is not tied to a Party GRN — leave the GRN blank.`,
        );
      }
      if (!ln.rmItemId) throw new ValidationError(`${row}: pick the customer part to return.`);
      if (!parts.has(ln.rmItemId)) {
        throw new ValidationError(
          `${row}: the picked item is not a Party Supplied part of the BOM of ${so.code}.`,
        );
      }
      wantByItem.set(ln.rmItemId, (wantByItem.get(ln.rmItemId) ?? 0) + ln.qty);
    } else if (!ln.partyGrnLineId) {
      throw new ValidationError(`${row}: pick the Party GRN the deviated pieces came in on.`);
    }
  }
  // Cap: Σ good qty per part ≤ In Store for the SO (duplicate rows summed).
  for (const [itemId, want] of wantByItem) {
    const p = parts.get(itemId)!;
    if (want > p.figures.inStoreQty) {
      throw new ConflictError(
        `${p.rmItemCode}: Return Qty (${want}) cannot be more than In Store for ${so.code} ` +
          `(${p.figures.inStoreQty}) — Accepted ${p.figures.acceptedQty}, Issued ${p.figures.issuedQty}, ` +
          `already Returned ${p.figures.returnedQty}.`,
      );
    }
  }

  const code = await nextReturnCode(tx, companyId);
  const inserted = await tx
    .insert(customerMaterialReturns)
    .values({
      companyId,
      code,
      returnDate: input.returnDate,
      jobWorkOrderId: null,
      salesOrderId: so.id,
      clientId: so.clientId,
      vehicleNo: input.vehicleNo || null,
      remarks: input.remarks || null,
      status: 'issued',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: customerMaterialReturns.id });
  const header = inserted[0];
  if (!header) throw new ValidationError('Could not save Customer Material Return. Try again.');

  const summary: string[] = [];
  let totalQty = 0;
  for (const [idx, ln] of input.lines.entries()) {
    if (ln.kind === 'good') {
      const part = parts.get(ln.rmItemId!)!;
      const pm = await ensurePartyMaterial(tx, companyId, part.rmItemId, so.clientId, userId);
      await tx.insert(customerMaterialReturnLines).values({
        companyId,
        returnId: header.id,
        lineNo: idx + 1,
        kind: 'good',
        jwLineId: null,
        partyMaterialId: pm.partyMaterialId,
        partyGrnLineId: null,
        qty: ln.qty,
        createdBy: userId,
        updatedBy: userId,
      });
      // The ledger writer refuses an 'out' beyond the register's stock.
      const move = await postPartyStockMove(tx, {
        companyId,
        partyMaterialId: pm.partyMaterialId,
        jwLineId: null,
        salesOrderId: so.id,
        movement: 'return',
        direction: 'out',
        qty: ln.qty,
        sourceDocType: 'customer_material_return',
        sourceDocId: header.id,
        remarks: `${code} · returned to customer (${so.code})`,
        userId,
        qtyLabel: 'Return Qty',
      });
      await tx.execute(sql`
        UPDATE public.party_materials
           SET returned_qty = returned_qty + ${ln.qty}, updated_at = now(), updated_by = ${userId}::uuid
         WHERE id = ${pm.partyMaterialId}::uuid
      `);
      summary.push(`good ${ln.qty} of ${move.rmCode}`);
    } else {
      const grnRows = (await tx.execute(sql`
        SELECT pgl.id, pg.sales_order_id AS "soId", pgl.qc_at AS "qcAt",
               pgl.party_material_id AS "partyMaterialId",
               pgl.rejected_qty::int AS "rejectedQty",
               pgl.rejected_returned_qty::int AS "rejectedReturnedQty",
               ${ncHeldBackQtySql(sql`pgl.id`)} AS "ncHeldQty",
               pg.code AS "grnCode"
          FROM public.party_grn_lines pgl
          JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
         WHERE pgl.id = ${ln.partyGrnLineId!}::uuid
           AND pgl.company_id = ${companyId}::uuid
           AND pgl.deleted_at IS NULL
         FOR UPDATE OF pgl
      `)) as unknown as Array<{
        id: string;
        soId: string | null;
        qcAt: unknown;
        partyMaterialId: string | null;
        rejectedQty: number;
        rejectedReturnedQty: number;
        ncHeldQty: number;
        grnCode: string;
      }>;
      const g = grnRows[0];
      if (!g) {
        throw new NotFoundError(
          `Row #${idx + 1}: the Party GRN line was not found — it may have been cancelled. Refresh and pick again.`,
        );
      }
      if (g.soId !== so.id) {
        throw new ValidationError(
          `Row #${idx + 1}: ${g.grnCode} was not received against ${so.code}.`,
        );
      }
      if (!g.partyMaterialId) {
        throw new ValidationError(`Row #${idx + 1}: ${g.grnCode} has no customer material.`);
      }
      if (g.qcAt == null) {
        throw new ValidationError(
          `Row #${idx + 1}: ${g.grnCode} is still waiting for Incoming QC — nothing is deviated yet.`,
        );
      }
      // Cap in the WHERE (§20.2/§20.3): 0 rows = the held pieces were taken.
      const bumped = (await tx.execute(sql`
        UPDATE public.party_grn_lines
           SET rejected_returned_qty = rejected_returned_qty + ${ln.qty},
               updated_at = now(), updated_by = ${userId}::uuid
         WHERE id = ${g.id}::uuid
           AND deleted_at IS NULL
           AND rejected_returned_qty + ${ln.qty} + ${ncHeldBackQtySql(sql`${g.id}::uuid`)} <= rejected_qty
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      if (bumped.length === 0) {
        const ncHeld = Number(g.ncHeldQty);
        const held = Number(g.rejectedQty) - Number(g.rejectedReturnedQty) - ncHeld;
        throw new ConflictError(
          `Row #${idx + 1}: Qty (${ln.qty}) cannot be more than the deviated pieces still held on ` +
            `${g.grnCode} (${Math.max(0, held)}) — Deviated ${g.rejectedQty}, ` +
            `already returned ${g.rejectedReturnedQty}` +
            (ncHeld > 0 ? `, ${ncHeld} under an NC not decided as Return to Customer` : '') +
            `.`,
        );
      }
      const ncCodes = await rebalanceReturnToCustomerNcs(tx, g.id, code, companyId, user);
      await tx.insert(customerMaterialReturnLines).values({
        companyId,
        returnId: header.id,
        lineNo: idx + 1,
        kind: 'rejected',
        jwLineId: null,
        partyMaterialId: g.partyMaterialId,
        partyGrnLineId: g.id,
        qty: ln.qty,
        createdBy: userId,
        updatedBy: userId,
      });
      summary.push(
        `deviated ${ln.qty} (${g.grnCode}` +
          (ncCodes.length > 0 ? `, ${ncCodes.join(', ')}` : '') +
          `)`,
      );
    }
    totalQty += ln.qty;
  }

  await emitActivityLog(
    tx,
    {
      action: ActivityAction.Create,
      entity: 'CustomerMaterialReturn',
      entityId: header.id,
      refId: code,
      qty: totalQty,
      detail: `${code} · ${input.lines.length} line(s), ${totalQty} pcs back to the customer against ${so.code}: ${summary.join('; ')}`,
    },
    companyId,
    user,
  );

  return loadDetail(tx, companyId, header.id);
}
