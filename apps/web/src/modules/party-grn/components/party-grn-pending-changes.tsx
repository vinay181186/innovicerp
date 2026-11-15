// ADR-202 — edits staged against one Party GRN and waiting for a decision:
// current value → proposed value, in amber, per header field and per waiting
// line. Renders nothing when nothing is pending. Moved here from the old
// row-expand panel (party-grn-expand.tsx, removed with ADR-294) unchanged; the
// detail page (routes/detail.tsx) shows it under the header.

import type { PartyGrnLine } from '@innovic/shared';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
  linePendingChange,
} from '@/modules/document-edits/components/pending-change-chip';

const HEADER_FIELDS = [
  { field: 'grnDate', label: 'GRN Date' },
  { field: 'dcNo', label: 'Customer Challan No.' },
  { field: 'receivedBy', label: 'Received By' },
  { field: 'remarks', label: 'GRN Remarks' },
] as const;

export function PartyGrnPendingChanges({
  grnId,
  lines,
}: {
  grnId: string;
  lines: PartyGrnLine[];
}): React.JSX.Element | null {
  const pendingEdit = usePendingEditForDoc('PartyGrn', grnId);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  if (pendingChanges.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-1)',
        fontSize: 'var(--fs-xs)',
        margin: '0 0 var(--sp-2)',
        padding: 'var(--sp-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg2)',
      }}
    >
      <b className="text2">Changes awaiting approval</b>
      {HEADER_FIELDS.map(({ field, label }) => {
        const c = headerPendingChange(pendingChanges, field);
        if (!c) return null;
        return (
          <div key={field}>
            <span className="text3">{label}:</span>{' '}
            <span>{c.before == null || c.before === '' ? '—' : String(c.before)}</span>
            <PendingChangeChip after={c.after} />
          </div>
        );
      })}
      {lines.map((l) => {
        const qc = linePendingChange(pendingChanges, l.id, 'qty');
        const rm = linePendingChange(pendingChanges, l.id, 'remarks');
        if (!qc && !rm) return null;
        return (
          <div key={l.id}>
            {qc ? (
              <div>
                <span className="text3">
                  Ln {l.lineNo} · {l.partyMaterialCodeText} — Received Qty:
                </span>{' '}
                <span className="mono">{l.receivedQty}</span>
                <PendingChangeChip after={qc.after} />
              </div>
            ) : null}
            {rm ? (
              <div>
                <span className="text3">Ln {l.lineNo} — Remarks:</span>{' '}
                <span>{l.remarks == null || l.remarks === '' ? '—' : l.remarks}</span>
                <PendingChangeChip after={rm.after} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
