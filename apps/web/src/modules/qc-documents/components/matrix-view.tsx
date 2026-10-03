// Matrix view (legacy renderQCDocuments L23039) — ADR-199 fit table
// (tableKey qcDocsMatrix). Pick a Sales Order, see one row per JC per SO line
// with one compact chip column per QC op (dynamicColumns, decision #14). The
// per-column filters (Code / Item Name / JC / Overall) moved OFF the table
// header into the ListHeader filter bar (decision #14). Clicking a JC row opens
// the line-detail modal; the ▸ expand shows POL / Item Name / Order Qty and the
// full per-op detail.

import type { QcMatrixRow } from '@innovic/shared';
import { useCallback, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { ActionMenu, ListHeader, PageState } from '@/ui/layout';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { useQcMatrix } from '../api';
import { qcDocumentsListRoute } from '../routes/list';
import { LineDetailModal } from './line-detail-modal';
import { MatrixExpandedDetail } from './matrix-cells';
import { buildMatrixColumns, MATRIX_DETAIL_IDS } from './matrix-columns';
import { downloadAllReports, exportMatrixExcel } from './matrix-export';
import { overallLabel, useMaySaveFiles } from './qc-doc-shared';

const ROW_TINT_BY_OVERALL: Record<QcMatrixRow['overall'], string | undefined> = {
  complete: ROW_TINT.done,
  partial: ROW_TINT.pending,
  no_qc: undefined,
  no_jc: undefined,
};

const rowKeyOf = (r: QcMatrixRow): string => `${r.soLineId}-${r.jobCardId ?? 'nojc'}`;

export function MatrixView({ toggle }: { toggle: React.ReactNode }): React.JSX.Element {
  const maySave = useMaySaveFiles();
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const [soSearch, setSoSearch] = useState('');
  const soQuery = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const sos = useMemo(() => soQuery.data?.items ?? [], [soQuery.data]);

  // Default to the first (newest) SO once the list loads.
  const selectedSo = search.so ?? sos[0]?.id;
  const { data: matrix, isLoading, isFetching, isError, error } = useQcMatrix(selectedSo);

  // Per-column filters, now rendered in the ListHeader filter bar (legacy header
  // row L23104-23123 → filter bar, decision #14).
  const [fCode, setFCode] = useState('');
  const [fName, setFName] = useState('');
  const [fJc, setFJc] = useState('');
  const [fOverall, setFOverall] = useState('');

  const [detailJcId, setDetailJcId] = useState<string | null>(null);

  // ▸ expand: caller owns the open set; the fit table's ▸ is the row's one
  // expand control. renderExpanded returns null for a collapsed row.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const cols = matrix?.qcColumns ?? [];
  const rowsAll = matrix?.rows ?? [];
  const filteredRows = rowsAll.filter((r) => {
    // Match on the code as printed (CODE/REV) as well as on the bare code, so
    // "IN-IT-0007/B" typed straight off the screen finds its row while a plain
    // "IN-IT-0007" still finds every revision of it.
    if (
      fCode &&
      !`${r.itemCode ?? ''} ${itemCodeWithRev(r.itemCode, r.itemRevision, '')}`
        .toLowerCase()
        .includes(fCode.toLowerCase())
    )
      return false;
    if (fName && !(r.itemName ?? '').toLowerCase().includes(fName.toLowerCase())) return false;
    if (fJc && !(r.jcCode ?? '').toLowerCase().includes(fJc.toLowerCase())) return false;
    if (fOverall && overallLabel(r.overall) !== fOverall) return false;
    return true;
  });
  const overallOpts = Array.from(new Set(rowsAll.map((r) => overallLabel(r.overall))));
  const filtersActive = fCode !== '' || fName !== '' || fJc !== '' || fOverall !== '';

  const columns = useMemo(() => buildMatrixColumns(cols), [cols]);

  const pct =
    matrix && matrix.totalTotal > 0 ? Math.round((matrix.totalDone / matrix.totalTotal) * 100) : 0;

  if (soQuery.isLoading || sos.length === 0) {
    return (
      <div>
        <ListHeader title="QC Documents" icon="🗃" tools={toggle} />
        <PageState
          state={soQuery.isLoading ? 'loading' : 'empty'}
          message={soQuery.isLoading ? 'Loading…' : 'No SOs yet.'}
        />
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is the
    // only thing that scrolls, so the sticky column header holds at the last row.
    <div className="page-fill">
      <ListHeader
        title="QC Documents"
        icon="🗃"
        count={matrix ? filteredRows.length : undefined}
        noun="line"
        updating={isFetching && !isLoading}
        searchSlot={
          /* SO selector (legacy L23042-23047) — the matrix is one SO at a time. */
          <div style={{ minWidth: 320 }}>
            <SearchableSelect
              id="qc-docs-so"
              value={selectedSo ?? null}
              valueLabel={
                matrix?.so
                  ? `${soNoWithInternal(matrix.so.code, matrix.so.internalSoNo)}${matrix.so.customerName ? ` — ${matrix.so.customerName}` : ''}`
                  : undefined
              }
              onChange={(id) =>
                void navigate({ search: (p) => ({ ...p, so: id ?? undefined }), replace: true })
              }
              onSearch={setSoSearch}
              loading={soQuery.isFetching}
              placeholder="Search SO No. or customer…"
              options={sos.map((s) => ({
                id: s.id,
                code: soNoWithInternal(s.code, s.internalSoNo),
                name: s.customerName ?? '',
              }))}
            />
          </div>
        }
        filters={
          <>
            <input
              className="innovic-input"
              placeholder="Item Code"
              aria-label="Filter by item code"
              value={fCode}
              onChange={(e) => setFCode(e.target.value)}
            />
            <input
              className="innovic-input"
              placeholder="Item Name"
              aria-label="Filter by item name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
            />
            <input
              className="innovic-input"
              placeholder="JC No."
              aria-label="Filter by JC No."
              value={fJc}
              onChange={(e) => setFJc(e.target.value)}
            />
            <select
              className="innovic-select"
              aria-label="Overall status"
              title="Overall status"
              value={fOverall}
              onChange={(e) => setFOverall(e.target.value)}
            >
              <option value="">All Overall</option>
              {overallOpts.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </>
        }
        onClearFilters={() => {
          setFCode('');
          setFName('');
          setFJc('');
          setFOverall('');
        }}
        filtersActive={filtersActive}
        tools={
          <>
            {toggle}
            {/* One Export control. "Download All Reports" is absent, not greyed,
                for anyone without the download tick — the server would refuse
                the links anyway. The Excel matrix is a spreadsheet this page
                builds itself, so it is always offered. */}
            <ActionMenu
              label="⬇ Export"
              items={[
                {
                  label: 'Excel (This Matrix)',
                  disabled: !matrix,
                  onClick: () => {
                    if (matrix) exportMatrixExcel(matrix);
                  },
                },
                {
                  label: 'Download All Reports',
                  hidden: !maySave,
                  disabled:
                    !matrix ||
                    !matrix.rows.some((r) => r.cells.some((c) => c.hasDoc && c.storagePath)),
                  onClick: () => {
                    if (matrix) void downloadAllReports(matrix);
                  },
                },
              ]}
            />
          </>
        }
      />

      {/* SO summary bar (legacy L23112) */}
      {matrix ? (
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginBottom: 14,
            padding: '10px 14px',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>SO</span>
            <br />
            <b style={{ color: 'var(--cyan)', fontSize: 16 }}>
              {soNoWithInternal(matrix.so.code, matrix.so.internalSoNo)}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Customer</span>
            <br />
            <b>{matrix.so.customerName ?? ''}</b>
          </div>
          <div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>QC Ops</span>
            <br />
            <b style={{ color: 'var(--green2)' }}>{matrix.totalDone}</b>
            <span style={{ color: 'var(--text3)' }}> / {matrix.totalTotal}</span>
          </div>
          <div
            style={{
              flex: 1,
              height: 8,
              background: 'var(--bg5)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: 'var(--green)',
                borderRadius: 4,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: pct >= 100 && matrix.totalTotal > 0 ? 'var(--green)' : 'var(--amber)',
            }}
          >
            {pct}%
          </span>
        </div>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load QC Documents. Try again.'
          }
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.qcDocsMatrix}
            columns={columns}
            rows={filteredRows}
            rowKey={rowKeyOf}
            loading={isLoading}
            emptyText={rowsAll.length === 0 ? 'No lines yet.' : 'No lines match.'}
            defaultHidden={MATRIX_DETAIL_IDS}
            // The per-column filters above are the matrix's filtering path; the
            // shared Sort & Filter menu is turned off to avoid two filters on the
            // same columns.
            sortFilter={false}
            onRowClick={(r) => {
              if (r.jobCardId) setDetailJcId(r.jobCardId);
            }}
            isRowClickable={(r) => !!r.jobCardId}
            rowClassName={(r) => ROW_TINT_BY_OVERALL[r.overall]}
            renderExpanded={(r) =>
              expandedKeys.has(rowKeyOf(r)) ? (
                <MatrixExpandedDetail row={r} qcColumns={cols} maySave={maySave} />
              ) : null
            }
            onToggleExpanded={(r) => toggleExpand(rowKeyOf(r))}
          />
        </Panel>
      )}

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        <span
          style={{ cursor: 'help' }}
          title="OK (date) = Completed · OK* = Completed, report missing · wait N = QC pending qty · Waiting · — not applicable. Open ▸ for the full per-op detail and downloads; click a row for upload / manage."
        >
          ?
        </span>
      </div>

      {detailJcId ? (
        <LineDetailModal jobCardId={detailJcId} onClose={() => setDetailJcId(null)} />
      ) : null}
    </div>
  );
}
