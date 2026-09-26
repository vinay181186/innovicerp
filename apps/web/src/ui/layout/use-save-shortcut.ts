// useSaveShortcut — Ctrl+S / ⌘+S runs the form's Save, as it does in ERPNext
// (frappe keyboard.js binds ctrl+s to the page's primary action). Without it
// the browser's own "Save page as…" dialog opens over the form.
//
// Pass the same handler the Save button calls; pass `enabled=false` while a
// save is in flight or the form is read-only so a held key cannot double-post.

import { useEffect, useRef } from 'react';

export function useSaveShortcut(onSave: () => void, enabled = true): void {
  // Latest handler without re-binding the listener on every render.
  const ref = useRef(onSave);
  ref.current = onSave;

  useEffect(() => {
    if (!enabled) return undefined;
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        ref.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
