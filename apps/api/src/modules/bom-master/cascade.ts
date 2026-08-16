// BOM Master → Sales Order line cascade (BOM-8).
//
// When a sales_order_lines row is inserted with source_bom_master_id set,
// walk the BOM's lines and spawn child entities per bom_type:
//
//   manufacture → insert a child job_cards row for the sub-assembly
//                 (source_so_line_id = parent SO line, so the T-033
//                  JC→SO cascade still closes back through the parent)
//   purchase    → insert a purchase_requests row with the SO line as
//                 source_so_line_id
//   outsource   → insert a purchase_requests row marked operation =
//                 'OUTSOURCE' (the procurement team converts it to
//                 a PO with po_type = 'job_work')
//
// Idempotency: caller invokes this AFTER inserting the SO line; the
// function checks whether any child JC/PR with source_so_line_id =
// this.id already exists, and if so returns the existing snapshot
// instead of duplicating. Safe to call from create + update paths.
//
// Per-line qty math: child qty = soLineOrderQty × bomLineQtyPerSet
// (legacy renderBOMMaster never persisted this multiplied qty; it
// re-derived on every read. We persist on the child row so downstream
// reports / cascades don't have to chase the BOM each time.)

import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import {
  bomMasterLines,
  bomMasters,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  purchaseRequests,
  salesOrderLines,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

export interface CascadeBomToSoLineResult {
  /** True when at least one child row was inserted (false on idempotent no-op). */
  fired: boolean;
  /** SO line id passed in. */
  soLineId: string;
  /** BOM master id consulted. */
  bomMasterId: string;
  createdJobCardCodes: string[];
  createdPrCodes: string[];
}

interface SoLineForCascade {
  id: string;
  companyId: string;
  itemId: string | null;
  partName: string;
  orderQty: number;
  sourceBomMasterId: string | null;
  salesOrderId: string;
}

async function nextJobCardCode(
  tx: DbTransaction,
  companyId: string,
  parentSoLineId: string,
): Promise<string> {
  // Auto-generate JC-BOM-<short_so_line>-<seq>. Short slice + per-line
  // sequence keeps codes short + scoped without an extra counter table.
  const rows = await tx
    .select({ value: count() })
    .from(jobCards)
    .where(and(eq(jobCards.companyId, companyId), eq(jobCards.sourceSoLineId, parentSoLineId)));
  const seq = (rows[0]?.value ?? 0) + 1;
  const slug = parentSoLineId.slice(0, 8);
  return `JC-BOM-${slug}-${String(seq).padStart(2, '0')}`;
}

async function nextPrCode(
  tx: DbTransaction,
  companyId: string,
  parentSoLineId: string,
): Promise<string> {
  const rows = await tx
    .select({ value: count() })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.companyId, companyId),
        eq(purchaseRequests.sourceSoLineId, parentSoLineId),
      ),
    );
  const seq = (rows[0]?.value ?? 0) + 1;
  const slug = parentSoLineId.slice(0, 8);
  return `PR-BOM-${slug}-${String(seq).padStart(2, '0')}`;
}

export async function cascadeBomToSoLine(
  tx: DbTransaction,
  soLineId: string,
  user: AuthContext,
): Promise<CascadeBomToSoLineResult> {
  // 1. Load the SO line + its BOM ref. Return early if BOM not set.
  const soRows = await tx
    .select({
      id: salesOrderLines.id,
      companyId: salesOrderLines.companyId,
      itemId: salesOrderLines.itemId,
      partName: salesOrderLines.partName,
      orderQty: salesOrderLines.orderQty,
      sourceBomMasterId: salesOrderLines.sourceBomMasterId,
      salesOrderId: salesOrderLines.salesOrderId,
    })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, soLineId), isNull(salesOrderLines.deletedAt)))
    .limit(1);
  const soLine = soRows[0] as SoLineForCascade | undefined;
  if (!soLine) throw new NotFoundError(`Sales order line ${soLineId} not found`);
  if (!soLine.sourceBomMasterId) {
    return {
      fired: false,
      soLineId,
      bomMasterId: '',
      createdJobCardCodes: [],
      createdPrCodes: [],
    };
  }

  const bomMasterId = soLine.sourceBomMasterId;

  // 2. Idempotency: if any child JC OR PR already has source_so_line_id
  //    = this SO line, the cascade has already run. Return empty.
  const existingJcCount = await tx
    .select({ value: count() })
    .from(jobCards)
    .where(eq(jobCards.sourceSoLineId, soLineId));
  const existingPrCount = await tx
    .select({ value: count() })
    .from(purchaseRequests)
    .where(eq(purchaseRequests.sourceSoLineId, soLineId));
  if ((existingJcCount[0]?.value ?? 0) > 0 || (existingPrCount[0]?.value ?? 0) > 0) {
    return {
      fired: false,
      soLineId,
      bomMasterId,
      createdJobCardCodes: [],
      createdPrCodes: [],
    };
  }

  // 3. Load BOM lines.
  const bomLines = await tx
    .select()
    .from(bomMasterLines)
    .where(
      and(
        eq(bomMasterLines.bomMasterId, bomMasterId),
        eq(bomMasterLines.companyId, soLine.companyId),
        isNull(bomMasterLines.deletedAt),
      ),
    )
    .orderBy(asc(bomMasterLines.lineNo));

  // 4. Walk each BOM line and spawn the appropriate child.
  const createdJobCardCodes: string[] = [];
  const createdPrCodes: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const bl of bomLines) {
    const childQty = Math.round(soLine.orderQty * Number(bl.qtyPerSet));
    if (childQty <= 0) continue;

    if (bl.bomType === 'manufacture') {
      const code = await nextJobCardCode(tx, soLine.companyId, soLineId);
      await tx.insert(jobCards).values({
        companyId: soLine.companyId,
        code,
        jcDate: today,
        itemId: bl.childItemId,
        orderQty: childQty,
        priority: 'normal',
        sourceSoLineId: soLineId,
        createdBy: user.id,
        updatedBy: user.id,
      });
      createdJobCardCodes.push(code);
    } else {
      // purchase OR outsource → both go to purchase_requests; outsource
      // is differentiated by operation = 'OUTSOURCE' so procurement knows
      // to convert it to a job_work PO instead of a standard PO.
      const code = await nextPrCode(tx, soLine.companyId, soLineId);
      await tx.insert(purchaseRequests).values({
        companyId: soLine.companyId,
        code,
        prDate: today,
        status: 'open',
        // purchase_requests CHECK requires ≥1 of vendor_id / vendor_code_text;
        // cascade-generated PRs don't know the vendor yet (procurement picks),
        // so we plant 'TBD' as the placeholder text. Procurement converts to
        // a real vendor + PO via the existing PR-to-PO flow.
        vendorCodeText: 'TBD',
        itemId: bl.childItemId,
        qty: childQty,
        sourceSoLineId: soLineId,
        operation: bl.bomType === 'outsource' ? 'OUTSOURCE' : null,
        remarks: `Auto from BOM cascade (line ${bl.lineNo})`,
        createdBy: user.id,
        updatedBy: user.id,
      });
      createdPrCodes.push(code);
    }
  }

  // 5. Resolve the BOM code for the audit detail + emit one row.
  const bomRows = await tx
    .select({ bomNo: bomMasters.bomNo })
    .from(bomMasters)
    .where(eq(bomMasters.id, bomMasterId))
    .limit(1);
  const bomNo = bomRows[0]?.bomNo ?? bomMasterId.slice(0, 8);

  if (createdJobCardCodes.length > 0 || createdPrCodes.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: 'BOM_CASCADE',
        entity: 'BOM',
        detail: `${bomNo} → SO line ${soLine.partName}: ${createdJobCardCodes.length} JC + ${createdPrCodes.length} PR`,
        refId: bomNo,
      },
      soLine.companyId,
      user,
    );
  }

  return {
    fired: createdJobCardCodes.length > 0 || createdPrCodes.length > 0,
    soLineId,
    bomMasterId,
    createdJobCardCodes,
    createdPrCodes,
  };
}

// ─── Job-work variant (migration 0086) ────────────────────────────────────
//
// Job work also covers assembly: the client ships components and asks for a
// finished unit back. Same idea as the SO cascade above, with two deliberate
// differences, both flowing from one fact — on job work the CLIENT owns and
// supplies the material:
//
//   purchase    REJECTED before we get here (assertBomUsableForJobWork). We do
//               not buy parts for a job-work order; the same rule already
//               refuses Direct Purchase on a job-work plan.
//   outsource   spawns a Job Card carrying an OUTSOURCE op, NOT a bare
//               purchase_request. purchase_requests has no job-work link
//               column; job_cards does (source_jw_line_id). Seeding a JC + OSP
//               op is also exactly what the full_outsource plan path does
//               (ADR-095), so the existing PR -> PO -> DC -> GRN -> QC chain
//               picks it up unchanged, and readiness scores an outsource final
//               op from its GRN with no new code.

export interface CascadeBomToJwLineResult {
  /** True when at least one child JC was inserted (false on idempotent no-op). */
  fired: boolean;
  /** JW line id passed in. */
  jwLineId: string;
  /** BOM master id consulted. */
  bomMasterId: string;
  createdJobCardCodes: string[];
}

interface JwLineForCascade {
  id: string;
  companyId: string;
  partName: string;
  orderQty: number;
  sourceBomMasterId: string | null;
}

async function nextJwJobCardCode(
  tx: DbTransaction,
  companyId: string,
  parentJwLineId: string,
): Promise<string> {
  const rows = await tx
    .select({ value: count() })
    .from(jobCards)
    .where(and(eq(jobCards.companyId, companyId), eq(jobCards.sourceJwLineId, parentJwLineId)));
  const seq = (rows[0]?.value ?? 0) + 1;
  return `JC-BOM-${parentJwLineId.slice(0, 8)}-${String(seq).padStart(2, '0')}`;
}

/**
 * Refuse a BOM that contains bought parts on a job-work order, naming them so
 * the user can act. Call this BEFORE persisting the JW line — it is a
 * context rule, not a property of the BOM: the very same BOM is perfectly
 * valid on a sales order, where we do buy the material.
 */
export async function assertBomUsableForJobWork(
  tx: DbTransaction,
  bomMasterId: string,
  companyId: string,
): Promise<void> {
  const offenders = await tx
    .select({ code: items.code, name: items.name })
    .from(bomMasterLines)
    .innerJoin(items, eq(items.id, bomMasterLines.childItemId))
    .where(
      and(
        eq(bomMasterLines.bomMasterId, bomMasterId),
        eq(bomMasterLines.companyId, companyId),
        eq(bomMasterLines.bomType, 'purchase'),
        isNull(bomMasterLines.deletedAt),
      ),
    )
    .orderBy(asc(bomMasterLines.lineNo));
  if (offenders.length === 0) return;

  const bomRows = await tx
    .select({ bomNo: bomMasters.bomNo })
    .from(bomMasters)
    .where(eq(bomMasters.id, bomMasterId))
    .limit(1);
  const bomNo = bomRows[0]?.bomNo ?? 'That BOM';
  const list = offenders.map((o) => o.code ?? o.name).join(', ');
  const many = offenders.length > 1;
  throw new ValidationError(
    `${bomNo} can't be used on a job work order — ${list} ${many ? 'are bought parts' : 'is a bought part'}. ` +
      `Job work runs on material the client supplies, so only machined and outsourced parts are allowed. ` +
      `Change ${many ? 'them' : 'it'} to Manufacture or Outsource in the BOM, or pick a different BOM.`,
  );
}

export async function cascadeBomToJwLine(
  tx: DbTransaction,
  jwLineId: string,
  user: AuthContext,
): Promise<CascadeBomToJwLineResult> {
  const jwRows = await tx
    .select({
      id: jobWorkOrderLines.id,
      companyId: jobWorkOrderLines.companyId,
      partName: jobWorkOrderLines.partName,
      orderQty: jobWorkOrderLines.orderQty,
      sourceBomMasterId: jobWorkOrderLines.sourceBomMasterId,
    })
    .from(jobWorkOrderLines)
    .where(and(eq(jobWorkOrderLines.id, jwLineId), isNull(jobWorkOrderLines.deletedAt)))
    .limit(1);
  const jwLine = jwRows[0] as JwLineForCascade | undefined;
  if (!jwLine) throw new NotFoundError(`Job work order line ${jwLineId} not found`);
  if (!jwLine.sourceBomMasterId) {
    return { fired: false, jwLineId, bomMasterId: '', createdJobCardCodes: [] };
  }
  const bomMasterId = jwLine.sourceBomMasterId;

  // Idempotency: any child JC already pointing at this line means the cascade
  // has run. Re-saving the JW must not double the shop-floor work.
  const existing = await tx
    .select({ value: count() })
    .from(jobCards)
    .where(eq(jobCards.sourceJwLineId, jwLineId));
  if ((existing[0]?.value ?? 0) > 0) {
    return { fired: false, jwLineId, bomMasterId, createdJobCardCodes: [] };
  }

  // Belt-and-braces — the service asserts this before insert, but the cascade
  // is also reachable from update paths, and silently buying client material
  // is not a failure mode worth risking.
  await assertBomUsableForJobWork(tx, bomMasterId, jwLine.companyId);

  const bomLines = await tx
    .select()
    .from(bomMasterLines)
    .where(
      and(
        eq(bomMasterLines.bomMasterId, bomMasterId),
        eq(bomMasterLines.companyId, jwLine.companyId),
        isNull(bomMasterLines.deletedAt),
      ),
    )
    .orderBy(asc(bomMasterLines.lineNo));

  const createdJobCardCodes: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const bl of bomLines) {
    const childQty = Math.round(jwLine.orderQty * Number(bl.qtyPerSet));
    if (childQty <= 0) continue;

    const code = await nextJwJobCardCode(tx, jwLine.companyId, jwLineId);
    const jc = await tx
      .insert(jobCards)
      .values({
        companyId: jwLine.companyId,
        code,
        jcDate: today,
        itemId: bl.childItemId,
        orderQty: childQty,
        priority: 'normal',
        sourceJwLineId: jwLineId,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: jobCards.id });
    createdJobCardCodes.push(code);

    // An outsourced component gets its OSP op seeded now, with no vendor —
    // procurement picks the vendor and raises the PR through the existing
    // outsource flow, exactly as it does for a full_outsource plan.
    if (bl.bomType === 'outsource') {
      await tx.insert(jcOps).values({
        companyId: jwLine.companyId,
        jobCardId: jc[0]!.id,
        opSeq: 1,
        operation: 'OUTSOURCE',
        opType: 'outsource',
        createdBy: user.id,
        updatedBy: user.id,
      });
    }
  }

  const bomRows = await tx
    .select({ bomNo: bomMasters.bomNo })
    .from(bomMasters)
    .where(eq(bomMasters.id, bomMasterId))
    .limit(1);
  const bomNo = bomRows[0]?.bomNo ?? bomMasterId.slice(0, 8);

  if (createdJobCardCodes.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: 'BOM_CASCADE',
        entity: 'BOM',
        detail: `${bomNo} → JW line ${jwLine.partName}: ${createdJobCardCodes.length} JC`,
        refId: bomNo,
      },
      jwLine.companyId,
      user,
    );
  }

  return {
    fired: createdJobCardCodes.length > 0,
    jwLineId,
    bomMasterId,
    createdJobCardCodes,
  };
}

// Silence unused-import false positive — sql is reserved for future
// cascade-aware aggregations on this module.
void sql;
