// OSP auto-PR generation (ADR-039) — React port of legacy _autoGenerateOspPR
// (HTML L13302) + its helper _isOspOperation (L13295).
//
// When a JC op whose name matches a configured OSP process is "started", the
// legacy system auto-creates a JW_OSP purchase request and, when the process
// has a vendor with autoPO enabled, a draft JW PO. The React build routes
// outsource ops through procurement rather than the shop floor, so this is an
// explicit manager-triggered action (POST /op-entry/osp-pr) instead of a
// side-effect of starting a machine — see ADR-039.
//
// The PR↔op link uses the existing FK columns (jc_ops.outsource_pr_id /
// outsource_po_line_id / outsource_status, purchase_requests.source_jc_op_id),
// so no migration is needed. The auto-PO follows the React PR→PO invariant
// (pr.po_id set ⇒ pr.status='po_created'), unlike legacy which keeps the PR
// 'Pending'.

import type { GenerateOspPrResult } from '@innovic/shared';
import { and, eq, isNull, like } from 'drizzle-orm';
import {
  items,
  jcOps,
  jobCards,
  ospProcesses,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  vendors,
} from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

// Sentinel vendor text stored on a JW_OSP PR when its matched OSP process has
// no vendor configured. The PR's vendor_check needs vendorId OR vendorCodeText;
// this keeps the PR valid and flags that a vendor must be picked at PO time.
const NO_VENDOR_TEXT = '(vendor TBD)';

interface OspProcessMatch {
  id: string;
  processName: string;
  vendorId: string | null;
  autoPo: boolean;
}

/** Legacy _isOspOperation (L13295): first configured process whose name is a
 *  substring (case-insensitive) of the operation name. Pure + exported for
 *  unit testing without a DB. */
export function matchOspProcess<T extends { processName: string }>(
  opName: string | null | undefined,
  processes: readonly T[],
): T | null {
  if (!opName) return null;
  const lower = opName.toLowerCase();
  return processes.find((p) => lower.includes(p.processName.toLowerCase())) ?? null;
}

/** Next IN-JWPR-NNNNN / IN-JWPO-NNNNN per company. Highest numeric suffix + 1,
 *  zero-padded to 5 digits (legacy _nextSeriesNo, 5-digit width). */
export async function nextSeriesCode(
  tx: DbTransaction,
  kind: 'pr' | 'po',
  companyId: string,
  prefix: string,
): Promise<string> {
  const rows =
    kind === 'pr'
      ? await tx
          .select({ code: purchaseRequests.code })
          .from(purchaseRequests)
          .where(
            and(
              eq(purchaseRequests.companyId, companyId),
              isNull(purchaseRequests.deletedAt),
              like(purchaseRequests.code, `${prefix}%`),
            ),
          )
      : await tx
          .select({ code: purchaseOrders.code })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.companyId, companyId),
              isNull(purchaseOrders.deletedAt),
              like(purchaseOrders.code, `${prefix}%`),
            ),
          );
  let max = 0;
  for (const r of rows) {
    const m = r.code.slice(prefix.length).match(/^(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return `${prefix}${String(max + 1).padStart(5, '0')}`;
}

/** Core auto-PR/PO generation, run inside an existing transaction.
 *  Throws ValidationError (no OSP match) / ConflictError (already generated) /
 *  NotFoundError (op/JC missing). */
export async function generateOspPrForOp(
  tx: DbTransaction,
  jcOpId: string,
  companyId: string,
  user: AuthContext,
): Promise<GenerateOspPrResult> {
  // 1. Load the op.
  const opRows = await tx
    .select({
      id: jcOps.id,
      jobCardId: jcOps.jobCardId,
      opSeq: jcOps.opSeq,
      operation: jcOps.operation,
      outsourcePrId: jcOps.outsourcePrId,
    })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
    .limit(1);
  const op = opRows[0];
  if (!op) throw new NotFoundError(`Op ${jcOpId} not found`);

  // 2. Match the operation name against configured OSP processes.
  const cfgRows = await tx
    .select({
      id: ospProcesses.id,
      processName: ospProcesses.processName,
      vendorId: ospProcesses.vendorId,
      autoPo: ospProcesses.autoPo,
    })
    .from(ospProcesses)
    .where(and(eq(ospProcesses.companyId, companyId), isNull(ospProcesses.deletedAt)));
  const matched: OspProcessMatch | null = matchOspProcess(op.operation, cfgRows);
  if (!matched) {
    throw new ValidationError(
      `Operation "${op.operation}" does not match any configured OSP process. ` +
        'Configure it under System Settings → OSP Processes.',
    );
  }

  // 3. Duplicate guard — op already linked, or a JW_OSP PR already exists.
  if (op.outsourcePrId) {
    const linked = await tx
      .select({ code: purchaseRequests.code })
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, op.outsourcePrId))
      .limit(1);
    throw new ConflictError(`OSP PR already exists for this op: ${linked[0]?.code ?? 'linked'}`);
  }
  const dup = await tx
    .select({ code: purchaseRequests.code })
    .from(purchaseRequests)
    .where(
      and(
        eq(purchaseRequests.companyId, companyId),
        eq(purchaseRequests.sourceJcOpId, op.id),
        eq(purchaseRequests.prType, 'jw_osp'),
        isNull(purchaseRequests.deletedAt),
      ),
    )
    .limit(1);
  if (dup[0]) throw new ConflictError(`OSP PR already exists for this op: ${dup[0].code}`);

  // 4. Load the JC + its item (code/name) for the PR/PO line.
  const jcRows = await tx
    .select({
      code: jobCards.code,
      orderQty: jobCards.orderQty,
      itemId: jobCards.itemId,
      sourceSoLineId: jobCards.sourceSoLineId,
      itemCode: items.code,
      itemName: items.name,
    })
    .from(jobCards)
    .innerJoin(items, eq(items.id, jobCards.itemId))
    .where(and(eq(jobCards.id, op.jobCardId), eq(jobCards.companyId, companyId)))
    .limit(1);
  const jc = jcRows[0];
  if (!jc) throw new NotFoundError(`Job card for op ${jcOpId} not found`);

  // Vendor snapshot from the matched OSP process (name for the result message).
  let vendorName: string | null = null;
  if (matched.vendorId) {
    const vRows = await tx
      .select({ name: vendors.name })
      .from(vendors)
      .where(eq(vendors.id, matched.vendorId))
      .limit(1);
    vendorName = vRows[0]?.name ?? null;
  }

  // 5. Insert the JW_OSP PR.
  const prCode = await nextSeriesCode(tx, 'pr', companyId, 'IN-JWPR-');
  const prInserted = await tx
    .insert(purchaseRequests)
    .values({
      companyId,
      code: prCode,
      prDate: today(),
      status: 'open',
      prType: 'jw_osp',
      vendorId: matched.vendorId,
      vendorCodeText: matched.vendorId ? null : NO_VENDOR_TEXT,
      itemId: jc.itemId,
      itemCodeText: null,
      itemName: jc.itemName,
      qty: jc.orderQty,
      estCost: '0',
      sourceJcOpId: op.id,
      sourceSoLineId: jc.sourceSoLineId,
      operation: op.operation,
      remarks: `Auto-generated OSP PR for ${op.operation} — needs approval`,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning();
  const pr = prInserted[0]!;

  await emitActivityLog(
    tx,
    {
      action: 'CREATE',
      entity: 'PurchaseRequest',
      detail: `${prCode} [OSP Auto] ${op.operation} → ${jc.code}`,
      refId: prCode,
    },
    companyId,
    user,
  );

  // 6. Link the op to the PR.
  await tx
    .update(jcOps)
    .set({
      outsourcePrId: pr.id,
      outsourceVendorId: matched.vendorId,
      outsourceStatus: 'pr_raised',
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(jcOps.id, op.id));

  // 7. Optional auto draft PO when the process has a vendor + autoPo.
  let poId: string | null = null;
  let poCode: string | null = null;
  if (matched.vendorId && matched.autoPo) {
    poCode = await nextSeriesCode(tx, 'po', companyId, 'IN-JWPO-');
    const poInserted = await tx
      .insert(purchaseOrders)
      .values({
        companyId,
        code: poCode,
        poDate: today(),
        poType: 'job_work',
        vendorId: matched.vendorId,
        vendorCodeText: null,
        status: 'draft',
        prCodeText: prCode,
        remarks: `Auto OSP PO for ${op.operation} — needs approval`,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const po = poInserted[0]!;
    poId = po.id;

    const lineInserted = await tx
      .insert(purchaseOrderLines)
      .values({
        companyId,
        purchaseOrderId: po.id,
        lineNo: 1,
        itemId: jc.itemId,
        itemCodeText: null,
        itemName: jc.itemName,
        qty: jc.orderQty,
        rate: '0.00',
        receivedQty: 0,
        sourceSoLineId: jc.sourceSoLineId,
        sourceJcOpId: op.id,
        lineRemarks: op.operation,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const poLine = lineInserted[0]!;

    // Follow the React PR→PO invariant: po_id set ⇒ status='po_created'.
    await tx
      .update(purchaseRequests)
      .set({ poId: po.id, poCreatedAt: new Date(), status: 'po_created', updatedBy: user.id })
      .where(eq(purchaseRequests.id, pr.id));

    await tx
      .update(jcOps)
      .set({ outsourcePoLineId: poLine.id, outsourceStatus: 'po_created', updatedBy: user.id })
      .where(eq(jcOps.id, op.id));

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseOrder',
        // New-ERP enhancement (beyond legacy, which logs the vendor here, not the
        // JC): carry the JC code so the JC completion feed can trace the OSP PO.
        // Mirrors the PR entry above; the feed matches `detail ILIKE '%<jc.code>%'`.
        detail: `${poCode} [OSP Auto Draft] ${op.operation} → ${jc.code}`,
        refId: poCode,
      },
      companyId,
      user,
    );
  }

  const autoPoCreated = poId !== null;
  const message = autoPoCreated
    ? `OSP PR ${prCode} + draft PO ${poCode} created — both need approval.`
    : matched.vendorId
      ? `OSP PR ${prCode} created — needs approval.`
      : `OSP PR ${prCode} created. No vendor configured for "${matched.processName}" — assign one in Outsource Jobs.`;

  return { prId: pr.id, prCode, poId, poCode, vendorName, autoPoCreated, message };
}

// today() as a plain ISO date — matches the rest of the codebase's `date`
// columns, which store dates without a zone.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
