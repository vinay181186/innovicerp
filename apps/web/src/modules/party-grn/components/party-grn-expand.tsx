// What the ▸ row reveals under a Party Material GRN (ADR-199 fit table). The
// list row carries only the header aggregates, so the per-line QC split is
// fetched lazily on expand (usePartyGrnDetail — there is no detail page, only
// GET /party-grn/:id). Shows the Received By / Remarks meta line the old card
// carried, the per-line QC table (nested compact DataTable), then the receipt's
// own History (ADR-197).

import type { PartyGrnLine, PartyGrnListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDateTime } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { DocumentHistory } from '@/components/shared/document-history';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
  linePendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { usePartyGrnDetail } from '../api';
import { EditPartyGrnModal } from './edit-party-grn-modal';

function lineColumns(): DataTableColumn<PartyGrnLine>[] {
  return [
    {
      id: 'line_no',
      header: 'Ln',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => l.lineNo,
    },
    {
      id: 'party_material',
      header: 'Customer RM',
      kind: 'code',
      nowrap: true,
      render: (l) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {l.partyMaterialCodeText}
        </span>
      ),
    },
    {
      id: 'party_material_name',
      header: 'Customer Material Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (l) => l.partyMaterialName ?? '—',
      title: (l) => l.partyMaterialName ?? '',
    },
    {
      id: 'jwso_line',
      header: 'JWSO Line',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: 'var(--purple)' }}>
          {l.jwLineNoText ? `L${l.jwLineNoText}` : '—'}
        </span>
      ),
    },
    {
      id: 'received_qty',
      header: 'Received Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      className: 'mono',
      nowrap: true,
      render: (l) => l.receivedQty,
    },
    {
      id: 'accepted_qty',
      header: 'Accepted Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green)',
      className: 'mono fw-700',
      nowrap: true,
      // ADR-203: 0 until Incoming QC — show a dash rather than a false zero.
      render: (l) =>
        l.qcAt == null ? (
          <span className="text3">—</span>
        ) : (
          <span style={{ color: 'var(--green2)' }}>{l.acceptedQty}</span>
        ),
    },
    {
      id: 'rejected_qty',
      header: 'Deviated Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--red)',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: l.rejectedQty > 0 ? 'var(--red2)' : 'var(--text3)' }}>
          {l.rejectedQty > 0 ? l.rejectedQty : '—'}
        </span>
      ),
    },
    {
      // ADR-203 (owner D3): rejected pieces already sent back to the customer.
      id: 'rejected_returned_qty',
      header: 'Deviated Returned Qty',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (l) => (l.rejectedQty > 0 ? l.rejectedReturnedQty : '—'),
    },
    {
      id: 'reject_reason',
      header: 'Deviation Reason',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (l) => l.rejectReason ?? '—',
      title: (l) => l.rejectReason ?? '',
    },
    {
      // ADR-203: Incoming QC is a separate step. Who did it is in History below.
      id: 'qc_at',
      header: 'QC At',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (l) =>
        l.qcAt == null ? <span className="badge b-amber">Waiting QC</span> : fmtDateTime(l.qcAt),
    },
  ];
}

export function PartyGrnExpand({ g }: { g: PartyGrnListItem }): React.JSX.Element {
  const detailQ = usePartyGrnDetail(g.id);
  const lines = detailQ.data?.lines ?? [];

  const { data: eff } = useMyAccess();
  // Edit is gated by the party_create form's edit action AND the receipt still
  // having a line waiting for Incoming QC (a fully-QC'd receipt is settled —
  // nothing here is editable, so no Edit button). Cancel stays the way to undo.
  const canEdit = effectiveFormPerms(eff, 'party_create').edit;
  const isLive = g.qcPendingLines > 0;
  const [editing, setEditing] = useState(false);

  // ADR-202 — edits staged against this receipt and awaiting a decision. Their
  // per-field changes drive the inline amber chips below (this expand already
  // hosts the receipt's History, so it is the right surface).
  const pendingEdit = usePendingEditForDoc('PartyGrn', g.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      {/* Received By + Remarks — carried on the header, no extra fetch. The ✏️
          Edit trigger sits here (no detail page); it opens the edit modal. */}
      <div
        className="text3"
        style={{
          fontSize: 'var(--fs-xs)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <span>
          <b>Received By:</b> {g.receivedByText ?? '—'}
        </span>
        <span>
          <b>Remarks:</b> {g.remarks ?? '—'}
        </span>
        {canEdit && isLive ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: 'auto' }}
            onClick={() => setEditing(true)}
            title="Edit this GRN"
          >
            ✏️ Edit
          </button>
        ) : null}
      </div>

      {/* ADR-202 — changes staged against this receipt, waiting for approval:
          current value → proposed value, in amber, per header field and per
          waiting line. Hidden entirely when nothing is pending. */}
      {pendingChanges.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            fontSize: 'var(--fs-xs)',
            margin: '0 0 var(--sp-2)',
            padding: 'var(--sp-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: 'var(--bg2)',
          }}
        >
          <b className="text2">Changes awaiting approval</b>
          {[
            { field: 'grnDate', label: 'GRN Date' },
            { field: 'dcNo', label: 'Customer Challan No.' },
            { field: 'receivedBy', label: 'Received By' },
            { field: 'remarks', label: 'Remarks' },
          ].map(({ field, label }) => {
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
      ) : null}

      {detailQ.isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)', padding: 8 }}>
          Could not load lines. Try again.
        </div>
      ) : detailQ.isLoading ? (
        <div className="text3" style={{ fontSize: 12 }}>
          <Loader2 size={13} className="inline animate-spin" /> Loading lines…
        </div>
      ) : (
        <DataTable
          columns={lineColumns()}
          rows={lines}
          rowKey={(l) => l.id}
          density="compact"
          emptyText="No lines."
        />
      )}

      {/* ADR-197: this receipt's own History (create + compulsory QC). */}
      <div style={{ marginTop: 'var(--sp-3)' }}>
        <Panel title="History" bodyPadding="none">
          <DocumentHistory entity="PartyGrn" entityId={g.id} refId={g.code} />
        </Panel>
      </div>

      {editing ? <EditPartyGrnModal row={g} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
