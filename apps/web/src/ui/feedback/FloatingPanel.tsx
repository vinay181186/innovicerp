// FloatingPanel — a card that floats over the bottom-right corner of the page and
// leaves the page usable behind it (no dim overlay, no scroll lock, no focus trap).
// First user: the Ask ERP chat (ADR-293).
//
// It shares the pop-up chrome (.modal-hdr / .modal-title / .modal-body bands) and the
// ONE closing rule (use-close-rule.tsx): Esc, a click outside and the × all ask
// "Are you sure you want to exit?" only while `confirmExit` is true — the caller passes
// "something is typed or attached" — and close at once otherwise.
//
// Esc is answered only while focus is inside the panel, and never while a Modal, an
// open picker or a menu owns the key. A click outside ignores clicks inside any other
// pop-up (a Modal opened over the page, a picker list portaled to <body>).
//
// Z-index: the overlay layer (Z_OVERLAY) — above the page, the top bar and drawers;
// a Modal opened later portals after it and so stacks above; toasts stay on top.
//
// Placement: by default the bottom-right corner. With `top` (owner 2026-11-16, Ask ERP
// opened from the top bar) it runs from `top` down to ABOVE_SAVE_BAR px off the
// bottom, so a form's sticky Save bar and a list's pager stay clickable under it.
// A `toggleRef` button (the opener that also closes it) is not "a click outside",
// and `closeRef` hands that button the panel's own close — with its exit question.

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { escapeBelongsToAnOpenMenu, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';
import { Z_OVERLAY, Z_OVERLAY_ABOVE_MODAL } from './Modal';
import { useCloseRule } from './use-close-rule';

export interface FloatingPanelProps {
  /** Defaults to true so `{show && <FloatingPanel …/>}` also reads correctly. */
  open?: boolean | undefined;
  title: React.ReactNode;
  /** One muted line under the title. */
  subtitle?: React.ReactNode | undefined;
  /** Absent = no ×, no Esc, no click-outside. */
  onClose?: () => void | undefined;
  /** The ×'s tooltip and accessible name. */
  closeLabel?: string | undefined;
  /** Controls in the header band, left of the × (a picker, a button). */
  headerActions?: React.ReactNode | undefined;
  /** A band directly under the header that does not scroll (a help line). */
  subheader?: React.ReactNode | undefined;
  /** The band pinned at the bottom (a composer, buttons). */
  footer?: React.ReactNode | undefined;
  /** Ask before closing. Pass "something is typed or attached right now". */
  confirmExit?: boolean | undefined;
  /** Work is running: nothing closes and nothing asks. */
  closeLocked?: boolean | undefined;
  /** Render in place, not fixed / portaled — for the design preview. */
  inline?: boolean | undefined;
  /** Accessible name when the title is not plain text. */
  ariaLabel?: string | undefined;
  /** The scroll area, for a caller that keeps it scrolled to the newest line. */
  bodyRef?: React.RefObject<HTMLDivElement> | undefined;
  /** Distance from the viewport top in px: the panel runs from here down to
   *  ABOVE_SAVE_BAR off the bottom. Absent = the bottom-right corner. */
  top?: number | undefined;
  /** The opener button that toggles the panel: a press on it is not "outside". */
  toggleRef?: React.RefObject<HTMLElement> | undefined;
  /** Set to the panel's close request (Esc / × rule) while it is open. */
  closeRef?: React.MutableRefObject<(() => void) | null> | undefined;
  children?: React.ReactNode;
}

/** Bottom clearance of a `top`-placed panel: a FormActions bar (28px buttons +
 *  8px padding + borders) plus the page's 16px gutter, with room to spare. */
export const ABOVE_SAVE_BAR = 64;
/** A `top`-placed panel hangs under the top bar, so it stacks UNDER the top bar's
 *  own drop-downs (#topnav 60, .tn-menu 70, the bell's pop-up) and above page
 *  chrome (sticky bands 20, the Actions ▾ menu 50). Modals and portaled pickers
 *  (Z_OVERLAY) still open above it. */
const Z_UNDER_TOPBAR = 55;
/** A short window or a tall header still leaves room to read and type. */
const MIN_PANEL_HEIGHT = 320;

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  right: 'var(--sp-4)',
  bottom: 'var(--sp-4)',
  zIndex: Z_OVERLAY,
  width: 460,
  maxWidth: 'calc(100% - 2 * var(--sp-4))',
  height: 660,
  maxHeight: 'calc(100% - 100px)',
};

const CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface-card)',
  border: '1px solid var(--border2)',
  borderRadius: 'var(--radius2)',
  boxShadow: 'var(--shadow-modal)',
  overflow: 'hidden',
};

export function FloatingPanel({
  open = true,
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  headerActions,
  subheader,
  footer,
  confirmExit = false,
  closeLocked = false,
  inline = false,
  ariaLabel,
  bodyRef,
  top,
  toggleRef,
  closeRef,
  children,
}: FloatingPanelProps): React.JSX.Element | null {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const active = open && !inline;

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const rule = useCloseRule({
    active,
    confirmExit,
    closeLocked,
    questionZIndex: Z_OVERLAY_ABOVE_MODAL,
    cardRef,
    footerRef,
    onCloseRef,
  });
  const { requestClose, escapeAnswersQuestion } = rule;

  // Focus moves into the panel's first field on open and back to the opener on close.
  useEffect(() => {
    if (!active) return;
    openerRef.current = document.activeElement;
    const card = cardRef.current;
    const first = card?.querySelector<HTMLElement>(
      'textarea:not([disabled]), input:not([disabled])',
    );
    (first ?? card)?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [active]);

  const armed = active && onClose !== undefined;

  // Esc — only while focus is inside this panel, and only when nothing else owns it.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const root = rootRef.current;
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      if (escapeBelongsToAnOpenMenu()) return;
      e.preventDefault();
      if (!escapeAnswersQuestion()) requestClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [armed, requestClose, escapeAnswersQuestion]);

  // A click outside — not inside another pop-up or a portaled picker list.
  useEffect(() => {
    if (!armed) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (rootRef.current?.contains(t)) return;
      if (toggleRef?.current?.contains(t)) return;
      if (
        t.closest(
          '.overlay, [role="dialog"], [role="alertdialog"], [role="listbox"], [role="option"], [role="menu"]',
        )
      )
        return;
      requestClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [armed, requestClose, toggleRef]);

  // The opener's own close goes through the same rule (asks when something is typed).
  useEffect(() => {
    if (!closeRef) return;
    closeRef.current = armed ? requestClose : null;
    return () => {
      closeRef.current = null;
    };
  }, [closeRef, armed, requestClose]);

  if (!open) return null;

  const card = (
    <div
      ref={cardRef}
      role="region"
      aria-labelledby={ariaLabel ? undefined : titleId}
      aria-label={ariaLabel}
      tabIndex={-1}
      style={
        inline ? { ...CARD_STYLE, width: 460, height: 560 } : { ...CARD_STYLE, height: '100%' }
      }
      {...rule.cardHandlers}
    >
      <div className="modal-hdr" style={{ flex: '0 0 auto', gap: 'var(--sp-2)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="modal-title" id={titleId}>
            {title}
          </div>
          {subtitle ? (
            <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
              {subtitle}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexShrink: 0 }}>
          {headerActions}
          {onClose ? (
            <IconButton
              size="sm"
              title={closeLabel}
              aria-label={closeLabel}
              icon={<Icon name="x" size={14} />}
              onClick={requestClose}
            />
          ) : null}
        </div>
      </div>
      {subheader ? <div style={{ flex: '0 0 auto' }}>{subheader}</div> : null}
      <div
        ref={bodyRef}
        className="modal-body"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}
      >
        {children}
      </div>
      {footer ? (
        <div
          ref={footerRef}
          style={{
            flex: '0 0 auto',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg3)',
            padding: 'var(--sp-2) var(--sp-3)',
          }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );

  if (inline) return card;

  const placed: React.CSSProperties =
    top === undefined
      ? PANEL_STYLE
      : {
          ...PANEL_STYLE,
          top,
          bottom: ABOVE_SAVE_BAR,
          height: 'auto',
          maxHeight: 'none',
          minHeight: MIN_PANEL_HEIGHT,
          zIndex: Z_UNDER_TOPBAR,
        };

  return createPortal(
    <div ref={rootRef} style={placed}>
      {card}
      {rule.question}
    </div>,
    document.body,
  );
}
