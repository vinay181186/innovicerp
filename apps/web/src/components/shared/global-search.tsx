// Global Search — the header search box rendered on every page (topbar.tsx).
//
// Type two or more characters and a results panel drops under the input with
// Date | Particulars | Type | Doc No. across every document kind the caller
// may view (the API filters by permission; see @innovic/shared
// schemas/global-search.ts). Clicking a row opens the document's existing
// detail page. Ctrl+K / Cmd+K focuses the box from anywhere.
//
// The panel is portaled to <body> and positioned by hand from the input's
// viewport rect — the same mechanism SearchableSelect uses, so no ancestor
// with `overflow: hidden` can clip it and it sits above every modal
// (zIndex 1000, see the note in searchable-select.tsx).

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import {
  GLOBAL_SEARCH_KIND_META,
  GLOBAL_SEARCH_MAX_CHARS,
  GLOBAL_SEARCH_MIN_CHARS,
} from '@innovic/shared';
import type { GlobalSearchResult } from '@innovic/shared';
import { GLOBAL_SEARCH_ROUTES, useGlobalSearch } from '@/lib/global-search';
import { useDebounce } from '@/lib/use-debounce';

interface PanelRect {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const PANEL_MIN_WIDTH = 720;
const EDGE = 8;
const GAP = 4;

export function GlobalSearch(): React.JSX.Element {
  const navigate = useNavigate();
  const baseId = useId();
  const listboxId = `${baseId}-list`;

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<PanelRect | null>(null);

  const term = value.trim();
  const debounced = useDebounce(term, 300);
  const hasQuery = term.length >= GLOBAL_SEARCH_MIN_CHARS;
  const showPanel = open && hasQuery;

  const query = useGlobalSearch(debounced);

  // Never list a kind we cannot open — a newer API could add one before the
  // web learns its route. The Record covers every kind today, so this is a
  // guard rather than a filter.
  const items = useMemo<GlobalSearchResult[]>(
    () => (query.data?.items ?? []).filter((r) => r.kind in GLOBAL_SEARCH_ROUTES),
    [query.data],
  );
  const truncated = query.data?.truncated === true;
  // keepPreviousData keeps the LAST term's rows in `query.data` while the new
  // fetch runs. Those rows must never show (or be opened) under the new term,
  // so treat "still debouncing", "no data yet" and "placeholder data" alike as
  // searching.
  const searching = !query.data || query.isPlaceholderData || debounced !== term;

  // Reset the highlight whenever the result set changes.
  useEffect(() => {
    setHighlight(0);
  }, [debounced, query.data]);

  // Ctrl+K / Cmd+K anywhere focuses the box.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close on outside mousedown — CAPTURE phase so a container that stops
  // propagation (modals) cannot leave the panel stuck open. The panel lives
  // in a portal, so it must be checked separately from the input.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      const t = e.target as Node;
      if (inputRef.current?.parentElement?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, []);

  // Track the input's viewport position while the panel is open. Listeners
  // are capture-phase so a scroll inside any nested scroller repositions it.
  useEffect(() => {
    if (!showPanel) {
      setRect(null);
      return;
    }
    const measure = (): void => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const viewport = window.innerWidth - EDGE * 2;
      const width = Math.min(Math.max(r.width, PANEL_MIN_WIDTH), viewport);
      // Keep the panel inside the viewport even when the input sits near the
      // right edge (it does — the topbar's title takes the slack).
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - EDGE - width));
      const top = r.bottom + GAP;
      const maxHeight = Math.max(
        120,
        Math.min(window.innerHeight * 0.6, window.innerHeight - top - EDGE),
      );
      setRect({ left, top, width, maxHeight });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [showPanel]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!showPanel) return;
    const el = document.getElementById(`${baseId}-opt-${highlight}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, showPanel, baseId]);

  function close(): void {
    setOpen(false);
    inputRef.current?.blur();
  }

  function pick(r: GlobalSearchResult): void {
    const to = GLOBAL_SEARCH_ROUTES[r.kind];
    if (!to) return;
    setValue('');
    close();
    void navigate({ to, params: { id: r.id } });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (!hasQuery) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (items.length) setHighlight((h) => Math.min(h + 1, items.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      const r = items[highlight];
      if (showPanel && !searching && r) {
        e.preventDefault();
        pick(r);
      }
    }
  }

  // ── Panel body ───────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <tr>
        <td colSpan={4} style={{ color: 'var(--red)', whiteSpace: 'normal' }}>
          {query.error.message}
        </td>
      </tr>
    );
  } else if (searching) {
    body = (
      <tr>
        <td colSpan={4} className="text3">
          Searching…
        </td>
      </tr>
    );
  } else if (items.length === 0) {
    body = (
      <tr>
        <td colSpan={4} className="text3" style={{ whiteSpace: 'normal' }}>
          No documents match &ldquo;{debounced}&rdquo;
        </td>
      </tr>
    );
  } else {
    body = (
      <>
        {items.map((r, i) => (
          <tr
            key={`${r.kind}:${r.id}`}
            id={`${baseId}-opt-${i}`}
            role="option"
            aria-selected={i === highlight}
            className={i === highlight ? 'gs-active' : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => setHighlight(i)}
            onClick={() => pick(r)}
          >
            <td className="mono">{r.date ?? '—'}</td>
            <td className="gs-particulars">
              {/* Flex row so the text truncates and the status badge stays
                  visible — as the last inline in an ellipsized cell it would
                  vanish behind any long name. */}
              <div className="gs-particulars-row">
                <span className="gs-particulars-text" title={r.particulars}>
                  {r.particulars}
                </span>
                {r.status ? (
                  <span className="badge b-grey">{r.status.replaceAll('_', ' ')}</span>
                ) : null}
              </div>
            </td>
            <td className="text3" style={{ fontSize: 12 }}>
              {GLOBAL_SEARCH_KIND_META[r.kind].label}
            </td>
            <td className="gs-docno">
              <span className="mono fw-700" style={{ color: 'var(--text)' }} title={r.docNo}>
                {r.docNo}
              </span>
            </td>
          </tr>
        ))}
        {truncated ? (
          <tr>
            <td colSpan={4} className="text3" style={{ fontSize: 12 }}>
              Showing the first {items.length} — type more to narrow down.
            </td>
          </tr>
        ) : null}
      </>
    );
  }

  return (
    <div className="gs-wrap">
      <Search size={14} className="gs-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="innovic-input gs-input"
        placeholder="Search anything… (Ctrl+K)"
        autoComplete="off"
        spellCheck={false}
        maxLength={GLOBAL_SEARCH_MAX_CHARS}
        value={value}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && items.length ? `${baseId}-opt-${highlight}` : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showPanel && rect
        ? createPortal(
            <div
              ref={panelRef}
              className="gs-panel"
              style={{
                position: 'fixed',
                left: rect.left,
                top: rect.top,
                width: rect.width,
                maxHeight: rect.maxHeight,
                zIndex: 1000,
              }}
            >
              <table className="innovic-table" id={listboxId} role="listbox">
                {/* Column widths live in the .gs-col-* rules (fixed layout on
                    desktop, natural widths on phones). Particulars takes the
                    remainder and truncates; Doc No. never wraps — 200px holds a
                    16-char mono code like IN-JWPO-00019/R1 and only an abnormal
                    free-form master code gets an ellipsis (full text on hover). */}
                <colgroup>
                  <col className="gs-col-date" />
                  <col className="gs-col-particulars" />
                  <col className="gs-col-type" />
                  <col className="gs-col-docno" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Particulars</th>
                    <th>Type</th>
                    <th>Doc No.</th>
                  </tr>
                </thead>
                <tbody>{body}</tbody>
              </table>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
