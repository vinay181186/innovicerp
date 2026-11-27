// DrawingRevInfo — what an SO / JWSO line or a Route Card shows about its
// Item + Drawing Rev (ADR-323). READ-ONLY: the drawing PDF is uploaded only in
// the Drawing Register (Drawing Register Entry right), never on an order line
// or a Route Card.
//
// As soon as the item and a valid Rev are both filled this looks ABC/<rev> up:
//
//   register has a PDF   → "📎 View drawing" (opens the drawing page, new tab)
//   latest verified Rev of the item is a DIFFERENT one
//                        → orange "Latest verified drawing is ABC/2. This line
//                          specifies ABC/1. Confirm with the customer." + the
//                          Confirmed tick (owned by the form's useRevConfirmGate)
//   line's Drawing No. differs from the register's
//                        → small orange note (never blocks the save)
//
// No status chip on the line (owner 2026-11-26: "no need to show any tag").

import { itemRevLabel } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { CheckField } from '@/ui/forms';
import { cleanDrawingRev, useItemRevisionLookup } from '../api';

export interface DrawingRevInfoProps {
  itemId: string | null | undefined;
  /** Shown in "ABC/1" while the record does not exist yet. */
  itemCode: string | null | undefined;
  /** The Drawing Rev as typed on the form. */
  rev: string | null | undefined;
  /** SO / JWSO line: the Drawing No. typed on the line, compared with the
   *  register's. Omitted = no comparison (Route Card). */
  drawingNo?: string | null | undefined;
  /** Route Card: show the PDF's file name beside the link. */
  showFileName?: boolean | undefined;
  /** The "Confirmed" tick under "Latest verified drawing is …". Owned by the
   *  form's useRevConfirmGate. Without it the note is not shown. */
  confirm?: { checked: boolean; onChange: (checked: boolean) => void } | undefined;
}

/** "📎 View drawing" — opens the drawing page in a new tab. */
export function ViewDrawingLink({ itemRevisionId }: { itemRevisionId: string }): React.JSX.Element {
  return (
    <Link
      to="/drawings/$itemRevisionId"
      params={{ itemRevisionId }}
      target="_blank"
      rel="noopener"
      title="Open the drawing page in a new tab"
      onClick={(e) => e.stopPropagation()}
    >
      📎 View drawing
    </Link>
  );
}

const NOTE_STYLE: React.CSSProperties = {
  fontSize: 'var(--fs-xs)',
  marginTop: 'var(--sp-0)',
  whiteSpace: 'normal',
};

export function DrawingRevInfo(props: DrawingRevInfoProps): React.JSX.Element | null {
  const { itemId, itemCode, rev, drawingNo, showFileName, confirm } = props;
  const lookup = useItemRevisionLookup(itemId, rev);
  const cleaned = cleanDrawingRev(rev);
  const active = Boolean(itemId && cleaned);
  const data = active ? lookup.data : undefined;
  const revision = data?.revision ?? null;
  const file = revision?.drawingFilePath ?? null;
  const label = revision?.label ?? itemRevLabel(itemCode, cleaned);
  const latestLabel = data?.release?.latestReleasedLabel ?? null;
  const registerDno = revision?.drawingNo?.trim() ?? '';
  const dnoDiffers =
    drawingNo !== undefined &&
    registerDno !== '' &&
    registerDno.toUpperCase() !== (drawingNo ?? '').trim().toUpperCase();

  if (!active) return null;
  if (lookup.isFetching && !lookup.data) {
    return (
      <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
        <Loader2 size={12} className="inline animate-spin" /> checking {label}…
      </span>
    );
  }
  if (lookup.isError && !lookup.data) {
    return (
      <span className="red" style={{ fontSize: 'var(--fs-xs)' }}>
        Could not check {label}
      </span>
    );
  }
  if (!file && !(latestLabel && confirm) && !dnoDiffers) return null;
  return (
    <div style={{ minWidth: 0 }}>
      {file && revision ? (
        <span
          style={{
            display: 'inline-flex',
            gap: 'var(--sp-1)',
            alignItems: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {showFileName ? (
            <span className="mono" title={fileNameFromPath(file)}>
              {fileNameFromPath(file)}
            </span>
          ) : null}
          <ViewDrawingLink itemRevisionId={revision.id} />
        </span>
      ) : null}
      {latestLabel && confirm ? (
        <div className="amber" style={NOTE_STYLE}>
          <div>
            Latest verified drawing is <b className="mono">{latestLabel}</b>. This line specifies{' '}
            <b className="mono">{label}</b>. Confirm with the customer.
          </div>
          <CheckField
            label={
              <>
                <span className="fw-700">Confirmed</span> <span className="red">*</span>
              </>
            }
            checked={confirm.checked}
            onChange={confirm.onChange}
          />
        </div>
      ) : null}
      {dnoDiffers ? (
        <div className="amber" style={NOTE_STYLE}>
          Drawing Register has Drawing No. <b className="mono">{registerDno}</b> for{' '}
          <b className="mono">{label}</b>.
        </div>
      ) : null}
    </div>
  );
}
