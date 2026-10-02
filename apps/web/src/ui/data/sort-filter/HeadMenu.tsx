// Sort & Filter (ADR-200) — the ▾ inside a column header and its popover.
// The popover is portalled and fixed (like the Columns picker), so no panel's
// overflow can clip it; it flips above the header when there is more room.
// The marks beside the header text stay visible even when the ▾ is hidden:
// ↑/↓ for the sorted column, ⏷ for a filtered one — a kept filter is never
// invisible.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Z_OVERLAY } from '../../feedback/Modal';
import type { ColumnFilter, SortDir } from './filter-model';
import { MenuBody } from './MenuBody';
import type { MenuSpec } from './use-sort-filter-table';

const POP_W = 290;
const GAP = 4;
const EDGE = 8;

function place(btn: HTMLElement, natural: number): CSSProperties {
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const left = Math.max(EDGE, Math.min(r.left - 8, vw - POP_W - EDGE));
  const base: CSSProperties = { position: 'fixed', left, width: POP_W, zIndex: Z_OVERLAY };
  if (natural <= below || below >= above) {
    return { ...base, top: r.bottom + GAP, maxHeight: Math.max(160, below) };
  }
  return { ...base, bottom: vh - r.top + GAP, maxHeight: Math.max(160, above) };
}

export interface HeadMenuProps {
  header: ReactNode;
  label: string;
  /** Show the ▾ (Sort & Filter is on). */
  showButton: boolean;
  sortDir: SortDir | null;
  sortOff?: boolean | undefined;
  filter: ColumnFilter | undefined;
  /** The column's type and tick list — worked out when the menu opens. */
  getMenu: () => MenuSpec;
  onSort: (dir: SortDir | null) => void;
  onFilter: (f: ColumnFilter | null) => void;
}

export function HeadMenu(p: HeadMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<MenuSpec>({ type: 'text', values: [] });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (btn && pop) setStyle(place(btn, pop.scrollHeight));
  }, []);
  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' });
      return;
    }
    reposition();
    // First focusable control inside, so the keyboard lands in the menu.
    popRef.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Sort & Filter switched off while the menu is open → close it.
  useEffect(() => {
    if (!p.showButton) setOpen(false);
  }, [p.showButton]);

  const filtered = p.filter !== undefined;
  return (
    <span className="sf-head">
      <span className="sf-head-label">{p.header}</span>
      {p.sortDir ? (
        <span
          className="sf-mark"
          aria-label={p.sortDir === 'asc' ? 'sorted ascending' : 'sorted descending'}
        >
          {p.sortDir === 'asc' ? '↑' : '↓'}
        </span>
      ) : null}
      {filtered ? (
        <span className="sf-mark sf-mark-f" aria-label="filtered" title="Filtered">
          ⏷
        </span>
      ) : null}
      {p.showButton ? (
        <button
          ref={btnRef}
          type="button"
          className={filtered || p.sortDir ? 'sf-caret is-on' : 'sf-caret'}
          aria-label={`Sort or filter ${p.label}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (!open) setMenu(p.getMenu());
            setOpen((o) => !o);
          }}
        >
          ▾
        </button>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={popRef}
              className="sf-pop"
              role="dialog"
              aria-label={`Sort and filter ${p.label}`}
              style={style}
              // Events from a portal still bubble through the React tree —
              // into a sortable header's SortHeader (Enter / Space = sort).
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <MenuBody
                label={p.label}
                type={menu.type}
                sortDir={p.sortDir}
                sortOff={p.sortOff}
                filter={p.filter}
                values={menu.values}
                labelOf={menu.labelOf}
                noTicks={menu.noTicks}
                onSort={p.onSort}
                onFilter={p.onFilter}
                onClose={close}
              />
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
