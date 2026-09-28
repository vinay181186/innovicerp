// Assembly SO → Material (ADR-193 3b/3c). BOM parts needed for the SO's
// units, what is reserved / issued / returned / fitted, and the slips; plus
// Reserve Parts / Release (Planning) and Issue from Store (Store).
import { Link } from '@tanstack/react-router';
import type { SoMaterialLine } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSoMaterial } from '../api';
import { IssueSlipList } from './issue-slip-list';
import { ReleasePartModal, ReservePartsModal } from './reserve-parts';
import { SoMaterialTable } from './so-material-table';

export function SoMaterialPanel({
  salesOrderId,
  stopped = false,
}: {
  salesOrderId: string;
  stopped?: boolean;
}): React.JSX.Element {
  const { data, isLoading, isError, error } = useSoMaterial(salesOrderId);
  const { data: eff } = useMyAccess();
  const canIssue = effectiveFormPerms(eff, 'issue_create').entry && !stopped && data?.hasBom;
  const canReserve = effectiveFormPerms(eff, 'plan_create').entry && !stopped && data?.hasBom;
  const [reserving, setReserving] = useState(false);
  const [releasing, setReleasing] = useState<SoMaterialLine | null>(null);
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
          Units <b className="mono">{data.units}</b>
        </span>
        {canReserve ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setReserving(true)}
            title="Hold free stock for this SO's parts so another order cannot take it"
          >
            Reserve Parts
          </button>
        ) : null}
        {canIssue ? (
          <Link
            to="/issue-register"
            search={{ tab: 'items', new: 'assembly_so', salesOrderId }}
            className="btn btn-primary btn-sm"
            style={canReserve ? undefined : { marginLeft: 'auto' }}
          >
            Issue from Store
          </Link>
        ) : null}
      </div>
      <SoMaterialTable data={data} onRelease={canReserve ? setReleasing : undefined} />
      <IssueSlipList issues={data.issues} />
      {reserving ? <ReservePartsModal data={data} onClose={() => setReserving(false)} /> : null}
      {releasing ? (
        <ReleasePartModal
          salesOrderId={salesOrderId}
          line={releasing}
          onClose={() => setReleasing(null)}
        />
      ) : null}
    </div>
  );
}
