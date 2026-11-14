// ADR-290 — the release actions of one Item + Drawing Rev, shared by the
// Drawing Register's row ⋯ menu and the drawing page's buttons, so both offer
// exactly the same actions for the same status and rights.
//
//   Send for Review  draft | rejected | unverified → under_review (needs a file)
//                    Drawing Register Entry or Edit
//   Approve / Reject under_review → approved | rejected — Drawing Register Approve tick
//   Release          approved → released — the per-person Drawing Release switch
//   Verify & Release unverified → released (records made before release
//                    control; needs a file) — the same switch, same endpoint
//   Mark Obsolete    any but obsolete → obsolete — Drawing Register Approve tick
//
// The server checks every one again (§20.2 conditional update; 409 when
// someone acted first — the dialog shows the message and the lists re-read).

import {
  REV_CHANGE_REASON_MIN,
  type RevReleaseStatus,
  type RevStatusAction,
} from '@innovic/shared';
import { useState } from 'react';
import { canReleaseDrawings, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import { useRevStatusAction } from '../api';

/** What an action needs from the Rev it acts on. */
export interface RevActionTarget {
  id: string;
  label: string;
  releaseStatus: RevReleaseStatus;
  updatedAt: string;
  hasFile: boolean;
}

export interface RevActionRights {
  submit: boolean;
  approve: boolean;
  release: boolean;
  /** Replace drawing — Route Card Master Edit (the existing replace right). */
  replace: boolean;
}

/** The current user's rights for the release actions. */
export function useRevActionRights(): RevActionRights {
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const perms = effectiveFormPerms(eff, 'drawingreg_create');
  return {
    submit: perms.entry || perms.edit,
    approve: perms.approve,
    release: canReleaseDrawings(eff, me?.role),
    replace: effectiveFormPerms(eff, 'routecard_create').edit,
  };
}

export interface RevActionChoice {
  action: RevStatusAction;
  label: string;
  /** Greyed with this reason (shown, not hidden — the status allows it). */
  disabledReason?: string | undefined;
}

const SUBMIT_FROM: readonly RevReleaseStatus[] = ['draft', 'rejected', 'unverified'];

/** The actions this user may take on this Rev in its current status. */
export function revActionsFor(t: RevActionTarget, r: RevActionRights): RevActionChoice[] {
  const out: RevActionChoice[] = [];
  const s = t.releaseStatus;
  if (r.submit && SUBMIT_FROM.includes(s)) {
    out.push({
      action: 'submit',
      label: 'Send for Review',
      disabledReason: t.hasFile ? undefined : 'No drawing file',
    });
  }
  if (r.approve && s === 'under_review') {
    out.push({ action: 'approve', label: 'Approve' });
    out.push({ action: 'reject', label: 'Reject…' });
  }
  if (r.release && s === 'approved') out.push({ action: 'release', label: 'Release' });
  if (r.release && s === 'unverified') {
    out.push({
      action: 'release',
      label: 'Verify & Release',
      disabledReason: t.hasFile ? undefined : 'Upload the drawing first',
    });
  }
  if (r.approve && s !== 'obsolete') out.push({ action: 'obsolete', label: 'Mark Obsolete…' });
  return out;
}

/** Release on an Unverified Rev — an old record Design checks and releases in
 *  one step. Same endpoint as Release; its own words so the dialog matches
 *  the "Verify & Release" button that opened it. */
const VERIFY_RELEASE_TEXT = {
  title: 'Verify & release {label}?',
  confirm: 'Verify & Release',
  pending: 'Releasing…',
  message:
    'This Rev was made before release control. Check the drawing on file is right: Plan, PRO and Job Card then use it without the Unverified warning. Older released Revs of the item become Superseded.',
  done: 'Drawing Rev verified and released',
};

const TEXT: Record<
  RevStatusAction,
  { title: string; confirm: string; pending: string; message: string; done: string }
> = {
  submit: {
    title: 'Send {label} for review?',
    confirm: 'Send for Review',
    pending: 'Sending…',
    message: 'The drawing goes to the Drawing Register approver.',
    done: 'Sent for review',
  },
  approve: {
    title: 'Approve {label}?',
    confirm: 'Approve',
    pending: 'Approving…',
    message: 'The drawing is checked. It still needs Release before Plan, PRO or Job Card.',
    done: 'Drawing Rev approved',
  },
  reject: {
    title: 'Reject {label}?',
    confirm: 'Reject',
    pending: 'Rejecting…',
    message: 'The Rev goes back to Design with your reason.',
    done: 'Drawing Rev rejected',
  },
  release: {
    title: 'Release {label}?',
    confirm: 'Release',
    pending: 'Releasing…',
    message:
      'Plan, PRO and Job Card may then use this Rev. Older released Revs of the item become Superseded.',
    done: 'Drawing Rev released',
  },
  obsolete: {
    title: 'Mark {label} obsolete?',
    confirm: 'Mark Obsolete',
    pending: 'Saving…',
    message: 'An obsolete Rev is never used for new work.',
    done: 'Drawing Rev marked obsolete',
  },
};

/** Reject and Mark Obsolete need a reason; Send for Review takes an optional
 *  change note. */
const NOTE: Partial<Record<RevStatusAction, { label: string; required: boolean }>> = {
  submit: { label: 'Change Note', required: false },
  reject: { label: 'Reject Reason', required: true },
  obsolete: { label: 'Obsolete Reason', required: true },
};

export function RevActionDialog({
  target,
  action,
  onClose,
}: {
  target: RevActionTarget;
  action: RevStatusAction;
  onClose: () => void;
}): React.JSX.Element {
  const run = useRevStatusAction();
  const toast = useToast();
  const [note, setNote] = useState('');
  const t =
    action === 'release' && target.releaseStatus === 'unverified'
      ? VERIFY_RELEASE_TEXT
      : TEXT[action];
  const noteSpec = NOTE[action];
  const noteId = `rev-action-note-${action}`;
  return (
    <ConfirmDialog
      title={t.title.replace('{label}', target.label)}
      tone={action === 'reject' || action === 'obsolete' ? 'danger' : 'primary'}
      confirmLabel={t.confirm}
      pendingLabel={t.pending}
      message={
        <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <span>{t.message}</span>
          {noteSpec ? (
            <FormField label={noteSpec.label} required={noteSpec.required} htmlFor={noteId}>
              <textarea
                id={noteId}
                className="innovic-input"
                rows={2}
                maxLength={500}
                placeholder={
                  noteSpec.required
                    ? `At least ${REV_CHANGE_REASON_MIN} characters`
                    : 'What changed in this Rev'
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
          ) : null}
        </div>
      }
      onCancel={onClose}
      onConfirm={async () => {
        const trimmed = note.trim();
        if (noteSpec?.required && trimmed.length < REV_CHANGE_REASON_MIN) {
          throw new Error(
            `${noteSpec.label} is required (at least ${REV_CHANGE_REASON_MIN} characters).`,
          );
        }
        // Thrown errors (a 409 "already approved by …") stay in the dialog.
        await run.mutateAsync({
          id: target.id,
          action,
          input: {
            expectedUpdatedAt: target.updatedAt,
            ...(trimmed ? { note: trimmed } : {}),
          },
        });
        toast.ok(t.done);
        onClose();
      }}
    />
  );
}
