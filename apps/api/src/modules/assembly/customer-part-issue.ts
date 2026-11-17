// ADR-307 — Assembly Tracker › "Issue Customer Part →".
//
// Issues a customer-supplied BOM part (party_supplied BOM child, `<code>-RM`)
// from the zero-value party store to the Equipment SO's assembly. Once issued
// it counts in readPartsOut (lib/assembly-parts.ts) and fitting.ts fits it at
// Complete like any part.
//
// One transaction, lock order SO row → party material row (§20.3):
//   lockOpenEquipmentSo → readSoCustomerParts → caps → insert issue →
//   postPartyStockMove (the one stock writer, locks party_materials) →
//   party_materials.issued_qty += qty (the same counter the JWSO issue keeps).

import { ActivityAction, type CreateAssemblyCustomerPartIssueInput } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { partyMaterialIssues, partyMaterials } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { lockOpenEquipmentSo } from '../../lib/assembly-parts';
import { AuthorizationError, ConflictError, ValidationError } from '../../lib/errors';
import { ensurePartyMaterial } from '../../lib/jw-rm';
import { readSoCustomerParts } from '../../lib/party-so-parts';
import { postPartyStockMove } from '../../lib/party-stock-ledger';
import { emitActivityLog } from '../activity-log/service';
import { nextIssueCode } from '../party-material-issues/service';

export interface AssemblyCustomerPartIssueResult {
  id: string;
  code: string;
  salesOrderId: string;
  soCode: string;
  rmItemId: string;
  qty: number;
}

export async function issueCustomerPartToAssembly(
  soId: string,
  input: CreateAssemblyCustomerPartIssueInput,
  user: AuthContext,
): Promise<AssemblyCustomerPartIssueResult> {
  // Same gate as POST /party-material-issues.
  await requireFormAccess(user, 'party_create', 'entry');
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const userId = user.id;

  return withUserContext(user, async (tx) => {
    const so = await lockOpenEquipmentSo(tx, companyId, soId, 'issue customer parts');
    if (!so.clientId) throw new ValidationError(`${so.code} has no Customer.`);
    const part = (await readSoCustomerParts(tx, companyId, so.id)).get(input.rmItemId);
    if (!part) {
      throw new ValidationError(
        `The picked item is not a Party Supplied part of the BOM of ${so.code}.`,
      );
    }
    const f = part.figures;
    if (input.qty > f.inStoreQty) {
      throw new ConflictError(
        `${part.rmItemCode}: Issue Qty (${input.qty}) cannot be more than In Store for ${so.code} (${f.inStoreQty}).`,
      );
    }
    if (f.issuedQty + input.qty > f.needQty) {
      throw new ConflictError(
        `${part.rmItemCode}: Issue Qty (${input.qty}) would take ${so.code} to ${f.issuedQty + input.qty} ` +
          `issued against a need of ${f.needQty}.`,
      );
    }

    const pm = await ensurePartyMaterial(tx, companyId, part.rmItemId, so.clientId, userId);
    const code = await nextIssueCode(tx, companyId);
    const inserted = await tx
      .insert(partyMaterialIssues)
      .values({
        companyId,
        code,
        issueDate: input.issueDate,
        jobWorkOrderId: null,
        jwCodeText: null,
        jobCardId: null,
        jcCodeText: null,
        jwLineId: null,
        salesOrderId: so.id,
        partyMaterialId: pm.partyMaterialId,
        partyMaterialCodeText: pm.partyMaterialCode,
        partyMaterialName: part.rmItemName,
        qty: input.qty,
        remarks: input.remarks ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: partyMaterialIssues.id });
    const row = inserted[0];
    if (!row) throw new ValidationError('Could not save Customer Part Issue. Try again.');

    await postPartyStockMove(tx, {
      companyId,
      partyMaterialId: pm.partyMaterialId,
      salesOrderId: so.id,
      movement: 'issue',
      direction: 'out',
      qty: input.qty,
      sourceDocType: 'party_material_issue',
      sourceDocId: row.id,
      remarks: `${code} · issued to ${so.code} assembly`,
      userId,
      qtyLabel: 'Issue Qty',
    });
    await tx
      .update(partyMaterials)
      .set({
        issuedQty: sql`${partyMaterials.issuedQty} + ${input.qty}`,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(partyMaterials.id, pm.partyMaterialId));

    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Issue,
        entity: 'PartyMaterialIssue',
        entityId: row.id,
        refId: code,
        qty: input.qty,
        detail: `${code} — issued ${input.qty} of ${part.rmItemCode} to ${so.code} assembly`,
      },
      companyId,
      user,
    );
    return {
      id: row.id,
      code,
      salesOrderId: so.id,
      soCode: so.code,
      rmItemId: part.rmItemId,
      qty: input.qty,
    };
  });
}
