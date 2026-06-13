// Edit Job Card (parity: editJC L6076). Loads the full edit model (header + ops
// + qc docs) then renders the shared form. Write-gated to admin/manager.
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCardEditModel } from '../api';
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
      <Link to="/job-cards" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Job Cards
      </Link>
      <div className="section-hdr" style={{ marginBottom: 12 }}>
        Edit Job Card — {model.code}
      </div>
      <JobCardForm model={model} />
    </div>
  );
}
