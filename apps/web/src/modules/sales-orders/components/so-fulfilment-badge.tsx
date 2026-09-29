// ADR-196 — the SO's fulfilment status, ERPNext's words (To Deliver and Bill /
// To Deliver / To Bill / Completed / Closed). Worked out on the server; shown
// next to the SO Status badge on the list and the detail. Renders nothing for
// a draft or cancelled order (the server sends null).

import { SO_FULFILMENT_STATUS_LABEL, type SoFulfilmentStatus } from '@innovic/shared';
import { StatusBadge } from '@/ui/core';

export function SoFulfilmentBadge(props: {
  status: SoFulfilmentStatus | null | undefined;
}): React.JSX.Element | null {
  if (!props.status) return null;
  return (
    <StatusBadge
      kind="sofulfil"
      status={props.status}
      label={SO_FULFILMENT_STATUS_LABEL[props.status]}
      title="Fulfilment — what is still to deliver / bill on this SO"
    />
  );
}

/** The marker a line closed short carries beside its status (ADR-196), with
 *  the reason on hover. Grey, as Short Closed reads everywhere else. */
export function SoLineShortClosedBadge(props: {
  shortClosedAt: string | null;
  shortCloseReason: string | null;
}): React.JSX.Element | null {
  if (!props.shortClosedAt) return null;
  return (
    <StatusBadge
      kind="doc"
      status="short_closed"
      label="Short Closed"
      title={props.shortCloseReason ? `Short closed: ${props.shortCloseReason}` : 'Short closed'}
    />
  );
}
