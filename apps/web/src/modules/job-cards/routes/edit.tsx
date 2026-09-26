// Edit Job Card (parity: editJC L6076). Renders the mode-switched JC Status
// component in EDIT mode, so view & edit share ONE canonical layout (tiles +
// operation flow + operations table) and differ only by editable fields.
// Write-gated to admin/manager.
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Eye, Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { PageHeader } from '@/ui/layout';
import { useJobCard } from '../api';
import { JcStatusContent } from '../components/jc-status-content';

export const jobCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id/edit',
  component: JobCardEditPage,
});

function JobCardEditPage(): React.JSX.Element {
  const { id } = jobCardEditRoute.useParams();
  const navigate = useNavigate();
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
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          ⛔ You do not have edit access to Job Cards. Ask an admin for L3 Editor or above in
          Production.
        </div>
      </div>
    );
  }
  // Save lives inside JcStatusContent (its edit mode), so this header carries
  // only the title, Back and the switch to the read-only view.
  return (
    <div>
      <PageHeader
        title={`Edit Job Card${jc?.code ? ` — ${jc.code}` : ''}`}
        backLabel="Back to Job Cards"
        onBack={() => void navigate({ to: '/job-cards' })}
        actions={
          <Link
            to="/job-cards/$id"
            params={{ id }}
            className="btn btn-ghost"
            title="Switch to the read-only view of this Job Card"
          >
            <Eye size={14} /> View mode
          </Link>
        }
      />
      <JcStatusContent id={id} mode="edit" />
    </div>
  );
}
