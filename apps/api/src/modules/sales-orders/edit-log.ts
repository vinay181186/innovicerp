// ADR-197 — the History rows a Sales Order EDIT writes.
//
// Replaces the ADR-184 text trail (edit-summary.ts), which squeezed every
// before → after into the one-line `detail`. Now each change is a structured
// `changes` entry built with diffFields, so the SO's History tab can show it
// as "Order Qty 20 → 10":
//
//   - header: one EDIT row with every header field that moved (CANCEL when the
//     save moved the SO Status to cancelled — then it carries the reason);
//   - each changed line: one EDIT row with `lineRef: Line N` (CANCEL when the
//     line's status moved to cancelled);
//   - a line added by the save: one CREATE row; a line removed: one DELETE row
//     (with the reason when the caller gave one).
//
// Nothing changed → no row at all. Money (Rate, GST %) is compared only when
// the editor may see prices — a price-blind save never moves it anyway.

import { ActivityAction, type ActivityChange, type ActivityChangeValue } from '@innovic/shared';
import type { salesOrderLines, salesOrders } from '../../db/schema';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields, type DiffField } from '../../lib/audit-trail';
import { fmtDate } from '../../lib/format-date';
import { emitActivityLog } from '../activity-log/service';

type SoHeaderRow = typeof salesOrders.$inferSelect;
type SoLineRow = typeof salesOrderLines.$inferSelect;

/** 'component_manufacturing' → 'Component Manufacturing'. */
function words(v: unknown): ActivityChangeValue {
  if (v === null || v === undefined || v === '') return null;
  return String(v)
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function day(v: unknown): ActivityChangeValue {
  if (v === null || v === undefined || v === '') return null;
  return fmtDate(v as string | Date);
}

// Labels from docs/NAMING.md.
const SO_HEADER_FIELDS: readonly DiffField[] = [
  { key: 'soDate', label: 'SO Date', format: day },
  { key: 'customerName', label: 'Customer' },
  { key: 'clientPoNo', label: 'Client PO No.' },
  { key: 'type', label: 'SO Type', format: words },
  { key: 'status', label: 'SO Status', format: words },
  { key: 'bomMasterId', label: 'BOM' },
  { key: 'bomStatus', label: 'BOM Status' },
  { key: 'costCenter', label: 'Cost Centre' },
  { key: 'remarks', label: 'Remarks' },
];
const SO_MONEY_HEADER_FIELDS: readonly DiffField[] = [{ key: 'gstPercent', label: 'GST %' }];

// The customer's drawing revision is never shown alone (NAMING) — the item and
// its Rev are compared together as CODE/REV.
const SO_LINE_FIELDS: readonly DiffField[] = [
  { key: 'codeRev', label: 'CODE/REV' },
  { key: 'partName', label: 'Item Name' },
  { key: 'material', label: 'Material' },
  { key: 'drawingNo', label: 'Drawing No.' },
  { key: 'clientPoLineNo', label: 'POL' },
  { key: 'uom', label: 'UOM' },
  { key: 'orderQty', label: 'Order Qty' },
  { key: 'dueDate', label: 'Due Date', format: day },
  { key: 'status', label: 'Line Status', format: words },
];
const SO_MONEY_LINE_FIELDS: readonly DiffField[] = [{ key: 'rate', label: 'Rate' }];

type LineSnap = SoLineRow & { codeRev: string };

function snap(l: SoLineRow, codeById: Map<string, string>): LineSnap {
  const code = (l.itemId ? codeById.get(l.itemId) : undefined) ?? l.itemCodeText ?? '—';
  return { ...l, codeRev: l.revision ? `${code}/${l.revision}` : code };
}

export async function logSoEdit(
  tx: DbTransaction,
  companyId: string,
  user: AuthContext,
  args: {
    before: SoHeaderRow;
    after: SoHeaderRow;
    /** Null when the save did not carry lines (header-only PATCH). */
    beforeLines: SoLineRow[] | null;
    afterLines: SoLineRow[];
    /** Item id → code for every item on either side. */
    codeById: Map<string, string>;
    showMoney: boolean;
    /** Why — for a cancel, or a line removed. */
    reason: string | null;
  },
): Promise<void> {
  const { before, after, showMoney, reason } = args;
  const entityId = after.id;
  const refId = after.code;

  const headerFields = showMoney
    ? [...SO_HEADER_FIELDS, ...SO_MONEY_HEADER_FIELDS]
    : SO_HEADER_FIELDS;
  const headerChanges = diffFields(before, after, headerFields);
  if (headerChanges.length > 0) {
    const cancelled = after.status === 'cancelled' && before.status !== 'cancelled';
    await emitActivityLog(
      tx,
      {
        action: cancelled ? ActivityAction.Cancel : ActivityAction.Edit,
        entity: 'SalesOrder',
        entityId,
        refId,
        changes: headerChanges,
        reason: cancelled ? reason : null,
        detail: cancelled ? `Cancelled ${refId}` : `Edited ${refId}`,
      },
      companyId,
      user,
    );
  }

  if (args.beforeLines === null) return;

  const lineFields = showMoney ? [...SO_LINE_FIELDS, ...SO_MONEY_LINE_FIELDS] : SO_LINE_FIELDS;
  const beforeById = new Map(args.beforeLines.map((l) => [l.id, snap(l, args.codeById)]));
  const afterIds = new Set(args.afterLines.map((l) => l.id));

  for (const row of [...args.afterLines].sort((x, y) => x.lineNo - y.lineNo)) {
    const line = snap(row, args.codeById);
    const lineRef = `Line ${line.lineNo}`;
    const prev = beforeById.get(line.id);
    if (!prev) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Create,
          entity: 'SalesOrder',
          entityId,
          refId,
          lineRef,
          qty: line.orderQty,
          detail: `Added ${lineRef} (${line.codeRev}) to ${refId}`,
        },
        companyId,
        user,
      );
      continue;
    }
    const changes: ActivityChange[] = diffFields(prev, line, lineFields);
    if (prev.lineNo !== line.lineNo) {
      changes.unshift({ field: 'lineNo', label: 'Ln', before: prev.lineNo, after: line.lineNo });
    }
    if (changes.length === 0) continue;
    const cancelled = line.status === 'cancelled' && prev.status !== 'cancelled';
    await emitActivityLog(
      tx,
      {
        action: cancelled ? ActivityAction.Cancel : ActivityAction.Edit,
        entity: 'SalesOrder',
        entityId,
        refId,
        lineRef,
        qty: line.orderQty,
        changes,
        reason: cancelled ? reason : null,
        detail: `${cancelled ? 'Cancelled' : 'Edited'} ${refId} ${lineRef}`,
      },
      companyId,
      user,
    );
  }

  for (const prev of [...beforeById.values()].sort((x, y) => x.lineNo - y.lineNo)) {
    if (afterIds.has(prev.id)) continue;
    const lineRef = `Line ${prev.lineNo}`;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'SalesOrder',
        entityId,
        refId,
        lineRef,
        qty: prev.orderQty,
        reason,
        detail: `Removed ${lineRef} (${prev.codeRev}) from ${refId}`,
      },
      companyId,
      user,
    );
  }
}
