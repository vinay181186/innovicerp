// ADR-252 D3 — "⬇ ZIP (SO)" / "⬇ ZIP (POL n)". The server signs every link in
// one call (and logs each open); the browser fetches the files and builds ONE
// ZIP with the folder tree from zipPlan(). A file that fails is named in the
// result, never skipped silently.

import type { QcDossierOrderKind } from '@innovic/shared';
import JSZip from 'jszip';
import { fetchQcDossierUrls } from '../api';
import type { ZipItem } from './dossier-model';

export interface ZipProgress {
  done: number;
  total: number;
}

export interface ZipResult {
  saved: number;
  failed: string[];
}

/** Hands a built Blob to the browser as a download (same anchor-click the
 *  app's other exports use). */
function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function buildDossierZip(args: {
  kind: QcDossierOrderKind;
  orderId: string;
  zipName: string;
  items: ZipItem[];
  onProgress: (p: ZipProgress) => void;
}): Promise<ZipResult> {
  const { items } = args;
  if (items.length === 0) return { saved: 0, failed: [] };
  const paths = Array.from(new Set(items.map((i) => i.storagePath)));
  // The contract caps one request at 300 paths.
  const urlByPath = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 300) {
    const res = await fetchQcDossierUrls({
      kind: args.kind,
      orderId: args.orderId,
      storagePaths: paths.slice(i, i + 300),
    });
    for (const u of res.urls) urlByPath.set(u.storagePath, u.url);
  }

  const zip = new JSZip();
  const failed: string[] = [];
  let done = 0;
  args.onProgress({ done, total: items.length });
  for (const it of items) {
    const url = urlByPath.get(it.storagePath);
    try {
      if (!url) throw new Error('no link');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      zip.file(it.path, await res.blob());
    } catch {
      failed.push(it.fileName);
    }
    done += 1;
    args.onProgress({ done, total: items.length });
  }
  const saved = items.length - failed.length;
  if (saved > 0) {
    const blob = await zip.generateAsync({ type: 'blob' });
    saveBlob(blob, `${args.zipName}.zip`);
  }
  return { saved, failed };
}
