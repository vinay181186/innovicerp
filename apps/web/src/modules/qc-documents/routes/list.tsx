// QC Documents (legacy renderQCDocuments L23039). SO-pivoted QC-completion
// MATRIX: pick a Sales Order, see one row per JC per SO line with a dynamic
// column per distinct QC op (MIR/MCR/DIR/TPI + any others). Each cell shows
// ✅ Done + date + ⬇ download, ⏳ Pending (qty), or — / Not uploaded. Clicking a
// JC row opens the line-detail modal (_qcDocLineDetail L23226): QC inspection
// batches with serial ranges, then per-doc-type sections (MANDATORY/OPTIONAL)
// with upload/view/download/delete. A second tab keeps the flat file register.

import {
  QC_DOC_CATEGORIES,
  QC_DOC_TYPES,
  type CreateQcDocumentInput,
  type ListQcDocumentsQuery,
  type QcDocument,
  type QcDocCategory,
  type QcLineDetailResponse,
  type QcMatrixCell,
  type QcMatrixResponse,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSession } from '@/lib/session';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  signedUrlFor,
  uploadQcFile,
  useCreateQcDocument,
  useDeleteQcDocument,
  useQcDocuments,
  useQcLineDetail,
  useQcMatrix,
} from '../api';

const searchSchema = z.object({
  view: z.enum(['matrix', 'register']).optional(),
  so: z.string().optional(),
  category: z.enum(QC_DOC_CATEGORIES).optional(),
  search: z.string().optional(),
});

export const qcDocumentsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-docs',
  validateSearch: searchSchema,
  component: QcDocumentsPage,
});

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}-${m}-${y}` : d;
}

function QcDocumentsPage(): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const view = search.view ?? 'matrix';

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🗃 QC Documents
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className={view === 'matrix' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() =>
              void navigate({ search: (p) => ({ ...p, view: 'matrix' }), replace: true })
            }
          >
            Matrix
          </button>
          <button
            type="button"
            className={view === 'register' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
            onClick={() =>
              void navigate({ search: (p) => ({ ...p, view: 'register' }), replace: true })
            }
          >
            File Register
          </button>
        </div>
      </div>

      {view === 'matrix' ? <MatrixView /> : <RegisterView />}
    </div>
  );
}

// ─── Matrix view (legacy renderQCDocuments L23039) ──────────────────────────

function MatrixView(): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const [soSearch, setSoSearch] = useState('');
  const soQuery = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const sos = useMemo(() => soQuery.data?.items ?? [], [soQuery.data]);

  // Default to the first (newest) SO once the list loads.
  const selectedSo = search.so ?? sos[0]?.id;
  const { data: matrix, isLoading, isFetching, isError, error } = useQcMatrix(selectedSo);

  // Per-column client-side filters (legacy L23104-23123).
  const [fCode, setFCode] = useState('');
  const [fName, setFName] = useState('');
  const [fJc, setFJc] = useState('');
  const [fOverall, setFOverall] = useState('');

  const [detailJcId, setDetailJcId] = useState<string | null>(null);

  if (soQuery.isLoading) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (sos.length === 0) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        No SOs found
      </div>
    );
  }

  const cols = matrix?.qcColumns ?? [];
  const rowsAll = matrix?.rows ?? [];
  const overallLabel = (ov: string): string =>
    ov === 'complete'
      ? 'Complete'
      : ov === 'partial'
        ? 'In Progress'
        : ov === 'no_jc'
          ? 'No JC'
          : 'No QC';
  const filteredRows = rowsAll.filter((r) => {
    if (fCode && !(r.itemCode ?? '').toLowerCase().includes(fCode.toLowerCase())) return false;
    if (fName && !(r.itemName ?? '').toLowerCase().includes(fName.toLowerCase())) return false;
    if (fJc && !(r.jcCode ?? '').toLowerCase().includes(fJc.toLowerCase())) return false;
    if (fOverall && overallLabel(r.overall) !== fOverall) return false;
    return true;
  });
  const overallOpts = Array.from(new Set(rowsAll.map((r) => overallLabel(r.overall))));

  const pct =
    matrix && matrix.totalTotal > 0 ? Math.round((matrix.totalDone / matrix.totalTotal) * 100) : 0;
  const fStyle: React.CSSProperties = {
    padding: '3px 5px',
    fontSize: 11,
    width: '100%',
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'var(--bg)',
    color: 'var(--text)',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: 'rgba(34,197,94,0.1)',
            color: 'var(--green)',
            border: '1px solid rgba(34,197,94,0.3)',
          }}
          disabled={!matrix}
          onClick={() => matrix && exportMatrixExcel(matrix)}
        >
          ⬇ Export Excel
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: 'rgba(34,197,94,0.1)',
            color: 'var(--green)',
            border: '1px solid rgba(34,197,94,0.3)',
          }}
          disabled={!matrix}
          onClick={() => matrix && void downloadAllReports(matrix)}
        >
          ⬇ Download All Reports
        </button>
      </div>

      {/* SO selector (legacy L23042-23047) */}
      <div style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>
          SELECT SO:
        </label>
        <div style={{ minWidth: 320 }}>
          <SearchableSelect
            id="qc-docs-so"
            value={selectedSo ?? null}
            valueLabel={
              matrix?.so ? `${matrix.so.code}${matrix.so.customerName ? ` — ${matrix.so.customerName}` : ''}` : undefined
            }
            onChange={(id) =>
              void navigate({ search: (p) => ({ ...p, so: id ?? undefined }), replace: true })
            }
            onSearch={setSoSearch}
            loading={soQuery.isFetching}
            placeholder="🔍 Select SO — type code or customer…"
            options={sos.map((s) => ({ id: s.id, code: s.code, name: s.customerName ?? '' }))}
          />
        </div>
        {isFetching && !isLoading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null}
      </div>

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
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO</span>
            <br />
            <b style={{ color: 'var(--cyan)', fontSize: 16 }}>{matrix.so.code}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>CUSTOMER</span>
            <br />
            <b>{matrix.so.customerName ?? ''}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>QC OPS</span>
            <br />
            <b style={{ color: 'var(--green)' }}>{matrix.totalDone}</b>
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
              style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 4 }}
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

      <div className="panel">
        <div className="tbl-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="innovic-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Ln</th>
                <th style={{ color: 'var(--purple)' }}>CPO</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Qty</th>
                <th>JC No</th>
                {cols.map((c) => (
                  <th key={c} style={{ color: 'var(--green)', textAlign: 'center', minWidth: 90 }}>
                    {c}
                  </th>
                ))}
                <th>Overall</th>
              </tr>
              <tr style={{ background: 'var(--bg3)' }}>
                <td />
                <td />
                <td>
                  <input
                    style={fStyle}
                    placeholder="🔍 Code"
                    value={fCode}
                    onChange={(e) => setFCode(e.target.value)}
                  />
                </td>
                <td>
                  <input
                    style={fStyle}
                    placeholder="🔍 Name"
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                  />
                </td>
                <td />
                <td>
                  <input
                    style={fStyle}
                    placeholder="🔍 JC"
                    value={fJc}
                    onChange={(e) => setFJc(e.target.value)}
                  />
                </td>
                {cols.map((c) => (
                  <td key={c} />
                ))}
                <td>
                  <select style={fStyle} value={fOverall} onChange={(e) => setFOverall(e.target.value)}>
                    <option value="">All</option>
                    {overallOpts.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7 + cols.length} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={7 + cols.length} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load matrix'}
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7 + cols.length} className="empty-state">
                    No data
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr
                    key={`${r.soLineId}-${r.jobCardId ?? 'nojc'}`}
                    style={{ cursor: r.jobCardId ? 'pointer' : 'default' }}
                    title={r.jobCardId ? 'Click to view/upload QC documents' : undefined}
                    onClick={() => r.jobCardId && setDetailJcId(r.jobCardId)}
                  >
                    <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
                      {r.lineNo}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}
                    >
                      {r.clientPoLineNo ?? '—'}
                    </td>
                    <td className="td-code" style={{ color: 'var(--purple)' }}>
                      {r.itemCode ?? ''}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.itemName ?? ''}</td>
                    <td className="td-ctr mono fw-700">{r.orderQty}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                      {r.jcCode ?? '—'}
                    </td>
                    {r.cells.map((cell, ci) => (
                      <MatrixCellTd key={cols[ci] ?? ci} cell={cell} />
                    ))}
                    <OverallTd overall={r.overall} done={r.done} total={r.total} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
        💡 ✅ Done (date) + ⬇ Download | ⏳ Pending (qty) | — not applicable | Not uploaded = QC done
        but no report attached
      </div>

      {detailJcId ? (
        <LineDetailModal jobCardId={detailJcId} onClose={() => setDetailJcId(null)} />
      ) : null}
    </div>
  );
}

function MatrixCellTd({ cell }: { cell: QcMatrixCell }): React.JSX.Element {
  if (!cell.applicable) {
    return (
      <td style={{ color: 'var(--text3)', fontSize: 10, textAlign: 'center' }}>—</td>
    );
  }
  if (cell.done) {
    if (cell.hasDoc) {
      return (
        <td style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>✅ Done</div>
          <div style={{ fontSize: 9, color: 'var(--text3)' }}>{fmtDate(cell.docDate)}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 9, color: 'var(--green)', padding: '1px 6px' }}
            onClick={(e) => {
              e.stopPropagation();
              if (cell.storagePath) void openStoragePath(cell.storagePath);
            }}
          >
            ⬇ Download
          </button>
        </td>
      );
    }
    return (
      <td style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)' }}>✅ Done</div>
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{fmtDate(cell.docDate)}</div>
        <div style={{ fontSize: 9, color: 'var(--amber)', fontStyle: 'italic' }}>Not uploaded</div>
      </td>
    );
  }
  if (cell.pending) {
    return (
      <td style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber)' }}>⏳ Pending</div>
        <div style={{ fontSize: 9, color: 'var(--amber)' }}>{cell.qcPending} pcs</div>
        {cell.accepted > 0 ? (
          <div style={{ fontSize: 9, color: 'var(--green)' }}>{cell.accepted} acc</div>
        ) : null}
      </td>
    );
  }
  return (
    <td style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>Waiting</div>
    </td>
  );
}

function OverallTd({
  overall,
  done,
  total,
}: {
  overall: string;
  done: number;
  total: number;
}): React.JSX.Element {
  if (overall === 'no_qc' || overall === 'no_jc') {
    return (
      <td className="td-ctr">
        <span style={{ color: 'var(--text3)', fontSize: 10 }}>No QC</span>
      </td>
    );
  }
  if (overall === 'complete') {
    return (
      <td className="td-ctr">
        <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 11 }}>
          ✅ {done}/{total}
        </span>
      </td>
    );
  }
  return (
    <td className="td-ctr">
      <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 11 }}>
        {done}/{total}
      </span>
    </td>
  );
}

async function openStoragePath(path: string): Promise<void> {
  try {
    const url = await signedUrlFor(path);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Could not open file');
  }
}

// Export the matrix to xlsx (legacy _qcDocExportExcel L23157).
function exportMatrixExcel(matrix: QcMatrixResponse): void {
  const header = ['Ln', 'CPO Ln', 'Item Code', 'Item Name', 'Qty', 'JC No', ...matrix.qcColumns, 'Overall'];
  const aoa: (string | number)[][] = [header];
  for (const r of matrix.rows) {
    const cells = r.cells.map((c) => {
      if (!c.applicable) return '—';
      if (c.done) return c.hasDoc ? `✅ Done (${fmtDate(c.docDate)})` : 'Done - No report';
      if (c.pending) return `⏳ Pending (${c.qcPending} pcs)${c.accepted > 0 ? ` ${c.accepted} acc` : ''}`;
      return 'Waiting';
    });
    const overall = r.overall === 'no_qc' || r.overall === 'no_jc' ? 'No QC' : `${r.done}/${r.total}`;
    aoa.push([
      r.lineNo,
      r.clientPoLineNo ?? '',
      r.itemCode ?? '',
      r.itemName ?? '',
      r.orderQty,
      r.jcCode ?? '—',
      ...cells,
      overall,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `QC Docs ${matrix.so.code}`.slice(0, 31));
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `QC_Documents_${matrix.so.code}_${stamp}.xlsx`);
}

// Download all reports for the SO (legacy _qcDocDownloadAllSO L23213) — open
// each matched doc's signed URL sequentially.
async function downloadAllReports(matrix: QcMatrixResponse): Promise<void> {
  const paths: string[] = [];
  for (const r of matrix.rows) {
    for (const c of r.cells) {
      if (c.hasDoc && c.storagePath) paths.push(c.storagePath);
    }
  }
  if (paths.length === 0) {
    window.alert(`No reports uploaded for ${matrix.so.code} yet`);
    return;
  }
  for (const p of paths) {
    try {
      const url = await signedUrlFor(p);
      window.open(url, '_blank', 'noopener');
    } catch {
      // skip files that fail to sign
    }
  }
}

// ─── Line-detail modal (legacy _qcDocLineDetail L23226) ─────────────────────

function LineDetailModal({
  jobCardId,
  onClose,
}: {
  jobCardId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';
  const { data, isLoading, isError, error } = useQcLineDetail(jobCardId);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">
            📄 QC Documents {data ? `— ${data.itemCode ?? ''} (${data.jcCode})` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          {isLoading ? (
            <div className="empty-state">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load'}
            </div>
          ) : data ? (
            <LineDetailBody
              data={data}
              jobCardId={jobCardId}
              canWrite={canWrite}
              companyId={me?.companyId ?? null}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LineDetailBody({
  data,
  jobCardId,
  canWrite,
  companyId,
}: {
  data: QcLineDetailResponse;
  jobCardId: string;
  canWrite: boolean;
  companyId: string | null;
}): React.JSX.Element {
  return (
    <div>
      {/* Header (legacy L23263-23269) */}
      <div
        style={{
          padding: 12,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 16,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>ITEM</span>
          <br />
          <b style={{ color: 'var(--purple)' }}>{data.itemCode ?? ''}</b> {data.itemName ?? ''}
        </div>
        <div>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>JC</span>
          <br />
          <b style={{ color: 'var(--cyan)' }}>{data.jcCode}</b>
        </div>
        <div>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>ORDER QTY</span>
          <br />
          <b>{data.orderQty} pcs</b>
        </div>
        <div>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>QC BATCHES</span>
          <br />
          <b>{data.batches.length}</b>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="btn btn-sm"
            style={{
              background: 'rgba(34,197,94,0.1)',
              color: 'var(--green)',
              border: '1px solid rgba(34,197,94,0.3)',
            }}
            onClick={() => void downloadAllLine(data)}
          >
            ⬇ Download All
          </button>
        </div>
      </div>

      {/* QC Inspection Batches (legacy L23271-23290) */}
      {data.batches.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>QC Inspection Batches</div>
          {data.batches.map((b, i) => (
            <div
              key={b.logId}
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                padding: '6px 10px',
                margin: '3px 0',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 12,
              }}
            >
              <span className="mono fw-700" style={{ color: 'var(--green)' }}>
                Batch {i + 1}
              </span>
              <span>{fmtDate(b.date)}</span>
              <span>
                Op{b.opSeq}: <b>{b.operation}</b>
              </span>
              <span style={{ color: 'var(--green)' }}>
                Acc: <b>{b.accepted}</b>
              </span>
              {b.rejected > 0 ? (
                <span style={{ color: 'var(--red)' }}>
                  Rej: <b>{b.rejected}</b>
                </span>
              ) : null}
              <span className="mono fw-700" style={{ color: 'var(--cyan)', marginLeft: 'auto' }}>
                Sr. {b.srFrom} to {b.srTo}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Document sections (legacy L23293-23357) */}
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>QC Documents</div>
      {data.sections.map((section) => (
        <DocSection
          key={section.docType}
          jobCardId={jobCardId}
          section={section}
          totalNeeded={data.totalAccepted}
          canWrite={canWrite}
          companyId={companyId}
        />
      ))}
    </div>
  );
}

function DocSection({
  jobCardId,
  section,
  totalNeeded,
  canWrite,
  companyId,
}: {
  jobCardId: string;
  section: QcLineDetailResponse['sections'][number];
  totalNeeded: number;
  canWrite: boolean;
  companyId: string | null;
}): React.JSX.Element {
  const del = useDeleteQcDocument();
  const create = useCreateQcDocument();
  const uploads = [...section.docs].sort((a, b) => (a.srFrom ?? 0) - (b.srFrom ?? 0));
  const totalUploaded = uploads.reduce(
    (s, u) => s + ((u.srTo ?? 0) - (u.srFrom ?? 0) + 1),
    0,
  );
  const isDone = totalUploaded >= totalNeeded && totalNeeded > 0;
  const statusColor = isDone ? 'var(--green)' : uploads.length > 0 ? 'var(--amber)' : 'var(--text3)';
  const statusLabel = isDone
    ? '✅ Complete'
    : uploads.length > 0
      ? `⏳ Partial (${totalUploaded}/${totalNeeded})`
      : '— No uploads';

  const nextSrFrom = uploads.length > 0 ? (uploads[uploads.length - 1]?.srTo ?? 0) + 1 : 1;
  const [srFrom, setSrFrom] = useState(nextSrFrom);
  const [srTo, setSrTo] = useState(totalNeeded || nextSrFrom);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onUpload(file: File): Promise<void> {
    if (!companyId) {
      setErr('No company on session');
      return;
    }
    if (srTo < srFrom) {
      setErr('To must be ≥ From');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const storagePath = await uploadQcFile(file, companyId);
      // New uploads carry qc_op_name (= the doc-type/op name) + serial range so
      // they land in the right matrix cell. jc_op_id isn't surfaced per section;
      // the matrix matcher falls back to qc_op_name/doc_type.
      const input: CreateQcDocumentInput = {
        category: 'qc-docs',
        docType: section.docType,
        fileName: file.name,
        storagePath,
        jobCardId,
        qcOpName: section.docType,
        srFrom,
        srTo,
      };
      await create.mutateAsync(input);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string): Promise<void> {
    if (!window.confirm('Delete this QC document upload?')) return;
    await del.mutateAsync(id);
  }

  const showUpload = canWrite && (nextSrFrom <= totalNeeded || totalNeeded === 0);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        marginBottom: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--bg4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)' }}>
            {section.docType}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{section.fullName}</span>
          <span
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 700,
              background: section.mandatory ? 'rgba(239,68,68,0.1)' : 'rgba(100,116,139,0.1)',
              color: section.mandatory ? 'var(--red)' : 'var(--text3)',
            }}
          >
            {section.mandatory ? 'MANDATORY' : 'OPTIONAL'}
          </span>
        </div>
        <span style={{ fontWeight: 700, fontSize: 11, color: statusColor }}>{statusLabel}</span>
      </div>

      {uploads.map((up, ui) => (
        <div
          key={up.id}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '6px 12px',
            borderTop: '1px solid var(--border)',
            background: ui % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
          }}
        >
          <span className="mono fw-700" style={{ fontSize: 11, color: 'var(--cyan)' }}>
            {up.srFrom != null && up.srTo != null ? `Sr. ${up.srFrom} – ${up.srTo}` : 'Sr. —'}
          </span>
          {up.srFrom != null && up.srTo != null ? (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              ({up.srTo - up.srFrom + 1} pcs)
            </span>
          ) : null}
          <span style={{ fontSize: 10, color: 'var(--text2)' }}>{up.fileName}</span>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{fmtDate(up.createdAt)}</span>
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>{up.uploadedByText ?? ''}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10, color: 'var(--green)' }}
              onClick={() => void openStoragePath(up.storagePath)}
            >
              👁 View
            </button>
            {canWrite ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10, color: 'var(--red)' }}
                disabled={del.isPending}
                onClick={() => void onDelete(up.id)}
              >
                ✗
              </button>
            ) : null}
          </div>
        </div>
      ))}

      {showUpload ? (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Upload for:</span>
          <input
            type="number"
            min={1}
            value={srFrom}
            onChange={(e) => setSrFrom(Number(e.target.value))}
            style={{ width: 60, fontSize: 11, textAlign: 'center', padding: 3 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
          <input
            type="number"
            min={1}
            value={srTo}
            onChange={(e) => setSrTo(Number(e.target.value))}
            style={{ width: 60, fontSize: 11, textAlign: 'center', padding: 3 }}
          />
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: busy ? 'default' : 'pointer',
              padding: '4px 10px',
              background: 'rgba(124,58,237,0.1)',
              border: '1px solid rgba(124,58,237,0.3)',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--purple)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '📄'} Upload File
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              style={{ display: 'none' }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = '';
              }}
            />
          </label>
          {err ? <span style={{ fontSize: 11, color: 'var(--red)' }}>{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

async function downloadAllLine(data: QcLineDetailResponse): Promise<void> {
  const paths = data.sections.flatMap((s) => s.docs.map((d) => d.storagePath)).filter(Boolean);
  if (paths.length === 0) {
    window.alert('No documents uploaded yet');
    return;
  }
  for (const p of paths) {
    try {
      const url = await signedUrlFor(p);
      window.open(url, '_blank', 'noopener');
    } catch {
      // skip
    }
  }
}

// ─── Flat file register (original QC Documents list) ────────────────────────

function RegisterView(): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';
  const del = useDeleteQcDocument();
  const [uploadOpen, setUploadOpen] = useState(false);

  const query: ListQcDocumentsQuery = useMemo(
    () => ({
      ...(search.category ? { category: search.category } : {}),
      ...(search.search ? { search: search.search } : {}),
    }),
    [search.category, search.search],
  );
  const { data, isLoading, isFetching, isError, error } = useQcDocuments(query);
  const items = data?.items ?? [];

  async function openFile(d: QcDocument): Promise<void> {
    try {
      const url = await signedUrlFor(d.storagePath);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not open file');
    }
  }
  async function onDelete(d: QcDocument): Promise<void> {
    if (!window.confirm(`Remove "${d.fileName}" from the QC document register?`)) return;
    await del.mutateAsync(d.id);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" />
          </span>
        ) : null}
        {canWrite ? (
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            📎 Upload Document
          </button>
        ) : null}
      </div>

      <div className="panel" style={{ marginBottom: 12, padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="innovic-select"
            style={{ width: 180, fontSize: 12 }}
            value={search.category ?? ''}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  category: (e.target.value || undefined) as QcDocCategory | undefined,
                }),
                replace: true,
              })
            }
          >
            <option value="">All categories</option>
            {QC_DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="innovic-input"
            style={{ width: 240, fontSize: 12 }}
            placeholder="🔍 Search file, type, JC/SO…"
            defaultValue={search.search ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              void navigate({
                search: (prev) => ({ ...prev, search: v || undefined }),
                replace: true,
              });
            }}
          />
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Doc Type</th>
                <th>File Name</th>
                <th>Category</th>
                <th>JC</th>
                <th>SO</th>
                <th>Uploaded By</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={8} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load QC documents'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No QC documents. Click 📎 Upload Document to attach MIR / MCR / inspection
                    reports.
                  </td>
                </tr>
              ) : (
                items.map((d) => (
                  <tr key={d.id}>
                    <td className="fw-700" style={{ color: 'var(--purple)', fontSize: 12 }}>
                      {d.docType}
                    </td>
                    <td style={{ fontSize: 12 }}>{d.fileName}</td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {d.category}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                      {d.jcCodeText ?? '—'}
                    </td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                      {d.soCodeText ?? '—'}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {d.uploadedByText ?? '—'}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {d.createdAt.slice(0, 10)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void openFile(d)}
                        >
                          📎 Open
                        </button>
                        {canWrite ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={del.isPending}
                            onClick={() => void onDelete(d)}
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {uploadOpen && me?.companyId ? (
        <UploadModal companyId={me.companyId} onClose={() => setUploadOpen(false)} />
      ) : null}
    </div>
  );
}

function UploadModal({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}): React.JSX.Element {
  const create = useCreateQcDocument();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<QcDocCategory>('qc-docs');
  const [docType, setDocType] = useState<string>(QC_DOC_TYPES[0]);
  const [jcCode, setJcCode] = useState('');
  const [soCode, setSoCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!file) {
      setErr('Choose a file to upload.');
      return;
    }
    setBusy(true);
    try {
      const storagePath = await uploadQcFile(file, companyId);
      const input: CreateQcDocumentInput = {
        category,
        docType,
        fileName: file.name,
        storagePath,
        ...(jcCode.trim() ? { jcCodeText: jcCode.trim() } : {}),
        ...(soCode.trim() ? { soCodeText: soCode.trim() } : {}),
      };
      await create.mutateAsync(input);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div className="panel" style={{ width: 'min(1100px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-hdr">
          <span className="panel-title">📎 Upload QC Document</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label">
                File <span className="form-label-required">★</span>
              </label>
              <input
                type="file"
                className="innovic-input"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Document Type</label>
              <select className="innovic-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
                {QC_DOC_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Category</label>
              <select
                className="innovic-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as QcDocCategory)}
              >
                {QC_DOC_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">JC No. (optional)</label>
              <input className="innovic-input" value={jcCode} onChange={(e) => setJcCode(e.target.value)} placeholder="IN-JC-00001" />
            </div>
            <div className="form-grp">
              <label className="form-label">SO No. (optional)</label>
              <input className="innovic-input" value={soCode} onChange={(e) => setSoCode(e.target.value)} placeholder="SO-001" />
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Upload &amp; Register
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
