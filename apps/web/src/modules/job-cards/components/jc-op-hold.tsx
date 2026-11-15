// ADR-291 — an operation on HOLD (Engineering Change, or a Drawing Rev that is
// not Released). No qty may move on it until someone with the right releases
// it: Engineering Change Approve or Job Card Approve (the server checks; the
// screen only hides the action).
import { type EffectiveAccess, REV_CHANGE_REASON_MIN } from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms } from '@/lib/access-control';
import { useReleaseOpHold } from '@/modules/jc-ops/release-hold-api';
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { Textarea } from '@/ui/forms';

/** The two ticks that may release a hold. */
export function canReleaseHold(eff: EffectiveAccess | undefined): boolean {
  return (
    effectiveFormPerms(eff, 'ecr_create').approve || effectiveFormPerms(eff, 'jc_create').approve
  );
}

/** Orange "On hold" badge; the reason is in the hover text and, when an
 *  Engineering Change put it there, its ECR No. sits beside it. */
export function OpHoldBadge({
  reason,
  ecrCode,
}: {
  reason: string | null;
  ecrCode?: string | null | undefined;
}): React.JSX.Element {
  return (
    <span className="badge b-orange" title={reason ?? 'On hold — release the hold first'}>
      On hold
      {ecrCode ? (
        <>
          {' · '}
          <a
            href={`/ecrs?search=${encodeURIComponent(ecrCode)}`}
            className="mono"
            title={`Open ${ecrCode}`}
            onClick={(e) => e.stopPropagation()}
          >
            {ecrCode}
          </a>
        </>
      ) : null}
    </span>
  );
}

/** Orange "Rev not released" badge — the LIVE state (holdReason set, no stored
 *  hold): the op's Drawing Rev is not Released yet. Nothing to release here;
 *  the fix is releasing the Rev in the Drawing Register. */
export function RevNotReleasedBadge({ reason }: { reason: string | null }): React.JSX.Element {
  return (
    <span className="badge b-orange" title={reason ?? 'Drawing Rev not released'}>
      Rev not released
      {' · '}
      <a
        href="/drawing-register"
        title="Open Drawing Register"
        onClick={(e) => e.stopPropagation()}
      >
        Drawing Register
      </a>
    </span>
  );
}

/** "Release hold…" for one op or "Release all holds…" for every held op of
 *  the card: asks why, then POST /jc-ops/release-hold. */
export function ReleaseHoldDialog({
  jcOpIds,
  what,
  onClose,
}: {
  jcOpIds: string[];
  /** "IN-JC-00045 · Op 20 Turning" or "3 held operations of IN-JC-00045". */
  what: string;
  onClose: () => void;
}): React.JSX.Element {
  const [note, setNote] = useState('');
  const release = useReleaseOpHold();
  const toast = useToast();
  return (
    <ConfirmDialog
      title={jcOpIds.length > 1 ? 'Release all holds?' : 'Release hold?'}
      message={
        <>
          Release the hold on {what}. Qty can move on {jcOpIds.length > 1 ? 'them' : 'it'} again.
          <Textarea
            aria-label="Why the hold is released"
            placeholder={`Why is the hold released? (at least ${REV_CHANGE_REASON_MIN} characters)`}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ display: 'block', width: '100%', marginTop: 'var(--sp-2)' }}
          />
        </>
      }
      confirmLabel={jcOpIds.length > 1 ? 'Release All' : 'Release'}
      pendingLabel="Releasing…"
      tone="primary"
      onCancel={onClose}
      onConfirm={async () => {
        if (note.trim().length < REV_CHANGE_REASON_MIN) {
          throw new Error(
            `Say why the hold is released (at least ${REV_CHANGE_REASON_MIN} characters).`,
          );
        }
        await release.mutateAsync({ jcOpIds, note: note.trim() });
        toast.ok(jcOpIds.length > 1 ? 'Holds released' : 'Hold released');
        onClose();
      }}
    />
  );
}
