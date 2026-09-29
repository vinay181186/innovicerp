// Catalogue building blocks (ERPNext workspace): shortcut tiles for ★ My
// Reports / Recently opened, department cards, and the full-width department
// list. Every report row has the same layout: title link (stretched over the
// row) + one muted description line, and the ★ in a fixed last slot.
import type { ReportDefinition } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { plural } from '../lib/plural';
import { StarToggle } from './star-toggle';

// Per-dept accent, mirroring legacy `deptColors` (HTML L20033), mapped to the
// nearest theme token. Groups with no entry fall back to var(--cyan).
const DEPT_COLOR: Record<string, string> = {
  Sales: 'var(--green)',
  Planning: 'var(--dept-planning)',
  Design: 'var(--purple)',
  Production: 'var(--cyan)',
  Purchase: 'var(--blue)',
  Store: 'var(--amber)',
  Quality: 'var(--red)',
  QC: 'var(--red)',
  Finance: 'var(--dept-finance)',
};

/** Department order on the catalogue — the order of the header menus' work
 *  flow. Any other group follows, alphabetically. */
const GROUP_ORDER = [
  'Sales',
  'Planning',
  'Design',
  'Production',
  'Purchase',
  'Store',
  'Quality',
  'Finance',
];

function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
}

export function groupByDept(reports: ReportDefinition[]): [string, ReportDefinition[]][] {
  const out = new Map<string, ReportDefinition[]>();
  for (const r of reports) {
    const list = out.get(r.group) ?? [];
    list.push(r);
    out.set(r.group, list);
  }
  return [...out.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b));
}

function TitleLink({ report }: { report: ReportDefinition }): React.JSX.Element {
  return (
    <Link
      to="/reports/$slug"
      params={{ slug: report.slug }}
      className="rpt-row-link"
      title={report.title}
    >
      <span className="rpt-row-title">{report.title}</span>
    </Link>
  );
}

// ─── Shortcut tiles ──────────────────────────────────────────────────

export function ShortcutSection({
  label,
  reports,
}: {
  label: string;
  reports: ReportDefinition[];
}): React.JSX.Element {
  return (
    <section>
      <h2 className="rpt-section-title">{label}</h2>
      <div className="rpt-tiles">
        {reports.map((r) => (
          <div key={r.slug} className="rpt-tile">
            <Link
              to="/reports/$slug"
              params={{ slug: r.slug }}
              className="rpt-row-link"
              title={r.description || r.title}
            >
              <span className="rpt-row-title">{r.title}</span>
              <span className="rpt-row-desc">{r.group}</span>
            </Link>
            <StarToggle slug={r.slug} title={r.title} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Department cards ────────────────────────────────────────────────

export function DeptCards({
  groups,
}: {
  groups: [string, ReportDefinition[]][];
}): React.JSX.Element {
  return (
    <section>
      <h2 className="rpt-section-title">By department</h2>
      <div className="rpt-cards">
        {groups.map(([group, list]) => (
          <div
            key={group}
            className="rpt-card"
            style={{ '--rpt-accent': DEPT_COLOR[group] ?? 'var(--cyan)' } as CSSProperties}
          >
            <div className="rpt-card-head">
              <span className="rpt-card-name">{group}</span>
              <span className="rpt-card-count">{plural(list.length, 'report')}</span>
            </div>
            <ul className="rpt-card-body">
              {list.map((r) => (
                <li key={r.slug} className="rpt-row">
                  <div style={{ minWidth: 0 }}>
                    <TitleLink report={r} />
                    <span className="rpt-row-desc" title={r.description}>
                      {r.description}
                    </span>
                  </div>
                  <StarToggle slug={r.slug} title={r.title} />
                </li>
              ))}
            </ul>
            <div className="rpt-card-foot">
              <Link to="/reports" search={{ group }}>
                Open {group} reports →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Department mode: one full-width list ────────────────────────────

export function DeptList({ reports }: { reports: ReportDefinition[] }): React.JSX.Element {
  return (
    <div className="rpt-list" role="table" aria-label="Reports">
      <div className="rpt-list-head" role="row">
        <span role="columnheader">Report</span>
        <span role="columnheader">Description</span>
        <span role="columnheader" aria-label="My Reports" />
      </div>
      {reports.map((r) => (
        <div key={r.slug} className="rpt-list-row" role="row">
          <TitleLink report={r} />
          <span className="rpt-row-desc" title={r.description}>
            {r.description}
          </span>
          <StarToggle slug={r.slug} title={r.title} />
        </div>
      ))}
    </div>
  );
}
