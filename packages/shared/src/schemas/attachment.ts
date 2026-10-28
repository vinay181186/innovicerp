// File attachments — ONE size rule and ONE QC-report type list for every
// upload screen (owner decision 2026-10-28: 50 MB per file).
//
// 50 MB is also the PROD Supabase project's per-file ceiling, and migration
// 0226 puts the same number on the `qc-docs` bucket, so the storage refuses
// what the screen refuses. Item images keep their own smaller cap
// (ITEM_IMAGE_MAX_BYTES) because they are resized thumbnails.

export const ATTACHMENT_MAX_MB = 50;
export const ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_MB * 1024 * 1024;

/** What a QC report may be — the same list on every QC screen (Op Entry, QC
 *  Call inspect, Incoming QC, TPI, QC Docs Upload, Dossier). Keeps every photo
 *  type the QC attach took before (it accepted any image). */
export const QC_REPORT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,.doc,.docx,.xls,.xlsx';
export const QC_REPORT_TYPES_LABEL = 'PDF, photo, Word or Excel';

/** Rounded UP to 0.1 MB, so a file just over the limit never reads as "50.0". */
function fmtMb(bytes: number): string {
  return (Math.ceil((bytes / (1024 * 1024)) * 10) / 10).toFixed(1);
}

/** The message to show when a picked file is too big, or null when it fits. */
export function attachmentSizeError(file: { name: string; size: number }): string | null {
  if (file.size <= ATTACHMENT_MAX_BYTES) return null;
  return `${file.name} is ${fmtMb(file.size)} MB. The limit is ${ATTACHMENT_MAX_MB} MB — scan at 150–200 dpi or split the file.`;
}

/** True when the file's extension is on an `accept` list such as QC_REPORT_ACCEPT. */
export function attachmentTypeAllowed(fileName: string, accept: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = fileName.slice(dot).toLowerCase();
  return accept.split(',').some((a) => a.trim().toLowerCase() === ext);
}
