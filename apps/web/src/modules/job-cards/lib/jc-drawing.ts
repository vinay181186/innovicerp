// Which drawing a Job Card screen shows — resolution shared by the VIEW
// (jc-status-view.tsx) and the EDIT screen (jc-status-content.tsx) so the two
// cannot drift. Extracted verbatim from the view's inline block; no behaviour
// change. The rules (why SO line → JW line → this card's own upload, and why
// there is no item-master fallback) are documented at the call site in
// jc-status-view.tsx.
//
// Presentation/data-prep only: builds the `drawing` (path + label + source used
// by the file preview) and the `drawingRef` (label + file name + optional
// thumbnail) that JcViewSummary / JcViewTabs render. Both callers pass their
// already-loaded `jc` and edit `model`; this hook fetches only the thumbnail
// URL for an image drawing.
import type { JobCardEditModel, JobCardListItem } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { drawingViewUrl } from '@/lib/drawing-url';
import type { JcDrawingRef } from '../components/jc-view-summary';

/** Which stored drawings have a thumbnail worth auto-loading. Anything else
 *  (PDF, DWG, a stray .zip) gets a card and an open action instead of a
 *  broken image. */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** The resolved drawing this screen shows — path + which document it hangs off,
 *  as the shared file preview needs them. Null when the card has no drawing. */
export interface JcDrawing {
  path: string;
  label: string;
  source: 'so_line' | 'jw_line' | 'job_card';
}

/** Resolve the drawing for a Job Card screen and its display ref. `jc` and
 *  `model` are the caller's already-loaded data; the only fetch here is the
 *  thumbnail URL for an image drawing. */
export function useJcDrawing(
  jc: Pick<JobCardListItem, 'code' | 'drawingFilePath'> | undefined,
  model: JobCardEditModel | undefined,
): { drawing: JcDrawing | null; drawingRef: JcDrawingRef | null } {
  /** Caption suffix for the revision printed on that drawing, when there is
   *  one. Blank rather than "Rev —": an empty revision is not a fact. */
  const revSuffix = (rev: string | null | undefined): string => (rev ? ` · Rev ${rev}` : '');
  const drawing: JcDrawing | null = model?.soLineDrawingFilePath
    ? {
        path: model.soLineDrawingFilePath,
        label: `Sales order drawing${revSuffix(model.soLineRevision)}`,
        source: 'so_line',
      }
    : model?.jwLineDrawingFilePath
      ? {
          path: model.jwLineDrawingFilePath,
          label: `Job work order drawing${revSuffix(model.jwLineRevision)}`,
          source: 'jw_line',
        }
      : jc?.drawingFilePath
        ? {
            path: jc.drawingFilePath,
            label: 'Attached to this Job Card',
            source: 'job_card',
          }
        : null;

  // Auto-loaded on open, and asked for as a VIEW. Only fetched for an image — a
  // PDF has no thumbnail to show.
  const wantThumb = Boolean(drawing && IMAGE_RE.test(drawing.path));
  const { data: drawingUrl } = useQuery({
    queryKey: ['jc-drawing', drawing?.path ?? null],
    queryFn: () =>
      drawingViewUrl({
        path: drawing?.path ?? '',
        source: drawing?.source ?? 'job_card',
        ...(jc?.code ? { refCode: jc.code } : {}),
      }),
    enabled: wantThumb,
    staleTime: 60_000,
  });
  // The stored path is `<upload-stamp>-<original name>`; the stamp is stripped
  // so the page names the file the way the user uploaded it.
  const drawingRef: JcDrawingRef | null = drawing
    ? {
        label: drawing.label,
        fileName:
          drawing.path
            .split('/')
            .pop()
            ?.replace(/^\d{10,}-/, '') ?? 'drawing',
        thumbUrl: wantThumb ? (drawingUrl ?? null) : null,
      }
    : null;

  return { drawing, drawingRef };
}
