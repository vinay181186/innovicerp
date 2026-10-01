// The fit engine's strip above the table (ADR-199): what moved into ▸, the
// pins-too-wide warning, the save-failed note, Comfortable | Compact, and the
// Columns ▾ popover. Right-aligned and compact.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { TableDensity } from '@innovic/shared';

import { Z_OVERLAY } from '../feedback/Modal';
import { ToastStack } from '../feedback/Toast';
import { ColumnPicker, type PickerColumn } from './ColumnPicker';
import type { LayoutState } from './fit-layout';

export interface TableToolbarProps {
  columns: PickerColumn[];
  layout: LayoutState;
  firstId: string;
  dropped: string[];
  warn: boolean;
  canPin: (id: string) => boolean;
  onChange: (next: LayoutState) => void;
  onReset: () => void;
  density: TableDensity;
  onDensity: (d: TableDensity) => void;
  saveFailed: boolean;
  onRetrySave: () => void;
  /** The saved layout could not be read — nothing is saved until it is. */
  loadFailed: boolean;
  onRetryLoad: () => void;
}

const TOAST_MS = 2200;
const POP_W = 340;
const GAP = 4;
const EDGE = 8;

/**
 * Where the popover goes: under the button (right edges aligned), or above
 * it when there is more room there; never past the viewport, scrolling
 * inside when the list is taller than the room. Fixed + portalled, so no
 * `overflow: hidden` panel around the table can clip it.
 */
function placePopover(btn: HTMLElement, natural: number): CSSProperties {
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const below = vh - r.bottom - GAP - EDGE;
  const above = r.top - GAP - EDGE;
  const left = Math.max(EDGE, Math.min(r.right - POP_W, vw - POP_W - EDGE));
  const base: CSSProperties = { position: 'fixed', left, width: POP_W, zIndex: Z_OVERLAY };
  if (natural <= below || below >= above) {
    return { ...base, top: r.bottom + GAP, maxHeight: Math.max(120, below) };
  }
  return { ...base, bottom: vh - r.top + GAP, maxHeight: Math.max(120, above) };
}

export function TableToolbar(props: TableToolbarProps): ReactElement {
  const { columns, dropped, warn, density, onDensity, saveFailed, onRetrySave } = props;
  const { loadFailed, onRetryLoad } = props;
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popStyle, setPopStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const place = useCallback(() => {
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    setPopStyle(placePopover(btn, pop.scrollHeight));
  }, []);
  // Placed before paint, and again when the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) {
      setPopStyle({ visibility: 'hidden' });
      return;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  // Outside click closes the popover.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      // The popover is portalled out of the toolbar, so check both.
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Esc closes from anywhere — focus may sit on a row the popover just
    // re-drew (a ticked column moves between groups).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (toast === null) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };
  const labelOf = (id: string) => columns.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="dt-toolbar" ref={rootRef}>
      {dropped.length > 0 ? (
        <span className="dt-chip" role="status">
          {dropped.length} column{dropped.length > 1 ? 's' : ''} moved to ▸ to fit:{' '}
          <b>{dropped.map(labelOf).join(', ')}</b> ·{' '}
          <button
            type="button"
            className="dt-link"
            onClick={() => {
              setFlash(dropped);
              setOpen(true);
            }}
          >
            Show them
          </button>
        </span>
      ) : null}
      {warn ? (
        <span className="dt-chip dt-chip-warn" role="alert">
          Your pinned columns are wider than this screen — the rightmost pin moved to ▸. Unpin one.
        </span>
      ) : null}
      {loadFailed ? (
        <span className="dt-chip dt-chip-warn" role="status">
          Couldn&apos;t load your saved columns — changes won&apos;t be saved ·{' '}
          <button type="button" className="dt-link" onClick={onRetryLoad}>
            Retry
          </button>
        </span>
      ) : null}
      {saveFailed ? (
        <span className="dt-chip dt-chip-warn">
          Not saved —{' '}
          <button type="button" className="dt-link" onClick={onRetrySave}>
            retry
          </button>
        </span>
      ) : null}
      <div className="dt-seg" role="group" aria-label="Row density">
        {(['comfortable', 'compact'] as const).map((d) => (
          <button
            key={d}
            type="button"
            className={density === d ? 'is-on' : undefined}
            aria-pressed={density === d}
            onClick={() => onDensity(d)}
          >
            {d === 'comfortable' ? 'Comfortable' : 'Compact'}
          </button>
        ))}
      </div>
      <div className="dt-pick-anchor">
        <button
          ref={btnRef}
          type="button"
          className="btn btn-ghost btn-sm dt-cols-btn"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setFlash([]);
            setOpen((o) => !o);
          }}
        >
          Columns ▾
        </button>
        {open && typeof document !== 'undefined'
          ? createPortal(
              <ColumnPicker
                popRef={popRef}
                style={popStyle}
                columns={columns}
                layout={props.layout}
                firstId={props.firstId}
                dropped={dropped}
                flash={flash}
                canPin={props.canPin}
                onChange={props.onChange}
                onReset={props.onReset}
                onToast={setToast}
                onClose={close}
              />,
              document.body,
            )
          : null}
      </div>
      {toast !== null && typeof document !== 'undefined'
        ? createPortal(
            <ToastStack
              toasts={[{ id: 'dt-toast', kind: 'info', message: toast, durationMs: TOAST_MS }]}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
