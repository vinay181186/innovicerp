// The ONE page chrome for every reports screen (catalogue, department view,
// single report, and their loading / denied / not-found states), modelled on
// the ERPNext page head:
//
//   Reports › Store › Stock Balance                      ← breadcrumb, muted
//   Stock Balance ☆                     [Refresh] [Export ▾]
//   Closing stock per item for the chosen period          ← one muted line
//
// The star, when given, sits immediately right of the title — same size and
// place on every report page. The trail is the shared ui/navigation
// Breadcrumbs; the shell's own trail is switched off for these routes by
// `staticData: { ownCrumbs: true }` (routes/static-data.ts).
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { RenderLinkArgs } from '@/ui/layout/link-slot';
import { Breadcrumbs, type Crumb } from '@/ui/navigation';
import { StarToggle } from './star-toggle';
import '../reports.css';

export interface ReportPageHeaderProps {
  title: string;
  /** Department crumb (links to /reports?group=<dept>). */
  dept?: string | undefined;
  /** Last crumb (the report's own title). */
  current?: string | undefined;
  /** Report whose star sits right after the title. */
  star?: { slug: string; title: string } | undefined;
  subline?: ReactNode;
  actions?: ReactNode;
}

/** Crumb targets carry their query (`/reports?group=Store`); split it back
 *  into path + search for the router link. */
function renderCrumbLink(p: RenderLinkArgs): ReactNode {
  const [path = p.to, qs] = p.to.split('?');
  const search: Record<string, string> = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
  return (
    <Link to={path} search={search} style={p.style}>
      {p.children}
    </Link>
  );
}

export function ReportPageHeader({
  title,
  dept,
  current,
  star,
  subline,
  actions,
}: ReportPageHeaderProps): React.JSX.Element {
  const crumbs: Crumb[] = [{ label: 'Reports', to: '/reports' }];
  if (dept) crumbs.push({ label: dept, to: `/reports?group=${encodeURIComponent(dept)}` });
  if (current) crumbs.push({ label: current });

  return (
    <header>
      <div className="rpt-crumbs">
        <Breadcrumbs crumbs={crumbs} renderLink={renderCrumbLink} />
      </div>
      <div className="rpt-title-row">
        <div className="rpt-title-main">
          <h1 className="rpt-title" title={title}>
            {title}
          </h1>
          {star ? <StarToggle slug={star.slug} title={star.title} /> : null}
        </div>
        {actions ? <div className="rpt-actions">{actions}</div> : null}
      </div>
      {subline ? <div className="rpt-subline">{subline}</div> : null}
    </header>
  );
}
