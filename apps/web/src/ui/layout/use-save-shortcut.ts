// useSaveShortcut — Ctrl+S / ⌘+S runs the form's Save, as it does in ERPNext
// (frappe keyboard.js binds ctrl+s to the page's primary action). Without it
// the browser's own "Save page as…" dialog opens over the form.
//
// Pass the same handler the Save button calls; pass `enabled=false` while a
// save is in flight or the form is read-only so a held key cannot double-post.

import { useEffect, useRef } from 'react';

/** Some pop-ups are hand-rolled `position: fixed` layers with no role or
 *  class; focus inside one of them means the keypress is not for the form. */
function insideFixedLayer(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (getComputedStyle(el).position === 'fixed') return true;
    el = el.parentElement;
  }
  return false;
}

export function useSaveShortcut(onSave: () => void, enabled = true): void {
  // Latest handler without re-binding the listener on every render.
  const ref = useRef(onSave);
  ref.current = onSave;

  useEffect(() => {
    if (!enabled) return undefined;
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // A held key repeats; one press = one save.
        if (e.repeat) return;
        // A pop-up is open over the form (quick-add customer, confirm, exit
        // guard): Ctrl+S must not submit the form underneath it.
        if (
          document.querySelector(
            '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .overlay',
          ) ||
          insideFixedLayer(e.target)
        )
          return;
        ref.current();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
