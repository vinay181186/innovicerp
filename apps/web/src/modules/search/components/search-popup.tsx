// Search popup — the full-window results for the header search box, laid
// over the current page BELOW the top bar so the box stays visible and usable
// while the results are open (`.gs-overlay` in innovic-theme.css).
//
// Same overlay/modal markup every other popup in the app uses (jw-dc list's
// modal is the pattern). Portaled to <body> so no ancestor can clip it. The
// kind filter is local and forgets itself when the term changes. A row click
// opens the document (openSearchResult) and closes the popup. Nothing is
// autofocused and focus is not trapped: the header box keeps the keyboard.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from '@tanstack/react-router';
import type { GlobalSearchKind, GlobalSearchResult } from '@innovic/shared';
import { openSearchResult } from '../api';
import { SearchResults } from './search-results';

export type SearchPopupCloseReason =
  /** ✕ or backdrop — the caller keeps the typed text and refocuses the box. */
  | 'dismiss'
  /** Escape — the caller closes AND clears the box (same as Escape in the box). */
  | 'escape'
  /** A row was opened — the caller closes AND clears the box. */
  | 'opened';

export function SearchPopup({
  q,
  open,
  onClose,
}: {
  /** Trimmed search term. */
  q: string;
  open: boolean;
  onClose: (reason: SearchPopupCloseReason) => void;
}): React.JSX.Element | null {
  const navigate = useNavigate();

  // The kind filter belongs to the term it was picked for.
  const [kindFor, setKindFor] = useState<{ q: string; kind: GlobalSearchKind | undefined }>({
    q,
    kind: undefined,
  });
  const kind = kindFor.q === q ? kindFor.kind : undefined;

  // Escape anywhere (a strip button may hold focus) closes + clears, exactly
  // like Escape in the header box. CAPTURE phase + preventDefault so it runs
  // before, and is honoured by, the exit guard's own window listener
  // (lib/exit-guard.tsx backs off when defaultPrevented) — otherwise Escape
  // here on a guarded form page would ALSO open "lose your edits?".
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose('escape');
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  function handleOpen(r: GlobalSearchResult): void {
    openSearchResult(navigate, r);
    onClose('opened');
  }

  return createPortal(
    <div
      className="overlay gs-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose('dismiss');
      }}
    >
      <div className="modal modal-lg" role="dialog" aria-label="Search results">
        <div className="modal-hdr">
          <span className="modal-title">Search — &ldquo;{q}&rdquo;</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => onClose('dismiss')}
            title="Close"
            aria-label="Close search results"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          <SearchResults
            layout="popup"
            q={q}
            kind={kind}
            onKindChange={(next) => setKindFor({ q, kind: next })}
            onOpen={handleOpen}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
