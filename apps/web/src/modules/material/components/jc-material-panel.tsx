// Job Card → Material tab (ADR-193 3b): read-only. What the card needs, what
// the store issued / got back, and the slips — plus a link to issue more.
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useJcMaterial } from '../api';
import { IssueSlipList } from './issue-slip-list';
import { JcMaterialTable } from './jc-material-table';

export function JcMaterialPanel({
  jobCardId,
  stopped = false,
}: {
  jobCardId: string;
  stopped?: boolean;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useJcMaterial(jobCardId);
  const { data: eff } = useMyAccess();
  const canIssue = effectiveFormPerms(eff, 'issue_create').entry && !stopped;
  if (isLoading)
    return (
      <div className="text3" style={{ fontSize: 12 }}>
        <Loader2 size={14} className="inline animate-spin" /> Loading…
      </div>
    );
  // No view right on Material (403) — say so plainly, not the raw server text.
  if (isError && (error as { status?: number }).status === 403)
    return (
      <div className="text3" style={{ fontSize: 12 }}>
        Your access does not include the Material view.
      </div>
    );
  if (isError || !data)
    return (
      <div style={{ color: 'var(--red2)', fontSize: 12 }}>
        {error instanceof Error ? error.message : 'Could not load material.'}
      </div>
    );
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="text3" style={{ fontSize: 12 }}>
          Order Qty <b className="mono">{data.orderQty}</b>
        </span>
        {canIssue ? (
          <Link
            to="/issue-register"
            search={{ tab: 'items', new: 'job_card', jobCardId }}
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
          >
            Issue from Store
          </Link>
        ) : null}
      </div>
      <JcMaterialTable data={data} />
      <IssueSlipList issues={data.issues} />
    </div>
  );
}
