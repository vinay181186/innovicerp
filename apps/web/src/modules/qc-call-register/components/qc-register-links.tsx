// QC register screen — URL types + the ADR-312 "open ready" link popups.
// Split out of qc-register-screen.tsx to keep that file under 400 lines.

import { useEffect, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { usePartyGrnDetail } from '@/modules/party-grn/api';
import { isPartyGrnCancelled } from '@/modules/party-grn/components/party-grn-columns';
import { PartyGrnQcModal } from '@/modules/party-grn/components/party-grn-qc-modal';

/** The URL params the screen reads (each route validates its own). */
export interface QcScreenParams {
  line?: string | undefined;
  op?: string | undefined;
  tab?: 'qc' | 'tpi' | undefined;
  search?: string | undefined;
  page?: number | undefined;
  /** ADR-312 — ?tpiOp=<jcOpId> opens that op's TPI card on the TPI tab. */
  tpiOp?: string | undefined;
  /** ADR-312 — ?pgrn=<partyGrnId> opens that Party GRN's QC popup (Incoming QC). */
  pgrn?: string | undefined;
}
/** The URL writes the screen makes: the page, and stripping a consumed link. */
export type QcScreenPatch = {
  page?: number | undefined;
  line?: undefined;
  op?: undefined;
  tpiOp?: undefined;
  pgrn?: undefined;
};

/** ADR-312 — ?pgrn=<id>: the Party GRN QC popup for that receipt, opened once
 *  (the param is stripped at once, so a refresh does not reopen it). Shown only
 *  when this user may save Incoming QC and the receipt still has lines waiting —
 *  the same test as the Party GRN detail page's QC button; otherwise nothing. */
export function LinkedPgrnQc(props: {
  pgrnId: string | undefined;
  /** The route's search writer — used once, to strip the consumed ?pgrn=. */
  patch: (patch: QcScreenPatch) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { pgrnId, patch, onClose } = props;
  const [id, setId] = useState<string | undefined>(undefined);
  const takenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pgrnId || takenRef.current === pgrnId) return;
    takenRef.current = pgrnId;
    setId(pgrnId);
    patch({ pgrn: undefined });
  }, [pgrnId, patch]);
  const { data: eff } = useMyAccess();
  const allowed = eff ? effectiveFormPerms(eff, 'qc_incoming').entry : false;
  const { data: g } = usePartyGrnDetail(allowed ? id : undefined);
  if (!id || !g || !allowed) return null;
  if (g.qcPendingLines <= 0 || isPartyGrnCancelled(g)) return null;
  return (
    <PartyGrnQcModal
      row={g}
      onClose={() => {
        setId(undefined);
        onClose();
      }}
    />
  );
}
