// Edit Job Card (parity: editJC L6076). Loads the full edit model (header + ops
// + qc docs) then renders the shared form. Write-gated to admin/manager.
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Eye, Loader2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCard, useJobCardEditModel } from '../api';
import { JcStatTiles } from '../components/jc-stat-tiles';
import { JobCardForm } from '../components/job-card-form';

export const jobCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id/edit',
  component: JobCardEditPage,
});

function JobCardEditPage(): React.JSX.Element {
  const { id } = jobCardEditRoute.useParams();
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data: model, isLoading, isError, error } = useJobCardEditModel(canWrite ? id : undefined);
  // Same canonical summary header as the JC (view) page — shared JcStatTiles.
  const { data: jc } = useJobCard(canWrite ? id : undefined);
  const { data: ops = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: canWrite });

  if (!canWrite) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Admin / manager access required to edit a job card.
        </div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || !model) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Job card not found'}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link to="/job-cards" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Back to Job Cards
        </Link>
        <Link
          to="/job-cards/$id"
          params={{ id }}
          className="btn btn-ghost btn-sm"
          title="Switch to the read-only view of this Job Card"
        >
          <Eye size={14} /> View mode
        </Link>
      </div>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        Edit Job Card — {model.code}
      </div>
      {/* Same summary tiles as the JC (view) page, so view & edit share one
          format and only the mode differs. */}
      {jc ? <JcStatTiles jc={jc} ops={ops} /> : null}
      <JobCardForm model={model} />
    </div>
  );
}
