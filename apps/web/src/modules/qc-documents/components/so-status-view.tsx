// SO QC Status view (legacy renderSOQCStatus L18347) — the "SO Status" tab of
// QC Documents, converted to the shared fit table (ADR-199, tableKey
// qcDocsStatus). SO selector → per-line QC-stage report with the GRN / TPI / Doc
// detail tables in the ▸ expand and a totals footer (engine showTotals).
//
// Reimplemented inside the qc-documents module (this agent's only permitted
// module) rather than editing the separate so-qc-status module; it reuses that
// module's existing `useSoQcStatus` hook and the shared SoQc* types unchanged.

import type { SoQcLine, SoStatus } from '@innovic/shared';
import { useCallback, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { StatStrip } from '@/components/shared/stat-strip';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { useSoQcStatus } from '@/modules/so-qc-status/api';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { buildSoStatusColumns, SO_STATUS_DETAIL_IDS } from './so-status-columns';
import { SoStatusExpanded } from './so-status-detail';

const ROW_TINT_BY_OVERALL: Record<SoQcLine['overall'], string | undefined> = {
  passed: ROW_TINT.done,
  pending: ROW_TINT.pending,
  in_progress: undefined,
  none: undefined,
};

const hasDetail = (l: SoQcLine): boolean =>
  l.grnDetail.length > 0 || l.tpiDetail.length > 0 || l.docDetail.length > 0;

export function SoStatusView({ toggle }: { toggle: React.ReactNode }): React.JSX.Element {
  const [selectedSo, setSelectedSo] = useState<string | null>(null);
  const [soSearch, setSoSearch] = useState('');
  const soList = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const detail = useSoQcStatus(selectedSo ?? undefined);

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const columns = buildSoStatusColumns();
  const lines = detail.data?.lines ?? [];

  return (
    // `page-fill` (ADR-202/203): the title, SO picker, SO card and totals strip
    // are fixed chrome; the lines table takes the rest of the screen and is the
    // ONE thing that scrolls, so its column header never leaves the screen.
    <div className="page-fill">
      <ListHeader title="QC Documents" icon="🗃" tools={toggle} />
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ minWidth: 300 }}>
          <SearchableSelect
            id="so-qc-select"
            value={selectedSo}
            onChange={setSelectedSo}
            onSearch={setSoSearch}
            loading={soList.isFetching}
            placeholder="Search SO No. or customer…"
            options={(soList.data?.items ?? []).map((s) => ({
              id: s.id,
              code: soNoWithInternal(s.code, s.internalSoNo),
              name: s.customerName ?? '',
            }))}
          />
        </div>
      </div>

      {!selectedSo ? (
        <PageState
          state="empty"
          icon="🔬"
          title="Select a Sales Order to view QC status"
          message=" "
        />
      ) : detail.isLoading ? (
        <PageState state="loading" message="Loading QC status…" />
      ) : detail.isError || !detail.data ? (
        <PageState
          state="error"
          message={
            detail.error instanceof Error
              ? detail.error.message
              : 'Could not load SO QC status. Try again.'
          }
        />
      ) : (
        <>
          <div
            style={{
              padding: 14,
              background: 'rgba(34,211,238,0.04)',
              border: '1px solid rgba(34,211,238,0.15)',
              borderRadius: 'var(--radius)',
              marginBottom: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <div>
              <span className="mono fw-700" style={{ fontSize: 18, color: 'var(--cyan)' }}>
                {soNoWithInternal(detail.data.so.code, detail.data.so.internalSoNo)}
              </span>
              <span style={{ marginLeft: 12, fontSize: 14, fontWeight: 600 }}>
                {detail.data.so.customerName ?? '—'}
              </span>
              <span style={{ marginLeft: 12 }}>
                <SoStatusBadge status={detail.data.so.status as SoStatus} />
              </span>
            </div>
            <div className="text3" style={{ fontSize: 12 }}>
              SO Date: {fmtDate(detail.data.so.soDate)}
              {detail.data.so.dueDate ? ` · Due: ${fmtDate(detail.data.so.dueDate)}` : ''}
              {detail.data.so.type ? ` · Type: ${detail.data.so.type}` : ''}
            </div>
          </div>

          <SummaryStrip lines={lines} />

          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.qcDocsStatus}
              columns={columns}
              rows={lines}
              rowKey={(l) => l.soLineId}
              emptyText="No lines on this SO."
              defaultHidden={SO_STATUS_DETAIL_IDS}
              showTotals
              totalsLabel={`Total (${lines.length} lines)`}
              rowClassName={(l) => ROW_TINT_BY_OVERALL[l.overall]}
              renderExpanded={(l) =>
                hasDetail(l) && expandedKeys.has(l.soLineId) ? <SoStatusExpanded l={l} /> : null
              }
              onToggleExpanded={(l) => toggleExpand(l.soLineId)}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function SummaryStrip({ lines }: { lines: SoQcLine[] }): React.JSX.Element {
  const t = lines.reduce(
    (a, l) => ({
      qcOps: a.qcOps + l.qcOpsTotal,
      qcPassed: a.qcPassed + l.qcOpsPassed,
      grn: a.grn + l.grnTotal,
      grnDone: a.grnDone + l.grnDone,
      docs: a.docs + l.docCount,
      docsUp: a.docsUp + l.docUploaded,
    }),
    { qcOps: 0, qcPassed: 0, grn: 0, grnDone: 0, docs: 0, docsUp: 0 },
  );
  const allDone = (done: number, total: number): string =>
    total > 0 && done >= total ? 'var(--green)' : 'var(--amber)';
  return (
    <div style={{ marginBottom: 16 }}>
      <StatStrip
        items={[
          {
            key: 'qc-ops',
            label: 'QC Ops',
            count: `${t.qcPassed}/${t.qcOps}`,
            sub: 'Accepted',
            color: allDone(t.qcPassed, t.qcOps),
          },
          {
            key: 'incoming-qc',
            label: 'Incoming QC',
            count: `${t.grnDone}/${t.grn}`,
            sub: 'Completed',
            color: allDone(t.grnDone, t.grn),
          },
          {
            key: 'documents',
            label: 'Documents',
            count: `${t.docsUp}/${t.docs}`,
            sub: 'Uploaded',
            color: allDone(t.docsUp, t.docs),
          },
        ]}
      />
    </div>
  );
}
