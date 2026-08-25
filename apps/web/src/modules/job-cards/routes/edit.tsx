// Edit Job Card (parity: editJC L6076). Renders the mode-switched JC Status
// component in EDIT mode, so view & edit share ONE canonical layout (tiles +
// operation flow + operations table) and differ only by editable fields.
// Write-gated to admin/manager.
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Eye, Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCard } from '../api';
import { JcStatusContent } from '../components/jc-status-content';

export const jobCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id/edit',
  component: JobCardEditPage,
});

function JobCardEditPage(): React.JSX.Element {
  const { id } = jobCardEditRoute.useParams();
  // Tier-driven, per department (jc_create sits in Production). Editing a saved
  // Job Card needs `edit` (L3 Editor and up). URL-reachable, so it gates itself.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  // Shares the JcStatusContent query cache (same key) — no extra request.
  const { data: jc } = useJobCard(canWrite ? id : undefined);

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!canWrite) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ You do not have edit access to Job Cards. Ask an admin for L3 Editor or above in
          Production.
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
        Edit Job Card{jc?.code ? ` — ${jc.code}` : ''}
      </div>
      <JcStatusContent id={id} mode="edit" />
    </div>
  );
}
