// SO Status Review — standalone per-SO detail route (deep-linked from SO
// Master "Status"). Renders the shared SoStatusDetailView. The full two-pane
// SO Status Review screen lives at /so-status (index.tsx).

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SoStatusDetailView } from '../components/so-status-detail';

export const soStatusDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id/status',
  component: SoStatusPage,
});

function SoStatusPage(): React.JSX.Element {
  const { id } = soStatusDetailRoute.useParams();
  return (
    <div>
      <Link to="/sales-orders/$id" params={{ id }} className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to SO detail
      </Link>
      <SoStatusDetailView soId={id} />
    </div>
  );
}
