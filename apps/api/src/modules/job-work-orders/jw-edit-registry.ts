// JobWorkOrder (JWSO) entry for the edit-approval engine (ADR-202, Phase 2b).
//
// RECORD/HEADER level only: this pass stages the JWSO's own header fields (the
// set the module's EDIT diff emits — JW_HEADER_FIELDS). A JWSO's child lines are
// NOT staged — a line change is refused by the divert guard in service.ts
// (jwLinesChanged). JWSO status is server-owned (ADR-203) and never on the
// payload, so there is no status move to stage. applyEdit replays the approved
// subset through updateJobWorkOrderTx, so every JWSO §20 guard (header FOR UPDATE
// lock, assertUnchangedSinceOpened, the customer-immutable-while-used check, the
// per-line merge version checks, the RM wiring, the server-owned status
// recompute) runs exactly as a direct edit.

import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AccessFormKey, UpdateJobWorkOrderInput } from '@innovic/shared';
import { clients, jobWorkOrders } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { JW_HEADER_FIELDS, updateJobWorkOrderTx } from './service';

const JW_FORM_KEY: AccessFormKey = 'jw_create';

/** The customer name a master clientId resolves to, company-scoped — the JWSO
 *  row stores this snapshot under `customerName`, so both sides of the diff read
 *  a name (the service snapshots it the same way on a client change). */
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

export const jwEditRegistryEntry: DocEditRegistryEntry = {
  formKey: JW_FORM_KEY,

  diffFields(): readonly DiffField[] {
    return JW_HEADER_FIELDS;
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(jobWorkOrders)
      .where(
        and(
          eq(jobWorkOrders.id, id),
          eq(jobWorkOrders.companyId, companyId),
          isNull(jobWorkOrders.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const jw = rows[0];
    if (!jw) return null;
    return {
      doc: { ...jw },
      updatedAt: jw.updatedAt,
      docCode: jw.code,
      // Draft edits apply directly; a cancelled JWSO is not editable. Everything
      // between is a LIVE document whose edits must be staged.
      isLive: jw.status !== 'draft' && jw.status !== 'cancelled',
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      jwDate: d['jwDate'],
      customerName: d['customerName'] ?? null,
      clientPoNo: d['clientPoNo'],
      gstPercent: d['gstPercent'],
      remarks: d['remarks'],
    };
  },

  async afterSnapshot(tx, companyId, input, user) {
    const i = input as UpdateJobWorkOrderInput;
    const h = i.header ?? {};
    const out: Record<string, unknown> = {};
    if (h.jwDate !== undefined) out['jwDate'] = h.jwDate;
    if (h.clientPoNo !== undefined) out['clientPoNo'] = h.clientPoNo ?? null;
    if (h.remarks !== undefined) out['remarks'] = h.remarks ?? null;
    // Customer travels as clientId; the JWSO stores a snapshot name, so resolve
    // it the same way the service does, else fall back to explicit customerName.
    if (h.clientId !== undefined && h.clientId !== null) {
      out['customerName'] = await clientNameOf(tx, companyId, h.clientId);
    } else if (h.customerName !== undefined) {
      out['customerName'] = h.customerName ?? null;
    }
    // Money only when the actor may see prices — a price-blind payload would
    // otherwise read as a GST change.
    if (h.gstPercent !== undefined && (await canSeeFormPrice(user, JW_FORM_KEY))) {
      out['gstPercent'] = h.gstPercent;
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateJobWorkOrderInput;
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
    await updateJobWorkOrderTx(
      tx,
      id,
      {
        header: filtered.header as UpdateJobWorkOrderInput['header'],
        expectedUpdatedAt: expectedUpdatedAt ?? undefined,
      },
      user,
    );
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: jobWorkOrders.id, updatedAt: jobWorkOrders.updatedAt })
      .from(jobWorkOrders)
      .where(and(inArray(jobWorkOrders.id, ids), eq(jobWorkOrders.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
