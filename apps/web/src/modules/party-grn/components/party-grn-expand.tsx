// What the ▸ row reveals under a Party Material GRN (ADR-199 fit table). The
// list row carries only the header aggregates, so the per-line QC split is
// fetched lazily on expand (usePartyGrnDetail — there is no detail page, only
// GET /party-grn/:id). Shows the Received By / Remarks meta line the old card
// carried, the per-line QC table (nested compact DataTable), then the receipt's
// own History (ADR-197).

import type { PartyGrnLine, PartyGrnListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { DocumentHistory } from '@/components/shared/document-history';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { usePartyGrnDetail } from '../api';

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
      header: 'Customer Material',
      kind: 'code',
      nowrap: true,
      render: (l) => (
        <span className="td-code" style={{ color: 'var(--purple)' }}>
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
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.acceptedQty}</span>,
    },
    {
      id: 'rejected_qty',
      header: 'Rejected Qty',
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
      id: 'reject_reason',
      header: 'Reject Reason',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (l) => l.rejectReason ?? '—',
      title: (l) => l.rejectReason ?? '',
    },
  ];
}

export function PartyGrnExpand({ g }: { g: PartyGrnListItem }): React.JSX.Element {
  const detailQ = usePartyGrnDetail(g.id);
  const lines = detailQ.data?.lines ?? [];

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      {/* Received By + Remarks — carried on the header, no extra fetch. */}
      <div
        className="text3"
        style={{
          fontSize: 'var(--fs-xs)',
          display: 'flex',
          flexWrap: 'wrap',
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
      </div>

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
    </div>
  );
}
