// ADR-235 — the orange "Cancel requested by <name>" banner on a document's
// detail page while its Cancel Request waits for approval. Reads the same
// preview the Cancel dialog does (its `pending` row), so the page and the
// dialog can never disagree. Renders nothing when no request is open, when the
// document is already Cancelled, or when the preview cannot be read.

import type { CancelDocType } from '@innovic/shared';
import { fmtDateTime } from '@/lib/date';
import { Banner } from '@/ui/feedback';
import { useCancelPreview } from '../api';

export function CancelPendingBanner({
  docType,
  docId,
  cancelled,
  onOpen,
}: {
  docType: CancelDocType;
  docId: string;
  /** The document is already Cancelled — nothing can be pending. */
  cancelled: boolean;
  /** Opens the Cancel dialog (Withdraw / Approve / Reject live there). */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element | null {
  const preview = useCancelPreview(docType, docId, !cancelled);
  const r = cancelled ? null : preview.data?.pending;
  if (!r) return null;
  return (
    <div className="mb-2">
      <Banner tone="warn" accent title={`Cancel requested by ${r.requestedByName ?? '—'}`}>
        <div>
          Reason: <b>{r.reason}</b>
        </div>
        <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
          Asked on {fmtDateTime(r.requestedAt)} — waiting for approval. Until it is approved the
          document stays as it is.
          {onOpen ? (
            <>
              {' '}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
                Open Cancel Request
              </button>
            </>
          ) : null}
        </div>
      </Banner>
    </div>
  );
}
