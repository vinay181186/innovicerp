// Edit + Delete row actions for the JC list (parity: renderJobCards row actions
// — Edit gated on canEdit, Delete on isAdmin, L5770-5772). Self-gating so the
// list's memoized column defs don't need the session in their deps.
import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useDeleteJobCard } from '../api';

export function JcRowWriteActions({ jc }: { jc: JobCardListItem }): React.JSX.Element | null {
  // Tier-driven, per department (jc_create sits in Production). Edit needs `edit`
  // (L3+); Delete needs the edit+approve pair only L5 Department Admin and up hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jc_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  const del = useDeleteJobCard();
  const [confirming, setConfirming] = useState(false);

  if (!canEdit && !canDelete) return null;

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
