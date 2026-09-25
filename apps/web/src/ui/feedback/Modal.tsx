// Modal — the ONE dialog shell for the whole app.
//
// Before this there was no shared Modal at all: 26 screens hand-rolled their
// own `className="overlay"` + `.modal` markup, and 50 of the 67 inline
// z-index literals in the app sat off the documented ladder, so two overlays
// opened together stacked by accident rather than by rule. Everything that
// floats above the page now builds on this file — ConfirmDialog, FilePreview
// and any screen's own popup.
//
// What it owns, so no screen has to own it again:
//   - a portal to document.body (a modal inside an `overflow:hidden` panel
//     gets clipped, which is how several of the hand-rolled ones behaved)
//   - the shared `.overlay` (navy 45% + 2px blur, z-index 500) and `.modal`
//     chrome — header band / body / footer band, 8px radius
//   - click-outside-to-close, on the OVERLAY only (a mousedown that starts
//     inside the card and ends on the backdrop is a text selection, not a
//     dismissal, so the check is `e.target === e.currentTarget`)
//   - Escape to close, answered by the TOP-most open modal only — and never
//     answered while a type-to-search dropdown is open inside it (below)
//   - a focus trap: focus moves into the card on open — into the first real
//     FIELD, never the header × — Tab cycles inside it, and the element that
//     opened the modal gets focus back on close
//   - a body scroll lock, reference-counted so closing an inner modal does
//     not unlock the page while an outer one is still open
//
// ESCAPE BELONGS TO AN OPEN PICKER FIRST. components/shared/searchable-select
// closes its dropdown on Escape with a bare `setOpen(false)` — no
// preventDefault, no stopPropagation — so a window-level listener cannot tell
// "close the dropdown" from "close the dialog" by the event alone. The app
// solved this once in lib/exit-guard.tsx and FIVE live modal screens already
// call that guard before closing; this shell, the one those five migrate onto
// in Phase 4, calls it too. Without it the first Escape aimed at a picker
// inside a form modal closes the whole modal and the form is lost.
//
// Z-INDEX LADDER — the whole app's, for reference. Never invent a new value:
//   table header/cell 4 / 5 / 6 · sidebar 10 · sticky list header 20 ·
//   topnav 60 · tn-menu 70 · drawer 200 · overlay 500 ·
//   a dialog raised ABOVE an overlay 600 · picker popover 1000 · toast 9999.

import { useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';

/** The overlay's own layer — the value `.overlay` carries in innovic-theme.css. */
export const Z_OVERLAY = 500;
/** A dialog raised above an already-open overlay (an exit guard over a modal
 *  form). The app's existing above-overlay value — see lib/exit-guard.tsx. */
export const Z_OVERLAY_ABOVE_MODAL = 600;
/** The toast stack — the top of the ladder. */
export const Z_TOAST = 9999;

/** sm = a question · md = the standard page-style dialog · lg = the wide
 *  variant (`.modal-lg`) used by file previews and line-item sheets. */
export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  /** Defaults to true so `{show && <Modal …/>}` also reads correctly. */
  open?: boolean;
  title: React.ReactNode;
  /** Absent = no close affordance, no Escape, no click-outside. */
  onClose?: () => void;
  /** Hide the header × while KEEPING Escape / click-outside on `onClose` —
   *  a question is answered by its footer buttons, not dismissed by an ×. */
  showClose?: boolean;
  /** The × button's tooltip and accessible name. "Close preview" on the file
   *  viewer, where a bare "Close" reads as closing the document itself. */
  closeLabel?: string;
  /** Right-aligned buttons in the footer band. Omitted = no footer band. */
  footer?: React.ReactNode;
  /** Extra controls in the header band, left of the × (Download, print …). */
  headerActions?: React.ReactNode;
  size?: ModalSize;
  /** Overrides the size's max-width. Used where the design reference pins one
   *  (ConfirmDialog's 420px question card). */
  maxWidth?: string;
  /** `alertdialog` for a question that must be answered before anything else. */
  role?: 'dialog' | 'alertdialog';
  /** Stack above another overlay that is already open (600, not 500). */
  elevated?: boolean;
  /** Turn off the backdrop click (a form mid-edit that must not be lost). */
  closeOnOverlayClick?: boolean;
  /** Turn off Escape (same reason — the screen asks its own question first). */
  closeOnEscape?: boolean;
  /** Render the card WITHOUT the overlay/portal, for the /__ui-kit page. */
  inline?: boolean;
  bodyClassName?: string;
  bodyStyle?: React.CSSProperties;
  children?: React.ReactNode;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

function firstFocusableIn(root: Element | null | undefined): HTMLElement | null {
  return root?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
}

// ── body scroll lock, reference-counted ──────────────────────────────────
// Two modals open at once must not fight over document.body.style.overflow:
// the inner one closing used to hand the page back its scrollbar while the
// outer one was still up.
let lockCount = 0;
let lockedFrom = '';

function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    lockedFrom = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount -= 1;
    if (lockCount === 0) document.body.style.overflow = lockedFrom;
  };
}

// ── Escape stack ─────────────────────────────────────────────────────────
// Only the top-most open modal answers Escape, so one keypress closes one
// dialog rather than the whole stack.
//
// The push/pop effect below is keyed on BOOLEANS only — never on `onClose`,
// whose identity changes on every render for the ordinary
// `onClose={() => setOpen(false)}` arrow. Keyed on the callback, any re-render
// of an OUTER modal popped it and pushed it back on top of the inner one, and
// the next Escape then closed the outer dialog and orphaned the inner one.
const escapeStack: string[] = [];

function maxWidthFor(size: ModalSize): string | undefined {
  if (size === 'sm') return 'min(560px, 96vw)';
  // md is `.modal`'s own max-width; lg comes from the `.modal-lg` class.
  return undefined;
}

export function Modal({
  open = true,
  title,
  onClose,
  showClose = true,
  closeLabel = 'Close',
  footer,
  headerActions,
  size = 'md',
  maxWidth,
  role = 'dialog',
  elevated = false,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  inline = false,
  bodyClassName,
  bodyStyle,
  children,
}: ModalProps): React.JSX.Element | null {
  const titleId = useId();
  const instanceId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  const active = open && !inline;

  // Kept in a ref so the Escape effect never depends on the callback's
  // identity — see the note on `escapeStack`.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Scroll lock + focus move/restore. One effect so the two always pair up.
  useEffect(() => {
    if (!active) return;
    const release = lockBodyScroll();
    openerRef.current = document.activeElement;
    const card = cardRef.current;
    // The first real FIELD, not the header ×. "New Purchase Request" opening
    // with Close focused means a stray Enter throws the form away; the app's
    // own dialog deliberately does the opposite (lib/exit-guard.tsx:197-201,
    // "Cancel takes focus, so a stray Enter keeps the form"). So: the body
    // first, then the footer's left-most button — which IS Cancel — and only
    // then the card itself, from which Tab still reaches the header ×.
    const first = firstFocusableIn(bodyRef.current) ?? firstFocusableIn(footerRef.current);
    (first ?? card)?.focus();
    return () => {
      release();
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [active]);

  // Escape, answered by the top-most modal only.
  const escapeArmed = active && closeOnEscape && onClose !== undefined;
  useEffect(() => {
    if (!escapeArmed) return;
    escapeStack.push(instanceId);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (escapeStack[escapeStack.length - 1] !== instanceId) return;
      // A type-to-search dropdown open inside this dialog owns the key. It
      // closes itself without stopping the event, so the check is on the
      // combobox's own aria-expanded — the shared guard, not a second copy.
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      e.preventDefault();
      onCloseRef.current?.();
    };
    // CAPTURE phase at document, on purpose — NOT a bubble listener on window.
    // searchable-select.tsx:298-299 closes its list on Escape with a bare
    // setOpen(false). That is a discrete update, so React flushes it at the end
    // of its own root dispatch, i.e. BEFORE the event would reach window. A
    // bubble listener therefore reads aria-expanded="false" and the guard above
    // falls through, closing the whole dialog on the Escape that was meant for
    // the dropdown — losing the form. Capture at document runs before React's
    // root listener, while the list is still open.
    // The two live modals this component replaces do exactly this:
    // incoming-qc-inspect-modal.tsx:66 and qc-call-inspect-modal.tsx:67.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      const at = escapeStack.lastIndexOf(instanceId);
      if (at >= 0) escapeStack.splice(at, 1);
    };
  }, [escapeArmed, instanceId]);

  // Focus trap. Tab off the last control wraps to the first, and vice versa.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const card = cardRef.current;
    if (!card) return;
    const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      card.focus();
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  // A question is a card, not a workspace: a pinned width also drops
  // `.modal`'s tall min-height and centres the card on the overlay.
  const pinned = size === 'sm' || maxWidth !== undefined;
  const cardStyle: React.CSSProperties = {};
  const cap = maxWidth ?? maxWidthFor(size);
  if (cap !== undefined) cardStyle.maxWidth = cap;
  if (pinned) cardStyle.minHeight = 0;

  const card = (
    <div
      ref={cardRef}
      className={size === 'lg' ? 'modal modal-lg' : 'modal'}
      role={role}
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      tabIndex={-1}
      style={cardStyle}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="modal-hdr">
        <div
          className="modal-title"
          id={titleId}
          style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {title}
        </div>
        {(headerActions ?? (onClose && showClose)) ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            {headerActions}
            {onClose && showClose ? (
              <IconButton
                size="sm"
                title={closeLabel}
                icon={<Icon name="x" size={14} />}
                onClick={onClose}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        className={bodyClassName ? `modal-body ${bodyClassName}` : 'modal-body'}
        {...(bodyStyle ? { style: bodyStyle } : {})}
      >
        {children}
      </div>
      {footer ? (
        <div ref={footerRef} className="modal-footer">
          {footer}
        </div>
      ) : null}
    </div>
  );

  if (inline) return card;

  const overlayStyle: React.CSSProperties = {};
  if (elevated) overlayStyle.zIndex = Z_OVERLAY_ABOVE_MODAL;
  // A workspace hangs from the top edge (`.overlay`'s own flex-start) so the
  // card keeps a stable position as its body grows; a question centres.
  if (pinned) {
    overlayStyle.alignItems = 'center';
    overlayStyle.justifyContent = 'center';
  }

  return createPortal(
    <div
      className="overlay"
      role="presentation"
      style={overlayStyle}
      onMouseDown={(e) => {
        if (!closeOnOverlayClick || !onClose) return;
        if (e.target === e.currentTarget) onClose();
      }}
      // A portal bubbles through the REACT tree, not the DOM one: a Modal
      // rendered inside the app's standard clickable row (`<tr onClick=…>`)
      // would otherwise navigate BEHIND the dialog on every click in it.
      onClick={(e) => e.stopPropagation()}
    >
      {card}
    </div>,
    document.body,
  );
}
