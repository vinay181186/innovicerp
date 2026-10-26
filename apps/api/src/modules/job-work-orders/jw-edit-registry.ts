// JobWorkOrder (JWSO) entry for the edit-approval engine (ADR-202, Phase 2b;
// line approval 2026-10).
//
// LIVE = open (not draft / cancelled) AND IN USE — a live downstream document
// hangs off it (lib/jw-line-state.ts jwsoInUse). A JWSO nothing uses yet edits
// directly even with the gate on.
//
// Boxes: the JWSO's own header fields (JW_HEADER_FIELDS) and, per line
// (document-edits/line-boxes.ts):
//   line:<lineId>:<attr>   one field of an existing line ("Line 2 · Order Qty")
//   line:add:<n>           a whole new line ("Add line · ABC-12 × 20 · POL 10")
//   line:remove:<lineId>   a line removed ("Remove line 3 · ABC-12")
// Line labels are the JWSO History's own (jwLineFields). Status is server-owned
// (ADR-203) and never on the payload, so there is no status box.
//
// applyEdit rebuilds the line array from the CURRENT lines, overwrites only the
// approved boxes, and replays it through updateJobWorkOrderTx — so every guard
// of a direct edit runs (ADR-203 in-use line locks, the Order Qty floor, remove
// of an in-use line refused, Rev never backwards, header lock, RM wiring, status
// recompute). The same writer is rehearsed at request time (service.ts
// updateJobWorkOrderOrStage), so a doomed change is refused before it is staged.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  AccessFormKey,
  JobWorkOrderLineInput,
  UpdateJobWorkOrderInput,
} from '@innovic/shared';
import { clients, items, jobWorkOrderLines, jobWorkOrders } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import { jwsoInUse } from '../../lib/jw-line-state';
import {
  type ChildBoxSpec,
  type CurrentChild,
  type ProposedChild,
  approvedChildBoxes,
  childAfter,
  childBefore,
  childDiffFields,
  isChildKey,
  parseChildKey,
  addOrdinals,
  rebuildChildRows,
} from '../document-edits/line-boxes';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { JW_HEADER_FIELDS, jwLineFields, updateJobWorkOrderTx } from './service';

const JW_FORM_KEY: AccessFormKey = 'jw_create';

/** The frozen payload: the edit input plus the item codes the request-time
 *  precheck resolved (so the add box can name its item). */
type JwStagedPayload = UpdateJobWorkOrderInput & { boxItemCodes?: Record<string, string> };

// The line box attrs = the input fields, labelled as the JWSO History labels
// them (jwLineFields). `rmItemId` is server-derived, never an input → no box.
// `itemId` is compared as the item CODE on both sides, so it needs no format.
// Built on first use, not at import: this file and ./service.ts sit in an
// import cycle through the engine, so nothing of service.ts runs at load time.
let lineSpecMemo: ChildBoxSpec | null = null;
function lineSpec(): ChildBoxSpec {
  lineSpecMemo ??= {
    prefix: 'line',
    rowWord: 'Line',
    attrs: jwLineFields(() => null)
      .filter((f) => f.key !== 'rmItemId')
      .map((f) => ({
        attr: f.key,
        label: f.label,
        ...(f.key !== 'itemId' && f.format ? { format: f.format } : {}),
      })),
  };
  return lineSpecMemo;
}
const LINE_PREFIX = 'line';

const trimmed = (v: string | null | undefined): string | null => v?.trim() || null;

/** One JWSO line as loadForDiff locks it. */
type JwLineRow = typeof jobWorkOrderLines.$inferSelect & { itemCode: string | null };

async function itemCodesOf(
  tx: DbTransaction,
  companyId: string,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique)));
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

function currentChildren(target: DocEditTarget): CurrentChild[] {
  const lines = (target.doc['lines'] as JwLineRow[] | undefined) ?? [];
  return lines.map((l) => {
    const code = l.itemCode ?? l.partName;
    return {
      id: l.id,
      no: l.lineNo,
      values: {
        itemId: l.itemCode,
        partName: trimmed(l.partName),
        material: trimmed(l.material),
        drawingNo: trimmed(l.drawingNo),
        clientPoLineNo: trimmed(l.clientPoLineNo),
        remarks: trimmed(l.remarks),
        revision: l.revision,
        drawingFilePath: l.drawingFilePath,
        uom: l.uom,
        orderQty: l.orderQty,
        rate: l.rate,
        dueDate: l.dueDate,
        sourceBomMasterId: l.sourceBomMasterId,
      },
      summary: `${code} × ${l.orderQty}`,
      removeName: code,
    };
  });
}

/** The proposed lines as flat maps. Only fields the payload carries are set:
 *  the writer leaves an omitted field alone, so an omission is not a change.
 *  Rate only when `showMoney` (a price-blind payload's rate is ignored by the
 *  writer, so it must not read as a change). */
function proposedChildren(
  lines: readonly JobWorkOrderLineInput[],
  codeOf: (itemId: string) => string | null,
  showMoney: boolean,
): ProposedChild[] {
  return lines.map((l) => {
    const code = codeOf(l.itemId) ?? l.partName;
    const v: Record<string, unknown> = {
      itemId: codeOf(l.itemId) ?? l.itemId,
      partName: trimmed(l.partName),
      clientPoLineNo: trimmed(l.clientPoLineNo),
      orderQty: l.orderQty,
    };
    if (l.material !== undefined) v['material'] = trimmed(l.material);
    if (l.drawingNo !== undefined) v['drawingNo'] = trimmed(l.drawingNo);
    if (l.remarks !== undefined) v['remarks'] = trimmed(l.remarks);
    if (l.revision !== undefined) v['revision'] = l.revision;
    if (l.drawingFilePath !== undefined) v['drawingFilePath'] = l.drawingFilePath;
    if (l.uom !== undefined) v['uom'] = l.uom;
    if (showMoney && l.rate !== undefined) v['rate'] = l.rate;
    if (l.dueDate !== undefined) v['dueDate'] = l.dueDate;
    if (l.sourceBomMasterId !== undefined) v['sourceBomMasterId'] = l.sourceBomMasterId;
    const pol = trimmed(l.clientPoLineNo);
    return {
      id: l.id,
      values: v,
      summary: `${code} × ${l.orderQty}${pol ? ` · POL ${pol}` : ''}`,
    };
  });
}

/** A current line as a writer input carrying its CURRENT values — the base an
 *  approved box overwrites. */
function lineInputFromRow(c: typeof jobWorkOrderLines.$inferSelect): JobWorkOrderLineInput {
  return {
    id: c.id,
    // Legacy lines may carry no item; the writer compares it as stored.
    itemId: c.itemId as string,
    partName: c.partName,
    material: c.material,
    drawingNo: c.drawingNo,
    clientPoLineNo: c.clientPoLineNo as string,
    remarks: c.remarks,
    revision: c.revision,
    drawingFilePath: c.drawingFilePath,
    uom: c.uom as JobWorkOrderLineInput['uom'],
    orderQty: c.orderQty,
    rate: Number(c.rate),
    dueDate: c.dueDate,
    ...(c.sourceBomMasterId ? { sourceBomMasterId: c.sourceBomMasterId } : {}),
  };
}

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

  // A line ADDED with a rate: approving it writes that rate, so a price-blind
  // approver may reject it but not approve it. The box shows no money.
  carriesPrice(field, proposedPayload) {
    const k = parseChildKey(LINE_PREFIX, field);
    if (k?.kind !== 'add') return false;
    const lines = (proposedPayload as JwStagedPayload).lines ?? [];
    const added = addOrdinals(lines).find((a) => a.n === k.n)?.row;
    return Number(added?.rate ?? 0) !== 0;
  },

  diffFields(target, proposedInput): readonly DiffField[] {
    const payload = proposedInput as JwStagedPayload | undefined;
    const codes = payload?.boxItemCodes ?? {};
    const proposed = payload?.lines
      ? proposedChildren(payload.lines, (id) => codes[id] ?? null, false)
      : null;
    return [...JW_HEADER_FIELDS, ...childDiffFields(lineSpec(), currentChildren(target), proposed)];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    // Header first, then its lines — the writer's lock order.
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
    const lineRows = await tx
      .select()
      .from(jobWorkOrderLines)
      .where(
        and(
          eq(jobWorkOrderLines.jobWorkOrderId, id),
          eq(jobWorkOrderLines.companyId, companyId),
          isNull(jobWorkOrderLines.deletedAt),
        ),
      )
      .orderBy(asc(jobWorkOrderLines.lineNo))
      .for('update');
    const codeById = await itemCodesOf(
      tx,
      companyId,
      lineRows.map((l) => l.itemId),
    );
    const lines: JwLineRow[] = lineRows.map((l) => ({
      ...l,
      itemCode: (l.itemId ? codeById.get(l.itemId) : undefined) ?? l.itemCodeText,
    }));
    const open = jw.status !== 'draft' && jw.status !== 'cancelled';
    return {
      doc: { ...jw, lines },
      updatedAt: jw.updatedAt,
      docCode: jw.code,
      // Draft edits apply directly; a cancelled JWSO is not editable; an open
      // JWSO nothing uses yet edits directly too. Only an IN-USE one is staged.
      isLive: open && (await jwsoInUse(tx, companyId, id)),
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
      ...childBefore(lineSpec(), currentChildren(target)),
    };
  },

  async afterSnapshot(tx, companyId, input, user, target, opts) {
    const i = input as JwStagedPayload;
    const h = i.header ?? {};
    const showMoney = opts?.allPrices || (await canSeeFormPrice(user, JW_FORM_KEY));
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
    if (h.gstPercent !== undefined && showMoney) out['gstPercent'] = h.gstPercent;

    if (i.lines !== undefined && target) {
      const codeById = await itemCodesOf(
        tx,
        companyId,
        i.lines.map((l) => l.itemId),
      );
      const proposed = proposedChildren(i.lines, (id) => codeById.get(id) ?? null, showMoney);
      Object.assign(out, childAfter(lineSpec(), currentChildren(target), proposed));
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as JwStagedPayload;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (h[k] !== undefined) fh[k] = h[k];
    };
    const lineFields: string[] = [];
    for (const field of approvedFields) {
      if (isChildKey(LINE_PREFIX, field)) lineFields.push(field);
      else if (field === 'customerName') {
        // The customer fact travels as clientId (+ its snapshot name).
        copy('clientId');
        copy('customerName');
      } else {
        copy(field);
      }
    }
    if (Object.keys(fh).length === 0 && lineFields.length === 0) return null;
    return {
      header: fh,
      approvedLineFields: lineFields,
      proposedLines: input.lines ?? [],
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as {
      header: Record<string, unknown>;
      approvedLineFields?: string[];
      proposedLines?: JobWorkOrderLineInput[];
      expectedUpdatedAt?: string;
    };
    // Per-box drift was resolved by the engine under this tx's locks, so the
    // writer's whole-row version check sees the CURRENT token.
    const payload: UpdateJobWorkOrderInput = {
      header: filtered.header as UpdateJobWorkOrderInput['header'],
      expectedUpdatedAt: expectedUpdatedAt ?? undefined,
    };
    const approved = approvedChildBoxes(LINE_PREFIX, filtered.approvedLineFields ?? []);
    if (approved.any) {
      // The CURRENT lines (already locked by loadForDiff in this tx), each kept
      // at its current values unless a box on it was approved.
      const current = await tx
        .select()
        .from(jobWorkOrderLines)
        .where(
          and(
            eq(jobWorkOrderLines.jobWorkOrderId, id),
            eq(jobWorkOrderLines.companyId, companyId),
            isNull(jobWorkOrderLines.deletedAt),
          ),
        )
        .orderBy(asc(jobWorkOrderLines.lineNo));
      payload.lines = rebuildChildRows(
        approved,
        current.map((c) => ({ id: c.id, input: lineInputFromRow(c) })),
        filtered.proposedLines ?? [],
        (row, p, attr) => {
          const key = attr as keyof JobWorkOrderLineInput;
          if (p[key] !== undefined) (row as Record<string, unknown>)[key] = p[key];
        },
      );
    }
    await updateJobWorkOrderTx(tx, id, payload, user);
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
