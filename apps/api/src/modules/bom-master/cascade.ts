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
  jobCards,
  purchaseRequests,
  salesOrderLines,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { NotFoundError } from '../../lib/errors';
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

// Silence unused-import false positive — sql is reserved for future
// cascade-aware aggregations on this module.
void sql;
