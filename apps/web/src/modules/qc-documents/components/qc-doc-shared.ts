// Shared helpers for the QC Documents screen (ADR-199 split out of the old
// 1641-line routes/list.tsx so every piece stays under the 400-line ceiling).
// No JSX here — just the label map, the account-level download gate, and the
// "open a stored file" helper every view reaches a report through.

import type { QcDocCategory } from '@innovic/shared';
import { canDownloadDrawings, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { qcDocViewUrl } from '../api';

/** Screen words for the stored category codes (the code stays the value). */
export const CATEGORY_LABEL: Record<QcDocCategory, string> = {
  'qc-docs': 'QC Docs',
  drawing: 'Drawing',
  inspection: 'Inspection',
  tpi: 'TPI',
  'incoming-qc': 'Incoming QC',
  'po-docs': 'PO Docs',
  design: 'Design',
  dispatch: 'Dispatch',
  other: 'Other',
};

/** Excel-export date (DD-MM-YYYY) — the export keeps its own format; the
 *  screen uses the shared `fmtDate` (DD-MMM-YYYY). */
export function fmtExportDate(iso: string | null): string {
  if (!iso) return '';
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}-${m}-${y}` : d;
}

/** "May this person SAVE a copy of a QC file?" — the whole-account tick, read
 *  the same way on every button on this page. Looking is never gated; only the
 *  bulk Download actions consult this, and they disappear when it is false
 *  rather than sitting there greyed out. */
export function useMaySaveFiles(): boolean {
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  return canDownloadDrawings(eff, me?.role);
}

// A LOOK at one file. Deliberately still a view, not a save: this is how
// everyone on the page reaches a report, and the restricted act is keeping a
// copy, not reading one. The server logs it either way.
export async function openStoragePath(path: string, refCode?: string | null): Promise<void> {
  try {
    const url = await qcDocViewUrl(path, refCode);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Could not open file. Try again.');
  }
}

/** The matrix Overall column's screen word for each stored overall code. */
export function overallLabel(ov: string): string {
  return ov === 'complete'
    ? 'Completed'
    : ov === 'partial'
      ? 'Partly Completed'
      : ov === 'no_jc'
        ? 'No JC'
        : 'No QC';
}
