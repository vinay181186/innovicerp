// What the ▸ row reveals under a Customer Material Return (ADR-199 fit table).
// The list row carries only the header, so the lines load lazily on expand
// (GET /customer-material-returns/:id — there is no detail page). Shows the
// Remarks / cancel reason meta line, the lines (nested compact DataTable) and
// the return's own History (ADR-197), the same shape as the Party GRN expand.

import type { CustomerMaterialReturn, CustomerMaterialReturnLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { DocumentHistory } from '@/components/shared/document-history';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useCustomerMaterialReturn } from '../api';
import { CMR_KIND_LABEL } from './cmr-columns';

function lineColumns(): DataTableColumn<CustomerMaterialReturnLine>[] {
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
      id: 'kind',
      header: 'Return Kind',
      kind: 'badge',
      nowrap: true,
      render: (l) => (
        <span className={`badge ${l.kind === 'rejected' ? 'b-red' : 'b-green'}`}>
          {CMR_KIND_LABEL[l.kind]}
        </span>
      ),
    },
    {
      id: 'jwso_line',
      header: 'JWSO Line',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      render: (l) => (
        <span style={{ color: 'var(--purple)' }}>
          {l.jwLineNo != null ? `L${l.jwLineNo}` : '—'}
        </span>
      ),
    },
    {
      id: 'part_code',
      header: 'Item Code',
      kind: 'code',
      className: 'td-code',
      nowrap: true,
      render: (l) => l.partCode ?? '—',
    },
    {
      id: 'rm_code',
      header: 'Customer RM',
      kind: 'code',
      nowrap: true,
      render: (l) => (
        <span className="td-code" style={{ color: 'var(--text)' }}>
          {l.rmItemCode ?? l.partyMaterialCode ?? '—'}
        </span>
      ),
    },
    {
      id: 'party_grn',
      header: 'Party GRN No.',
      kind: 'code',
      className: 'mono text2',
      nowrap: true,
      render: (l) => l.partyGrnCode ?? '—',
    },
    {
      id: 'qty',
      header: 'Return Qty',
      kind: 'num',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      nowrap: true,
      render: (l) => <span style={{ color: 'var(--green2)' }}>{l.qty}</span>,
    },
  ];
}

export function CmrExpand({ r }: { r: CustomerMaterialReturn }): React.JSX.Element {
  const detailQ = useCustomerMaterialReturn(r.id);
  const lines = detailQ.data?.lines ?? [];

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
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
          <b>Lines:</b> {detailQ.data ? lines.length : '…'}
        </span>
        <span>
          <b>Remarks:</b> {r.remarks ?? '—'}
        </span>
        {r.status === 'cancelled' ? (
          <span style={{ color: 'var(--red2)' }}>
            <b>Cancel Reason:</b> {r.cancelReason ?? '—'}
          </span>
        ) : null}
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

      <div style={{ marginTop: 'var(--sp-3)' }}>
        <Panel title="History" bodyPadding="none">
          <DocumentHistory entity="CustomerMaterialReturn" entityId={r.id} refId={r.code} />
        </Panel>
      </div>
    </div>
  );
}
