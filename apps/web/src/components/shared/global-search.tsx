// Global Search — the header search box rendered on every page (topbar.tsx).
//
// Type two or more characters and the results open in a full-window popup
// over the current page, below the top bar (modules/search/components/
// search-popup.tsx): Date | Type | Doc No. | Party | Particulars | Qty |
// Status across every document kind the caller may view, with a count strip
// to filter by type. Enter opens at once, typing opens after a short pause.
// Escape (in the box or anywhere in the popup) closes the popup and clears
// the box; ✕ / backdrop close it but keep the text so it can be edited;
// opening a row closes and clears. Ctrl+K /
// Cmd+K focuses the box from anywhere. The box keeps focus and the keyboard
// while the popup is open — nothing inside it is autofocused.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { GLOBAL_SEARCH_MAX_CHARS, GLOBAL_SEARCH_MIN_CHARS } from '@innovic/shared';
import { useDebounce } from '@/lib/use-debounce';
import { SearchPopup, type SearchPopupCloseReason } from '@/modules/search/components/search-popup';

const DEBOUNCE_MS = 300;

export function GlobalSearch(): React.JSX.Element {
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState('');
  /** The term the popup searches — set after the pause, or at once on Enter. */
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  // The term the popup was ✕-closed on: the debounce settling on that same
  // term (Enter, then ✕ within the pause) must not re-open it. Any keystroke
  // that changes the term clears it.
  const dismissedTerm = useRef<string | null>(null);

  // Box → popup, after a pause. Fewer than two characters closes it.
  const debounced = useDebounce(value, DEBOUNCE_MS);
  useEffect(() => {
    const term = debounced.trim();
    setQ(term);
    if (term !== dismissedTerm.current) dismissedTerm.current = null;
    setOpen(term.length >= GLOBAL_SEARCH_MIN_CHARS && dismissedTerm.current === null);
  }, [debounced]);

  // A sidebar link (or any navigation) with the popup open closes it.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Ctrl+K / Cmd+K anywhere focuses the box.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape (in the box or in the popup) and opening a row close AND clear the
  // box. ✕ / backdrop close but keep the text and hand focus back to the box
  // (the portal's unmount would otherwise drop it on <body>), so typing or
  // Enter refines at once.
  const close = useCallback((reason: SearchPopupCloseReason) => {
    setOpen(false);
    if (reason === 'dismiss') {
      dismissedTerm.current = inputRef.current?.value.trim() ?? null;
      inputRef.current?.focus();
      return;
    }
    setValue('');
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      const term = value.trim();
      if (term.length < GLOBAL_SEARCH_MIN_CHARS) return;
      dismissedTerm.current = null;
      setQ(term);
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setValue('');
    }
  }

  return (
    <div className="gs-wrap">
      <Search size={14} className="gs-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        className="innovic-input gs-input"
        placeholder="Search anything… (Ctrl+K)"
        aria-label="Search anything"
        autoComplete="off"
        spellCheck={false}
        maxLength={GLOBAL_SEARCH_MAX_CHARS}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <SearchPopup q={q} open={open} onClose={close} />
    </div>
  );
}
