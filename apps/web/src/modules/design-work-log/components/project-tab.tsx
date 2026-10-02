// Design Work Log — Project Hours tab (ADR-203 frozen header). Chrome: the
// Grand Total. The one-card-per-project list is ONE filled table, one row per
// project (most hours first) with the same figures the card showed: total
// hours, hours by Design Engineer and hours by category (each largest first).

import { useMemo } from 'react';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { useDesignProjectsList } from '../../design-projects/api';
import { useDesignWorkLogList } from '../api';

interface ProjectHoursRow {
  id: string;
  name: string;
  code: string;
  totalHrs: number;
  byEng: Record<string, number>;
  byCat: Record<string, number>;
}

/** "Anil 12.0h · Bhavna 3.5h" — largest first, one decimal, as the card listed. */
function Breakdown({ by }: { by: Record<string, number> }): React.JSX.Element {
  const list = Object.entries(by).sort((a, b) => b[1] - a[1]);
  if (list.length === 0) return <span className="text3">—</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', columnGap: 12, rowGap: 2 }}>
      {list.map(([k, hrs]) => (
        <span key={k} style={{ whiteSpace: 'nowrap' }}>
          {k} <span className="mono fw-700">{hrs.toFixed(1)}h</span>
        </span>
      ))}
    </span>
  );
}

const COLUMNS: DataTableColumn<ProjectHoursRow>[] = [
  {
    id: 'project',
    header: 'Project',
    kind: 'text',
    align: 'left',
    render: (p) => (
      <span className="fw-700">
        {p.code} — {p.name}
      </span>
    ),
  },
  {
    id: 'total_hours',
    header: 'Total Hours',
    align: 'right',
    className: 'mono fw-700',
    nowrap: true,
    render: (p) => <span style={{ color: 'var(--blue)' }}>{p.totalHrs.toFixed(1)}h</span>,
  },
  {
    id: 'by_engineer',
    header: 'By Design Engineer',
    kind: 'text',
    align: 'left',
    render: (p) => <Breakdown by={p.byEng} />,
  },
  {
    id: 'by_category',
    header: 'By Category',
    kind: 'text',
    align: 'left',
    render: (p) => <Breakdown by={p.byCat} />,
  },
];

export function ProjectTab(): React.JSX.Element {
  const { data, isLoading } = useDesignWorkLogList({ limit: 2000, offset: 0 });
  const { data: projData } = useDesignProjectsList({ filter: 'all', limit: 200, offset: 0 });

  const projectData = useMemo(() => {
    const logs = data?.items ?? [];
    const projects = projData?.items ?? [];
    const out = projects.map((p): ProjectHoursRow => {
      const pLogs = logs.filter((l) => l.designProjectId === p.id);
      const totalHrs = pLogs.reduce((s, l) => s + l.hours, 0);
      const byEng: Record<string, number> = {};
      pLogs.forEach((l) => {
        byEng[l.engineerText] = (byEng[l.engineerText] ?? 0) + l.hours;
      });
      const byCat: Record<string, number> = {};
      pLogs.forEach((l) => {
        byCat[l.category] = (byCat[l.category] ?? 0) + l.hours;
      });
      return { id: p.id, name: p.projectName, code: p.code, totalHrs, byEng, byCat };
    });
    return out.sort((a, b) => b.totalHrs - a.totalHrs);
  }, [data?.items, projData?.items]);

  const gt = projectData.reduce((s, p) => s + p.totalHrs, 0);

  return (
    <>
      <div
        className="panel"
        style={{ textAlign: 'center', padding: 14, marginBottom: 'var(--panel-gap)' }}
      >
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Grand Total</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--blue)' }}>{gt.toFixed(0)}h</div>
      </div>
      <Panel fill bodyPadding="none">
        <DataTable<ProjectHoursRow>
          columns={COLUMNS}
          rows={projectData}
          rowKey={(p) => p.id}
          loading={isLoading}
          emptyText="No work logged."
          frozen
        />
      </Panel>
    </>
  );
}
