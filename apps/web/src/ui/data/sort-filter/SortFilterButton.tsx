// Sort & Filter (ADR-200) — the button before the search box. Off by
// default; on shows the ▾ in every column header. While filters are applied
// it reads "Sort & Filter (2)" and is highlighted. Turning it off with filters
// applied asks: keep them, or clear them.

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { useSfSnapshot, useSfStore } from './scope';
import './sort-filter.css';

export const PARTIAL_NOTE =
  'This list shows one page at a time — Sort & Filter here needs the server and is coming next. Use the search and filters for now.';

export function SortFilterButton({ inTable = false }: { inTable?: boolean }): ReactElement | null {
  const store = useSfStore();
  const snap = useSfSnapshot(store);
  const id = useId();
  const [asking, setAsking] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  // A header button tells the tables not to draw their own.
  useEffect(() => {
    if (!store || inTable) return;
    store.setHeaderButton(id, true);
    return () => store.setHeaderButton(id, false);
  }, [store, id, inTable]);

  useEffect(() => {
    if (!asking) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setAsking(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAsking(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [asking]);

  if (!store || snap.tables.length === 0) return null;
  const n = snap.activeTotal;
  const off = snap.partial;

  const click = (): void => {
    if (off) return;
    if (snap.enabled && n > 0) {
      setAsking((a) => !a);
      return;
    }
    store.setEnabled(!snap.enabled);
  };

  return (
    <span ref={rootRef} className="sf-btn-anchor">
      <button
        type="button"
        className={['btn', 'btn-ghost', 'sf-btn', (snap.enabled || n > 0) && !off && 'is-on']
          .filter(Boolean)
          .join(' ')}
        aria-pressed={snap.enabled}
        aria-disabled={off || undefined}
        title={
          off
            ? PARTIAL_NOTE
            : snap.enabled
              ? 'Hide the ▾ in the column headers'
              : 'Sort or filter any column — shows a ▾ in every column header'
        }
        onClick={click}
      >
        <span aria-hidden="true" className="sf-funnel">
          ⏷
        </span>{' '}
        Sort &amp; Filter{n > 0 && !off ? ` (${n})` : ''}
      </button>
      {asking ? (
        <span className="sf-ask" role="dialog" aria-label="Hide Sort & Filter">
          <span className="sf-ask-text">
            {n} filter{n === 1 ? '' : 's'} applied.
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              store.setEnabled(false);
              setAsking(false);
            }}
          >
            Keep filters
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              store.clearAll();
              store.setEnabled(false);
              setAsking(false);
            }}
          >
            Clear filters
          </button>
        </span>
      ) : null}
    </span>
  );
}
