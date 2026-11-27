// ADR-323 — the status actions of one Item + Drawing Rev, shared by the
// Drawing Register's row ⋯ menu and the drawing page's buttons, so both offer
// exactly the same actions for the same status and rights.
//
//   ✓ Verify…        unverified → verified — Drawing Register Approve tick; needs
//                    the PDF. The dialog names the file and sends its path, so a
//                    file replaced meanwhile is refused (409 "The drawing changed").
//   ↺ Undo verify…   verified → unverified — Approve tick, reason ★ (min 5)
//   Mark Obsolete…   any but obsolete → obsolete — Approve tick, reason ★
//   ⬆ Upload drawing… (no PDF yet) — Drawing Register Entry
//   ⬆ Replace drawing… (has a PDF) — Drawing Register Edit
//
// The server checks every one again (§20.2 conditional update; 409 when
// someone acted first — the dialog shows the message and the lists re-read).

import {
  REV_CHANGE_REASON_MIN,
  type RevReleaseStatus,
  type RevStatusAction,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDateTime } from '@/lib/date';
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { CheckField, FormField } from '@/ui/forms';
import { useItemRevision, useRevStatusAction } from '../api';

/** What an action needs from the Rev it acts on. */
export interface RevActionTarget {
  id: string;
  label: string;
  releaseStatus: RevReleaseStatus;
  updatedAt: string;
  hasFile: boolean;
}

export interface RevActionRights {
  /** Verify / Undo verify / Mark Obsolete — Drawing Register Approve tick. */
  verify: boolean;
  /** First PDF of a Rev — Drawing Register Entry. */
  upload: boolean;
  /** Replace the PDF of a Rev that has one — Drawing Register Edit. */
  replace: boolean;
}

/** The current user's rights for the Drawing Register actions. */
export function useRevActionRights(): RevActionRights {
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'drawingreg_create');
  return { verify: perms.approve, upload: perms.entry, replace: perms.edit };
}

export interface RevActionChoice {
  action: RevStatusAction;
  label: string;
  /** Greyed with this reason (shown, not hidden — the status allows it). */
  disabledReason?: string | undefined;
}

/** The status actions this user may take on this Rev, in menu order. */
export function revActionsFor(t: RevActionTarget, r: RevActionRights): RevActionChoice[] {
  const out: RevActionChoice[] = [];
  if (!r.verify) return out;
  const s = t.releaseStatus;
  if (s === 'unverified') {
    out.push({
      action: 'verify',
      label: '✓ Verify…',
      disabledReason: t.hasFile ? undefined : 'Upload the drawing first',
    });
  }
  if (s === 'verified') out.push({ action: 'unverify', label: '↺ Undo verify…' });
  if (s !== 'obsolete') out.push({ action: 'obsolete', label: 'Mark Obsolete…' });
  return out;
}

/** "⬆ Upload drawing…" (no PDF yet, Entry right) or "⬆ Replace drawing…"
 *  (has a PDF, Edit right); null when this user may not, or the Rev is Obsolete. */
export function revUploadChoice(t: RevActionTarget, r: RevActionRights): string | null {
  if (t.releaseStatus === 'obsolete') return null;
  if (t.hasFile) return r.replace ? '⬆ Replace drawing…' : null;
  return r.upload ? '⬆ Upload drawing…' : null;
}

const TEXT: Record<
  RevStatusAction,
  { title: string; confirm: string; pending: string; message: string; done: string }
> = {
  verify: {
    title: 'Verify {label}?',
    confirm: '✓ Verify',
    pending: 'Verifying…',
    message: 'Plan, PRO and Job Card then use this drawing without the Unverified warning.',
    done: '{label} verified',
  },
  unverify: {
    title: 'Undo verify of {label}?',
    confirm: '↺ Undo verify',
    pending: 'Saving…',
    message: 'The Rev goes back to Unverified and must be verified again.',
    done: '{label} is Unverified again',
  },
  obsolete: {
    title: 'Mark {label} obsolete?',
    confirm: 'Mark Obsolete',
    pending: 'Saving…',
    message: 'An obsolete Rev is never used for new work.',
    done: '{label} marked obsolete',
  },
};

/** Undo verify and Mark Obsolete need a reason. */
const NOTE: Partial<Record<RevStatusAction, string>> = {
  unverify: 'Undo Reason',
  obsolete: 'Obsolete Reason',
};

const VERIFY_TICK = 'I opened the PDF and checked the Drawing No. and Rev match this record.';

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
  // Verify names the file the person checks — read it fresh (the register row
  // carries only "has a PDF"), and send that path back (409 if it changed).
  const detail = useItemRevision(action === 'verify' ? target.id : undefined);
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState(false);
  const t = TEXT[action];
  const noteLabel = NOTE[action];
  const noteId = `rev-action-note-${action}`;
  const rev = detail.data;
  const path = rev?.drawingFilePath ?? null;
  const uploaded =
    path && rev
      ? [...rev.history]
          .filter((h) => h.drawingFilePath === path)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  return (
    <ConfirmDialog
      title={t.title.replace('{label}', target.label)}
      tone={action === 'obsolete' ? 'danger' : 'primary'}
      confirmLabel={t.confirm}
      pendingLabel={t.pending}
      // Verify stays grey until the drawing is loaded, has a PDF and is ticked.
      confirmDisabled={action === 'verify' && (detail.isLoading || !path || !ticked)}
      message={
        <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          {action === 'verify' ? (
            detail.isLoading ? (
              <span className="text3">Loading the drawing…</span>
            ) : path ? (
              <>
                <span>
                  PDF: <span className="mono fw-700">{fileNameFromPath(path)}</span>
                </span>
                {uploaded ? (
                  <span className="text3">
                    Uploaded by {uploaded.createdByName ?? '—'} on {fmtDateTime(uploaded.createdAt)}
                  </span>
                ) : null}
                <Link
                  to="/drawings/$itemRevisionId"
                  params={{ itemRevisionId: target.id }}
                  target="_blank"
                  rel="noopener"
                >
                  Open the PDF
                </Link>
                <CheckField label={VERIFY_TICK} checked={ticked} onChange={setTicked} />
              </>
            ) : (
              <span className="red fw-700">Upload the drawing first.</span>
            )
          ) : null}
          <span>{t.message}</span>
          {noteLabel ? (
            <FormField label={noteLabel} required htmlFor={noteId}>
              <textarea
                id={noteId}
                className="innovic-input"
                rows={2}
                maxLength={500}
                placeholder={`At least ${REV_CHANGE_REASON_MIN} characters`}
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
        if (noteLabel && trimmed.length < REV_CHANGE_REASON_MIN) {
          throw new Error(
            `${noteLabel} is required (at least ${REV_CHANGE_REASON_MIN} characters).`,
          );
        }
        if (action === 'verify') {
          if (!path) throw new Error('Upload the drawing first.');
          if (!ticked) throw new Error('Open the PDF, check it, then tick the box.');
        }
        // Thrown errors (a 409 "The drawing changed …") stay in the dialog.
        await run.mutateAsync({
          id: target.id,
          action,
          input: {
            // The freshest version stamp this dialog has seen.
            expectedUpdatedAt: rev?.updatedAt ?? target.updatedAt,
            ...(action === 'verify' ? { expectedDrawingFilePath: path } : {}),
            ...(trimmed ? { note: trimmed } : {}),
          },
        });
        toast.ok(t.done.replace('{label}', target.label));
        onClose();
      }}
    />
  );
}
