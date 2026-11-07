// ADR-282 — the Differs notice on the Job Card detail page: this Job Card's
// routing is not its Route Card's, and (when the server says it can) a button
// that sends it there. The server decides differs / canSend / blockedReason.
import type { JobCardListItem } from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { Banner, ConfirmDialog, useToast } from '@/ui/feedback';
import { useSendJobCardToRouteCard } from '../api';
import { toastRouteCardWriteBack } from '../lib/jc-route-card-note';

export function JcRouteCardNotice({
  jc,
  canSendRight,
}: {
  jc: JobCardListItem;
  /** The login may edit this Job Card, and the card is not stopped or cancelled. */
  canSendRight: boolean;
}): React.JSX.Element | null {
  const toast = useToast();
  const saveKey = useSaveKey();
  const send = useSendJobCardToRouteCard(jc.id, saveKey);
  const [asking, setAsking] = useState(false);

  const sync = jc.routeCardSync;
  if (!sync?.differs) return null;
  const code = jc.routeCardCode ?? '';
  // Replacing a newer Rev drops whatever was added since: say so before asking.
  const movedOn =
    jc.routeCardBuiltRevision !== null &&
    jc.routeCardRevision !== null &&
    jc.routeCardBuiltRevision !== jc.routeCardRevision
      ? ` This Job Card is on Route Card Rev ${jc.routeCardBuiltRevision}, the card is now on Route Card Rev ${jc.routeCardRevision}; changes made to the card since will be replaced.`
      : '';

  // A refusal stays in the dialog with the server's words (ConfirmDialog).
  const confirmSend = async (): Promise<void> => {
    const { routeCardWriteBack } = await send.mutateAsync();
    setAsking(false);
    if (routeCardWriteBack) toastRouteCardWriteBack(toast, routeCardWriteBack);
    else toast.info(`Route Card ${code} already has this Job Card's operations.`);
  };

  return (
    <>
      <Banner tone="warn">
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          <span style={{ flex: 1 }}>
            Differs from Route Card <span className="mono fw-700">{code}</span>
            {sync.blockedReason ? ` — ${sync.blockedReason}` : ''}
          </span>
          {sync.canSend && canSendRight ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={send.isPending}
              onClick={() => setAsking(true)}
            >
              Send to Route Card
            </button>
          ) : null}
        </div>
      </Banner>
      {asking ? (
        <ConfirmDialog
          title={`Send to Route Card ${code}?`}
          message={`This replaces the operations on ${code} with this Job Card's. With approval on it goes to the approver.${movedOn}`}
          confirmLabel="Yes, send"
          pendingLabel="Sending…"
          tone="primary"
          onConfirm={confirmSend}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}
