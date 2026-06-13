// Edit + Delete row actions for the JC list (parity: renderJobCards row actions
// — Edit gated on canEdit, Delete on isAdmin, L5770-5772). Self-gating so the
// list's memoized column defs don't need the session in their deps.
import type { JobCardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useDeleteJobCard } from '../api';

export function JcRowWriteActions({ jc }: { jc: JobCardListItem }): React.JSX.Element | null {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';
  const del = useDeleteJobCard();
  const [confirming, setConfirming] = useState(false);

  if (!canWrite) return null;

  return (
    <>
      <Link
        to="/job-cards/$id/edit"
        params={{ id: jc.id }}
        className="btn btn-ghost btn-sm"
        title="Edit job card"
      >
        ✎ Edit
      </Link>
      {isAdmin ? (
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
