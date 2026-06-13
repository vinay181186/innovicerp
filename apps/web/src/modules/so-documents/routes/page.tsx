// SO Documents (legacy renderSODocs L19478, ADR-047). Pick a Sales Order from
// the selector or the all-SOs overview table; then see that SO's files grouped
// by line → category, with stat cards and an upload dialog. Files live in the
// `qc-docs` Storage bucket; metadata in the unified file_registry. QC docs are
// surfaced read-only (source='qc') — managed in the QC module.

import {
  SO_DOC_CATEGORIES,
  SO_DOC_CATEGORY_LABELS,
  SO_DOC_CATEGORY_ORDER,
  type SoDocCategory,
  type SoDocumentFile,
  type SoDocumentLine,
  type SoDocumentOverviewRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  soDocSignedUrl,
  uploadSoDocFile,
  useCreateSoDocument,
  useDeleteSoDocument,
  useSoDocDetail,
  useSoDocOverview,
} from '../api';

const searchSchema = z.object({ so: z.string().optional() });

export const soDocumentsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-documents',
  validateSearch: searchSchema,
  component: SoDocumentsPage,
});

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}-${m}-${y}` : d;
}

function fmtSize(bytes: number | null): string {
  const b = bytes ?? 0;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

function fileIcon(file: SoDocumentFile): string {
  const t = (file.fileType ?? '').toLowerCase();
  const n = file.fileName.toLowerCase();
  if (t.includes('pdf') || n.endsWith('.pdf')) return '📄';
  if (t.includes('image') || /\.(png|jpe?g|gif|webp)$/.test(n)) return '🖼';
  return '📁';
}

async function viewFile(storagePath: string): Promise<void> {
  try {
    const url = await soDocSignedUrl(storagePath);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Could not open file');
  }
}

function SoDocumentsPage(): React.JSX.Element {
  const search = soDocumentsRoute.useSearch();
  const navigate = soDocumentsRoute.useNavigate();
  const selectedSo = search.so ?? '';

  const { data: overview, isLoading } = useSoDocOverview();

  function selectSo(soId: string): void {
    void navigate({
      search: (p) => ({ ...p, so: soId === '' ? undefined : soId }),
      replace: true,
    });
  }

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
          📁 SO Documents
        </div>
        <select
          className="innovic-select"
          value={selectedSo}
          onChange={(e) => selectSo(e.target.value)}
          style={{ minWidth: 300, fontSize: 12 }}
        >
          <option value="">— Select SO —</option>
          {(overview?.rows ?? []).map((r) => (
            <option key={r.salesOrderId} value={r.salesOrderId}>
              {r.soCode} — {r.customerName ?? ''} ({r.fileCount + r.qcCount} files)
            </option>
          ))}
        </select>
      </div>

      {selectedSo ? (
        <SoDetailView soId={selectedSo} />
      ) : (
        <OverviewTable
          rows={overview?.rows ?? []}
          isLoading={isLoading}
          onSelect={(soId) => selectSo(soId)}
        />
      )}
    </div>
  );
}

function OverviewTable({
  rows,
  isLoading,
  onSelect,
}: {
  rows: SoDocumentOverviewRow[];
  isLoading: boolean;
  onSelect: (soId: string) => void;
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">All Sales Orders</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>SO No</th>
              <th>Customer</th>
              <th>Status</th>
              <th className="td-ctr">Files</th>
              <th className="td-ctr">QC Docs</th>
              <th className="td-ctr">Size</th>
              <th className="td-ctr">Archived</th>
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
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-state">
                  No sales orders found
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.salesOrderId}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(r.salesOrderId)}
                >
                  <td className="td-code" style={{ color: 'var(--cyan)' }}>
                    {r.soCode}
                  </td>
                  <td>{r.customerName ?? ''}</td>
                  <td>
                    <span className="badge b-grey">{r.status}</span>
                  </td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                    {r.fileCount}
                  </td>
                  <td className="td-ctr mono" style={{ color: 'var(--text3)' }}>
                    {r.qcCount}
                  </td>
                  <td className="td-ctr mono" style={{ fontSize: 11 }}>
                    {(r.totalSize / 1048576).toFixed(1)} MB
                  </td>
                  <td className="td-ctr">
                    {r.archivedCount ? (
                      <span style={{ fontSize: 10, color: 'var(--amber)' }}>
                        📦 {r.archivedCount}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>
                      📂 View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SoDetailView({ soId }: { soId: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useSoDocDetail(soId);
  const { data: me } = useSession();
  const canWrite = !!me && me.role !== 'viewer';
  const deleteDoc = useDeleteSoDocument();
  const [uploadOpen, setUploadOpen] = useState(false);

  // Group files by line number; unlinked = no soLineNo and unmatched soLineId.
  const { byLine, unlinked } = useMemo(() => {
    const files = data?.files ?? [];
    const lineNos = new Set((data?.lines ?? []).map((l) => l.lineNo));
    const byLine = new Map<number, SoDocumentFile[]>();
    const unlinked: SoDocumentFile[] = [];
    for (const f of files) {
      if (f.soLineNo != null && lineNos.has(f.soLineNo)) {
        const arr = byLine.get(f.soLineNo);
        if (arr) arr.push(f);
        else byLine.set(f.soLineNo, [f]);
      } else {
        unlinked.push(f);
      }
    }
    return { byLine, unlinked };
  }, [data]);

  if (isLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load SO documents'}
      </div>
    );
  }

  function onDelete(f: SoDocumentFile): void {
    if (f.source !== 'registry') return;
    if (confirm(`Delete "${f.fileName}"?`)) deleteDoc.mutate(f.id);
  }

  return (
    <div>
      {/* Stat cards (legacy L19531-19536) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <StatCard label="TOTAL FILES" value={String(data.totals.fileCount)} color="var(--green)" />
        <StatCard
          label="TOTAL SIZE"
          value={`${(data.totals.totalSize / 1048576).toFixed(1)} MB`}
          color="var(--cyan)"
        />
        <StatCard label="QC DOCS" value={String(data.totals.qcCount)} color="var(--text2)" />
        <StatCard
          label="ARCHIVED"
          value={String(data.totals.archivedCount)}
          color="var(--amber)"
        />
        <StatCard label="STATUS" value={data.so.status} color="var(--text)" />
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {canWrite ? (
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen(true)}>
            <Upload size={14} /> Upload Document
          </button>
        ) : null}
      </div>

      {/* Per-line file groups (legacy L19565-19615) */}
      {data.lines.map((line) => (
        <LinePanel
          key={line.soLineId}
          line={line}
          files={byLine.get(line.lineNo) ?? []}
          canWrite={canWrite}
          deletingId={deleteDoc.isPending ? deleteDoc.variables : undefined}
          onDelete={onDelete}
        />
      ))}

      {/* SO-level / unlinked files (legacy L19617-19634) */}
      {unlinked.length > 0 ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-hdr">
            <span className="panel-title">📁 SO-Level Documents (not linked to a line)</span>
          </div>
          <div>
            {unlinked.map((f) => (
              <FileRow
                key={`${f.source}-${f.id}`}
                file={f}
                canWrite={canWrite}
                deleting={deleteDoc.isPending && deleteDoc.variables === f.id}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <UploadDialog
          soId={soId}
          soCode={data.so.code}
          lines={data.lines}
          companyId={me?.companyId ?? null}
          onClose={() => setUploadOpen(false)}
        />
      ) : null}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--text3)' }}>{label}</div>
      <div className="mono fw-700" style={{ fontSize: 20, color }}>
        {value}
      </div>
    </div>
  );
}

function LinePanel({
  line,
  files,
  canWrite,
  deletingId,
  onDelete,
}: {
  line: SoDocumentLine;
  files: SoDocumentFile[];
  canWrite: boolean;
  deletingId: string | undefined;
  onDelete: (f: SoDocumentFile) => void;
}): React.JSX.Element {
  const lineSize = files.reduce((s, f) => s + (f.fileSize ?? 0), 0);
  // Files grouped by category, in the legacy display order.
  const byCat = new Map<string, SoDocumentFile[]>();
  for (const f of files) {
    const cat = SO_DOC_CATEGORIES.includes(f.category as SoDocCategory) ? f.category : 'other';
    const arr = byCat.get(cat);
    if (arr) arr.push(f);
    else byCat.set(cat, [f]);
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-hdr" style={{ background: 'rgba(34,197,94,0.06)' }}>
        <span className="panel-title" style={{ color: 'var(--green)' }}>
          📦 Line {line.lineNo}: {line.itemCode ?? ''} — {line.itemName ?? ''}
          {line.orderQty ? ` (Qty: ${line.orderQty})` : ''}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {files.length} files · {fmtSize(lineSize)}
        </span>
      </div>
      {files.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
          No documents uploaded for this line yet
        </div>
      ) : (
        SO_DOC_CATEGORY_ORDER.filter((cat) => byCat.has(cat)).map((cat) => {
          const catFiles = byCat.get(cat) ?? [];
          return (
            <div key={cat}>
              <div
                style={{
                  padding: '6px 14px',
                  background: 'var(--bg4)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {SO_DOC_CATEGORY_LABELS[cat]} ({catFiles.length})
              </div>
              {catFiles.map((f) => (
                <FileRow
                  key={`${f.source}-${f.id}`}
                  file={f}
                  canWrite={canWrite}
                  deleting={deletingId === f.id}
                  onDelete={onDelete}
                />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function FileRow({
  file,
  canWrite,
  deleting,
  onDelete,
}: {
  file: SoDocumentFile;
  canWrite: boolean;
  deleting: boolean;
  onDelete: (f: SoDocumentFile) => void;
}): React.JSX.Element {
  const meta = [
    file.docType ?? file.category,
    file.fileSize != null ? fmtSize(file.fileSize) : null,
    file.uploadedByText,
    fmtDate(file.createdAt),
    file.jcCodeText,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 14px',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: 16 }}>{fileIcon(file)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.fileName}
          {file.source === 'qc' ? (
            <span className="badge b-grey" style={{ marginLeft: 6, fontSize: 9 }}>
              QC · read-only
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)' }}>{meta}</div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 10 }}
          title="View / download"
          onClick={() => void viewFile(file.storagePath)}
        >
          ⬇ View
        </button>
        {canWrite && file.source === 'registry' ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            style={{ fontSize: 10, padding: '2px 6px' }}
            disabled={deleting}
            onClick={() => onDelete(file)}
          >
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

function UploadDialog({
  soId,
  soCode,
  lines,
  companyId,
  onClose,
}: {
  soId: string;
  soCode: string;
  lines: SoDocumentLine[];
  companyId: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const createDoc = useCreateSoDocument();
  const [lineKey, setLineKey] = useState(''); // '' = SO level, else soLineId
  const [category, setCategory] = useState<SoDocCategory>('other');
  const [docType, setDocType] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!companyId) {
      setMsg('No company in session');
      return;
    }
    if (files.length === 0) {
      setMsg('Choose at least one file');
      return;
    }
    setBusy(true);
    setMsg(null);
    const line = lines.find((l) => l.soLineId === lineKey);
    let ok = 0;
    const fails: string[] = [];
    for (const f of files) {
      try {
        const storagePath = await uploadSoDocFile(f, companyId);
        await createDoc.mutateAsync({
          salesOrderId: soId,
          soCodeText: soCode,
          soLineId: line?.soLineId,
          soLineNo: line?.lineNo,
          category,
          docType: docType.trim() || undefined,
          fileName: f.name,
          storagePath,
          fileSize: f.size,
          fileType: f.type || undefined,
        });
        ok += 1;
      } catch (e) {
        fails.push(`${f.name}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
    setBusy(false);
    if (fails.length === 0) {
      onClose();
    } else {
      setMsg(`Uploaded ${ok}/${files.length}. Failures: ${fails.slice(0, 3).join('; ')}`);
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
      onClick={busy ? undefined : onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">📤 Upload Documents to {soCode}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
          <div>
            <label className="form-label">SO Line</label>
            <select
              className="innovic-select"
              value={lineKey}
              onChange={(e) => setLineKey(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">SO Level (no specific line)</option>
              {lines.map((l) => (
                <option key={l.soLineId} value={l.soLineId}>
                  Line {l.lineNo}: {l.itemCode ?? ''} — {l.itemName ?? ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="form-label">Category</label>
              <select
                className="innovic-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as SoDocCategory)}
                style={{ width: '100%' }}
              >
                {SO_DOC_CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {SO_DOC_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label className="form-label">Document Type</label>
              <input
                className="innovic-input"
                value={docType}
                placeholder="e.g. MIR, Material Cert, Drawing Rev3"
                onChange={(e) => setDocType(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
          <div>
            <label className="form-label">Files</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {files.length > 0 ? (
              <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700, marginTop: 4 }}>
                {files.length} file(s): {files.map((f) => f.name).join(', ')}
              </div>
            ) : null}
          </div>
          {msg ? (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>{msg}</div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : <Upload size={14} />}{' '}
              Upload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
