import type { ReportDefinition } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader, PageHeader } from '@/ui/layout';
import { useReportList } from '../api';
import { useReportAccess } from '../lib/report-access';
import { StarToggle } from '../components/star-toggle';
import { useReportPrefs } from '../lib/report-prefs';

const listSearchSchema = z.object({
  group: z.string().optional(),
  search: z.string().optional(),
});

export const reportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports',
  validateSearch: listSearchSchema,
  component: ReportsListPage,
});

// Per-dept accent, mirroring legacy `deptColors` (HTML L20033) — used for the
// per-group headings and the per-report chips, exactly as legacy colours its
// report tabs. Legacy's hexes are mapped to the nearest theme token rather than
// copied literally (the port is a light theme; legacy was dark):
//   #2563EB → --blue · #D97706 → --amber · #DC2626 → --red · #16A34A → --green
//   #0D9488 → --dept-finance · #0891B2 → --cyan · #7C3AED → --purple
// Planning has no legacy colour; it takes its own department token. Groups
// with no entry fall back to var(--cyan), as legacy does.
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

function ReportsListPage() {
  const search = reportsListRoute.useSearch();
  const navigate = reportsListRoute.useNavigate();
  const { data, isLoading, isError, error } = useReportList();
  const { ready: accessReady, canSee } = useReportAccess();

  // Only the reports this user's Access Control allows. Empty until access has
  // loaded (the page shows its loading line meanwhile), so nothing flickers in
  // and back out.
  const visible = useMemo(
    () => (data && accessReady ? data.reports.filter((r) => canSee(r)) : []),
    [data, accessReady, canSee],
  );

  const loading = isLoading || !accessReady;
  const failed = !loading && (isError || !data);
  const errorText = error instanceof Error ? error.message : 'Could not load reports. Try again.';

  if (search.group) {
    const dept = search.group;
    const deptReports = visible.filter((r) => r.group === dept);
    return (
      <div>
        <PageHeader
          title={`${dept} Reports`}
          icon="📊"
          actions={
            <Link to="/reports" className="btn btn-ghost">
              All Reports
            </Link>
          }
        />
        {loading ? (
          <LoadingPanel />
        ) : failed ? (
          <ErrorPanel text={errorText} />
        ) : deptReports.length === 0 ? (
          <div className="panel">
            <div className="panel-body empty-state">
              No reports for this department that you have access to.
            </div>
          </div>
        ) : (
          <ReportCardGrid reports={deptReports} />
        )}
      </div>
    );
  }

  const term = search.search ?? '';
  const shownCount = visible.filter((r) =>
    matchesSearchTerm([r.title, r.description, r.group], term),
  ).length;

  return (
    <div>
      <ListHeader
        title="Reports"
        icon="📊"
        count={loading || failed ? undefined : shownCount}
        noun="report"
        search={term}
        onSearch={(v) => {
          const next = normalizeSearchTerm(v);
          void navigate({
            search: (prev) => ({ ...prev, search: next === '' ? undefined : next }),
            replace: true,
          });
        }}
        searchPlaceholder="Search report name, description, department…"
        tools={
          <Link to="/saved-reports" className="btn btn-ghost">
            ✨ Saved Reports
          </Link>
        }
      />
      {loading ? (
        <LoadingPanel />
      ) : failed ? (
        <ErrorPanel text={errorText} />
      ) : (
        <Catalogue reports={visible} term={term} />
      )}
    </div>
  );
}

function LoadingPanel(): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-body text3">
        <Loader2 size={14} className="inline animate-spin" /> Loading reports…
      </div>
    </div>
  );
}

function ErrorPanel({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
        {text}
      </div>
    </div>
  );
}

// ─── Dept mode: compact card grid, nothing runs until a card is opened ────

function ReportCardGrid({ reports }: { reports: ReportDefinition[] }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 8,
      }}
    >
      {reports.map((r) => (
        <div key={r.slug} className="panel" style={{ margin: 0 }}>
          <div className="panel-body" style={{ padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link
                to="/reports/$slug"
                params={{ slug: r.slug }}
                style={{
                  fontWeight: 700,
                  color: 'var(--text)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={r.title}
              >
                {r.title}
              </Link>
              <StarToggle slug={r.slug} title={r.title} />
            </div>
            <div
              className="text3"
              style={{
                fontSize: 'var(--fs-xs)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={r.description}
            >
              {r.description}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Catalogue mode: search, ★ My Reports, Recently opened, then by dept ──

function Catalogue({ reports, term }: { reports: ReportDefinition[]; term: string }) {
  const { starred, recent } = useReportPrefs();

  const matched = useMemo(
    () => reports.filter((r) => matchesSearchTerm([r.title, r.description, r.group], term)),
    [reports, term],
  );
  const bySlug = useMemo(() => new Map(matched.map((r) => [r.slug, r])), [matched]);

  // Starred / recent slugs that are still a visible, matching report — a
  // report the user has since lost access to drops out of both rows.
  const pick = (slugs: readonly string[]): ReportDefinition[] =>
    slugs.map((s) => bySlug.get(s)).filter((r): r is ReportDefinition => Boolean(r));
  const mine = pick(starred);
  const recents = pick(recent);

  const groups = useMemo(() => {
    const out = new Map<string, ReportDefinition[]>();
    for (const r of matched) {
      const list = out.get(r.group) ?? [];
      list.push(r);
      out.set(r.group, list);
    }
    return [...out.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b));
  }, [matched]);

  return (
    <>
      {mine.length > 0 ? (
        <ChipRow label="★ My Reports" color="var(--amber)" reports={mine} />
      ) : null}
      {recents.length > 0 ? (
        <ChipRow label="Recently opened" color="var(--text2)" reports={recents} />
      ) : null}

      {groups.length === 0 ? (
        <div className="panel">
          <div className="panel-body empty-state">
            {term ? 'No report matches your search.' : 'No reports you have access to.'}
          </div>
        </div>
      ) : (
        groups.map(([group, list]) => (
          <ChipRow
            key={group}
            label={group}
            color={DEPT_COLOR[group] ?? 'var(--cyan)'}
            reports={list}
          />
        ))
      )}
    </>
  );
}

function ChipRow(props: {
  label: string;
  color: string;
  reports: ReportDefinition[];
}): React.JSX.Element {
  const { label, color, reports } = props;
  return (
    <div>
      <div className="section-hdr" style={{ marginBottom: 8, color }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
        {reports.map((report) => {
          const chip = DEPT_COLOR[report.group] ?? 'var(--cyan)';
          return (
            <span
              key={report.slug}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
            >
              <Link
                to="/reports/$slug"
                params={{ slug: report.slug }}
                className="btn btn-sm"
                style={{
                  fontWeight: 700,
                  background: chip,
                  color: 'var(--bg2)',
                  border: `1px solid ${chip}`,
                }}
                title={`${report.description} — ${report.columns.length} columns · ${
                  report.filters.length === 0
                    ? 'no filters'
                    : `${report.filters.length} filter${report.filters.length === 1 ? '' : 's'}`
                }`}
              >
                {report.title}
              </Link>
              <StarToggle slug={report.slug} title={report.title} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
