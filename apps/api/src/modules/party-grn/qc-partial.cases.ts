// Partial Incoming QC on a Party GRN (owner 2026-10-31, migration 0233) —
// cases registered from ./service.test.ts (they share its client, JWSO and
// admin; this file adds its own two JWSO lines and customer materials so the
// quantities below are exact). Not a *.test.ts: it only runs from there.
//
// The owner's example: line received 60 → inspect 6 accepted (6 enter
// customer stock, 54 QC pending) → later 50 accepted + 4 deviated (one NC for
// 4) → done.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { partyGrnQcLineInputSchema, qcRegisterQuerySchema } from '@innovic/shared';
import { db } from '../../db/client';
import { jobWorkOrderLines, ncRegister, partyMaterials, partyStockLedger } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';
import { listQcRegister } from '../qc-history/register';
import { qcPartyGrn } from './qc';
import * as service from './service';

export interface PartialQcCtx {
  admin: AuthContext;
  jwId: string;
  clientId: string;
  /** Two items no other customer material of this client uses (P1, P2). */
  itemIds: [string, string];
  prefix: string;
}

const ORDER = 60;

export function registerPartialQcCases(ctx: () => PartialQcCtx): void {
  describe('party-grn service — partial Incoming QC (0233)', () => {
    let flowLine: string;
    let raceLine: string;
    let pmFlow: string;
    let pmRace: string;

    beforeAll(async () => {
      const c = ctx();
      const pms = await db
        .insert(partyMaterials)
        .values(
          ['PM-P1', 'PM-P2'].map((code, i) => ({
            companyId: c.admin.companyId!,
            code: `${c.prefix}${code}`,
            name: `Partial QC material ${code}`,
            uom: 'NOS',
            clientId: c.clientId,
            itemId: c.itemIds[i]!,
            createdBy: c.admin.id,
            updatedBy: c.admin.id,
          })),
        )
        .returning();
      pmFlow = pms.find((p) => p.code.endsWith('PM-P1'))!.id;
      pmRace = pms.find((p) => p.code.endsWith('PM-P2'))!.id;
      const lines = await db
        .insert(jobWorkOrderLines)
        .values(
          [
            { lineNo: 31, pm: pmFlow, itemId: c.itemIds[0] },
            { lineNo: 32, pm: pmRace, itemId: c.itemIds[1] },
          ].map((l) => ({
            companyId: c.admin.companyId!,
            jobWorkOrderId: c.jwId,
            lineNo: l.lineNo,
            itemId: l.itemId,
            partyMaterialId: l.pm,
            partName: `${c.prefix}PART-${l.lineNo}`,
            uom: 'NOS' as const,
            orderQty: ORDER,
            status: 'open' as const,
            createdBy: c.admin.id,
            updatedBy: c.admin.id,
          })),
        )
        .returning();
      flowLine = lines.find((l) => l.lineNo === 31)!.id;
      raceLine = lines.find((l) => l.lineNo === 32)!.id;
    });

    afterAll(async () => {
      // The GRNs, their lines and NCs go with the file's own afterAll (same
      // JWSO); the ledger rows of these two materials go here, before the
      // materials themselves are removed there.
      // The ledger is append-only; the transaction-local maintenance switch is
      // the exit that survives the TEST pooler (application_name does not).
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('innovic.ledger_maintenance', 'on', true)`);
        await tx
          .delete(partyStockLedger)
          .where(inArray(partyStockLedger.partyMaterialId, [pmFlow, pmRace]));
      });
    });

    const receipt = (jwLineId: string, receivedQty: number) => ({
      grnDate: '2026-10-31',
      jobWorkOrderId: ctx().jwId,
      dcNo: `DC-${randomUUID()}`,
      lines: [{ jwLineId, receivedQty }],
    });
    const stock = async (pmId: string) =>
      (
        await db
          .select({ stockQty: partyMaterials.stockQty })
          .from(partyMaterials)
          .where(eq(partyMaterials.id, pmId))
      )[0]!.stockQty;
    const ncsOn = (lineId: string) =>
      db
        .select({ rejectedQty: ncRegister.rejectedQty })
        .from(ncRegister)
        .where(and(eq(ncRegister.partyGrnLineId, lineId), isNull(ncRegister.deletedAt)));
    const registerRow = async (code: string, view: 'pending' | 'completed') => {
      const r = await listQcRegister(
        qcRegisterQuerySchema.parse({ view, search: code, grnType: 'party_grn' }),
        ctx().admin,
      );
      const it = r.items.find((x) => x.kind === 'pgrn');
      return it && it.kind === 'pgrn' ? it.row : undefined;
    };

    it('6 of 60 now, then 50 + 4 deviated — stock, pending, register, NC, caps', async () => {
      const { admin } = ctx();
      const before = await stock(pmFlow);
      const grn = await service.createPartyGrn(receipt(flowLine, ORDER), admin);
      const lineId = (await service.getPartyGrnDetail(grn.id, admin)).lines[0]!.id;

      // First inspection: 6 accepted.
      const d1 = await qcPartyGrn(
        grn.id,
        { lines: [{ lineId, acceptedQty: 6, rejectedQty: 0 }] },
        admin,
      );
      expect(await stock(pmFlow)).toBe(before + 6);
      expect(d1.lines[0]!.acceptedQty).toBe(6);
      expect(d1.lines[0]!.qcPendingQty).toBe(54);
      expect(d1.qcPendingLines).toBe(1);
      expect(d1.totalQcPendingQty).toBe(54);
      expect((await registerRow(grn.code, 'pending'))?.pendingQty).toBe(54);
      expect((await registerRow(grn.code, 'completed'))?.pendingQty).toBe(54);

      // The 54 uninspected pieces still use up the order: nothing more fits.
      await expect(service.createPartyGrn(receipt(flowLine, 1), admin)).rejects.toBeInstanceOf(
        ValidationError,
      );
      // Received qty is frozen at the first inspection.
      await expect(
        service.updatePartyGrn(grn.id, { lines: [{ id: lineId, receivedQty: 50 }] }, admin),
      ).rejects.toBeInstanceOf(ConflictError);
      // More than what is left is refused.
      await expect(
        qcPartyGrn(grn.id, { lines: [{ lineId, acceptedQty: 55, rejectedQty: 0 }] }, admin),
      ).rejects.toBeInstanceOf(ValidationError);

      // Second inspection: 50 accepted + 4 deviated → done.
      const d2 = await qcPartyGrn(
        grn.id,
        { lines: [{ lineId, acceptedQty: 50, rejectedQty: 4, rejectReason: 'dent' }] },
        admin,
      );
      expect(await stock(pmFlow)).toBe(before + 56);
      expect(d2.lines[0]!.acceptedQty).toBe(56);
      expect(d2.lines[0]!.rejectedQty).toBe(4);
      expect(d2.lines[0]!.qcPendingQty).toBe(0);
      expect(d2.qcPendingLines).toBe(0);
      expect(d2.totalQcPendingQty).toBe(0);
      const ncs = await ncsOn(lineId);
      expect(ncs.map((n) => Number(n.rejectedQty))).toEqual([4]);
      expect(await registerRow(grn.code, 'pending')).toBeUndefined();
      expect((await registerRow(grn.code, 'completed'))?.pendingQty).toBe(0);

      // Fully inspected → a third inspection is a 409.
      await expect(
        qcPartyGrn(grn.id, { lines: [{ lineId, acceptedQty: 1, rejectedQty: 0 }] }, admin),
      ).rejects.toBeInstanceOf(ConflictError);
      // 56 accepted + 4 under a pending NC = 60 committed: still full.
      await expect(service.createPartyGrn(receipt(flowLine, 1), admin)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('refuses an inspection of 0 + 0 (schema)', () => {
      const r = partyGrnQcLineInputSchema.safeParse({
        lineId: randomUUID(),
        acceptedQty: 0,
        rejectedQty: 0,
      });
      expect(r.success).toBe(false);
    });

    it('two inspections of 40 at once on a line of 60 — exactly one wins', async () => {
      const { admin } = ctx();
      const before = await stock(pmRace);
      const grn = await service.createPartyGrn(receipt(raceLine, ORDER), admin);
      const lineId = (await service.getPartyGrnDetail(grn.id, admin)).lines[0]!.id;
      const body = { lines: [{ lineId, acceptedQty: 40, rejectedQty: 0 }] };
      const results = await Promise.allSettled([
        qcPartyGrn(grn.id, body, admin),
        qcPartyGrn(grn.id, body, admin),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      // The two queue on the GRN header lock; the second sees QC Pending 20.
      expect(lost.reason instanceof ValidationError || lost.reason instanceof ConflictError).toBe(
        true,
      );
      const d = await service.getPartyGrnDetail(grn.id, admin);
      expect(d.lines[0]!.acceptedQty + d.lines[0]!.rejectedQty).toBe(40);
      expect(d.lines[0]!.qcPendingQty).toBe(20);
      expect(await stock(pmRace)).toBe(before + 40);
    });
  });
}
