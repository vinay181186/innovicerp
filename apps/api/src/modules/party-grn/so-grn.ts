// ADR-307 — Party GRN against an Equipment SO (customer-supplied BOM parts).
//
// The JWSO path in service.ts is untouched; createPartyGrn hands over here
// when the input names salesOrderId.
//
// ── SO-GRN LOCK ORDER (§20.3) — every writer of an Equipment-SO Party GRN ──
//   1. party_grn header        (only if the path locks it: edit, QC, cancel;
//                                the Cancel Request handler's lock() takes it
//                                first, then cancelPartyGrnTx re-takes it)
//      nc_register             (cancel locks its NCs here, after the header;
//                                NC Use As Is starts here — it never locks the
//                                header)
//   2. sales_orders row        (lockSoRow / lockOpenEquipmentSo)
//   3. party_grn_lines         (FOR UPDATE)
//   4. party_materials         (register row — postPartyStockMove /
//                                ensurePartyMaterial)
// Figures (readSoCustomerParts) are read AFTER step 2. Never lock the header
// after the SO row, nor the SO row after a GRN line.
//   create   : SO → figures → register row → challan lock → insert   (here)
//   edit     : header → SO → lines                (service.ts updatePartyGrnTx)
//   QC       : header → SO → line → register      (qc.ts qcPartyGrn)
//   Use As Is: NC → SO → line → register          (deviation.ts)
//   cancel   : header → NCs → SO → lines → register (service.ts cancelPartyGrnTx)

import {
  ActivityAction,
  type CancelBlocker,
  type CreatePartyGrnInput,
  type PartyGrn,
  type SoReceivablePart,
  type SoWithCustomerParts,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { partyGrn, partyGrnLines } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { lockOpenEquipmentSo } from '../../lib/assembly-parts';
import { ValidationError } from '../../lib/errors';
import { ensurePartyMaterial } from '../../lib/jw-rm';
import { assertPartyGrnDcNoFree } from '../../lib/party-grn-dc-unique';
import { readSoCustomerParts, readSoCustomerPartsMany } from '../../lib/party-so-parts';
import { emitActivityLog } from '../activity-log/service';
import { nextPartyGrnCode, requireCompany, requirePartyGrnRead, rowToPartyGrn } from './service';

export async function createPartyGrnForSo(
  input: CreatePartyGrnInput & { salesOrderId: string },
  user: AuthContext,
): Promise<PartyGrn> {
  await requireFormAccess(user, 'party_create', 'entry');
  const companyId = requireCompany(user);
  const userId = user.id;
  if (input.lines.length === 0) throw new ValidationError('Add at least one row.');

  return withUserContext(user, async (tx) => {
    // 1) SO row lock FIRST, then the figures (§20.3).
    const so = await lockOpenEquipmentSo(
      tx,
      companyId,
      input.salesOrderId,
      'receive customer parts',
    );
    if (!so.clientId) {
      throw new ValidationError(`${so.code} has no Customer — set the Customer on the SO first.`);
    }
    const parts = await readSoCustomerParts(tx, companyId, so.id);
    if (parts.size === 0) {
      throw new ValidationError(`${so.code}: its BOM has no Party Supplied part to receive.`);
    }

    // 2) Every line names a party_supplied child of the SO's BOM; cap the
    //    receipt (duplicate lines of one item summed) at that part's Pending.
    const thisReceipt = new Map<string, number>();
    for (const ln of input.lines) {
      if (!ln.rmItemId || ln.jwLineId) {
        throw new ValidationError('Each row must name a customer part of the SO.');
      }
      if (!parts.has(ln.rmItemId)) {
        throw new ValidationError(
          `The picked item is not a Party Supplied part of ${so.code}'s BOM. Pick it again.`,
        );
      }
      thisReceipt.set(ln.rmItemId, (thisReceipt.get(ln.rmItemId) ?? 0) + ln.receivedQty);
    }
    for (const [rmItemId, qty] of thisReceipt) {
      const p = parts.get(rmItemId)!;
      if (qty > p.figures.pendingQty) {
        throw new ValidationError(
          `${p.rmItemCode}: only ${p.figures.pendingQty} pending for this SO ` +
            `(need ${p.figures.needQty}, accepted ${p.figures.acceptedQty}, ` +
            `waiting for QC ${p.figures.waitingQcQty}) — you entered ${qty}.`,
        );
      }
    }

    // 3) Register rows (one per RM item + SO customer), id order = stable.
    const pmByItem = new Map<string, { id: string; code: string }>();
    for (const rmItemId of Array.from(thisReceipt.keys()).sort()) {
      const pm = await ensurePartyMaterial(tx, companyId, rmItemId, so.clientId, userId);
      pmByItem.set(rmItemId, { id: pm.partyMaterialId, code: pm.partyMaterialCode });
    }

    // 4) Header — client from the SO; challan unique per customer.
    const clientRows = (await tx.execute(sql`
      SELECT code FROM public.clients WHERE id = ${so.clientId}::uuid AND company_id = ${companyId}::uuid
    `)) as unknown as Array<{ code: string | null }>;
    await assertPartyGrnDcNoFree(tx, companyId, so.clientId, input.dcNo);
    const code = await nextPartyGrnCode(tx, companyId);
    const inserted = await tx
      .insert(partyGrn)
      .values({
        companyId,
        code,
        grnDate: input.grnDate,
        jobWorkOrderId: null,
        jwCodeText: null,
        salesOrderId: so.id,
        clientId: so.clientId,
        clientCodeText: clientRows[0]?.code ?? null,
        clientPoNo: so.clientPoNo ?? null,
        dcNo: input.dcNo ?? null,
        remarks: input.remarks ?? null,
        receivedByText: user.fullName?.trim() || user.email || user.id,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();
    const header = inserted[0];
    if (!header) throw new ValidationError('Could not save Party GRN. Try again.');

    // 5) Lines — waiting for Incoming QC; nothing posted to the register yet.
    for (const [idx, ln] of input.lines.entries()) {
      const p = parts.get(ln.rmItemId!)!;
      const pm = pmByItem.get(ln.rmItemId!)!;
      await tx.insert(partyGrnLines).values({
        companyId,
        partyGrnId: header.id,
        lineNo: idx + 1,
        partyMaterialId: pm.id,
        partyMaterialCodeText: pm.code,
        partyMaterialName: p.rmItemName,
        receivedQty: ln.receivedQty,
        jwLineNoText: null,
        jwLineId: null,
        acceptedQty: 0,
        rejectedQty: 0,
        rejectReason: null,
        qcBy: null,
        qcAt: null,
        remarks: ln.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const total = input.lines.reduce((a, l) => a + l.receivedQty, 0);
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'PartyGrn',
        entityId: header.id,
        refId: header.code,
        qty: total,
        detail:
          `${header.code} · ${input.lines.length} line(s), ${total} pcs received against ` +
          `${so.code} (customer parts) — waiting for Incoming QC`,
      },
      companyId,
      user,
    );
    return { ...rowToPartyGrn(header), soCode: so.code };
  });
}

/** GET /party-grn/receivable-sos — open Equipment SOs whose BOM has a
 *  party_supplied line. `forReturn` (Customer Material Return picker): closed
 *  SOs too (never cancelled / deleted), and only SOs with a part still in the
 *  customer store (inStoreQty > 0) or a held deviated piece (deviatedHeldQty > 0). */
export async function listReceivableSos(
  user: AuthContext,
  opts: { forReturn?: boolean } = {},
): Promise<SoWithCustomerParts[]> {
  const forReturn = opts.forReturn === true;
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT so.id, so.code, so.client_id AS "clientId", c.name AS "clientName",
             so.client_po_no AS "clientPoNo"
        FROM public.sales_orders so
        LEFT JOIN public.clients c ON c.id = so.client_id
       WHERE so.company_id = ${companyId}::uuid AND so.deleted_at IS NULL
         AND so.type = 'equipment'
         AND ${forReturn ? sql`so.status <> 'cancelled'` : sql`so.status NOT IN ('closed', 'cancelled')`}
         AND EXISTS (
           SELECT 1 FROM public.bom_masters bm
             JOIN public.bom_master_lines bml
               ON bml.bom_master_id = bm.id AND bml.deleted_at IS NULL
            WHERE bm.id = so.bom_master_id AND bm.deleted_at IS NULL
              AND bml.bom_type = 'party_supplied')
       ORDER BY so.code DESC
    `)) as unknown as Array<{
      id: string;
      code: string;
      clientId: string | null;
      clientName: string | null;
      clientPoNo: string | null;
    }>;
    const figs = await readSoCustomerPartsMany(
      tx,
      companyId,
      rows.map((r) => r.id),
    );
    const kept = forReturn
      ? rows.filter((r) =>
          Array.from(figs.get(r.id)?.values() ?? []).some(
            (p) => p.figures.inStoreQty > 0 || p.figures.deviatedHeldQty > 0,
          ),
        )
      : rows;
    return kept.map((r) => ({
      salesOrderId: r.id,
      soCode: r.code,
      clientId: r.clientId,
      clientName: r.clientName,
      clientPoNo: r.clientPoNo,
      pendingQty: Array.from(figs.get(r.id)?.values() ?? []).reduce(
        (a, p) => a + p.figures.pendingQty,
        0,
      ),
    }));
  });
}

/** GET /party-grn/so-receivable?salesOrderId= — the SO's customer parts. */
export async function listSoReceivableParts(
  salesOrderId: string,
  user: AuthContext,
): Promise<SoReceivablePart[]> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const parts = await readSoCustomerParts(tx, companyId, salesOrderId);
    return Array.from(parts.values()).map((p) => ({
      rmItemId: p.rmItemId,
      rmItemCode: p.rmItemCode,
      rmItemName: p.rmItemName,
      qtyPerSet: p.qtyPerSet,
      figures: p.figures,
    }));
  });
}

/** Cancel guard for an SO GRN: what it put in (accepted) must still be in
 *  this SO's customer store — pieces issued to assembly or returned must come
 *  back first. Caller holds the SO lock when it is about to write. */
export async function soGrnCancelBlockers(
  tx: DbTransaction,
  companyId: string,
  grnId: string,
  salesOrderId: string,
): Promise<CancelBlocker[]> {
  const rows = (await tx.execute(sql`
    SELECT pm.item_id AS "itemId", SUM(l.accepted_qty)::int AS qty
      FROM public.party_grn_lines l
      JOIN public.party_materials pm ON pm.id = l.party_material_id
     WHERE l.party_grn_id = ${grnId}::uuid AND l.company_id = ${companyId}::uuid
       AND l.deleted_at IS NULL AND l.accepted_qty > 0
     GROUP BY pm.item_id
  `)) as unknown as Array<{ itemId: string | null; qty: number }>;
  if (rows.length === 0) return [];
  const parts = await readSoCustomerParts(tx, companyId, salesOrderId);
  const out: CancelBlocker[] = [];
  for (const r of rows) {
    const p = r.itemId ? parts.get(r.itemId) : undefined;
    const inStore = p?.figures.inStoreQty ?? 0;
    if (Number(r.qty) > inStore) {
      out.push({
        docLabel: 'Assembly',
        docNo: p?.rmItemCode ?? 'customer part',
        href: null,
        reason:
          `Already issued to assembly — put them back first ` +
          `(this GRN accepted ${Number(r.qty)}, only ${inStore} still in the customer store)`,
      });
    }
  }
  return out;
}
