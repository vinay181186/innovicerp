// The Store screens' overlay box. Lifted out of routes/list.tsx unchanged so
// the reservation drill-down can use the very same shell as ± Adjust, Min Qty
// and Manual Receipt — one box, not a second hand-rolled one.

import { useEffect, useRef } from 'react';
import { escapeBelongsToAnOpenPicker } from '@/lib/exit-guard';

export function ModalShell({
  onClose,
  title,
  children,
  width = 'min(1100px, 96vw)',
  closeOnEscape = false,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Override only when the content genuinely needs a different box. */
  width?: string;
  /** Escape closes the box — read-only boxes only (the drill-down); a form box
   *  keeps it off so a stray key never loses typed input. Same listener shape
   *  as ui/feedback/Modal: document capture phase, and an open type-to-search
   *  dropdown keeps the key (lib/exit-guard). */
  closeOnEscape?: boolean;
}): React.JSX.Element {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      // A column ▾ menu / list open inside the box closes first.
      if (document.querySelector('[role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [closeOnEscape]);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}
