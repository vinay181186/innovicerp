// ADR-235 — the red "Cancelled — <reason> · <date>" banner on a cancelled
// Sales Order / JWSO / Plan detail page. The document stays on record; who
// cancelled it is in its History tab. Renders nothing while the document is live.

import { fmtDateTime } from '@/lib/date';
import { Banner } from '@/ui/feedback';

export function OrderCancelledBanner({
  cancelled,
  docLabel,
  reason,
  cancelledAt,
}: {
  cancelled: boolean;
  /** "SO", "JWSO", "Plan" — named in the title. */
  docLabel: string;
  reason: string | null | undefined;
  cancelledAt: string | null | undefined;
}): React.JSX.Element | null {
  if (!cancelled) return null;
  return (
    <div className="mb-2">
      <Banner tone="error" accent title={`Cancelled — this ${docLabel} is no longer live`}>
        <div>
          Reason: <b>{reason ?? '—'}</b>
          {cancelledAt ? <span className="text3"> · {fmtDateTime(cancelledAt)}</span> : null}
        </div>
        <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
          Who cancelled it is in History below.
        </div>
      </Banner>
    </div>
  );
}
