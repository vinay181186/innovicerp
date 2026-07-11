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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseId = id ?? 'searchable-select';
  const listboxId = `${baseId}-listbox`;

  // Show a pre-selected value's label when the field is not being edited.
  useEffect(() => {
    if (!open && value && valueLabel && query === '') setQuery(valueLabel);
  }, [open, value, valueLabel, query]);

  // Close on outside mousedown. Use the CAPTURE phase so this still fires when the
  // component sits inside a container that stops mousedown propagation (e.g. the
  // planning Modal calls e.stopPropagation() on its body to avoid backdrop-close).
  // A bubble-phase document listener would never run there, leaving the dropdown
  // stuck open. Clicking outside just closes it — it never forces a selection.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

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
      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-input bg-popover py-1 text-popover-foreground shadow-md"
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
                    <span className="text-muted-foreground"> — {o.name}</span>
                  </>
                ) : (
                  o.name
                )}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
