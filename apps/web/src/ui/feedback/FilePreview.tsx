// FilePreview — the in-app file viewer every 📎 opens.
//
// Ported from components/shared/file-preview-modal.tsx, which stays the live
// screen-facing wrapper (it owns the signed-URL minting, the drawing access
// log and the `useMyAccess()` download tick). This file is the SHELL only:
// pure props, no fetch, so the /__ui-kit page can show every state and so the
// wrapper has one less thing to hand-roll.
//
// The behaviour that must survive the port:
//   - viewing and saving are TWO separate actions. The frame is fed an inline
//     signed URL; Download mints a second, attachment-disposition one. A click
//     meant as a look must never become a file on disk.
//   - Download is ABSENT, not disabled, for someone who may view a drawing but
//     not save it. A greyed-out button reads as "ask and you can have it"; the
//     owner asked for it simply not to be there.
//   - a file the browser cannot render in-page (.eml, .xlsx, .docx) says so
//     plainly instead of silently downloading itself.
//
// TWO MEANINGS OF `kind`, reconciled: design-ref's `kind` is the RENDER type
// (pdf / image / none) and that is what this component takes. The live
// wrapper's `kind` is an ACCESS class (file / drawing) and stays there — it
// reaches this shell already resolved, as `canDownload`.

import { Button } from '../core/Button';
import { Icon } from '../core/Icon';
import { Modal } from './Modal';
import { PageState } from '../layout/PageState';

/** What the browser can show in-page. */
export type FilePreviewKind = 'pdf' | 'image' | 'none';

/** Which of the three a file is, by extension first (always present) and the
 *  stored MIME type second (present for file_registry rows, absent for a bare
 *  drawing path).
 *
 *  THIS IS THE ONE COPY OF THE RULE. components/shared/file-preview-modal.tsx
 *  still carries a module-private `previewKind()` with the same regex and the
 *  same extension list; it is not exported, so it cannot be imported from
 *  here. In Phase 4 that wrapper switches onto this shell and its private copy
 *  goes with it — nobody adds `.tiff` or `.heic` to that one. */
export function filePreviewKind(fileName: string, fileType?: string | null): FilePreviewKind {
  const n = fileName.toLowerCase();
  const t = (fileType ?? '').toLowerCase();
  if (n.endsWith('.pdf') || t.includes('pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n) || t.startsWith('image/')) return 'image';
  return 'none';
}

export interface FilePreviewProps {
  /** Shown in the header and used as the saved-as name. */
  fileName: string;
  kind?: FilePreviewKind;
  /** The INLINE signed URL. Absent while it is still being minted. */
  src?: string | null;
  /** False hides the Download button entirely (never greys it out). */
  canDownload?: boolean;
  /** True while the second, attachment URL is being minted. */
  downloading?: boolean;
  /** Shown in place of the file — a link that expired, a mint that failed. */
  errorText?: string | null;
  onDownload?: () => void;
  onClose?: () => void;
  /** Render the card WITHOUT the overlay/portal, for the /__ui-kit page. */
  inline?: boolean;
}

export function FilePreview({
  fileName,
  kind = 'pdf',
  src,
  canDownload = true,
  downloading = false,
  errorText,
  onDownload,
  onClose,
  inline = false,
}: FilePreviewProps): React.JSX.Element {
  const frameHeight = inline ? '40vh' : '78vh';

  const body = errorText ? (
    <PageState state="error" message={errorText} as="page" />
  ) : kind === 'none' ? (
    // PageState owns every not-data state, including this one — the component
    // must not hand-roll a second `.empty-state` beside the one it already
    // uses for loading and error (design-ref/README.md:48).
    <PageState
      state="empty"
      as="page"
      icon="📁"
      message={
        <>
          <div className="text2">This file type cannot be previewed in the browser.</div>
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
            {canDownload
              ? 'Use Download above to save it and open it on your computer.'
              : 'You can view drawings but not save them. Ask an administrator if you need a copy.'}
          </div>
        </>
      }
    />
  ) : !src ? (
    // No ⟳ — the reference's line is the words alone
    // (design-ref/components/feedback/FilePreview.jsx:7).
    <PageState state="loading" message="Loading preview…" as="page" />
  ) : kind === 'pdf' ? (
    <iframe
      src={src}
      title={fileName}
      style={{ width: '100%', height: frameHeight, border: 0, display: 'block' }}
    />
  ) : (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: inline ? '30vh' : '60vh',
        padding: 'var(--sp-4)',
      }}
    >
      <img
        src={src}
        alt={fileName}
        style={{ maxWidth: '100%', maxHeight: frameHeight, objectFit: 'contain' }}
      />
    </div>
  );

  return (
    <Modal
      size="lg"
      inline={inline}
      title={`📎 ${fileName}`}
      // The reference names this × for what it closes, not for the generic
      // "Close" (design-ref/components/feedback/FilePreview.jsx:14).
      closeLabel="Close preview"
      bodyStyle={{ padding: 0, background: 'var(--bg3)' }}
      {...(onClose ? { onClose } : {})}
      headerActions={
        canDownload ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Icon name="download" size={13} />}
            onClick={onDownload}
            disabled={downloading}
          >
            {downloading ? 'Saving…' : 'Download'}
          </Button>
        ) : null
      }
    >
      {body}
    </Modal>
  );
}
