// Global Search — the header search box rendered on every page (topbar.tsx).
//
// It is a launcher, not a dropdown: type two or more characters and the app
// goes to the full-screen Search page (`/search?q=…`, modules/search) which
// lists Date | Type | Doc No. | Party | Particulars | Qty | Status across every
// document kind the caller may view. Enter goes at once, typing goes after a
// short pause, Escape clears the box. Ctrl+K / Cmd+K focuses it from anywhere.
//
// The box mirrors the URL: on /search it shows `?q`, on any other page it is
// empty — so opening a result (which leaves /search) clears it, and Back to
// /search brings the term back.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { GLOBAL_SEARCH_MAX_CHARS, GLOBAL_SEARCH_MIN_CHARS } from '@innovic/shared';
import { useDebounce } from '@/lib/use-debounce';

const SEARCH_PATH = '/search';
const DEBOUNCE_MS = 300;

export function GlobalSearch(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const onSearchPage = location.pathname === SEARCH_PATH;
  // Read `q` loosely: `location.search` is the union of every route's params.
  const rawQ = (location.search as Record<string, unknown>).q;
  const routeQ = onSearchPage && typeof rawQ === 'string' ? rawQ : '';

  const [value, setValue] = useState(routeQ);
  // The term this box last pushed into the URL. When it echoes back through
  // `routeQ` it must NOT overwrite what the user has typed since.
  const pushedRef = useRef<string | null>(null);

  // Route → box. Leaving /search empties it; arriving (or Back/Forward) fills it.
  useEffect(() => {
    if (!onSearchPage) {
      pushedRef.current = null;
      setValue('');
      return;
    }
    if (pushedRef.current !== null && routeQ === pushedRef.current) {
      pushedRef.current = null;
      return;
    }
    setValue(routeQ);
  }, [onSearchPage, routeQ]);

  function go(term: string): void {
    if (term.length < GLOBAL_SEARCH_MIN_CHARS || term === routeQ) return;
    pushedRef.current = term;
    // Refining a term on /search replaces the entry so Back does not step
    // through every keystroke; from any other page it is a real navigation.
    void navigate({ to: SEARCH_PATH, search: { q: term }, replace: onSearchPage });
  }

  // Box → route, after a pause.
  const debounced = useDebounce(value, DEBOUNCE_MS);
  // Only the settled term re-runs this; `go` reads the current route on the way.
  useEffect(() => {
    go(debounced.trim());
  }, [debounced]);

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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      go(value.trim());
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
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
    </div>
  );
}
