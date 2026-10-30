// HoverCard — a small read-only card shown while the pointer (or keyboard
// focus) is on a short value in a table cell, e.g. the JWSO Customer RM word
// and its quantity breakdown (OW-143).
//
// Why not CSS: `.innovic-table td` clips (overflow hidden) and the table sits in
// a scrolling `.tbl-wrap`, so an absolutely-positioned card inside the cell is
// cut off. Like RowMenu, the card is portalled to <body>, position fixed, and
// placed by the same `placeRowMenu` rule: below the trigger, flipped above when
// there is no room, kept on screen, re-placed on scroll / resize, and closed
// once the trigger scrolls out of view.
//
// Behaviour copies RowMenu's hover mode: opens 150 ms after the pointer
// arrives, stays while the pointer moves onto the card, closes 200 ms after it
// leaves; Esc closes it. Hover only, so it adds no Tab stop to every row (the
// plain `title` it replaced had none). One card open at a time. A click inside
// the card never reaches the row (that would open the document).
//
// Its portal code is a deliberate small copy of RowMenu's (same placement
// helper, same z layer, same Esc guard): folding both into one hook would mean
// changing RowMenu, which every list uses, for a read-only card.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeRowMenu } from './row-menu-logic';
import './RowMenu.css';
import './HoverCard.css';

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 200;
// "picker popover 1000" on the z-index ladder (ui/feedback/Modal.tsx), as RowMenu.
const Z_PICKER = 1000;

let closeOpenCard: (() => void) | null = null;

export interface HoverCardProps {
  /** The value shown in the cell — the hover / focus target. */
  children: ReactNode;
  /** The card body. */
  card: ReactNode;
  /** The card's heading, shown on top and used as its spoken name. */
  title: string;
}

export function HoverCard({ children, card, title }: HoverCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const trigRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const cardId = useId();

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
  }, []);
  const closeSelf = useRef<() => void>(() => close());

  const show = () => {
    window.clearTimeout(timer.current);
    if (closeOpenCard && closeOpenCard !== closeSelf.current) closeOpenCard();
    closeOpenCard = closeSelf.current;
    setOpen(true);
  };
  const showSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(show, HOVER_OPEN_MS);
  };
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(close, HOVER_CLOSE_MS);
  };

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (closeOpenCard === closeSelf.current) closeOpenCard = null;
    },
    [],
  );

  const place = useCallback(() => {
    const trig = trigRef.current;
    const box = cardRef.current;
    if (!trig || !box) return;
    if (!trig.isConnected) return close();
    const p = placeRowMenu(
      trig.getBoundingClientRect(),
      { width: box.offsetWidth, height: box.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (!p) return close();
    setPos({ left: p.left, top: p.top, maxHeight: p.maxHeight });
  }, [close]);

  useLayoutEffect(() => {
    if (!open) {
      // Same object back when already hidden, so a closed card never re-renders.
      setPos((p) => (p.visibility === 'hidden' ? p : { visibility: 'hidden' }));
      return undefined;
    }
    place();
    // Esc belongs to the open card. Window CAPTURE + preventDefault, as in
    // RowMenu, so a card inside a dialog closes without closing the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, place, close]);

  return (
    <>
      <span
        ref={trigRef}
        className="hover-card-trigger"
        aria-describedby={open ? cardId : undefined}
        onMouseEnter={showSoon}
        onMouseLeave={hideSoon}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              ref={cardRef}
              id={cardId}
              role="tooltip"
              aria-label={title}
              className="row-menu hover-card"
              style={{ position: 'fixed', zIndex: Z_PICKER, ...pos }}
              onMouseEnter={() => window.clearTimeout(timer.current)}
              onMouseLeave={hideSoon}
              // A portal still bubbles through the React tree: keep the row's onClick out.
              onClick={(e) => e.stopPropagation()}
            >
              <div className="hover-card-title">{title}</div>
              {card}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
