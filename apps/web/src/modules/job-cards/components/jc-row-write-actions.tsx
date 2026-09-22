// Edit + Delete row actions for the JC list (parity: renderJobCards row actions
// — Edit gated on canEdit, Delete on isAdmin, L5770-5772). Self-gating so the
// list's memoized column defs don't need the session in their deps.
import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Check, Loader2, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useDeleteJobCard } from '../api';

/** Icon-only trim: the sheet's `.jc-row-acts .btn-sm` rule pads 2px 6px (a
 *  labelled button's fit); an icon alone needs 3px a side so six of them sit
 *  on one row inside the Action column. */
const ICON_BTN: React.CSSProperties = { padding: '2px 3px' };

export function JcRowWriteActions({
  jc,
  iconOnly = false,
}: {
  jc: JobCardListItem;
  /** The list sheet's Action column: icons alone (Pencil / Trash2), the title
   *  names the action; the two-step delete confirm stays (tick / cross icons). */
  iconOnly?: boolean | undefined;
}): React.JSX.Element | null {
  // Tier-driven, per department (jc_create sits in Production). Edit needs `edit`
  // (L3+); Delete needs the edit+approve pair only L5 Department Admin and up hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jc_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  const del = useDeleteJobCard();
  const [confirming, setConfirming] = useState(false);

  if (!canEdit && !canDelete) return null;

  if (iconOnly) {
    return (
      <>
        {canEdit ? (
          <Link
            to="/job-cards/$id/edit"
            params={{ id: jc.id }}
            className="btn btn-ghost btn-sm btn-icon"
            style={ICON_BTN}
            title="Edit"
            aria-label="Edit"
          >
            <Pencil size={13} />
          </Link>
        ) : null}
        {canDelete ? (
          confirming ? (
            <>
              {/* The sheet paints every .btn-sm on paper (theme rule), which
                  would leave btn-danger's white icon invisible — so the icon
                  is told to be red here, tokens only. */}
              <button
                type="button"
                className="btn btn-danger btn-sm btn-icon"
                style={{ ...ICON_BTN, color: 'var(--red)' }}
                disabled={del.isPending}
                onClick={() => del.mutate(jc.id, { onSettled: () => setConfirming(false) })}
                title="Confirm delete"
                aria-label="Confirm delete"
              >
                {del.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                style={ICON_BTN}
                onClick={() => setConfirming(false)}
                disabled={del.isPending}
                title="Cancel"
                aria-label="Cancel"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-sm btn-icon"
              style={{ ...ICON_BTN, color: 'var(--red)' }}
              onClick={() => setConfirming(true)}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 size={13} />
            </button>
          )
        ) : null}
      </>
    );
  }

  return (
    <>
      {canEdit ? (
        <Link
          to="/job-cards/$id/edit"
          params={{ id: jc.id }}
          className="btn btn-ghost btn-sm"
          title="Edit job card"
        >
          ✎ Edit
        </Link>
      ) : null}
      {canDelete ? (
        confirming ? (
          <>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={del.isPending}
              onClick={() => del.mutate(jc.id, { onSettled: () => setConfirming(false) })}
              title="Confirm delete"
            >
              {del.isPending ? <Loader2 size={12} className="animate-spin" /> : '🗑'} Confirm
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
              disabled={del.isPending}
            >
              ✕
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirming(true)}
            title="Delete job card"
          >
            🗑
          </button>
        )
      ) : null}
    </>
  );
}
