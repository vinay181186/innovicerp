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

// NAVIGATION IS A LINK, NOT A CLICK. View and Edit go to a route, so they take
// `viewTo` / `editTo` + `renderLink` and render a real anchor — ctrl-click,
// middle-click and "open in new tab" keep working. The reference component
// (design-ref/components/layout/RowActions.jsx) only has onClick handlers, but
// every list in this app ships `<Link className="btn btn-ghost btn-sm
// btn-icon">` today; turning those into buttons would be a silent behaviour
// loss, the same one StatStrip's `to` prop exists to prevent (audit 02 §D.7).
// `onView` / `onEdit` stay for a row action that is not navigation.

import { useState, type ReactNode } from 'react';
import { Icon } from '../core/Icon';
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
  /** Extra action buttons (Assign, + Line) — always before Delete. */
  extra?: ReactNode | undefined;
  /** Text buttons (View / Edit / Del) for nested line tables and cards. */
  labelled?: boolean | undefined;
}

type Kind = 'view' | 'edit' | 'delete';

const LABEL: Record<Kind, string> = { view: 'View', edit: 'Edit', delete: 'Del' };
const TITLE: Record<Kind, string> = { view: 'View', edit: 'Edit', delete: 'Delete' };

export function RowActions({
  viewTo,
  editTo,
  renderLink,
  onView,
  onEdit,
  onDelete,
  deleteConfirm,
  deleteDisabled = false,
  extra,
  labelled = false,
}: RowActionsProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  // One look, two elements: a link and a button that are indistinguishable on
  // screen, so a row's View can navigate without changing how the row reads.
  const classOf = (kind: Kind): string =>
    `btn btn-sm ${kind === 'delete' ? 'btn-danger' : 'btn-ghost'}${labelled ? '' : ' btn-icon'}`;

  const styleOf = (kind: Kind): React.CSSProperties | undefined =>
    labelled
      ? undefined
      : {
          // The reference's tight 4px box. .btn-icon's 0 8px is sized for
          // a toolbar button; in a sheet row it widens the Action column
          // past spec on every list.
          padding: 'var(--sp-1)',
          ...(kind === 'delete'
            ? {
                color: 'var(--red)',
                background: 'var(--bg2)',
                borderColor: 'var(--border3)',
              }
            : null),
        };

  const face = (kind: Kind): ReactNode =>
    labelled ? (
      LABEL[kind]
    ) : (
      <Icon name={kind === 'view' ? 'eye' : kind === 'edit' ? 'pencil' : 'trash-2'} size={13} />
    );

  const button = (kind: Kind, fn?: () => void, disabled = false): ReactNode => {
    if (!fn) return null;
    return (
      <button
        type="button"
        title={TITLE[kind]}
        aria-label={TITLE[kind]}
        className={classOf(kind)}
        style={styleOf(kind)}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          fn();
        }}
      >
        {face(kind)}
      </button>
    );
  };

  // `title` is the anchor's accessible name here (the Icon is decorative), so
  // the link reads exactly like the button it replaces. `buttonReset={false}`:
  // .btn already declares display, height, padding and font — the reset would
  // flatten all four (see link-slot.tsx).
  const link = (kind: Kind, to?: string): ReactNode => {
    if (to === undefined) return null;
    return (
      <LinkSlot
        to={to}
        renderLink={renderLink}
        className={classOf(kind)}
        style={styleOf(kind)}
        title={TITLE[kind]}
        buttonReset={false}
      >
        {face(kind)}
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

  return (
    <div
      style={{ display: 'flex', gap: 'var(--sp-1)', justifyContent: 'center', flexWrap: 'nowrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {link('view', viewTo) ?? button('view', onView)}
      {link('edit', editTo) ?? button('edit', onEdit)}
      {extra}
      {button('delete', deleteClick, deleteDisabled)}
      {confirming && deleteConfirm ? (
        <ConfirmDialog
          title={deleteConfirm.title ?? 'Delete this record?'}
          message={deleteConfirm.message ?? 'This cannot be undone.'}
          confirmLabel={deleteConfirm.confirmLabel ?? 'Delete'}
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
