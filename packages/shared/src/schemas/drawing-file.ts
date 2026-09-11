// The drawing-file link contract.
//
// Until 2026-09-11 the browser signed its own Storage links with the user's
// session (apps/web/src/lib/storage.ts), and the only rule on the bucket was
// "same company". That meant every logged-in person could fetch every drawing,
// and nothing was recorded. A permission that only hid a button would have been
// decoration.
//
// So the SERVER mints every drawing link now. The browser asks this route, the
// route checks who is asking, writes an activity_log row, and hands back a
// short-lived URL. `download` is refused outright without the drawing-download
// switch (see canDownloadDrawings) — hiding the button is only the courtesy
// half; this is the half that holds.

import { z } from 'zod';

/** What the browser wants to do with the file. The two modes produce the same
 *  kind of link and differ by ONE header — `download` sets a Content-
 *  Disposition that makes the browser save rather than show. That is exactly
 *  why the check lives on the server: the difference is trivial to forge. */
export const DRAWING_URL_MODES = ['view', 'download'] as const;
export type DrawingUrlMode = (typeof DRAWING_URL_MODES)[number];

/** Where a drawing can legitimately come from. Sent so the log says WHICH
 *  document the file was opened from — "IN-SO-00042 line 3", not just a storage
 *  path nobody can read back. */
export const DRAWING_SOURCES = [
  'so_line',
  'jw_line',
  'job_card',
  'item',
  'qc_document',
  'so_document',
] as const;
export type DrawingSource = (typeof DRAWING_SOURCES)[number];

export const drawingUrlQuerySchema = z.object({
  /** Storage path inside the private `qc-docs` bucket. The server checks it
   *  really is a drawing this company owns before signing anything — a path is
   *  a guessable string and must never be taken on trust. */
  path: z.string().min(1).max(512),
  mode: z.enum(DRAWING_URL_MODES).default('view'),
  source: z.enum(DRAWING_SOURCES).optional(),
  /** The document the file hangs off, for the log: an SO/JWSO/JC code, or the
   *  item code. Display only — never used to find the file. */
  refCode: z.string().max(64).optional(),
  /** Suggested filename for a download. Ignored in `view` mode. */
  fileName: z.string().max(255).optional(),
});
export type DrawingUrlQuery = z.infer<typeof drawingUrlQuerySchema>;

export const drawingUrlResponseSchema = z.object({
  /** Short-lived signed URL. Treat as single-use: it expires in seconds, and
   *  asking again is cheap and gets logged, which is the point. */
  url: z.string(),
  /** Seconds the URL stays valid, so a viewer can refresh before it lapses. */
  expiresIn: z.number().int().positive(),
  /** Echoed back so a screen can assert it got what it asked for. */
  mode: z.enum(DRAWING_URL_MODES),
});
export type DrawingUrlResponse = z.infer<typeof drawingUrlResponseSchema>;
