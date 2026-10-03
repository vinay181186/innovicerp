// SalesOrder entry for the edit-approval engine (ADR-202, Phase 2b).
//
// RECORD/HEADER level only: this pass stages the SO's own header fields (the set
// the module's EDIT diff emits — SO_HEADER_FIELDS + money). An SO's child lines
// and milestones are NOT staged — a child change is refused by the divert guard
// in service.ts (soChildRowsChanged), and a status move (cancel / draft) is
// refused there too because it needs a reason + blocking-docs check the approval
// flow cannot carry. applyEdit replays the approved subset through
// updateSalesOrderTx, so every SO §20 guard (header FOR UPDATE lock,
// assertUnchangedSinceOpened, the SO_STATUS_MOVES map, blocking-docs-on-cancel,
// per-line version checks, the stock-reservation reconcile) runs exactly as a
// direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateSalesOrderInput } from '@innovic/shared';
import { clients, salesOrders } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { SO_HEADER_FIELDS, SO_MONEY_HEADER_FIELDS } from './edit-log';
import { updateSalesOrderTx } from './service';

const SO_FORM_KEY: AccessFormKey = 'so_create';

/** The customer name a master clientId resolves to, company-scoped — the SO row
 *  stores this snapshot under `customerName`, so both sides of the diff read a
 *  name (the service snapshots it the same way on a client change). */
async function clientNameOf(
  tx: DbTransaction,
  companyId: string,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (!clientId) return null;
  const rows = await tx
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.companyId, companyId)))
    .limit(1);
  return rows[0]?.name ?? null;
}

export const soEditRegistryEntry: DocEditRegistryEntry = {
  formKey: SO_FORM_KEY,

  diffFields(): readonly DiffField[] {
    // The same header fields the History tab shows. `status` is present in the
    // set but never emitted by the snapshots below — a status move is refused at
    // stage time (soChildRowsChanged's sibling guard), so it never diffs here.
    return [...SO_HEADER_FIELDS, ...SO_MONEY_HEADER_FIELDS];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(salesOrders)
      .where(
        and(eq(salesOrders.id, id), eq(salesOrders.companyId, companyId), isNull(salesOrders.deletedAt)),
      )
      .limit(1)
      .for('update');
    const so = rows[0];
    if (!so) return null;
    return {
      doc: { ...so },
      updatedAt: so.updatedAt,
      docCode: so.code,
      // Draft edits apply directly; a cancelled SO is not editable. Everything
      // between is a LIVE document whose edits must be staged.
      isLive: so.status !== 'draft' && so.status !== 'cancelled',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      soDate: d['soDate'],
      customerName: d['customerName'] ?? null,
      clientPoNo: d['clientPoNo'],
      type: d['type'],
      bomMasterId: d['bomMasterId'],
      bomStatus: d['bomStatus'],
      costCenter: d['costCenter'],
      remarks: d['remarks'],
      gstPercent: d['gstPercent'],
    };
  },

  async afterSnapshot(tx, companyId, input, user) {
    const i = input as UpdateSalesOrderInput;
    const h = i.header ?? {};
    const out: Record<string, unknown> = {};
    if (h.soDate !== undefined) out['soDate'] = h.soDate;
    if (h.clientPoNo !== undefined) out['clientPoNo'] = h.clientPoNo ?? null;
    if (h.type !== undefined) out['type'] = h.type;
    if (h.bomMasterId !== undefined) out['bomMasterId'] = h.bomMasterId ?? null;
    if (h.bomStatus !== undefined) out['bomStatus'] = h.bomStatus ?? null;
    if (h.costCenter !== undefined) out['costCenter'] = h.costCenter ?? null;
    if (h.remarks !== undefined) out['remarks'] = h.remarks ?? null;
    // Customer travels as clientId; the SO stores a snapshot name, so resolve it
    // the same way the service does, else fall back to the explicit customerName.
    if (h.clientId !== undefined && h.clientId !== null) {
      out['customerName'] = await clientNameOf(tx, companyId, h.clientId);
    } else if (h.customerName !== undefined) {
      out['customerName'] = h.customerName ?? null;
    }
    // Money only when the actor may see prices — a price-blind payload carries a
    // zod default (18) that would otherwise read as a GST change.
    if (h.gstPercent !== undefined && (await canSeeFormPrice(user, SO_FORM_KEY))) {
      out['gstPercent'] = h.gstPercent;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateSalesOrderInput;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (h[k] !== undefined) fh[k] = h[k];
    };
    for (const field of approvedFields) {
      if (field === 'customerName') {
        // The customer fact travels as clientId (+ its snapshot name).
        copy('clientId');
        copy('customerName');
      } else {
        copy(field);
      }
    }
    if (Object.keys(fh).length === 0) return null;
    return { header: fh, expectedUpdatedAt: input.expectedUpdatedAt };
  },

  async applyEdit(tx, _companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as {
      header: Record<string, unknown>;
      expectedUpdatedAt?: string;
    };
    await updateSalesOrderTx(
      tx,
      id,
      {
        header: filtered.header as UpdateSalesOrderInput['header'],
        expectedUpdatedAt: expectedUpdatedAt ?? undefined,
      },
      user,
      // Record-level only — never a cancel, so no reason is needed here.
      null,
    );
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: salesOrders.id, updatedAt: salesOrders.updatedAt })
      .from(salesOrders)
      .where(and(inArray(salesOrders.id, ids), eq(salesOrders.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
