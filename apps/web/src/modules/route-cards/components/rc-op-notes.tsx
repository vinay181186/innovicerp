// An operation's long text — Tool Details and Remarks — on its own line under the
// row, with Show / Hide (owner 2026-11-06, mockup RC-Remark-Show-Hide). Used by the
// live Operation Sequence and by the routing kept with each revision.
//
// A row with text opens by itself, so nothing the card holds is hidden on arrival,
// and Hide is not remembered: each visit shows everything.

import { useState } from 'react';
import './rc-op-notes.css';

export interface OpNotes {
  id: string;
  label: string;
  toolDetails?: string | null | undefined;
  remarks?: string | null | undefined;
}

function hasNotes(op: OpNotes): boolean {
  return Boolean(op.toolDetails?.trim() || op.remarks?.trim());
}

export function useOpNotes(ops: OpNotes[]) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const withNotes = ops.filter(hasNotes);
  const anyOpen = withNotes.some((op) => !hidden.has(op.id));
  return {
    /** No text on any row: the Show / Hide column is left off. */
    any: withNotes.length > 0,
    hasNotes,
    isOpen: (op: OpNotes) => hasNotes(op) && !hidden.has(op.id),
    toggle: (op: OpNotes) =>
      setHidden((was) => {
        const next = new Set(was);
        if (!next.delete(op.id)) next.add(op.id);
        return next;
      }),
    anyOpen,
    toggleAll: () => setHidden(anyOpen ? new Set(withNotes.map((op) => op.id)) : new Set()),
  };
}

export function OpNotesToggle({
  open,
  label,
  onClick,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm rc-op-toggle"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} the text of ${label}`}
      onClick={onClick}
    >
      {open ? '▾ Hide' : '▸ Show'}
    </button>
  );
}

export function OpNotesAllToggle({
  anyOpen,
  onClick,
}: {
  anyOpen: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm rc-op-toggle"
      aria-expanded={anyOpen}
      onClick={onClick}
    >
      {anyOpen ? '▾ Hide all' : '▸ Show all'}
    </button>
  );
}

/** The line under an operation. The first cell stays empty under the Op number. */
export function OpNotesRow({
  op,
  columns,
  background,
}: {
  op: OpNotes;
  /** How many columns the table has. */
  columns: number;
  background?: string | undefined;
}): React.JSX.Element {
  const toolDetails = op.toolDetails?.trim();
  const remarks = op.remarks?.trim();
  return (
    <tr className="rc-op-notes-row" style={{ background }}>
      <td />
      <td colSpan={columns - 1}>
        <div className="rc-op-notes">
          {toolDetails ? (
            <>
              <span className="rc-op-notes-k">Tool Details</span>
              <span className="rc-op-notes-v">{op.toolDetails}</span>
            </>
          ) : null}
          {remarks ? (
            <>
              <span className="rc-op-notes-k">Remarks</span>
              <span className="rc-op-notes-v">{op.remarks}</span>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
