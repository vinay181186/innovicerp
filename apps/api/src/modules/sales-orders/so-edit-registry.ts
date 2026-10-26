// SalesOrder entry for the edit-approval engine (ADR-202, Phase 2b; line
// approval 2026-10).
//
// LIVE = open (not draft / cancelled) AND IN USE — live downstream work hangs
// off it (line-commitments.ts soInUse). An SO nothing uses yet edits directly
// even with the gate on.
//
// Boxes: the SO's own header fields (SO_HEADER_FIELDS + money — SO Status
// included: a status move is one header box) and, through
// document-edits/line-boxes.ts:
//   line:<lineId>:<attr>   one field of an existing line ("Line 2 · Order Qty")
//   line:add:<n>           a whole new line ("Add line · ABC-12 × 20 · POL 10")
//   line:remove:<lineId>   a line removed ("Remove line 3 · ABC-12")
//   ms:<msId>:<attr>       one field of a Delivery Schedule lot ("Lot 2 · Qty")
//   ms:add:<n>             a lot added ("Add lot · Lot 3 × 50")
//   ms:remove:<msId>       a lot removed ("Remove lot 2")
// Line labels are the SO History's own (edit-log.ts SO_LINE_FIELDS — item and
// Rev together as CODE/REV, one box).
//
// applyEdit rebuilds the line / lot arrays from the CURRENT rows, overwrites
// only the approved boxes, and replays through updateSalesOrderTx — so every SO
// guard of a direct edit runs (header lock, SO_STATUS_MOVES, blocking docs on
// back-to-draft, ADR-184 commitments on remove / qty cut / item swap, ML-plan
// holds, Rev never backwards, stock-reservation reconcile). The same writer is
// rehearsed at request time (service.ts updateSalesOrderOrStage).

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  type AccessFormKey,
  type SalesOrderLineInput,
  type SalesOrderMilestoneInput,
  type UpdateSalesOrderInput,
  internalSoNoTakenMessage,
  normaliseInternalSoNo,
} from '@innovic/shared';
import { clients, items, salesOrderLines, salesOrders, soMilestones } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import type { DiffField } from '../../lib/audit-trail';
import { ConflictError } from '../../lib/errors';
import {
  type ChildBoxSpec,
  type CurrentChild,
  type ProposedChild,
  addOrdinals,
  approvedChildBoxes,
  childAfter,
  childBefore,
  childDiffFields,
  isChildKey,
  parseChildKey,
  rebuildChildRows,
} from '../document-edits/line-boxes';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import {
  SO_HEADER_FIELDS,
  SO_LINE_FIELDS,
  SO_MONEY_HEADER_FIELDS,
  SO_MONEY_LINE_FIELDS,
} from './edit-log';
import { soInUse } from './line-commitments';
import { isInternalSoNoViolation, updateSalesOrderTx } from './service';

const SO_FORM_KEY: AccessFormKey = 'so_create';
const LINE_PREFIX = 'line';
const MS_PREFIX = 'ms';

/** The frozen payload: the edit input, the requester's edit reason, and the
 *  item codes the request-time precheck resolved (for the add box's label). */
type SoStagedPayload = UpdateSalesOrderInput & {
  reason?: string;
  boxItemCodes?: Record<string, string>;
};

const fileName = (v: unknown): string | null =>
  v == null || v === '' ? null : (String(v).split('/').pop() ?? String(v));

// Built on first use, not at import: this file and ./service.ts sit in an
// import cycle through the engine.
let specMemo: { line: ChildBoxSpec; ms: ChildBoxSpec } | null = null;
function specs(): { line: ChildBoxSpec; ms: ChildBoxSpec } {
  specMemo ??= {
    line: {
      prefix: LINE_PREFIX,
      rowWord: 'Line',
      attrs: [
        { attr: 'lineNo', label: 'Ln' },
        ...[...SO_LINE_FIELDS, ...SO_MONEY_LINE_FIELDS].map((f) => ({
          attr: f.key,
          label: f.label,
          ...(f.format ? { format: f.format } : {}),
        })),
        { attr: 'drawingFilePath', label: 'Drawing File', format: fileName },
        {
          attr: 'sourceBomMasterId',
          label: 'Assembly BOM',
          format: (v: unknown) => (v == null || v === '' ? null : 'Linked'),
        },
      ],
    },
    ms: {
      prefix: MS_PREFIX,
      rowWord: 'Lot',
      // Labels as on the SO form's Delivery Schedule grid.
      attrs: [
        { attr: 'lotNo', label: 'Lot No.' },
        { attr: 'qty', label: 'Qty' },
        { attr: 'dueDate', label: 'Due Date' },
        { attr: 'remarks', label: 'Remarks' },
      ],
    },
  };
  return specMemo;
}

const trimmed = (v: string | null | undefined): string | null => v?.trim() || null;
const codeRevOf = (code: string | null, revision: string | null | undefined): string | null => {
  const c = code ?? '—';
  return revision ? `${c}/${revision}` : c;
};

type SoLineRow = typeof salesOrderLines.$inferSelect & { itemCode: string | null };
type SoMsRow = typeof soMilestones.$inferSelect;

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

function currentLines(target: DocEditTarget): CurrentChild[] {
  const lines = (target.doc['lines'] as SoLineRow[] | undefined) ?? [];
  return lines.map((l) => {
    const code = l.itemCode ?? l.partName;
    return {
      id: l.id,
      no: l.lineNo,
      values: {
        lineNo: l.lineNo,
        codeRev: codeRevOf(l.itemCode, l.revision),
        partName: trimmed(l.partName),
        material: trimmed(l.material),
        drawingNo: trimmed(l.drawingNo),
        clientPoLineNo: trimmed(l.clientPoLineNo),
        remarks: trimmed(l.remarks),
        uom: l.uom,
        orderQty: l.orderQty,
        dueDate: l.dueDate,
        status: l.status,
        rate: l.rate,
        drawingFilePath: l.drawingFilePath,
        sourceBomMasterId: l.sourceBomMasterId,
      },
      summary: `${code} × ${l.orderQty}`,
      removeName: code,
    };
  });
}

/** The proposed lines as flat maps — only the fields the payload carries (the
 *  writer leaves an omitted one alone). Rate only when `showMoney`: the SO
 *  writer ignores a price-blind caller's rate on an existing line. */
function proposedLines(
  lines: readonly SalesOrderLineInput[],
  codeOf: (l: SalesOrderLineInput) => string | null,
  showMoney: boolean,
): ProposedChild[] {
  return lines.map((l) => {
    const code = codeOf(l);
    const v: Record<string, unknown> = {
      codeRev: codeRevOf(code, l.revision),
      partName: trimmed(l.partName),
      clientPoLineNo: trimmed(l.clientPoLineNo),
      orderQty: l.orderQty,
      uom: l.uom,
    };
    if (l.lineNo !== undefined) v['lineNo'] = l.lineNo;
    if (l.material !== undefined) v['material'] = trimmed(l.material);
    if (l.drawingNo !== undefined) v['drawingNo'] = trimmed(l.drawingNo);
    if (l.remarks !== undefined) v['remarks'] = trimmed(l.remarks);
    if (l.dueDate !== undefined) v['dueDate'] = l.dueDate;
    if (l.status !== undefined) v['status'] = l.status;
    if (showMoney && l.rate !== undefined) v['rate'] = l.rate;
    if (l.drawingFilePath !== undefined) v['drawingFilePath'] = l.drawingFilePath;
    if (l.sourceBomMasterId !== undefined) v['sourceBomMasterId'] = l.sourceBomMasterId;
    const pol = trimmed(l.clientPoLineNo);
    return {
      id: l.id,
      values: v,
      summary: `${code ?? l.partName} × ${l.orderQty}${pol ? ` · POL ${pol}` : ''}`,
    };
  });
}

function currentMilestones(target: DocEditTarget): CurrentChild[] {
  const ms = (target.doc['milestones'] as SoMsRow[] | undefined) ?? [];
  return ms.map((m) => ({
    id: m.id,
    no: m.lotNo,
    values: {
      lotNo: m.lotNo,
      qty: m.qty,
      dueDate: m.dueDate,
      remarks: trimmed(m.remarks),
    },
    summary: `Lot ${m.lotNo} × ${m.qty}`,
    removeName: null,
  }));
}

/** Every lot field is written on save (an absent due date / remarks clears it —
 *  mergeMilestones), so every field is on the proposed map. */
function proposedMilestones(ms: readonly SalesOrderMilestoneInput[]): ProposedChild[] {
  return ms.map((m) => ({
    id: m.id,
    values: {
      lotNo: m.lotNo,
      qty: m.qty,
      dueDate: m.dueDate ?? null,
      remarks: trimmed(m.remarks),
    },
    summary: `Lot ${m.lotNo} × ${m.qty}`,
  }));
}

/** A current line as a writer input carrying its CURRENT values. Status and
 *  Assembly BOM are left out (absent = unchanged) unless a box sets them. */
function lineInputFromRow(c: typeof salesOrderLines.$inferSelect): SalesOrderLineInput {
  return {
    id: c.id,
    lineNo: c.lineNo,
    ...(c.itemId ? { itemId: c.itemId } : c.itemCodeText ? { itemCodeText: c.itemCodeText } : {}),
    partName: c.partName,
    ...(c.material != null ? { material: c.material } : {}),
    drawingNo: c.drawingNo,
    revision: c.revision,
    drawingFilePath: c.drawingFilePath,
    uom: c.uom as SalesOrderLineInput['uom'],
    orderQty: c.orderQty,
    rate: Number(c.rate),
    ...(c.dueDate ? { dueDate: c.dueDate } : {}),
    clientPoLineNo: c.clientPoLineNo as string,
    ...(c.remarks != null ? { remarks: c.remarks } : {}),
  } as SalesOrderLineInput;
}

/** One approved line box copied onto the rebuilt line. CODE/REV carries the
 *  item AND the customer's Rev (one fact pair, one box). */
function applyLineAttr(row: SalesOrderLineInput, p: SalesOrderLineInput, attr: string): void {
  const r = row as Record<string, unknown>;
  if (attr === 'codeRev') {
    if (p.itemId) {
      r['itemId'] = p.itemId;
      delete r['itemCodeText'];
    } else if (p.itemCodeText) {
      delete r['itemId'];
      r['itemCodeText'] = p.itemCodeText;
    }
    r['revision'] = p.revision;
    return;
  }
  const v = (p as Record<string, unknown>)[attr];
  if (v !== undefined) r[attr] = v;
}

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

  // A line ADDED with a rate: approving it writes that rate, so a price-blind
  // approver may reject it but not approve it. The box shows no money.
  carriesPrice(field, proposedPayload) {
    const k = parseChildKey(LINE_PREFIX, field);
    if (k?.kind !== 'add') return false;
    const lines = (proposedPayload as SoStagedPayload).lines ?? [];
    const added = addOrdinals(lines).find((a) => a.n === k.n)?.row;
    return Number(added?.rate ?? 0) !== 0;
  },

  diffFields(target, proposedInput): readonly DiffField[] {
    const payload = proposedInput as SoStagedPayload | undefined;
    const codes = payload?.boxItemCodes ?? {};
    const lines = payload?.lines
      ? proposedLines(
          payload.lines,
          (l) => (l.itemId ? (codes[l.itemId] ?? null) : (l.itemCodeText ?? null)),
          false,
        )
      : null;
    const ms = payload?.milestones ? proposedMilestones(payload.milestones) : null;
    return [
      ...SO_HEADER_FIELDS,
      ...SO_MONEY_HEADER_FIELDS,
      ...childDiffFields(specs().line, currentLines(target), lines),
      ...childDiffFields(specs().ms, currentMilestones(target), ms),
    ];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    // Header first, then its lines — the writer's lock order.
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
    const lineRows = await tx
      .select()
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.salesOrderId, id),
          eq(salesOrderLines.companyId, companyId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .orderBy(asc(salesOrderLines.lineNo))
      .for('update');
    // Lots are written only under the header lock held above.
    const milestones = await tx
      .select()
      .from(soMilestones)
      .where(and(eq(soMilestones.salesOrderId, id), isNull(soMilestones.deletedAt)))
      .orderBy(asc(soMilestones.lotNo));
    const codeById = await itemCodesOf(
      tx,
      companyId,
      lineRows.map((l) => l.itemId),
    );
    const lines: SoLineRow[] = lineRows.map((l) => ({
      ...l,
      itemCode: (l.itemId ? codeById.get(l.itemId) : undefined) ?? l.itemCodeText,
    }));
    const open = so.status !== 'draft' && so.status !== 'cancelled';
    return {
      doc: { ...so, lines, milestones },
      updatedAt: so.updatedAt,
      docCode: so.code,
      // Draft edits apply directly; a cancelled SO is not editable; an open SO
      // nothing uses yet edits directly too. Only an IN-USE one is staged.
      isLive: open && (await soInUse(tx, companyId, id)),
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    return {
      internalSoNo: d['internalSoNo'] ?? null,
      soDate: d['soDate'],
      customerName: d['customerName'] ?? null,
      clientPoNo: d['clientPoNo'],
      type: d['type'],
      status: d['status'],
      bomMasterId: d['bomMasterId'],
      bomStatus: d['bomStatus'],
      costCenter: d['costCenter'],
      remarks: d['remarks'],
      gstPercent: d['gstPercent'],
      ...childBefore(specs().line, currentLines(target)),
      ...childBefore(specs().ms, currentMilestones(target)),
    };
  },

  async afterSnapshot(tx, companyId, input, user, target, opts) {
    const i = input as SoStagedPayload;
    const h = i.header ?? {};
    const showMoney = opts?.allPrices || (await canSeeFormPrice(user, SO_FORM_KEY));
    const out: Record<string, unknown> = {};
    // ADR-207 — the schema already normalised it (trim + upper-case "SO-").
    if (h.internalSoNo !== undefined) out['internalSoNo'] = h.internalSoNo;
    if (h.soDate !== undefined) out['soDate'] = h.soDate;
    if (h.clientPoNo !== undefined) out['clientPoNo'] = h.clientPoNo ?? null;
    if (h.type !== undefined) out['type'] = h.type;
    // A status move is one header box; the writer's SO_STATUS_MOVES and
    // blocking-documents checks run on it at request (rehearsal) and approval.
    if (h.status !== undefined) out['status'] = h.status;
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
    if (h.gstPercent !== undefined && showMoney) out['gstPercent'] = h.gstPercent;

    if (target && i.lines !== undefined) {
      const codeById = await itemCodesOf(
        tx,
        companyId,
        i.lines.map((l) => l.itemId),
      );
      const proposed = proposedLines(
        i.lines,
        (l) => (l.itemId ? (codeById.get(l.itemId) ?? null) : (l.itemCodeText?.trim() ?? null)),
        showMoney,
      );
      Object.assign(out, childAfter(specs().line, currentLines(target), proposed));
    }
    if (target && i.milestones !== undefined) {
      Object.assign(
        out,
        childAfter(specs().ms, currentMilestones(target), proposedMilestones(i.milestones)),
      );
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as SoStagedPayload;
    const h = (input.header ?? {}) as Record<string, unknown>;
    const fh: Record<string, unknown> = {};
    const copy = (k: string): void => {
      if (h[k] !== undefined) fh[k] = h[k];
    };
    const childFields: string[] = [];
    for (const field of approvedFields) {
      if (isChildKey(LINE_PREFIX, field) || isChildKey(MS_PREFIX, field)) childFields.push(field);
      else if (field === 'customerName') {
        // The customer fact travels as clientId (+ its snapshot name).
        copy('clientId');
        copy('customerName');
      } else {
        copy(field);
      }
    }
    if (Object.keys(fh).length === 0 && childFields.length === 0) return null;
    // The requester's edit reason (frozen into the payload by the SO OrStage)
    // goes on the EDIT history row the writer records.
    return {
      header: fh,
      approvedChildFields: childFields,
      proposedLines: input.lines ?? [],
      proposedMilestones: input.milestones ?? [],
      expectedUpdatedAt: input.expectedUpdatedAt,
      reason: typeof input.reason === 'string' ? input.reason : null,
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as {
      header: Record<string, unknown>;
      approvedChildFields?: string[];
      proposedLines?: SalesOrderLineInput[];
      proposedMilestones?: SalesOrderMilestoneInput[];
      expectedUpdatedAt?: string;
      reason?: string | null;
    };
    const header = filtered.header as UpdateSalesOrderInput['header'];
    // Per-box drift was resolved by the engine under this tx's locks, so the
    // writer's whole-row version check sees the CURRENT token.
    const payload: UpdateSalesOrderInput = {
      header,
      expectedUpdatedAt: expectedUpdatedAt ?? undefined,
    };
    const approvedFields = filtered.approvedChildFields ?? [];

    const lineBoxes = approvedChildBoxes(LINE_PREFIX, approvedFields);
    if (lineBoxes.any) {
      const current = await tx
        .select()
        .from(salesOrderLines)
        .where(
          and(
            eq(salesOrderLines.salesOrderId, id),
            eq(salesOrderLines.companyId, companyId),
            isNull(salesOrderLines.deletedAt),
          ),
        )
        .orderBy(asc(salesOrderLines.lineNo));
      payload.lines = rebuildChildRows(
        lineBoxes,
        current.map((c) => ({ id: c.id, input: lineInputFromRow(c) })),
        filtered.proposedLines ?? [],
        applyLineAttr,
      );
    }

    const msBoxes = approvedChildBoxes(MS_PREFIX, approvedFields);
    if (msBoxes.any) {
      const current = await tx
        .select()
        .from(soMilestones)
        .where(and(eq(soMilestones.salesOrderId, id), isNull(soMilestones.deletedAt)))
        .orderBy(asc(soMilestones.lotNo));
      payload.milestones = rebuildChildRows(
        msBoxes,
        current.map((m) => ({
          id: m.id,
          input: {
            id: m.id,
            lotNo: m.lotNo,
            qty: m.qty,
            ...(m.dueDate ? { dueDate: m.dueDate } : {}),
            ...(m.remarks != null ? { remarks: m.remarks } : {}),
          },
        })),
        filtered.proposedMilestones ?? [],
        // Every lot field is written on save, so an absent value is a clear.
        (row, p, attr) => {
          (row as Record<string, unknown>)[attr] = (p as Record<string, unknown>)[attr];
        },
      );
    }

    try {
      await updateSalesOrderTx(
        tx,
        id,
        payload,
        user,
        // Never a cancel; the reason is the requester's edit note, written on
        // the EDIT history row.
        filtered.reason ?? null,
      );
    } catch (e) {
      // ADR-207 — another SO took this Internal SO No. between staging and
      // approval (race past assertInternalSoNoFree): a 409, not a 500.
      if (isInternalSoNoViolation(e) && typeof header.internalSoNo === 'string') {
        throw new ConflictError(
          internalSoNoTakenMessage(normaliseInternalSoNo(header.internalSoNo)),
        );
      }
      throw e;
    }
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
