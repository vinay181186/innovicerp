// ActionMenu — the "Actions ▾" drop-down on a detail page header.
//
// ERPNext's page head shows ONE primary button and folds every other document
// action into an "Actions" drop-down (frappe ui/page.html). Our detail headers
// laid up to eight buttons side by side (PO: Back · Assign · Approve · Reject ·
// Print · Issue DC · Edit · Delete), with Delete sitting next to Print. Keep the
// one next step as a real button, put the rest here, and Delete last, in red,
// under a divider.
//
//   <ActionMenu items={[
//     { label: 'Print', onClick: print },
//     { label: 'Assign Task', onClick: assign },
//     { label: 'Delete', onClick: del, danger: true },
//   ]} />

import { useEffect, useId, useRef, useState } from 'react';

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  /** Destructive: rendered in red, under a divider, always last. */
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Why it is disabled — shown as the row's tooltip. */
  title?: string | undefined;
  /** Leave the row out entirely (permission / status gates). */
  hidden?: boolean | undefined;
}

export interface ActionMenuProps {
  items: ActionMenuItem[];
  /** Button label; defaults to "Actions". */
  label?: string | undefined;
}

export function ActionMenu({
  items,
  label = 'Actions',
}: ActionMenuProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = items.filter((i) => !i.hidden);
  if (shown.length === 0) return null;
  const safe = shown.filter((i) => !i.danger);
  const danger = shown.filter((i) => i.danger);

  const row = (i: ActionMenuItem): React.JSX.Element => (
    <button
      key={i.label}
      type="button"
      role="menuitem"
      className="action-menu-item"
      style={i.danger ? { color: 'var(--red2)' } : undefined}
      disabled={i.disabled}
      title={i.title}
      onClick={() => {
        setOpen(false);
        i.onClick();
      }}
    >
      {i.label}
    </button>
  );

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        {label} ▾
      </button>
      {open ? (
        <div id={menuId} role="menu" className="action-menu">
          {safe.map(row)}
          {safe.length > 0 && danger.length > 0 ? <div className="action-menu-sep" /> : null}
          {danger.map(row)}
        </div>
      ) : null}
    </div>
  );
}
