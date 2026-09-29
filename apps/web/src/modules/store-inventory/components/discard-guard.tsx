// Popup forms on the Store / Party-material screens: a click on the dim
// backdrop or ESC used to close the popup at once and throw away every typed
// line. Now, when something has been typed, the same "Are you sure you want to
// exit?" question every other form asks comes up first; an untouched popup
// still closes straight away. The popup's own Cancel / × stay as they are.
//
// Usage:
//   const guard = useDiscardGuard(dirty, onClose);
//   <div className="overlay" onClick={(e) => e.target === e.currentTarget && guard.requestClose()}>
//     {guard.dialog}
//     ...
import { useCallback, useEffect, useState } from 'react';
import { ExitConfirmDialog, escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';

export interface DiscardGuard {
  /** Backdrop click / ESC: asks first when something was typed. */
  requestClose: () => void;
  /** Render once inside the popup. */
  dialog: React.ReactNode;
}

export function useDiscardGuard(dirty: boolean, onClose: () => void): DiscardGuard {
  const [asking, setAsking] = useState(false);
  const requestClose = useCallback(() => {
    if (dirty) setAsking(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape' || e.defaultPrevented || asking) return;
      // ESC with a type-to-search dropdown open is that dropdown's key.
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose, asking]);

  const dialog = asking ? (
    <ExitConfirmDialog
      onStay={() => setAsking(false)}
      onExit={() => {
        setAsking(false);
        onClose();
      }}
    />
  ) : null;
  return { requestClose, dialog };
}
