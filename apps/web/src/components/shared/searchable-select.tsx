// <SearchableSelect> — one reusable type-to-search dropdown for every "pick a
// master/document" field (SO, JWSO, Vendor, item, client, …). It is presentational:
// the caller owns the list hook and a `search` state string; this component renders
// the input + anchored dropdown, debounces typing into `onSearch` (which the caller
// feeds to the endpoint's ?search= param), and returns the picked row's id.
//
// Why a shared component: five+ forms had hand-rolled <input>/<datalist>/Picklist
// pickers that read as free-text, didn't scroll, and only matched a prefix. This
// centralises the UX so a fix lands everywhere. No new dependency — Input + Tailwind.
//
// Server-side search only: the caller's hook must page the API (limit ≤ 200); never
// load the whole table into the browser. The extra client-side substring filter here
// is only a refinement over whatever rows the server already returned for the term.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface SearchableOption {
  id: string;
  /** Short business code, e.g. IN-SO-00001. Rendered as "CODE — Name". */
  code?: string | null;
  /** Human label, e.g. the customer or vendor name. */
  name: string;
}

export interface SearchableSelectProps {
  /** The selected option id (the saved value), or null. */
  value: string | null;
  /** Called with the picked option id (never the label), or null when cleared. */
  onChange: (id: string | null) => void;
  /** Current page of options from the caller's list hook (already server-filtered). */
  options: SearchableOption[];
  /** Receives the debounced search term; wire it to the hook's ?search= param. */
  onSearch: (term: string) => void;
  /** True while the list hook is fetching. */
  loading?: boolean | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** Optional display label for a pre-selected `value` (e.g. edit forms). */
  valueLabel?: string | undefined;
  /** What to show in the input once a row is picked. Defaults to "CODE — Name";
   *  pass e.g. `(o) => o.code ?? o.name` to show only the code while the dropdown
   *  keeps the full "CODE — Name" label. */
  selectedLabel?: ((o: SearchableOption) => string) | undefined;
  id?: string | undefined;
  className?: string | undefined;
  emptyText?: string | undefined;
}

function optionLabel(o: SearchableOption): string {
  return o.code ? `${o.code} — ${o.name}` : o.name;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  onSearch,
  loading = false,
  placeholder = '🔍 Click to browse or type to search…',
  disabled = false,
  valueLabel,
  selectedLabel,
  id,
  className,
  emptyText = 'No matches',
}: SearchableSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Where to draw the list. The dropdown is rendered into document.body via a
  // portal, so it must be positioned in VIEWPORT coordinates against the input.
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const baseId = id ?? 'searchable-select';
  const listboxId = `${baseId}-listbox`;

  // Show a pre-selected value's label when the field is not being edited — even
  // when its id isn't in the current options page yet (edit forms: the saved row
  // may sit beyond the first page, be inactive, or still be loading, so the id
  // lookup returns null while `valueLabel` still holds the real code/name). The
  // caller only passes `valueLabel` when something is selected, and typing clears
  // it via handleInput, so we don't gate on the resolved `value` id here — that
  // gate was the "picker renders blank in edit mode" bug.
  useEffect(() => {
    if (!open && valueLabel && query === '') setQuery(valueLabel);
  }, [open, valueLabel, query]);

  // Close on outside mousedown. Use the CAPTURE phase so this still fires when the
  // component sits inside a container that stops mousedown propagation (e.g. the
  // planning Modal calls e.stopPropagation() on its body to avoid backdrop-close).
  // A bubble-phase document listener would never run there, leaving the dropdown
  // stuck open. Clicking outside just closes it — it never forces a selection.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      const t = e.target as Node;
      // The list lives in a portal on <body>, so it is NOT inside containerRef.
      // Without checking it too, clicking an option would count as "outside",
      // close the dropdown, and swallow the pick.
      if (containerRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, []);

  // Track the input's viewport position while the list is open.
  //
  // The list used to be absolutely positioned inside the component. That works
  // until an ancestor clips: `.panel` sets `overflow: hidden`, which slices the
  // dropdown at the panel edge — z-index cannot escape clipping. Rendering into
  // <body> sidesteps every such container, at the cost of positioning by hand.
  //
  // Listeners are capture-phase so a scroll inside ANY nested scroller (a modal
  // body, a .tbl-wrap) repositions the list, not just a window scroll.
  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    // Keep the list inside the viewport. A `position: fixed` element cannot be
    // scrolled into view — so a picker low on the page (the second or third row
    // of a line editor) opened its list below the fold, where it was literally
    // unreachable. Flip above the input when there is more room there, and cap
    // the height to whatever room the chosen side actually has.
    const GAP = 4;
    const EDGE = 8;
    const IDEAL = 256; // matches max-h-64 below
    const measure = (): void => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - GAP - EDGE;
      const above = r.top - GAP - EDGE;
      const flip = below < Math.min(IDEAL, above) && above > below;
      const room = Math.max(120, Math.min(IDEAL, flip ? above : below));
      setRect({
        left: r.left,
        top: flip ? Math.max(EDGE, r.top - room - GAP) : r.bottom + GAP,
        width: r.width,
        maxHeight: room,
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // On OPEN, re-sync the caller's search term to whatever this input holds.
  //
  // Callers typically keep ONE search string for a whole form and hand it to
  // one list hook — the BOM form's parent + every child line share one, the SO
  // form's line pickers share one. So the options currently in `options` are
  // whatever the LAST field searched for. Open a second, empty picker and it
  // inherits that stale term: the BOM child list showed exactly one row, the
  // parent that had just been picked, which made the item master look empty.
  //
  // Syncing to `query` is right in both directions: an empty field asks for ''
  // and gets the unfiltered first page ("Click to browse", as the placeholder
  // promises), and a field that already holds text re-asks for that text
  // instead of silently widening to page 1 under a local filter.
  const openedRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    // Beat any in-flight debounce from the field the user just left.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // `query` is deliberately NOT a dependency: it is read once at the moment
    // of opening. Re-running on every keystroke would bypass the debounce in
    // handleInput and fire a request per character. queryRef keeps the read
    // current without making the effect depend on it.
    onSearch(queryRef.current.trim());
  }, [open, onSearch]);

  // Substring match, case-insensitive, anywhere in the label — so a row is found
  // by its starting OR ending characters. Refines the server's results.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => optionLabel(o).toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    setHighlight((h) => (h >= filtered.length ? 0 : h));
  }, [filtered.length]);

  const runSearch = useCallback(
    (term: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearch(term.trim()), 250);
    },
    [onSearch],
  );

  function handleInput(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value;
    setQuery(next);
    setOpen(true);
    // Typing invalidates any prior selection — caller must re-pick (saved id clears).
    if (value) onChange(null);
    runSearch(next);
  }

  function pick(o: SearchableOption): void {
    onChange(o.id);
    setQuery(selectedLabel ? selectedLabel(o) : optionLabel(o));
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[highlight]) {
        e.preventDefault();
        pick(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const activeOptionId = open && filtered[highlight] ? `${baseId}-opt-${highlight}` : undefined;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        id={baseId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && rect
        ? createPortal(
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              // z-index must beat the modals. They are plain `position: fixed`
              // overlays at zIndex 100 (party material, party GRN, material
              // issue, JW return/invoice, the planning modals). While the list
              // lived inside the modal it inherited that stacking context and
              // sat above it; portaled to <body> it became a SIBLING of the
              // overlay, so at z-50 it rendered BEHIND the modal and read as
              // "the dropdown never opens". Inline so it always beats the
              // utility class, and well clear of 100 for headroom.
              style={{
                position: 'fixed',
                left: rect.left,
                top: rect.top,
                width: rect.width,
                maxHeight: rect.maxHeight,
                zIndex: 1000,
              }}
              className="overflow-y-auto rounded-md border border-input bg-popover py-1 text-popover-foreground shadow-md"
            >
          {loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Loading…</li>
          ) : filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.id}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm',
                  i === highlight ? 'bg-accent text-accent-foreground' : 'text-foreground',
                )}
              >
                {o.code ? (
                  <>
                    <span className="font-semibold">{o.code}</span>
                    {/* The muted colour is tuned for the normal background; on
                        the highlighted row (bg-accent) it washed out to nearly
                        invisible, so the part NAME — the thing you are reading
                        to confirm the pick — disappeared. Inherit the row's own
                        foreground there and just soften it. */}
                    <span
                      className={
                        i === highlight ? 'opacity-80' : 'text-muted-foreground'
                      }
                    >
                      {' '}
                      — {o.name}
                    </span>
                  </>
                ) : (
                  o.name
                )}
                  </li>
                ))
              )}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
