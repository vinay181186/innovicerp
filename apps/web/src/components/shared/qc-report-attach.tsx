// Cross-cutting "QC report attachment" controls (migration 0043, ADR-032
// Storage). Two small presentational pieces reused by every QC submit form and
// completed table/card:
//   • QcReportAttach  — file <input> that uploads to the shared qc-docs bucket
//                        and reports back { path, name }. Mirrors legacy
//                        _qcdAttachReport / _tpiAttachReport.
//   • QcReportLink    — "📄 <label>" button that opens the report in the shared
//                        FilePreviewModal (in-app preview + its Download button).
//                        It used to sign the path and `window.open` it, which on
//                        a browser set to "download PDFs" saved a file instead
//                        of showing one. Mirrors legacy _viewQCReport.
//
// Storage helpers come straight from `@/lib/storage` (uploadFile; the preview
// modal does its own signedUrl) — we do NOT depend on the qc-documents module
// (it is being rebuilt separately).

import { useState } from 'react';
import { uploadFile } from '@/lib/storage';
import { FilePreviewModal, fileNameFromPath } from './file-preview-modal';

interface AttachProps {
  /** Company id from the session (me.companyId); the storage path is namespaced
   *  under it. Upload is disabled until a non-null id is available. */
  companyId: string | null;
  /** Currently-attached file name, if any (shown next to the picker). */
  fileName: string | null;
  /** Called after a successful upload with the storage path + original name. */
  onUploaded: (path: string, name: string) => void;
  /** Called when the user clears the attachment. */
  onClear: () => void;
}

/** "📎 Attach QC Report (optional)" file picker. Uploads on pick, surfaces an
 *  inline error on failure, shows the attached file name + a Remove link. */
export function QcReportAttach({
  companyId,
  fileName,
  onUploaded,
  onClear,
}: AttachProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!companyId) {
      setErr('No company on session — cannot upload.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErr('File too large (max 10 MB).');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const path = await uploadFile(file, companyId, { folder: 'qc-reports' });
      onUploaded(path, file.name);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <label
        style={{
          cursor: companyId && !busy ? 'pointer' : 'not-allowed',
          padding: '5px 12px',
          background: 'var(--bg4)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 11,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          opacity: companyId ? 1 : 0.6,
        }}
      >
        📎 {busy ? 'Uploading…' : fileName ? fileName : 'Attach QC Report (optional)'}
        <input
          type="file"
          accept="image/*,.pdf"
          style={{ display: 'none' }}
          disabled={!companyId || busy}
          onChange={(e) => void handlePick(e)}
        />
      </label>
      {fileName ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 11 }}
          onClick={() => {
            setErr(null);
            onClear();
          }}
        >
          × Remove
        </button>
      ) : null}
      {err ? <span style={{ color: 'var(--red)', fontSize: 11 }}>{err}</span> : null}
    </div>
  );
}

/** "📄 Report" button. Opens the report in the shared FilePreviewModal —
 *  image or PDF shown in-page, Download beside it (QC reports are plain files,
 *  `kind="file"`, so Download stays visible to everyone as it always was; the
 *  drawing-only download tick does not apply). Renders nothing when no report
 *  is attached. */
export function QcReportLink({
  path,
  name,
  label,
}: {
  path: string | null;
  name?: string | null;
  /** Override the link text; defaults to the file name, else "📄 Report". */
  label?: string;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!path) return null;

  // The stored name is what the preview shows in its header and saves as; it
  // also decides image-vs-PDF. A legacy row whose name carries no extension
  // falls back to the file name inside the storage path, which always has one.
  const fileName = name && /\.[a-z0-9]{2,5}$/i.test(name) ? name : fileNameFromPath(path);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title={name ?? 'View QC report'}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--cyan)',
          fontSize: 11,
          whiteSpace: 'nowrap',
        }}
      >
        📄 {label ?? '⬇'}
      </button>
      {open ? (
        /* The modal portals to <body>, but React still bubbles its clicks up
           this tree — and this button often sits in a clickable table row.
           Stop them here so pressing Download does not also open the row. */
        <span onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <FilePreviewModal storagePath={path} fileName={fileName} onClose={() => setOpen(false)} />
        </span>
      ) : null}
    </>
  );
}
