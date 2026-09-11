// Drawing links — the ONE door every drawing in the web app goes through.
//
// Until 2026-09-11 the browser signed its own Storage link for a drawing with
// the user's own session (`@/lib/storage` signedUrl). Two things followed from
// that and neither was acceptable: the only rule the bucket enforces is "same
// company", so any logged-in person could fetch any drawing; and nothing was
// written down, so nobody could answer "who took this print". A permission that
// merely hid a Download button would have been decoration over both.
//
// So the SERVER mints drawing links now. `GET /drawing-files/url` checks who is
// asking, refuses `download` outright to anyone without the per-person
// drawing-download tick (see canDownloadDrawings in @innovic/shared), writes an
// activity-log row either way, and hands back a short-lived signed URL.
//
// Two modes, on purpose:
//   view      — inline disposition. Looking at a drawing. Everyone may.
//   download  — attachment disposition. Saving a copy. Ticked people only.
// The screens ask for the mode that matches what the user just clicked; the
// server decides whether they get it. Never ask for `download` to render a
// preview — that would log a save nobody made.
//
// `source` + `refCode` exist only so the log reads back as a sentence a human
// can act on: "IN-SO-26-00521 line 3", not a storage path nobody recognises.

import type { DrawingSource, DrawingUrlResponse } from '@innovic/shared';
import { apiFetch } from './api';

export interface DrawingUrlArgs {
  /** Storage path of the drawing. The server re-checks it belongs to this
   *  company before signing — a path is a guessable string. */
  path: string;
  /** Which document the file hangs off. Log readability only. */
  source?: DrawingSource;
  /** The document's own code (SO/JWSO/JC number, or the item code). */
  refCode?: string | null;
  /** Suggested saved-as name. Ignored by the server in `view` mode. */
  fileName?: string | null;
}

async function requestDrawingUrl(
  args: DrawingUrlArgs,
  mode: 'view' | 'download',
): Promise<DrawingUrlResponse> {
  const p = new URLSearchParams();
  p.set('path', args.path);
  p.set('mode', mode);
  if (args.source) p.set('source', args.source);
  if (args.refCode) p.set('refCode', args.refCode);
  if (mode === 'download' && args.fileName) p.set('fileName', args.fileName);
  return apiFetch<DrawingUrlResponse>(`/drawing-files/url?${p.toString()}`);
}

/** Link for LOOKING at a drawing (inline). Everyone may; it still gets logged. */
export async function drawingViewUrl(args: DrawingUrlArgs): Promise<string> {
  const res = await requestDrawingUrl(args, 'view');
  return res.url;
}

/** Link for SAVING a drawing (attachment disposition). The server refuses this
 *  for anyone without the tick, so callers should also hide their Download
 *  button — the hiding is the courtesy, this is the enforcement. */
export async function drawingDownloadUrl(args: DrawingUrlArgs): Promise<string> {
  const res = await requestDrawingUrl(args, 'download');
  return res.url;
}

/** Mints a download link and saves the file, without navigating the page away.
 *  An anchor click rather than `window.open`, because a popup blocker eats the
 *  second and subsequent windows of a bulk save and the user is left wondering
 *  which files arrived. */
export async function saveDrawing(args: DrawingUrlArgs): Promise<void> {
  const name = args.fileName ?? (args.path.split('/').pop() ?? 'drawing');
  const url = await drawingDownloadUrl({ ...args, fileName: name });
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
