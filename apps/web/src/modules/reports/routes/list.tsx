import type { ReportDefinition } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowRight, BarChart3, Loader2, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useReportList } from '../api';

export const reportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports',
  component: ReportsListPage,
});

function ReportsListPage() {
  const { data, isLoading, isError, error } = useReportList();

  const grouped = useMemo(() => {
    if (!data) return {} as Record<string, ReportDefinition[]>;
    const out: Record<string, ReportDefinition[]> = {};
    for (const r of data.reports) {
      if (!out[r.group]) out[r.group] = [];
      out[r.group]!.push(r);
    }
    return out;
  }, [data]);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="mt-1 h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
              <p className="text-sm text-muted-foreground">
                Server-defined reports — pick one, fill the filters, run.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link to="/saved-reports">
              <Sparkles />
              Saved reports
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading reports…
              </div>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load reports</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : 'Unknown error'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([group, reports]) => (
              <div key={group} className="space-y-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {reports.map((report) => (
                    <Link
                      key={report.slug}
                      to="/reports/$slug"
                      params={{ slug: report.slug }}
                      className="group flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-card-foreground transition-colors hover:bg-accent"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">{report.title}</div>
                        <p className="text-xs text-muted-foreground">{report.description}</p>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {report.columns.length} columns ·{' '}
                          {report.filters.length === 0
                            ? 'no filters'
                            : `${report.filters.length} filter${report.filters.length === 1 ? '' : 's'}`}
                        </div>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
