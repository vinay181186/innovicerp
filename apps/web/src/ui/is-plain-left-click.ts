import type { MouseEvent } from 'react';

/**
 * True only for an unmodified primary-button click — the kind that means
 * "navigate here, in this tab".
 *
 * Ctrl/Cmd-click, Shift-click, Alt-click and middle-click all mean "open this
 * somewhere else", and the browser handles them natively from the `href`. A
 * handler that calls `preventDefault()` on those kills that behaviour, so every
 * anchor in `ui/` that intercepts its own href has to check this first.
 */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
