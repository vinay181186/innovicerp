// ConfirmDialog — the ONE way this app asks "are you sure?".
//
// It replaces 64 `window.confirm` / `alert` / `prompt` calls across 42 files
// plus ~17 screens that swap a row's Delete button for an inline
// "Delete? [Confirm][Cancel]" pair. A browser prompt cannot be styled, cannot
// show the document code it is about, blocks the whole tab, and — in the
// worst case found, Trash → Empty All — gated an IRREVERSIBLE bulk delete
// behind `window.prompt("… Type DELETE to confirm")`, which is a text box the
// user can paste anything into with no warning list in front of it.
//
// So this dialog is fully parametrised, and carries the two shapes the app
// actually needs:
//   1. a plain question   — title, message, Cancel / Confirm
//   2. a typed question   — `requireTyped="DELETE"`, where Confirm stays
//      disabled until the word is typed EXACTLY (case-sensitive, same rule
//      the old prompt used: `confirmText !== 'DELETE'` → do nothing)
//
// `onConfirm` may return a promise: while it is running both buttons are
// disabled, the confirm button shows its pending label, and a rejection is
// shown IN the dialog instead of closing it, so the user does not lose the
// question along with the error.
//
// Deleting always goes through here. Never `window.confirm`, never an inline
// button swap — see design-ref/README.md, "Uniformity rule".
//
// IT SITS AT 600, NOT 500. A confirm is BY DEFINITION raised over something
// already open — the form it is asking about. Both authorities say so:
// design-ref/components/feedback/ConfirmDialog.jsx:10 hard-codes
// `zIndex: 600` on its overlay, and lib/exit-guard.tsx:188-195
// (`ExitConfirmDialog`, the file this replaces) defaults `zIndex = 600`
// unconditionally. `elevated={false}` drops it back to the plain 500 for the
// rare confirm that is the only thing on screen.

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '../core/Button';
import { Banner } from './Banner';
import { Modal } from './Modal';

/** The question card's width — the design reference pins it at 420px. */
const CONFIRM_MAX_WIDTH = 'min(420px, 96vw)';

export interface ConfirmDialogProps {
  /** Defaults to true so `{asking && <ConfirmDialog …/>}` also reads right. */
  open?: boolean;
  /** Name the document in the title: "Delete SO IN-SO-26-0142?". */
  title?: string;
  /** What actually happens. One or two plain sentences. */
  message?: React.ReactNode;
  /** Bullet lines under the message, for an irreversible action. */
  warnings?: React.ReactNode[];
  confirmLabel?: string;
  cancelLabel?: string;
  /** Shown on the confirm button while `onConfirm` is running. */
  pendingLabel?: string;
  /** danger = a destructive confirm (red). primary = an ordinary one. */
  tone?: 'danger' | 'primary';
  /** May return a promise — the dialog then shows a pending state. */
  onConfirm?: () => void | Promise<void>;
  /** Cancel, Escape, and a click on the dim background all land here. */
  onCancel?: () => void;
  /** Confirm stays disabled until this exact word is typed (e.g. "DELETE"). */
  requireTyped?: string;
  /** Overrides the "Type DELETE to confirm" label above that box. */
  requireTypedLabel?: string;
  /** A caller-owned error to show in the dialog (in place of closing it). */
  errorText?: string | null;
  /** Defaults to TRUE: a confirm stands over the form it is asking about, at
   *  600. Pass false only for a confirm that is the only overlay on screen. */
  elevated?: boolean;
  /** Render the card WITHOUT the overlay/portal, for the /__ui-kit page. */
  inline?: boolean;
}

export function ConfirmDialog({
  open = true,
  title = 'Are you sure you want to exit?',
  message = 'Anything entered on this form will be lost.',
  warnings,
  confirmLabel = 'Exit',
  cancelLabel = 'Cancel',
  pendingLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
  requireTyped,
  requireTypedLabel,
  errorText,
  elevated = true,
  inline = false,
}: ConfirmDialogProps): React.JSX.Element | null {
  const typedId = useId();
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Re-asking must start from a blank box, never from the word the user typed
  // for the PREVIOUS row.
  useEffect(() => {
    if (!open) {
      setTyped('');
      setFailure(null);
    }
  }, [open]);

  const typedOk = requireTyped === undefined || typed === requireTyped;

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!onConfirm || pending) return;
    if (requireTyped !== undefined && typed !== requireTyped) return;
    setFailure(null);
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setPending(true);
        await result;
      }
    } catch (e) {
      if (alive.current)
        setFailure(e instanceof Error ? e.message : 'Could not complete this action. Try again.');
    } finally {
      if (alive.current) setPending(false);
    }
  }, [onConfirm, pending, requireTyped, typed]);

  if (!open) return null;

  const shownError = errorText ?? failure;
  const confirmBusyLabel = pendingLabel ?? `${confirmLabel}…`;

  const footer = (
    <>
      <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        variant={tone === 'danger' ? 'danger' : 'primary'}
        size="sm"
        onClick={() => {
          void handleConfirm();
        }}
        loading={pending}
        disabled={!typedOk}
        {...(typedOk ? {} : { title: `Type ${requireTyped ?? ''} to enable this button` })}
      >
        {pending ? confirmBusyLabel : confirmLabel}
      </Button>
    </>
  );

  return (
    <Modal
      open
      inline={inline}
      elevated={elevated}
      role="alertdialog"
      title={title}
      maxWidth={CONFIRM_MAX_WIDTH}
      showClose={false}
      closeOnOverlayClick={!pending}
      closeOnEscape={!pending}
      footer={footer}
      {...(onCancel ? { onClose: onCancel } : {})}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}
    >
      {message ? (
        <p style={{ margin: 0, color: 'var(--text2)', fontSize: 'var(--fs-sm)' }}>{message}</p>
      ) : null}

      {warnings && warnings.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: 'var(--sp-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-1)',
            fontSize: 'var(--fs-sm)',
            color: tone === 'danger' ? 'var(--red2)' : 'var(--text2)',
          }}
        >
          {warnings.map((w, i) => (
            // Warning lines are fixed copy written by the calling screen, not
            // user data — their order is their only identity.
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      {requireTyped !== undefined ? (
        <div className="form-grp">
          <label className="form-label" htmlFor={typedId}>
            {requireTypedLabel ?? `Type ${requireTyped} to confirm`}
            {/* Confirm stays disabled until this box matches, so the box is a
                required field and carries the app's required marker
                (design-ref/README.md:49 — "Required marker is ★ everywhere"). */}
            <span className="req">★</span>
          </label>
          <input
            id={typedId}
            className="innovic-input"
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typedOk) {
                e.preventDefault();
                void handleConfirm();
              }
            }}
          />
          {!typedOk ? (
            <div className="form-help">
              The button below turns on once this box says exactly {requireTyped}.
            </div>
          ) : null}
        </div>
      ) : null}

      {shownError ? (
        <Banner tone="error" flush>
          {shownError}
        </Banner>
      ) : null}
    </Modal>
  );
}
