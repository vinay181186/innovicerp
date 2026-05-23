// QC Documents (legacy renderQCDocuments L23039). File repository for QC docs
// (MIR/MCR/inspection/TPI reports) per JC/SO. Client uploads to the `qc-docs`
// Supabase Storage bucket, then registers metadata via /qc-documents. Legacy
// chrome.

import {
  QC_DOC_CATEGORIES,
  QC_DOC_TYPES,
  type CreateQcDocumentInput,
  type ListQcDocumentsQuery,
  type QcDocument,
  type QcDocCategory,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  signedUrlFor,
  uploadQcFile,
  useCreateQcDocument,
  useDeleteQcDocument,
  useQcDocuments,
} from '../api';

const searchSchema = z.object({
  category: z.enum(QC_DOC_CATEGORIES).optional(),
  search: z.string().optional(),
});

export const qcDocumentsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-docs',
  validateSearch: searchSchema,
  component: QcDocumentsPage,
});

function QcDocumentsPage(): React.JSX.Element {
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                <th></th>
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
      <div className="panel" style={{ width: 'min(520px, 100%)' }} onClick={(e) => e.stopPropagation()}>
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
