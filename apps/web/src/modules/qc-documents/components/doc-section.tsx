// One doc-type section inside the line-detail modal (legacy L23293-23357).
// Upload / view / download / delete for one document type on one Job Card.
// Split out of routes/list.tsx. Unchanged behaviour — only relocated.

import type { CreateQcDocumentInput, QcLineDetailResponse } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { ConfirmDialog } from '@/ui/feedback';
import { saveQcDoc, uploadQcFile, useCreateQcDocument, useDeleteQcDocument } from '../api';
import { openStoragePath, useMaySaveFiles } from './qc-doc-shared';

export function DocSection({
  jobCardId,
  jcCode,
  section,
  totalNeeded,
  canUpload,
  canDelete,
  companyId,
}: {
  jobCardId: string;
  /** Display only — what the file access log should call this job card. */
  jcCode: string;
  section: QcLineDetailResponse['sections'][number];
  totalNeeded: number;
  canUpload: boolean;
  canDelete: boolean;
  companyId: string | null;
}): React.JSX.Element {
  const maySave = useMaySaveFiles();
  const del = useDeleteQcDocument();
  const create = useCreateQcDocument();
  const uploads = [...section.docs].sort((a, b) => (a.srFrom ?? 0) - (b.srFrom ?? 0));
  const totalUploaded = uploads.reduce((s, u) => s + ((u.srTo ?? 0) - (u.srFrom ?? 0) + 1), 0);
  const isDone = totalUploaded >= totalNeeded && totalNeeded > 0;
  const statusColor = isDone
    ? 'var(--green)'
    : uploads.length > 0
      ? 'var(--amber)'
      : 'var(--text3)';
  const statusLabel = isDone
    ? '✅ Completed'
    : uploads.length > 0
      ? `⏳ Partly Uploaded (${totalUploaded}/${totalNeeded})`
      : '— No uploads';

  const nextSrFrom = uploads.length > 0 ? (uploads[uploads.length - 1]?.srTo ?? 0) + 1 : 1;
  const [srFrom, setSrFrom] = useState(nextSrFrom);
  const [srTo, setSrTo] = useState(totalNeeded || nextSrFrom);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onUpload(file: File): Promise<void> {
    if (!companyId) {
      setErr('Session expired. Log in again.');
      return;
    }
    if (srTo < srFrom) {
      setErr('To cannot be less than From.');
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
      setErr(e instanceof Error ? e.message : 'Could not upload document. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const [pendingDelete, setPendingDelete] = useState<{ id: string; fileName: string } | null>(null);

  const showUpload = canUpload && (nextSrFrom <= totalNeeded || totalNeeded === 0);

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
          <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green2)' }}>
            {section.docType}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{section.fullName}</span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 10,
              fontWeight: 700,
              background: section.mandatory ? 'rgba(239,68,68,0.1)' : 'rgba(100,116,139,0.1)',
              color: section.mandatory ? 'var(--red)' : 'var(--text3)',
            }}
          >
            {section.mandatory ? 'Mandatory' : 'Optional'}
          </span>
        </div>
        <span style={{ fontWeight: 700, fontSize: 11, color: statusColor }}>{statusLabel}</span>
        {uploads.length > 0 && maySave ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, marginLeft: 6, color: 'var(--green2)' }}
            onClick={() => void downloadDocs(uploads, jcCode)}
            title="Save every file in this section"
          >
            ⬇
          </button>
        ) : null}
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
            {up.srFrom != null && up.srTo != null ? `Pieces ${up.srFrom} – ${up.srTo}` : '—'}
          </span>
          {up.srFrom != null && up.srTo != null ? (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              ({up.srTo - up.srFrom + 1} pcs)
            </span>
          ) : null}
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>{up.fileName}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmtDate(up.createdAt, '')}</span>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{up.uploadedByText ?? ''}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="btn"
              style={{
                padding: '3px 8px',
                background: 'rgba(34,197,94,0.1)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--green2)',
              }}
              onClick={() => void openStoragePath(up.storagePath, jcCode)}
            >
              👁 View
            </button>
            {canDelete ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, color: 'var(--red2)' }}
                disabled={del.isPending}
                onClick={() => setPendingDelete({ id: up.id, fileName: up.fileName })}
              >
                ✗
              </button>
            ) : null}
          </div>
        </div>
      ))}

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${pendingDelete.fileName}?`}
          message="The file is removed from QC Documents."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            await del.mutateAsync(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}

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
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>Pieces</span>
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
          {err ? <span style={{ fontSize: 11, color: 'var(--red2)' }}>{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// Download every upload in one doc-type section (legacy _qcDocDownloadType
// L23430, reached from the section header's ⬇ at L23320). This now really does
// download — the server mints an attachment link — which closes ISSUE-037: the
// old code re-opened inline links, so a button marked ⬇ left nothing on disk.
export async function downloadDocs(
  docs: QcLineDetailResponse['sections'][number]['docs'],
  jcCode?: string | null,
): Promise<void> {
  for (const d of docs) {
    try {
      await saveQcDoc(d.storagePath, d.fileName, jcCode);
    } catch {
      // skip files the server refuses or cannot sign
    }
  }
}
