// RowActions — the ONE row-action cluster, last column of every table.
//
// Fixed order: View · Edit · (extra) · Delete. Lucide icons in sheet rows
// (13px, named on hover via title), text buttons in nested line tables
// (`labelled`). Every button stops the row click from firing underneath it.
//
// Delete NEVER uses window.confirm and never deletes on the first click. Two
// sanctioned shapes:
//   1. caller-owned  — `onDelete` opens the caller's own ConfirmDialog
//                      (the canonical form: the page already tracks which row
//                      is pending and what the message says)
//   2. built-in      — pass `deleteConfirm` and this component raises the
//                      shared ConfirmDialog itself, calling `onDelete` only
//                      once the user confirms
// In a sheet the Delete button is a red icon on white, never white-on-red:
// a filled icon disappears against the sheet's paper-coloured buttons.

import { useState, type ReactNode } from 'react';
import { Icon } from '../core/Icon';
import { ConfirmDialog } from '../feedback/ConfirmDialog';

export interface RowDeleteConfirm {
  /** "Delete this sales order?" */
  title?: string | undefined;
  /** What is lost — name the document: "IN-SO-26-0142 and its 4 lines." */
  message?: string | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
}

export interface RowActionsProps {
  onView?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  /** Fired straight away, or after confirmation when `deleteConfirm` is set. */
  onDelete?: (() => void) | undefined;
  /** Raise the shared ConfirmDialog from inside this component. */
  deleteConfirm?: RowDeleteConfirm | undefined;
  /** Extra action buttons (Assign, + Line) — always before Delete. */
  extra?: ReactNode | undefined;
  /** Text buttons (View / Edit / Del) for nested line tables and cards. */
  labelled?: boolean | undefined;
}

type Kind = 'view' | 'edit' | 'delete';

const LABEL: Record<Kind, string> = { view: 'View', edit: 'Edit', delete: 'Del' };
const TITLE: Record<Kind, string> = { view: 'View', edit: 'Edit', delete: 'Delete' };

export function RowActions({
  onView,
  onEdit,
  onDelete,
  deleteConfirm,
  extra,
  labelled = false,
}: RowActionsProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  const button = (kind: Kind, fn?: () => void): ReactNode => {
    if (!fn) return null;
    const danger = kind === 'delete';
    return (
      <button
        type="button"
        title={TITLE[kind]}
        aria-label={TITLE[kind]}
        className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-ghost'}${labelled ? '' : ' btn-icon'}`}
        style={
          labelled
            ? undefined
            : {
                // The reference's tight 4px box. .btn-icon's 0 8px is sized for
                // a toolbar button; in a sheet row it widens the Action column
                // past spec on every list.
                padding: 'var(--sp-1)',
                ...(danger
                  ? {
                      color: 'var(--red)',
                      background: 'var(--bg2)',
                      borderColor: 'var(--border3)',
                    }
                  : null),
              }
        }
        onClick={(e) => {
          e.stopPropagation();
          fn();
        }}
      >
        {labelled ? (
          LABEL[kind]
        ) : (
          <Icon name={kind === 'view' ? 'eye' : kind === 'edit' ? 'pencil' : 'trash-2'} size={13} />
        )}
      </button>
    );
  };

  const deleteClick = onDelete
    ? deleteConfirm
      ? (): void => setConfirming(true)
      : onDelete
    : undefined;

  return (
    <div
      style={{ display: 'flex', gap: 'var(--sp-1)', justifyContent: 'center', flexWrap: 'nowrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {button('view', onView)}
      {button('edit', onEdit)}
      {extra}
      {button('delete', deleteClick)}
      {confirming && deleteConfirm ? (
        <ConfirmDialog
          title={deleteConfirm.title ?? 'Delete this record?'}
          message={deleteConfirm.message ?? 'This cannot be undone.'}
          confirmLabel={deleteConfirm.confirmLabel ?? 'Delete'}
          cancelLabel={deleteConfirm.cancelLabel ?? 'Cancel'}
          tone="danger"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onDelete?.();
          }}
        />
      ) : null}
    </div>
  );
}
