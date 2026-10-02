// RowActions — the ONE row-action control, last column of every table.
//
// In a sheet row it is ONE ⋯ button (ui/data/RowMenu, owner spec
// 2026-10-01): View (eye) · Edit (pencil) · the caller's `items` · Delete
// last, in red, after a line. `labelled` (nested line tables and cards) keeps
// the text buttons View / Edit / Del side by side. Every control stops the row
// click from firing underneath it.
//
// Delete NEVER uses window.confirm and never deletes on the first click. Two
// sanctioned shapes:
//   1. caller-owned  — `onDelete` opens the caller's own ConfirmDialog
//                      (the canonical form: the page already tracks which row
//                      is pending and what the message says)
//   2. built-in      — pass `deleteConfirm` and this component raises the
//                      shared ConfirmDialog itself, calling `onDelete` only
//                      once the user confirms
// In the ⋯ menu Delete is the last item, red, after a line; its label is the
// word the confirm button will say ("Move to Trash" / "Delete").

// NAVIGATION IS A LINK, NOT A CLICK. View and Edit go to a route, so they take
// `viewTo` / `editTo` + `renderLink` and render a real anchor — ctrl-click,
// middle-click and "open in new tab" keep working. The reference component
// (design-ref/components/layout/RowActions.jsx) only has onClick handlers, but
// every list in this app ships `<Link className="btn btn-ghost btn-sm
// btn-icon">` today; turning those into buttons would be a silent behaviour
// loss, the same one StatStrip's `to` prop exists to prevent (audit 02 §D.7).
// `onView` / `onEdit` stay for a row action that is not navigation.

import { useState, type ReactNode } from 'react';
import { RowMenu } from '../data/RowMenu';
import type { RowMenuItem } from '../data/row-menu-logic';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { LinkSlot, type RenderLink } from './link-slot';

export interface RowDeleteConfirm {
  /** "Delete this sales order?" */
  title?: string | undefined;
  /** What is lost — name the document: "IN-SO-26-0142 and its 4 lines." */
  message?: string | undefined;
  confirmLabel?: string | undefined;
  cancelLabel?: string | undefined;
  /** Shown on the confirm button while an async `onDelete` is running. */
  pendingLabel?: string | undefined;
}

export interface RowActionsProps {
  /** Detail route. Renders View as a real link — takes precedence over `onView`. */
  viewTo?: string | undefined;
  /** Edit route. Renders Edit as a real link — takes precedence over `onEdit`. */
  editTo?: string | undefined;
  /** How a `*To` becomes an SPA link: `(p) => <Link {...p} />`. Without it the
   *  slot falls back to a plain `<a href>` (ui/ never imports the router). */
  renderLink?: RenderLink | undefined;
  onView?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  /** Fired straight away, or after confirmation when `deleteConfirm` is set.
   *  RETURN THE MUTATION'S PROMISE when you have one: with `deleteConfirm` the
   *  dialog then stays open on its own pending state until the delete settles,
   *  cannot be fired twice, and shows a rejection in place of closing. A caller
   *  that instead swallows a second click (`if (m.isPending) return;`) turns a
   *  greyed-out button into a SILENT no-op — the dialog closes and nothing is
   *  deleted. Use `deleteDisabled` for that, never an early return. */
  onDelete?: (() => void | Promise<void>) | undefined;
  /** Raise the shared ConfirmDialog from inside this component. */
  deleteConfirm?: RowDeleteConfirm | undefined;
  /** Greys out Delete — e.g. `mutation.isPending` while another row deletes.
   *  A disabled button SAYS no; an ignored click says nothing at all. */
  deleteDisabled?: boolean | undefined;
  /**
   * More ⋯ menu items (Print, Assign Task, workflow steps …), merged after
   * View / Edit and before Delete; each item's `group` places it.
   */
  items?: RowMenuItem[] | undefined;
  /** Text buttons (View / Edit / Del) for nested line tables and cards. */
  labelled?: boolean | undefined;
}

type Kind = 'view' | 'edit' | 'delete';

const LABEL: Record<Kind, string> = { view: 'View', edit: 'Edit', delete: 'Delete' };

export function RowActions({
  viewTo,
  editTo,
  renderLink,
  onView,
  onEdit,
  onDelete,
  deleteConfirm,
  deleteDisabled = false,
  items,
  labelled = false,
}: RowActionsProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  // `labelled` text buttons. One look, two elements: a link and a button that
  // are indistinguishable on screen, so View can navigate without changing
  // how the row reads.
  const classOf = (kind: Kind): string =>
    `btn btn-sm ${kind === 'delete' ? 'btn-danger' : 'btn-ghost'}`;

  const button = (kind: Kind, fn?: () => void, disabled = false): ReactNode => {
    if (!fn) return null;
    return (
      <button
        type="button"
        title={LABEL[kind]}
        className={classOf(kind)}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          fn();
        }}
      >
        {LABEL[kind]}
      </button>
    );
  };

  // `buttonReset={false}`: .btn already declares display, height, padding and
  // font — the reset would flatten all four (see link-slot.tsx).
  const link = (kind: Kind, to?: string): ReactNode => {
    if (to === undefined) return null;
    return (
      <LinkSlot
        to={to}
        renderLink={renderLink}
        className={classOf(kind)}
        title={LABEL[kind]}
        buttonReset={false}
      >
        {LABEL[kind]}
      </LinkSlot>
    );
  };

  const deleteClick = onDelete
    ? deleteConfirm
      ? (): void => setConfirming(true)
      : (): void => {
          void onDelete();
        }
    : undefined;

  // The ⋯ menu's items, in the old cluster's order. Delete's label is the
  // word the confirm dialog's button will say.
  const deleteLabel = deleteConfirm
    ? (deleteConfirm.confirmLabel ?? (deleteConfirm.title ? 'Delete' : 'Move to Trash'))
    : 'Delete';
  const navItem = (kind: 'view' | 'edit', to?: string, fn?: () => void): RowMenuItem[] =>
    to !== undefined || fn
      ? [
          {
            key: kind,
            label: LABEL[kind],
            icon: kind === 'view' ? 'eye' : 'pencil',
            ...(to !== undefined ? { to } : { onSelect: fn }),
          },
        ]
      : [];
  const menuItems: RowMenuItem[] = labelled
    ? []
    : [
        ...navItem('view', viewTo, onView),
        ...navItem('edit', editTo, onEdit),
        ...(items ?? []),
        ...(onDelete
          ? [
              {
                key: 'delete',
                label: deleteLabel,
                icon: 'trash-2' as const,
                group: 'danger' as const,
                disabledReason: deleteDisabled ? 'Working…' : undefined,
                // Without a confirm the delete's own Promise is handed to the
                // menu, which stays busy until it settles.
                onSelect: deleteConfirm ? () => setConfirming(true) : onDelete,
              },
            ]
          : []),
      ];

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--sp-1)',
        justifyContent: 'center',
        alignItems: 'center',
        flexWrap: 'nowrap',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {labelled ? (
        <>
          {link('view', viewTo) ?? button('view', onView)}
          {link('edit', editTo) ?? button('edit', onEdit)}
          {button('delete', deleteClick, deleteDisabled)}
        </>
      ) : (
        <>
          <RowMenu items={menuItems} renderLink={renderLink} />
        </>
      )}
      {confirming && deleteConfirm ? (
        <ConfirmDialog
          title={deleteConfirm.title ?? 'Move this record to Trash?'}
          message={
            deleteConfirm.message ??
            (deleteConfirm.title ? 'This cannot be undone.' : 'You can restore it from Trash.')
          }
          confirmLabel={deleteLabel}
          cancelLabel={deleteConfirm.cancelLabel ?? 'Cancel'}
          tone="danger"
          onCancel={() => setConfirming(false)}
          {...(deleteConfirm.pendingLabel ? { pendingLabel: deleteConfirm.pendingLabel } : {})}
          // An async `onDelete` is HANDED BACK to the dialog rather than
          // fired-and-forgotten: ConfirmDialog disables both buttons while the
          // promise is in flight, so the row cannot be deleted twice, and on a
          // rejection it keeps the question open with the error instead of
          // closing over a delete that never happened. The dialog closes only
          // once the delete has actually succeeded. A sync `onDelete` keeps the
          // old close-immediately behaviour.
          onConfirm={() => {
            const result = onDelete?.();
            if (result instanceof Promise) {
              return result.then(() => {
                setConfirming(false);
              });
            }
            setConfirming(false);
            return undefined;
          }}
        />
      ) : null}
    </div>
  );
}
