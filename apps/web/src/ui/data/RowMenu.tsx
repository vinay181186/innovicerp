// RowMenu — the ONE ⋯ row-action control, last column of every table
// (owner-approved spec 2026-10-01, mock-up A).
//
//   <RowMenu items={[
//     { key: 'edit', label: 'Edit', icon: 'pencil', to: `/items/${id}/edit` },
//     { key: 'start', label: 'Start Operation', icon: 'play', group: 'workflow',
//       onSelect: () => start.mutateAsync(id), disabledReason: running ? 'Already running' : undefined },
//     { key: 'del', label: 'Move to Trash', icon: 'trash-2', group: 'danger', onSelect: askDelete },
//   ]} renderLink={(p) => <Link {...p} />} />
//
// NOT the header "Actions ▾" drop-down — that is ui/layout/ActionMenu.tsx,
// whose item shape (onClick / danger) is different; the names differ on
// purpose so the two cannot be mixed up in one import.
//
// Behaviour:
//   - mouse hover opens after 150 ms and closes again when the pointer leaves
//     button and menu; a click / tap opens at once and keeps it open;
//   - Esc, Tab or a click outside closes; ↑ ↓ Home End move, Enter runs;
//   - only one row menu is open at a time, app-wide;
//   - the menu is portalled to <body> (position fixed, z Z_OVERLAY), so no
//     `overflow: hidden` cell or panel can clip it; it flips up near the
//     bottom of the screen and follows scroll / resize;
//   - clicks inside it never reach the row underneath;
//   - an onSelect that returns a Promise makes the ⋯ busy: nothing else in
//     this row's menu can run until it settles (no double submit).

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '../core/Icon';
import { Z_OVERLAY } from '../feedback/Modal';
import { LinkSlot, type RenderLink } from '../layout/link-slot';
import {
  arrangeRowMenu,
  isThenable,
  nextMenuIndex,
  placeRowMenu,
  type RowMenuItem,
} from './row-menu-logic';
import '../core/core.css';
import './RowMenu.css';

export type { RowMenuGroup, RowMenuItem } from './row-menu-logic';

export interface RowMenuProps {
  items: RowMenuItem[];
  /** How an item's `to` becomes an SPA link: `(p) => <Link {...p} />`.
   *  Without it a `to` item is a plain `<a href>`. */
  renderLink?: RenderLink | undefined;
  /** Accessible name of the ⋯ button. Default "Actions". */
  label?: string | undefined;
}

type OpenMode = 'hover' | 'click' | 'key';

const HOVER_OPEN_MS = 150;
const HOVER_CLOSE_MS = 200;

// One row menu open at a time, app-wide: opening one closes the last.
let closeOpenMenu: (() => void) | null = null;

export function RowMenu({
  items,
  renderLink,
  label = 'Actions',
}: RowMenuProps): ReactElement | null {
  const [mode, setMode] = useState<OpenMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const menuId = useId();

  const entries = arrangeRowMenu(items);
  const open = mode !== null;

  const clearTimer = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  const close = useCallback((refocus = false) => {
    window.clearTimeout(timer.current);
    setMode(null);
    if (refocus) btnRef.current?.focus();
  }, []);

  // A stable handle on this menu's close, for the one-open-menu rule.
  const closeSelf = useRef<() => void>(() => close());

  const show = (m: OpenMode) => {
    if (busy) return;
    if (closeOpenMenu && closeOpenMenu !== closeSelf.current) closeOpenMenu();
    closeOpenMenu = closeSelf.current;
    setMode(m);
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
      if (closeOpenMenu === closeSelf.current) closeOpenMenu = null;
    };
  }, []);

  const itemEls = (): HTMLElement[] =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('.row-menu-item') ?? []);

  // Place before paint, and again on scroll / resize. Focus the first item
  // when opened by click or keyboard (never on hover — that would steal it).
  const place = useCallback(() => {
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    if (!btn.isConnected) {
      close();
      return;
    }
    const p = placeRowMenu(
      btn.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ left: p.left, top: p.top, maxHeight: p.maxHeight });
  }, [close]);

  useLayoutEffect(() => {
    if (!open) {
      setPos({ visibility: 'hidden' });
      return undefined;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (mode !== 'click' && mode !== 'key') return;
    menuRef.current?.querySelector<HTMLElement>('.row-menu-item')?.focus();
  }, [mode]);

  useEffect(() => {
    if (!open) return undefined;
    const focusInside = () => menuRef.current?.contains(document.activeElement) ?? false;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close(focusInside());
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close(focusInside() || document.activeElement === btnRef.current);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (entries.length === 0) return null;

  const run = (item: RowMenuItem) => {
    if (busy || item.disabledReason) return;
    // The row may have gone (list refreshed under an open menu): do nothing.
    if (!btnRef.current?.isConnected) {
      close();
      return;
    }
    close(true);
    const result = item.onSelect?.();
    if (isThenable(result)) {
      setBusy(true);
      const done = () => {
        if (alive.current) setBusy(false);
      };
      result.then(done, done);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab' || e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    const els = itemEls();
    const next = nextMenuIndex(
      els.findIndex((el) => el === document.activeElement),
      e.key,
      els.length,
    );
    if (next === null) return;
    e.preventDefault();
    els[next]?.focus();
  };

  const hoverLeave = () => {
    clearTimer();
    if (mode === 'hover') timer.current = window.setTimeout(() => close(), HOVER_CLOSE_MS);
  };

  const face = (item: RowMenuItem): ReactNode => (
    <>
      <span className="row-menu-ic" aria-hidden="true">
        {item.icon ? <Icon name={item.icon} size={14} /> : null}
      </span>
      <span className="row-menu-label">{item.label}</span>
      {item.disabledReason ? <span className="row-menu-why">{item.disabledReason}</span> : null}
    </>
  );

  const renderItem = (item: RowMenuItem): ReactNode => {
    const cls = [
      'row-menu-item',
      item.group === 'danger' && 'is-danger',
      item.disabledReason && 'is-disabled',
    ]
      .filter(Boolean)
      .join(' ');
    if (item.to !== undefined && !item.disabledReason) {
      // A real link: Ctrl-click / middle-click open a new tab. The menu
      // just closes alongside the navigation.
      return renderLink ? (
        <LinkSlot
          key={item.key}
          to={item.to}
          renderLink={renderLink}
          className={cls}
          onClick={() => close()}
        >
          {face(item)}
        </LinkSlot>
      ) : (
        <a key={item.key} href={item.to} role="menuitem" className={cls} onClick={() => close()}>
          {face(item)}
        </a>
      );
    }
    return (
      <button
        key={item.key}
        type="button"
        role="menuitem"
        className={cls}
        aria-disabled={item.disabledReason ? true : undefined}
        title={item.disabledReason}
        onClick={() => run(item)}
      >
        {face(item)}
      </button>
    );
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`row-menu-btn${open ? ' is-open' : ''}`}
        aria-label={label}
        title={busy ? 'Working…' : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy || undefined}
        onClick={(e) => {
          e.stopPropagation();
          clearTimer();
          if (busy) return;
          // detail 0 = Enter / Space, not a pointer.
          if (mode === 'hover') setMode('click');
          else if (open) close(true);
          else show(e.detail === 0 ? 'key' : 'click');
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            show('key');
          }
        }}
        onPointerEnter={(e) => {
          // Mouse only: a touch tap goes straight to onClick.
          if (e.pointerType !== 'mouse') return;
          clearTimer();
          if (open || busy) return;
          timer.current = window.setTimeout(() => show('hover'), HOVER_OPEN_MS);
        }}
        onPointerLeave={hoverLeave}
      >
        {busy ? <Icon name="loader-2" size={12} className="spin" /> : '⋯'}
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label={label}
              className="row-menu"
              style={{ position: 'fixed', zIndex: Z_OVERLAY, ...pos }}
              // The menu sits inside the row in the React tree: keep its
              // clicks away from the row's onClick.
              onClick={(e) => e.stopPropagation()}
              onKeyDown={onMenuKey}
              onPointerEnter={clearTimer}
              onPointerLeave={hoverLeave}
            >
              {entries.map((en) =>
                en.type === 'sep' ? (
                  <div key={en.key} className="row-menu-sep" role="separator" />
                ) : en.type === 'head' ? (
                  <div key={en.key} className="row-menu-head" role="presentation">
                    {en.label}
                  </div>
                ) : (
                  renderItem(en.item)
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
